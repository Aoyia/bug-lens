import { generateCurlCommand } from "../domain/curl-generator";
import { formatElapsedEpochTime } from "../domain/evidence-clock";
import type { ConsoleEntry, NetworkEntry, RecordingSession } from "../shared/protocol";
import { copyTextToClipboard } from "./clipboard";
import { escapeHtml, renderCodeBlockHtml } from "./rendering";

export type DiagnosticsSnapshot = {
  session?: RecordingSession;
  consoleEntries: ConsoleEntry[];
  includedConsoleEntries: ConsoleEntry[];
  networkEntries: NetworkEntry[];
  includedNetworkEntries: NetworkEntry[];
};

type DiagnosticsActions = {
  getSnapshot(): DiagnosticsSnapshot;
  exclude?(kind: "console" | "network", id: string): Promise<void>;
  restore?(kind: "console" | "network"): Promise<void>;
  selectionChanged?(): void;
  notify(message: string): void;
};

function renderConsoleRow(entry: ConsoleEntry, editable: boolean): string {
  const level = (entry.level || "log").toLowerCase();
  const displayText = (entry.text || "").includes("%c")
    ? (entry.text || "").replace(/%c/g, "").replace(/\s+[a-zA-Z\-]+:\s*[^;]+;/g, "")
    : entry.text || "";
  const icon = level === "error"
    ? '<svg class="console-icon error" viewBox="0 0 16 16" width="12" height="12"><circle cx="8" cy="8" r="7" fill="#d93025"/><path d="M4.5 4.5l7 7m0-7l-7 7" stroke="#fff" stroke-width="1.8"/></svg>'
    : level === "warn" || level === "warning"
      ? '<svg class="console-icon warn" viewBox="0 0 16 16" width="12" height="12"><path d="M8 1.5l6.5 12h-13z" fill="#f39c12"/><text x="8" y="11.5" text-anchor="middle" fill="#fff" font-size="9" font-weight="bold">!</text></svg>'
      : level === "info"
        ? '<svg class="console-icon info" viewBox="0 0 16 16" width="12" height="12"><circle cx="8" cy="8" r="7" fill="#165dff"/><text x="8" y="11.5" text-anchor="middle" fill="#fff" font-size="9" font-weight="bold">i</text></svg>'
        : '<span class="console-icon log-prompt">❯</span>';

  return `
    <div class="console-row console-row-${escapeHtml(level)}" data-id="${escapeHtml(entry.id)}">
      <div class="console-row-left">${icon}<span class="console-level-tag">${escapeHtml(level)}</span><pre class="console-message">${escapeHtml(displayText)}</pre></div>
      <div class="console-row-right">
        <span class="console-time">${escapeHtml(new Date(entry.createdAt).toLocaleTimeString())}</span>
        ${editable ? `<button class="item-delete-btn delete" data-delete-console="${escapeHtml(entry.id)}" title="从预览和导出中删除此日志">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
        </button>` : ""}
      </div>
    </div>
  `;
}

function networkTime(entry: NetworkEntry, session?: RecordingSession): string {
  const originEpochMs = session?.timeline.startedAtEpochMs ?? session?.timeline.createdAtEpochMs;
  const relativeTime = originEpochMs == null ? undefined : formatElapsedEpochTime(entry.createdAt, originEpochMs);
  if (relativeTime) return relativeTime;
  const date = new Date(entry.createdAt);
  return `${date.toLocaleTimeString([], { hour12: false })}.${String(date.getMilliseconds()).padStart(3, "0")}`;
}

function renderNetworkRow(entry: NetworkEntry, session: RecordingSession | undefined, selectedId: string | null, editable: boolean): string {
  const status = entry.status ?? 0;
  const statusClass = status >= 400 || entry.error ? "status-error" : status >= 300 ? "status-3xx" : "status-2xx";
  const size = entry.response?.byteLength ? `${(entry.response.byteLength / 1024).toFixed(1)} KB` : entry.response ? "0 B" : "";
  return `
    <div class="network-row ${statusClass} ${entry.id === selectedId ? "selected" : ""}" data-network-id="${escapeHtml(entry.id)}">
      <span class="col-time" title="绝对时间: ${escapeHtml(new Date(entry.createdAt).toLocaleString())}">${escapeHtml(networkTime(entry, session))}</span>
      <span class="col-status ${statusClass}">${escapeHtml(status || (entry.error ? "FAIL" : "..."))}</span>
      <span class="col-method">${escapeHtml((entry.method || "GET").toUpperCase())}</span>
      <span class="col-url" title="${escapeHtml(entry.url)}">${escapeHtml(entry.url)}</span>
      <span class="col-size">${escapeHtml(size)}</span>
      ${editable ? `<span class="col-actions"><button class="item-delete-btn delete" data-delete-network="${escapeHtml(entry.id)}" title="从预览和导出中删除此请求"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button></span>` : ""}
    </div>
  `;
}

