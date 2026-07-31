import type { ConsoleEntry, RecordingSession } from "../shared/protocol";
import { escapeHtml } from "./rendering";

export type ConsoleViewSnapshot = {
  session?: RecordingSession;
  all: ConsoleEntry[];
  included: ConsoleEntry[];
};

export type ConsoleViewActions = {
  exclude?(id: string): Promise<void>;
  restore?(): Promise<void>;
  render(): void;
  selectionChanged(): void;
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

export class ConsoleView {
  private levelFilter = "all";
  private searchQuery = "";

  constructor(private readonly root: Document, private readonly actions: ConsoleViewActions) {
    if (actions.restore) root.querySelector<HTMLButtonElement>("#restore-console")?.addEventListener("click", () => void this.restore());
    root.querySelector<HTMLSelectElement>("#console-level-filter")?.addEventListener("change", (event) => {
      this.levelFilter = (event.target as HTMLSelectElement).value;
      this.actions.render();
    });
    root.querySelector<HTMLInputElement>("#console-search-input")?.addEventListener("input", (event) => {
      this.searchQuery = (event.target as HTMLInputElement).value;
      this.actions.render();
    });
  }

  render(snapshot: ConsoleViewSnapshot): void {
    const editable = Boolean(this.actions.exclude);
    const entries = snapshot.included.filter((entry) => this.matches(entry));
    const count = this.root.querySelector<HTMLElement>("#console-filter-count");
    if (count) count.textContent = this.levelFilter !== "all" || this.searchQuery.trim()
      ? `匹配 ${entries.length} / ${snapshot.included.length} 条`
      : `共 ${snapshot.included.length} 条`;
    const select = this.root.querySelector<HTMLSelectElement>("#console-level-filter");
    if (select) select.value = this.levelFilter;

    const container = this.root.querySelector<HTMLElement>("#console")!;
    container.innerHTML = entries.length
      ? `<div class="console-view">${entries.slice(-200).reverse().map((entry) => renderConsoleRow(entry, editable)).join("")}</div>`
      : `<div class="empty">${snapshot.included.length ? "未找到匹配的 Console 日志" : snapshot.all.length && editable ? "所有 Console 日志均已删除，可从右上角恢复。" : "没有 Console 记录"}</div>`;
    container.querySelectorAll<HTMLButtonElement>("[data-delete-console]").forEach((button) => button.addEventListener("click", (event) => {
      event.stopPropagation();
      void this.exclude(button.dataset.deleteConsole!);
    }));

    container.querySelectorAll<HTMLElement>(".console-row").forEach((row) => row.addEventListener("click", (event) => {
      if ((event.target as HTMLElement).closest(".delete")) return;
      const entryId = row.dataset.id;
      const entry = entries.find((e) => e.id === entryId);
      if (!entry) return;
      const originEpochMs = snapshot.session?.timeline.startedAtEpochMs ?? snapshot.session?.timeline.createdAtEpochMs;
      if (originEpochMs != null) {
        const video = this.root.querySelector<HTMLVideoElement>("#video");
        if (video) {
          video.currentTime = Math.max(0, (entry.createdAt - originEpochMs) / 1000);
        }
      }
    }));
  }

  private matches(entry: ConsoleEntry): boolean {
    const level = (entry.level || "log").toLowerCase();
    if (this.levelFilter === "error" && level !== "error") return false;
    if (this.levelFilter === "warning" && level !== "warn" && level !== "warning") return false;
    if (this.levelFilter === "info" && level !== "info") return false;
    if (this.levelFilter === "debug" && level !== "debug" && level !== "log") return false;
    if (this.levelFilter !== "all" && !["error", "warning", "info", "debug"].includes(this.levelFilter)) return false;
    const query = this.searchQuery.trim().toLowerCase();
    return !query || [entry.text, entry.source, level].some((value) => (value || "").toLowerCase().includes(query));
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
