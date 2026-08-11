import { copyTextToClipboard } from "./clipboard.ts";
import { t } from "../shared/i18n.ts";

export type PreviewTab = "steps" | "console" | "network" | "issues";

export class PreviewPageShell {
  private tab: PreviewTab = "issues";
  private readonly root: Document;
  private onTabChange?: () => void;
  /** Toast 单例的隐藏定时器句柄：连续通知必须重置计时，否则旧通知的定时器会提前截断新通知。 */
  private toastTimer: number | undefined;

  constructor(root: Document, onTabChange: () => void) {
    this.root = root;
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
    // 先清理上一次的隐藏定时器：Toast 承诺展示 2.5s，连续通知时旧定时器
    // 不得提前截断最新一条（与 PopupApp 错误提示 effect 的清理范式一致）。
    if (this.toastTimer !== undefined) {
      window.clearTimeout(this.toastTimer);
    }
    this.toastTimer = window.setTimeout(() => {
      this.toastTimer = undefined;
      toast.hidden = true;
    }, 2500);
  }

  selectTab(tabName: PreviewTab | string): void {
    const button = this.root.querySelector<HTMLButtonElement>(
      `.zen-tab-btn[data-tab="${tabName}"]`
    );
    if (button) {
      this.switchToTab(button, false);
    }
  }

  private switchToTab(button: HTMLButtonElement, triggerCallback = true): void {
    const buttons = Array.from(
      this.root.querySelectorAll<HTMLButtonElement>(".zen-tab-btn[data-tab]")
    );
    buttons.forEach((item) => {
      item.classList.remove("active");
      item.setAttribute("aria-selected", "false");
    });
    button.classList.add("active");
    button.setAttribute("aria-selected", "true");
    this.tab = (button.dataset.tab as PreviewTab) || "steps";
    this.root.querySelectorAll<HTMLElement>(".zen-tab-pane").forEach((pane) => {
      pane.hidden = pane.id !== `tab-pane-${this.tab}`;
    });
    if (triggerCallback && this.onTabChange) {
      this.onTabChange();
    }
  }

  private bindTabs(onTabChange: () => void): void {
    this.onTabChange = onTabChange;
    const buttons = Array.from(
      this.root.querySelectorAll<HTMLButtonElement>(".zen-tab-btn[data-tab]")
    );

    buttons.forEach((button) => {
      button.addEventListener("click", () => this.switchToTab(button));
    });

    // Left/Right 键键盘导航
    this.root.addEventListener("keydown", (e) => {
      const active = this.root.activeElement as HTMLElement | null;
      if (!active?.classList.contains("zen-tab-btn")) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const idx = buttons.indexOf(active as HTMLButtonElement);
      if (idx === -1) return;
      const next =
        e.key === "ArrowRight"
          ? buttons[(idx + 1) % buttons.length]
          : buttons[(idx - 1 + buttons.length) % buttons.length];
      next?.focus();
      this.switchToTab(next);
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
      if (
        drawer &&
        !drawer.hidden &&
        !drawer.contains(event.target as Node) &&
        !toggle?.contains(event.target as Node)
      ) {
        drawer.hidden = true;
      }
    });
  }

  private bindDelegatedCopyActions(): void {
    this.root.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      const codeButton = target.closest<HTMLButtonElement>(".code-copy-btn");
      if (codeButton) {
        const code =
          codeButton.nextElementSibling ||
          codeButton.parentElement?.querySelector(".code");
        const text = code?.textContent || "";
        if (text)
          void copyTextToClipboard(text, this.root)
            .then(() => {
              const originalHtml = codeButton.innerHTML;
              codeButton.classList.add("copied");
              codeButton.title = t("copiedTitle");
              codeButton.innerHTML =
                '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>';
              window.setTimeout(() => {
                codeButton.classList.remove("copied");
                codeButton.title = t("copyContentTitle");
                codeButton.innerHTML = originalHtml;
              }, 1500);
            })
            .catch((error) => this.notify(t("copyFailed", String(error))));
      }

      const locatorButton =
        target.closest<HTMLButtonElement>(".copy-locator-btn");
      const locator = locatorButton?.dataset.copyLocator;
      if (locatorButton && locator)
        void copyTextToClipboard(locator, this.root)
          .then(() => {
            const originalText = locatorButton.textContent;
            locatorButton.classList.add("copied");
            locatorButton.textContent = t("copiedTitle");
            window.setTimeout(() => {
              locatorButton.classList.remove("copied");
              locatorButton.textContent = originalText;
            }, 1500);
          })
          .catch((error) => this.notify(t("copyFailed", String(error))));
    });
  }

  private bindTooltips(): void {
    const tooltip = this.root.querySelector<HTMLElement>(
      "#zen-popover-tooltip"
    );
    this.root.addEventListener("mouseover", (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-tooltip]"
      );
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
      if (left + tooltipRect.width > window.innerWidth - 8)
        left = window.innerWidth - tooltipRect.width - 8;
      tooltip.style.top = `${Math.max(0, top)}px`;
      tooltip.style.left = `${Math.max(0, left)}px`;
    });
    this.root.addEventListener("mouseout", (event) => {
      if (!(event.target as HTMLElement).closest("[data-tooltip]") || !tooltip)
        return;
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

    // 拖拽激活时的全屏透明蒙层，防止鼠标快速滑过 video/iframe 导致事件丢失
    let dragOverlay: HTMLDivElement | null = null;

    const createOverlay = () => {
      dragOverlay = this.root.createElement("div");
      dragOverlay.style.cssText =
        "position:fixed;inset:0;z-index:9999;cursor:row-resize;";
      this.root.body.appendChild(dragOverlay);
    };

    const removeOverlay = () => {
      dragOverlay?.remove();
      dragOverlay = null;
    };

    resizer.addEventListener("mousedown", (event) => {
      isDragging = true;
      startY = event.clientY;
      startHeight = table.getBoundingClientRect().height;
      resizer.classList.add("dragging");
      this.root.body.style.cursor = "row-resize";
      this.root.body.style.userSelect = "none";
      createOverlay();
    });
    this.root.addEventListener("mousemove", (event) => {
      if (!isDragging) return;
      const height = Math.max(
        60,
        Math.min(
          split.getBoundingClientRect().height - 80,
          startHeight + event.clientY - startY
        )
      );
      table.style.height = `${height}px`;
      table.style.flex = "none";
    });
    this.root.addEventListener("mouseup", () => {
      if (!isDragging) return;
      isDragging = false;
      resizer.classList.remove("dragging");
      this.root.body.style.cursor = "";
      this.root.body.style.userSelect = "";
      removeOverlay();
    });
  }
}
