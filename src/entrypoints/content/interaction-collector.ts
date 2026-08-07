import { isEnvelope, message } from "../../shared/protocol";
import { t } from "../../shared/i18n";
import { copyTextToClipboard } from "../../preview/clipboard";
import {
  captureFrameworkState,
  isMeaningfulFrameworkState,
} from "../../domain/framework-state-capture";
import { captureEnvironment } from "../../domain/environment-capture";
import { getSilentExportFailure } from "../../domain/silent-export";
import type {
  ExpectedStatement,
  FrameworkStateTrigger,
} from "../../shared/protocol";
import { RecordingWidget } from "./collector/recording-widget";
import { SelectionOverlay } from "./collector/selection-overlay";
import { IssueEditor } from "./collector/issue-editor";
import { ExpectedCaptureCard } from "./collector/expected-capture-card";
import { DomObserver } from "./collector/dom-observer";
import { InactivityMonitor } from "./collector/inactivity-monitor";

type ContentSession = {
  sessionId: string;
  nonce: string;
  startedAtEpochMs?: number;
  privacyMode: "safe" | "raw";
  captureFrameworkState?: boolean;
};
type ContentController = {
  refresh: (next: ContentSession | undefined) => void;
};

declare global {
  interface Window {
    __WEB_BUG_RECORDER_INSTALLED__?: boolean;
    __WEB_BUG_RECORDER_SESSION__?: ContentSession;
    __WEB_BUG_RECORDER_CONTROLLER__?: ContentController;
  }
}

import { ScreenshotOverlay } from "../../screenshot/screenshot-overlay";
import { recentErrorsTracker } from "../../screenshot/recent-errors-tracker";

recentErrorsTracker.startListening();

// 截图 overlay 初始为关闭：content script 重新注入（页面刷新等）时刷新 background
// 的互斥标志，避免截图 overlay 异常销毁后残留"截图中"状态卡住录制启动。
void chrome.runtime
  .sendMessage(message("content/screenshot-overlay-state", { open: false }))
  .catch(() => undefined);

let screenshotOverlayInstance: ScreenshotOverlay | null = null;

chrome.runtime.onMessage.addListener((msg, _sender, _sendResponse) => {
  if (msg && msg.type === "TRIGGER_SCREENSHOT_OVERLAY" && msg.viewportDataUrl) {
    if (!screenshotOverlayInstance) {
      screenshotOverlayInstance = new ScreenshotOverlay();
    }
    // 截图 overlay 开闭状态上报 background，用于与视频录制互斥：
    // 截图中拒绝启动录制，录制中拒绝触发截图。
    const reportOverlayState = (open: boolean) => {
      void chrome.runtime
        .sendMessage(message("content/screenshot-overlay-state", { open }))
        .catch(() => undefined);
    };
    reportOverlayState(true);
    screenshotOverlayInstance.show({
      viewportDataUrl: msg.viewportDataUrl,
      onComplete: () => {
        screenshotOverlayInstance = null;
        reportOverlayState(false);
      },
      onCancel: () => {
        screenshotOverlayInstance = null;
        reportOverlayState(false);
      },
    });
  }
});

