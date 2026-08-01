import { memo } from "preact/compat";
import { useState, useCallback } from "preact/hooks";
import type { ConsoleEntry, RecordingSession } from "../../shared/protocol";

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
  const [searchQuery, setSearchQuery] = useState("");

  const matches = useCallback((entry: ConsoleEntry) => {
    const level = (entry.level || "log").toLowerCase();
    if (levelFilter === "error" && level !== "error") return false;
    if (levelFilter === "warning" && level !== "warn" && level !== "warning") return false;
    if (levelFilter === "info" && level !== "info") return false;
    if (levelFilter === "debug" && level !== "debug" && level !== "log") return false;
    if (levelFilter !== "all" && !["error", "warning", "info", "debug"].includes(levelFilter)) return false;
    const query = searchQuery.trim().toLowerCase();
    return !query || [entry.text, entry.source, level].some((value) => (value || "").toLowerCase().includes(query));
  }, [levelFilter, searchQuery]);

  const entries = snapshot.included.filter(matches);
  const countText = levelFilter !== "all" || searchQuery.trim()
    ? `匹配 ${entries.length} / ${snapshot.included.length} 条`
    : `共 ${snapshot.included.length} 条`;

  const handleExclude = useCallback(async (e: MouseEvent, id: string) => {
    e.stopPropagation();
    if (onExclude) {
      await onExclude(id);
      onSelectionChanged?.();
    }
  }, [onExclude, onSelectionChanged]);

  const handleRowClick = useCallback((createdAt: number) => {
    onSeekVideo?.(createdAt);
  }, [onSeekVideo]);

  return (
    <div className="integrated-card-panel">
      <div className="integrated-panel-header">
        <select 
          className="panel-filter-select" 
          value={levelFilter}
          onChange={(e) => setLevelFilter((e.target as HTMLSelectElement).value)}
        >
          <option value="all">全部级别</option>
          <option value="error">error</option>
          <option value="warning">warning</option>
          <option value="info">info</option>
          <option value="debug">debug</option>
        </select>
        <input 
          type="text" 
          className="panel-search-input" 
          placeholder="搜索日志文本"
          value={searchQuery}
          onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
        />
        <span className="panel-filter-count">{countText}</span>
      </div>
      <div className="integrated-panel-body">
        {entries.length > 0 ? (
          <div className="console-view">
            {entries.slice().reverse().map((entry) => {
              const level = (entry.level || "log").toLowerCase();
              const displayText = (entry.text || "").includes("%c")
                ? (entry.text || "").replace(/%c/g, "").replace(/\s+[a-zA-Z\-]+:\s*[^;]+;/g, "")
                : entry.text || "";

              return (
                <div 
                  key={entry.id}
                  className={`console-row console-row-${level}`}
                  data-id={entry.id}
                  onClick={() => handleRowClick(entry.createdAt)}
                >
                  <div className="console-row-left">
                    {level === "error" ? (
                      <svg className="console-icon error" viewBox="0 0 16 16" width="12" height="12">
                        <circle cx="8" cy="8" r="7" fill="#d93025"/>
                        <path d="M4.5 4.5l7 7m0-7l-7 7" stroke="#fff" strokeWidth="1.8"/>
                      </svg>
                    ) : level === "warn" || level === "warning" ? (
                      <svg className="console-icon warn" viewBox="0 0 16 16" width="12" height="12">
                        <path d="M8 1.5l6.5 12h-13z" fill="#f39c12"/>
                        <text x="8" y="11.5" textAnchor="middle" fill="#fff" fontSize="9" fontWeight="bold">!</text>
                      </svg>
                    ) : level === "info" ? (
                      <svg className="console-icon info" viewBox="0 0 16 16" width="12" height="12">
                        <circle cx="8" cy="8" r="7" fill="#165dff"/>
                        <text x="8" y="11.5" textAnchor="middle" fill="#fff" fontSize="9" fontWeight="bold">i</text>
                      </svg>
                    ) : (
                      <span className="console-icon log-prompt">❯</span>
                    )}
                    <span className="console-level-tag">{level}</span>
                    <pre className="console-message">{displayText}</pre>
                  </div>
                  <div className="console-row-right">
                    <span className="console-time">{new Date(entry.createdAt).toLocaleTimeString()}</span>
                    {editable ? (
                      <button 
                        className="item-delete-btn delete" 
                        title="从预览和导出中删除此日志"
                        onClick={(e) => handleExclude(e, entry.id)}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
              ? "未找到匹配的 Console 日志" 
              : snapshot.all.length && editable 
                ? "所有 Console 日志均已删除，可从右上角恢复。" 
                : "没有 Console 记录"}
          </div>
        )}
      </div>
    </div>
  );
});
