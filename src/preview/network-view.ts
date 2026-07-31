import { generateCurlCommand } from "../domain/curl-generator";
import { formatElapsedEpochTime } from "../domain/evidence-clock";
import type { NetworkEntry, RecordingSession } from "../shared/protocol";
import { copyTextToClipboard } from "./clipboard";
import { escapeHtml, renderCodeBlockHtml } from "./rendering";

export type NetworkViewSnapshot = {
  session?: RecordingSession;
  all: NetworkEntry[];
  included: NetworkEntry[];
};

export type NetworkViewActions = {
  exclude?(id: string): Promise<void>;
  restore?(): Promise<void>;
  render(): void;
  selectionChanged(): void;
  notify(message: string): void;
};

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
      ${editable ? `<span class="col-actions"><button class="item-delete-btn delete" data-delete-network="${escapeHtml(entry.id)}" title="从预览和导出中删除此请求"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2 2v2"></path></svg></button></span>` : ""}
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
      <div class="network-detail-header"><span>请求详情</span><button id="btn-copy-curl" class="btn-copy-curl" title="复制为 cURL 命令"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg><span class="btn-copy-curl-text">复制 cURL</span></button></div>
      <div class="network-detail-url"><strong>${escapeHtml((entry.method || "GET").toUpperCase())}</strong> ${escapeHtml(entry.url)}</div>
      ${headerBlock}
      <div class="network-detail-section"><details open><summary>响应正文 · ${escapeHtml(response?.mimeType || "未知类型")} ${response?.byteLength != null ? `(${response.byteLength} B)` : ""}</summary><div class="network-detail-content">${body}</div></details></div>
    </div>
  `;
}

export class NetworkView {
  private searchQuery = "";
  private selectedId: string | null = null;

  constructor(private readonly root: Document, private readonly actions: NetworkViewActions) {
    if (actions.restore) root.querySelector<HTMLButtonElement>("#restore-network")?.addEventListener("click", () => void this.restore());
    root.querySelector<HTMLInputElement>("#network-search-input")?.addEventListener("input", (event) => {
      this.searchQuery = (event.target as HTMLInputElement).value;
      this.actions.render();
    });
  }

  render(snapshot: NetworkViewSnapshot): void {
    const editable = Boolean(this.actions.exclude);
    const query = this.searchQuery.trim().toLowerCase();
    const entries = snapshot.included.filter((entry) => !query || entry.url.toLowerCase().includes(query));
    const count = this.root.querySelector<HTMLElement>("#network-filter-count");
    if (count) count.textContent = this.searchQuery.trim()
      ? `匹配 ${entries.length} / ${snapshot.included.length} 条`
      : `共 ${snapshot.included.length} 条`;

    if (entries.length && !entries.some((entry) => entry.id === this.selectedId)) this.selectedId = entries.at(-1)!.id;
    else if (!entries.length) this.selectedId = null;

    const container = this.root.querySelector<HTMLElement>("#network")!;
    container.innerHTML = entries.length
      ? entries.slice(-200).reverse().map((entry) => renderNetworkRow(entry, snapshot.session, this.selectedId, editable)).join("")
      : `<div class="empty">${snapshot.all.length ? snapshot.included.length ? "未找到匹配的网络请求" : editable ? "所有 Network 请求均已删除，可从右上角恢复。" : "没有 Network 记录" : "没有 Network 记录"}</div>`;

    const selectedEntry = entries.find((entry) => entry.id === this.selectedId);
    this.root.querySelector<HTMLElement>("#network-detail")!.innerHTML = renderNetworkDetail(selectedEntry);
    this.bindRows(snapshot.session, entries);
    this.bindCopy(selectedEntry);
  }

  private bindRows(session?: RecordingSession, entries: NetworkEntry[] = []): void {
    this.root.querySelector("#network")?.querySelectorAll<HTMLElement>("[data-network-id]").forEach((row) => row.addEventListener("click", (event) => {
      if ((event.target as HTMLElement).closest("[data-delete-network]")) return;
      this.selectedId = row.dataset.networkId || null;
      const entry = entries.find((e) => e.id === this.selectedId);
      if (entry) {
        const originEpochMs = session?.timeline.startedAtEpochMs ?? session?.timeline.createdAtEpochMs;
        if (originEpochMs != null) {
          const video = this.root.querySelector<HTMLVideoElement>("#video");
          if (video) {
            video.currentTime = Math.max(0, (entry.createdAt - originEpochMs) / 1000);
          }
        }
      }
      this.actions.render();
    }));
    this.root.querySelector("#network")?.querySelectorAll<HTMLButtonElement>("[data-delete-network]").forEach((button) => button.addEventListener("click", (event) => {
      event.stopPropagation();
      if (this.selectedId === button.dataset.deleteNetwork) this.selectedId = null;
      void this.exclude(button.dataset.deleteNetwork!);
    }));
  }

  private bindCopy(selectedEntry?: NetworkEntry): void {
    const copyButton = this.root.querySelector<HTMLButtonElement>("#btn-copy-curl");
    if (!copyButton || !selectedEntry) return;
    copyButton.addEventListener("click", () => {
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

  private async exclude(id: string): Promise<void> {
    await this.actions.exclude?.(id);
    this.actions.selectionChanged();
    this.actions.render();
  }

  private async restore(): Promise<void> {
    await this.actions.restore?.();
    this.actions.selectionChanged();
    this.actions.render();
  }
}
