import type { DomAncestorSnapshot, ElementDescriptor, TargetDomSnapshot } from "../../../shared/protocol";
import { detectVue } from "../vue-detector";

// ─── Utilities ───

export function isWidgetElement(el: Element | null): boolean {
  if (!el) return false;
  const target = el instanceof Element ? el : (el as unknown as Node).parentElement;
  if (!target) return false;
  return Boolean(
    target.closest("#__wbr_recording_widget__") ||
    target.closest("#__wbr_issue_selection__") ||
    target.closest("#__wbr_issue_editor__") ||
    target.closest("#__wbr_overlay_container__") ||
    target.closest('[data-wbr-ignore="true"]')
  );
}

export function cssEscape(value: string): string { return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&"); }

export function textOf(element: Element, privacyMode: "safe" | "raw"): string | undefined {
  if (element instanceof HTMLInputElement && element.type.toLowerCase() === "password") return undefined;
  if (privacyMode === "safe" && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) return undefined;
  const labelled = element.getAttribute("aria-label") || element.getAttribute("alt") || element.getAttribute("title");
  const text = labelled || (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.value : element.textContent);
  return text?.replace(/\s+/g, " ").trim().slice(0, 256) || undefined;
}

// ─── Locators ───

export function buildLocators(element: Element, privacyMode: "safe" | "raw"): ElementDescriptor["locators"] {
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
  const text = textOf(element, privacyMode);
  if (text && text.length < 80) candidates.push({ kind: "text", expression: text, matchCount: 1, stabilityScore: 0.6, reasons: ["可见文本摘要"] });
  const tag = element.tagName.toLowerCase();
  add("css", tag, 0.25, ["CSS 兜底定位器"]);
  return candidates.sort((a, b) => b.stabilityScore - a.stabilityScore).slice(0, 8);
}

// ─── Element Descriptor ───

export function describe(element: Element, privacyMode: "safe" | "raw", options?: { includeFramework?: boolean }): ElementDescriptor {
  const rect = element.getBoundingClientRect();
  const attributes: Record<string, string> = {};
  for (const attr of Array.from(element.attributes)) {
    if (/^(data-testid|data-test|data-cy|name|type|role|aria-|href)$/.test(attr.name) || attr.name.startsWith("aria-")) attributes[attr.name] = attr.value.slice(0, 512);
  }
  const role = element.getAttribute("role") || undefined;
  const vueSnapshot = options?.includeFramework && element instanceof HTMLElement ? detectVue(element) : undefined;
  return { tagName: element.tagName.toLowerCase(), id: element.id || undefined, classNames: Array.from(element.classList).slice(0, 12), attributes, text: textOf(element, privacyMode), role, accessibleName: element.getAttribute("aria-label") || undefined, boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, locators: buildLocators(element, privacyMode), framework: vueSnapshot ? { vue: vueSnapshot } : undefined };
}

// ─── HTML Snapshot ───

export function snapshotHtml(element: Element): { sanitizedHtml?: string; htmlTruncated?: boolean } {
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

// ─── DOM Snapshot ───

export function buildDomSnapshot(element: Element, privacyMode: "safe" | "raw"): TargetDomSnapshot {
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
    element: describe(element, privacyMode, { includeFramework: true }),
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

// ─── Element at Point ───

export function pageElementAtPoint(clientX: number, clientY: number, selectionLayer: HTMLElement | undefined, editorEl: HTMLElement | undefined): Element | undefined {
  const previousPointerEvents = selectionLayer?.style.pointerEvents;
  if (selectionLayer) selectionLayer.style.pointerEvents = "none";
  const candidate = document.elementsFromPoint(clientX, clientY).find((item) => !item.closest("#__wbr_issue_selection__") && !item.closest("#__wbr_issue_editor__") && !isWidgetElement(item));
  if (selectionLayer && previousPointerEvents != null) selectionLayer.style.pointerEvents = previousPointerEvents;
  return candidate;
}
