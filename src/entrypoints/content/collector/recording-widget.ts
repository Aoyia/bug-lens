import { t } from "../../../shared/i18n.ts";
import { escapeHtml } from "../../../shared/html-escape.ts";
import { getEpochTimestampMs } from "../../../export/export-trace.ts";
import { formatRecordingTimer } from "../../../domain/evidence-clock.ts";
import {
  animateToastIn,
  animateToastOutAndRemove,
  buildToastInnerHtml,
  FLOATING_TOAST_BASE_CSS,
} from "../../../shared/ui/toast";
import {
  MOBILE_EMULATION_ATTR,
  isMobileEmulationViewport,
  syncMobileEmulationAttribute,
  observeMobileEmulationMode,
  clampPositionToViewport,
  getViewportMetrics,
  type ViewportMetrics,
} from "../../../shared/ui/mobile-emulation-mode.ts";

export type WidgetClickInfo = {
  clickTimestamp?: number;
  clickEpochMs?: number;
  exportMode?: "ai" | "ticket";
};

export type WidgetCallbacks = {
  onStop(info?: WidgetClickInfo): void;
  /** 点击"标记问题"时触发；anchor 为鼠标点击坐标（用于速记卡就近定位）。 */
  onMarkIssue(anchor?: { x: number; y: number }): void;
  /** 二次确认后触发放弃并删除本次录制。 */
  onDiscard?(): void;
  isPaused?(): boolean;
  getStartedAtEpochMs(): number;
  isIdlePaused(): boolean;
  getPausedDurationMs?(): number;
  getSessionId?(): string | undefined;
  isMac?: boolean;
};

export type WidgetOptions = {
  isMac?: boolean;
};

