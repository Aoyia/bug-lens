import { memo } from "preact/compat";
import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
} from "preact/hooks";
import type { NetworkEntry, RecordingSession } from "../../shared/protocol.ts";
import {
  formatEvidenceTime,
  resolveSessionOriginEpochMs,
} from "../../domain/evidence-clock.ts";
import {
  formatBytes,
  formatNetworkEntrySize,
} from "../../domain/byte-format.ts";
import { generateCurlCommand } from "../../domain/curl-generator.ts";
import {
  API_SNIPPET_TARGETS,
  generateApiSnippet,
  type ApiSnippetTarget,
} from "../../domain/api-snippet-generator.ts";
import { copyTextToClipboard } from "../../shared/clipboard.ts";
import { handleFilterEscape } from "../../preview/filter-search.ts";
import { escapeHtml, renderCodeBlockHtml } from "../../preview/rendering.ts";
import { useFilteredList } from "../../hooks/useFilteredList.ts";
import { Select } from "../common/Select.tsx";
import { t, getLocale } from "../../shared/i18n.ts";
import { formatDateTime } from "../../shared/intl-formatter.ts";
import { FrameBadge } from "./FrameBadge.tsx";

export interface NetworkTabProps {
  snapshot: {
    session?: RecordingSession;
    all: NetworkEntry[];
    included: NetworkEntry[];
  };
  editable: boolean;
  onExclude?: (id: string) => Promise<void>;
  onSelectionChanged?: () => void;
  onSeekVideo?: (timestampMs: number) => void;
  onNotify?: (message: string) => void;
}

function networkTime(entry: NetworkEntry, session?: RecordingSession): string {
  return formatEvidenceTime(
    entry.createdAt,
    resolveSessionOriginEpochMs(session),
    { withMillisecondsFallback: true }
  );
}

interface NetworkDetailViewProps {
  entry?: NetworkEntry;
  snippetTarget: ApiSnippetTarget;
  onNotify?: (message: string) => void;
}

