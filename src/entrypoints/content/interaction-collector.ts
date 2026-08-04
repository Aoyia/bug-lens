import { isEnvelope, message } from "../../shared/protocol";
import {
  captureFrameworkState,
  isMeaningfulFrameworkState,
} from "../../domain/framework-state-capture";
import { captureEnvironment } from "../../domain/environment-capture";
import type { FrameworkStateTrigger } from "../../shared/protocol";
import { RecordingWidget } from "./collector/recording-widget";
import { SelectionOverlay } from "./collector/selection-overlay";
import { IssueEditor } from "./collector/issue-editor";
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

  const isMac =
    typeof navigator !== "undefined" &&
    Boolean(
      /(Mac|iPhone|iPod|iPad)/i.test(navigator.platform || navigator.userAgent)
    );

  // ─── Module Instances ───

  const widget: RecordingWidget = new RecordingWidget({
    onStop() {
      widget.setSavingState(true);
      void chrome.runtime.sendMessage(
        message("session/stop", { commandId: crypto.randomUUID() })
      );
    },
    onStopAndExport() {
      widget.setSavingState(true, "正在打包 ZIP 并在复制提示词...");
      const commandId = crypto.randomUUID();
      chrome.runtime
        .sendMessage(
          message("session/stop", {
            commandId,
            autoExport: true,
            silentExport: true,
          })
        )
        .then(
          async (res: {
            ok?: boolean;
            session?: {
              id: string;
              silentPrompt?: string;
              silentExportResult?: { ok: boolean; error?: string };
            };
          }) => {
            if (!res?.ok) {
              widget.setSavingState(false);
              widget.showToast("停止并导出失败，请重试");
              return;
            }
            if (res.session?.silentPrompt) {
              try {
                await navigator.clipboard.writeText(res.session.silentPrompt);
              } catch {
                const textarea = document.createElement("textarea");
                textarea.value = res.session.silentPrompt;
                textarea.style.position = "fixed";
                textarea.style.opacity = "0";
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand("copy");
                textarea.remove();
              }
            }
            const exported = res.session?.silentExportResult;
            widget.setSavingState(false);
            if (exported && !exported.ok) {
              widget.showToast(
                "ZIP 导出失败，证据已保留，请从扩展历史记录中重新导出"
              );
            } else {
              widget.showToast("ZIP 下载完成，AI 提示词已自动复制到剪贴板！");
            }
            setTimeout(() => {
              widget.unmount();
            }, 1000);
          }
        )
        .catch(() => {
          widget.setSavingState(false);
          widget.showToast("停止并导出失败，请重试");
        });
    },
    onStopAndDiscard() {
      void chrome.runtime.sendMessage(
        message("session/stop", {
          commandId: crypto.randomUUID(),
          discard: true,
        })
      );
      widget.unmount();
    },
    onMarkIssue() {
      beginIssueSelection();
    },
    onTogglePause() {
      if (monitor.isIdlePaused) {
        // 处于暂停态（闲置自动暂停或手动暂停）时点击按钮 = 继续
        monitor.resume();
      } else {
        // 录制进行中点击按钮 = 手动暂停
        monitor.toggleManualPause();
      }
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
    onCaptureComplete(scene, dataUrl) {
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

  function beginIssueSelection(): void {
    if (overlay.isActive || editor.isOpen) return;
    widget.setIssueSelecting(true);
    overlay.open();
    captureFrameworkTick("issue-scene");
  }

  function removeIssueUi(): void {
    overlay.close();
    editor.close(false);
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
