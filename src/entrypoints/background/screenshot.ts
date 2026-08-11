import { ACTIVE_STATUSES } from "../../shared/protocol";
import { normalizeRecordingOptions } from "../../domain/storage-policy";
import type { BackgroundContext } from "./context";
import type { SessionLifecycle } from "./lifecycle";

const LAST_OPTIONS_KEY = "last-recording-options";

/** 截图领域服务：独立截图触发 + 快捷键入口。 */
export interface ScreenshotService {
  triggerInTab(tabId: number, windowId: number): Promise<void>;
  startScreenshotViaShortcut(): Promise<void>;
  startRecordingViaShortcut(): Promise<void>;
}

export function createScreenshotService(
  ctx: BackgroundContext,
  lifecycle: SessionLifecycle,
  waitForBootstrap: () => Promise<void>
): ScreenshotService {
  const { db, contentScripts } = ctx;

  /** 独立截图入口（popup/快捷键/消息共用）：录制互斥 → 注入 content script → captureVisibleTab → 唤起页面 overlay。 */
  async function triggerScreenshotInTab(
    tabId: number,
    windowId: number
  ): Promise<void> {
    await waitForBootstrap();
    // 截图与视频录制互斥：录制进行中拒绝触发独立截图
    const active = await db.getActiveSession();
    if (active && ACTIVE_STATUSES.includes(active.status)) {
      console.warn("[Bug Lens] 录制进行中，拒绝触发独立截图（两者互斥）");
      return;
    }
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab || !tab.url || !/^https?:/.test(tab.url)) {
      console.warn("[Bug Lens] 截图功能仅支持 http/https 普通网页");
      return;
    }

    // 1. 确保 Content Script 在触发截图前被注入并激活
    await contentScripts.activate(tabId).catch((err) => {
      console.warn(`[Bug Lens] 动态注入 Content Script 失败: ${String(err)}`);
    });

    // 2. 截取视口图像
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
      format: "png",
    });

    // 3. 唤起页面的 Screenshot Overlay
    await chrome.tabs.sendMessage(tabId, {
      type: "TRIGGER_SCREENSHOT_OVERLAY",
      viewportDataUrl: dataUrl,
    });
  }

  /** 截图快捷键入口：对当前激活标签页触发独立截图。 */
  async function startScreenshotViaShortcut(): Promise<void> {
    await waitForBootstrap();
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.id || tab.windowId === undefined) return;
    try {
      await triggerScreenshotInTab(tab.id, tab.windowId);
    } catch (error) {
      console.warn(`[Bug Lens] 快捷键触发截图失败：${String(error)}`);
    }
  }

  /**
   * 全局快捷键（start-recording，默认 Alt+R / Option+R）：
   * 直接对当前激活标签页启动录制，无需打开 Popup。
   * 选项复用上次在 Popup 中选择的配置（未配置时用安全默认值）。
   * 成功与否不弹系统通知：录制启动后页面内会自动出现录制挂件，
   * 这本身就是最直观的启动反馈；不满足启动条件时静默跳过。
   */
  async function startRecordingViaShortcut(): Promise<void> {
    await waitForBootstrap();
    // 截图与视频录制互斥：截图 overlay 打开时拒绝启动录制
    if (ctx.isScreenshotOverlayOpen.get()) {
      console.warn("[Bug Lens] 截图进行中，拒绝启动视频录制（两者互斥）");
      return;
    }
    const active = await db.getActiveSession();
    if (active && ACTIVE_STATUSES.includes(active.status)) {
      return;
    }
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) {
      return;
    }
    const stored = (await chrome.storage.local.get(LAST_OPTIONS_KEY)) as {
      [LAST_OPTIONS_KEY]?: unknown;
    };
    const options = normalizeRecordingOptions(
      stored[LAST_OPTIONS_KEY] as
        Parameters<typeof normalizeRecordingOptions>[0] | undefined,
      await db.getStoragePolicy()
    );
    try {
      await lifecycle.start({
        tabId: tab.id,
        options,
        commandId: crypto.randomUUID(),
      });
    } catch (error) {
      console.warn(`[Bug Lens] 全局快捷键启动录制失败：${String(error)}`);
    }
  }

  return {
    triggerInTab: triggerScreenshotInTab,
    startScreenshotViaShortcut,
    startRecordingViaShortcut,
  };
}
