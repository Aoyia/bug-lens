import type {
  DomAncestorSnapshot,
  ElementDescriptor,
  FrameworkSnapshot,
  TargetDomSnapshot,
} from "../../../shared/protocol";
import { detectVue } from "../vue-detector";
import { detectReact } from "../react-detector";

// ─── Utilities ───

export function isWidgetElement(el: Element | null): boolean {
  if (!el) return false;
  const target =
    el instanceof Element ? el : (el as unknown as Node).parentElement;
  if (!target) return false;
  return Boolean(
    target.closest("#__wbr_recording_widget__") ||
    target.closest("#__wbr_issue_selection__") ||
    target.closest("#__wbr_issue_editor__") ||
    target.closest("#__wbr_overlay_container__") ||
    target.closest('[data-wbr-ignore="true"]')
  );
}

export function cssEscape(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

export function textOf(
  element: Element,
  privacyMode: "safe" | "raw"
): string | undefined {
  const isInput =
    typeof HTMLInputElement !== "undefined" &&
    element instanceof HTMLInputElement;
  const isTextarea =
    typeof HTMLTextAreaElement !== "undefined" &&
    element instanceof HTMLTextAreaElement;
  const isSelect =
    typeof HTMLSelectElement !== "undefined" &&
    element instanceof HTMLSelectElement;

  if (
    isInput &&
    (element as HTMLInputElement).type?.toLowerCase() === "password"
  )
    return undefined;
  if (privacyMode === "safe" && (isInput || isTextarea || isSelect))
    return undefined;
  const labelled =
    element.getAttribute("aria-label") ||
    element.getAttribute("alt") ||
    element.getAttribute("title");
  const text =
    labelled ||
    (isInput || isTextarea
      ? (element as HTMLInputElement | HTMLTextAreaElement).value
      : element.textContent);
  return text?.replace(/\s+/g, " ").trim().slice(0, 256) || undefined;
}

export function getFrameSelector(frameEl: Element): string {
  if (frameEl.id && !/[0-9a-f]{8,}|uuid|random/i.test(frameEl.id)) {
    return `iframe#${cssEscape(frameEl.id)}`;
  }
  for (const attr of ["data-testid", "data-test", "data-cy"]) {
    const val = frameEl.getAttribute(attr);
    if (val) {
      return `iframe[${attr}="${cssEscape(val)}"]`;
    }
  }
  const name = frameEl.getAttribute("name");
  if (name) {
    return `iframe[name="${cssEscape(name)}"]`;
  }
  const rawSrc = frameEl.getAttribute("src");
  if (
    rawSrc &&
    !rawSrc.startsWith("about:") &&
    !rawSrc.startsWith("blob:") &&
    !rawSrc.startsWith("data:")
  ) {
    try {
      const base = frameEl.ownerDocument?.baseURI || "http://localhost";
      const u = new URL(rawSrc, base);
      const path = u.pathname !== "/" ? u.pathname : rawSrc;
      return `iframe[src*="${cssEscape(path)}"]`;
    } catch {
      return `iframe[src*="${cssEscape(rawSrc)}"]`;
    }
  }
  const validClass = Array.from(frameEl.classList).find(
    (c) => !/[0-9a-f]{8,}|uuid|random/i.test(c)
  );
  if (validClass) {
    return `iframe.${cssEscape(validClass)}`;
  }
  const parent = frameEl.parentElement;
  if (parent) {
    const iframes = Array.from(
      parent.querySelectorAll(":scope > iframe, iframe")
    );
    const idx = iframes.indexOf(frameEl);
    if (idx >= 0) {
      return `iframe:nth-of-type(${idx + 1})`;
    }
  }
  return "iframe";
}

export function getFrameSelectorChain(win: Window | null): string[] {
  if (!win) return [];
  const chain: string[] = [];
  let curr: Window | null = win;
  let depth = 0;

  while (curr && depth < 5) {
    let isTop = false;
    try {
      isTop = !curr.parent || curr.parent === curr || curr === curr.top;
    } catch {
      isTop = false;
    }
    if (isTop) break;

    let frameEl: Element | null = null;
    try {
      frameEl = (curr as any).frameElement;
    } catch {
      frameEl = null;
    }

    if (frameEl) {
      chain.unshift(getFrameSelector(frameEl));
      try {
        curr = frameEl.ownerDocument?.defaultView ?? null;
      } catch {
        curr = null;
      }
    } else {
      let selector = "iframe";
      try {
        if (curr.name) {
          selector = `iframe[name="${cssEscape(curr.name)}"]`;
        } else if (
          curr.location?.pathname &&
          curr.location.pathname !== "/" &&
          curr.location.pathname !== "blank"
        ) {
          selector = `iframe[src*="${cssEscape(curr.location.pathname)}"]`;
        }
      } catch {
        selector = "iframe";
      }
      chain.unshift(selector);

      try {
        curr = curr.parent !== curr ? curr.parent : null;
      } catch {
        curr = null;
      }
    }
    depth++;
  }

  return chain;
}

// ─── Locators ───

export function buildLocators(
  element: Element,
  privacyMode: "safe" | "raw"
): ElementDescriptor["locators"] {
  const candidates: ElementDescriptor["locators"] = [];
  const root = element.getRootNode() as Document | ShadowRoot;
  const add = (
    kind: string,
    expression: string,
    score: number,
    reasons: string[]
  ) => {
    let matchCount = 0;
    try {
      matchCount = root.querySelectorAll(expression).length;
    } catch {
      matchCount = 0;
    }
    candidates.push({
      kind,
      expression,
      matchCount,
      stabilityScore: score,
      reasons,
    });
  };
  for (const attr of ["data-testid", "data-test", "data-cy"]) {
    const value = element.getAttribute(attr);
    if (value)
      add("testId", `[${attr}="${cssEscape(value)}"]`, 0.98, [
        `${attr} 是测试属性`,
      ]);
  }
  const role =
    element.getAttribute("role") ||
    (element.tagName.toLowerCase() === "button" ? "button" : undefined);
  if (role) add("role", `role=${role}`, 0.86, ["语义角色"]);
  if (element.id && !/[0-9a-f]{8,}|uuid|random/i.test(element.id))
    add("id", `#${cssEscape(element.id)}`, 0.9, ["稳定 ID"]);
  const name = element.getAttribute("name");
  if (name)
    add(
      "attribute",
      `${element.tagName.toLowerCase()}[name="${cssEscape(name)}"]`,
      0.78,
      ["name 属性"]
    );
  const text = textOf(element, privacyMode);
  if (text && text.length < 80)
    candidates.push({
      kind: "text",
      expression: text,
      matchCount: 1,
      stabilityScore: 0.6,
      reasons: ["可见文本摘要"],
    });
  const tag = element.tagName.toLowerCase();
  add("css", tag, 0.25, ["CSS 兜底定位器"]);

  const sorted = candidates
    .sort((a, b) => b.stabilityScore - a.stabilityScore)
    .slice(0, 8);

  const win = element.ownerDocument?.defaultView ?? null;
  const frameChain = getFrameSelectorChain(win);
  if (frameChain.length > 0) {
    const prefix = `${frameChain.join(" >>> ")} >>> `;
    const frameReason = `位于子 Frame (${frameChain.join(" >>> ")})`;
    for (const c of sorted) {
      c.expression = `${prefix}${c.expression}`;
      c.reasons = [frameReason, ...c.reasons];
    }
  }

  return sorted;
}

// ─── Framework Detection ───

function probeElement(element: HTMLElement): FrameworkSnapshot | undefined {
  return detectVue(element) ?? detectReact(element);
}

// ─── Element Descriptor ───

export function describe(
  element: Element,
  privacyMode: "safe" | "raw"
): ElementDescriptor {
  const rect = element.getBoundingClientRect();
  const attributes: Record<string, string> = {};
  for (const attr of Array.from(element.attributes)) {
    if (
      /^(data-testid|data-test|data-cy|name|type|role|aria-|href)$/.test(
        attr.name
      ) ||
      attr.name.startsWith("aria-")
    )
      attributes[attr.name] = attr.value.slice(0, 512);
  }
  const role = element.getAttribute("role") || undefined;
  const framework =
    element instanceof HTMLElement ? probeElement(element) : undefined;
  return {
    tagName: element.tagName.toLowerCase(),
    id: element.id || undefined,
    classNames: Array.from(element.classList).slice(0, 12),
    attributes,
    text: textOf(element, privacyMode),
    role,
    accessibleName: element.getAttribute("aria-label") || undefined,
    boundingBox: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    },
    locators: buildLocators(element, privacyMode),
    framework,
  };
}

