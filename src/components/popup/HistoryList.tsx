import { memo } from "preact/compat";
import {
  type EvidenceSummary,
  type SessionStatus,
  type SessionOverview,
  type StorageOverview,
} from "../../shared/protocol";
import { t } from "../../shared/i18n";

/** 会话状态 → i18n key：历史卡片状态标签必须走双语文案，不能把内部枚举直接展示给用户 */
const SESSION_STATUS_KEYS: Record<SessionStatus, string> = {
  IDLE: "sessionStatusIdle",
  PREPARING: "sessionStatusPreparing",
  RECORDING: "sessionStatusRecording",
  DEGRADED: "sessionStatusDegraded",
  STOPPING: "sessionStatusStopping",
  PREVIEW_READY: "sessionStatusPreviewReady",
  EXPORTING: "sessionStatusExporting",
  EXPORTED: "sessionStatusExported",
  FAILED: "sessionStatusFailed",
};

function sessionStatusLabel(status: SessionStatus): string {
  const key = SESSION_STATUS_KEYS[status];
  return key ? t(key) : status;
}

interface HistoryListProps {
  searchQuery: string;
  sessions: SessionOverview[];
  storage?: StorageOverview;
  /** 列表查询是否仍在进行：为 true 且无缓存列表时展示加载占位，而非"无匹配记录"空状态 */
  loading: boolean;
  formatBytes: (bytes: number) => string;
  evidenceLabel: (evidence: EvidenceSummary) => string;
  evidenceStateLabel: (state: string) => string;
  onSearchChange: (query: string) => void;
  onOpenPreview: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onResumeSession: (sessionId: string) => void;
}

export const HistoryList = memo(function HistoryList({
  searchQuery,
  sessions,
  storage,
  loading,
  formatBytes,
  evidenceLabel,
  evidenceStateLabel,
  onSearchChange,
  onOpenPreview,
  onDeleteSession,
  onResumeSession,
}: HistoryListProps) {
  return (
    <div>
      <div className="search-wrapper" role="search">
        <svg
          className="search-icon"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
        <input
          id="search"
          type="search"
          aria-label={t("searchPlaceholder")}
          placeholder={t("searchPlaceholder")}
          value={searchQuery}
          onInput={(e) => onSearchChange(e.currentTarget.value)}
        />
      </div>

      <div id="sessions" className="sessions" aria-busy={loading}>
        {sessions.length === 0 ? (
          loading ? (
            <div className="loading-state" role="status" aria-live="polite">
              {t("loading")}
            </div>
          ) : (
            <div className="empty-state">
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
              </svg>
              <div className="empty-title">{t("noMatchingHistory")}</div>
              <div className="empty-sub">{t("emptyHistorySub")}</div>
            </div>
          )
        ) : (
          sessions.map((item) => {
            const { session } = item;
            const date = new Date(
              session.timeline.createdAtEpochMs
            ).toLocaleString();
            const isContinuable = session.quality.issues.some(
              (entry) =>
                entry.code.startsWith("SESSION_") ||
                entry.code === "MEDIA_CONTEXT_LOST"
            );
            return (
              <article
                key={session.id}
                className="session"
                aria-label={session.target.initialTitle || t("unnamedTab")}
                // 整卡可点击打开预览：卡片 hover 已有蓝色描边（可点击暗示），
                // 若点击主体无响应会破坏感知可用性；同时扩大主操作热区（Fitts 定律）。
                // 内嵌按钮各自 stopPropagation，避免冒泡双触发。
                onClick={() => onOpenPreview(session.id)}
              >
                <div className="session-head">
                  <div
                    className="session-title"
                    title={session.target.initialTitle}
                  >
                    {session.target.initialTitle || t("unnamedTab")}
                  </div>
                  <div className="session-head-actions">
                    {isContinuable && (
                      <button
                        className="btn-continue-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          onResumeSession(session.id);
                        }}
                        aria-label={`${t("resume")} - ${session.target.initialTitle || t("unnamedTab")}`}
                      >
                        {t("resume")}
                      </button>
                    )}
                    <button
                      className="btn-open-preview"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenPreview(session.id);
                      }}
                      aria-label={`${t("preview")} - ${session.target.initialTitle || t("unnamedTab")}`}
                    >
                      {t("preview")}
                    </button>
                    <button
                      className="btn-delete-icon"
                      title={t("deleteSession")}
                      aria-label={`${t("deleteSession")} - ${session.target.initialTitle || t("unnamedTab")}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteSession(session.id);
                      }}
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                      </svg>
                    </button>
                  </div>
                </div>
                <div className="session-meta">
                  <span className="session-status-tag">
                    {sessionStatusLabel(session.status)}
                  </span>{" "}
                  · {date} · {formatBytes(item.sizeBytes)} ·{" "}
                  {session.target.initialUrl}
                </div>
                <div className="evidence">
                  {item.evidence.map((ev) => (
                    <span
                      key={ev.kind}
                      className={`chip ${ev.state}`}
                      title={ev.detail}
                    >
                      {evidenceLabel(ev)} · {evidenceStateLabel(ev.state)}
                    </span>
                  ))}
                </div>
              </article>
            );
          })
        )}
      </div>

      <div className="storage-footer">
        <span id="storage-used">
          {storage
            ? t("storageUsed", formatBytes(storage.usedBytes))
            : t("loading")}
        </span>{" "}
        ·{" "}
        <span id="storage-count">
          {storage
            ? t("sessionsCount", String(storage.sessionCount))
            : "0 个会话"}
        </span>
        {storage && (
          <div id="storage-policy" className="storage-policy">
            {t("storagePolicy", [
              String(storage.policy.retentionDays),
              formatBytes(storage.policy.maxSessionBytes),
            ])}
          </div>
        )}
      </div>
    </div>
  );
});
