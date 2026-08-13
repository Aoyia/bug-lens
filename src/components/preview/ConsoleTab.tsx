import { memo } from "preact/compat";
import { useState, useCallback } from "preact/hooks";
import type { ConsoleEntry, RecordingSession } from "../../shared/protocol.ts";
import { formatElapsedEpochTime } from "../../domain/evidence-clock.ts";
import { useFilteredList } from "../../hooks/useFilteredList.ts";
import { filterConsoleEntries } from "../../preview/console-filter.ts";
import { handleFilterEscape } from "../../preview/filter-search.ts";
import { t } from "../../shared/i18n.ts";

export interface ConsoleTabProps {
  snapshot: {
    session?: RecordingSession;
    all: ConsoleEntry[];
    included: ConsoleEntry[];
  };
  editable: boolean;
  onExclude?: (id: string) => Promise<void>;
  onSelectionChanged?: () => void;
  onSeekVideo?: (timestampMs: number) => void;
}

export const ConsoleTab = memo(function ConsoleTab({
  snapshot,
  editable,
  onExclude,
  onSelectionChanged,
  onSeekVideo,
}: ConsoleTabProps) {
  const [levelFilter, setLevelFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // 行时间统一时间语言：优先显示相对录制起点的 MM:SS.mmm
  // （与 NetworkTab / StreamTab / InteractionsTab 的证据时间线契约一致，
  //  点击行 seek 视频时行时间必须与视频时间轴同基准）。
  // 无起点或时间早于起点时回退到本地绝对时间，不丢信息、不抛异常。
  const originEpochMs =
    snapshot.session?.timeline.startedAtEpochMs ??
    snapshot.session?.timeline.createdAtEpochMs;

  const formatRowTime = useCallback(
    (epochMs: number): string => {
      if (originEpochMs != null) {
        const relative = formatElapsedEpochTime(epochMs, originEpochMs);
        if (relative !== undefined) return relative;
      }
      return new Date(epochMs).toLocaleTimeString();
    },
    [originEpochMs]
  );

  const matchFn = useCallback(
    (entry: ConsoleEntry, query: string) => {
      return filterConsoleEntries([entry], levelFilter, query).length > 0;
    },
    [levelFilter]
  );

  const {
    searchQuery,
    setSearchQuery,
    filtered: entries,
    countText,
  } = useFilteredList(snapshot.included, matchFn);

  // 级别过滤生效时覆盖 countText 文案
  const displayCountText =
    levelFilter !== "all" || searchQuery.trim()
      ? t("matchingCount", [
          String(entries.length),
          String(snapshot.included.length),
        ])
      : countText;

  const handleExclude = useCallback(
    async (e: MouseEvent, id: string) => {
      e.stopPropagation();
      if (onExclude) {
        await onExclude(id);
        onSelectionChanged?.();
      }
    },
    [onExclude, onSelectionChanged]
  );

  const handleRowClick = useCallback(
    (id: string, createdAt: number) => {
      setSelectedId(id);
      onSeekVideo?.(createdAt);
    },
    [onSeekVideo]
  );

  return (
    <div className="integrated-card-panel">
      <div className="integrated-panel-header">
        <select
          id="console-level-filter"
          className="panel-filter-select"
          value={levelFilter}
          onChange={(e) =>
            setLevelFilter((e.target as HTMLSelectElement).value)
          }
        >
          <option value="all">{t("allLevels")}</option>
          <option value="error">error</option>
          <option value="warning">warning</option>
          <option value="info">info</option>
          <option value="debug">debug</option>
        </select>
        <input
          type="text"
          className="panel-search-input"
          placeholder={t("searchLogText")}
          value={searchQuery}
          onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => handleFilterEscape(e, searchQuery, setSearchQuery)}
        />
        <span className="panel-filter-count">{displayCountText}</span>
      </div>
      <div className="integrated-panel-body">
        {entries.length > 0 ? (
          <div className="console-view">
            {entries
              .slice()
              .reverse()
              .map((entry) => {
                const level = (entry.level || "log").toLowerCase();
                const displayText = (entry.text || "").includes("%c")
                  ? (entry.text || "")
                      .replace(/%c/g, "")
                      .replace(/\s+[a-zA-Z\-]+:\s*[^;]+;/g, "")
                  : entry.text || "";

                return (
                  <div
                    key={entry.id}
                    className={`console-row console-row-${level}${entry.id === selectedId ? " selected" : ""}`}
                    data-id={entry.id}
                    onClick={() => handleRowClick(entry.id, entry.createdAt)}
                  >
                    <div className="console-row-left">
                      {level === "error" ? (
                        <svg
                          className="console-icon error"
                          viewBox="0 0 16 16"
                          width="12"
                          height="12"
                        >
                          <circle cx="8" cy="8" r="7" fill="#d93025" />
                          <path
                            d="M4.5 4.5l7 7m0-7l-7 7"
                            stroke="#fff"
                            strokeWidth="1.8"
                          />
                        </svg>
                      ) : level === "warn" || level === "warning" ? (
                        <svg
                          className="console-icon warn"
                          viewBox="0 0 16 16"
                          width="12"
                          height="12"
                        >
                          <path d="M8 1.5l6.5 12h-13z" fill="#f39c12" />
                          <text
                            x="8"
                            y="11.5"
                            textAnchor="middle"
                            fill="#fff"
                            fontSize="9"
                            fontWeight="bold"
                          >
                            !
                          </text>
                        </svg>
                      ) : level === "info" ? (
                        <svg
                          className="console-icon info"
                          viewBox="0 0 16 16"
                          width="12"
                          height="12"
                        >
                          <circle cx="8" cy="8" r="7" fill="#165dff" />
                          <text
                            x="8"
                            y="11.5"
                            textAnchor="middle"
                            fill="#fff"
                            fontSize="9"
                            fontWeight="bold"
                          >
                            i
                          </text>
                        </svg>
                      ) : (
                        <span className="console-icon log-prompt">❯</span>
                      )}
                      <span className="console-level-tag">{level}</span>
                      <pre className="console-message">{displayText}</pre>
                    </div>
                    <div className="console-row-right">
                      <span className="console-time">
                        {formatRowTime(entry.createdAt)}
                      </span>
                      {editable ? (
                        <button
                          className="item-delete-btn delete"
                          title={t("deleteFromExport")}
                          aria-label={t("deleteFromExport")}
                          onClick={(e) => handleExclude(e, entry.id)}
                        >
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            <line x1="10" y1="11" x2="10" y2="17"></line>
                            <line x1="14" y1="11" x2="14" y2="17"></line>
                          </svg>
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
          </div>
        ) : (
          <div className="empty">
            {snapshot.included.length
              ? t("noMatchingConsole")
              : snapshot.all.length && editable
                ? t("allConsoleDeleted")
                : t("noConsoleRecords")}
          </div>
        )}
      </div>
    </div>
  );
});
