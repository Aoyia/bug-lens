import { memo } from "preact/compat";
import {
  message,
  type EvidenceSummary,
  type RecordingSession,
} from "../../shared/protocol";
import { t } from "../../shared/i18n";

const isMac =
  typeof navigator !== "undefined" &&
  Boolean(
    /(Mac|iPhone|iPod|iPad)/i.test(navigator.platform || navigator.userAgent)
  );
/** 全局录制快捷键（与 src/manifest.json 中 start-recording 的 suggested_key 保持一致） */
/** 全局录制与截图快捷键 */
const recordShortcut = isMac ? "Option+R" : "Alt+R";
const screenshotShortcut = isMac ? "Option+X" : "Alt+X";

interface RecordPanelProps {
  activeSession?: RecordingSession;
  activeTab?: chrome.tabs.Tab;
  active: boolean;
  ready: boolean;
  timerText: string;
  getStatusText: () => string;
  activeEvidence: (session?: RecordingSession) => EvidenceSummary[];
  evidenceLabel: (evidence: EvidenceSummary) => string;
  evidenceStateLabel: (state: string) => string;
  onStart: () => void;
  onStop: () => void;
  onOpenPreview: () => void;
}

export const RecordPanel = memo(function RecordPanel({
  activeSession,
  activeTab,
  active,
  ready,
  timerText,
  getStatusText,
  activeEvidence,
  evidenceLabel,
  evidenceStateLabel,
  onStart,
  onStop,
  onOpenPreview,
}: RecordPanelProps) {
  const handleTakeScreenshot = () => {
    if (!activeTab?.id) return;
    chrome.runtime
      .sendMessage(message("screenshot/trigger", { tabId: activeTab.id }))
      .catch((err) => {
        console.warn("Bug Lens: Failed trigger screenshot message", err);
      });
    window.close();
  };

  return (
    <div className="context-flow" data-testid="record-panel">
      <div className="context-head">
        <div id="title" className="target-title">
          {activeTab?.title || t("failedToReadTab")}
        </div>
        <div
          className="status-badge"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <span
            id="dot"
            className={`dot ${active ? "rec" : ""}`}
            aria-hidden="true"
          ></span>
          <span id="status">{getStatusText()}</span>
          {timerText && (
            <span id="timer" style={{ marginLeft: "4px" }}>
              {timerText}
            </span>
          )}
        </div>
      </div>
      <div id="url" className="target-url">
        {activeTab?.url || ""}
      </div>
      <div id="evidence" className="evidence">
        {activeEvidence(activeSession).map((item) => (
          <span
            key={item.kind}
            className={`chip ${item.state}`}
            title={item.detail}
          >
            {evidenceLabel(item)} · {evidenceStateLabel(item.state)}
          </span>
        ))}
      </div>

      <div
        className="actions"
        style={{ marginTop: "10px", display: "flex", gap: "8px" }}
      >
        {!active && !ready && (
          <>
            <button
              id="start"
              data-testid="start-recording-btn"
              className="action-btn start"
              onClick={onStart}
              aria-label={t("startRecording")}
              title={`${t("startRecording")} (${recordShortcut})`}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="8"></circle>
              </svg>
              <span>{t("startRecording")}</span>
              <kbd className="shortcut-hint">{recordShortcut}</kbd>
            </button>
            <button
              id="take-screenshot"
              data-testid="take-screenshot-btn"
              className="action-btn secondary"
              onClick={handleTakeScreenshot}
              aria-label="一键截图并收集 DOM 上下文"
              title={`截图 (${screenshotShortcut})`}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                <circle cx="12" cy="13" r="4"></circle>
              </svg>
              <span>截图</span>
              <kbd className="shortcut-hint">{screenshotShortcut}</kbd>
            </button>
          </>
        )}
        {active && (
          <button
            id="stop"
            data-testid="stop-recording-btn"
            className="action-btn stop"
            disabled={activeSession?.status === "STOPPING"}
            onClick={onStop}
            aria-label={t("stopRecording")}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <rect x="6" y="6" width="12" height="12" rx="2"></rect>
            </svg>
            <span>{t("stopRecording")}</span>
          </button>
        )}
        {ready && (
          <button
            id="preview"
            data-testid="preview-btn"
            className="action-btn secondary"
            onClick={onOpenPreview}
          >
            {t("reopenPreview")}
          </button>
        )}
      </div>
    </div>
  );
});
