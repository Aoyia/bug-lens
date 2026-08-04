import { t } from "../../../shared/i18n.ts";
import { tryShowOnboardingGuide } from "../../../guide/onboarding-tour.ts";

export type WidgetCallbacks = {
  onStop(): void;
  onStopAndExport(): void;
  onStopAndDiscard(): void;
  onMarkIssue(): void;
  getStartedAtEpochMs(): number;
  isIdlePaused(): boolean;
};

export class RecordingWidget {
  private container: HTMLDivElement | undefined;
  private timerInterval: number | undefined;
  private autoCollapseTimer: number | undefined;
  private isDragging = false;
  private cleanupCollapseListeners?: () => void;
  private _isSaving = false;
  private readonly callbacks: WidgetCallbacks;
  private readonly isMac: boolean;
  readonly shortcutKeyText: string;

  get isSaving(): boolean {
    return this._isSaving;
  }

  constructor(callbacks: WidgetCallbacks) {
    this.callbacks = callbacks;
    this.isMac =
      typeof navigator !== "undefined" &&
      Boolean(
        /(Mac|iPhone|iPod|iPad)/i.test(
          navigator.platform || navigator.userAgent
        )
      );
    this.shortcutKeyText = this.isMac ? "Option+S" : "Alt+S";
  }

  get isMounted(): boolean {
    return Boolean(this.container);
  }