// ─── HTML Snapshot ───

export function snapshotHtml(element: Element): {
  sanitizedHtml?: string;
  htmlTruncated?: boolean;
} {
  try {
    const clone = element.cloneNode(true) as Element;
    clone
      .querySelectorAll("script,style,object,embed")
      .forEach((node) => node.remove());
    clone.querySelectorAll("input,textarea,select").forEach((node) => {
      node.removeAttribute("value");
      node.textContent = "";
    });
    const iframes: Element[] = [];
    if (clone.tagName.toLowerCase() === "iframe") {
      iframes.push(clone);
    }
    clone.querySelectorAll("iframe").forEach((node) => iframes.push(node));
    for (const iframe of iframes) {
      iframe.setAttribute("data-bug-lens-frame", "true");
      iframe.removeAttribute("srcdoc");
      iframe.textContent = "";
    }
    clone.querySelectorAll("*").forEach((node) => {
      for (const attribute of Array.from(node.attributes)) {
        if (
          /^on/i.test(attribute.name) ||
          /^(value|srcdoc|nonce)$/i.test(attribute.name)
        )
          node.removeAttribute(attribute.name);
        else if (attribute.value.length > 512)
          node.setAttribute(attribute.name, attribute.value.slice(0, 512));
      }
    });
    const html = clone.outerHTML;
    return html.length > 32_768
      ? {
          sanitizedHtml: `${html.slice(0, 32_768)}\n[TRUNCATED]`,
          htmlTruncated: true,
        }
      : { sanitizedHtml: html };
  } catch {
    return {};
  }
}

