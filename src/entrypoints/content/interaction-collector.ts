import { message, type ElementDescriptor, type InteractionRecord } from "../../shared/protocol";

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

  function renderRecordingWidget(): void {
    if (widgetContainer || window.top !== window) return;
    const root = document.createElement("div");
    root.id = "__wbr_recording_widget__";
    root.setAttribute("data-wbr-ignore", "true");

    Object.assign(root.style, {
      position: "fixed",
      bottom: "24px",
      right: "24px",
      zIndex: "2147483647",
      display: "flex",
      alignItems: "center",
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
        @keyframes wbr-pulse {
          0% { box-shadow: 0 0 0 0 rgba(245, 63, 63, 0.6); }
          70% { box-shadow: 0 0 0 6px rgba(245, 63, 63, 0); }
          100% { box-shadow: 0 0 0 0 rgba(245, 63, 63, 0); }
        }
        .__wbr_dot {
          width: 8px; height: 8px; border-radius: 50%; background: #f53f3f;
          display: inline-block;
          animation: wbr-pulse 1.5s infinite;
        }
        .__wbr_btn {
          border: none; background: #f53f3f; color: #fff; border-radius: 4px;
          padding: 5px 10px; font-size: 11px; font-weight: 500; cursor: pointer;
          transition: background 0.15s ease;
          outline: none;
        }
        .__wbr_btn:hover { background: #f76565; }
        .__wbr_btn:active { background: #cb2727; }
        .__wbr_timer { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; color: #e5e6eb; font-weight: 600; }
      </style>
      <span class="__wbr_dot"></span>
      <span style="font-weight:600;letter-spacing:0.5px;color:#fff;">REC</span>
      <span id="__wbr_timer_display__" class="__wbr_timer">00:00</span>
      <button id="__wbr_stop_btn__" class="__wbr_btn">结束录制</button>
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

        const startTime = session?.startedAtEpochMs || Date.now();
        const updateTimer = () => {
          const display = root.querySelector("#__wbr_timer_display__");
          if (display) {
            const sec = Math.floor((Date.now() - startTime) / 1000);
            const m = String(Math.floor(sec / 60)).padStart(2, "0");
            const s = String(sec % 60).padStart(2, "0");
            display.textContent = `${m}:${s}`;
          }
        };
        updateTimer();
        timerInterval = window.setInterval(updateTimer, 1000);
      } else {
        window.addEventListener("DOMContentLoaded", attach, { once: true });
      }
    };
    attach();
  }

  function removeRecordingWidget(): void {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = undefined; }
    if (widgetContainer) { widgetContainer.remove(); widgetContainer = undefined; }
  }

  function refreshSession(next: ContentSession | undefined): void {
    pending.clear();
    session = next;
    window.__WEB_BUG_RECORDER_SESSION__ = next;
    if (next) renderRecordingWidget();
    else removeRecordingWidget();
  }

  function isWidgetElement(el: Element | null): boolean {
    return Boolean(el && el.closest("#__wbr_recording_widget__"));
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

  function describe(element: Element): ElementDescriptor {
    const rect = element.getBoundingClientRect();
    const attributes: Record<string, string> = {};
    for (const attr of Array.from(element.attributes)) {
      if (/^(data-testid|data-test|data-cy|name|type|role|aria-|href)$/.test(attr.name) || attr.name.startsWith("aria-")) attributes[attr.name] = attr.value.slice(0, 512);
    }
    const role = element.getAttribute("role") || undefined;
    return { tagName: element.tagName.toLowerCase(), id: element.id || undefined, classNames: Array.from(element.classList).slice(0, 12), attributes, text: textOf(element), role, accessibleName: element.getAttribute("aria-label") || undefined, boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, locators: buildLocators(element) };
  }

  function firstElement(path: EventTarget[]): Element | undefined { return path.find((item): item is Element => item instanceof Element); }
  function createRecord(event: MouseEvent | PointerEvent, element: Element, status: InteractionRecord["status"]): InteractionRecord {
    const now = Date.now();
    const id = crypto.randomUUID();
    const pointerType = "pointerType" in event ? event.pointerType || "unknown" : "keyboard";
    return { id, sessionId: session!.nonce, kind: "click", status, createdAt: now, page: { url: location.href, title: document.title, frameId: 0 }, input: { pointerType, button: event.button ?? 0, isTrusted: event.isTrusted }, coordinates: { clientX: event.clientX, clientY: event.clientY, pageX: event.pageX, pageY: event.pageY, scrollX: window.scrollX, scrollY: window.scrollY, devicePixelRatio: window.devicePixelRatio, viewport: { width: window.innerWidth, height: window.innerHeight } }, element: describe(element), screenshot: { status: "pending" } };
  }

  const send = (record: InteractionRecord, type: "interaction/candidate" | "interaction/confirmed") => { void chrome.runtime.sendMessage(message(type, { interaction: record }, record.sessionId)); };
  document.addEventListener("pointerdown", (event) => {
    if (!session || !event.isTrusted) return;
    const element = firstElement(event.composedPath());
    if (!element || isWidgetElement(element)) return;
    const record = createRecord(event, element, "candidate");
    pending.set(record.id, record);
    send(record, "interaction/candidate");
    window.setTimeout(() => { if (pending.get(record.id)?.status === "candidate") { pending.delete(record.id); void chrome.runtime.sendMessage(message("interaction/cancelled", { interactionId: record.id, interaction: record }, record.sessionId)); } }, 750);
  }, { capture: true, passive: true });

  document.addEventListener("click", (event) => {
    if (!session || !event.isTrusted) return;
    const element = firstElement(event.composedPath()) ?? (event.target instanceof Element ? event.target : undefined);
    if (!element || isWidgetElement(element)) return;
    const nearest = Array.from(pending.values()).find((candidate) => Math.abs(candidate.coordinates.clientX - event.clientX) < 3 && Math.abs(candidate.coordinates.clientY - event.clientY) < 3);
    const record = nearest ? { ...nearest, status: "confirmed" as const, confirmedAt: Date.now(), element: describe(element) } : createRecord(event, element, "confirmed");
    if (nearest) pending.delete(nearest.id);
    send(record, "interaction/confirmed");
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