  mount(): void {
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
          max-width: none !important;
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
          transition: height 0.32s cubic-bezier(0.25, 1, 0.5, 1), border-radius 0.32s cubic-bezier(0.25, 1, 0.5, 1), padding 0.32s cubic-bezier(0.25, 1, 0.5, 1), background 0.32s ease, box-shadow 0.32s ease !important;
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
        #__wbr_recording_widget__.__wbr_saving__ .__wbr_drag_handle,
        #__wbr_recording_widget__.__wbr_saving__ .__wbr_dot,
        #__wbr_recording_widget__.__wbr_saving__ [data-wbr-rec-tag],
        #__wbr_recording_widget__.__wbr_saving__ .__wbr_btn_group {
          display: none !important;
        }
        .__wbr_btn_group {
          display: flex !important;
          flex-direction: row !important;
          align-items: center !important;
          gap: 8px !important;
          max-width: 420px !important;
          opacity: 1 !important;
          overflow: hidden !important;
          white-space: nowrap !important;
          flex-shrink: 0 !important;
          transition: max-width 0.32s cubic-bezier(0.4, 0.0, 0.2, 1), opacity 0.22s ease-out, transform 0.32s cubic-bezier(0.4, 0.0, 0.2, 1) !important;
          transform: scale(1) !important;
          transform-origin: left center !important;
        }
        #__wbr_recording_widget__.__wbr_collapsed__ .__wbr_btn_group {
          max-width: 0px !important;
          opacity: 0 !important;
          gap: 0px !important;
          transform: scale(0.9) !important;
          pointer-events: none !important;
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
          width: 8px !important; height: 8px !important; border-radius: 50% !important; background: #f53f3f !important;
          display: inline-block !important;
          flex-shrink: 0 !important;
          animation: wbr-pulse 1.5s infinite !important;
        }
        .__wbr_btn {
          border: none !important; background: #f53f3f !important; color: #fff !important; border-radius: 4px !important;
          padding: 5px 10px !important; font-size: 11px !important; font-weight: 500 !important; cursor: pointer !important;
          transition: background 0.15s ease !important;
          outline: none !important;
          height: auto !important;
          line-height: 1.2 !important;
          margin: 0 !important;
          white-space: nowrap !important;
          flex-shrink: 0 !important;
        }
        .__wbr_btn:hover { background: #f76565 !important; }
        .__wbr_btn:active { background: #cb2727 !important; }
        .__wbr_btn_export:hover { background: #4080ff !important; }
        .__wbr_btn_export:active { background: #0e42d2 !important; }
        .__wbr_btn_discard:hover { background: #606d7d !important; }
        .__wbr_btn_discard:active { background: #3c4652 !important; }
        .__wbr_timer { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important; font-size: 12px !important; color: #e5e6eb !important; font-weight: 600 !important; flex-shrink: 0 !important; }
      </style>
      <span class="__wbr_drag_handle" title="拖拽移动位置">⋮⋮</span>
      <span class="__wbr_dot"></span>
      <span data-wbr-rec-tag style="font-weight:600;letter-spacing:0.5px;color:#fff;flex-shrink:0;">REC</span>
      <span id="__wbr_timer_display__" class="__wbr_timer">00:00</span>
      <div class="__wbr_btn_group">
        <span id="__wbr_health_msg__" style="font-size:11px;color:#ffc107;display:none;max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title=""></span>
        <button id="__wbr_issue_btn__" class="__wbr_btn" style="background:#b42318;" title="${t("shortcut")}: ${this.shortcutKeyText}">${t("markIssue")} (${this.shortcutKeyText})</button>
        <button id="__wbr_stop_btn__" class="__wbr_btn">${t("stopRecording")}</button>
        <button id="__wbr_stop_export_btn__" class="__wbr_btn __wbr_btn_export" style="background:#165dff;">${t("stopAndExport")}</button>
        <button id="__wbr_discard_btn__" class="__wbr_btn __wbr_btn_discard" style="background:#4e5969;">${t("stopAndDiscard")}</button>
      </div>
    `;

    // Clear saved drag position on new recording session so it resets to default position
    try {
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.removeItem("__wbr_widget_pos__");
      }
    } catch {}

    const attach = () => {
      if (document.body) {
        document.body.appendChild(root);
        this.container = root;

        const stopBtn = root.querySelector("#__wbr_stop_btn__");
        if (stopBtn) {
          stopBtn.addEventListener(
            "click",
            (e) => {
              e.stopPropagation();
              e.preventDefault();
              this.callbacks.onStop();
            },
            true
          );
        }
        const stopExportBtn = root.querySelector("#__wbr_stop_export_btn__");
        if (stopExportBtn) {
          stopExportBtn.addEventListener(
            "click",
            (e) => {
              e.stopPropagation();
              e.preventDefault();
              this.callbacks.onStopAndExport();
            },
            true
          );
        }
        const discardBtn = root.querySelector("#__wbr_discard_btn__");
        if (discardBtn) {
          discardBtn.addEventListener(
            "click",
            (e) => {
              e.stopPropagation();
              e.preventDefault();
              this.callbacks.onStopAndDiscard();
            },
            true
          );
        }
        const issueBtn = root.querySelector("#__wbr_issue_btn__");
        issueBtn?.addEventListener(
          "click",
          (e) => {
            e.stopPropagation();
            e.preventDefault();
            this.callbacks.onMarkIssue();
          },
          true
        );

        // Setup Drag Handle Logic
        const dragHandle =
          root.querySelector<HTMLElement>(".__wbr_drag_handle");
        if (dragHandle) {
          const onMouseDown = (e: MouseEvent) => {
            e.stopPropagation();
            e.preventDefault();
            this.isDragging = true;
            if (this.autoCollapseTimer) {
              window.clearTimeout(this.autoCollapseTimer);
              this.autoCollapseTimer = undefined;
            }
            root.classList.remove("__wbr_collapsed__");

            const rect = root.getBoundingClientRect();
            const offsetX = e.clientX - rect.left;
            const offsetY = e.clientY - rect.top;

            const onMouseMove = (moveEvt: MouseEvent) => {
              moveEvt.preventDefault();
              const winWidth =
                window.innerWidth || document.documentElement.clientWidth;
              const winHeight =
                window.innerHeight || document.documentElement.clientHeight;

              let left = moveEvt.clientX - offsetX;
              let top = moveEvt.clientY - offsetY;

              const maxLeft = Math.max(0, winWidth - rect.width);
              const maxTop = Math.max(0, winHeight - rect.height);
              left = Math.min(Math.max(0, left), maxLeft);
              top = Math.min(Math.max(0, top), maxTop);

              // 统一采用右边缘定位 (right)，使收缩时固定右边，左侧向右平移收缩
              const right = Math.max(0, winWidth - (left + rect.width));

              const topPx = `${top}px`;
              const rightPx = `${right}px`;
              root.style.setProperty("top", topPx, "important");
              root.style.setProperty("right", rightPx, "important");
              root.style.setProperty("bottom", "auto", "important");
              root.style.setProperty("left", "auto", "important");
            };

            const onMouseUp = () => {
              this.isDragging = false;
              window.removeEventListener("mousemove", onMouseMove);
              window.removeEventListener("mouseup", onMouseUp);

              try {
                if (typeof sessionStorage !== "undefined") {
                  const savedPos = {
                    right: root.style.right,
                    top: root.style.top,
                  };
                  sessionStorage.setItem(
                    "__wbr_widget_pos__",
                    JSON.stringify(savedPos)
                  );
                }
              } catch {}

              this.resetCollapseTimer();
            };

            window.addEventListener("mousemove", onMouseMove);
            window.addEventListener("mouseup", onMouseUp);
          };

          dragHandle.addEventListener(
            "mousedown",
            onMouseDown as EventListener
          );
        }

        // Setup Auto-Collapse 3s Logic
        const onUserActivity = () => {
          if (this._isSaving) return;
          this.resetCollapseTimer();
        };

        root.addEventListener("mouseenter", onUserActivity);
        root.addEventListener("mousemove", onUserActivity);
        root.addEventListener("focusin", onUserActivity);

        const onMouseLeave = () => {
          if (this._isSaving) return;
          if (this.autoCollapseTimer) {
            window.clearTimeout(this.autoCollapseTimer);
          }
          if (!this.isDragging) {
            this.autoCollapseTimer = window.setTimeout(() => {
              if (this.container && !this.isDragging && !this._isSaving) {
                this.container.classList.add("__wbr_collapsed__");
              }
            }, 1500);
          }
        };

        root.addEventListener("mouseleave", onMouseLeave);

        this.cleanupCollapseListeners = () => {
          root.removeEventListener("mouseenter", onUserActivity);
          root.removeEventListener("mousemove", onUserActivity);
          root.removeEventListener("focusin", onUserActivity);
          root.removeEventListener("mouseleave", onMouseLeave);
        };

        // Start initial collapse countdown
        this.resetCollapseTimer();

        const updateTimer = () => {
          if (this._isSaving) return;
          const display = root.querySelector("#__wbr_timer_display__");
          if (display) {
            const startTime = this.callbacks.getStartedAtEpochMs();
            const sec = Math.max(
              0,
              Math.floor((Date.now() - startTime) / 1000)
            );
            const m = String(Math.floor(sec / 60)).padStart(2, "0");
            const s = String(sec % 60).padStart(2, "0");
            display.textContent = this.callbacks.isIdlePaused()
              ? `${m}:${s} (${t("idlePaused")})`
              : `${m}:${s}`;
          }
        };
        updateTimer();
        this.timerInterval = window.setInterval(updateTimer, 1000);
        void tryShowOnboardingGuide(root);
      } else {
        window.addEventListener("DOMContentLoaded", attach, { once: true });
      }
    };
    attach();
  }

  private resetCollapseTimer(): void {
    if (this._isSaving) return;
    if (this.autoCollapseTimer) {
      window.clearTimeout(this.autoCollapseTimer);
      this.autoCollapseTimer = undefined;
    }
    if (this.container) {
      this.container.classList.remove("__wbr_collapsed__");
    }
    if (!this.isDragging) {
      this.autoCollapseTimer = window.setTimeout(() => {
        if (this.container && !this.isDragging && !this._isSaving) {
          this.container.classList.add("__wbr_collapsed__");
        }
      }, 1500);
    }
  }

  unmount(): void {
    this._isSaving = false;
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
  }

  setSavingState(saving: boolean, messageText?: string): void {
    this._isSaving = saving;
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = undefined;
    }
    if (this.autoCollapseTimer) {
      window.clearTimeout(this.autoCollapseTimer);
      this.autoCollapseTimer = undefined;
    }
    if (!this.container) return;
    if (saving) {
      this.container.classList.remove("__wbr_collapsed__");
      this.container.classList.add("__wbr_saving__");
      const display = this.container.querySelector("#__wbr_timer_display__");
      if (display) {
        display.innerHTML = `<span class="__wbr_spinner"></span>${messageText || t("saving")}`;
      }
    } else {
      this.container.classList.remove("__wbr_saving__");
    }
  }

  showToast(message: string): void {
    const root = document.body;
    if (!root) return;
    const oldToast = document.querySelector("#__wbr_widget_toast__");
    if (oldToast) oldToast.remove();

    const toast = document.createElement("div");
    toast.id = "__wbr_widget_toast__";
    toast.setAttribute("data-wbr-ignore", "true");
    toast.style.cssText = `
      position: fixed !important;
      bottom: 72px !important;
      right: 24px !important;
      z-index: 2147483647 !important;
      display: flex !important;
      align-items: center !important;
      gap: 8px !important;
      padding: 10px 16px !important;
      background: rgba(20, 24, 31, 0.92) !important;
      backdrop-filter: blur(14px) !important;
      -webkit-backdrop-filter: blur(14px) !important;
      border: 1px solid rgba(255, 255, 255, 0.18) !important;
      color: #ffffff !important;
      border-radius: 8px !important;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.36) !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      font-size: 13px !important;
      font-weight: 500 !important;
      pointer-events: none !important;
      transition: opacity 0.25s ease, transform 0.25s ease !important;
      opacity: 0 !important;
      transform: translateY(8px) !important;
    `;

    toast.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#52c41a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 11.08V12a10 10 10 1 1-5.93-9.14"></path>
        <polyline points="22 4 12 14.01 9 11.01"></polyline>
      </svg>
      <span>${message}</span>
    `;

    root.appendChild(toast);

    requestAnimationFrame(() => {
      toast.style.opacity = "1";
      toast.style.transform = "translateY(0)";
    });

    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(8px)";
      setTimeout(() => toast.remove(), 250);
    }, 3000);
  }

  setIssueSelecting(selecting: boolean): void {
    const button =
      this.container?.querySelector<HTMLButtonElement>("#__wbr_issue_btn__");
    if (!button) return;
    button.disabled = selecting;
    button.textContent = selecting
      ? t("selecting")
      : `${t("markIssue")} (${this.shortcutKeyText})`;
    button.style.opacity = selecting ? ".72" : "1";
  }

  updatePauseState(paused: boolean): void {
    if (!this.container) return;
    const dot = this.container.querySelector<HTMLElement>(".__wbr_dot");
    const recTag =
      this.container.querySelector<HTMLElement>("[data-wbr-rec-tag]");
    if (dot) {
      dot.style.background = paused ? "#ffc107" : "#f53f3f";
      dot.style.animation = paused ? "none" : "wbr-pulse 1.5s infinite";
    }
    if (recTag) {
      recTag.textContent = paused ? "PAUSED" : "REC";
      recTag.style.color = paused ? "#ffc107" : "#fff";
    }
  }

  updateHealth(
    health?: import("../../../shared/protocol").RecordingHealthInfo
  ): void {
    if (!this.container || !health) return;
    const dot = this.container.querySelector<HTMLElement>(".__wbr_dot");
    const recTag =
      this.container.querySelector<HTMLElement>("[data-wbr-rec-tag]");
    const msgEl = this.container.querySelector<HTMLElement>(
      "#__wbr_health_msg__"
    );

    if (dot) {
      dot.style.background = health.badgeColor;
      dot.style.animation =
        health.code === "RECORDING" ? "wbr-pulse 1.5s infinite" : "none";
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
  }
}
