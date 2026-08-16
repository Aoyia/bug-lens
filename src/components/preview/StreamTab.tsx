import { memo } from "preact/compat";
import { useState, useCallback, useMemo } from "preact/hooks";
import type {
  ConsoleEntry,
  InteractionRecord,
  NetworkEntry,
  RecordingSession,
} from "../../shared/protocol";
import { formatElapsedEpochTime } from "../../domain/evidence-clock";
import { t, getLocale } from "../../shared/i18n.ts";

interface StreamTabProps {
  snapshot: {
    session?: RecordingSession;
    interactions: InteractionRecord[];
    consoleEntries: ConsoleEntry[];
    networkEntries: NetworkEntry[];
  };
  onSeekVideo?: (timestampMs: number) => void;
  onExportClip?: (timestamp: number) => void;
}

export const StreamTab = memo(function StreamTab({
  snapshot,
  onSeekVideo,
  onExportClip,
}: StreamTabProps) {
  const [filterInteractions, setFilterInteractions] = useState(true);
  const [filterConsole, setFilterConsole] = useState(true);
  const [filterNetwork, setFilterNetwork] = useState(true);
  const [filterErrorOnly, setFilterErrorOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const nodes = useMemo(() => {
    const list: any[] = [];

    if (filterInteractions && !filterErrorOnly) {
      snapshot.interactions.forEach((item) => {
        list.push({
          type: "interaction",
          timestamp: item.createdAt,
          id: `step-${item.id}`,
          data: item,
        });
      });
    }

    if (filterConsole) {
      snapshot.consoleEntries.forEach((item) => {
        const level = (item.level || "log").toLowerCase();
        const isErrorWarn =
          level === "error" || level === "warn" || level === "warning";
        if (!filterErrorOnly || isErrorWarn) {
          list.push({
            type: "console",
            timestamp: item.createdAt,
            id: `console-${item.id}`,
            data: item,
          });
        }
      });
    }

    if (filterNetwork) {
      snapshot.networkEntries.forEach((item) => {
        const status = item.status ?? 0;
        const isError = status >= 400 || !!item.error;
        if (!filterErrorOnly || isError) {
          list.push({
            type: "network",
            timestamp: item.createdAt,
            id: `network-${item.id}`,
            data: item,
          });
        }
      });
    }

    return list.sort((a, b) => a.timestamp - b.timestamp);
  }, [
    snapshot,
    filterInteractions,
    filterConsole,
    filterNetwork,
    filterErrorOnly,
  ]);

  const originEpochMs =
    snapshot.session?.timeline.startedAtEpochMs ??
    snapshot.session?.timeline.createdAtEpochMs;

  const handleNodeClick = useCallback(
    (id: string, timestamp: number) => {
      setSelectedId(id);
      onSeekVideo?.(timestamp);
    },
    [onSeekVideo]
  );

  const handleClipClick = useCallback(
    (e: Event, timestamp: number) => {
      e.stopPropagation();
      onExportClip?.(timestamp);
    },
    [onExportClip]
  );

  return (
    <div className="integrated-card-panel">
      <div className="stream-header">
        <div className="stream-filter-tags">
          <label className="stream-filter-label">
            <input
              type="checkbox"
              checked={filterInteractions}
              onChange={(e) => setFilterInteractions(e.currentTarget.checked)}
            />
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 3l7 18 3-7 7-3L3 3z"></path>
            </svg>
            {t("filterInteractions")}
          </label>
          <label className="stream-filter-label">
            <input
              type="checkbox"
              checked={filterConsole}
              onChange={(e) => setFilterConsole(e.currentTarget.checked)}
            />
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="4 17 10 11 4 5"></polyline>
              <line x1="12" y1="19" x2="20" y2="19"></line>
            </svg>
            {t("consoleLogs")}
          </label>
          <label className="stream-filter-label">
            <input
              type="checkbox"
              checked={filterNetwork}
              onChange={(e) => setFilterNetwork(e.currentTarget.checked)}
            />
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="2" y1="12" x2="22" y2="12"></line>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
            </svg>
            {t("networkRequests")}
          </label>
          <label className="stream-filter-label error-chip">
            <input
              type="checkbox"
              checked={filterErrorOnly}
              onChange={(e) => setFilterErrorOnly(e.currentTarget.checked)}
            />
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            {t("errorOnlyFilter")}
          </label>
        </div>
      </div>
      <div className="stream-timeline">
        {nodes.length === 0 ? (
          <div className="stream-empty-text">{t("noStreamEvents")}</div>
        ) : (
          nodes.map((node) => {
            // 相对时间优先（与 Console/Network/Interactions 的证据时间线契约一致）；
            // 节点时间早于录制起点时 formatElapsedEpochTime 返回 undefined，
            // 此时回退到本地绝对时间，避免时间列渲染成空白（不丢信息）。
            const relative =
              originEpochMs != null
                ? formatElapsedEpochTime(node.timestamp, originEpochMs)
                : undefined;
            const relTime =
              relative ??
              new Date(node.timestamp).toLocaleTimeString(getLocale());
            let badgeHtml = null;
            let contentHtml = null;

            if (node.type === "interaction") {
              const data = node.data as InteractionRecord;
              badgeHtml = (
                <span className="stream-node-badge kind-interaction">
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="stream-icon-svg"
                  >
                    <path d="M3 3l7 18 3-7 7-3L3 3z"></path>
                  </svg>
                  {t("streamKindInteraction")}
                </span>
              );
              contentHtml = (
                <>
                  {data.element.text || data.element.tagName}{" "}
                  <span className="stream-node-meta">{data.page.url}</span>
                </>
              );
            } else if (node.type === "console") {
              const data = node.data as ConsoleEntry;
              const badgeClass =
                data.level === "error"
                  ? "kind-console-error"
                  : data.level === "warn" || data.level === "warning"
                    ? "kind-console-warn"
                    : "kind-console-log";
              badgeHtml = (
                <span className={`stream-node-badge ${badgeClass}`}>
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="stream-icon-svg"
                  >
                    <polyline points="4 17 10 11 4 5"></polyline>
                    <line x1="12" y1="19" x2="20" y2="19"></line>
                  </svg>
                  Console.{data.level}
                </span>
              );
              contentHtml = <>{data.text}</>;
            } else if (node.type === "network") {
              const data = node.data as NetworkEntry;
              const status = data.status ?? 0;
              const isError = status >= 400 || !!data.error;
              const badgeClass = isError
                ? "kind-network-error"
                : "kind-network-success";
              const statusText = status || (data.error ? "FAIL" : "...");
              badgeHtml = (
                <span className={`stream-node-badge ${badgeClass}`}>
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="stream-icon-svg"
                  >
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="2" y1="12" x2="22" y2="12"></line>
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                  </svg>
                  Network {statusText}
                </span>
              );
              contentHtml = (
                <>
                  <strong>{(data.method || "GET").toUpperCase()}</strong>{" "}
                  {data.url}
                </>
              );
            }

            const activeClass = selectedId === node.id ? " active" : "";

            return (
              <div
                key={node.id}
                className={`stream-node${activeClass}`}
                data-node-id={node.id}
                data-timestamp={node.timestamp}
                onClick={() => handleNodeClick(node.id, node.timestamp)}
              >
                <span className="stream-node-time">{relTime}</span>
                {badgeHtml}
                <div className="stream-node-content">{contentHtml}</div>
                <button
                  className="stream-clip-btn"
                  data-clip-timestamp={node.timestamp}
                  title={t("clipExportTitle")}
                  onClick={(e) => handleClipClick(e, node.timestamp)}
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
                  >
                    <polygon points="23 7 16 12 23 17 23 7"></polygon>
                    <rect
                      x="1"
                      y="5"
                      width="15"
                      height="14"
                      rx="2"
                      ry="2"
                    ></rect>
                  </svg>
                  <span>{t("clipShortLabel")}</span>
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
});
