import { t } from "../../../shared/i18n";
import { tryShowOnboardingGuide } from "../../../guide/onboarding-tour";

export type WidgetCallbacks = {
  onStop(): void;
  onStopAndExport(): void;
  onMarkIssue(): void;
  getStartedAtEpochMs(): number;
  isIdlePaused(): boolean;
};

export class RecordingWidget {
  private container: HTMLDivElement | undefined;
  private timerInterval: number | undefined;
  private readonly isMac: boolean;
  readonly shortcutKeyText: string;

  constructor(private readonly callbacks: WidgetCallbacks) {
    this.isMac = typeof navigator !== "undefined" && Boolean(/(Mac|iPhone|iPod|iPad)/i.test(navigator.platform || navigator.userAgent));
    this.shortcutKeyText = this.isMac ? "Option+S" : "Alt+S";
  }

  get isMounted(): boolean { return Boolean(this.container); }

  mount(): void {
    if (this.container || window.top !== window) return;
    const root = document.createElement("div");
    root.id = "__wbr_recording_widget__";
    root.setAttribute("data-wbr-ignore", "true");

    Object.assign(root.style, {
      position: "fixed",
      top: "auto",
      bottom: "24px",
      left: "auto",
      right: "24px",
      width: "auto",
      height: "auto",
      minWidth: "0",
      maxWidth: "none",
      minHeight: "0",
      maxHeight: "none",
      margin: "0",
      boxSizing: "border-box",
      zIndex: "2147483647",
      display: "flex",
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "flex-start",
      gap: "10px",
      padding: "8px 14px",
      background: "rgba(29, 33, 41, 0.75)",
      backdropFilter: "blur(12px)",
      webkitBackdropFilter: "blur(12px)",
      border: "1px solid rgba(255, 255, 255, 0.15)",
      color: "#ffffff",
      borderRadius: "6px",
      boxShadow: "0 4px 18px rgba(0, 0, 0, 0.28)",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      fontSize: "12px",
      lineHeight: "1",
      userSelect: "none"
    });

    root.innerHTML = `
      <style>
        #__wbr_recording_widget__ {
          position: fixed !important;
          top: auto !important;
          bottom: 24px !important;
          left: auto !important;
          right: 24px !important;
          width: auto !important;
          height: auto !important;
          min-width: 0 !important;
          max-width: none !important;
          min-height: 0 !important;
          max-height: none !important;
          margin: 0 !important;
          padding: 8px 14px !important;
          box-sizing: border-box !important;
          z-index: 2147483647 !important;
          display: flex !important;
          flex-direction: row !important;
          align-items: center !important;
          justify-content: flex-start !important;
          gap: 10px !important;
          background: rgba(29, 33, 41, 0.75) !important;
          backdrop-filter: blur(12px) !important;
          -webkit-backdrop-filter: blur(12px) !important;
          border: 1px solid rgba(255, 255, 255, 0.15) !important;
          color: #ffffff !important;
          border-radius: 6px !important;
          box-shadow: 0 4px 18px rgba(0, 0, 0, 0.28) !important;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
          font-size: 12px !important;
          line-height: 1 !important;
          user-select: none !important;
          transform: none !important;
          align-self: auto !important;
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
        }
        .__wbr_btn:hover { background: #f76565 !important; }
        .__wbr_btn:active { background: #cb2727 !important; }
        .__wbr_btn_export:hover { background: #4080ff !important; }
        .__wbr_btn_export:active { background: #0e42d2 !important; }
        .__wbr_timer { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important; font-size: 12px !important; color: #e5e6eb !important; font-weight: 600 !important; }
      </style>
      <span class="__wbr_dot"></span>
      <span data-wbr-rec-tag style="font-weight:600;letter-spacing:0.5px;color:#fff;">REC</span>
      <span id="__wbr_timer_display__" class="__wbr_timer">00:00</span>
      <button id="__wbr_issue_btn__" class="__wbr_btn" style="background:#b42318;" title="${t("shortcut")}: ${this.shortcutKeyText}">${t("markIssue")} (${this.shortcutKeyText})</button>
      <button id="__wbr_stop_btn__" class="__wbr_btn">${t("stopRecording")}</button>
      <button id="__wbr_stop_export_btn__" class="__wbr_btn __wbr_btn_export" style="background:#165dff;">${t("stopAndExport")}</button>
    `;

    const attach = () => {
      if (document.body) {
        document.body.appendChild(root);
        this.container = root;

        const stopBtn = root.querySelector("#__wbr_stop_btn__");
        if (stopBtn) {
          stopBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            e.preventDefault();
            this.callbacks.onStop();
          }, true);
        }
        const stopExportBtn = root.querySelector("#__wbr_stop_export_btn__");
        if (stopExportBtn) {
          stopExportBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            e.preventDefault();
            this.callbacks.onStopAndExport();
          }, true);
        }
        const issueBtn = root.querySelector("#__wbr_issue_btn__");
        issueBtn?.addEventListener("click", (e) => {
          e.stopPropagation();
          e.preventDefault();
          this.callbacks.onMarkIssue();
        }, true);

        const startTime = this.callbacks.getStartedAtEpochMs();
        const updateTimer = () => {
          const display = root.querySelector("#__wbr_timer_display__");
          if (display) {
            const sec = Math.floor((Date.now() - startTime) / 1000);
            const m = String(Math.floor(sec / 60)).padStart(2, "0");
            const s = String(sec % 60).padStart(2, "0");
            display.textContent = this.callbacks.isIdlePaused() ? `${m}:${s} (${t("idlePaused")})` : `${m}:${s}`;
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

  unmount(): void {
    if (this.timerInterval) { clearInterval(this.timerInterval); this.timerInterval = undefined; }
    if (this.container) { this.container.remove(); this.container = undefined; }
  }

  setIssueSelecting(selecting: boolean): void {
    const button = this.container?.querySelector<HTMLButtonElement>("#__wbr_issue_btn__");
    if (!button) return;
    button.disabled = selecting;
    button.textContent = selecting ? t("selecting") : `${t("markIssue")} (${this.shortcutKeyText})`;
    button.style.opacity = selecting ? ".72" : "1";
  }

  updatePauseState(paused: boolean): void {
    if (!this.container) return;
    const dot = this.container.querySelector<HTMLElement>(".__wbr_dot");
    const recTag = this.container.querySelector<HTMLElement>("[data-wbr-rec-tag]");
    if (dot) {
      dot.style.background = paused ? "#ffc107" : "#f53f3f";
      dot.style.animation = paused ? "none" : "wbr-pulse 1.5s infinite";
    }
    if (recTag) {
      recTag.textContent = paused ? "PAUSED" : "REC";
      recTag.style.color = paused ? "#ffc107" : "#fff";
    }
  }
}
