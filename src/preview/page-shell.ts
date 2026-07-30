import { copyTextToClipboard } from "./clipboard";

export type PreviewTab = "steps" | "console" | "network";

export class PreviewPageShell {
  private tab: PreviewTab = "steps";

  constructor(private readonly root: Document, onTabChange: () => void) {
    this.bindTabs(onTabChange);
    this.bindAiDrawer();
    this.bindDelegatedCopyActions();
    this.bindTooltips();
    this.bindNetworkResizer();
  }

  get activeTab(): PreviewTab {
    return this.tab;
  }

  notify(message: string): void {
    const toast = this.root.querySelector<HTMLElement>("#toast-message")!;
    toast.textContent = message;
    toast.hidden = false;
    window.setTimeout(() => { toast.hidden = true; }, 2500);
  }

  private bindTabs(onTabChange: () => void): void {
    this.root.querySelectorAll<HTMLButtonElement>(".zen-tab-btn[data-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        this.root.querySelectorAll(".zen-tab-btn").forEach((item) => item.classList.remove("active"));
        button.classList.add("active");
        this.tab = (button.dataset.tab as PreviewTab) || "steps";
        this.root.querySelectorAll<HTMLElement>(".zen-tab-pane").forEach((pane) => {
          pane.hidden = pane.id !== `tab-pane-${this.tab}`;
        });
        onTabChange();
      });
    });
  }

  private bindAiDrawer(): void {
    const toggle = this.root.querySelector<HTMLElement>("#toggle-ai-drawer");
    const drawer = this.root.querySelector<HTMLElement>("#ai-drawer");
    toggle?.addEventListener("click", (event) => {
      event.stopPropagation();
      if (drawer) drawer.hidden = !drawer.hidden;
    });
    this.root.addEventListener("click", (event) => {
      if (drawer && !drawer.hidden && !drawer.contains(event.target as Node) && !toggle?.contains(event.target as Node)) {
        drawer.hidden = true;
      }
    });
  }

  private bindDelegatedCopyActions(): void {
    this.root.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      const codeButton = target.closest<HTMLButtonElement>(".code-copy-btn");
      if (codeButton) {
        const code = codeButton.nextElementSibling || codeButton.parentElement?.querySelector(".code");
        const text = code?.textContent || "";
        if (text) void copyTextToClipboard(text, this.root).then(() => {
          const originalHtml = codeButton.innerHTML;
          codeButton.classList.add("copied");
          codeButton.title = "已复制";
          codeButton.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>';
          window.setTimeout(() => {
            codeButton.classList.remove("copied");
            codeButton.title = "复制内容";
            codeButton.innerHTML = originalHtml;
          }, 1500);
        }).catch((error) => this.notify(`复制失败：${String(error)}`));
      }

      const locatorButton = target.closest<HTMLButtonElement>(".copy-locator-btn");
      const locator = locatorButton?.dataset.copyLocator;
      if (locatorButton && locator) void copyTextToClipboard(locator, this.root).then(() => {
        const originalText = locatorButton.textContent;
        locatorButton.classList.add("copied");
        locatorButton.textContent = "已复制";
        window.setTimeout(() => {
          locatorButton.classList.remove("copied");
          locatorButton.textContent = originalText;
        }, 1500);
      }).catch((error) => this.notify(`复制失败：${String(error)}`));
    });
  }

  private bindTooltips(): void {
    const tooltip = this.root.querySelector<HTMLElement>("#zen-popover-tooltip");
    this.root.addEventListener("mouseover", (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>("[data-tooltip]");
      const text = target?.dataset.tooltip;
      if (!tooltip || !target || !text?.trim()) return;
      tooltip.textContent = text;
      tooltip.hidden = false;
      tooltip.classList.add("visible");
      const rect = target.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      let top = rect.top - tooltipRect.height - 6;
      let left = rect.left + (rect.width - tooltipRect.width) / 2;
      if (top < 8) top = rect.bottom + 6;
      if (left < 8) left = 8;
      if (left + tooltipRect.width > window.innerWidth - 8) left = window.innerWidth - tooltipRect.width - 8;
      tooltip.style.top = `${Math.max(0, top)}px`;
      tooltip.style.left = `${Math.max(0, left)}px`;
    });
    this.root.addEventListener("mouseout", (event) => {
      if (!(event.target as HTMLElement).closest("[data-tooltip]") || !tooltip) return;
      tooltip.classList.remove("visible");
      tooltip.hidden = true;
    });
  }

  private bindNetworkResizer(): void {
    const resizer = this.root.querySelector<HTMLElement>("#network-resizer");
    const table = this.root.querySelector<HTMLElement>("#network");
    const split = this.root.querySelector<HTMLElement>(".network-main-split");
    if (!resizer || !table || !split) return;
    let isDragging = false;
    let startY = 0;
    let startHeight = 0;
    resizer.addEventListener("mousedown", (event) => {
      isDragging = true;
      startY = event.clientY;
      startHeight = table.getBoundingClientRect().height;
      resizer.classList.add("dragging");
      this.root.body.style.cursor = "row-resize";
      this.root.body.style.userSelect = "none";
    });
    this.root.addEventListener("mousemove", (event) => {
      if (!isDragging) return;
      const height = Math.max(60, Math.min(split.getBoundingClientRect().height - 80, startHeight + event.clientY - startY));
      table.style.height = `${height}px`;
      table.style.flex = "none";
    });
    this.root.addEventListener("mouseup", () => {
      if (!isDragging) return;
      isDragging = false;
      resizer.classList.remove("dragging");
      this.root.body.style.cursor = "";
      this.root.body.style.userSelect = "";
    });
  }
}