function renderNetworkDetail(entry?: NetworkEntry): string {
  if (!entry) return '<div class="network-detail-empty">点击上方网络请求查看详情</div>';
  const response = entry.response;
  const headers = response?.headers || {};
  const headerNames = Object.keys(headers);
  const headerBlock = `
    <div class="network-detail-section"><details><summary>响应头 (${headerNames.length})</summary><div class="network-detail-content">
      ${headerNames.length ? `<table class="headers-table">${headerNames.map((name) => `<tr><td class="header-name">${escapeHtml(name)}:</td><td class="header-value">${escapeHtml(headers[name])}</td></tr>`).join("")}</table>` : '<div class="muted">无响应头</div>'}
    </div></details></div>`;

  let body = "";
  if (!response) body = '<div class="muted">未收到响应元数据</div>';
  else if (response.bodyStatus === "pending") body = '<div class="muted">响应正文正在读取…</div>';
  else if (response.bodyStatus === "not-present") body = '<div class="muted">该响应按协议无正文</div>';
  else if (response.bodyStatus === "redacted") body = `<div class="muted">响应正文已按隐私策略省略：${escapeHtml(response.redactionReason || "policy")}</div>`;
  else if (response.bodyStatus === "unavailable") body = `<div class="muted">响应正文不可用：${escapeHtml(response.error || "浏览器未提供")}</div>`;
  else if (response.base64Encoded) body = `<div class="code-wrapper"><div class="code">二进制响应以 Base64 保存于导出数据中。长度：${response.body?.length ?? 0}</div></div>`;
  else {
    const source = response.body ?? "";
    const limited = source.length > 200_000 ? `${source.slice(0, 200_000)}\n\n[预览截断；完整正文保存在 ZIP 中]` : source;
    const isJson = Boolean(response.mimeType?.includes("json") || /^[\s]*[\[{]/.test(limited));
    body = limited ? renderCodeBlockHtml(limited, isJson) : '<div class="code-wrapper"><div class="code">[空响应正文]</div></div>';
  }

  return `
    <div class="network-detail-view">
      <div class="network-detail-header"><span>请求详情</span><button id="btn-copy-curl" class="btn-copy-curl" title="复制为 cURL 命令"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg><span class="btn-copy-curl-text">复制 cURL</span></button></div>
      <div class="network-detail-url"><strong>${escapeHtml((entry.method || "GET").toUpperCase())}</strong> ${escapeHtml(entry.url)}</div>
      ${headerBlock}
      <div class="network-detail-section"><details open><summary>响应正文 · ${escapeHtml(response?.mimeType || "未知类型")} ${response?.byteLength != null ? `(${response.byteLength} B)` : ""}</summary><div class="network-detail-content">${body}</div></details></div>
    </div>
  `;
}

export class DiagnosticsView {
  private consoleLevelFilter = "all";
  private consoleSearchQuery = "";
  private networkSearchQuery = "";
  private selectedNetworkId: string | null = null;

  constructor(private readonly root: Document, private readonly actions: DiagnosticsActions) {
    if (actions.restore) {
      root.querySelector<HTMLButtonElement>("#restore-console")?.addEventListener("click", () => void this.restore("console"));
      root.querySelector<HTMLButtonElement>("#restore-network")?.addEventListener("click", () => void this.restore("network"));
    }
    root.querySelector<HTMLSelectElement>("#console-level-filter")?.addEventListener("change", (event) => {
      this.consoleLevelFilter = (event.target as HTMLSelectElement).value;
      this.render();
    });
    root.querySelector<HTMLInputElement>("#console-search-input")?.addEventListener("input", (event) => {
      this.consoleSearchQuery = (event.target as HTMLInputElement).value;
      this.render();
    });
    root.querySelector<HTMLInputElement>("#network-search-input")?.addEventListener("input", (event) => {
      this.networkSearchQuery = (event.target as HTMLInputElement).value;
      this.render();
    });
  }

  render(): void {
    const snapshot = this.actions.getSnapshot();
    const editable = Boolean(this.actions.exclude);
    const filteredConsole = snapshot.includedConsoleEntries.filter((entry) => this.matchesConsole(entry));
    const query = this.networkSearchQuery.trim().toLowerCase();
    const filteredNetwork = snapshot.includedNetworkEntries.filter((entry) => !query || entry.url.toLowerCase().includes(query));
    this.renderCounts(snapshot, filteredConsole, filteredNetwork);

    const consoleContainer = this.root.querySelector<HTMLElement>("#console")!;
    consoleContainer.innerHTML = filteredConsole.length
      ? `<div class="console-view">${filteredConsole.slice(-200).reverse().map((entry) => renderConsoleRow(entry, editable)).join("")}</div>`
      : `<div class="empty">${snapshot.includedConsoleEntries.length ? "未找到匹配的 Console 日志" : snapshot.consoleEntries.length && editable ? "所有 Console 日志均已删除，可从右上角恢复。" : "没有 Console 记录"}</div>`;

    if (filteredNetwork.length && !filteredNetwork.some((entry) => entry.id === this.selectedNetworkId)) {
      this.selectedNetworkId = filteredNetwork.at(-1)!.id;
    } else if (!filteredNetwork.length) {
      this.selectedNetworkId = null;
    }
    const networkContainer = this.root.querySelector<HTMLElement>("#network")!;
    networkContainer.innerHTML = filteredNetwork.length
      ? filteredNetwork.slice(-200).reverse().map((entry) => renderNetworkRow(entry, snapshot.session, this.selectedNetworkId, editable)).join("")
      : `<div class="empty">${snapshot.networkEntries.length ? snapshot.includedNetworkEntries.length ? "未找到匹配的网络请求" : editable ? "所有 Network 请求均已删除，可从右上角恢复。" : "没有 Network 记录" : "没有 Network 记录"}</div>`;

    const selectedEntry = filteredNetwork.find((entry) => entry.id === this.selectedNetworkId);
    this.root.querySelector<HTMLElement>("#network-detail")!.innerHTML = renderNetworkDetail(selectedEntry);
    this.bindRenderedActions(selectedEntry);
  }

  private matchesConsole(entry: ConsoleEntry): boolean {
    const level = (entry.level || "log").toLowerCase();
    if (this.consoleLevelFilter === "error" && level !== "error") return false;
    if (this.consoleLevelFilter === "warning" && level !== "warn" && level !== "warning") return false;
    if (this.consoleLevelFilter === "info" && level !== "info") return false;
    if (this.consoleLevelFilter === "debug" && level !== "debug" && level !== "log") return false;
    if (this.consoleLevelFilter !== "all" && !["error", "warning", "info", "debug"].includes(this.consoleLevelFilter)) return false;
    const query = this.consoleSearchQuery.trim().toLowerCase();
    return !query || [entry.text, entry.source, level].some((value) => (value || "").toLowerCase().includes(query));
  }

  private renderCounts(snapshot: DiagnosticsSnapshot, consoleEntries: ConsoleEntry[], networkEntries: NetworkEntry[]): void {
    const consoleCount = this.root.querySelector<HTMLElement>("#console-filter-count");
    if (consoleCount) consoleCount.textContent = this.consoleLevelFilter !== "all" || this.consoleSearchQuery.trim()
      ? `匹配 ${consoleEntries.length} / ${snapshot.includedConsoleEntries.length} 条`
      : `共 ${snapshot.includedConsoleEntries.length} 条`;
    const networkCount = this.root.querySelector<HTMLElement>("#network-filter-count");
    if (networkCount) networkCount.textContent = this.networkSearchQuery.trim()
      ? `匹配 ${networkEntries.length} / ${snapshot.includedNetworkEntries.length} 条`
      : `共 ${snapshot.includedNetworkEntries.length} 条`;
    const select = this.root.querySelector<HTMLSelectElement>("#console-level-filter");
    if (select) select.value = this.consoleLevelFilter;
  }

  private bindRenderedActions(selectedEntry?: NetworkEntry): void {
    this.root.querySelector("#console")?.querySelectorAll<HTMLButtonElement>("[data-delete-console]").forEach((button) => button.addEventListener("click", () => {
      void this.exclude("console", button.dataset.deleteConsole!);
    }));
    this.root.querySelector("#network")?.querySelectorAll<HTMLElement>("[data-network-id]").forEach((row) => row.addEventListener("click", (event) => {
      if ((event.target as HTMLElement).closest("[data-delete-network]")) return;
      this.selectedNetworkId = row.dataset.networkId || null;
      this.render();
    }));
    this.root.querySelector("#network")?.querySelectorAll<HTMLButtonElement>("[data-delete-network]").forEach((button) => button.addEventListener("click", (event) => {
      event.stopPropagation();
      if (this.selectedNetworkId === button.dataset.deleteNetwork) this.selectedNetworkId = null;
      void this.exclude("network", button.dataset.deleteNetwork!);
    }));
    const copyButton = this.root.querySelector<HTMLButtonElement>("#btn-copy-curl");
    if (copyButton && selectedEntry) copyButton.addEventListener("click", () => {
      void copyTextToClipboard(generateCurlCommand(selectedEntry), this.root).then(() => {
        copyButton.classList.add("copied");
        const label = copyButton.querySelector<HTMLElement>(".btn-copy-curl-text");
        if (label) label.textContent = "已复制 cURL";
        this.actions.notify("已复制 cURL 命令到剪贴板");
        window.setTimeout(() => {
          copyButton.classList.remove("copied");
          if (label) label.textContent = "复制 cURL";
        }, 1800);
      }).catch((error) => this.actions.notify(`复制失败：${String(error)}`));
    });
  }

  private async exclude(kind: "console" | "network", id: string): Promise<void> {
    await this.actions.exclude?.(kind, id);
    this.actions.selectionChanged?.();
    this.render();
  }

  private async restore(kind: "console" | "network"): Promise<void> {
    await this.actions.restore?.(kind);
    this.actions.selectionChanged?.();
    this.render();
  }
}
