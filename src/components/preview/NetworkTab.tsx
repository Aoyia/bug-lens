import { memo } from "preact/compat";
import { useState, useCallback, useRef, useEffect } from "preact/hooks";
import type { NetworkEntry, RecordingSession } from "../../shared/protocol.ts";
import { formatElapsedEpochTime } from "../../domain/evidence-clock.ts";
import { generateCurlCommand } from "../../domain/curl-generator.ts";
import { copyTextToClipboard } from "../../preview/clipboard.ts";
import { escapeHtml, renderCodeBlockHtml } from "../../preview/rendering.ts";
import { useFilteredList } from "../../hooks/useFilteredList.ts";
import { t } from "../../shared/i18n.ts";

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
  const originEpochMs =
    session?.timeline.startedAtEpochMs ?? session?.timeline.createdAtEpochMs;
  const relativeTime =
    originEpochMs == null
      ? undefined
      : formatElapsedEpochTime(entry.createdAt, originEpochMs);
  if (relativeTime) return relativeTime;
  const date = new Date(entry.createdAt);
  return `${date.toLocaleTimeString([], { hour12: false })}.${String(date.getMilliseconds()).padStart(3, "0")}`;
}

function renderNetworkDetailHtml(entry?: NetworkEntry): string {
  if (!entry)
    return `<div class="network-detail-empty">${t("clickToViewDetail")}</div>`;
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

  const reqHeaderBlock = reqHeaderNames.length
    ? `<div class="network-detail-section"><details><summary>${t("requestHeadersCount", String(reqHeaderNames.length))}</summary><div class="network-detail-content"><table class="headers-table">${reqHeaderNames.map((name) => `<tr><td class="header-name">${escapeHtml(name)}:</td><td class="header-value">${escapeHtml(reqHeaders[name])}</td></tr>`).join("")}</table></div></details></div>`
    : "";

  let initiatorBlock = "";
  if (initiator) {
    let initiatorContent = "";
    if (typeof initiator === "string") {
      initiatorContent = escapeHtml(initiator);
    } else if (initiator.concise?.topFrame) {
      const top = initiator.concise.topFrame;
      initiatorContent = t("initiatorContent", [
        escapeHtml(initiator.type || "script"),
        `${escapeHtml(top.url)}:${top.lineNumber}:${top.columnNumber}`,
      ]);
    } else {
      initiatorContent = escapeHtml(JSON.stringify(initiator, null, 2));
    }
    initiatorBlock = `<div class="network-detail-section"><details><summary>${t("initiatorSection")}</summary><div class="network-detail-content"><pre class="code" style="white-space: pre-wrap; font-size: 11px;">${initiatorContent}</pre></div></details></div>`;
  }

  const headerBlock = `
    ${reqHeaderBlock}
    <div class="network-detail-section"><details><summary>${t("responseHeadersCount", String(headerNames.length))}</summary><div class="network-detail-content">
      ${headerNames.length ? `<table class="headers-table">${headerNames.map((name) => `<tr><td class="header-name">${escapeHtml(name)}:</td><td class="header-value">${escapeHtml(headers[name])}</td></tr>`).join("")}</table>` : `<div class="muted">${t("noResponseHeaders")}</div>`}
    </div></details></div>
    ${initiatorBlock}`;

  let body = "";
  if (!response) body = `<div class="muted">${t("noResponseMeta")}</div>`;
  else if (response.bodyStatus === "pending")
    body = `<div class="muted">${t("responseBodyPending")}</div>`;
  else if (response.bodyStatus === "not-present")
    body = `<div class="muted">${t("responseNoBody")}</div>`;
  else if (response.bodyStatus === "redacted")
    body = `<div class="muted">${t("responseBodyRedacted", escapeHtml(response.redactionReason || "policy"))}</div>`;
  else if (response.bodyStatus === "unavailable")
    body = `<div class="muted">${t("responseBodyUnavailable", escapeHtml(response.error || t("browserNotProvided")))}</div>`;
  else if (response.base64Encoded)
    body = `<div class="code-wrapper"><div class="code">${t("binaryResponseSaved", String(response.body?.length ?? 0))}</div></div>`;
  else {
    const source = response.body ?? "";
    const limited =
      source.length > 200_000
        ? `${source.slice(0, 200_000)}\n\n${t("previewTruncated")}`
        : source;
    const isJson = Boolean(
      response.mimeType?.includes("json") || /^[\s]*[\[{]/.test(limited)
    );
    body = limited
      ? renderCodeBlockHtml(limited, isJson)
      : `<div class="code-wrapper"><div class="code">${t("emptyResponseBody")}</div></div>`;
  }

  return `
    <div class="network-detail-view">
      <div class="network-detail-header"><span>${t("requestDetails")}</span><button id="btn-copy-curl" class="btn-copy-curl" title="${t("copyAsCurl")}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg><span class="btn-copy-curl-text">${t("copyCurl")}</span></button></div>
      <div class="network-detail-url"><strong>${escapeHtml((entry.method || "GET").toUpperCase())}</strong> ${escapeHtml(entry.url)}</div>
      ${headerBlock}
      <div class="network-detail-section"><details open><summary>${t("responseBodyHeader", escapeHtml(response?.mimeType || t("unknownMime")))} ${response?.byteLength != null ? `(${response.byteLength} B)` : ""}</summary><div class="network-detail-content">${body}</div></details></div>
    </div>
  `;
}

import {
  filterNetworkEntries,
  selectActiveNetworkId,
} from "../../preview/network-filter.ts";

const networkFilterFn = (entry: NetworkEntry, query: string) =>
  filterNetworkEntries([entry], query).length > 0;

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
  const detailRef = useRef<HTMLDivElement>(null);

  // Auto-select logic
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

  // Copy curl logic
  useEffect(() => {
    if (!detailRef.current || !selectedEntry) return;

    const copyButton =
      detailRef.current.querySelector<HTMLButtonElement>("#btn-copy-curl");
    if (!copyButton) return;

    const handleCopy = () => {
      void copyTextToClipboard(generateCurlCommand(selectedEntry), document)
        .then(() => {
          copyButton.classList.add("copied");
          const label = copyButton.querySelector<HTMLElement>(
            ".btn-copy-curl-text"
          );
          if (label) label.textContent = t("curlCopied");
          onNotify?.(t("curlCopiedNotify"));
          window.setTimeout(() => {
            copyButton.classList.remove("copied");
            if (label) label.textContent = t("copyCurl");
          }, 1800);
        })
        .catch((error) => onNotify?.(t("copyFailed", String(error))));
    };

    copyButton.addEventListener("click", handleCopy);
    return () => {
      copyButton.removeEventListener("click", handleCopy);
    };
  }, [selectedEntry, onNotify]);

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
        />
        <span className="panel-filter-count">{countText}</span>
      </div>
      <div className="network-main-split">
        <div className="network-table-view">
          {entries.length > 0 ? (
            entries
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
                const size = entry.response?.byteLength
                  ? `${(entry.response.byteLength / 1024).toFixed(1)} KB`
                  : entry.response
                    ? "0 B"
                    : "";
                const isSelected = entry.id === activeSelectedId;

                return (
                  <div
                    key={entry.id}
                    className={`network-row ${statusClass} ${isSelected ? "selected" : ""}`}
                    data-network-id={entry.id}
                    onClick={() => handleRowClick(entry.id, entry.createdAt)}
                  >
                    <span
                      className="col-time"
                      title={t(
                        "absoluteTime",
                        new Date(entry.createdAt).toLocaleString()
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
              })
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
          className="network-resizer"
          title={t("resizerTitle")}
        ></div>
        <div
          className="network-detail-panel"
          ref={detailRef}
          dangerouslySetInnerHTML={{
            __html: renderNetworkDetailHtml(selectedEntry),
          }}
        />
      </div>
    </div>
  );
});