const NetworkDetailView = memo(function NetworkDetailView({
  entry,
  snippetTarget,
  onNotify,
}: NetworkDetailViewProps) {
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setCopiedText(null);
    return () => {
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    };
  }, [entry?.id, snippetTarget]);

  const handleCopySnippet = useCallback(() => {
    if (!entry) return;
    const code = generateApiSnippet(entry, snippetTarget);
    const targetOpt = API_SNIPPET_TARGETS.find((t) => t.key === snippetTarget);
    const labelName = targetOpt?.label || "Code";

    void copyTextToClipboard(
      code,
      typeof document !== "undefined" ? document : undefined
    )
      .then(() => {
        setCopiedText(t("snippetCopied", labelName));
        onNotify?.(t("snippetCopiedNotify", labelName));
        if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
        copyTimerRef.current = window.setTimeout(() => {
          setCopiedText(null);
        }, 1800);
      })
      .catch((error) => onNotify?.(t("copyFailed", String(error))));
  }, [entry, snippetTarget, onNotify]);

  if (!entry) {
    return <div className="network-detail-empty">{t("clickToViewDetail")}</div>;
  }

  const response = entry.response;
  const extraDetail =
    typeof window !== "undefined" && window.__BUG_LENS_NETWORK_DETAILS__
      ? window.__BUG_LENS_NETWORK_DETAILS__[entry.id]
      : undefined;
  const headers = extraDetail?.responseHeaders || response?.headers || {};
  const reqHeaders = extraDetail?.requestHeaders || entry.requestHeaders || {};
  const initiator = extraDetail?.initiator || entry.initiator;

  const reqHeaderNames = Object.keys(reqHeaders);
  const headerNames = Object.keys(headers);

  let initiatorText: string | null = null;
  if (initiator) {
    if (typeof initiator === "string") {
      initiatorText = initiator;
    } else if (initiator.concise?.topFrame) {
      const top = initiator.concise.topFrame;
      initiatorText = t("initiatorContent", [
        initiator.type || "script",
        `${top.url}:${top.lineNumber}:${top.columnNumber}`,
      ]);
    } else {
      initiatorText = JSON.stringify(initiator, null, 2);
    }
  }

  const renderResponseBody = () => {
    if (!response) return <div className="muted">{t("noResponseMeta")}</div>;
    if (response.bodyStatus === "pending")
      return <div className="muted">{t("responseBodyPending")}</div>;
    if (response.bodyStatus === "not-present")
      return <div className="muted">{t("responseNoBody")}</div>;
    if (response.bodyStatus === "redacted")
      return (
        <div className="muted">
          {t("responseBodyRedacted", response.redactionReason || "policy")}
        </div>
      );
    if (response.bodyStatus === "unavailable")
      return (
        <div className="muted">
          {t(
            "responseBodyUnavailable",
            response.error || t("browserNotProvided")
          )}
        </div>
      );
    if (response.base64Encoded)
      return (
        <div className="code-wrapper">
          <div className="code">
            {t("binaryResponseSaved", String(response.body?.length ?? 0))}
          </div>
        </div>
      );

    const source = response.body ?? "";
    const limited =
      source.length > 200_000
        ? `${source.slice(0, 200_000)}\n\n${t("previewTruncated")}`
        : source;
    if (!limited) {
      return (
        <div className="code-wrapper">
          <div className="code">{t("emptyResponseBody")}</div>
        </div>
      );
    }
    const isJson = Boolean(
      response.mimeType?.includes("json") || /^[\s]*[\[{]/.test(limited)
    );
    return (
      <div
        dangerouslySetInnerHTML={{
          __html: renderCodeBlockHtml(limited, isJson),
        }}
      />
    );
  };

  return (
    <div className="network-detail-view">
      <div className="network-detail-header">
        <span>{t("requestDetails")}</span>
        <button
          id="btn-copy-curl"
          className={`btn-copy-curl${copiedText ? " copied" : ""}`}
          title={t("copyAsCurl")}
          onClick={handleCopySnippet}
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
            <rect x="9" y="9" width="13" height="13" rx="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
          <span className="btn-copy-curl-text">
            {copiedText ?? t("copyCurl")}
          </span>
        </button>
      </div>
      <div className="network-detail-url">
        <strong>{(entry.method || "GET").toUpperCase()}</strong> {entry.url}
      </div>
      <div className="network-detail-frame">
        <strong>Frame:</strong>{" "}
        {entry.frameId
          ? `Frame [${entry.frameId}]${entry.documentUrl ? ` (${entry.documentUrl})` : ""}`
          : "Top Frame"}
      </div>
      {reqHeaderNames.length > 0 && (
        <div className="network-detail-section">
          <details>
            <summary>
              {t("requestHeadersCount", String(reqHeaderNames.length))}
            </summary>
            <div className="network-detail-content">
              <table className="headers-table">
                <tbody>
                  {reqHeaderNames.map((name) => (
                    <tr key={name}>
                      <td className="header-name">{name}:</td>
                      <td className="header-value">{reqHeaders[name]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}
      <div className="network-detail-section">
        <details>
          <summary>
            {t("responseHeadersCount", String(headerNames.length))}
          </summary>
          <div className="network-detail-content">
            {headerNames.length > 0 ? (
              <table className="headers-table">
                <tbody>
                  {headerNames.map((name) => (
                    <tr key={name}>
                      <td className="header-name">{name}:</td>
                      <td className="header-value">{headers[name]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="muted">{t("noResponseHeaders")}</div>
            )}
          </div>
        </details>
      </div>
      {initiatorText !== null && (
        <div className="network-detail-section">
          <details>
            <summary>{t("initiatorSection")}</summary>
            <div className="network-detail-content">
              <pre
                className="code"
                style={{ whiteSpace: "pre-wrap", fontSize: "11px" }}
              >
                {initiatorText}
              </pre>
            </div>
          </details>
        </div>
      )}
      <div className="network-detail-section">
        <details open>
          <summary>
            {t("responseBodyHeader", response?.mimeType || t("unknownMime"))}{" "}
            {response?.byteLength != null
              ? `(${formatBytes(response.byteLength)})`
              : ""}
          </summary>
          <div className="network-detail-content">{renderResponseBody()}</div>
        </details>
      </div>
    </div>
  );
});

import {
  filterNetworkEntries,
  matchesNetworkEntry,
  selectActiveNetworkId,
} from "../../preview/network-filter.ts";

const networkFilterFn = (entry: NetworkEntry, query: string) =>
  matchesNetworkEntry(entry, query);

export const NetworkTab = memo(function NetworkTab({
  snapshot,
  editable,
  onExclude,
  onSelectionChanged,
  onSeekVideo,
  onNotify,
}: NetworkTabProps) {
  const {
    searchQuery,
    setSearchQuery,
    filtered: entries,
    countText,
  } = useFilteredList(snapshot.included, networkFilterFn);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const [tableHeight, setTableHeight] = useState<number | null>(null);
  const [isDraggingResizer, setIsDraggingResizer] = useState(false);

  const handleResizerMouseDown = useCallback((event: MouseEvent) => {
    const table = tableRef.current;
    const split = splitRef.current;
    if (!table || !split || typeof document === "undefined") return;

    const startY = event.clientY;
    const startHeight = table.getBoundingClientRect().height;
    setIsDraggingResizer(true);
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";

    const dragOverlay = document.createElement("div");
    dragOverlay.style.cssText =
      "position:fixed;inset:0;z-index:9999;cursor:row-resize;";
    document.body.appendChild(dragOverlay);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const nextHeight = Math.max(
        60,
        Math.min(
          split.getBoundingClientRect().height - 80,
          startHeight + moveEvent.clientY - startY
        )
      );
      setTableHeight(nextHeight);
    };

    const handleMouseUp = () => {
      setIsDraggingResizer(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      dragOverlay.remove();
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, []);

  // 自动选中逻辑
  let activeSelectedId = selectedId;
  if (entries.length > 0 && !entries.some((entry) => entry.id === selectedId)) {
    activeSelectedId = entries[entries.length - 1]!.id;
  } else if (entries.length === 0) {
    activeSelectedId = null;
  }

  const handleRowClick = useCallback(
    (id: string, createdAt: number) => {
      setSelectedId(id);
      onSeekVideo?.(createdAt);
    },
    [onSeekVideo]
  );

  const handleExclude = useCallback(
    async (e: MouseEvent, id: string) => {
      e.stopPropagation();
      if (activeSelectedId === id) {
        setSelectedId(null);
      }
      if (onExclude) {
        await onExclude(id);
        onSelectionChanged?.();
      }
    },
    [activeSelectedId, onExclude, onSelectionChanged]
  );

  const selectedEntry = entries.find((entry) => entry.id === activeSelectedId);
  const [snippetTarget, setSnippetTarget] = useState<ApiSnippetTarget>("curl");

  return (
    <div className="integrated-card-panel">
      <div className="integrated-panel-header">
        <input
          id="network-search-input"
          type="text"
          placeholder={t("filterByUrl")}
          className="panel-search-input"
          value={searchQuery}
          onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => handleFilterEscape(e, searchQuery, setSearchQuery)}
        />
        <span className="panel-filter-count">{countText}</span>
      </div>
      <div className="network-main-split" ref={splitRef}>
        <div
          className="network-table-view"
          ref={tableRef}
          style={
            tableHeight != null
              ? { height: `${tableHeight}px`, flex: "none" }
              : undefined
          }
        >
          {entries.length > 0 ? (
            (() => {
              const extraDetails =
                typeof window !== "undefined" &&
                window.__BUG_LENS_NETWORK_DETAILS__
                  ? window.__BUG_LENS_NETWORK_DETAILS__
                  : undefined;

              return entries
                .slice()
                .reverse()
                .map((entry) => {
                  const status = entry.status ?? 0;
                  const statusClass =
                    status >= 400 || entry.error
                      ? "status-error"
                      : status >= 300
                        ? "status-3xx"
                        : "status-2xx";
                  const size = formatNetworkEntrySize(
                    entry,
                    extraDetails?.[entry.id]?.responseHeaders
                  );
                  const isSelected = entry.id === activeSelectedId;

                  return (
                    <div
                      key={entry.id}
                      className={`network-row ${statusClass} ${isSelected ? "selected" : ""}`}
                      data-network-id={entry.id}
                      tabIndex={0}
                      aria-current={isSelected ? "true" : undefined}
                      onClick={() => handleRowClick(entry.id, entry.createdAt)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleRowClick(entry.id, entry.createdAt);
                        }
                      }}
                    >
                      <span
                        className="col-time"
                        title={t(
                          "absoluteTime",
                          formatDateTime(
                            entry.createdAt,
                            undefined,
                            getLocale()
                          )
                        )}
                      >
                        {networkTime(entry, snapshot.session)}
                      </span>
                      <span className={`col-status ${statusClass}`}>
                        {status || (entry.error ? "FAIL" : "...")}
                      </span>
                      <span className="col-method">
                        {(entry.method || "GET").toUpperCase()}
                      </span>
                      <span className="col-url" title={entry.url}>
                        <FrameBadge
                          classNamePrefix="network"
                          frameId={entry.frameId}
                          frameUrl={entry.documentUrl}
                        />
                        {entry.url}
                      </span>
                      <span className="col-size">{size}</span>
                      {editable ? (
                        <span className="col-actions">
                          <button
                            className="item-delete-btn delete"
                            title={t("deleteRequest")}
                            onClick={(e) => handleExclude(e, entry.id)}
                          >
                            <svg
                              width="12"
                              height="12"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                            >
                              <polyline points="3 6 5 6 21 6"></polyline>
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            </svg>
                          </button>
                        </span>
                      ) : null}
                    </div>
                  );
                });
            })()
          ) : (
            <div className="empty">
              {snapshot.all.length
                ? snapshot.included.length
                  ? t("noMatchingNetwork")
                  : editable
                    ? t("allNetworkDeleted")
                    : t("noNetworkRecords")
                : t("noNetworkRecords")}
            </div>
          )}
        </div>
        <div
          id="network-resizer"
          className={`network-resizer${isDraggingResizer ? " dragging" : ""}`}
          title={t("resizerTitle")}
          onMouseDown={handleResizerMouseDown}
        ></div>
        <div
          className="network-detail-container"
          style={{ flex: 1, display: "flex", flexDirection: "column" }}
        >
          {selectedEntry ? (
            <div
              className="api-snippet-toolbar"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                gap: "8px",
                padding: "6px 12px",
                background: "var(--bg-subtle, #f8f9fa)",
                borderBottom: "1px solid var(--border-color, #e9ecef)",
              }}
            >
              <label
                style={{
                  fontSize: "12px",
                  color: "var(--text-muted, #6c757d)",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <span>{t("snippetTargetLabel")}</span>
                <Select<ApiSnippetTarget>
                  id="snippet-target-select"
                  className="snippet-target-select"
                  direction="down"
                  value={snippetTarget}
                  options={API_SNIPPET_TARGETS.map((opt) => ({
                    value: opt.key,
                    label: `${opt.icon} ${opt.label}`,
                  }))}
                  onChange={(val) => setSnippetTarget(val)}
                />
              </label>
            </div>
          ) : null}
          <div className="network-detail-panel" style={{ flex: 1 }}>
            <NetworkDetailView
              entry={selectedEntry}
              snippetTarget={snippetTarget}
              onNotify={onNotify}
            />
          </div>
        </div>
      </div>
    </div>
  );
});
