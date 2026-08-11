import type { BackgroundContext } from "./context";
import type { SessionLifecycle } from "./lifecycle";
import type { BootstrapService } from "./bootstrap";

/** 供 registerBackgroundEvents 注册的处理器集合（与 createBackgroundRuntime 返回对象兼容）。 */
export interface BackgroundEventHandlers {
  handleDebuggerEvent(
    source: chrome.debugger.Debuggee,
    method: string,
    params?: object
  ): void;
  handleDebuggerDetach(
    source: chrome.debugger.Debuggee,
    reason: string
  ): Promise<void>;
  handleTabRemoved(tabId: number): Promise<void>;
  handleTabUpdated(
    tabId: number,
    changeInfo: { status?: string }
  ): Promise<void>;
  handleMessage(
    raw: unknown,
    sender: chrome.runtime.MessageSender
  ): Promise<unknown>;
  bootstrapPromise: Promise<void>;
  /** 免维存储：定期清理过期会话。 */
  cleanupExpiredSessions(): Promise<unknown>;
  startRecordingViaShortcut(): Promise<void>;
  startScreenshotViaShortcut(): Promise<void>;
}

/** 事件处理器工厂：chrome 事件 → 领域服务调用（保持与拆分前完全一致的转发语义）。 */
export function createEventHandlers(
  ctx: BackgroundContext,
  services: { lifecycle: SessionLifecycle; bootstrap: BootstrapService }
): Omit<
  BackgroundEventHandlers,
  | "bootstrapPromise"
  | "cleanupExpiredSessions"
  | "startRecordingViaShortcut"
  | "startScreenshotViaShortcut"
  | "handleMessage"
> {
  const { db, recordingCoordinator, streamHealthMonitor, cdpCollector } = ctx;
  const { lifecycle, bootstrap } = services;

  // CDP 事件统一转发给 cdpCollector（网络/控制台证据采集）
  function handleDebuggerEvent(
    source: chrome.debugger.Debuggee,
    method: string,
    params?: object
  ): void {
    cdpCollector.handleEvent(source, method, params);
  }

  // 调试器意外断开（导航/关闭等）：非停止流程中标记 cdp 异常并尝试重连恢复
  async function handleDebuggerDetach(
    source: chrome.debugger.Debuggee,
    reason: string
  ): Promise<void> {
    await bootstrap.promise;
    const session = await db.getActiveSession();
    if (
      session &&
      session.target.tabId === source.tabId &&
      !["STOPPING", "PREVIEW_READY", "EXPORTED", "FAILED"].includes(
        session.status
      ) &&
      !recordingCoordinator.isStopping(session.id)
    ) {
      streamHealthMonitor.updateStream("cdp", "disrupted");
      await cdpCollector.handleDetach(source, reason, () => {
        streamHealthMonitor.updateStream("cdp", "ok");
      });
    }
  }

  // 录制目标标签页被关闭：以系统指令停止对应会话
  async function handleTabRemoved(tabId: number): Promise<void> {
    await bootstrap.promise;
    const session = await db.getActiveSession();
    if (session?.target.tabId === tabId)
      await lifecycle.stop(`system:tab-removed:${session.id}`);
  }

  // 标签页导航完成（complete）后重注入采集脚本，恢复录制挂件与 CDP 连接
  async function handleTabUpdated(
    tabId: number,
    changeInfo: { status?: string }
  ): Promise<void> {
    // `complete` 为新文档提供稳定的 body 供录制挂件使用；
    // 动态注册仍会在 document_start 运行，以便尽早开始采集。
    if (changeInfo.status !== "complete") return;
    await bootstrap.promise;
    await recordingCoordinator.runLifecycle(() =>
      bootstrap.restoreAfterNavigation(tabId)
    );
  }

  return {
    handleDebuggerEvent,
    handleDebuggerDetach,
    handleTabRemoved,
    handleTabUpdated,
  };
}

/** 首次安装引导页：GitHub Pages 托管的产品介绍与上手引导（引导已从扩展内迁移至网页）。 */
const ONBOARDING_PAGE_URL = "https://aoyia.github.io/bug-lens/";

/** 注册全部 chrome 事件监听（debugger / tabs / startup / installed / alarms / commands / onMessage）。 */
export function registerBackgroundEvents(
  handlers: BackgroundEventHandlers
): void {
  chrome.debugger.onEvent.addListener((source, method, params) => {
    handlers.handleDebuggerEvent(source, method, params);
  });

  // 调试器意外断开（导航/关闭等）：非停止流程中标记 cdp 异常并尝试重连恢复
  chrome.debugger.onDetach.addListener((source, reason) => {
    void handlers.handleDebuggerDetach(source, reason);
  });

  // 录制目标标签页被关闭：以系统指令停止对应会话
  chrome.tabs.onRemoved.addListener((tabId) => {
    void handlers.handleTabRemoved(tabId);
  });

  // 标签页导航完成（complete）后重注入采集脚本，恢复录制挂件与 CDP 连接
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    void handlers.handleTabUpdated(tabId, changeInfo);
  });

  chrome.runtime.onStartup.addListener(() => {
    void handlers.bootstrapPromise;
  });

  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason !== "install") return;
    void (async () => {
      // 自动化测试（Playwright E2E）通过 skipOnboardingGuide 标记跳过，避免打断测试
      const stored = (await chrome.storage.local
        .get("skipOnboardingGuide")
        .catch(() => ({}))) as { skipOnboardingGuide?: boolean };
      if (stored?.skipOnboardingGuide) return;
      await chrome.tabs
        .create({ url: ONBOARDING_PAGE_URL })
        .catch(() => undefined);
    })();
  });

  // 免维存储：定期清理过期会话（6 小时一次，比 24 小时更及时回收空间）
  chrome.alarms.create("bug-lens-storage-cleanup", { periodInMinutes: 6 * 60 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "bug-lens-storage-cleanup")
      void handlers.cleanupExpiredSessions();
  });

  // 全局快捷键分发：start-recording → 录屏，take-screenshot → 独立截图
  chrome.commands.onCommand.addListener((command) => {
    if (command === "start-recording") {
      void handlers.startRecordingViaShortcut();
    } else if (command === "take-screenshot") {
      void handlers.startScreenshotViaShortcut();
    }
  });

  // 消息路由中枢：承载 content script / popup / offscreen 的所有消息分发。
  chrome.runtime.onMessage.addListener((raw: unknown, sender) => {
    return handlers.handleMessage(raw, sender);
  });
}
