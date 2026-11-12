import { copyTextToClipboard } from "../shared/clipboard.ts";
import { t } from "../shared/i18n.ts";

export type PreviewTab =
  "steps" | "console" | "network" | "issues" | "framework" | "stream";

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
  }

  get activeTab(): PreviewTab {
    return this.tab;
  }

  notify(message: string): void {
    const toast = this.root.querySelector<HTMLElement>("#toast-message")!;
    toast.hidden = false;

    // 清理上一次的隐藏定时器
    if (this.toastTimer !== undefined) {
      window.clearTimeout(this.toastTimer);
      this.toastTimer = undefined;
    }

    // 支持双行渲染 (用换行符 \n 区分主标题与副标题)
    if (message.includes("\n")) {
      const [title, desc] = message.split("\n");
      const iconSvg = `<svg class="toast-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00b42a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
      const safeTitle = (title || "")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      const safeDesc = (desc || "")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/(⌘V|Ctrl\+V)/g, '<kbd class="toast-kbd">$1</kbd>');

      toast.innerHTML = `
        ${iconSvg}
        <div class="toast-content">
          <div class="toast-title">${safeTitle}</div>
          <div class="toast-desc">${safeDesc}</div>
        </div>
      `;
    } else {
      toast.textContent = message;
    }

    const startHideTimer = () => {
      this.toastTimer = window.setTimeout(() => {
        this.toastTimer = undefined;
        toast.hidden = true;
      }, 4000);
    };

    startHideTimer();

    // 绑定悬停暂停计时机制 (只绑定一次)
    if (
      !(toast as unknown as { _hasHoverBound?: boolean })._hasHoverBound &&
      typeof toast.addEventListener === "function"
    ) {
      (toast as unknown as { _hasHoverBound?: boolean })._hasHoverBound = true;
      toast.addEventListener("mouseenter", () => {
        if (this.toastTimer !== undefined) {
          window.clearTimeout(this.toastTimer);
          this.toastTimer = undefined;
        }
      });
      toast.addEventListener("mouseleave", () => {
        if (!toast.hidden && this.toastTimer === undefined) {
          startHideTimer();
        }
      });
    }
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
}
