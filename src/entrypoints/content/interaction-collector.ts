import { message } from "../../shared/protocol";
import { RecordingWidget } from "./collector/recording-widget";
import { SelectionOverlay } from "./collector/selection-overlay";
import { IssueEditor } from "./collector/issue-editor";
import { DomObserver } from "./collector/dom-observer";
import { InactivityMonitor } from "./collector/inactivity-monitor";

type ContentSession = { sessionId: string; nonce: string; startedAtEpochMs?: number; privacyMode: "safe" | "raw" };
type ContentController = { refresh: (next: ContentSession | undefined) => void };

declare global {
  interface Window {
    __WEB_BUG_RECORDER_INSTALLED__?: boolean;
    __WEB_BUG_RECORDER_SESSION__?: ContentSession;
    __WEB_BUG_RECORDER_CONTROLLER__?: ContentController;
  }
}

const existingController = window.__WEB_BUG_RECORDER_CONTROLLER__;
if (existingController) {
  void chrome.runtime.sendMessage(message("content/hello", { url: location.href, title: document.title })).then((response) => {
    existingController.refresh(response?.active && response.sessionId && response.nonce
      ? { sessionId: response.sessionId, nonce: response.nonce, startedAtEpochMs: response.startedAtEpochMs, privacyMode: response.privacyMode === "raw" ? "raw" : "safe" }
      : undefined);
  }).catch(() => undefined);
} else {
  window.__WEB_BUG_RECORDER_INSTALLED__ = true;
  let session: ContentSession | undefined;

  const isMac = typeof navigator !== "undefined" && Boolean(/(Mac|iPhone|iPod|iPad)/i.test(navigator.platform || navigator.userAgent));

  // ─── Module Instances ───

  const widget: RecordingWidget = new RecordingWidget({
    onStop() {
      void chrome.runtime.sendMessage(message("session/stop", { commandId: crypto.randomUUID() }));
      widget.unmount();
    },
    onStopAndExport() {
      void chrome.runtime.sendMessage(message("session/stop", { commandId: crypto.randomUUID(), autoExport: true }));
      widget.unmount();
    },
    onMarkIssue() {
      beginIssueSelection();
    },
    getStartedAtEpochMs() {
      return session?.startedAtEpochMs || Date.now();
    },
    isIdlePaused(): boolean {
      return monitor.isIdlePaused;
    }
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
    isMac
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
    shortcutKeyText: widget.shortcutKeyText
  });

  const observer = new DomObserver({
    getSession: () => session,
    isIssueActive: () => overlay.isActive || editor.isOpen,
    beginIssueSelection,
    removeIssueUi
  });

  const monitor: InactivityMonitor = new InactivityMonitor({
    onPause() {
      widget.updatePauseState(true);
      if (session) void chrome.runtime.sendMessage(message("offscreen/pause-media", { sessionId: session.sessionId }, session.sessionId));
    },
    onResume() {
      widget.updatePauseState(false);
      if (session) void chrome.runtime.sendMessage(message("offscreen/resume-media", { sessionId: session.sessionId }, session.sessionId));
    },
    isBlocked: (): boolean => overlay.isActive || editor.isOpen
  });

  // ─── Coordination ───

  function beginIssueSelection(): void {
    if (overlay.isActive || editor.isOpen) return;
    widget.setIssueSelecting(true);
    overlay.open();
  }

  function removeIssueUi(): void {
    overlay.close();
    editor.close(false);
    widget.setIssueSelecting(false);
  }

  function refreshSession(next: ContentSession | undefined): void {
    observer.clearPending();
    if (!next) removeIssueUi();
    session = next;
    window.__WEB_BUG_RECORDER_SESSION__ = next;
    if (next) {
      widget.mount();
      monitor.start();
    } else {
      widget.unmount();
      monitor.stop();
    }
  }

  // ─── Bootstrap ───

  observer.attach();

  window.__WEB_BUG_RECORDER_CONTROLLER__ = { refresh: refreshSession };
  chrome.runtime.onMessage.addListener((raw: unknown) => {
    if (raw && typeof raw === "object" && (raw as { type?: unknown }).type === "content/reset") refreshSession(undefined);
  });
  chrome.runtime.sendMessage(message("content/hello", { url: location.href, title: document.title })).then((response) => {
    refreshSession(response?.active && response.sessionId && response.nonce
      ? { sessionId: response.sessionId, nonce: response.nonce, startedAtEpochMs: response.startedAtEpochMs, privacyMode: response.privacyMode === "raw" ? "raw" : "safe" }
      : undefined);
  }).catch(() => undefined);
}
