import { defaultAnnotation } from "../../domain/issue-scene";
import { message, type AnnotationModel, type DomAncestorSnapshot, type ElementDescriptor, type InteractionRecord, type TargetDomSnapshot } from "../../shared/protocol";
import { detectVue } from "./vue-detector";
import { t } from "../../shared/i18n";
import { tryShowOnboardingGuide } from "../../guide/onboarding-tour";

type ContentSession = { sessionId: string; nonce: string; startedAtEpochMs?: number; privacyMode: "safe" | "raw" };
type ContentController = { refresh: (next: ContentSession | undefined) => void };

declare global {
  interface Window {
    __WEB_BUG_RECORDER_INSTALLED__?: boolean;
    __WEB_BUG_RECORDER_SESSION__?: ContentSession;
    __WEB_BUG_RECORDER_CONTROLLER__?: ContentController;
  }
}

const existingController = window.__WEB_BUG_RECORDER_CONTROLLER__;
if (existingController) {
  void chrome.runtime.sendMessage(message("content/hello", { url: location.href, title: document.title })).then((response) => {
    existingController.refresh(response?.active && response.sessionId && response.nonce
      ? { sessionId: response.sessionId, nonce: response.nonce, startedAtEpochMs: response.startedAtEpochMs, privacyMode: response.privacyMode === "raw" ? "raw" : "safe" }
      : undefined);
  }).catch(() => undefined);
} else {
  window.__WEB_BUG_RECORDER_INSTALLED__ = true;
  let session: ContentSession | undefined;
  const pending = new Map<string, InteractionRecord>();
  let widgetContainer: HTMLDivElement | undefined;
  let timerInterval: number | undefined;
  let issueSelectionActive = false;
  let issueSelectionStartedAtEpochMs: number | undefined;
  let issueSelectionLayer: HTMLDivElement | undefined;
  let issueEditor: HTMLDivElement | undefined;
  let selectedIssueElement: Element | undefined;
  let issueEscapeListener: ((event: KeyboardEvent) => void) | undefined;
  const pendingInputs = new Map<Element, { timer: number; record: InteractionRecord }>();
  let scrollPreventListener: ((event: Event) => void) | undefined;
  let scrollKeyPreventListener: ((event: KeyboardEvent) => void) | undefined;
  let originalDocOverflow: string | undefined;
  let originalBodyOverflow: string | undefined;

  function lockScroll(): void {
    if (scrollPreventListener) return;
    originalDocOverflow = document.documentElement.style.overflow;
    originalBodyOverflow = document.body?.style.overflow;
    document.documentElement.style.overflow = "hidden";
    if (document.body) document.body.style.overflow = "hidden";

    scrollPreventListener = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    const scrollKeys = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);
    scrollKeyPreventListener = (event: KeyboardEvent) => {
      if (scrollKeys.has(event.key)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("wheel", scrollPreventListener, { passive: false, capture: true });
    window.addEventListener("touchmove", scrollPreventListener, { passive: false, capture: true });
    window.addEventListener("keydown", scrollKeyPreventListener, { capture: true });
  }

  function unlockScroll(): void {
    if (originalDocOverflow !== undefined) {
      document.documentElement.style.overflow = originalDocOverflow;
      originalDocOverflow = undefined;
    }
    if (originalBodyOverflow !== undefined && document.body) {
      document.body.style.overflow = originalBodyOverflow;
      originalBodyOverflow = undefined;
    }
    if (scrollPreventListener) {
      window.removeEventListener("wheel", scrollPreventListener, true);
      window.removeEventListener("touchmove", scrollPreventListener, true);
      scrollPreventListener = undefined;
    }
    if (scrollKeyPreventListener) {
      window.removeEventListener("keydown", scrollKeyPreventListener, true);
      scrollKeyPreventListener = undefined;
    }
  }

  const isMac = typeof navigator !== "undefined" && Boolean(/(Mac|iPhone|iPod|iPad)/i.test(navigator.platform || navigator.userAgent));
  const shortcutKeyText = isMac ? "Option+S" : "Alt+S";

  function setIssueButtonSelecting(selecting: boolean): void {
    const button = widgetContainer?.querySelector<HTMLButtonElement>("#__wbr_issue_btn__");
    if (!button) return;
    button.disabled = selecting;
    button.textContent = selecting ? t("selecting") : `${t("markIssue")} (${shortcutKeyText})`;
    button.style.opacity = selecting ? ".72" : "1";
  }

  function renderRecordingWidget(): void {
    if (widgetContainer || window.top !== window) return;
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
      <button id="__wbr_issue_btn__" class="__wbr_btn" style="background:#b42318;" title="${t("shortcut")}: ${shortcutKeyText}">${t("markIssue")} (${shortcutKeyText})</button>
      <button id="__wbr_stop_btn__" class="__wbr_btn">${t("stopRecording")}</button>
      <button id="__wbr_stop_export_btn__" class="__wbr_btn __wbr_btn_export" style="background:#165dff;">${t("stopAndExport")}</button>
    `;

    const attach = () => {
      if (document.body) {
        document.body.appendChild(root);
        widgetContainer = root;

        const stopBtn = root.querySelector("#__wbr_stop_btn__");
        if (stopBtn) {
          stopBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            e.preventDefault();
            void chrome.runtime.sendMessage(message("session/stop", { commandId: crypto.randomUUID() }));
            removeRecordingWidget();
          }, true);
        }
        const stopExportBtn = root.querySelector("#__wbr_stop_export_btn__");
        if (stopExportBtn) {
          stopExportBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            e.preventDefault();
            void chrome.runtime.sendMessage(message("session/stop", { commandId: crypto.randomUUID(), autoExport: true }));
            removeRecordingWidget();
          }, true);
        }
        const issueBtn = root.querySelector("#__wbr_issue_btn__");
        issueBtn?.addEventListener("click", (e) => {
          e.stopPropagation();
          e.preventDefault();
          beginIssueSelection();
        }, true);

        const startTime = session?.startedAtEpochMs || Date.now();
        const updateTimer = () => {
          const display = root.querySelector("#__wbr_timer_display__");
          if (display) {
            const sec = Math.floor((Date.now() - startTime) / 1000);
            const m = String(Math.floor(sec / 60)).padStart(2, "0");
            const s = String(sec % 60).padStart(2, "0");
            display.textContent = isIdlePaused ? `${m}:${s} (${t("idlePaused")})` : `${m}:${s}`;
          }
        };
        updateTimer();
        timerInterval = window.setInterval(updateTimer, 1000);
        void tryShowOnboardingGuide(root);
      } else {
        window.addEventListener("DOMContentLoaded", attach, { once: true });
      }
    };
    attach();
  }

  function removeIssueUi(): void {
    unlockScroll();
    const wasActive = issueSelectionActive || Boolean(issueEditor);
    issueSelectionActive = false;
    setIssueButtonSelecting(false);
    if (issueEscapeListener) window.removeEventListener("keydown", issueEscapeListener, true);
    issueEscapeListener = undefined;
    issueSelectionLayer?.remove();
    issueSelectionLayer = undefined;
    issueEditor?.remove();
    issueEditor = undefined;
    selectedIssueElement = undefined;
    if (wasActive && session) {
      void chrome.runtime.sendMessage(message("issue-scene/cancel-selection", {}, session.sessionId));
    }
  }

  function snapshotHtml(element: Element): { sanitizedHtml?: string; htmlTruncated?: boolean } {
    try {
      const clone = element.cloneNode(true) as Element;
      clone.querySelectorAll("script,style,iframe,object,embed").forEach((node) => node.remove());
      clone.querySelectorAll("input,textarea,select").forEach((node) => {
        node.removeAttribute("value");
        node.textContent = "";
      });
      clone.querySelectorAll("*").forEach((node) => {
        for (const attribute of Array.from(node.attributes)) {
          if (/^on/i.test(attribute.name) || /^(value|srcdoc|nonce)$/i.test(attribute.name)) node.removeAttribute(attribute.name);
          else if (attribute.value.length > 512) node.setAttribute(attribute.name, attribute.value.slice(0, 512));
        }
      });
      const html = clone.outerHTML;
      return html.length > 32_768 ? { sanitizedHtml: `${html.slice(0, 32_768)}\n[TRUNCATED]`, htmlTruncated: true } : { sanitizedHtml: html };
    } catch {
      return {};
    }
  }

  function buildDomSnapshot(element: Element): TargetDomSnapshot {
    const ancestors: DomAncestorSnapshot[] = [];
    let parent = element.parentElement;
    while (parent && ancestors.length < 5) {
      ancestors.push({ tagName: parent.tagName.toLowerCase(), id: parent.id || undefined, classNames: Array.from(parent.classList).slice(0, 12), role: parent.getAttribute("role") || undefined, accessibleName: parent.getAttribute("aria-label") || undefined });
      parent = parent.parentElement;
    }
    const style = getComputedStyle(element);
    const computedStyle: Record<string, string> = {};
    for (const key of ["display", "visibility", "opacity", "position", "z-index", "width", "height", "color", "background-color", "pointer-events", "overflow"]) computedStyle[key] = style.getPropertyValue(key);
    const input = element as HTMLInputElement;
    const snapshot: TargetDomSnapshot = {
      capturedAtEpochMs: Date.now(),
      element: describe(element, { includeFramework: true }),
      ...snapshotHtml(element),
      ancestors,
      state: {
        disabled: "disabled" in element ? Boolean((element as HTMLButtonElement).disabled) : undefined,
        checked: "checked" in element ? Boolean((input as HTMLInputElement).checked) : undefined,
        selected: "selected" in element ? Boolean((element as HTMLOptionElement).selected) : undefined,
        expanded: element.getAttribute("aria-expanded") === "true" ? true : element.getAttribute("aria-expanded") === "false" ? false : undefined,
        hidden: style.display === "none" || style.visibility === "hidden"
      },
      computedStyle
    };
    return snapshot;
  }

  function pageElementAtPoint(clientX: number, clientY: number): Element | undefined {
    const previousPointerEvents = issueSelectionLayer?.style.pointerEvents;
    if (issueSelectionLayer) issueSelectionLayer.style.pointerEvents = "none";
    const candidate = document.elementsFromPoint(clientX, clientY).find((item) => !item.closest("#__wbr_issue_selection__") && !item.closest("#__wbr_issue_editor__") && !isWidgetElement(item));
    if (issueSelectionLayer && previousPointerEvents != null) issueSelectionLayer.style.pointerEvents = previousPointerEvents;
    return candidate;
  }

  let issueEditorKeydownListener: ((e: KeyboardEvent) => void) | undefined;

  function closeIssueEditor(restoreWidget = true): void {
    if (issueEditorKeydownListener) {
      window.removeEventListener("keydown", issueEditorKeydownListener, true);
      issueEditorKeydownListener = undefined;
    }
    issueEditor?.remove();
    issueEditor = undefined;
    selectedIssueElement = undefined;
    if (restoreWidget && session) renderRecordingWidget();
  }

  function renderEditorAnnotation(
    svg: SVGSVGElement,
    annotation: AnnotationModel,
    activeDrawing?: { type: "rect" | "arrow"; startX: number; startY: number; currentX: number; currentY: number }
  ): void {
    const boxes = annotation.targetBoxes?.length
      ? annotation.targetBoxes
      : (annotation.targetBox ? [annotation.targetBox] : []);
    let boxMarkup = boxes.map((box) => `<rect data-issue-handle="true" x="${box.xRatio * 1000}" y="${box.yRatio * 1000}" width="${box.widthRatio * 1000}" height="${box.heightRatio * 1000}" rx="2" ry="2" fill="none" stroke="#ef233c" stroke-width="3" vector-effect="non-scaling-stroke" style="cursor:move"></rect>`).join("");

    const defs = `<defs>
      <marker id="user-arrow-head" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#165dff"/>
      </marker>
    </defs>`;

    const rect = svg.getBoundingClientRect();
    const scaleX = rect.width > 0 ? 1000 / rect.width : 1;
    const scaleY = rect.height > 0 ? 1000 / rect.height : 1;

    let userMarkup = "";
    if (annotation.userAnnotations?.length) {
      for (const item of annotation.userAnnotations) {
        const color = item.color || "#165dff";
        if (item.type === "rect") {
          userMarkup += `<rect x="${item.xRatio * 1000}" y="${item.yRatio * 1000}" width="${item.widthRatio * 1000}" height="${item.heightRatio * 1000}" rx="2" ry="2" fill="none" stroke="${color}" stroke-width="3" vector-effect="non-scaling-stroke"></rect>`;
        } else if (item.type === "arrow") {
          userMarkup += `<line x1="${item.startXRatio * 1000}" y1="${item.startYRatio * 1000}" x2="${item.endXRatio * 1000}" y2="${item.endYRatio * 1000}" stroke="${color}" stroke-width="3" vector-effect="non-scaling-stroke" marker-end="url(#user-arrow-head)"></line>`;
        } else if (item.type === "text" && item.text) {
          const textEsc = item.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          userMarkup += `<g transform="translate(${item.xRatio * 1000}, ${item.yRatio * 1000}) scale(${scaleX}, ${scaleY})">
            <text x="0" y="0" fill="${color}" font-size="16" font-weight="700" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif">${textEsc}</text>
          </g>`;
        }
      }
    }

    let activeMarkup = "";
    if (activeDrawing) {
      const sx = activeDrawing.startX;
      const sy = activeDrawing.startY;
      const cx = activeDrawing.currentX;
      const cy = activeDrawing.currentY;
      if (activeDrawing.type === "rect") {
        const rx = Math.min(sx, cx);
        const ry = Math.min(sy, cy);
        const rw = Math.abs(cx - sx);
        const rh = Math.abs(cy - sy);
        activeMarkup = `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" rx="2" ry="2" fill="none" stroke="#165dff" stroke-width="3" stroke-dasharray="4,4" vector-effect="non-scaling-stroke"></rect>`;
      } else if (activeDrawing.type === "arrow") {
        activeMarkup = `<line x1="${sx}" y1="${sy}" x2="${cx}" y2="${cy}" stroke="#165dff" stroke-width="3" stroke-dasharray="4,4" vector-effect="non-scaling-stroke" marker-end="url(#user-arrow-head)"></line>`;
      }
    }

    svg.innerHTML = defs + boxMarkup + userMarkup + activeMarkup;
  }

  function showIssueEditor(scene: { id: string; page: { viewport: { width: number; height: number } }; annotation: AnnotationModel }, dataUrl: string | undefined): void {
    const root = document.createElement("div");
    root.id = "__wbr_issue_editor__";
    Object.assign(root.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      background: "rgba(10, 13, 18, 0.88)",
      color: "#1d2129",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif"
    });
    root.innerHTML = `<style>
      #__wbr_issue_editor__ textarea,
      #__wbr_issue_editor__ input {
        background: #f7f8fa !important;
        border: 1px solid #e5e6eb !important;
        color: #1d2129 !important;
        border-radius: 2px !important;
        transition: all 0.15s ease !important;
      }
      #__wbr_issue_editor__ textarea::placeholder,
      #__wbr_issue_editor__ input::placeholder {
        color: #8c97a8 !important;
      }
      #__wbr_issue_editor__ textarea:focus,
      #__wbr_issue_editor__ input:focus {
        border-color: #165dff !important;
        background: #ffffff !important;
        box-shadow: 0 0 0 2px rgba(22, 93, 255, 0.15) !important;
      }
      #__wbr_issue_editor__ .__wbr_issue_action {
        transition: all 0.15s ease !important;
        border-radius: 2px !important;
      }
      #__wbr_issue_editor__ .__wbr_issue_action:hover:not(:disabled) {
        opacity: 0.9;
        transform: translateY(-1px);
      }
      #__wbr_issue_editor__ .__wbr_issue_action:active:not(:disabled) {
        transform: translateY(0);
      }
      #__wbr_issue_editor__ .__wbr_issue_action:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    </style>
    <div style="position:absolute;top:18px;left:50%;transform:translateX(-50%);z-index:30;background:rgba(255,255,255,0.96);backdrop-filter:blur(16px);border:1px solid #e5e6eb;border-radius:4px;box-shadow:0 4px 16px rgba(0,0,0,0.12);padding:4px 8px;display:flex;align-items:center;gap:8px">
      <div style="display:flex;align-items:center;gap:3px">
        <button data-issue-tool="none" class="__wbr_issue_action __wbr_tool_btn" style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:26px;background:#165dff;color:#ffffff;border:1px solid #165dff;border-radius:3px;cursor:pointer;padding:0;flex-shrink:0" title="浏览模式 (查看)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
        <button data-issue-tool="rect" class="__wbr_issue_action __wbr_tool_btn" style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:26px;background:#ffffff;color:#1d2129;border:1px solid #e5e6eb;border-radius:3px;cursor:pointer;padding:0;flex-shrink:0" title="绘制矩形框">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
        </button>
        <button data-issue-tool="arrow" class="__wbr_issue_action __wbr_tool_btn" style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:26px;background:#ffffff;color:#1d2129;border:1px solid #e5e6eb;border-radius:3px;cursor:pointer;padding:0;flex-shrink:0" title="绘制箭头">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="19" x2="19" y2="5"/><polyline points="12 5 19 5 19 12"/></svg>
        </button>
        <button data-issue-tool="text" class="__wbr_issue_action __wbr_tool_btn" style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:26px;background:#ffffff;color:#1d2129;border:1px solid #e5e6eb;border-radius:3px;cursor:pointer;padding:0;flex-shrink:0" title="添加文字批注">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="12" y1="4" x2="12" y2="20"/><line x1="9" y1="20" x2="15" y2="20"/></svg>
        </button>
      </div>
      <div style="height:12px;width:1px;background:#e5e6eb"></div>
      <div style="display:flex;align-items:center;gap:3px">
        <button data-issue-tool-undo class="__wbr_issue_action" style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:26px;background:#ffffff;color:#1d2129;border:1px solid #e5e6eb;border-radius:3px;cursor:pointer;padding:0;flex-shrink:0" title="${t("undo")}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/></svg>
        </button>
        <button data-issue-tool-redo class="__wbr_issue_action" style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:26px;background:#ffffff;color:#1d2129;border:1px solid #e5e6eb;border-radius:3px;cursor:pointer;padding:0;flex-shrink:0" title="${t("redo")}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14l5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5v0A5.5 5.5 0 0 0 9.5 20H13"/></svg>
        </button>
      </div>
      <div style="height:12px;width:1px;background:#e5e6eb"></div>
      <div style="display:flex;align-items:center;gap:3px">
        <button data-issue-reselect class="__wbr_issue_action" style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:26px;background:#ffffff;color:#1d2129;border:1px solid #e5e6eb;border-radius:3px;cursor:pointer;padding:0;flex-shrink:0" title="重新选择元素">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
        </button>
        <button data-issue-cancel class="__wbr_issue_action" style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:26px;background:#ffffff;color:#5f6b7c;border:1px solid #e5e6eb;border-radius:3px;cursor:pointer;padding:0;flex-shrink:0;font-size:13px" title="取消关闭">✕</button>
      </div>
    </div>
    <div style="width:100vw;height:100vh;display:flex;align-items:center;justify-content:center;padding:52px 12px 24px;box-sizing:border-box;overflow:hidden;position:relative">
      <div data-issue-canvas style="position:relative;display:inline-block;max-width:100%;max-height:100%;border-radius:2px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.15);background:#06080c">
        <img data-issue-image alt="问题现场原图" style="display:block;max-width:calc(100vw - 24px);max-height:calc(100vh - 80px);object-fit:contain" draggable="false">
        <svg data-issue-svg viewBox="0 0 1000 1000" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;touch-action:none"></svg>
      </div>
    </div>
    <div data-issue-control-card style="position:fixed;z-index:30;width:min(calc(100vw - 32px),640px);background:rgba(255,255,255,0.96);backdrop-filter:blur(20px);border:1px solid #e5e6eb;border-radius:2px;box-shadow:0 8px 30px rgba(0,0,0,0.18);padding:10px 12px;display:flex;flex-direction:column;gap:8px;transition:top 0.15s ease-out, left 0.15s ease-out">
      <div data-issue-details-box style="display:none;flex-direction:column;gap:8px;padding-bottom:6px;border-bottom:1px solid #e5e6eb">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <label style="display:flex;flex-direction:column;gap:4px;font-size:11px;font-weight:500;color:#5f6b7c">
            预期表现
            <textarea data-issue-expected rows="2" placeholder="例如：应显示成功提示" style="width:100%;box-sizing:border-box;padding:6px 8px;font-size:12px;font-family:inherit;resize:none;outline:none;border-radius:2px"></textarea>
          </label>
          <label style="display:flex;flex-direction:column;gap:4px;font-size:11px;font-weight:500;color:#5f6b7c">
            截图短标签 (可选)
            <input data-issue-label maxlength="80" placeholder="例如：登陆页表单" style="width:100%;box-sizing:border-box;padding:6px 8px;font-size:12px;font-family:inherit;outline:none;border-radius:2px">
          </label>
        </div>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:11px;font-weight:500;color:#5f6b7c">
          补充说明
          <textarea data-issue-note rows="2" placeholder="补充上下文" style="width:100%;box-sizing:border-box;padding:6px 8px;font-size:12px;font-family:inherit;resize:none;outline:none;border-radius:2px"></textarea>
        </label>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <div data-issue-drag-handle style="display:flex;align-items:center;justify-content:center;cursor:grab;padding:0 2px;color:#8c97a8;user-select:none;touch-action:none" title="按住拖拽拖动面板">
          <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor"><circle cx="3" cy="3" r="1.5"/><circle cx="7" cy="3" r="1.5"/><circle cx="3" cy="8" r="1.5"/><circle cx="7" cy="8" r="1.5"/><circle cx="3" cy="13" r="1.5"/><circle cx="7" cy="13" r="1.5"/></svg>
        </div>
        <input data-issue-actual placeholder="描述问题实际表现 (例如：点击无反应)" style="flex:1;height:34px;box-sizing:border-box;padding:0 10px;font-size:12px;font-family:inherit;outline:none;border-radius:2px">
        <button data-issue-toggle-more class="__wbr_issue_action" style="display:inline-flex;align-items:center;gap:3px;background:transparent;color:#5f6b7c;border:1px solid #e5e6eb;border-radius:2px;height:34px;padding:0 8px;font-size:12px;font-weight:500;cursor:pointer;white-space:nowrap">详细 ▾</button>
        <button data-issue-save class="__wbr_issue_action" style="display:inline-flex;align-items:center;gap:4px;background:#ffffff;color:#1d2129;border:1px solid #e5e6eb;border-radius:2px;height:34px;padding:0 10px;font-size:12px;font-weight:500;cursor:pointer;white-space:nowrap">保存并继续</button>
        <button data-issue-save-stop class="__wbr_issue_action" style="display:inline-flex;align-items:center;gap:4px;background:#ef233c;color:#ffffff;border:none;border-radius:2px;height:34px;padding:0 14px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap">保存并结束</button>
      </div>
      <div data-issue-error style="color:#b42318;font-size:12px;padding:6px 10px;border-radius:2px;background:#fde3df;border:1px solid #f99f95;display:none"></div>
    </div>`;
    document.documentElement.appendChild(root);
    issueEditor = root;
    const image = root.querySelector<HTMLImageElement>("[data-issue-image]")!;
    if (dataUrl) image.src = dataUrl;
    const svg = root.querySelector<SVGSVGElement>("[data-issue-svg]")!;
    const annotation = { ...scene.annotation, point: { ...scene.annotation.point }, targetBox: scene.annotation.targetBox ? { ...scene.annotation.targetBox } : undefined };
    renderEditorAnnotation(svg, annotation);

    const controlCard = root.querySelector<HTMLElement>("[data-issue-control-card]")!;
    let userMovedCard = false;
    let cardDragging = false;
    let cardStartX = 0;
    let cardStartY = 0;
    let cardInitialLeft = 0;
    let cardInitialTop = 0;

    const dragHandle = root.querySelector<HTMLElement>("[data-issue-drag-handle]");
    dragHandle?.addEventListener("pointerdown", (event) => {
      cardDragging = true;
      userMovedCard = true;
      dragHandle.setPointerCapture(event.pointerId);
      dragHandle.style.cursor = "grabbing";
      controlCard.style.transition = "none";
      cardStartX = event.clientX;
      cardStartY = event.clientY;
      cardInitialLeft = controlCard.offsetLeft;
      cardInitialTop = controlCard.offsetTop;
      event.preventDefault();
    });
    dragHandle?.addEventListener("pointermove", (event) => {
      if (!cardDragging) return;
      const dx = event.clientX - cardStartX;
      const dy = event.clientY - cardStartY;
      const newLeft = Math.max(8, Math.min(window.innerWidth - controlCard.offsetWidth - 8, cardInitialLeft + dx));
      const newTop = Math.max(8, Math.min(window.innerHeight - controlCard.offsetHeight - 8, cardInitialTop + dy));
      controlCard.style.left = `${newLeft}px`;
      controlCard.style.top = `${newTop}px`;
    });
    dragHandle?.addEventListener("pointerup", () => {
      if (!cardDragging) return;
      cardDragging = false;
      dragHandle.style.cursor = "grab";
      controlCard.style.transition = "top 0.15s ease-out, left 0.15s ease-out";
    });

    const positionControlCard = () => {
      if (!controlCard || !svg || userMovedCard) return;
      const rect = svg.getBoundingClientRect();
      const box = annotation.targetBox;
      const targetX = box ? box.xRatio + box.widthRatio / 2 : annotation.point.xRatio;
      const targetYBottom = box ? box.yRatio + box.heightRatio : annotation.point.yRatio;
      const targetYTop = box ? box.yRatio : annotation.point.yRatio;

      const targetPxX = rect.left + targetX * rect.width;
      const targetPxYBottom = rect.top + targetYBottom * rect.height;
      const targetPxYTop = rect.top + targetYTop * rect.height;

      const cardWidth = controlCard.offsetWidth || 560;
      const cardHeight = controlCard.offsetHeight || 60;

      let left = targetPxX - cardWidth / 2;
      left = Math.max(16, Math.min(window.innerWidth - cardWidth - 16, left));

      let top = targetPxYBottom + 14;
      if (top + cardHeight > window.innerHeight - 16) {
        top = targetPxYTop - cardHeight - 14;
      }
      top = Math.max(64, Math.min(window.innerHeight - cardHeight - 16, top));

      Object.assign(controlCard.style, {
        left: `${left}px`,
        top: `${top}px`
      });
    };

    image.addEventListener("load", positionControlCard);
    window.addEventListener("resize", positionControlCard);
    requestAnimationFrame(positionControlCard);

    const actualInput = root.querySelector<HTMLInputElement>("[data-issue-actual]");
    setTimeout(() => actualInput?.focus(), 50);

    annotation.userAnnotations = annotation.userAnnotations || [];
    let activeTool: "none" | "rect" | "arrow" | "text" = "none";
    let isDrawingUserAnnotation = false;
    let drawStartXRatio = 0;
    let drawStartYRatio = 0;

    const toolButtons = root.querySelectorAll<HTMLButtonElement>("[data-issue-tool]");
    toolButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const tool = btn.getAttribute("data-issue-tool") as "none" | "rect" | "arrow" | "text";
        activeTool = tool;
        toolButtons.forEach((b) => {
          const isCurrent = b === btn;
          b.style.background = isCurrent ? "#165dff" : "#ffffff";
          b.style.color = isCurrent ? "#ffffff" : "#1d2129";
          b.style.borderColor = isCurrent ? "#165dff" : "#e5e6eb";
        });
        svg.style.cursor = activeTool === "none" ? "default" : "crosshair";
      });
    });

    const redoStack: any[] = [];
    const undoBtn = root.querySelector<HTMLButtonElement>("[data-issue-tool-undo]");
    const redoBtn = root.querySelector<HTMLButtonElement>("[data-issue-tool-redo]");

    const updateUndoRedoStatus = () => {
      const hasUndo = Boolean(annotation.userAnnotations?.length);
      const hasRedo = Boolean(redoStack.length);
      if (undoBtn) {
        undoBtn.disabled = !hasUndo;
        undoBtn.style.color = hasUndo ? "#1d2129" : "#c0c6d0";
        undoBtn.style.background = hasUndo ? "#ffffff" : "#f7f8fa";
        undoBtn.style.cursor = hasUndo ? "pointer" : "not-allowed";
        undoBtn.style.opacity = "1";
      }
      if (redoBtn) {
        redoBtn.disabled = !hasRedo;
        redoBtn.style.color = hasRedo ? "#1d2129" : "#c0c6d0";
        redoBtn.style.background = hasRedo ? "#ffffff" : "#f7f8fa";
        redoBtn.style.cursor = hasRedo ? "pointer" : "not-allowed";
        redoBtn.style.opacity = "1";
      }
    };
    updateUndoRedoStatus();

    const handleUndo = () => {
      if (annotation.userAnnotations?.length) {
        const popped = annotation.userAnnotations.pop();
        if (popped) redoStack.push(popped);
        renderEditorAnnotation(svg, annotation);
        updateUndoRedoStatus();
      }
    };

    const handleRedo = () => {
      if (redoStack.length) {
        const item = redoStack.pop();
        if (item) {
          annotation.userAnnotations!.push(item);
          renderEditorAnnotation(svg, annotation);
          updateUndoRedoStatus();
        }
      }
    };

    undoBtn?.addEventListener("click", handleUndo);
    redoBtn?.addEventListener("click", handleRedo);

    const undoShortcutText = isMac ? "⌘Z" : "Ctrl+Z";
    const redoShortcutText = isMac ? "⇧⌘Z" : "Ctrl+Shift+Z";
    if (undoBtn) undoBtn.title = `${t("undo")} (${undoShortcutText})`;
    if (redoBtn) redoBtn.title = `${t("redo")} (${redoShortcutText})`;

    issueEditorKeydownListener = (e: KeyboardEvent) => {
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;
      if (!isCmdOrCtrl) return;

      const activeEl = document.activeElement;
      const isTyping = activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA");

      const isZ = e.key === "z" || e.key === "Z";
      const isY = e.key === "y" || e.key === "Y";

      if (isZ && e.shiftKey) {
        if (!isTyping) {
          e.preventDefault();
          handleRedo();
        }
      } else if (isZ && !e.shiftKey) {
        if (!isTyping) {
          e.preventDefault();
          handleUndo();
        }
      } else if (isY && !e.shiftKey) {
        if (!isTyping) {
          e.preventDefault();
          handleRedo();
        }
      }
    };
    window.addEventListener("keydown", issueEditorKeydownListener, true);

    let textInputOverlay: HTMLInputElement | undefined;
    const removeTextInputOverlay = () => {
      if (textInputOverlay) {
        textInputOverlay.remove();
        textInputOverlay = undefined;
      }
    };

    let targetHandleDragging = false;
    svg.addEventListener("pointerdown", (event) => {
      const isHandle = Boolean((event.target as Element).closest("[data-issue-handle]"));
      if (activeTool === "none" && isHandle) {
        targetHandleDragging = true;
        svg.setPointerCapture(event.pointerId);
        event.preventDefault();
        return;
      }

      if (activeTool === "rect" || activeTool === "arrow") {
        removeTextInputOverlay();
        const rect = svg.getBoundingClientRect();
        drawStartXRatio = Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)));
        drawStartYRatio = Math.min(1, Math.max(0, (event.clientY - rect.top) / Math.max(1, rect.height)));
        isDrawingUserAnnotation = true;
        svg.setPointerCapture(event.pointerId);
        event.preventDefault();
      } else if (activeTool === "text") {
        removeTextInputOverlay();
        const rect = svg.getBoundingClientRect();
        const clickXRatio = Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)));
        const clickYRatio = Math.min(1, Math.max(0, (event.clientY - rect.top) / Math.max(1, rect.height)));

        const input = document.createElement("input");
        input.type = "text";
        input.placeholder = "输入批注文字...";
        Object.assign(input.style, {
          position: "absolute",
          left: `${event.clientX - root.getBoundingClientRect().left}px`,
          top: `${event.clientY - root.getBoundingClientRect().top - 14}px`,
          zIndex: "40",
          background: "rgba(255, 255, 255, 0.95)",
          color: "#165dff",
          border: "1px solid #165dff",
          borderRadius: "2px",
          padding: "2px 6px",
          fontSize: "13px",
          fontWeight: "600",
          outline: "none",
          boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
          minWidth: "100px"
        });
        root.appendChild(input);
        textInputOverlay = input;
        setTimeout(() => input.focus(), 10);

        const submitText = () => {
          const val = input.value.trim();
          if (val) {
            annotation.userAnnotations!.push({
              type: "text",
              color: "#165dff",
              xRatio: clickXRatio,
              yRatio: clickYRatio,
              text: val
            });
            redoStack.length = 0;
            renderEditorAnnotation(svg, annotation);
            updateUndoRedoStatus();
          }
          removeTextInputOverlay();
        };

        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submitText();
          } else if (e.key === "Escape") {
            removeTextInputOverlay();
          }
        });
        input.addEventListener("blur", () => {
          submitText();
        });
      }
    });

    svg.addEventListener("pointermove", (event) => {
      const rect = svg.getBoundingClientRect();
      if (targetHandleDragging && activeTool === "none") {
        annotation.point = {
          xRatio: Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width))),
          yRatio: Math.min(1, Math.max(0, (event.clientY - rect.top) / Math.max(1, rect.height)))
        };
        renderEditorAnnotation(svg, annotation);
        positionControlCard();
        return;
      }

      if (isDrawingUserAnnotation) {
        const curXRatio = Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)));
        const curYRatio = Math.min(1, Math.max(0, (event.clientY - rect.top) / Math.max(1, rect.height)));
        renderEditorAnnotation(svg, annotation, {
          type: activeTool as "rect" | "arrow",
          startX: drawStartXRatio * 1000,
          startY: drawStartYRatio * 1000,
          currentX: curXRatio * 1000,
          currentY: curYRatio * 1000
        });
      }
    });

    svg.addEventListener("pointerup", (event) => {
      if (targetHandleDragging) {
        targetHandleDragging = false;
      }
      if (isDrawingUserAnnotation) {
        isDrawingUserAnnotation = false;
        const rect = svg.getBoundingClientRect();
        const endXRatio = Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)));
        const endYRatio = Math.min(1, Math.max(0, (event.clientY - rect.top) / Math.max(1, rect.height)));

        const dx = Math.abs(endXRatio - drawStartXRatio);
        const dy = Math.abs(endYRatio - drawStartYRatio);

        if (dx > 0.005 || dy > 0.005) {
          if (activeTool === "rect") {
            const rx = Math.min(drawStartXRatio, endXRatio);
            const ry = Math.min(drawStartYRatio, endYRatio);
            const rw = Math.abs(endXRatio - drawStartXRatio);
            const rh = Math.abs(endYRatio - drawStartYRatio);
            annotation.userAnnotations!.push({
              type: "rect",
              color: "#165dff",
              xRatio: rx,
              yRatio: ry,
              widthRatio: rw,
              heightRatio: rh
            });
          } else if (activeTool === "arrow") {
            annotation.userAnnotations!.push({
              type: "arrow",
              color: "#165dff",
              startXRatio: drawStartXRatio,
              startYRatio: drawStartYRatio,
              endXRatio: endXRatio,
              endYRatio: endYRatio
            });
          }
          redoStack.length = 0;
          updateUndoRedoStatus();
        }
        renderEditorAnnotation(svg, annotation);
      }
    });

    const detailsBox = root.querySelector<HTMLElement>("[data-issue-details-box]")!;
    const toggleBtn = root.querySelector<HTMLElement>("[data-issue-toggle-more]");
    toggleBtn?.addEventListener("click", () => {
      const isHidden = detailsBox.style.display === "none";
      detailsBox.style.display = isHidden ? "flex" : "none";
      toggleBtn.textContent = isHidden ? "收起 ▴" : "详细 ▾";
      requestAnimationFrame(positionControlCard);
    });
    const error = root.querySelector<HTMLElement>("[data-issue-error]")!;
    const setError = (msg: string) => {
      if (msg) {
        error.textContent = msg;
        error.style.display = "block";
      } else {
        error.textContent = "";
        error.style.display = "none";
      }
    };
    const cancel = () => {
      window.removeEventListener("resize", positionControlCard);
      void chrome.runtime.sendMessage(message("issue-scene/cancel", { issueSceneId: scene.id, nonce: session!.nonce }, session!.sessionId));
      closeIssueEditor();
    };
    root.querySelector("[data-issue-cancel]")?.addEventListener("click", cancel);
    root.querySelector("[data-issue-reselect]")?.addEventListener("click", () => { cancel(); beginIssueSelection(); });
    const commit = (stopAfterCommit: boolean) => {
      const actual = root.querySelector<HTMLInputElement>("[data-issue-actual]")!.value;
      const expected = root.querySelector<HTMLTextAreaElement>("[data-issue-expected]")!.value;
      const note = root.querySelector<HTMLTextAreaElement>("[data-issue-note]")!.value;
      const label = root.querySelector<HTMLInputElement>("[data-issue-label]")!.value;
      root.querySelectorAll<HTMLButtonElement>("button").forEach((button) => { button.disabled = true; });
      void chrome.runtime.sendMessage(message("issue-scene/commit", { issueSceneId: scene.id, nonce: session!.nonce, narrative: { actual, expected, note }, annotation: { ...annotation, label: label.trim() || undefined }, stopAfterCommit }, session!.sessionId)).then((response) => {
        if (!response?.ok) { setError(`保存失败：${response?.error ?? "未知错误"}`); root.querySelectorAll<HTMLButtonElement>("button").forEach((button) => { button.disabled = false; }); return; }
        window.removeEventListener("resize", positionControlCard);
        closeIssueEditor(!stopAfterCommit);
        if (stopAfterCommit) removeRecordingWidget();
      }).catch((failure) => { setError(`保存失败：${String(failure)}`); root.querySelectorAll<HTMLButtonElement>("button").forEach((button) => { button.disabled = false; }); });
    };
    root.querySelector("[data-issue-save]")?.addEventListener("click", () => commit(false));
    root.querySelector("[data-issue-save-stop]")?.addEventListener("click", () => commit(true));
  }

  type SelectedTargetItem = {
    element: Element;
    target: TargetDomSnapshot;
    box: { xRatio: number; yRatio: number; widthRatio: number; heightRatio: number };
    overlayBox: HTMLElement;
  };

  function captureIssueSceneMulti(items: SelectedTargetItem[], fallbackCandidate?: { element: Element; clientX: number; clientY: number }): void {
    if (!session || !issueSelectionActive) return;
    issueSelectionActive = false;
    if (issueEscapeListener) window.removeEventListener("keydown", issueEscapeListener, true);
    issueEscapeListener = undefined;

    let finalItems = [...items];
    if (finalItems.length === 0 && fallbackCandidate) {
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const target = buildDomSnapshot(fallbackCandidate.element);
      const rect = fallbackCandidate.element.getBoundingClientRect();
      const box = {
        xRatio: Math.min(1, Math.max(0, rect.left / Math.max(1, viewport.width))),
        yRatio: Math.min(1, Math.max(0, rect.top / Math.max(1, viewport.height))),
        widthRatio: Math.min(1, Math.max(0, rect.width / Math.max(1, viewport.width))),
        heightRatio: Math.min(1, Math.max(0, rect.height / Math.max(1, viewport.height)))
      };
      const dummyOverlay = document.createElement("div");
      finalItems = [{ element: fallbackCandidate.element, target, box, overlayBox: dummyOverlay }];
    }

    if (finalItems.length === 0) {
      removeIssueUi();
      renderRecordingWidget();
      return;
    }

    unlockScroll();
    issueSelectionLayer?.remove();
    issueSelectionLayer = undefined;

    selectedIssueElement = finalItems[0].element;
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const targets = finalItems.map((item) => item.target);
    const targetBoxes = finalItems.map((item) => item.box);
    const primaryTarget = targets[0];
    const primaryBox = targetBoxes[0];
    const centerPoint = {
      clientX: (primaryBox.xRatio + primaryBox.widthRatio / 2) * viewport.width,
      clientY: (primaryBox.yRatio + primaryBox.heightRatio / 2) * viewport.height
    };

    const annotation = {
      ...defaultAnnotation(centerPoint, viewport, primaryTarget.element.boundingBox),
      targetBox: primaryBox,
      targetBoxes
    };

    removeRecordingWidget();
    const selectionStartedAtEpochMs = issueSelectionStartedAtEpochMs;
    issueSelectionStartedAtEpochMs = undefined;
    void new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))).then(() => chrome.runtime.sendMessage(message("issue-scene/capture", {
      captureId: crypto.randomUUID(),
      nonce: session!.nonce,
      observedAtEpochMs: Date.now(),
      selectionStartedAtEpochMs,
      page: { url: location.href, title: document.title, frameId: 0, viewport, scrollX: window.scrollX, scrollY: window.scrollY, devicePixelRatio: window.devicePixelRatio },
      target: primaryTarget,
      targets,
      annotation
    }, session!.sessionId))).then((response) => {
      if (!response?.ok || !response.scene) { alert(`问题现场采集失败：${response?.error ?? "未知错误"}`); renderRecordingWidget(); return; }
      showIssueEditor(response.scene, response.dataUrl);
    }).catch((error) => { alert(`问题现场采集失败：${String(error)}`); renderRecordingWidget(); });
  }

  function beginIssueSelection(): void {
    if (!session || issueSelectionActive || issueEditor) return;
    issueSelectionActive = true;
    issueSelectionStartedAtEpochMs = Date.now();
    void chrome.runtime.sendMessage(message("issue-scene/start-selection", {}, session.sessionId));
    lockScroll();
    setIssueButtonSelecting(true);

    const layer = document.createElement("div");
    layer.id = "__wbr_issue_selection__";
    Object.assign(layer.style, { position: "fixed", inset: "0", zIndex: "2147483646", cursor: "crosshair", background: "transparent" });
    const shadow = layer.attachShadow({ mode: "open" });

    const outline = document.createElement("div");
    Object.assign(outline.style, { position: "fixed", pointerEvents: "none", border: "2.5px dashed #ef233c", borderRadius: "2px", background: "transparent", display: "none", zIndex: "1" });

    const boxesContainer = document.createElement("div");
    Object.assign(boxesContainer.style, { position: "fixed", inset: "0", pointerEvents: "none", zIndex: "2" });

    const hint = document.createElement("div");
    Object.assign(hint.style, {
      position: "fixed",
      top: "18px",
      left: "50%",
      transform: "translateX(-50%)",
      maxWidth: "calc(100vw - 32px)",
      padding: "8px 16px",
      borderRadius: "999px",
      background: "rgba(29,33,41,.94)",
      border: "1px solid rgba(255,255,255,.2)",
      boxShadow: "0 8px 28px rgba(0,0,0,.28)",
      color: "#fff",
      font: "600 13px/1.35 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      whiteSpace: "nowrap",
      pointerEvents: "auto",
      display: "flex",
      alignItems: "center",
      gap: "12px",
      zIndex: "10"
    });

    const statusText = document.createElement("span");
    statusText.textContent = `标记模式 (${shortcutKeyText}) · 点击选择网页元素`;

    const btnGroup = document.createElement("div");
    Object.assign(btnGroup.style, { display: "flex", alignItems: "center", gap: "8px" });

    const finishBtn = document.createElement("button");
    finishBtn.textContent = "完成截图 (0)";
    Object.assign(finishBtn.style, { background: "#ef233c", color: "#fff", border: "none", borderRadius: "999px", padding: "4px 12px", fontSize: "12px", fontWeight: "600", cursor: "pointer" });

    const clearBtn = document.createElement("button");
    clearBtn.textContent = "清空";
    Object.assign(clearBtn.style, { background: "rgba(255,255,255,0.15)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)", borderRadius: "999px", padding: "4px 10px", fontSize: "12px", fontWeight: "500", cursor: "pointer" });

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "取消";
    Object.assign(cancelBtn.style, { background: "transparent", color: "rgba(255,255,255,0.7)", border: "none", borderRadius: "999px", padding: "4px 8px", fontSize: "12px", fontWeight: "500", cursor: "pointer" });

    btnGroup.append(finishBtn, clearBtn, cancelBtn);
    hint.append(statusText, btnGroup);
    shadow.append(outline, boxesContainer, hint);
    document.documentElement.appendChild(layer);
    issueSelectionLayer = layer;

    const selectedItems: SelectedTargetItem[] = [];
    let currentHovered: { element: Element; clientX: number; clientY: number } | undefined;

    const updateUI = () => {
      finishBtn.textContent = `完成截图 (${selectedItems.length})`;
      if (selectedItems.length > 0) {
        statusText.textContent = `已选中 ${selectedItems.length} 个元素 · 单击网页继续添加`;
      } else {
        statusText.textContent = "多元素标记模式已开启 · 点击选择网页元素";
      }
    };

    const padX = 4;
    const padY = 3;

    const addTarget = (element: Element) => {
      if (selectedItems.some((item) => item.element === element)) return;
      const viewportWidth = Math.max(1, window.innerWidth);
      const viewportHeight = Math.max(1, window.innerHeight);
      const target = buildDomSnapshot(element);
      const rect = element.getBoundingClientRect();
      const left = Math.max(0, rect.left - padX);
      const top = Math.max(0, rect.top - padY);
      const width = rect.width + padX * 2;
      const height = rect.height + padY * 2;

      const box = {
        xRatio: Math.min(1, Math.max(0, left / viewportWidth)),
        yRatio: Math.min(1, Math.max(0, top / viewportHeight)),
        widthRatio: Math.min(1, Math.max(0, width / viewportWidth)),
        heightRatio: Math.min(1, Math.max(0, height / viewportHeight))
      };

      const overlayBox = document.createElement("div");
      Object.assign(overlayBox.style, {
        position: "fixed",
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
        border: "2.5px solid #ef233c",
        borderRadius: "2px",
        background: "transparent",
        pointerEvents: "auto",
        boxSizing: "border-box"
      });

      const removeBtn = document.createElement("div");
      removeBtn.textContent = "✕";
      removeBtn.title = "移除该标记";
      Object.assign(removeBtn.style, {
        position: "absolute",
        top: "-9px",
        right: "-9px",
        width: "18px",
        height: "18px",
        borderRadius: "50%",
        background: "#ef233c",
        color: "#ffffff",
        fontSize: "11px",
        fontWeight: "bold",
        lineHeight: "18px",
        textAlign: "center",
        cursor: "pointer",
        boxShadow: "0 2px 6px rgba(0, 0, 0, 0.25)",
        userSelect: "none",
        zIndex: "10"
      });

      const item: SelectedTargetItem = { element, target, box, overlayBox };
      removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        removeTarget(item);
      });

      overlayBox.appendChild(removeBtn);
      boxesContainer.appendChild(overlayBox);
      selectedItems.push(item);
      updateUI();
    };

    const removeTarget = (item: SelectedTargetItem) => {
      const index = selectedItems.indexOf(item);
      if (index >= 0) {
        selectedItems.splice(index, 1);
        item.overlayBox.remove();
        updateUI();
      }
    };

    const clearAll = () => {
      selectedItems.forEach((item) => item.overlayBox.remove());
      selectedItems.length = 0;
      updateUI();
    };

    finishBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      shadow.querySelectorAll("div").forEach((el) => {
        if (el.textContent === "✕") el.style.display = "none";
      });
      hint.style.display = "none";
      outline.style.display = "none";
      captureIssueSceneMulti(selectedItems, currentHovered);
    });

    clearBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      clearAll();
    });

    cancelBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      removeIssueUi();
      renderRecordingWidget();
    });

    layer.addEventListener("pointermove", (event) => {
      const candidate = pageElementAtPoint(event.clientX, event.clientY);
      if (!candidate || selectedItems.some((item) => item.element === candidate)) {
        outline.style.display = "none";
        currentHovered = undefined;
        return;
      }
      currentHovered = { element: candidate, clientX: event.clientX, clientY: event.clientY };
      const rect = candidate.getBoundingClientRect();
      Object.assign(outline.style, {
        display: "block",
        left: `${Math.max(0, rect.left - padX)}px`,
        top: `${Math.max(0, rect.top - padY)}px`,
        width: `${rect.width + padX * 2}px`,
        height: `${rect.height + padY * 2}px`
      });
    });

    layer.addEventListener("pointerdown", (event) => { event.stopPropagation(); });
    layer.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.button !== 0) return;
      const candidate = pageElementAtPoint(event.clientX, event.clientY);
      if (candidate) addTarget(candidate);
    }, { passive: false });

    issueEscapeListener = (event: KeyboardEvent) => {
      if (event.key === "Escape" && issueSelectionActive) {
        event.preventDefault();
        removeIssueUi();
        renderRecordingWidget();
      }
    };
    window.addEventListener("keydown", issueEscapeListener, true);
  }

  const INACTIVITY_TIMEOUT_MS = 60_000;
  let lastActivityTime = Date.now();
  let isIdlePaused = false;
  let inactivityCheckInterval: number | undefined;
  let activityListenersAttached = false;
  const activityEvents = ["pointermove", "pointerdown", "keydown", "scroll", "wheel", "touchstart"];

  function handleUserActivity(): void {
    const now = Date.now();
    if (isIdlePaused && session) {
      isIdlePaused = false;
      updateWidgetPauseState(false);
      void chrome.runtime.sendMessage(message("offscreen/resume-media", { sessionId: session.sessionId }, session.sessionId));
    }
    lastActivityTime = now;
  }

  function startInactivityMonitor(): void {
    stopInactivityMonitor();
    lastActivityTime = Date.now();
    isIdlePaused = false;

    if (!activityListenersAttached) {
      activityEvents.forEach((type) => {
        window.addEventListener(type, handleUserActivity, { capture: true, passive: true });
      });
      activityListenersAttached = true;
    }

    inactivityCheckInterval = window.setInterval(() => {
      if (!session || issueSelectionActive || issueEditor) return;
      if (!isIdlePaused && Date.now() - lastActivityTime >= INACTIVITY_TIMEOUT_MS) {
        isIdlePaused = true;
        updateWidgetPauseState(true);
        void chrome.runtime.sendMessage(message("offscreen/pause-media", { sessionId: session.sessionId }, session.sessionId));
      }
    }, 2_000);
  }

  function stopInactivityMonitor(): void {
    if (inactivityCheckInterval) {
      clearInterval(inactivityCheckInterval);
      inactivityCheckInterval = undefined;
    }
    if (activityListenersAttached) {
      activityEvents.forEach((type) => {
        window.removeEventListener(type, handleUserActivity, true);
      });
      activityListenersAttached = false;
    }
    isIdlePaused = false;
  }

  function updateWidgetPauseState(paused: boolean): void {
    if (!widgetContainer) return;
    const dot = widgetContainer.querySelector<HTMLElement>(".__wbr_dot");
    const recTag = widgetContainer.querySelector<HTMLElement>("[data-wbr-rec-tag]");
    if (dot) {
      dot.style.background = paused ? "#ffc107" : "#f53f3f";
      dot.style.animation = paused ? "none" : "wbr-pulse 1.5s infinite";
    }
    if (recTag) {
      recTag.textContent = paused ? "PAUSED" : "REC";
      recTag.style.color = paused ? "#ffc107" : "#fff";
    }
  }

  function removeRecordingWidget(): void {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = undefined; }
    if (widgetContainer) { widgetContainer.remove(); widgetContainer = undefined; }
  }

  function refreshSession(next: ContentSession | undefined): void {
    pending.clear();
    for (const item of pendingInputs.values()) window.clearTimeout(item.timer);
    pendingInputs.clear();
    if (!next) removeIssueUi();
    session = next;
    window.__WEB_BUG_RECORDER_SESSION__ = next;
    if (next) {
      renderRecordingWidget();
      startInactivityMonitor();
    } else {
      removeRecordingWidget();
      stopInactivityMonitor();
    }
  }

  function isWidgetElement(el: Element | null): boolean {
    return Boolean(el && (el.closest("#__wbr_recording_widget__") || el.closest("#__wbr_issue_selection__") || el.closest("#__wbr_issue_editor__")));
  }

  function textOf(element: Element): string | undefined {
    if (element instanceof HTMLInputElement && element.type.toLowerCase() === "password") return undefined;
    if (session?.privacyMode === "safe" && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) return undefined;
    const labelled = element.getAttribute("aria-label") || element.getAttribute("alt") || element.getAttribute("title");
    const text = labelled || (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.value : element.textContent);
    return text?.replace(/\s+/g, " ").trim().slice(0, 256) || undefined;
  }

  function cssEscape(value: string): string { return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&"); }
  function buildLocators(element: Element): ElementDescriptor["locators"] {
    const candidates: ElementDescriptor["locators"] = [];
    const root = element.getRootNode() as Document | ShadowRoot;
    const add = (kind: string, expression: string, score: number, reasons: string[]) => {
      let matchCount = 0;
      try { matchCount = root.querySelectorAll(expression).length; } catch { matchCount = 0; }
      candidates.push({ kind, expression, matchCount, stabilityScore: score, reasons });
    };
    for (const attr of ["data-testid", "data-test", "data-cy"]) {
      const value = element.getAttribute(attr);
      if (value) add("testId", `[${attr}="${cssEscape(value)}"]`, 0.98, [`${attr} 是测试属性`]);
    }
    const role = element.getAttribute("role") || (element.tagName.toLowerCase() === "button" ? "button" : undefined);
    if (role) add("role", `role=${role}`, 0.86, ["语义角色"]);
    if (element.id && !/[0-9a-f]{8,}|uuid|random/i.test(element.id)) add("id", `#${cssEscape(element.id)}`, 0.9, ["稳定 ID"]);
    const name = element.getAttribute("name");
    if (name) add("attribute", `${element.tagName.toLowerCase()}[name="${cssEscape(name)}"]`, 0.78, ["name 属性"]);
    const text = textOf(element);
    if (text && text.length < 80) candidates.push({ kind: "text", expression: text, matchCount: 1, stabilityScore: 0.6, reasons: ["可见文本摘要"] });
    const tag = element.tagName.toLowerCase();
    add("css", tag, 0.25, ["CSS 兜底定位器"]);
    return candidates.sort((a, b) => b.stabilityScore - a.stabilityScore).slice(0, 8);
  }

  function describe(element: Element, options?: { includeFramework?: boolean }): ElementDescriptor {
    const rect = element.getBoundingClientRect();
    const attributes: Record<string, string> = {};
    for (const attr of Array.from(element.attributes)) {
      if (/^(data-testid|data-test|data-cy|name|type|role|aria-|href)$/.test(attr.name) || attr.name.startsWith("aria-")) attributes[attr.name] = attr.value.slice(0, 512);
    }
    const role = element.getAttribute("role") || undefined;
    const vueSnapshot = options?.includeFramework && element instanceof HTMLElement ? detectVue(element) : undefined;
    return { tagName: element.tagName.toLowerCase(), id: element.id || undefined, classNames: Array.from(element.classList).slice(0, 12), attributes, text: textOf(element), role, accessibleName: element.getAttribute("aria-label") || undefined, boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, locators: buildLocators(element), framework: vueSnapshot ? { vue: vueSnapshot } : undefined };
  }

  function firstElement(path: EventTarget[]): Element | undefined { return path.find((item): item is Element => item instanceof Element); }
  function createRecord(
    event: Event,
    element: Element,
    status: InteractionRecord["status"],
    kind: InteractionRecord["kind"] = "click",
    metadata?: InteractionRecord["metadata"]
  ): InteractionRecord {
    const now = Date.now();
    const id = crypto.randomUUID();
    const pointer = event instanceof MouseEvent ? event : undefined;
    const keyboard = event instanceof KeyboardEvent ? event : undefined;
    const rect = element.getBoundingClientRect();
    const clientX = pointer?.clientX ?? Math.max(0, rect.left + rect.width / 2);
    const clientY = pointer?.clientY ?? Math.max(0, rect.top + rect.height / 2);
    const pointerType = event instanceof PointerEvent ? event.pointerType || "unknown" : keyboard ? "keyboard" : kind === "navigation" ? "navigation" : "form";
    return {
      id,
      sessionId: session!.nonce,
      kind,
      status,
      createdAt: now,
      page: { url: location.href, title: document.title, frameId: window.top === window ? 0 : -1 },
      input: { pointerType, button: pointer?.button ?? 0, isTrusted: event.isTrusted },
      coordinates: { clientX, clientY, pageX: pointer?.pageX ?? clientX + window.scrollX, pageY: pointer?.pageY ?? clientY + window.scrollY, scrollX: window.scrollX, scrollY: window.scrollY, devicePixelRatio: window.devicePixelRatio, viewport: { width: window.innerWidth, height: window.innerHeight } },
      element: describe(element),
      metadata,
      screenshot: { status: "pending" }
    };
  }

  function inputMetadata(element: Element, event?: InputEvent): InteractionRecord["metadata"] {
    const safeMode = session?.privacyMode !== "raw";
    if (element instanceof HTMLInputElement) {
      const password = element.type.toLowerCase() === "password";
      return {
        inputType: event?.inputType || element.type || "text",
        value: !safeMode && !password ? element.value.slice(0, 2_048) : undefined,
        valueLength: element.value.length,
        valueRedacted: safeMode || password || undefined,
        checked: ["checkbox", "radio"].includes(element.type.toLowerCase()) ? element.checked : undefined
      };
    }
    if (element instanceof HTMLTextAreaElement) {
      return { inputType: event?.inputType || "textarea", value: safeMode ? undefined : element.value.slice(0, 2_048), valueLength: element.value.length, valueRedacted: safeMode || undefined };
    }
    if (element instanceof HTMLSelectElement) {
      const selected = Array.from(element.selectedOptions);
      const rawValue = selected.map((option) => option.value).join(",");
      return { inputType: element.multiple ? "select-multiple" : "select-one", value: safeMode ? undefined : rawValue.slice(0, 2_048), valueLength: rawValue.length, valueRedacted: safeMode || undefined, selectedCount: selected.length };
    }
    const text = element.textContent ?? "";
    return { inputType: event?.inputType || "contenteditable", value: safeMode ? undefined : text.slice(0, 2_048), valueLength: text.length, valueRedacted: safeMode || undefined };
  }

  function sendConfirmed(record: InteractionRecord): void {
    send(record, "interaction/confirmed");
  }

  function actionableKey(event: KeyboardEvent): boolean {
    return event.ctrlKey || event.metaKey || event.altKey || ["Enter", "Escape", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End", "Delete", "Insert", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12"].includes(event.key);
  }

  const send = (record: InteractionRecord, type: "interaction/candidate" | "interaction/confirmed") => { void chrome.runtime.sendMessage(message(type, { interaction: record }, record.sessionId)); };
  document.addEventListener("pointerdown", (event) => {
    if (issueSelectionActive || issueEditor) return;
    if (!session || !event.isTrusted) return;
    const element = firstElement(event.composedPath());
    if (!element || isWidgetElement(element)) return;
    const record = createRecord(event, element, "candidate");
    pending.set(record.id, record);
    send(record, "interaction/candidate");
    window.setTimeout(() => { if (pending.get(record.id)?.status === "candidate") { pending.delete(record.id); void chrome.runtime.sendMessage(message("interaction/cancelled", { interactionId: record.id, interaction: record }, record.sessionId)); } }, 750);
  }, { capture: true, passive: false });

  document.addEventListener("click", (event) => {
    if (issueSelectionActive || issueEditor) return;
    if (!session || !event.isTrusted) return;
    const element = firstElement(event.composedPath()) ?? (event.target instanceof Element ? event.target : undefined);
    if (!element || isWidgetElement(element)) return;
    const nearest = Array.from(pending.values()).find((candidate) => Math.abs(candidate.coordinates.clientX - event.clientX) < 3 && Math.abs(candidate.coordinates.clientY - event.clientY) < 3);
    const record = nearest ? { ...nearest, status: "confirmed" as const, confirmedAt: Date.now(), element: describe(element) } : createRecord(event, element, "confirmed");
    if (nearest) pending.delete(nearest.id);
    send(record, "interaction/confirmed");
  }, { capture: true, passive: true });

  document.addEventListener("input", (event) => {
    if (!session || issueSelectionActive || issueEditor || !event.isTrusted) return;
    const element = firstElement(event.composedPath()) ?? (event.target instanceof Element ? event.target : undefined);
    if (!element || isWidgetElement(element)) return;
    const previous = pendingInputs.get(element);
    if (previous) window.clearTimeout(previous.timer);
    const record = createRecord(event, element, "confirmed", "input", inputMetadata(element, event instanceof InputEvent ? event : undefined));
    const timer = window.setTimeout(() => { pendingInputs.delete(element); sendConfirmed(record); }, 500);
    pendingInputs.set(element, { timer, record });
  }, { capture: true, passive: true });

  document.addEventListener("change", (event) => {
    if (!session || issueSelectionActive || issueEditor || !event.isTrusted) return;
    const element = firstElement(event.composedPath()) ?? (event.target instanceof Element ? event.target : undefined);
    if (!element || isWidgetElement(element)) return;
    const previous = pendingInputs.get(element);
    if (previous) { window.clearTimeout(previous.timer); pendingInputs.delete(element); }
    sendConfirmed(createRecord(event, element, "confirmed", "change", inputMetadata(element)));
  }, { capture: true, passive: true });

  document.addEventListener("submit", (event) => {
    if (!session || issueSelectionActive || issueEditor || !event.isTrusted) return;
    const form = event.target instanceof HTMLFormElement ? event.target : undefined;
    if (!form || isWidgetElement(form)) return;
    sendConfirmed(createRecord(event, form, "confirmed", "submit", { formMethod: form.method.toUpperCase(), formAction: form.action }));
  }, { capture: true, passive: true });

  document.addEventListener("keydown", (event) => {
    if (!session || !event.isTrusted) return;
    const isAltS = event.altKey && (event.key.toLowerCase() === "s" || event.code === "KeyS");
    if (isAltS) {
      event.preventDefault();
      event.stopPropagation();
      if (issueSelectionActive || issueEditor) {
        removeIssueUi();
      } else {
        beginIssueSelection();
      }
    }
  }, { capture: true });

  document.addEventListener("keydown", (event) => {
    if (!session || issueSelectionActive || issueEditor || !event.isTrusted || !actionableKey(event)) return;
    const element = firstElement(event.composedPath()) ?? (event.target instanceof Element ? event.target : document.documentElement);
    if (isWidgetElement(element)) return;
    sendConfirmed(createRecord(event, element, "confirmed", "keydown", { key: event.key, code: event.code, altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey, repeat: event.repeat }));
  }, { capture: true, passive: true });

  window.__WEB_BUG_RECORDER_CONTROLLER__ = { refresh: refreshSession };
  chrome.runtime.onMessage.addListener((raw: unknown) => {
    if (raw && typeof raw === "object" && (raw as { type?: unknown }).type === "content/reset") refreshSession(undefined);
  });
  chrome.runtime.sendMessage(message("content/hello", { url: location.href, title: document.title })).then((response) => {
    refreshSession(response?.active && response.sessionId && response.nonce
      ? { sessionId: response.sessionId, nonce: response.nonce, startedAtEpochMs: response.startedAtEpochMs, privacyMode: response.privacyMode === "raw" ? "raw" : "safe" }
      : undefined);
  }).catch(() => undefined);
}
