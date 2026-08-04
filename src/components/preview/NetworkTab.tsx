import { memo } from "preact/compat";
import { useState, useCallback, useRef, useEffect } from "preact/hooks";
import type { NetworkEntry, RecordingSession } from "../../shared/protocol.ts";
import { formatElapsedEpochTime } from "../../domain/evidence-clock.ts";
import { generateCurlCommand } from "../../domain/curl-generator.ts";
import { copyTextToClipboard } from "../../preview/clipboard.ts";
import { escapeHtml, renderCodeBlockHtml } from "../../preview/rendering.ts";
import { useFilteredList } from "../../hooks/useFilteredList.ts";

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
    return '<div class="network-detail-empty">点击上方网络请求查看详情</div>';
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
    ? `<div class="network-detail-section"><details><summary>请求头 (${reqHeaderNames.length})</summary><div class="network-detail-content"><table class="headers-table">${reqHeaderNames.map((name) => `<tr><td class="header-name">${escapeHtml(name)}:</td><td class="header-value">${escapeHtml(reqHeaderNames.length ? reqHeaders[name] : "")}</td></tr>`).join("")}</table></div></details></div>`
    : "";

  let initiatorBlock = "";
  if (initiator) {
    let initiatorContent = "";
    if (typeof initiator === "string") {
      initiatorContent = escapeHtml(initiator);
    } else if (initiator.concise?.topFrame) {
      const top = initiator.concise.topFrame;
      initiatorContent = `类型: ${escapeHtml(initiator.type || "script")}\n触发位置: ${escapeHtml(top.url)}:${top.lineNumber}:${top.columnNumber}`;
    } else {
      initiatorContent = escapeHtml(JSON.stringify(initiator, null, 2));
    }
    initiatorBlock = `<div class="network-detail-section"><details><summary>发起方 / 调用栈 (Initiator)</summary><div class="network-detail-content"><pre class="code" style="white-space: pre-wrap; font-size: 11px;">${initiatorContent}</pre></div></details></div>`;
  }

  const headerBlock = `
    ${reqHeaderBlock}
    <div class="network-detail-section"><details><summary>响应头 (${headerNames.length})</summary><div class="network-detail-content">
      ${headerNames.length ? `<table class="headers-table">${headerNames.map((name) => `<tr><td class="header-name">${escapeHtml(name)}:</td><td class="header-value">${escapeHtml(headers[name])}</td></tr>`).join("")}</table>` : '<div class="muted">无响应头</div>'}
    </div></details></div>
    ${initiatorBlock}`;

  let body = "";
  if (!response) body = '<div class="muted">未收到响应元数据</div>';
  else if (response.bodyStatus === "pending")
    body = '<div class="muted">响应正文正在读取…</div>';
  else if (response.bodyStatus === "not-present")
    body = '<div class="muted">该响应按协议无正文</div>';
  else if (response.bodyStatus === "redacted")
    body = `<div class="muted">响应正文已按隐私策略省略：${escapeHtml(response.redactionReason || "policy")}</div>`;
  else if (response.bodyStatus === "unavailable")
    body = `<div class="muted">响应正文不可用：${escapeHtml(response.error || "浏览器未提供")}</div>`;
  else if (response.base64Encoded)
    body = `<div class="code-wrapper"><div class="code">二进制响应以 Base64 保存于导出数据中。长度：${response.body?.length ?? 0}</div></div>`;
  else {
    const source = response.body ?? "";
    const limited =
      source.length > 200_000
        ? `${source.slice(0, 200_000)}\n\n[预览截断；完整正文保存在 ZIP 中]`
        : source;
    const isJson = Boolean(
      response.mimeType?.includes("json") || /^[\s]*[\[{]/.test(limited)
    );
    body = limited
      ? renderCodeBlockHtml(limited, isJson)
      : '<div class="code-wrapper"><div class="code">[空响应正文]</div></div>';
  }

  return `
    <div class="network-detail-view">
      <div class="network-detail-header"><span>请求详情</span><button id="btn-copy-curl" class="btn-copy-curl" title="复制为 cURL 命令"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg><span class="btn-copy-curl-text">复制 cURL</span></button></div>
      <div class="network-detail-url"><strong>${escapeHtml((entry.method || "GET").toUpperCase())}</strong> ${escapeHtml(entry.url)}</div>
      ${headerBlock}
      <div class="network-detail-section"><details open><summary>响应正文 · ${escapeHtml(response?.mimeType || "未知类型")} ${response?.byteLength != null ? `(${response.byteLength} B)` : ""}</summary><div class="network-detail-content">${body}</div></details></div>
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
          if (label) label.textContent = "已复制 cURL";
          onNotify?.("已复制 cURL 命令到剪贴板");
          window.setTimeout(() => {
            copyButton.classList.remove("copied");
            if (label) label.textContent = "复制 cURL";
          }, 1800);
        })
        .catch((error) => onNotify?.(`复制失败：${String(error)}`));
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
          placeholder="按 URL 过滤"
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
                      title={`绝对时间: ${new Date(entry.createdAt).toLocaleString()}`}
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
                          title="从预览和导出中删除此请求"
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
                  ? "未找到匹配的网络请求"
                  : editable
                    ? "所有 Network 请求均已删除，可从右上角恢复。"
                    : "没有 Network 记录"
                : "没有 Network 记录"}
            </div>
          )}
        </div>
        <div
          id="network-resizer"
          className="network-resizer"
          title="拖拽调整列表与详情区域高度"
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