const existingController = window.__WEB_BUG_RECORDER_CONTROLLER__;
if (existingController) {
  void chrome.runtime
    .sendMessage(
      message("content/hello", {
        url: location.href,
        title: document.title,
        environment: captureEnvironment(),
      })
    )
    .then((response) => {
      existingController.refresh(
        response?.active && response.sessionId && response.nonce
          ? {
              sessionId: response.sessionId,
              nonce: response.nonce,
              startedAtEpochMs: response.startedAtEpochMs,
              privacyMode: response.privacyMode === "raw" ? "raw" : "safe",
              captureFrameworkState: Boolean(response.captureFrameworkState),
            }
          : undefined
      );
    })
    .catch(() => undefined);
} else {
  window.__WEB_BUG_RECORDER_INSTALLED__ = true;
  let session: ContentSession | undefined;
  let cachedStartedAtEpochMs: number | undefined;
  /** 速记卡确认的期望，随 issue-scene/capture 透传，编辑器打开后清空。 */
  let pendingExpected: ExpectedStatement | undefined;

  const isMac =
    typeof navigator !== "undefined" &&
    Boolean(
      /(Mac|iPhone|iPod|iPad)/i.test(navigator.platform || navigator.userAgent)
    );

  // ─── Module Instances ───

  const widget: RecordingWidget = new RecordingWidget({
    async onStop() {
      widget.setSavingState(true);
      try {
        const res = await chrome.runtime.sendMessage(
          message("session/stop", {
            commandId: crypto.randomUUID(),
            silentExport: true,
          })
        );
        const exportFailure = getSilentExportFailure(res, t("stopFailed"));
        if (exportFailure) {
          widget.showToast(t("exportFailed", exportFailure), 5_500, "error");
          return;
        }
        const prompt = res?.session?.silentPrompt;
        if (prompt) {
          try {
            await copyTextToClipboard(prompt);
          } catch {
            // ignore
          }
        }
        widget.showToast(t("exportSuccessCopied"));
      } catch (error) {
        widget.showToast(t("exportFailed", String(error)), 5_500, "error");
      }
    },
    onMarkIssue(anchor) {
      beginIssueSelection(anchor);
    },
    isPaused() {
      return monitor.isIdlePaused;
    },
    getStartedAtEpochMs() {
      return session?.startedAtEpochMs || cachedStartedAtEpochMs || Date.now();
    },
    isIdlePaused(): boolean {
      return monitor.isIdlePaused;
    },
    getPausedDurationMs(): number {
      return monitor.getPausedDurationMs();
    },
  });

  const editor = new IssueEditor({
    getSession: () => session,
    onClose(restoreWidget) {
      if (restoreWidget && session) widget.mount();
    },
    onReselect() {
      beginIssueSelection();
    },
    onStopAfterCommit() {
      widget.unmount();
    },
    isMac,
  });

  const overlay: SelectionOverlay = new SelectionOverlay({
    getSession: () => session,
    getPendingExpected: () => pendingExpected,
    onCaptureComplete(scene, dataUrl) {
      pendingExpected = undefined;
      widget.unmount();
      editor.open(scene, dataUrl);
    },
    onCancel() {
      widget.mount();
    },
    getEditorElement: () => editor.element,
    shortcutKeyText: widget.shortcutKeyText,
  });

  const observer = new DomObserver({
    getSession: () => session,
    isIssueActive: () => overlay.isActive || editor.isOpen,
    beginIssueSelection,
    removeIssueUi,
    onEvidenceTick: () => captureFrameworkTick("interaction"),
  });

  const expectedCard = new ExpectedCaptureCard({
    onSubmit(expected) {
      pendingExpected = expected;
      proceedToIssueSelection();
    },
    onSkip() {
      pendingExpected = undefined;
      proceedToIssueSelection();
    },
  });

  const monitor: InactivityMonitor = new InactivityMonitor({
    onPause() {
      widget.updatePauseState(true);
      if (session)
        void chrome.runtime.sendMessage(
          message(
            "offscreen/pause-media",
            { sessionId: session.sessionId },
            session.sessionId,
            "offscreen"
          )
        );
    },
    onResume() {
      widget.updatePauseState(false);
      if (session)
        void chrome.runtime.sendMessage(
          message(
            "offscreen/resume-media",
            { sessionId: session.sessionId },
            session.sessionId,
            "offscreen"
          )
        );
    },
    isBlocked: (): boolean => overlay.isActive || editor.isOpen,
  });

  // ─── Coordination ───

  let lastFrameworkTickAt = 0;
  const FRAMEWORK_TICK_MIN_INTERVAL_MS = 3_000;

  function captureFrameworkTick(trigger: FrameworkStateTrigger): void {
    if (!session?.sessionId) return;
    if (!session.captureFrameworkState) return;
    const now = Date.now();
    if (
      trigger !== "start" &&
      now - lastFrameworkTickAt < FRAMEWORK_TICK_MIN_INTERVAL_MS
    )
      return;
    lastFrameworkTickAt = now;
    const state = captureFrameworkState({
      sessionId: session.sessionId,
      trigger,
      privacyMode: session.privacyMode,
    });
    if (!isMeaningfulFrameworkState(state)) return;
    void chrome.runtime
      .sendMessage(
        message("framework/state", { state }, session.sessionId, "background")
      )
      .catch(() => undefined);
  }

  function beginIssueSelection(anchor?: { x: number; y: number }): void {
    if (overlay.isActive || editor.isOpen || expectedCard.isOpen) return;
    // 先弹出期望速记卡：在记忆峰值捕获"预期应该发生什么"（P2），
    // 确认/跳过后再进入元素选择，全程不阻断主流程。
    // 卡片就近锚定鼠标位置；快捷键触发时无锚点，回退顶部居中。
    expectedCard.open(anchor);
  }

  function proceedToIssueSelection(): void {
    if (overlay.isActive || editor.isOpen) return;
    widget.setIssueSelecting(true);
    overlay.open();
    captureFrameworkTick("issue-scene");
  }

  function removeIssueUi(): void {
    overlay.close();
    editor.close(false);
    expectedCard.close();
    widget.setIssueSelecting(false);
  }

  function refreshSession(
    next: ContentSession | undefined,
    health?: import("../../shared/protocol").RecordingHealthInfo
  ): void {
    observer.clearPending();
    if (!next) removeIssueUi();
    if (next) {
      if (next.startedAtEpochMs) {
        cachedStartedAtEpochMs = next.startedAtEpochMs;
      } else if (!cachedStartedAtEpochMs) {
        cachedStartedAtEpochMs = Date.now();
      }
    } else {
      cachedStartedAtEpochMs = undefined;
    }
    session = next;
    window.__WEB_BUG_RECORDER_SESSION__ = next;
    if (next) {
      widget.mount();
      if (health) widget.updateHealth(health);
      monitor.start();
      captureFrameworkTick("start");
    } else {
      widget.unmount();
      monitor.stop();
    }
  }

  // ─── Bootstrap ───

  observer.attach();

  window.__WEB_BUG_RECORDER_CONTROLLER__ = { refresh: refreshSession };
  chrome.runtime.onMessage.addListener((raw: unknown) => {
    if (!isEnvelope(raw)) return;
    if (raw.target && raw.target !== "content") return;
    if (raw.type === "content/reset") refreshSession(undefined);
    if (raw.type === "content/health-update" && raw.payload?.health) {
      if (session && raw.sessionId === session.sessionId) {
        widget.updateHealth(raw.payload.health);
      }
    }
  });
  chrome.runtime
    .sendMessage(
      message("content/hello", {
        url: location.href,
        title: document.title,
        environment: captureEnvironment(),
      })
    )
    .then((response) => {
      refreshSession(
        response?.active && response.sessionId && response.nonce
          ? {
              sessionId: response.sessionId,
              nonce: response.nonce,
              startedAtEpochMs: response.startedAtEpochMs,
              privacyMode: response.privacyMode === "raw" ? "raw" : "safe",
              captureFrameworkState: Boolean(response.captureFrameworkState),
            }
          : undefined,
        response?.health
      );
    })
    .catch(() => undefined);
}
