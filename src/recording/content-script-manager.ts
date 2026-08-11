import { message } from "../shared/protocol.ts";

const SCRIPT_ID = "web-bug-recorder-content";

export class ContentScriptManager {
  private registered = false;

  async activate(tabId: number): Promise<void> {
    await this.ensureRegistered();
    await this.executeInTab(tabId);
  }

  async restore(tabId: number): Promise<void> {
    // 导航会销毁文档及其中的所有 content script 实例（即使动态注册本身仍存在）。
    // 因此始终对当前文档执行注入，作为确定性兜底
    // （脚本是幂等的，并会执行 content/hello 握手）。
    await this.ensureRegistered();
    await this.executeInTab(tabId);
  }

  private async executeInTab(tabId: number): Promise<void> {
    const run = () =>
      chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ["content.js"],
      });
    try {
      await run();
    } catch (firstError) {
      // 注入偶发失败（如页面正处于导航窗口期），整体重试一次后再放弃
      console.warn(
        `[Bug Lens] 采集器注入失败，重试一次：${String(firstError)}`
      );
      try {
        await run();
      } catch (secondError) {
        console.error(`[Bug Lens] 采集器注入最终失败：${String(secondError)}`);
      }
    }
  }

  async remove(tabId?: number): Promise<void> {
    if (typeof tabId === "number") {
      await chrome.tabs
        .sendMessage(tabId, message("content/reset", {}))
        .catch(() => undefined);
    }
    const registrations = await chrome.scripting
      .getRegisteredContentScripts({ ids: [SCRIPT_ID] })
      .catch(() => []);
    if (this.registered || registrations.length) {
      await chrome.scripting
        .unregisterContentScripts({ ids: [SCRIPT_ID] })
        .catch(() => undefined);
    }
    this.registered = false;
  }

  private async ensureRegistered(): Promise<void> {
    if (!this.registered) {
      try {
        await chrome.scripting.registerContentScripts([
          {
            id: SCRIPT_ID,
            js: ["content.js"],
            matches: ["http://*/*", "https://*/*"],
            // 动态注册的采集脚本：allFrames 覆盖 iframe 内的交互，document_start
            // 尽早注入避免漏掉页面早期事件，persistAcrossSessions 不跨浏览器会话保留
            allFrames: true,
            runAt: "document_start",
            persistAcrossSessions: false,
          },
        ]);
      } catch (error) {
        // 幂等处理并发注册竞态："already exists" 说明已有同名注册、视为成功，
        // 继续走下方查询兜底确认；其他错误保持未注册状态待下次重试。
        if (!String(error).includes("already exists")) this.registered = false;
      }
      if (!this.registered) {
        const registrations = await chrome.scripting
          .getRegisteredContentScripts({ ids: [SCRIPT_ID] })
          .catch(() => []);
        this.registered = registrations.length > 0;
      }
    }
  }
}
