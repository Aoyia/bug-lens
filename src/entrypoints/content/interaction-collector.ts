import { message, type ElementDescriptor, type InteractionRecord } from "../../shared/protocol";

declare global { interface Window { __WEB_BUG_RECORDER_INSTALLED__?: boolean; __WEB_BUG_RECORDER_SESSION__?: { sessionId: string; nonce: string }; } }
if (!window.__WEB_BUG_RECORDER_INSTALLED__) {
  window.__WEB_BUG_RECORDER_INSTALLED__ = true;
  let session: { sessionId: string; nonce: string } | undefined;
  const pending = new Map<string, InteractionRecord>();

  function textOf(element: Element): string | undefined {
    if (element instanceof HTMLInputElement && element.type.toLowerCase() === "password") return undefined;
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
    if (!element) return;
    const record = createRecord(event, element, "candidate");
    pending.set(record.id, record);
    send(record, "interaction/candidate");
    window.setTimeout(() => { if (pending.get(record.id)?.status === "candidate") { pending.delete(record.id); void chrome.runtime.sendMessage(message("interaction/cancelled", { interactionId: record.id }, record.sessionId)); } }, 750);
  }, { capture: true, passive: true });

  document.addEventListener("click", (event) => {
    if (!session || !event.isTrusted) return;
    const element = firstElement(event.composedPath()) ?? (event.target instanceof Element ? event.target : undefined);
    if (!element) return;
    const nearest = Array.from(pending.values()).find((candidate) => Math.abs(candidate.coordinates.clientX - event.clientX) < 3 && Math.abs(candidate.coordinates.clientY - event.clientY) < 3);
    const record = nearest ? { ...nearest, status: "confirmed" as const, confirmedAt: Date.now(), element: describe(element) } : createRecord(event, element, "confirmed");
    if (nearest) pending.delete(nearest.id);
    send(record, "interaction/confirmed");
  }, { capture: true, passive: true });

  chrome.runtime.sendMessage(message("content/hello", { url: location.href, title: document.title })).then((response) => {
    if (response?.active && response.sessionId && response.nonce) {
      session = { sessionId: response.sessionId, nonce: response.nonce };
      window.__WEB_BUG_RECORDER_SESSION__ = session;
    }
  }).catch(() => undefined);
}
