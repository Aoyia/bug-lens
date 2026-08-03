import { memo } from "preact/compat";
import {
  type EvidenceSummary,
  type RecordingSession,
} from "../../shared/protocol";
import { t } from "../../shared/i18n";

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

      <div className="actions" style={{ marginTop: "10px" }}>
        {!active && !ready && (
          <button
            id="start"
            data-testid="start-recording-btn"
            className="action-btn start"
            onClick={onStart}
            aria-label={t("startRecording")}
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
          </button>
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
