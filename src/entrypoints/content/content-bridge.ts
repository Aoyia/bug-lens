import { message } from "../../shared/protocol.ts";
import type { ScreenshotOverlay } from "../../screenshot/screenshot-overlay.ts";

/**
 * content script 幂等桥（无副作用，纯编排）：
 *
 * background 的 ContentScriptManager.activate/restore 每次都会执行
 * chrome.scripting.executeScript({ files: ["content.js"] })——即重复注入会
 * 重新求值整个 content.js、重建模块级状态。若把「截图 overlay 的监听器注册」
 * 与「实例持有」放在模块顶层，重复注入会累积 chrome.runtime.onMessage 监听器、
 * 单例形同虚设，多次截图后残留 window 拦截器（刷新/滚动永久失效）。
 *
 * 本模块用 window 标志跨注入去重，并暴露两个可注入依赖的幂等入口供测试；
 * 交互收集器（interaction-collector.ts）注入真实实现，测试注入 fake 替身。
 */
declare global {
  interface Window {
    __WEB_BUG_RECORDER_SCREENSHOT_LISTENER__?: boolean;
    __WEB_BUG_RECORDER_SCREENSHOT_OVERLAY__?: ScreenshotOverlay | null;
    __WEB_BUG_RECORDER_ERRORS_TRACKER_STARTED__?: boolean;
  }
}

/** 启动最近错误监听，跨注入幂等（重复执行 executeScript 只启动一次）。 */
export function ensureErrorsTrackerStarted(start: () => void): boolean {
  if (window.__WEB_BUG_RECORDER_ERRORS_TRACKER_STARTED__) return false;
  window.__WEB_BUG_RECORDER_ERRORS_TRACKER_STARTED__ = true;
  start();
  return true;
}

/** 注册截图 overlay 消息桥，跨注入幂等（重复注入只注册一次监听器）。 */
export function ensureScreenshotOverlayBridge(options: {
  createOverlay: () => ScreenshotOverlay;
  onMessage: (fn: (msg: any) => void) => void;
  sendMessage: (msg: unknown) => Promise<unknown>;
}): boolean {
  if (window.__WEB_BUG_RECORDER_SCREENSHOT_LISTENER__) return false;
  window.__WEB_BUG_RECORDER_SCREENSHOT_LISTENER__ = true;

  options.onMessage((msg) => {
    if (
      msg &&
      msg.type === "TRIGGER_SCREENSHOT_OVERLAY" &&
      msg.viewportDataUrl
    ) {
      // 单例复用（window 共享）：同一 document 内只存在一个截图 overlay，关闭后可再次触发
      let overlay = window.__WEB_BUG_RECORDER_SCREENSHOT_OVERLAY__;
      if (!overlay) {
        overlay = options.createOverlay();
        window.__WEB_BUG_RECORDER_SCREENSHOT_OVERLAY__ = overlay;
      }
      // 截图 overlay 开闭状态上报 background，用于与视频录制互斥：
      // 截图中拒绝启动录制，录制中拒绝触发截图。
      const reportOverlayState = (open: boolean) => {
        void options
          .sendMessage(message("content/screenshot-overlay-state", { open }))
          .catch(() => undefined);
      };
      reportOverlayState(true);
      overlay.show({
        viewportDataUrl: msg.viewportDataUrl,
        onComplete: () => {
          window.__WEB_BUG_RECORDER_SCREENSHOT_OVERLAY__ = null;
          reportOverlayState(false);
        },
        onCancel: () => {
          window.__WEB_BUG_RECORDER_SCREENSHOT_OVERLAY__ = null;
          reportOverlayState(false);
        },
      });
    }
  });
  return true;
}
