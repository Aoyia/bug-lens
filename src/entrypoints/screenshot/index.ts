import { ScreenshotOverlay } from "../../screenshot/overlay/screenshot-overlay";
import { recentErrorsTracker } from "../../screenshot/probes/recent-errors-tracker";
import {
  ensureErrorsTrackerStarted,
  ensureScreenshotOverlayBridge,
} from "../content/content-bridge";
import { message } from "../../shared/protocol";

const isTopFrame = typeof window !== "undefined" && window.top === window;

if (isTopFrame) {
  // 确保最近错误追踪器已开启（跨注入幂等）
  ensureErrorsTrackerStarted(() => recentErrorsTracker.startListening());

  // 截图 overlay 初始为关闭：仅在顶层窗口报告与挂载
  void chrome.runtime
    .sendMessage(message("content/screenshot-overlay-state", { open: false }))
    .catch(() => undefined);

  // 截图 overlay 消息桥（幂等注册）
  ensureScreenshotOverlayBridge({
    createOverlay: () => new ScreenshotOverlay(),
    onMessage: (fn) => chrome.runtime.onMessage.addListener(fn),
    sendMessage: (msg) => chrome.runtime.sendMessage(msg),
  });
}