// ─── DOM Snapshot ───

export function buildDomSnapshot(
  element: Element,
  privacyMode: "safe" | "raw"
): TargetDomSnapshot {
  const ancestors: DomAncestorSnapshot[] = [];
  let currEl: Element | null = element;
  let parent = element.parentElement;
  while (ancestors.length < 5) {
    if (parent) {
      ancestors.push({
        tagName: parent.tagName.toLowerCase(),
        id: parent.id || undefined,
        classNames: Array.from(parent.classList).slice(0, 12),
        role: parent.getAttribute("role") || undefined,
        accessibleName: parent.getAttribute("aria-label") || undefined,
      });
      currEl = parent;
      parent = parent.parentElement;
    } else {
      const win: Window | null = currEl?.ownerDocument?.defaultView ?? null;
      let frameEl: Element | null = null;
      try {
        if (win && win !== win.top) {
          frameEl = (win as any).frameElement;
        }
      } catch {
        frameEl = null;
      }
      if (frameEl && ancestors.length < 5) {
        ancestors.push({
          tagName: frameEl.tagName.toLowerCase(),
          id: frameEl.id || undefined,
          classNames: Array.from(frameEl.classList).slice(0, 12),
          role: frameEl.getAttribute("role") || undefined,
          accessibleName: frameEl.getAttribute("aria-label") || undefined,
        });
        currEl = frameEl;
        parent = frameEl.parentElement;
      } else {
        break;
      }
    }
  }
  const rawStyle =
    typeof getComputedStyle !== "undefined" ? getComputedStyle(element) : null;
  const computedStyle: Record<string, string> = {};
  if (rawStyle) {
    for (const key of [
      "display",
      "visibility",
      "opacity",
      "position",
      "z-index",
      "width",
      "height",
      "color",
      "background-color",
      "pointer-events",
      "overflow",
    ]) {
      computedStyle[key] =
        typeof rawStyle.getPropertyValue === "function"
          ? rawStyle.getPropertyValue(key) || ""
          : (rawStyle as any)[key] || "";
    }
  }
  const input = element as HTMLInputElement;
  const frameChain = getFrameSelectorChain(
    element.ownerDocument?.defaultView ?? null
  );
  const frameSelector =
    frameChain.length > 0 ? frameChain.join(" >>> ") : undefined;
  const snapshot: TargetDomSnapshot & { frameSelector?: string } = {
    capturedAtEpochMs: Date.now(),
    element: describe(element, privacyMode),
    ...snapshotHtml(element),
    ancestors,
    frameSelector,
    state: {
      disabled:
        "disabled" in element
          ? Boolean((element as HTMLButtonElement).disabled)
          : undefined,
      checked:
        "checked" in element
          ? Boolean((input as HTMLInputElement).checked)
          : undefined,
      selected:
        "selected" in element
          ? Boolean((element as HTMLOptionElement).selected)
          : undefined,
      expanded:
        element.getAttribute("aria-expanded") === "true"
          ? true
          : element.getAttribute("aria-expanded") === "false"
            ? false
            : undefined,
      hidden: rawStyle
        ? rawStyle.display === "none" || rawStyle.visibility === "hidden"
        : false,
    },
    computedStyle,
  };
  return snapshot;
}

// ─── Element at Point ───

export function pageElementAtPoint(
  clientX: number,
  clientY: number,
  selectionLayer: HTMLElement | undefined,
  editorEl: HTMLElement | undefined
): Element | undefined {
  const previousPointerEvents = selectionLayer?.style.pointerEvents;
  if (selectionLayer) selectionLayer.style.pointerEvents = "none";
  const candidate = document
    .elementsFromPoint(clientX, clientY)
    .find(
      (item) =>
        !item.closest("#__wbr_issue_selection__") &&
        !item.closest("#__wbr_issue_editor__") &&
        !isWidgetElement(item)
    );
  if (selectionLayer && previousPointerEvents != null)
    selectionLayer.style.pointerEvents = previousPointerEvents;
  return candidate;
}