type ToastTone = "success" | "error";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export class RecordingWidget {
  private container: HTMLDivElement | undefined;
  private timerInterval: number | undefined;
  private autoCollapseTimer: number | undefined;
  private isDragging = false;
  private isHovering = false;
  private isManuallyCollapsed = false;
  private isBubbleShowing = false;
  private bubbleElement?: HTMLElement;
  private bubbleTimer?: number;
  private cleanupCollapseListeners?: () => void;
  private cleanupDragListeners?: () => void;
  private cleanupDragHandleListener?: () => void;
  private cleanupResizeListeners?: () => void;
  private _isSaving = false;
  private _isClosing = false;
  private isConfirmingDiscard = false;
  private discardConfirmTimer: number | undefined;
  private closeTimer?: number;
  private closePromise?: Promise<void>;
  private closeResolve?: () => void;
  private readonly callbacks: WidgetCallbacks;
  private isMac: boolean;
  shortcutKeyText!: string;
  stopShortcutKeyText!: string;

  // 移动仿真态属性与状态
  private isMobileMode = false;
  private isSuppressedForSubflow = false;
  private mobileEdge: "left" | "right" = "right";
  private mobileYRatio = 0.62;
  private mobileMenuElement?: HTMLElement;
  private mobileMenuBackdrop?: HTMLElement;
  private mobileIdleTimer?: number;
  private cleanupMobileModeObserver?: () => void;
  private cleanupEscListener?: () => void;
  private cleanupMobilePointerListeners?: () => void;
  private currentHealthMessage?: string;
  private isSelectingIssue = false;

  get isSaving(): boolean {
    return this._isSaving;
  }

  get isClosing(): boolean {
    return this._isClosing;
  }

  constructor(callbacks: WidgetCallbacks, options?: WidgetOptions) {
    this.callbacks = callbacks;
    const explicitIsMac = options?.isMac ?? callbacks.isMac;
    this.isMac =
      explicitIsMac !== undefined
        ? Boolean(explicitIsMac)
        : typeof navigator !== "undefined" &&
          Boolean(
            /(Mac|iPhone|iPod|iPad)/i.test(
              navigator.platform || navigator.userAgent
            )
          );
    this.syncShortcutTexts();
  }

  private syncShortcutTexts(): void {
    this.shortcutKeyText = this.isMac ? "⌥S" : "Alt+S";
    this.stopShortcutKeyText = this.isMac ? "⇧⌘Y" : "Ctrl+Shift+Y";
  }

  setIsMac(isMac: boolean): void {
    this.isMac = Boolean(isMac);
    this.syncShortcutTexts();
    this.updateLanguage();
  }

  private isCoarseOrNoHoverPointer(): boolean {
    try {
      return (
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        Boolean(window.matchMedia("(hover: none), (pointer: coarse)")?.matches)
      );
    } catch {
      return false;
    }
  }

  /**
   * 子流程互斥隐身（仅在移动仿真态生效）。
   * 进入 SelectionOverlay、ExpectedCaptureCard、IssueEditor 或区域截图时成对调用。
   */
  setSuppressedForSubflow(suppressed: boolean): void {
    this.isSuppressedForSubflow = Boolean(suppressed);
    if (!this.container) return;
    if (this.isSuppressedForSubflow) {
      if (this.isMobileMode) {
        this.closeMobileMenu();
        this.container.setAttribute("data-wbr-suppressed", "true");
        if (this.bubbleElement) {
          this.bubbleElement.style.setProperty("display", "none", "important");
        }
      }
    } else {
      this.container.removeAttribute?.("data-wbr-suppressed");
      if (this.bubbleElement) {
        this.bubbleElement.style?.removeProperty?.("display");
        this.syncBubblePosition(this.container);
      }
    }
  }

  /**
   * 新录制会话开始时调用：清除已保存的拖拽位置，挂件回到默认位置。
   * 与 restoreSavedPosition 配合：同一会话内重挂载（标记问题后返回/页面刷新）保留用户拖拽的位置，
   * 仅真正开始新会话时重置，避免挂件反复跳回默认位置遮挡页面内容。
   */
  resetPosition(): void {
    try {
      this.mobileEdge = "right";
      this.mobileYRatio = 0.62;
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.removeItem("__wbr_widget_pos__");
      }
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        void chrome.storage.local
          .remove("__wbr_widget_pos__")
          .catch(() => undefined);
      }
    } catch {}
  }

  /**
   * PC 端：应用位置并做视口边界钳制（right/top 定位）。
   */
  private applyPosition(
    root: HTMLElement,
    saved: {
      sessionId?: string;
      right?: string;
      top?: string;
      edge?: string;
      yRatio?: number;
    }
  ): boolean {
    if (this.isMobileMode) return false;
    if (saved?.edge !== undefined || saved?.yRatio !== undefined) return false;
    const currentSessionId = this.callbacks.getSessionId?.();
    if (
      saved.sessionId &&
      currentSessionId &&
      saved.sessionId !== currentSessionId
    ) {
      return false;
    }
    const rightPx = Number.parseFloat(saved?.right ?? "");
    const topPx = Number.parseFloat(saved?.top ?? "");
    if (!Number.isFinite(rightPx) || !Number.isFinite(topPx)) return false;

    const winWidth =
      window.innerWidth || document.documentElement?.clientWidth || 1024;
    const winHeight =
      window.innerHeight || document.documentElement?.clientHeight || 768;
    const rect = root.getBoundingClientRect();
    const maxRight = Math.max(0, winWidth - rect.width);
    const maxTop = Math.max(0, winHeight - rect.height);
    const right = Math.min(Math.max(0, rightPx), maxRight);
    const top = Math.min(Math.max(0, topPx), maxTop);

    root.style.setProperty("top", `${top}px`, "important");
    root.style.setProperty("right", `${right}px`, "important");
    root.style.setProperty("bottom", "auto", "important");
    root.style.setProperty("left", "auto", "important");
    return true;
  }

  /**
   * PC 端：恢复本会话内已保存的拖拽位置（right/top 定位）。
   */
  private restoreSavedPosition(root: HTMLElement): void {
    if (this.isMobileMode) return;
    try {
      let restored = false;
      if (typeof sessionStorage !== "undefined") {
        const raw = sessionStorage.getItem("__wbr_widget_pos__");
        if (raw) {
          const saved = JSON.parse(raw) as {
            sessionId?: string;
            right?: string;
            top?: string;
            edge?: "left" | "right";
            yRatio?: number;
          };
          if (saved && !saved.edge && saved.yRatio === undefined) {
            restored = this.applyPosition(root, saved);
          }
        }
      }
      if (!restored && typeof chrome !== "undefined" && chrome.storage?.local) {
        void chrome.storage.local
          .get(["__wbr_widget_pos__"])
          .then((res) => {
            if (
              res?.__wbr_widget_pos__ &&
              this.container === root &&
              !this.isMobileMode
            ) {
              const saved = res.__wbr_widget_pos__ as {
                sessionId?: string;
                right?: string;
                top?: string;
                edge?: "left" | "right";
                yRatio?: number;
              };
              if (saved && !saved.edge && saved.yRatio === undefined) {
                this.applyPosition(root, saved);
              }
            }
          })
          .catch(() => undefined);
      }
    } catch {
      // 存储不可用或数据损坏时静默回退默认位置
    }
  }

  /**
   * 移动仿真态：停靠胶囊吸附位置计算与应用（避开顶部 56px 与底部 76px 保护区）。
   */
  private applyMobilePillPosition(root: HTMLElement): void {
    const metrics = getViewportMetrics(window);
    const h = root.offsetHeight || 32;
    const top = Math.round(this.mobileYRatio * metrics.height);
    const minTop = 56;
    const maxTop = Math.max(minTop, metrics.height - 76 - h);
    const clampedTop = Math.min(Math.max(minTop, top), maxTop);

    root.setAttribute("data-wbr-edge", this.mobileEdge);
    root.style.setProperty("top", `${clampedTop}px`, "important");
    root.style.setProperty("bottom", "auto", "important");
    if (this.mobileEdge === "right") {
      root.style.setProperty("right", "0px", "important");
      root.style.setProperty("left", "auto", "important");
    } else {
      root.style.setProperty("left", "0px", "important");
      root.style.setProperty("right", "auto", "important");
    }

    const arrowEl = root.querySelector(".__wbr_mobile_arrow__");
    if (arrowEl) {
      arrowEl.textContent = this.mobileEdge === "right" ? "‹" : "›";
    }
  }

  /**
   * 移动仿真态：恢复会话内保存的贴边状态 { edge, yRatio }。
   */
  private restoreMobileSavedPosition(root: HTMLElement): void {
    try {
      let restored = false;
      if (typeof sessionStorage !== "undefined") {
        const raw = sessionStorage.getItem("__wbr_widget_pos__");
        if (raw) {
          const saved = JSON.parse(raw) as {
            sessionId?: string;
            edge?: "left" | "right";
            yRatio?: number;
            top?: string;
          };
          const currentSessionId = this.callbacks.getSessionId?.();
          if (
            !saved.sessionId ||
            !currentSessionId ||
            saved.sessionId === currentSessionId
          ) {
            if (saved.edge === "left" || saved.edge === "right") {
              this.mobileEdge = saved.edge;
            }
            if (
              typeof saved.yRatio === "number" &&
              Number.isFinite(saved.yRatio)
            ) {
              this.mobileYRatio = Math.min(Math.max(0.08, saved.yRatio), 0.92);
            } else if (saved.top) {
              const topPx = Number.parseFloat(saved.top);
              const vh = window.innerHeight || 768;
              if (Number.isFinite(topPx) && vh > 0) {
                this.mobileYRatio = Math.min(Math.max(0.08, topPx / vh), 0.92);
              }
            }
            restored = true;
          }
        }
      }
      if (!restored && typeof chrome !== "undefined" && chrome.storage?.local) {
        void chrome.storage.local
          .get(["__wbr_widget_pos__"])
          .then((res) => {
            if (
              res?.__wbr_widget_pos__ &&
              this.container === root &&
              this.isMobileMode
            ) {
              const saved = res.__wbr_widget_pos__ as
                | {
                    sessionId?: string;
                    edge?: "left" | "right";
                    yRatio?: number;
                    top?: string;
                  }
                | undefined;
              if (!saved) return;
              const currentSessionId = this.callbacks.getSessionId?.();
              if (
                !saved.sessionId ||
                !currentSessionId ||
                saved.sessionId === currentSessionId
              ) {
                if (saved.edge === "left" || saved.edge === "right") {
                  this.mobileEdge = saved.edge;
                }
                if (
                  typeof saved.yRatio === "number" &&
                  Number.isFinite(saved.yRatio)
                ) {
                  this.mobileYRatio = Math.min(
                    Math.max(0.08, saved.yRatio),
                    0.92
                  );
                }
                this.applyMobilePillPosition(root);
              }
            }
          })
          .catch(() => undefined);
      }
    } catch {}
  }

  private getMobileDockIcon(edge: "left" | "right"): string {
    if (edge === "right") {
      return `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;pointer-events:none;"><path d="M2 3v10M14 8H6M9 5l-3 3 3 3"/></svg>`;
    }
    return `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;pointer-events:none;"><path d="M14 3v10M2 8h8M7 5l3 3-3 3"/></svg>`;
  }

  /**
   * 移动仿真态：更新贴边方向与 Y 比例并持久化。
   */
  private setMobileEdgeAndY(edge: "left" | "right", yRatio: number): void {
    this.mobileEdge = edge;
    this.mobileYRatio = Math.min(Math.max(0.08, yRatio), 0.92);
    if (this.container) {
      this.applyMobilePillPosition(this.container);
    }
    try {
      const currentSessionId = this.callbacks.getSessionId?.();
      const savedPos = {
        sessionId: currentSessionId,
        edge: this.mobileEdge,
        yRatio: this.mobileYRatio,
      };
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.setItem("__wbr_widget_pos__", JSON.stringify(savedPos));
      }
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        void chrome.storage.local
          .set({ __wbr_widget_pos__: savedPos })
          .catch(() => undefined);
      }
    } catch {}

    const dockBtn = this.mobileMenuElement?.querySelector<HTMLButtonElement>(
      "#__wbr_mobile_dock_btn__"
    );
    if (dockBtn) {
      const nextDockText =
        this.mobileEdge === "right"
          ? t("widgetDockLeft")
          : t("widgetDockRight");
      dockBtn.title = nextDockText;
      dockBtn.setAttribute("aria-label", nextDockText);
      dockBtn.innerHTML = `${this.getMobileDockIcon(this.mobileEdge)}<span class="__wbr_dock_text__" style="display:none !important;">${nextDockText}</span>`;
    }
    this.repositionMobileMenu();
  }

  private handleModeChange(isMobile: boolean, metrics: ViewportMetrics): void {
    if (!this.container) return;
    if (isMobile) {
      if (this.autoCollapseTimer) {
        window.clearTimeout(this.autoCollapseTimer);
        this.autoCollapseTimer = undefined;
      }
      this.container.classList.remove("__wbr_collapsed__");
      if (this.isSuppressedForSubflow) {
        this.container.setAttribute("data-wbr-suppressed", "true");
      }
      this.restoreMobileSavedPosition(this.container);
      this.applyMobilePillPosition(this.container);
      this.resetMobileIdleTimer();
      this.syncBubblePosition(this.container);
    } else {
      this.closeMobileMenu();
      this.container.removeAttribute?.("data-wbr-suppressed");
      this.container.removeAttribute?.("data-wbr-edge");
      this.container.classList.remove("__wbr_idle_dim__");
      if (this.mobileIdleTimer) {
        window.clearTimeout(this.mobileIdleTimer);
        this.mobileIdleTimer = undefined;
      }
      // 切换回 PC 桌面端：先彻底清除移动仿真态写入的 inline 坐标样式，恢复默认 CSS 定位（bottom: 24px; right: 24px;）
      this.container.style?.removeProperty?.("top");
      this.container.style?.removeProperty?.("bottom");
      this.container.style?.removeProperty?.("left");
      this.container.style?.removeProperty?.("right");

      this.restoreSavedPosition(this.container);
      this.resetCollapseTimer();
      this.syncBubblePosition(this.container);
    }
  }

  private handleViewportResize(metrics: ViewportMetrics): void {
    if (!this.container || this._isClosing) return;
    if (this.isMobileMode) {
      if (!this.isDragging) {
        this.applyMobilePillPosition(this.container);
      }
      this.repositionMobileMenu();
      this.syncBubblePosition(this.container);
    } else {
      this.applyPosition(this.container, {
        right: this.container.style.right,
        top: this.container.style.top,
      });
      this.syncBubblePosition(this.container);
    }
  }

  private resetMobileIdleTimer(): void {
    if (this.mobileIdleTimer) {
      window.clearTimeout(this.mobileIdleTimer);
      this.mobileIdleTimer = undefined;
    }
    if (!this.container || !this.isMobileMode) return;
    this.container.classList.remove("__wbr_idle_dim__");
    if (!this.mobileMenuElement && !this._isSaving && !this.isDragging) {
      this.mobileIdleTimer = window.setTimeout(() => {
        if (
          this.container &&
          this.isMobileMode &&
          !this.mobileMenuElement &&
          !this._isSaving &&
          !this.isDragging
        ) {
          this.container.classList.add("__wbr_idle_dim__");
        }
      }, 3000);
    }
  }

  private toggleMobileMenu(): void {
    if (this.mobileMenuElement) {
      this.closeMobileMenu();
    } else {
      this.openMobileMenu();
    }
  }

  private openMobileMenu(): void {
    if (
      this._isSaving ||
      this._isClosing ||
      !this.container ||
      !this.isMobileMode ||
      !document.body
    ) {
      return;
    }
    if (this.mobileMenuElement) return;

    this.resetMobileIdleTimer();
    this.resetDiscardConfirm();

    // 1. 创建透明点击外部拦截层实现 Light Dismiss
    const backdrop = document.createElement("div");
    backdrop.id = "__wbr_mobile_menu_backdrop__";
    backdrop.setAttribute("data-wbr-ignore", "true");
    backdrop.style.cssText =
      "position: fixed !important; inset: 0 !important; z-index: 2147483646 !important; background: transparent !important;";
    backdrop.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.closeMobileMenu();
    });
    document.body.appendChild(backdrop);
    this.mobileMenuBackdrop = backdrop;

    // 2. 创建紧凑操作菜单主体（瘦身方案 A：152~160 × 132~138px）
    const menu = document.createElement("div");
    menu.id = "__wbr_mobile_menu__";
    menu.className = "__wbr_mobile_menu__";
    menu.setAttribute("data-wbr-ignore", "true");

    const dockText =
      this.mobileEdge === "right" ? t("widgetDockLeft") : t("widgetDockRight");
    const healthMsg = this.currentHealthMessage;
    const escapedHealthMsg = healthMsg ? escapeHtml(healthMsg) : "";

    menu.innerHTML = `
      <div class="__wbr_mobile_menu_header__" style="display: flex !important; align-items: center !important; justify-content: space-between !important; height: 22px !important; min-height: 22px !important; padding: 0 2px 4px 2px !important; border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important; margin-bottom: 4px !important; font-size: 11px !important;">
        <div style="display: flex !important; align-items: center !important; gap: 5px !important;">
          <span class="__wbr_dot" style="width: 6px !important; height: 6px !important; border-radius: 50% !important; background: #f53f3f !important; display: inline-block !important; animation: wbr-pulse 1.5s infinite !important; flex-shrink: 0 !important;"></span>
          <span style="font-weight: 600 !important; letter-spacing: 0.5px !important; color: #fff !important; font-size: 11px !important; line-height: 1 !important;">REC</span>
          <span id="__wbr_mobile_menu_timer__" style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important; font-weight: 600 !important; color: #e5e6eb !important; font-size: 11px !important; line-height: 1 !important;">${this.getFormattedTimerText()}</span>
        </div>
        <div style="display: flex !important; align-items: center !important; gap: 4px !important;">
          <button id="__wbr_mobile_dock_btn__" type="button" title="${dockText}" aria-label="${dockText}" style="border: none !important; background: rgba(255, 255, 255, 0.1) !important; color: rgba(255, 255, 255, 0.9) !important; width: 20px !important; height: 20px !important; min-width: 20px !important; padding: 0 !important; border-radius: 4px !important; cursor: pointer !important; display: inline-flex !important; align-items: center !important; justify-content: center !important; line-height: 1 !important;">
            ${this.getMobileDockIcon(this.mobileEdge)}
            <span class="__wbr_dock_text__" style="display: none !important;">${dockText}</span>
          </button>
          <button id="__wbr_mobile_close_btn__" type="button" title="${t("widgetCloseMenu")}" aria-label="${t("widgetCloseMenu")}" style="border: none !important; background: transparent !important; color: rgba(255, 255, 255, 0.6) !important; width: 20px !important; height: 20px !important; min-width: 20px !important; font-size: 13px !important; line-height: 1 !important; cursor: pointer !important; padding: 0 !important; display: inline-flex !important; align-items: center !important; justify-content: center !important;">
            ✕
          </button>
        </div>
      </div>
      <div id="__wbr_mobile_health_msg__" style="padding: 3px 6px !important; margin-bottom: 3px !important; font-size: 10px !important; color: #ffc107 !important; background: rgba(255, 193, 7, 0.12) !important; border-radius: 4px !important; white-space: nowrap !important; overflow: hidden !important; text-overflow: ellipsis !important; display: ${healthMsg ? "block" : "none"} !important;" title="${escapedHealthMsg}">
        ⚠️ ${escapedHealthMsg}
      </div>
      <div class="__wbr_mobile_menu_actions__">
        <button id="__wbr_mobile_issue_btn__" type="button" class="__wbr_mobile_action_btn__">
          <span style="display: flex !important; align-items: center !important; gap: 6px !important;">
            <span style="width: 6px !important; height: 6px !important; border-radius: 50% !important; background: #f53f3f !important; display: inline-block !important; flex-shrink: 0 !important;"></span>
            <span class="__wbr_mobile_issue_label__">${this.isSelectingIssue ? t("selecting") : t("markIssue")}</span>
          </span>
          <span class="__wbr_mobile_issue_shortcut__" style="font-size: 10px !important; color: rgba(255, 255, 255, 0.5) !important; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;">${this.shortcutKeyText}</span>
        </button>
        <button id="__wbr_mobile_ticket_btn__" type="button" class="__wbr_mobile_action_btn__">
          <span style="display: flex !important; align-items: center !important; gap: 6px !important;">
            <span style="width: 6px !important; height: 6px !important; border-radius: 50% !important; background: #3b82f6 !important; display: inline-block !important; flex-shrink: 0 !important;"></span>
            <span class="__wbr_mobile_ticket_label__">${t("createTicket")}</span>
          </span>
        </button>
        <button id="__wbr_mobile_stop_btn__" type="button" class="__wbr_mobile_action_btn__">
          <span style="display: flex !important; align-items: center !important; gap: 6px !important;">
            <span style="width: 6px !important; height: 6px !important; border-radius: 50% !important; background: #34d399 !important; display: inline-block !important; flex-shrink: 0 !important;"></span>
            <span class="__wbr_mobile_stop_label__">${t("widgetExportAiShort")}</span>
          </span>
          <span class="__wbr_mobile_stop_shortcut__" style="font-size: 10px !important; color: rgba(255, 255, 255, 0.5) !important; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;">${this.stopShortcutKeyText}</span>
        </button>
        <button id="__wbr_mobile_discard_btn__" type="button" class="__wbr_mobile_action_btn__">
          <span style="display: flex !important; align-items: center !important; gap: 6px !important;">
            <span style="width: 6px !important; height: 6px !important; border-radius: 50% !important; background: #9ca3af !important; display: inline-block !important; flex-shrink: 0 !important;"></span>
            <span class="__wbr_mobile_discard_label__">${t("discardRecording")}</span>
          </span>
        </button>
      </div>
    `;

    document.body.appendChild(menu);
    this.mobileMenuElement = menu;

    const dockBtn = menu.querySelector<HTMLButtonElement>(
      "#__wbr_mobile_dock_btn__"
    );
    dockBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.setMobileEdgeAndY(
        this.mobileEdge === "right" ? "left" : "right",
        this.mobileYRatio
      );
    });

    const closeBtn = menu.querySelector<HTMLButtonElement>(
      "#__wbr_mobile_close_btn__"
    );
    closeBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.closeMobileMenu();
    });

    const issueBtn = menu.querySelector<HTMLButtonElement>(
      "#__wbr_mobile_issue_btn__"
    );
    issueBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (this._isSaving || this._isClosing) return;
      this.closeMobileMenu();
      this.callbacks.onMarkIssue();
    });

    const ticketBtn = menu.querySelector<HTMLButtonElement>(
      "#__wbr_mobile_ticket_btn__"
    );
    ticketBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (this._isSaving || this._isClosing) return;
      this.closeMobileMenu();
      const clickTimestamp = performance.now();
      const clickEpochMs = getEpochTimestampMs();
      this.callbacks.onStop({
        clickTimestamp,
        clickEpochMs,
        exportMode: "ticket",
      });
    });

    const stopBtn = menu.querySelector<HTMLButtonElement>(
      "#__wbr_mobile_stop_btn__"
    );
    stopBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (this._isSaving || this._isClosing) return;
      this.closeMobileMenu();
      const clickTimestamp = performance.now();
      const clickEpochMs = getEpochTimestampMs();
      this.callbacks.onStop({
        clickTimestamp,
        clickEpochMs,
        exportMode: "ai",
      });
    });

    const discardBtn = menu.querySelector<HTMLButtonElement>(
      "#__wbr_mobile_discard_btn__"
    );
    discardBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (this._isSaving || this._isClosing) return;
      if (!this.isConfirmingDiscard) {
        this.isConfirmingDiscard = true;
        discardBtn.classList.add("__wbr_confirming__");
        const span = discardBtn.querySelector(".__wbr_mobile_discard_label__");
        if (span) span.textContent = t("confirmDiscard");
        if (this.discardConfirmTimer) {
          window.clearTimeout(this.discardConfirmTimer);
        }
        this.discardConfirmTimer = window.setTimeout(() => {
          this.resetDiscardConfirm();
        }, 3000);
        return;
      }
      this.resetDiscardConfirm();
      this.closeMobileMenu();
      this.callbacks.onDiscard?.();
    });

    // 监听 Esc 键收起菜单
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Esc") {
        this.closeMobileMenu();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    this.cleanupEscListener = () => {
      window.removeEventListener("keydown", onKeyDown);
    };

    this.repositionMobileMenu();
  }

  private closeMobileMenu(): void {
    this.resetDiscardConfirm();
    if (this.cleanupEscListener) {
      this.cleanupEscListener();
      this.cleanupEscListener = undefined;
    }
    if (this.mobileMenuElement) {
      this.mobileMenuElement.remove();
      this.mobileMenuElement = undefined;
    }
    if (this.mobileMenuBackdrop) {
      this.mobileMenuBackdrop.remove();
      this.mobileMenuBackdrop = undefined;
    }
    this.resetMobileIdleTimer();
  }

  private repositionMobileMenu(): void {
    if (!this.mobileMenuElement || !this.container) return;
    const menu = this.mobileMenuElement;
    const metrics = getViewportMetrics(window);
    const rect = this.container.getBoundingClientRect();
    const menuWidth = menu.offsetWidth || 156;
    const menuHeight = menu.offsetHeight || 136;

    if (this.mobileEdge === "right") {
      const maxRight = Math.max(8, metrics.width - menuWidth - 8);
      const targetRight = Math.min(rect.width + 6, maxRight);
      menu.style.setProperty("right", `${targetRight}px`, "important");
      menu.style.setProperty("left", "auto", "important");
    } else {
      const maxLeft = Math.max(8, metrics.width - menuWidth - 8);
      const targetLeft = Math.min(rect.width + 6, maxLeft);
      menu.style.setProperty("left", `${targetLeft}px`, "important");
      menu.style.setProperty("right", "auto", "important");
    }

    const minTop = 56;
    const maxTop = Math.max(minTop, metrics.height - 76 - menuHeight);
    const targetTop = Math.min(Math.max(minTop, rect.top), maxTop);
    menu.style.setProperty("top", `${targetTop}px`, "important");
    menu.style.setProperty("bottom", "auto", "important");
  }

  private getFormattedTimerText(): string {
    const startTime = this.callbacks.getStartedAtEpochMs();
    const pausedDurationMs = this.callbacks.getPausedDurationMs?.() ?? 0;
    return formatRecordingTimer(Date.now() - startTime - pausedDurationMs);
  }

  mount(): void {
    if (this._isClosing) {
      this.unmount();
    }
    if (this.container || window.top !== window) return;
    const root = document.createElement("div");
    root.id = "__wbr_recording_widget__";
    root.className = "__wbr_recording_widget__";
    root.setAttribute("data-wbr-ignore", "true");

    root.innerHTML = `
      <style>
        #__wbr_recording_widget__ {
          position: fixed !important;
          top: auto;
          bottom: 24px;
          left: auto;
          right: 24px;
          width: auto !important;
          height: 36px !important;
          min-width: 0 !important;
          max-width: calc(100vw - 16px) !important;
          min-height: 0 !important;
          max-height: none !important;
          margin: 0 !important;
          padding: 6px 14px !important;
          box-sizing: border-box !important;
          z-index: 2147483647 !important;
          display: flex !important;
          flex-direction: row !important;
          align-items: center !important;
          justify-content: flex-start !important;
          gap: 10px !important;
          background: rgba(29, 33, 41, 0.78) !important;
          backdrop-filter: blur(14px) !important;
          -webkit-backdrop-filter: blur(14px) !important;
          border: 1px solid rgba(255, 255, 255, 0.16) !important;
          color: #ffffff !important;
          border-radius: 10px !important;
          box-shadow: 0 6px 20px rgba(0, 0, 0, 0.28) !important;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
          font-size: 12px !important;
          line-height: 1 !important;
          user-select: none !important;
          transform: none !important;
          align-self: auto !important;
          overflow: hidden !important;
          transition: height 0.32s cubic-bezier(0.25, 1, 0.5, 1), border-radius 0.32s cubic-bezier(0.25, 1, 0.5, 1), padding 0.32s cubic-bezier(0.25, 1, 0.5, 1), background 0.32s ease, box-shadow 0.32s ease, opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1), transform 0.25s cubic-bezier(0.4, 0, 0.2, 1) !important;
        }

        /* PC 桌面端：彻底隐藏 [▾] 折叠切换按钮，还原 35067f2 造成的桌面端污染 */
        #__wbr_recording_widget__:not([data-wbr-mobile-mode="true"]) #__wbr_collapse_toggle_btn__ {
          display: none !important;
        }

        #__wbr_recording_widget__.__wbr_collapsed__ {
          height: 30px !important;
          padding: 4px 12px !important;
          background: rgba(20, 24, 31, 0.58) !important;
          backdrop-filter: blur(20px) !important;
          -webkit-backdrop-filter: blur(20px) !important;
          border-radius: 15px !important;
          border: 1px solid rgba(255, 255, 255, 0.12) !important;
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2) !important;
          opacity: 0.88 !important;
          gap: 8px !important;
          transition: height 0.32s cubic-bezier(0.25, 1, 0.5, 1), border-radius 0.32s cubic-bezier(0.25, 1, 0.5, 1), padding 0.32s cubic-bezier(0.25, 1, 0.5, 1), background 0.32s ease, opacity 0.32s ease !important;
        }
        #__wbr_recording_widget__.__wbr_collapsed__:hover {
          opacity: 1 !important;
          border-color: rgba(255, 255, 255, 0.25) !important;
        }
        @keyframes wbr-spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .__wbr_spinner {
          display: inline-block !important;
          width: 11px !important;
          height: 11px !important;
          border: 2px solid rgba(255, 255, 255, 0.3) !important;
          border-top-color: #ffffff !important;
          border-radius: 50% !important;
          animation: wbr-spin 0.8s linear infinite !important;
          margin-right: 6px !important;
          vertical-align: -1px !important;
        }
        #__wbr_recording_widget__.__wbr_saving__ {
          height: 30px !important;
          padding: 4px 14px !important;
          background: rgba(20, 24, 31, 0.88) !important;
          backdrop-filter: blur(20px) !important;
          -webkit-backdrop-filter: blur(20px) !important;
          border-radius: 15px !important;
          border: 1px solid rgba(255, 255, 255, 0.2) !important;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3) !important;
          pointer-events: none !important;
        }
        #__wbr_recording_widget__.__wbr_closing__ {
          opacity: 0 !important;
          transform: translateY(8px) scale(0.96) !important;
          pointer-events: none !important;
        }
        #__wbr_recording_widget__.__wbr_saving__ .__wbr_drag_handle,
        #__wbr_recording_widget__.__wbr_saving__ .__wbr_dot,
        #__wbr_recording_widget__.__wbr_saving__ [data-wbr-rec-tag],
        #__wbr_recording_widget__.__wbr_saving__ .__wbr_btn_group,
        #__wbr_recording_widget__.__wbr_saving__ #__wbr_collapse_toggle_btn__ {
          display: none !important;
        }
        #__wbr_collapse_toggle_btn__ {
          border: 1px solid rgba(255, 255, 255, 0.18) !important;
          background: rgba(255, 255, 255, 0.1) !important;
          color: rgba(255, 255, 255, 0.85) !important;
          border-radius: 4px !important;
          padding: 3px 6px !important;
          font-size: 11px !important;
          line-height: 1 !important;
          cursor: pointer !important;
          flex-shrink: 0 !important;
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
          outline: none !important;
          margin: 0 !important;
          transition: background 0.15s ease, color 0.15s ease !important;
        }
        .__wbr_btn_group {
          display: flex !important;
          flex-direction: row !important;
          align-items: center !important;
          gap: 8px !important;
          max-width: 600px !important;
          opacity: 1 !important;
          overflow: hidden !important;
          white-space: nowrap !important;
          flex-shrink: 0 !important;
          transition: max-width 0.32s cubic-bezier(0.4, 0.0, 0.2, 1), opacity 0.22s ease-out, transform 0.32s cubic-bezier(0.4, 0.0, 0.2, 1) !important;
          transform: scale(1) !important;
          transform-origin: left center !important;
        }
        #__wbr_recording_widget__.__wbr_collapsed__ .__wbr_btn_group {
          max-width: none !important;
          opacity: 1 !important;
          gap: 0px !important;
          transform: none !important;
          pointer-events: auto !important;
        }
        #__wbr_recording_widget__.__wbr_collapsed__ #__wbr_issue_btn__,
        #__wbr_recording_widget__.__wbr_collapsed__ #__wbr_ticket_btn__,
        #__wbr_recording_widget__.__wbr_collapsed__ #__wbr_discard_btn__,
        #__wbr_recording_widget__.__wbr_collapsed__ #__wbr_health_msg__ {
          display: none !important;
        }
        #__wbr_recording_widget__.__wbr_collapsed__ #__wbr_stop_btn__ {
          padding: 3px 8px !important;
          font-size: 10.5px !important;
          border-radius: 3px !important;
        }
        .__wbr_drag_handle {
          cursor: grab !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          padding: 0 2px 0 0 !important;
          color: rgba(255, 255, 255, 0.45) !important;
          font-size: 13px !important;
          letter-spacing: -2px !important;
          user-select: none !important;
          line-height: 1 !important;
          flex-shrink: 0 !important;
          touch-action: none !important;
        }
        .__wbr_drag_handle:hover {
          color: rgba(255, 255, 255, 0.9) !important;
        }
        .__wbr_drag_handle:active {
          cursor: grabbing !important;
        }
        @keyframes wbr-pulse {
          0% { box-shadow: 0 0 0 0 rgba(245, 63, 63, 0.6); }
          70% { box-shadow: 0 0 0 6px rgba(245, 63, 63, 0); }
          100% { box-shadow: 0 0 0 0 rgba(245, 63, 63, 0); }
        }
        .__wbr_dot {
          width: 8px !important; height: 8px !important; border-radius: 50% !important; background: #f53f3f;
          display: inline-block !important;
          flex-shrink: 0 !important;
          animation: wbr-pulse 1.5s infinite;
        }
        .__wbr_btn {
          border: none !important; background: #f53f3f !important; color: #fff !important; border-radius: 4px !important;
          padding: 5px 10px !important; font-size: 11px !important; font-weight: 500 !important; cursor: pointer !important;
          transition: background 0.15s ease, color 0.15s ease !important;
          outline: none !important;
          height: auto !important;
          line-height: 1.2 !important;
          margin: 0 !important;
          white-space: nowrap !important;
          flex-shrink: 0 !important;
        }
        .__wbr_btn:hover { background: #f76565 !important; }
        .__wbr_btn:active { background: #cb2727 !important; }
        #__wbr_ticket_btn__:hover { background: #4080ff !important; }
        #__wbr_ticket_btn__:active { background: #0e42d2 !important; }
        #__wbr_discard_btn__ {
          background: rgba(255, 255, 255, 0.12) !important;
          color: rgba(255, 255, 255, 0.78) !important;
        }
        #__wbr_discard_btn__:hover {
          background: rgba(245, 63, 63, 0.25) !important;
          color: #ff7875 !important;
        }
        #__wbr_discard_btn__:active {
          background: rgba(245, 63, 63, 0.4) !important;
          color: #ffffff !important;
        }
        #__wbr_discard_btn__.__wbr_confirming__ {
          background: #f53f3f !important;
          color: #ffffff !important;
        }
        #__wbr_discard_btn__.__wbr_confirming__:hover {
          background: #f76565 !important;
          color: #ffffff !important;
        }
        .__wbr_timer { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important; font-size: 12px !important; color: #e5e6eb !important; font-weight: 600 !important; flex-shrink: 0 !important; }

        /* 移动仿真模式（[data-wbr-mobile-mode="true"]）全新侧边磁吸胶囊 */
        #__wbr_recording_widget__[data-wbr-mobile-mode="true"] {
          position: fixed !important;
          width: auto !important;
          min-width: 68px !important;
          max-width: 80px !important;
          height: 32px !important;
          padding: 4px 8px !important;
          box-sizing: border-box !important;
          z-index: 2147483647 !important;
          display: flex !important;
          flex-direction: row !important;
          align-items: center !important;
          justify-content: center !important;
          gap: 5px !important;
          background: rgba(20, 24, 31, 0.88) !important;
          backdrop-filter: blur(14px) !important;
          -webkit-backdrop-filter: blur(14px) !important;
          border: 1px solid rgba(255, 255, 255, 0.16) !important;
          color: #ffffff !important;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.32) !important;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
          font-size: 11px !important;
          user-select: none !important;
          cursor: grab !important;
          touch-action: none !important;
          opacity: 1 !important;
          transition: opacity 0.28s ease, background 0.2s ease, transform 0.2s ease, border-radius 0.2s ease !important;
        }

        /* 停靠右侧（默认） */
        #__wbr_recording_widget__[data-wbr-mobile-mode="true"][data-wbr-edge="right"],
        #__wbr_recording_widget__[data-wbr-mobile-mode="true"]:not([data-wbr-edge="left"]) {
          right: 0 !important;
          left: auto !important;
          border-radius: 16px 0 0 16px !important;
          border-right: none !important;
        }

        /* 停靠左侧 */
        #__wbr_recording_widget__[data-wbr-mobile-mode="true"][data-wbr-edge="left"] {
          left: 0 !important;
          right: auto !important;
          border-radius: 0 16px 16px 0 !important;
          border-left: none !important;
        }

        /* 静止 3s 透明度微降至 0.78 */
        #__wbr_recording_widget__[data-wbr-mobile-mode="true"].__wbr_idle_dim__ {
          opacity: 0.78 !important;
        }
        #__wbr_recording_widget__[data-wbr-mobile-mode="true"].__wbr_idle_dim__:hover,
        #__wbr_recording_widget__[data-wbr-mobile-mode="true"].__wbr_idle_dim__:active {
          opacity: 1 !important;
        }

        /* 移动胶囊隐藏 PC 端专有组件 */
        #__wbr_recording_widget__[data-wbr-mobile-mode="true"] .__wbr_drag_handle,
        #__wbr_recording_widget__[data-wbr-mobile-mode="true"] [data-wbr-rec-tag],
        #__wbr_recording_widget__[data-wbr-mobile-mode="true"] .__wbr_btn_group,
        #__wbr_recording_widget__[data-wbr-mobile-mode="true"] #__wbr_collapse_toggle_btn__ {
          display: none !important;
        }

        /* 移动端胶囊展开指示符 */
        #__wbr_recording_widget__:not([data-wbr-mobile-mode="true"]) .__wbr_mobile_arrow__ {
          display: none !important;
        }
        #__wbr_recording_widget__[data-wbr-mobile-mode="true"] .__wbr_mobile_arrow__ {
          display: inline-block !important;
          font-size: 13px !important;
          line-height: 1 !important;
          color: rgba(255, 255, 255, 0.75) !important;
          margin-left: 1px !important;
          user-select: none !important;
        }

        /* 移动端保存中态 */
        #__wbr_recording_widget__[data-wbr-mobile-mode="true"].__wbr_saving__ {
          min-width: 82px !important;
          max-width: 104px !important;
          padding: 4px 10px !important;
          cursor: default !important;
          pointer-events: none !important;
        }
        #__wbr_recording_widget__[data-wbr-mobile-mode="true"].__wbr_saving__ .__wbr_mobile_arrow__,
        #__wbr_recording_widget__[data-wbr-mobile-mode="true"].__wbr_saving__ .__wbr_dot {
          display: none !important;
        }

        /* 移动端子流程隐身互斥 */
        #__wbr_recording_widget__[data-wbr-mobile-mode="true"][data-wbr-suppressed="true"] {
          display: none !important;
        }

        /* 移动端侧边紧凑菜单样式（瘦身方案 A：极简轻量桌面级质感） */
        #__wbr_mobile_menu__ {
          position: fixed !important;
          z-index: 2147483647 !important;
          width: max-content !important;
          min-width: 148px !important;
          max-width: min(calc(100vw - 92px), 240px) !important;
          box-sizing: border-box !important;
          padding: 6px !important;
          gap: 2px !important;
          border-radius: 10px !important;
          background: rgba(24, 27, 34, 0.94) !important;
          backdrop-filter: blur(14px) !important;
          -webkit-backdrop-filter: blur(14px) !important;
          border: 1px solid rgba(255, 255, 255, 0.14) !important;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.36) !important;
          color: #ffffff !important;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
          user-select: none !important;
          display: flex !important;
          flex-direction: column !important;
        }

        .__wbr_mobile_menu_actions__ {
          display: flex !important;
          flex-direction: column !important;
          gap: 2px !important;
          padding: 0 !important;
        }

        .__wbr_mobile_action_btn__ {
          height: 26px !important;
          min-height: 26px !important;
          padding: 0 7px !important;
          border-radius: 6px !important;
          font-size: 11.5px !important;
          font-weight: 500 !important;
          background: transparent !important;
          border: none !important;
          color: #f2f3f5 !important;
          display: flex !important;
          align-items: center !important;
          justify-content: space-between !important;
          gap: 8px !important;
          white-space: nowrap !important;
          cursor: pointer !important;
          box-sizing: border-box !important;
          transition: background 0.15s ease, color 0.15s ease !important;
        }
        .__wbr_mobile_action_btn__:hover {
          background: rgba(255, 255, 255, 0.11) !important;
        }

        /* 1. 标记截图（主动作）：淡红底微高亮 */
        #__wbr_mobile_issue_btn__ {
          background: rgba(245, 63, 63, 0.14) !important;
        }
        #__wbr_mobile_issue_btn__:hover {
          background: rgba(245, 63, 63, 0.24) !important;
        }

        /* 4. 丢弃录制：视觉隔离弱灰与二次确认高亮 */
        #__wbr_mobile_discard_btn__ {
          margin-top: 2px !important;
          border-top: 1px solid rgba(255, 255, 255, 0.07) !important;
          height: 24px !important;
          min-height: 24px !important;
          border-radius: 4px !important;
          color: #9ca3af !important;
          justify-content: flex-start !important;
        }
        #__wbr_mobile_discard_btn__:hover {
          background: rgba(255, 255, 255, 0.08) !important;
          color: #f2f3f5 !important;
        }
        #__wbr_mobile_discard_btn__.__wbr_confirming__ {
          background: rgba(245, 63, 63, 0.22) !important;
          color: #ff7875 !important;
          font-weight: 600 !important;
        }
        #__wbr_mobile_discard_btn__.__wbr_confirming__:hover {
          background: rgba(245, 63, 63, 0.32) !important;
          color: #ffa39e !important;
        }
      </style>
      <span class="__wbr_drag_handle" title="${t("dragToMove")}">⋮⋮</span>
      <span class="__wbr_dot"></span>
      <span data-wbr-rec-tag style="font-weight:600;letter-spacing:0.5px;color:#fff;flex-shrink:0;">REC</span>
      <span id="__wbr_timer_display__" class="__wbr_timer">00:00</span>
      <span class="__wbr_mobile_arrow__">‹</span>
      <div class="__wbr_btn_group">
        <span id="__wbr_health_msg__" style="font-size:11px;color:#ffc107;display:none;max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title=""></span>
        <button id="__wbr_issue_btn__" class="__wbr_btn" style="background:#b42318;" title="${t("widgetToolbarIssueTooltip", [this.shortcutKeyText])}">${t("markIssue")} (${this.shortcutKeyText})</button>
        <button id="__wbr_ticket_btn__" class="__wbr_btn" style="background:#165dff;" title="${t("widgetToolbarTicketTooltip")}">${t("createTicket")}</button>
        <button id="__wbr_stop_btn__" class="__wbr_btn" title="${t("widgetToolbarStopTooltip", [this.stopShortcutKeyText])}">${t("stopRecording")}</button>
        <button id="__wbr_discard_btn__" class="__wbr_btn" title="${t("widgetToolbarDiscardTooltip")}">${t("discardRecording")}</button>
      </div>
      <button id="__wbr_collapse_toggle_btn__" type="button" title="${t("widgetCollapseTooltip")}" aria-label="${t("widgetCollapseTooltip")}" aria-expanded="true">▾</button>
    `;

    const attach = () => {
      if (document.body) {
        document.body.appendChild(root);
        this.container = root;

        // 判定当前视口是否属于移动端仿真模式
        this.isMobileMode = isMobileEmulationViewport(window);
        syncMobileEmulationAttribute(root, this.isMobileMode);

        if (this.isMobileMode) {
          if (this.isSuppressedForSubflow) {
            root.setAttribute("data-wbr-suppressed", "true");
          }
          this.restoreMobileSavedPosition(root);
          this.applyMobilePillPosition(root);
          this.resetMobileIdleTimer();
        } else {
          // PC 桌面端恢复本会话内已保存的拖拽位置（若有）
          this.restoreSavedPosition(root);
          this.resetCollapseTimer();
        }

        const ticketBtn = root.querySelector("#__wbr_ticket_btn__");
        if (ticketBtn) {
          ticketBtn.addEventListener(
            "click",
            (e) => {
              e.stopPropagation();
              e.preventDefault();
              if (this._isSaving || this._isClosing) return;
              this.resetDiscardConfirm();
              const clickTimestamp = performance.now();
              const clickEpochMs = getEpochTimestampMs();
              this.callbacks.onStop({
                clickTimestamp,
                clickEpochMs,
                exportMode: "ticket",
              });
            },
            true
          );
        }
        const stopBtn = root.querySelector("#__wbr_stop_btn__");
        if (stopBtn) {
          stopBtn.addEventListener(
            "click",
            (e) => {
              e.stopPropagation();
              e.preventDefault();
              if (this._isSaving || this._isClosing) return;
              this.resetDiscardConfirm();
              const clickTimestamp = performance.now();
              const clickEpochMs = getEpochTimestampMs();
              this.callbacks.onStop({
                clickTimestamp,
                clickEpochMs,
                exportMode: "ai",
              });
            },
            true
          );
        }
        const issueBtn = root.querySelector("#__wbr_issue_btn__");
        issueBtn?.addEventListener(
          "click",
          (e: Event) => {
            e.stopPropagation();
            e.preventDefault();
            if (this._isSaving || this._isClosing) return;
            this.resetDiscardConfirm();
            const me = e as MouseEvent;
            this.callbacks.onMarkIssue({ x: me.clientX, y: me.clientY });
          },
          true
        );
        const discardBtn = root.querySelector<HTMLButtonElement>(
          "#__wbr_discard_btn__"
        );
        if (discardBtn) {
          discardBtn.addEventListener(
            "click",
            (e) => {
              e.stopPropagation();
              e.preventDefault();
              if (this._isSaving || this._isClosing) return;
              if (!this.isConfirmingDiscard) {
                this.isConfirmingDiscard = true;
                discardBtn.classList?.add("__wbr_confirming__");
                discardBtn.textContent = t("confirmDiscard");
                if (this.discardConfirmTimer) {
                  window.clearTimeout(this.discardConfirmTimer);
                }
                this.discardConfirmTimer = window.setTimeout(() => {
                  this.resetDiscardConfirm();
                }, 3000);
                return;
              }
              this.resetDiscardConfirm();
              this.callbacks.onDiscard?.();
            },
            true
          );
        }

        const collapseToggleBtn = root.querySelector<HTMLButtonElement>(
          "#__wbr_collapse_toggle_btn__"
        );
        collapseToggleBtn?.addEventListener(
          "click",
          (e) => {
            e.stopPropagation();
            e.preventDefault();
            if (this._isSaving || this._isClosing) return;
            this.toggleManualCollapse();
          },
          true
        );

        // PC 拖拽手柄逻辑（Pointer Events 兼容鼠标）
        const dragHandle =
          root.querySelector<HTMLElement>(".__wbr_drag_handle");
        if (dragHandle) {
          const onPointerDown = (e: PointerEvent) => {
            if (this.isMobileMode) return;
            if (typeof e.button === "number" && e.button !== 0) return;
            e.stopPropagation();
            e.preventDefault();
            if (this._isSaving || this._isClosing) return;
            this.resetDiscardConfirm();
            this.isDragging = true;
            this.isManuallyCollapsed = false;
            if (this.autoCollapseTimer) {
              window.clearTimeout(this.autoCollapseTimer);
              this.autoCollapseTimer = undefined;
            }
            root.classList.remove("__wbr_collapsed__");
            this.syncCollapseToggleState();

            const pointerId = e.pointerId;
            try {
              (dragHandle as any).setPointerCapture?.(pointerId);
            } catch {}

            const rect = root.getBoundingClientRect();
            const offsetX = e.clientX - rect.left;
            const offsetY = e.clientY - rect.top;

            const onPointerMove = (moveEvt: PointerEvent) => {
              if (
                pointerId !== undefined &&
                moveEvt.pointerId !== undefined &&
                moveEvt.pointerId !== pointerId
              ) {
                return;
              }
              moveEvt.preventDefault?.();
              const winWidth =
                window.innerWidth ||
                document.documentElement?.clientWidth ||
                1024;
              const winHeight =
                window.innerHeight ||
                document.documentElement?.clientHeight ||
                768;
              const currentRect = root.getBoundingClientRect();
              const widgetWidth = Number.isFinite(currentRect.width)
                ? currentRect.width
                : rect.width;
              const widgetHeight = Number.isFinite(currentRect.height)
                ? currentRect.height
                : rect.height;

              let left = moveEvt.clientX - offsetX;
              let top = moveEvt.clientY - offsetY;

              const maxLeft = Math.max(0, winWidth - widgetWidth);
              const maxTop = Math.max(0, winHeight - widgetHeight);
              left = Math.min(Math.max(0, left), maxLeft);
              top = Math.min(Math.max(0, top), maxTop);

              const right = Math.max(0, winWidth - (left + widgetWidth));

              const topPx = `${top}px`;
              const rightPx = `${right}px`;
              root.style.setProperty("top", topPx, "important");
              root.style.setProperty("right", rightPx, "important");
              root.style.setProperty("bottom", "auto", "important");
              root.style.setProperty("left", "auto", "important");
              this.syncBubblePosition(root);
            };

            const cleanupActiveDrag = () => {
              this.isDragging = false;
              window.removeEventListener?.(
                "pointermove",
                onPointerMove as EventListener
              );
              window.removeEventListener?.(
                "pointerup",
                onPointerEnd as EventListener
              );
              window.removeEventListener?.(
                "pointercancel",
                onPointerEnd as EventListener
              );
              try {
                if (pointerId !== undefined) {
                  (dragHandle as any).releasePointerCapture?.(pointerId);
                }
              } catch {}
            };

            const onPointerEnd = (endEvt?: PointerEvent) => {
              if (
                endEvt &&
                pointerId !== undefined &&
                endEvt.pointerId !== undefined &&
                endEvt.pointerId !== pointerId
              ) {
                return;
              }
              if (!this.isDragging) return;
              cleanupActiveDrag();
              this.cleanupDragListeners = undefined;

              try {
                const currentSessionId = this.callbacks.getSessionId?.();
                const savedPos = {
                  sessionId: currentSessionId,
                  right: root.style.right,
                  top: root.style.top,
                };
                if (typeof sessionStorage !== "undefined") {
                  sessionStorage.setItem(
                    "__wbr_widget_pos__",
                    JSON.stringify(savedPos)
                  );
                }
                if (typeof chrome !== "undefined" && chrome.storage?.local) {
                  void chrome.storage.local
                    .set({ __wbr_widget_pos__: savedPos })
                    .catch(() => undefined);
                }
              } catch {}

              this.resetCollapseTimer();
            };

            this.cleanupDragListeners?.();
            this.cleanupDragListeners = cleanupActiveDrag;
            window.addEventListener?.(
              "pointermove",
              onPointerMove as EventListener
            );
            window.addEventListener?.(
              "pointerup",
              onPointerEnd as EventListener
            );
            window.addEventListener?.(
              "pointercancel",
              onPointerEnd as EventListener
            );
          };

          dragHandle.addEventListener(
            "pointerdown",
            onPointerDown as EventListener
          );
          this.cleanupDragHandleListener = () => {
            dragHandle.removeEventListener?.(
              "pointerdown",
              onPointerDown as EventListener
            );
          };
        }

        // 移动仿真态：全胶囊拖拽 + 自动左右磁吸 + 轻点展开侧边菜单
        let mobilePointerDown = false;
        let mobileStartX = 0;
        let mobileStartY = 0;
        let mobileInitialLeft = 0;
        let mobileInitialTop = 0;
        let mobileMoved = false;

        const onRootPointerDown = (e: PointerEvent) => {
          if (!this.isMobileMode) return;
          if (typeof e.button === "number" && e.button !== 0) return;
          if (this._isSaving || this._isClosing || this.isSuppressedForSubflow)
            return;
          e.stopPropagation();
          e.preventDefault();

          this.resetDiscardConfirm();
          this.resetMobileIdleTimer();

          const pointerId = e.pointerId;
          try {
            (root as any).setPointerCapture?.(pointerId);
          } catch {}

          const rect = root.getBoundingClientRect();
          mobilePointerDown = true;
          mobileMoved = false;
          mobileStartX = e.clientX;
          mobileStartY = e.clientY;
          mobileInitialLeft = rect.left;
          mobileInitialTop = rect.top;

          const onPointerMove = (moveEvt: PointerEvent) => {
            if (!mobilePointerDown) return;
            if (
              pointerId !== undefined &&
              moveEvt.pointerId !== undefined &&
              moveEvt.pointerId !== pointerId
            ) {
              return;
            }
            moveEvt.preventDefault?.();

            const dx = moveEvt.clientX - mobileStartX;
            const dy = moveEvt.clientY - mobileStartY;
            const dist = Math.hypot(dx, dy);

            if (!mobileMoved) {
              if (dist >= 6) {
                mobileMoved = true;
                this.isDragging = true;
                this.closeMobileMenu();
              }
            }

            if (mobileMoved) {
              const metrics = getViewportMetrics(window);
              const w = root.offsetWidth || 68;
              const h = root.offsetHeight || 32;

              let currentLeft = mobileInitialLeft + dx;
              let currentTop = mobileInitialTop + dy;

              currentLeft = Math.min(
                Math.max(0, currentLeft),
                metrics.width - w
              );
              currentTop = Math.min(
                Math.max(56, currentTop),
                Math.max(56, metrics.height - 76 - h)
              );

              root.style.setProperty("left", `${currentLeft}px`, "important");
              root.style.setProperty("top", `${currentTop}px`, "important");
              root.style.setProperty("right", "auto", "important");
              root.style.setProperty("bottom", "auto", "important");
              root.style.setProperty("cursor", "grabbing", "important");
            }
          };

          const cleanupMobileDrag = () => {
            mobilePointerDown = false;
            window.removeEventListener?.(
              "pointermove",
              onPointerMove as EventListener
            );
            window.removeEventListener?.(
              "pointerup",
              onPointerEnd as EventListener
            );
            window.removeEventListener?.(
              "pointercancel",
              onPointerEnd as EventListener
            );
            root.style?.removeProperty?.("cursor");
            try {
              if (pointerId !== undefined) {
                (root as any).releasePointerCapture?.(pointerId);
              }
            } catch {}
            this.cleanupDragListeners = undefined;
          };

          this.cleanupDragListeners?.();
          this.cleanupDragListeners = cleanupMobileDrag;

          const onPointerEnd = (endEvt?: PointerEvent) => {
            if (!mobilePointerDown) return;
            if (
              endEvt &&
              pointerId !== undefined &&
              endEvt.pointerId !== undefined &&
              endEvt.pointerId !== pointerId
            ) {
              return;
            }
            cleanupMobileDrag();

            if (!mobileMoved) {
              // 移动距离 < 6px：判为轻点，展开/收起侧边紧凑菜单
              this.isDragging = false;
              this.toggleMobileMenu();
            } else {
              // 移动距离 >= 6px：松手自动沿 X 轴吸附最近左/右边缘
              this.isDragging = false;
              const metrics = getViewportMetrics(window);
              const currentRect = root.getBoundingClientRect();
              const centerX = currentRect.left + currentRect.width / 2;
              const targetEdge: "left" | "right" =
                centerX < metrics.width / 2 ? "left" : "right";
              const clampedTop = Math.min(
                Math.max(56, currentRect.top),
                Math.max(56, metrics.height - 76 - currentRect.height)
              );
              this.setMobileEdgeAndY(targetEdge, clampedTop / metrics.height);
            }
            this.resetMobileIdleTimer();
          };

          window.addEventListener?.(
            "pointermove",
            onPointerMove as EventListener
          );
          window.addEventListener?.("pointerup", onPointerEnd as EventListener);
          window.addEventListener?.(
            "pointercancel",
            onPointerEnd as EventListener
          );
        };

        root.addEventListener(
          "pointerdown",
          onRootPointerDown as EventListener
        );
        this.cleanupMobilePointerListeners = () => {
          root.removeEventListener(
            "pointerdown",
            onRootPointerDown as EventListener
          );
        };

        // 视口与移动仿真模式响应监听
        const onViewportResize = () => {
          if (this._isClosing || !this.container) return;
          if (this.isMobileMode) {
            if (!this.isDragging) {
              this.applyMobilePillPosition(root);
            }
            this.repositionMobileMenu();
          } else {
            this.applyPosition(root, {
              right: root.style.right,
              top: root.style.top,
            });
          }
          this.syncBubblePosition(root);
        };
        window.addEventListener?.("resize", onViewportResize);
        window.visualViewport?.addEventListener?.("resize", onViewportResize);
        this.cleanupResizeListeners = () => {
          window.removeEventListener?.("resize", onViewportResize);
          window.visualViewport?.removeEventListener?.(
            "resize",
            onViewportResize
          );
        };

        this.cleanupMobileModeObserver = observeMobileEmulationMode(
          (isMobile, metrics) => {
            if (this._isClosing || !this.container) return;
            const modeChanged = this.isMobileMode !== isMobile;
            this.isMobileMode = isMobile;
            syncMobileEmulationAttribute(this.container, isMobile);
            if (modeChanged) {
              this.handleModeChange(isMobile, metrics);
            } else {
              this.handleViewportResize(metrics);
            }
          }
        );

        // PC 自动折叠逻辑（移动端不执行）
        const onMouseEnter = () => {
          if (this._isSaving || this._isClosing || this.isMobileMode) return;
          if (this.isCoarseOrNoHoverPointer() || this.isManuallyCollapsed) {
            return;
          }
          this.isHovering = true;
          this.keepExpanded();
        };
        const onMouseMove = () => {
          if (this._isSaving || this._isClosing || this.isMobileMode) return;
          if (this.isCoarseOrNoHoverPointer() || this.isManuallyCollapsed) {
            return;
          }
          this.keepExpanded();
        };
        const onFocusIn = () => {
          if (this._isSaving || this._isClosing || this.isMobileMode) return;
          if (this.isManuallyCollapsed) return;
          if (this.isHovering) {
            this.keepExpanded();
          } else {
            this.resetCollapseTimer();
          }
        };

        root.addEventListener("mouseenter", onMouseEnter);
        root.addEventListener("mousemove", onMouseMove);
        root.addEventListener("focusin", onFocusIn);

        const onMouseLeave = () => {
          if (this._isSaving || this._isClosing || this.isMobileMode) return;
          this.isHovering = false;
          if (this.isCoarseOrNoHoverPointer() || this.isManuallyCollapsed) {
            return;
          }
          if (this.autoCollapseTimer) {
            window.clearTimeout(this.autoCollapseTimer);
          }
          if (!this.isDragging) {
            this.autoCollapseTimer = window.setTimeout(() => {
              if (
                this.container &&
                !this.isDragging &&
                !this._isSaving &&
                !this.isMobileMode
              ) {
                this.resetDiscardConfirm();
                this.container.classList.add("__wbr_collapsed__");
                this.syncCollapseToggleState();
              }
            }, 1500);
          }
        };

        root.addEventListener("mouseleave", onMouseLeave);

        this.cleanupCollapseListeners = () => {
          root.removeEventListener("mouseenter", onMouseEnter);
          root.removeEventListener("mousemove", onMouseMove);
          root.removeEventListener("focusin", onFocusIn);
          root.removeEventListener("mouseleave", onMouseLeave);
        };

        this.isManuallyCollapsed = false;
        if (!this.isMobileMode) {
          this.resetCollapseTimer();
        }

        this.setIssueSelecting(false);
        this.updateLanguage();
        this.syncCollapseToggleState();

        this.refreshTimerDisplay();
        this.timerInterval = window.setInterval(
          () => this.refreshTimerDisplay(),
          1000
        );

        this.checkAndShowInitialBubble(root);
      } else {
        window.addEventListener("DOMContentLoaded", attach, { once: true });
      }
    };
    attach();
  }

  private getBubbleShortcutHtml(): string {
    return `<kbd style="background:#ffffff !important;color:#1d2129 !important;padding:1px 4px !important;border-radius:3px !important;font-weight:600 !important;font-size:10px !important;box-shadow:0 1px 2px rgba(0,0,0,0.2) !important;font-family:inherit !important;display:inline-block !important;line-height:14px !important;height:14px !important;vertical-align:baseline !important;">${this.shortcutKeyText}</kbd>`;
  }

  private buildBubbleGuideHtml(): string {
    if (this.isMobileMode) {
      const rawText = t("widgetMobileGuideTip", [this.shortcutKeyText]);
      return rawText.includes(this.shortcutKeyText)
        ? rawText.replace(this.shortcutKeyText, this.getBubbleShortcutHtml())
        : rawText;
    }
    const rawGuideText = t("widgetBubbleGuide", ["__SHORTCUT_PLACEHOLDER__"]);
    return rawGuideText.includes("__SHORTCUT_PLACEHOLDER__")
      ? rawGuideText.replace(
          "__SHORTCUT_PLACEHOLDER__",
          this.getBubbleShortcutHtml()
        )
      : rawGuideText;
  }

  private syncBubblePosition(root: HTMLElement): void {
    if (!this.bubbleElement) return;
    const rect = root.getBoundingClientRect();
    const metrics = getViewportMetrics(window);
    const winWidth = metrics.width;
    const winHeight = metrics.height;

    if (this.isMobileMode) {
      this.bubbleElement.setAttribute("data-wbr-mobile-bubble", "true");
      const widgetWidth = rect.width || 68;
      const maxBubbleWidth = Math.min(
        240,
        Math.max(120, winWidth - widgetWidth - 16)
      );
      this.bubbleElement.style.setProperty(
        "max-width",
        `${maxBubbleWidth}px`,
        "important"
      );
      const bubbleRect = this.bubbleElement.getBoundingClientRect?.();
      const bubbleWidth =
        bubbleRect && Number.isFinite(bubbleRect.width) && bubbleRect.width > 0
          ? Math.min(bubbleRect.width, maxBubbleWidth)
          : maxBubbleWidth;
      const bubbleHeight =
        bubbleRect &&
        Number.isFinite(bubbleRect.height) &&
        bubbleRect.height > 0
          ? bubbleRect.height
          : 76;

      if (this.mobileEdge === "right") {
        this.bubbleElement.style.setProperty(
          "right",
          `${widgetWidth + 8}px`,
          "important"
        );
        this.bubbleElement.style.setProperty("left", "auto", "important");
      } else {
        this.bubbleElement.style.setProperty(
          "left",
          `${widgetWidth + 8}px`,
          "important"
        );
        this.bubbleElement.style.setProperty("right", "auto", "important");
      }

      const minTop = 56;
      const maxTop = Math.max(minTop, winHeight - 76 - bubbleHeight);
      const targetTop = Math.min(Math.max(minTop, rect.top - 10), maxTop);
      this.bubbleElement.style.setProperty(
        "top",
        `${targetTop}px`,
        "important"
      );
      this.bubbleElement.style.setProperty("bottom", "auto", "important");

      const arrowEl = this.bubbleElement.querySelector?.(
        "#__wbr_widget_bubble_arrow__"
      ) as HTMLElement | null;
      if (arrowEl) {
        if (this.mobileEdge === "right") {
          arrowEl.style.setProperty("right", "-4px", "important");
          arrowEl.style.setProperty("left", "auto", "important");
          arrowEl.style.setProperty("top", "16px", "important");
          arrowEl.style.setProperty("bottom", "auto", "important");
          arrowEl.style.setProperty("transform", "rotate(-45deg)", "important");
        } else {
          arrowEl.style.setProperty("left", "-4px", "important");
          arrowEl.style.setProperty("right", "auto", "important");
          arrowEl.style.setProperty("top", "16px", "important");
          arrowEl.style.setProperty("bottom", "auto", "important");
          arrowEl.style.setProperty("transform", "rotate(135deg)", "important");
        }
      }
      return;
    }

    // PC 桌面端保持原有定位逻辑
    this.bubbleElement.removeAttribute?.("data-wbr-mobile-bubble");
    const rectLeft = Number.isFinite(rect.left) ? rect.left : 0;
    const rectWidth = Number.isFinite(rect.width) ? rect.width : 0;
    const rectRight = Number.isFinite(rect.right)
      ? rect.right
      : rectLeft + rectWidth;
    const rectTop = Number.isFinite(rect.top) ? rect.top : winHeight - 60;
    const rectHeight = Number.isFinite(rect.height) ? rect.height : 36;
    const rectBottom = Number.isFinite(rect.bottom)
      ? rect.bottom
      : rectTop + rectHeight;

    const maxBubbleWidth = Math.min(320, Math.max(160, winWidth - 16));
    const bubbleRect = this.bubbleElement.getBoundingClientRect?.();
    const bubbleWidth =
      bubbleRect && Number.isFinite(bubbleRect.width) && bubbleRect.width > 0
        ? Math.min(bubbleRect.width, maxBubbleWidth)
        : maxBubbleWidth;
    const bubbleHeight =
      bubbleRect && Number.isFinite(bubbleRect.height) && bubbleRect.height > 0
        ? bubbleRect.height
        : 88;

    const desiredRight = winWidth - rectRight;
    const maxRight = Math.max(8, winWidth - bubbleWidth - 8);
    const right = Math.min(Math.max(8, desiredRight), maxRight);

    const placeBelow =
      rectTop < bubbleHeight + 16 &&
      winHeight - rectBottom >= bubbleHeight + 16;

    if (placeBelow) {
      const top = Math.min(
        Math.max(8, rectBottom + 8),
        Math.max(8, winHeight - bubbleHeight - 8)
      );
      this.bubbleElement.style.setProperty("top", `${top}px`, "important");
      this.bubbleElement.style.setProperty("bottom", "auto", "important");
    } else {
      const maxBottom = Math.max(8, winHeight - bubbleHeight - 8);
      const bottom = Math.min(Math.max(8, winHeight - rectTop + 8), maxBottom);
      this.bubbleElement.style.setProperty(
        "bottom",
        `${bottom}px`,
        "important"
      );
      this.bubbleElement.style.setProperty("top", "auto", "important");
    }

    this.bubbleElement.style.setProperty("right", `${right}px`, "important");
    this.bubbleElement.style.setProperty("left", "auto", "important");

    const arrowEl = this.bubbleElement.querySelector?.(
      "#__wbr_widget_bubble_arrow__"
    ) as HTMLElement | null;
    if (arrowEl) {
      const bubbleRightEdge = winWidth - right;
      const widgetCenterX = rectLeft + rectWidth / 2;
      const rawArrowRight = bubbleRightEdge - widgetCenterX - 4;
      const arrowRight = Math.min(
        Math.max(16, rawArrowRight),
        Math.max(16, bubbleWidth - 24)
      );
      arrowEl.style?.setProperty?.("right", `${arrowRight}px`, "important");
      arrowEl.style?.setProperty?.("left", "auto", "important");
      if (placeBelow) {
        arrowEl.style?.setProperty?.("top", "-5px", "important");
        arrowEl.style?.setProperty?.("bottom", "auto", "important");
        arrowEl.style?.setProperty?.(
          "transform",
          "rotate(225deg)",
          "important"
        );
      } else {
        arrowEl.style?.setProperty?.("bottom", "-5px", "important");
        arrowEl.style?.setProperty?.("top", "auto", "important");
        arrowEl.style?.setProperty?.("transform", "rotate(45deg)", "important");
      }
    }
  }

  private async checkAndShowInitialBubble(root: HTMLElement): Promise<void> {
    try {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        const stored = (await chrome.storage.local.get([
          "hasSeenWidgetBubble",
        ])) as {
          hasSeenWidgetBubble?: boolean;
        };
        if (stored?.hasSeenWidgetBubble) return;
      } else if (typeof localStorage !== "undefined") {
        if (localStorage.getItem("__wbr_widget_bubble_seen__")) return;
      }
    } catch {
      return;
    }

    this.showGuideBubble(root);
  }

  private showGuideBubble(root: HTMLElement): void {
    if (this.bubbleElement || !document.body) return;
    if (this.isSuppressedForSubflow && this.isMobileMode) return;

    this.isBubbleShowing = true;
    this.keepExpanded();

    const bubble = document.createElement("div");
    bubble.id = "__wbr_widget_bubble__";
    bubble.className = "__wbr_widget_bubble__";
    bubble.setAttribute("data-wbr-ignore", "true");
    bubble.setAttribute("role", "status");
    bubble.setAttribute("aria-live", "polite");

    const guideHtml = this.buildBubbleGuideHtml();

    bubble.innerHTML = `
      <style>
        #__wbr_widget_bubble__ {
          position: fixed !important;
          z-index: 2147483647 !important;
          max-width: min(320px, calc(100vw - 16px)) !important;
          box-sizing: border-box !important;
          background: rgba(20, 24, 31, 0.94) !important;
          backdrop-filter: blur(16px) !important;
          -webkit-backdrop-filter: blur(16px) !important;
          border: 1px solid rgba(255, 255, 255, 0.18) !important;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.36), 0 0 0 1px rgba(22, 93, 255, 0.22) !important;
          color: #ffffff !important;
          border-radius: 8px !important;
          padding: 8px 12px !important;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
          font-size: 12px !important;
          line-height: 1.45 !important;
          display: flex !important;
          flex-direction: row !important;
          align-items: flex-start !important;
          gap: 8px !important;
          pointer-events: auto !important;
          cursor: pointer !important;
          user-select: none !important;
          opacity: 0 !important;
          transform: translateY(6px) !important;
          transition: opacity 0.25s cubic-bezier(0.16, 1, 0.3, 1), transform 0.25s cubic-bezier(0.16, 1, 0.3, 1) !important;
        }
        #__wbr_widget_bubble__[data-wbr-mobile-bubble="true"] {
          max-width: min(240px, calc(100vw - 92px)) !important;
          font-size: 11.5px !important;
          padding: 7px 10px !important;
        }
        #__wbr_widget_bubble__.__wbr_bubble_visible__ {
          opacity: 1 !important;
          transform: translateY(0) !important;
        }
        #__wbr_widget_bubble_arrow__ {
          position: absolute !important;
          bottom: -5px !important;
          right: 28px !important;
          width: 8px !important;
          height: 8px !important;
          background: rgba(20, 24, 31, 0.94) !important;
          transform: rotate(45deg) !important;
          border-right: 1px solid rgba(255, 255, 255, 0.18) !important;
          border-bottom: 1px solid rgba(255, 255, 255, 0.18) !important;
        }
        .__wbr_bubble_close__ {
          color: rgba(255, 255, 255, 0.5) !important;
          font-size: 14px !important;
          line-height: 1 !important;
          padding: 0 0 0 4px !important;
          cursor: pointer !important;
          border: none !important;
          background: transparent !important;
          flex-shrink: 0 !important;
          margin-top: 1px !important;
        }
        .__wbr_bubble_close__:hover {
          color: #ffffff !important;
        }
        .__wbr_bubble_got_it__ {
          margin-top: 6px !important;
          display: inline-block !important;
          background: #165DFF !important;
          color: #ffffff !important;
          font-size: 11px !important;
          line-height: 1 !important;
          font-weight: 500 !important;
          padding: 4px 8px !important;
          border-radius: 4px !important;
          border: none !important;
          cursor: pointer !important;
          transition: background 0.15s ease !important;
        }
        .__wbr_bubble_got_it__:hover {
          background: #3884FF !important;
        }
      </style>
      <span style="font-size:14px;line-height:1.2;flex-shrink:0;">💡</span>
      <div style="flex:1;min-width:0;color:#ffffff;font-size:11.5px;line-height:1.45;">
        <div class="__wbr_bubble_guide_text__">${guideHtml}</div>
        <button class="__wbr_bubble_got_it__">${t("widgetBubbleGotIt")}</button>
      </div>
      <button class="__wbr_bubble_close__" aria-label="Close">×</button>
      <div id="__wbr_widget_bubble_arrow__"></div>
    `;

    document.body.appendChild(bubble);
    this.bubbleElement = bubble;
    this.syncBubblePosition(root);

    const rAF =
      typeof requestAnimationFrame === "function"
        ? (fn: FrameRequestCallback) => requestAnimationFrame(fn)
        : (fn: FrameRequestCallback) => setTimeout(fn, 0);
    rAF(() => {
      bubble.classList.add("__wbr_bubble_visible__");
    });

    bubble.addEventListener("click", (e) => {
      e?.stopPropagation?.();
      this.dismissGuideBubble();
    });
  }

  private dismissGuideBubble(): void {
    if (this.bubbleTimer) {
      window.clearTimeout(this.bubbleTimer);
      this.bubbleTimer = undefined;
    }
    if (!this.bubbleElement) return;

    const el = this.bubbleElement;
    this.bubbleElement = undefined;
    this.isBubbleShowing = false;

    el.classList.remove("__wbr_bubble_visible__");
    window.setTimeout(() => {
      el.remove();
    }, 250);

    if (!this.isMobileMode) {
      this.resetCollapseTimer();
    }

    try {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        void chrome.storage.local
          .set({ hasSeenWidgetBubble: true })
          .catch(() => undefined);
      }
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("__wbr_widget_bubble_seen__", "true");
      }
    } catch {}
  }

  private syncCollapseToggleState(): void {
    const toggleBtn = this.container?.querySelector<HTMLButtonElement>(
      "#__wbr_collapse_toggle_btn__"
    );
    if (!toggleBtn || !this.container) return;
    const isCollapsed = this.container.classList.contains("__wbr_collapsed__");
    const tooltip = isCollapsed
      ? t("widgetExpandTooltip")
      : t("widgetCollapseTooltip");
    toggleBtn.textContent = isCollapsed ? "▴" : "▾";
    toggleBtn.title = tooltip;
    toggleBtn.setAttribute?.("aria-label", tooltip);
    toggleBtn.setAttribute?.("aria-expanded", isCollapsed ? "false" : "true");
  }

  private toggleManualCollapse(): void {
    if (!this.container || this._isSaving || this._isClosing) return;
    const isCollapsed = this.container.classList.contains("__wbr_collapsed__");
    if (isCollapsed) {
      this.isManuallyCollapsed = false;
      this.container.classList.remove("__wbr_collapsed__");
      this.syncCollapseToggleState();
      this.applyPosition(this.container, {
        right: this.container.style.right,
        top: this.container.style.top,
      });
      this.syncBubblePosition(this.container);
      this.resetCollapseTimer();
    } else {
      this.isManuallyCollapsed = true;
      if (this.autoCollapseTimer) {
        window.clearTimeout(this.autoCollapseTimer);
        this.autoCollapseTimer = undefined;
      }
      this.resetDiscardConfirm();
      this.container.classList.add("__wbr_collapsed__");
      this.syncCollapseToggleState();
      this.syncBubblePosition(this.container);
    }
  }

  private resetCollapseTimer(): void {
    if (this._isSaving || this.isMobileMode) return;
    if (this.isBubbleShowing) {
      this.keepExpanded();
      return;
    }
    if (this.autoCollapseTimer) {
      window.clearTimeout(this.autoCollapseTimer);
      this.autoCollapseTimer = undefined;
    }
    if (this.isManuallyCollapsed) {
      return;
    }
    if (this.container) {
      this.container.classList.remove("__wbr_collapsed__");
      this.syncCollapseToggleState();
    }
    if (this.isCoarseOrNoHoverPointer()) {
      return;
    }
    if (!this.isDragging && !this.isHovering) {
      this.autoCollapseTimer = window.setTimeout(() => {
        if (
          this.container &&
          !this.isDragging &&
          !this._isSaving &&
          !this.isMobileMode
        ) {
          this.resetDiscardConfirm();
          this.container.classList.add("__wbr_collapsed__");
          this.syncCollapseToggleState();
        }
      }, 1500);
    }
  }

  private resetDiscardConfirm(): void {
    if (this.discardConfirmTimer) {
      window.clearTimeout(this.discardConfirmTimer);
      this.discardConfirmTimer = undefined;
    }
    if (!this.isConfirmingDiscard) return;
    this.isConfirmingDiscard = false;
    const discardBtn = this.container?.querySelector<HTMLButtonElement>(
      "#__wbr_discard_btn__"
    );
    if (discardBtn) {
      discardBtn.classList?.remove("__wbr_confirming__");
      discardBtn.textContent = t("discardRecording");
    }
    const mobileDiscardBtn =
      this.mobileMenuElement?.querySelector<HTMLButtonElement>(
        "#__wbr_mobile_discard_btn__"
      );
    if (mobileDiscardBtn) {
      mobileDiscardBtn.classList?.remove("__wbr_confirming__");
      const label = mobileDiscardBtn.querySelector(
        ".__wbr_mobile_discard_label__"
      );
      if (label) {
        label.textContent = t("discardRecording");
      } else {
        mobileDiscardBtn.textContent = t("discardRecording");
      }
      mobileDiscardBtn.style?.removeProperty?.("background");
      mobileDiscardBtn.style?.removeProperty?.("color");
    }
  }

  private keepExpanded(): void {
    if (this.autoCollapseTimer) {
      window.clearTimeout(this.autoCollapseTimer);
      this.autoCollapseTimer = undefined;
    }
    if (this.container) {
      this.container.classList.remove("__wbr_collapsed__");
      this.syncCollapseToggleState();
    }
  }

  /**
   * 平滑淡出并卸载悬浮条挂件。
   * 导出完成后展示 Toast 的同时触发，避免突然闪退消失。
   */
  closeSmoothly(durationMs = 260): Promise<void> {
    if (this.closePromise) return this.closePromise;
    if (!this.container) {
      this.unmount();
      return Promise.resolve();
    }
    const safeDuration = Number.isFinite(durationMs)
      ? Math.max(0, durationMs)
      : 260;
    if (safeDuration <= 0) {
      this.unmount();
      return Promise.resolve();
    }
    this._isClosing = true;
    this.closeMobileMenu();
    this.container.classList.add("__wbr_closing__");
    this.closePromise = new Promise<void>((resolve) => {
      this.closeResolve = resolve;
      this.closeTimer = window.setTimeout(() => {
        this.finishClosing();
      }, safeDuration);
    });
    return this.closePromise;
  }

  private finishClosing(): void {
    if (this.closeTimer) {
      window.clearTimeout(this.closeTimer);
      this.closeTimer = undefined;
    }
    this.unmount();
  }

  unmount(): void {
    if (this.closeTimer) {
      window.clearTimeout(this.closeTimer);
      this.closeTimer = undefined;
    }
    const resolve = this.closeResolve;
    this.closeResolve = undefined;
    this.closePromise = undefined;
    this._isClosing = false;
    this._isSaving = false;
    this.isHovering = false;
    this.isDragging = false;
    this.isManuallyCollapsed = false;
    this.isBubbleShowing = false;
    this.isSelectingIssue = false;
    this.resetDiscardConfirm();

    this.closeMobileMenu();
    if (this.mobileIdleTimer) {
      window.clearTimeout(this.mobileIdleTimer);
      this.mobileIdleTimer = undefined;
    }
    if (this.cleanupMobileModeObserver) {
      this.cleanupMobileModeObserver();
      this.cleanupMobileModeObserver = undefined;
    }
    if (this.cleanupMobilePointerListeners) {
      this.cleanupMobilePointerListeners();
      this.cleanupMobilePointerListeners = undefined;
    }
    if (this.cleanupDragListeners) {
      this.cleanupDragListeners();
      this.cleanupDragListeners = undefined;
    }
    if (this.cleanupDragHandleListener) {
      this.cleanupDragHandleListener();
      this.cleanupDragHandleListener = undefined;
    }
    if (this.cleanupResizeListeners) {
      this.cleanupResizeListeners();
      this.cleanupResizeListeners = undefined;
    }
    if (this.bubbleTimer) {
      window.clearTimeout(this.bubbleTimer);
      this.bubbleTimer = undefined;
    }
    if (this.bubbleElement) {
      this.bubbleElement.remove();
      this.bubbleElement = undefined;
    }
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = undefined;
    }
    if (this.autoCollapseTimer) {
      window.clearTimeout(this.autoCollapseTimer);
      this.autoCollapseTimer = undefined;
    }
    if (this.cleanupCollapseListeners) {
      this.cleanupCollapseListeners();
      this.cleanupCollapseListeners = undefined;
    }
    if (this.container) {
      this.container.remove();
      this.container = undefined;
    }
    resolve?.();
  }

  setSavingState(saving: boolean, messageText?: string): void {
    if (this._isClosing) return;
    this._isSaving = saving;
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = undefined;
    }
    if (this.autoCollapseTimer) {
      window.clearTimeout(this.autoCollapseTimer);
      this.autoCollapseTimer = undefined;
    }
    if (this.mobileIdleTimer) {
      window.clearTimeout(this.mobileIdleTimer);
      this.mobileIdleTimer = undefined;
    }
    if (!this.container) return;
    if (saving) {
      this.closeMobileMenu();
      this.isHovering = false;
      this.isDragging = false;
      this.isManuallyCollapsed = false;
      this.resetDiscardConfirm();
      this.container.classList.remove("__wbr_collapsed__");
      this.container.classList.remove("__wbr_idle_dim__");
      this.container.classList.add("__wbr_saving__");
      this.syncCollapseToggleState();
      const display = this.container.querySelector("#__wbr_timer_display__");
      if (display) {
        display.innerHTML = `<span class="__wbr_spinner"></span>${messageText || t("saving")}`;
      }
    } else {
      this.container.classList.remove("__wbr_saving__");
      this.refreshTimerDisplay();
      if (!this.timerInterval) {
        this.timerInterval = window.setInterval(
          () => this.refreshTimerDisplay(),
          1000
        );
      }
      if (this.isMobileMode) {
        this.resetMobileIdleTimer();
      } else {
        this.resetCollapseTimer();
      }
    }
  }

  /**
   * 刷新录制计时显示（mm:ss）。供 1s 计时器与 setSavingState(false) 恢复共用；
   * 保存期间（_isSaving）不更新，避免覆盖 spinner 文案。
   */
  private refreshTimerDisplay(): void {
    if (this._isSaving) return;
    const isPaused =
      this.callbacks.isPaused?.() || this.callbacks.isIdlePaused();
    this.updatePauseState(isPaused);

    const timerText = this.getFormattedTimerText();
    const display = this.container?.querySelector("#__wbr_timer_display__");
    if (display) {
      display.textContent = timerText;
    }
    const mobileTimer = this.mobileMenuElement?.querySelector(
      "#__wbr_mobile_menu_timer__"
    );
    if (mobileTimer) {
      mobileTimer.textContent = timerText;
    }
  }

  setIssueSelecting(selecting: boolean): void {
    this.isSelectingIssue = selecting;
    const button =
      this.container?.querySelector<HTMLButtonElement>("#__wbr_issue_btn__");
    if (button) {
      button.disabled = selecting;
      button.textContent = selecting
        ? t("selecting")
        : `${t("markIssue")} (${this.shortcutKeyText})`;
      button.style.opacity = selecting ? ".72" : "1";
    }
    const mobileIssueLabel = this.mobileMenuElement?.querySelector(
      ".__wbr_mobile_issue_label__"
    );
    if (mobileIssueLabel) {
      mobileIssueLabel.textContent = selecting
        ? t("selecting")
        : t("markIssue");
    }
  }

  updateLanguage(): void {
    if (this._isClosing || this._isSaving || !this.container) return;
    const handle =
      this.container.querySelector<HTMLElement>(".__wbr_drag_handle");
    if (handle) handle.title = t("dragToMove");

    const issueBtn =
      this.container.querySelector<HTMLButtonElement>("#__wbr_issue_btn__");
    if (issueBtn) {
      issueBtn.title = t("widgetToolbarIssueTooltip", [this.shortcutKeyText]);
      issueBtn.textContent = this.isSelectingIssue
        ? t("selecting")
        : `${t("markIssue")} (${this.shortcutKeyText})`;
    }

    const ticketBtn = this.container.querySelector<HTMLButtonElement>(
      "#__wbr_ticket_btn__"
    );
    if (ticketBtn) {
      ticketBtn.title = t("widgetToolbarTicketTooltip");
      ticketBtn.textContent = t("createTicket");
    }

    const stopBtn =
      this.container.querySelector<HTMLButtonElement>("#__wbr_stop_btn__");
    if (stopBtn) {
      stopBtn.title = t("widgetToolbarStopTooltip", [this.stopShortcutKeyText]);
      stopBtn.textContent = t("stopRecording");
    }

    const discardBtn = this.container.querySelector<HTMLButtonElement>(
      "#__wbr_discard_btn__"
    );
    if (discardBtn) {
      discardBtn.title = t("widgetToolbarDiscardTooltip");
      discardBtn.textContent = this.isConfirmingDiscard
        ? t("confirmDiscard")
        : t("discardRecording");
    }

    this.syncCollapseToggleState();

    if (this.mobileMenuElement) {
      const dockBtn = this.mobileMenuElement.querySelector<HTMLButtonElement>(
        "#__wbr_mobile_dock_btn__"
      );
      if (dockBtn) {
        const nextDockText =
          this.mobileEdge === "right"
            ? t("widgetDockLeft")
            : t("widgetDockRight");
        dockBtn.title = nextDockText;
        dockBtn.setAttribute("aria-label", nextDockText);
        dockBtn.innerHTML = `${this.getMobileDockIcon(this.mobileEdge)}<span class="__wbr_dock_text__" style="display:none !important;">${nextDockText}</span>`;
      }
      const closeBtn = this.mobileMenuElement.querySelector<HTMLButtonElement>(
        "#__wbr_mobile_close_btn__"
      );
      if (closeBtn) {
        closeBtn.title = t("widgetCloseMenu");
        closeBtn.setAttribute("aria-label", t("widgetCloseMenu"));
      }
      const mobileIssueLabel = this.mobileMenuElement.querySelector(
        ".__wbr_mobile_issue_label__"
      );
      if (mobileIssueLabel) {
        mobileIssueLabel.textContent = this.isSelectingIssue
          ? t("selecting")
          : t("markIssue");
      }
      const mobileIssueShortcut = this.mobileMenuElement.querySelector(
        ".__wbr_mobile_issue_shortcut__"
      );
      if (mobileIssueShortcut) {
        mobileIssueShortcut.textContent = this.shortcutKeyText;
      }
      const mobileTicketLabel =
        this.mobileMenuElement.querySelector(".__wbr_mobile_ticket_label__") ||
        this.mobileMenuElement.querySelector("#__wbr_mobile_ticket_btn__ span");
      if (mobileTicketLabel) {
        mobileTicketLabel.textContent = t("createTicket");
      }
      const mobileStopLabel =
        this.mobileMenuElement.querySelector(".__wbr_mobile_stop_label__") ||
        this.mobileMenuElement.querySelector(
          "#__wbr_mobile_stop_btn__ span:first-child"
        );
      if (mobileStopLabel) {
        mobileStopLabel.textContent = t("widgetExportAiShort");
      }
      const mobileStopShortcut = this.mobileMenuElement.querySelector(
        ".__wbr_mobile_stop_shortcut__"
      );
      if (mobileStopShortcut) {
        mobileStopShortcut.textContent = this.stopShortcutKeyText;
      }
      const mobileDiscardLabel =
        this.mobileMenuElement.querySelector(".__wbr_mobile_discard_label__") ||
        this.mobileMenuElement.querySelector(
          "#__wbr_mobile_discard_btn__ span"
        );
      if (mobileDiscardLabel) {
        mobileDiscardLabel.textContent = this.isConfirmingDiscard
          ? t("confirmDiscard")
          : t("discardRecording");
      }
    }

    if (this.bubbleElement) {
      const guideTextEl = this.bubbleElement.querySelector?.(
        ".__wbr_bubble_guide_text__"
      );
      if (guideTextEl) {
        guideTextEl.innerHTML = this.buildBubbleGuideHtml();
      }
      const gotItBtn = this.bubbleElement.querySelector?.(
        ".__wbr_bubble_got_it__"
      );
      if (gotItBtn) {
        gotItBtn.textContent = t("widgetBubbleGotIt");
      }
    }
  }

  updatePauseState(paused: boolean): void {
    if (this._isClosing || this._isSaving || !this.container) return;
    const dot = this.container.querySelector<HTMLElement>(".__wbr_dot");
    const recTag =
      this.container.querySelector<HTMLElement>("[data-wbr-rec-tag]");
    if (dot) {
      dot.style.setProperty(
        "background",
        paused ? "#ffc107" : "#f53f3f",
        "important"
      );
      dot.style.setProperty(
        "animation",
        paused ? "none" : "wbr-pulse 1.5s infinite",
        "important"
      );
    }
    if (recTag) {
      const isIdle = paused && this.callbacks.isIdlePaused();
      recTag.textContent = paused
        ? isIdle
          ? t("idlePaused")
          : t("widgetPaused")
        : "REC";
      recTag.style.color = paused ? "#ffc107" : "#fff";
    }
  }

  updateHealth(
    health?: import("../../../shared/protocol").RecordingHealthInfo
  ): void {
    if (this._isClosing || this._isSaving || !health) return;
    this.currentHealthMessage =
      health.code !== "RECORDING" && health.message
        ? health.message
        : undefined;

    if (!this.container) return;
    const dot = this.container.querySelector<HTMLElement>(".__wbr_dot");
    const recTag =
      this.container.querySelector<HTMLElement>("[data-wbr-rec-tag]");
    const msgEl = this.container.querySelector<HTMLElement>(
      "#__wbr_health_msg__"
    );

    if (dot) {
      dot.style.setProperty("background", health.badgeColor, "important");
      dot.style.setProperty(
        "animation",
        health.code === "RECORDING" ? "wbr-pulse 1.5s infinite" : "none",
        "important"
      );
    }
    if (recTag) {
      recTag.textContent = health.badgeText;
      recTag.style.color = health.badgeColor;
    }
    if (msgEl) {
      if (health.code !== "RECORDING" && health.message) {
        msgEl.style.display = "inline-block";
        msgEl.textContent = `⚠️ ${health.message}`;
        msgEl.title = health.message;
      } else {
        msgEl.style.display = "none";
        msgEl.textContent = "";
      }
    }

    const mobileHealthMsg = this.mobileMenuElement?.querySelector<HTMLElement>(
      "#__wbr_mobile_health_msg__"
    );
    if (mobileHealthMsg) {
      if (this.currentHealthMessage) {
        mobileHealthMsg.style.display = "block";
        mobileHealthMsg.textContent = `⚠️ ${this.currentHealthMessage}`;
        mobileHealthMsg.title = this.currentHealthMessage;
      } else {
        mobileHealthMsg.style.display = "none";
        mobileHealthMsg.textContent = "";
      }
    }
  }

  showToast(
    message: string,
    durationMs: number = 4000,
    tone: "normal" | "error" = "normal",
    action?: ToastAction
  ): void {
    const existing = document.querySelector("#__wbr_toast__");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.id = "__wbr_toast__";
    toast.setAttribute("data-wbr-ignore", "true");
    toast.style.cssText = `${FLOATING_TOAST_BASE_CSS} pointer-events: auto !important;`;

    const actionHtml = action
      ? `<span style="color:#c9cdd4!important;margin:0 4px!important;user-select:none!important;">·</span><span id="__wbr_toast_action__" role="button" tabindex="0" style="color:#165dff!important;cursor:pointer!important;text-decoration:none!important;font-weight:500!important;white-space:normal!important;word-break:break-word!important;transition:color 0.15s ease!important;">${action.label}</span>`
      : "";

    toast.innerHTML = buildToastInnerHtml(message, tone, actionHtml);

    if (action) {
      const btn = toast.querySelector(
        "#__wbr_toast_action__"
      ) as HTMLElement | null;
      if (btn) {
        btn.addEventListener("mouseenter", () => {
          btn.style.color = "#0e42d2";
          btn.style.textDecoration = "underline";
        });
        btn.addEventListener("mouseleave", () => {
          btn.style.color = "#165dff";
          btn.style.textDecoration = "none";
        });
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          try {
            action.onClick();
          } catch {
            // 忽略回调执行异常
          }
          animateToastOutAndRemove(toast);
        });
      }
    }
    document.body.appendChild(toast);
    animateToastIn(toast);

    let hideTimeout: number | undefined;
    const startHideTimer = () => {
      hideTimeout = window.setTimeout(() => {
        animateToastOutAndRemove(toast);
      }, durationMs);
    };

    toast.addEventListener("mouseenter", () => {
      if (hideTimeout) {
        window.clearTimeout(hideTimeout);
        hideTimeout = undefined;
      }
    });

    toast.addEventListener("mouseleave", () => {
      startHideTimer();
    });

    startHideTimer();
  }
}
