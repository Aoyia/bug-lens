import { memo } from "preact/compat";
import { useState, useCallback, useRef, useEffect } from "preact/hooks";
import {
  getSessionTitle,
  type EvidenceSummary,
  type SessionStatus,
  type SessionOverview,
  type StorageOverview,
} from "../../shared/protocol";
import { t } from "../../shared/i18n";
import { formatSessionDate } from "../../popup/session-date";
import "../../shared/components/truncated-text";

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
  onRenameSession?: (sessionId: string, title: string) => void;
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
  onRenameSession,
  onResumeSession,
}: HistoryListProps) {
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingSessionId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingSessionId]);

  const handleStartEdit = useCallback(
    (sessionId: string, currentTitle: string, e?: Event) => {
      e?.stopPropagation();
      setEditingSessionId(sessionId);
      setEditingTitle(currentTitle);
    },
    []
  );

  const handleCommitEdit = useCallback(
    (sessionId: string) => {
      if (editingSessionId === sessionId) {
        onRenameSession?.(sessionId, editingTitle);
        setEditingSessionId(null);
      }
    },
    [editingSessionId, editingTitle, onRenameSession]
  );

  const handleCancelEdit = useCallback((e?: Event) => {
    e?.stopPropagation();
    setEditingSessionId(null);
  }, []);

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
            const date = formatSessionDate(session.timeline.createdAtEpochMs);
            const isContinuable = session.quality.issues.some(
              (entry) =>
                entry.code.startsWith("SESSION_") ||
                entry.code === "MEDIA_CONTEXT_LOST"
            );
            const displayTitle = getSessionTitle(session, t("unnamedTab"));
            const isEditing = editingSessionId === session.id;

            return (
              <article
                key={session.id}
                className="session"
                aria-label={displayTitle}
                // 整卡可点击打开预览：卡片 hover 已有蓝色描边（可点击暗示），
                // 若点击主体无响应会破坏感知可用性；同时扩大主操作热区（Fitts 定律）。
                // 内嵌按钮各自 stopPropagation，避免冒泡双触发。
                onClick={() => onOpenPreview(session.id)}
              >
                <div className="session-head">
                  {isEditing ? (
                    <div
                      className="session-title-edit"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        ref={inputRef}
                        className="session-title-input"
                        type="text"
                        value={editingTitle}
                        placeholder={
                          session.target.initialTitle || t("unnamedTab")
                        }
                        onInput={(e) => setEditingTitle(e.currentTarget.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            e.stopPropagation();
                            handleCommitEdit(session.id);
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            e.stopPropagation();
                            handleCancelEdit(e);
                          }
                        }}
                        onBlur={() => handleCommitEdit(session.id)}
                        aria-label={t("renameSession")}
                      />
                    </div>
                  ) : (
                    <div
                      className="session-title-wrapper"
                      onMouseEnter={(e) => {
                        const textEl =
                          e.currentTarget.querySelector<HTMLElement>(
                            ".session-title"
                          );
                        if (textEl) {
                          const customEl = textEl as unknown as {
                            checkOverflow?: () => boolean;
                          };
                          const isOverflow =
                            typeof customEl.checkOverflow === "function"
                              ? customEl.checkOverflow()
                              : textEl.scrollWidth > textEl.clientWidth;
                          e.currentTarget.toggleAttribute(
                            "data-overflowed",
                            isOverflow
                          );
                        }
                      }}
                      onDblClick={(e) =>
                        handleStartEdit(
                          session.id,
                          session.customTitle ??
                            session.target.initialTitle ??
                            "",
                          e
                        )
                      }
                    >
                      <truncated-text
                        className="session-title"
                        text={displayTitle}
                        no-tooltip
                      />
                      <button
                        type="button"
                        className="btn-edit-title"
                        title={t("renameSession")}
                        aria-label={`${t("renameSession")} - ${displayTitle}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleStartEdit(
                            session.id,
                            session.customTitle ??
                              session.target.initialTitle ??
                              "",
                            e
                          );
                        }}
                      >
                        <svg
                          width="11"
                          height="11"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M12 20h9"></path>
                          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                        </svg>
                      </button>

                      {/* 仿成熟开源组件的标准单一片段 Tooltip */}
                      <div className="session-title-tooltip" role="tooltip">
                        {displayTitle}
                      </div>
                    </div>
                  )}
                  <div className="session-head-actions">
                    {isContinuable && (
                      <button
                        className="btn-continue-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          onResumeSession(session.id);
                        }}
                        aria-label={`${t("resume")} - ${displayTitle}`}
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
                      aria-label={`${t("preview")} - ${displayTitle}`}
                    >
                      {t("preview")}
                    </button>
                    <button
                      className="btn-delete-icon"
                      title={t("deleteSession")}
                      aria-label={`${t("deleteSession")} - ${displayTitle}`}
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

      <div
        className="storage-footer"
        title={
          storage
            ? t("storagePolicyFull", [
                String(storage.policy.retentionDays),
                formatBytes(storage.policy.maxSessionBytes),
              ])
            : undefined
        }
      >
        <span id="storage-used">
          {storage
            ? t("storageUsed", formatBytes(storage.usedBytes))
            : t("loading")}
        </span>
        {" · "}
        <span id="storage-count">
          {storage
            ? t("sessionsCount", String(storage.sessionCount))
            : t("loading")}
        </span>
        {storage && (
          <>
            {" · "}
            <span id="storage-policy" className="storage-policy">
              {t("storagePolicy", [String(storage.policy.retentionDays)])}
            </span>
          </>
        )}
      </div>
    </div>
  );
});
