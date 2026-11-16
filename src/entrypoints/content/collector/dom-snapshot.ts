import type {
  DomAncestorSnapshot,
  ElementDescriptor,
  FrameworkSnapshot,
  TargetDomSnapshot,
} from "../../../shared/protocol";
import {
  type PrivacyMode,
  isSensitiveKeyName,
  containsSensitiveData,
} from "../../../domain/privacy-policy";
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
  privacyMode: PrivacyMode
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
  if (privacyMode === "strict" && (isInput || isTextarea || isSelect))
    return undefined;
  if (privacyMode === "safe" && (isInput || isTextarea || isSelect)) {
    const name = element.getAttribute("name");
    const id = element.id || element.getAttribute("id");
    const autocomplete = element.getAttribute("autocomplete");
    const ariaLabel = element.getAttribute("aria-label");
    if (
      (name && isSensitiveKeyName(name)) ||
      (id && isSensitiveKeyName(id)) ||
      (autocomplete && isSensitiveKeyName(autocomplete)) ||
      (ariaLabel && isSensitiveKeyName(ariaLabel))
    ) {
      return undefined;
    }
    const val =
      isInput || isTextarea
        ? (element as HTMLInputElement | HTMLTextAreaElement).value
        : isSelect
          ? (element as HTMLSelectElement).value
          : undefined;
    if (containsSensitiveData(val)) {
      return undefined;
    }
  }
  const labelled =
    element.getAttribute("aria-label") ||
    element.getAttribute("alt") ||
    element.getAttribute("title");
  const text =
    labelled ||
    (isInput || isTextarea
      ? (element as HTMLInputElement | HTMLTextAreaElement).value
      : element.textContent);
  const clean = text?.replace(/\s+/g, " ").trim().slice(0, 256) || undefined;
  if (!clean) return undefined;

  // 图标类元素（i/svg/class包含icon）的无意义占位符过滤（如字体图标 "i"、"I" 或私有区代码点）
  const tag = element.tagName.toLowerCase();
  const isIconLike =
    tag === "i" ||
    tag === "svg" ||
    Array.from(element.classList).some((c) => /icon|ico\b/i.test(c));
  if (
    isIconLike &&
    !labelled &&
    (clean.length <= 1 || /^[\ue000-\uf8ff]$/u.test(clean))
  ) {
    return undefined;
  }
  return clean;
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
  privacyMode: PrivacyMode
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

export function resolveAccessibleName(element: Element): string | undefined {
  // 1. 直接属性
  const ariaLabel = element.getAttribute("aria-label")?.trim();
  if (ariaLabel) return ariaLabel.slice(0, 256);

  const title = element.getAttribute("title")?.trim();
  if (title) return title.slice(0, 256);

  // 2. aria-labelledby
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy && element.ownerDocument) {
    const ids = labelledBy.split(/\s+/).filter(Boolean);
    const texts = ids
      .map((id) =>
        element.ownerDocument.getElementById(id)?.textContent?.trim()
      )
      .filter(Boolean);
    if (texts.length > 0) {
      return texts.join(" ").slice(0, 256);
    }
  }

  // 3. 表单项关联 label
  const tag = element.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") {
    if (element.id && element.ownerDocument) {
      const labelEl = element.ownerDocument.querySelector(
        `label[for="${cssEscape(element.id)}"]`
      );
      const labelText = labelEl?.textContent
        ?.replace(/\s+/g, " ")
        .replace(/[:：]\s*$/, "")
        .trim();
      if (labelText) return labelText.slice(0, 256);
    }
    const parentLabel = element.closest("label");
    if (parentLabel) {
      const parentLabelText = parentLabel.textContent
        ?.replace(/\s+/g, " ")
        .replace(/[:：]\s*$/, "")
        .trim();
      if (parentLabelText) return parentLabelText.slice(0, 256);
    }
    const formItem = element.closest(
      ".el-form-item, .ant-form-item, .form-group, .form-item, [class*='form-item']"
    );
    if (formItem) {
      const labelEl = formItem.querySelector(
        ".el-form-item__label, .ant-form-item-label, label, [class*='label']"
      );
      const formLabelText = labelEl?.textContent
        ?.replace(/\s+/g, " ")
        .replace(/[:：]\s*$/, "")
        .trim();
      if (formLabelText) return formLabelText.slice(0, 256);
    }
    const placeholder = element.getAttribute("placeholder")?.trim();
    if (placeholder) return placeholder.slice(0, 256);
  }

  // 4. 图标类语义嗅探（从类名中解析意图）
  const isIconLike =
    tag === "i" ||
    tag === "svg" ||
    Array.from(element.classList).some((c) => /icon|ico\b/i.test(c));
  if (isIconLike) {
    const classStr = Array.from(element.classList).join(" ").toLowerCase();
    if (/close|cancel/i.test(classStr)) return "关闭图标";
    if (/arrow-left|prev|back|fold|collapse/i.test(classStr))
      return "返回/折叠";
    if (/arrow-right|next|expand|unfold/i.test(classStr)) return "前进/展开";
    if (/arrow-down|caret-down/i.test(classStr)) return "下拉";
    if (/arrow-up|caret-up/i.test(classStr)) return "收起";
    if (/delete|remove|trash/i.test(classStr)) return "删除";
    if (/edit|pencil/i.test(classStr)) return "编辑";
    if (/search/i.test(classStr)) return "搜索";
    if (/refresh|reload/i.test(classStr)) return "刷新";
    if (/info|help|question/i.test(classStr)) return "详情/提示";
    if (/check|success/i.test(classStr)) return "确认";
    if (/more/i.test(classStr)) return "更多";
  }

  return undefined;
}

// ─── Element Descriptor ───

export function describe(
  element: Element,
  privacyMode: PrivacyMode
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
    accessibleName: resolveAccessibleName(element),
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

export function snapshotHtml(
  element: Element,
  maxLength = 32_768
): {
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
    return html.length > maxLength
      ? {
          sanitizedHtml: `${html.slice(0, maxLength)}\n[TRUNCATED]`,
          htmlTruncated: true,
        }
      : { sanitizedHtml: html };
  } catch {
    return {};
  }
}

// ─── Critical Layout & Portal CSS Keys (Schema v5) ───

export const AI_CRITICAL_CSS_PROPERTIES = [
  // 1. 布局与定位基础 (6 项)
  "display",
  "position",
  "box-sizing",
  "top",
  "left",
  "z-index",
  // 2. 文本换行与溢出控制 (5 项)
  "white-space",
  "word-break",
  "overflow-wrap",
  "text-overflow",
  "-webkit-line-clamp",
  // 3. 盒模型与溢出行为 (7 项)
  "overflow",
  "overflow-x",
  "overflow-y",
  "width",
  "height",
  "min-width",
  "max-width",
  // 4. Flex 弹性盒模型 (5 项)
  "flex",
  "flex-direction",
  "flex-wrap",
  "justify-content",
  "align-items",
  // 5. Grid 网格布局 (3 项)
  "grid-template-columns",
  "grid-template-rows",
  "gap",
  // 6. 视觉可见性与层叠上下文 (6 项)
  "visibility",
  "opacity",
  "pointer-events",
  "transform",
  "isolation",
  "will-change",
] as const;

const EXTRA_COMPUTED_STYLE_KEYS = ["color", "background-color"] as const;

const WINNER_RULE_TARGET_PROPERTIES = new Set<string>([
  ...AI_CRITICAL_CSS_PROPERTIES,
  ...EXTRA_COMPUTED_STYLE_KEYS,
  "font-size",
  "line-height",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
]);

const PORTAL_CONTAINER_SELECTOR = [
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[role="tooltip"]',
  ".el-popper",
  ".el-select-dropdown",
  ".el-dialog__wrapper",
  ".el-overlay",
  ".el-popover",
  ".el-tooltip__popper",
  ".ant-dropdown",
  ".ant-modal-root",
  ".ant-popover",
  ".ant-select-dropdown",
  ".ant-tooltip",
  "[data-popper-placement]",
  "[data-floating-ui-portal]",
].join(", ");

const PORTAL_CLASS_REGEX =
  /(?:^|\b)(?:el-popper|el-select-dropdown|el-dialog|el-overlay|el-popover|ant-dropdown|ant-modal|ant-popover|ant-select-dropdown|ant-tooltip|popup|popover|dropdown|tooltip|modal|drawer)(?:\b|__|--|-)/i;

const APP_MOUNT_IDS = new Set(["app", "root", "__next", "__nuxt", "main"]);

export type RelatedPortalOverlay = {
  tagName: string;
  id?: string;
  classNames: string[];
  role?: string;
  boundingBox: { x: number; y: number; width: number; height: number };
  relationReason: string;
  sanitizedHtml?: string;
  htmlTruncated?: boolean;
};

export type PortalTriggerElement = {
  tagName: string;
  id?: string;
  classNames: string[];
  role?: string;
  accessibleName?: string;
  text?: string;
  selectorPath: string;
  componentName?: string;
  boundingBox?: { x: number; y: number; width: number; height: number };
  ancestors: DomAncestorSnapshot[];
};

export type WinnerCssRule = {
  selector: string;
  source: string;
  specificity: string;
  properties: Record<string, string>;
};

function readSafeRect(
  el: Element
):
  | {
      x: number;
      y: number;
      width: number;
      height: number;
      left: number;
      top: number;
      right: number;
      bottom: number;
    }
  | undefined {
  try {
    if (typeof el.getBoundingClientRect !== "function") return undefined;
    const r = el.getBoundingClientRect();
    return {
      x: r.x ?? r.left ?? 0,
      y: r.y ?? r.top ?? 0,
      width: r.width ?? 0,
      height: r.height ?? 0,
      left: r.left ?? r.x ?? 0,
      top: r.top ?? r.y ?? 0,
      right: r.right ?? (r.x ?? 0) + (r.width ?? 0),
      bottom: r.bottom ?? (r.y ?? 0) + (r.height ?? 0),
    };
  } catch {
    return undefined;
  }
}

function readSafeComputedStyle(el: Element): CSSStyleDeclaration | null {
  try {
    return typeof getComputedStyle === "function" ? getComputedStyle(el) : null;
  } catch {
    return null;
  }
}

function isVisibleOverlayElement(el: Element): boolean {
  const style = readSafeComputedStyle(el);
  if (style) {
    const display = style.getPropertyValue?.("display") ?? style.display;
    const visibility =
      style.getPropertyValue?.("visibility") ?? style.visibility;
    const opacity = style.getPropertyValue?.("opacity") ?? style.opacity;
    if (display === "none" || visibility === "hidden" || opacity === "0") {
      return false;
    }
  }
  const rect = readSafeRect(el);
  return Boolean(rect && rect.width > 0 && rect.height > 0);
}

function safeMatches(el: Element, selector: string): boolean {
  try {
    return typeof el.matches === "function" && el.matches(selector);
  } catch {
    return false;
  }
}

function buildCompactSelectorPath(element: Element): string {
  const parts: string[] = [];
  let curr: Element | null = element;
  while (curr && parts.length < 4) {
    const tag = curr.tagName?.toLowerCase() ?? "*";
    if (tag === "html" || tag === "body") break;
    if (curr.id) {
      parts.unshift(`${tag}#${cssEscape(curr.id)}`);
      break;
    }
    const classes = curr.classList
      ? Array.from(curr.classList)
          .slice(0, 2)
          .map((c) => `.${cssEscape(c)}`)
          .join("")
      : "";
    parts.unshift(`${tag}${classes}`);
    curr = curr.parentElement ?? null;
  }
  return parts.join(" > ") || (element.tagName?.toLowerCase() ?? "*");
}

function isOverlayLikeElement(el: Element): boolean {
  if (safeMatches(el, PORTAL_CONTAINER_SELECTOR)) return true;
  const role = el.getAttribute?.("role")?.toLowerCase();
  if (
    role &&
    ["dialog", "alertdialog", "menu", "listbox", "tooltip"].includes(role)
  ) {
    return true;
  }
  if (
    el.classList &&
    Array.from(el.classList).some((c) => PORTAL_CLASS_REGEX.test(c))
  ) {
    return true;
  }
  if (
    el.hasAttribute?.("data-popper-placement") ||
    el.hasAttribute?.("data-floating-ui-portal")
  ) {
    return true;
  }
  const style = readSafeComputedStyle(el);
  const pos = style?.getPropertyValue?.("position") ?? style?.position;
  return pos === "fixed" || pos === "absolute";
}

function findEnclosingPortalRoot(element: Element): Element | undefined {
  const doc = element.ownerDocument;
  const body = doc?.body;
  if (!body) return undefined;

  let curr: Element | null = element;
  while (curr && curr !== body) {
    const parent: Element | null = curr.parentElement ?? null;
    if (parent === body) {
      const idLower = (curr.id || "").toLowerCase();
      if (
        APP_MOUNT_IDS.has(idLower) ||
        curr.hasAttribute?.("data-reactroot") ||
        curr.tagName?.toLowerCase() === "main"
      ) {
        return undefined;
      }
      if (isOverlayLikeElement(curr)) return curr;
      return undefined;
    }
    if (isOverlayLikeElement(curr)) {
      // Check if an outer portal sits directly under body
      let walk: Element | null = curr;
      while (walk && walk.parentElement !== body) {
        walk = walk.parentElement ?? null;
      }
      if (walk && walk !== body) {
        const idLower = (walk.id || "").toLowerCase();
        if (
          !APP_MOUNT_IDS.has(idLower) &&
          !walk.hasAttribute?.("data-reactroot")
        ) {
          return walk;
        }
      }
      return curr;
    }
    curr = parent;
  }
  return undefined;
}

function rectGapDistance(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number }
): number {
  const dx = Math.max(0, b.left - a.right, a.left - b.right);
  const dy = Math.max(0, b.top - a.bottom, a.top - b.bottom);
  return Math.hypot(dx, dy);
}

/** 场景一（圈选宿主 -> 浮层）：发现与目标控件关联的 Portal 浮层。 */
export function findRelatedPortalOverlays(
  element: Element
): RelatedPortalOverlay[] {
  const doc = element.ownerDocument;
  if (!doc) return [];

  const seen = new Set<Element>();
  const hits: Array<{ el: Element; reason: string }> = [];

  // 1. aria-controls / aria-owns 精准 ID 引用（扫描目标自身及 3 层内祖先）
  let cursor: Element | null = element;
  for (let hop = 0; hop < 4 && cursor; hop += 1) {
    for (const attr of ["aria-controls", "aria-owns"] as const) {
      const raw = cursor.getAttribute?.(attr);
      if (!raw) continue;
      for (const id of raw.split(/\s+/).filter(Boolean)) {
        const portal = doc.getElementById?.(id);
        if (
          portal &&
          !seen.has(portal) &&
          !isWidgetElement(portal) &&
          !portal.contains?.(element) &&
          isVisibleOverlayElement(portal)
        ) {
          seen.add(portal);
          hits.push({ el: portal, reason: attr });
        }
      }
    }
    cursor = cursor.parentElement ?? null;
  }

  // 2. document.body 直属子树中空间邻近或显式弹出浮层
  const targetRect = readSafeRect(element);
  const bodyChildren = doc.body?.children ? Array.from(doc.body.children) : [];
  for (const child of bodyChildren) {
    if (seen.has(child) || isWidgetElement(child)) continue;
    if (child.contains?.(element) || element.contains?.(child)) continue;
    const idLower = (child.id || "").toLowerCase();
    if (APP_MOUNT_IDS.has(idLower) || child.hasAttribute?.("data-reactroot")) {
      continue;
    }
    if (!isOverlayLikeElement(child) || !isVisibleOverlayElement(child)) {
      continue;
    }
    const overlayRect = readSafeRect(child);
    if (!overlayRect) continue;
    const gap = targetRect
      ? rectGapDistance(targetRect, overlayRect)
      : Infinity;
    const role = child.getAttribute?.("role")?.toLowerCase();
    if (gap <= 16) {
      seen.add(child);
      hits.push({ el: child, reason: "spatial-proximity" });
    } else if (role === "dialog" || role === "alertdialog") {
      seen.add(child);
      hits.push({ el: child, reason: "aria-dialog" });
    }
  }

  return hits.slice(0, 3).map(({ el, reason }) => {
    const rect = readSafeRect(el) ?? { x: 0, y: 0, width: 0, height: 0 };
    const snap = snapshotHtml(el, 4_096);
    return {
      tagName: el.tagName.toLowerCase(),
      ...(el.id ? { id: el.id } : {}),
      classNames: el.classList ? Array.from(el.classList).slice(0, 12) : [],
      ...(el.getAttribute?.("role") ? { role: el.getAttribute("role")! } : {}),
      boundingBox: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
      relationReason: reason,
      ...snap,
    };
  });
}

/** 逆向查找 Portal 浮层对应的宿主 DOM 元素。 */
export function resolveTriggerDomElement(
  element: Element,
  fallbackTrigger?: Element
): Element | undefined {
  const doc = element.ownerDocument;
  if (!doc) return undefined;
  const portalRoot = findEnclosingPortalRoot(element);
  if (!portalRoot) return undefined;

  // 1. aria-controls / aria-owns 反向查找（匹配 portalRoot 或内部带 id 的容器）
  const idCandidates = new Set<string>();
  if (portalRoot.id) idCandidates.add(portalRoot.id);
  if (element.id) idCandidates.add(element.id);
  let walk: Element | null = element;
  while (walk && walk !== portalRoot) {
    if (walk.id) idCandidates.add(walk.id);
    walk = walk.parentElement ?? null;
  }

  if (typeof doc.querySelectorAll === "function" && idCandidates.size > 0) {
    for (const id of idCandidates) {
      try {
        const escaped = cssEscape(id);
        const matches = doc.querySelectorAll(
          `[aria-controls~="${escaped}"], [aria-owns~="${escaped}"]`
        );
        for (const candidate of Array.from(matches)) {
          if (
            !portalRoot.contains?.(candidate) &&
            !isWidgetElement(candidate)
          ) {
            return candidate;
          }
        }
      } catch {
        // Ignore invalid selector in test mocks
      }
    }
  }

  // 2. document.activeElement（如非 portal 内元素或 body）
  const active = (doc as { activeElement?: unknown }).activeElement;
  if (
    active &&
    typeof active === "object" &&
    typeof (active as Element).tagName === "string"
  ) {
    const activeEl = active as Element;
    const activeTag = activeEl.tagName.toLowerCase();
    if (
      activeTag !== "body" &&
      activeTag !== "html" &&
      !portalRoot.contains?.(activeEl) &&
      !isWidgetElement(activeEl)
    ) {
      return activeEl;
    }
  }

  // 3. 最近交互的宿主元素
  if (
    fallbackTrigger &&
    (fallbackTrigger as { isConnected?: boolean }).isConnected !== false &&
    !portalRoot.contains?.(fallbackTrigger) &&
    !isWidgetElement(fallbackTrigger)
  ) {
    return fallbackTrigger;
  }

  return undefined;
}

/** 场景二（圈选浮层 -> 宿主）：构造宿主 TriggerElement 描述。 */
export function findTriggerForPortalElement(
  element: Element,
  privacyMode: PrivacyMode,
  fallbackTrigger?: Element
): { triggerDomElement?: Element; triggerElement?: PortalTriggerElement } {
  const triggerEl = resolveTriggerDomElement(element, fallbackTrigger);
  if (!triggerEl) return {};

  const rect = readSafeRect(triggerEl);
  const ancestors: DomAncestorSnapshot[] = [];
  let parent = triggerEl.parentElement ?? null;
  while (parent && ancestors.length < 4) {
    const tag = parent.tagName.toLowerCase();
    if (tag === "html" || tag === "body") break;
    ancestors.push({
      tagName: tag,
      id: parent.id || undefined,
      classNames: parent.classList
        ? Array.from(parent.classList).slice(0, 12)
        : [],
      role: parent.getAttribute?.("role") || undefined,
      accessibleName: parent.getAttribute?.("aria-label") || undefined,
    });
    parent = parent.parentElement ?? null;
  }

  return {
    triggerDomElement: triggerEl,
    triggerElement: {
      tagName: triggerEl.tagName.toLowerCase(),
      ...(triggerEl.id ? { id: triggerEl.id } : {}),
      classNames: triggerEl.classList
        ? Array.from(triggerEl.classList).slice(0, 12)
        : [],
      ...(triggerEl.getAttribute?.("role")
        ? { role: triggerEl.getAttribute("role")! }
        : {}),
      ...(resolveAccessibleName(triggerEl)
        ? { accessibleName: resolveAccessibleName(triggerEl) }
        : {}),
      ...(textOf(triggerEl, privacyMode)
        ? { text: textOf(triggerEl, privacyMode) }
        : {}),
      selectorPath: buildCompactSelectorPath(triggerEl),
      ...(rect
        ? {
            boundingBox: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            },
          }
        : {}),
      ancestors,
    },
  };
}

function computeSelectorSpecificity(
  selector: string
): [number, number, number] {
  // Strip :where(...) (specificity 0) and escape strings
  const cleaned = selector
    .replace(/:where\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, (m) => {
      void m;
      return "[attr]";
    });
  const ids = (cleaned.match(/#[a-zA-Z_-][a-zA-Z0-9_-]*/g) ?? []).length;
  const attrsAndClasses = (
    cleaned.match(
      /(?:\.[a-zA-Z_-][a-zA-Z0-9_-]*|\[attr\]|(?<!:):[a-zA-Z-]+(?:\([^)]*\))?)/g
    ) ?? []
  ).length;
  const withoutIdsAndClasses = cleaned
    .replace(/#[a-zA-Z_-][a-zA-Z0-9_-]*/g, " ")
    .replace(/\.[a-zA-Z_-][a-zA-Z0-9_-]*/g, " ")
    .replace(/\[attr\]/g, " ")
    .replace(/:{1,2}[a-zA-Z-]+(?:\([^)]*\))?/g, " ")
    .replace(/[>+~,*]/g, " ");
  const tags = withoutIdsAndClasses
    .trim()
    .split(/\s+/)
    .filter((token) => /^[a-zA-Z][a-zA-Z0-9-]*$/.test(token)).length;
  const pseudoElements = (cleaned.match(/::[a-zA-Z-]+/g) ?? []).length;
  return [ids, attrsAndClasses, tags + pseudoElements];
}

function compareSpecificity(
  a: [number, number, number],
  b: [number, number, number]
): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  return a[2] - b[2];
}

function formatStylesheetSource(sheet: CSSStyleSheet, index: number): string {
  if (sheet.href) {
    try {
      const url = new URL(sheet.href);
      const last = url.pathname.split("/").filter(Boolean).pop();
      return last || sheet.href;
    } catch {
      return sheet.href.split("?")[0];
    }
  }
  const owner = sheet.ownerNode as Element | null | undefined;
  if (owner?.id) return `<style#${owner.id}>`;
  return `<style[${index}]>`;
}

/** 提取靶点元素上按 specificity / !important 决胜出的精准 CSS 规则（取代海量 cascade）。 */
export function extractWinnerCssRules(element: Element): WinnerCssRule[] {
  const doc = element.ownerDocument;
  if (!doc) return [];

  type WinningDecl = {
    important: number;
    specificity: [number, number, number];
    order: number;
    selector: string;
    source: string;
    value: string;
  };

  const winners = new Map<string, WinningDecl>();
  let orderCounter = 0;

  const recordCandidate = (
    prop: string,
    value: string,
    important: boolean,
    specificity: [number, number, number],
    selector: string,
    source: string
  ) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    const order = ++orderCounter;
    const imp = important ? 1 : 0;
    const prev = winners.get(prop);
    if (!prev) {
      winners.set(prop, {
        important: imp,
        specificity,
        order,
        selector,
        source,
        value: important ? `${trimmed} !important` : trimmed,
      });
      return;
    }
    const wins =
      imp > prev.important ||
      (imp === prev.important &&
        (compareSpecificity(specificity, prev.specificity) > 0 ||
          (compareSpecificity(specificity, prev.specificity) === 0 &&
            order > prev.order)));
    if (wins) {
      winners.set(prop, {
        important: imp,
        specificity,
        order,
        selector,
        source,
        value: important ? `${trimmed} !important` : trimmed,
      });
    }
  };

  const scanRuleList = (rules: CSSRuleList, source: string) => {
    for (let i = 0; i < rules.length; i += 1) {
      const rule = rules[i];
      // CSSMediaRule (type === 4) or CSSSupportsRule (type === 12)
      const nestedRules = (rule as CSSMediaRule).cssRules;
      if (nestedRules) {
        const mediaText = (rule as CSSMediaRule).media?.mediaText;
        if (
          mediaText &&
          typeof matchMedia === "function" &&
          !matchMedia(mediaText).matches
        ) {
          continue;
        }
        scanRuleList(nestedRules, source);
        continue;
      }
      const styleRule = rule as CSSStyleRule;
      if (!styleRule.selectorText || !styleRule.style) continue;

      const subSelectors = styleRule.selectorText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      let bestMatchedSpec: [number, number, number] | undefined;
      for (const sub of subSelectors) {
        if (!safeMatches(element, sub)) continue;
        const spec = computeSelectorSpecificity(sub);
        if (!bestMatchedSpec || compareSpecificity(spec, bestMatchedSpec) > 0) {
          bestMatchedSpec = spec;
        }
      }
      if (!bestMatchedSpec) continue;

      const decl = styleRule.style;
      for (let p = 0; p < decl.length; p += 1) {
        const prop = decl[p]?.toLowerCase();
        if (!prop || !WINNER_RULE_TARGET_PROPERTIES.has(prop)) continue;
        const val = decl.getPropertyValue(prop);
        const prio = decl.getPropertyPriority(prop) === "important";
        recordCandidate(
          prop,
          val,
          prio,
          bestMatchedSpec,
          styleRule.selectorText,
          source
        );
      }
    }
  };

  const sheets = doc.styleSheets ? Array.from(doc.styleSheets) : [];
  for (let i = 0; i < sheets.length; i += 1) {
    const sheet = sheets[i];
    if (sheet.disabled) continue;
    try {
      const rules = sheet.cssRules;
      if (rules) {
        scanRuleList(rules, formatStylesheetSource(sheet, i));
      }
    } catch {
      // Cross-origin stylesheet throws SecurityError; skip gracefully
    }
  }

  // Inline styles outrank author stylesheets
  const inlineStyle = (element as HTMLElement).style;
  if (inlineStyle && typeof inlineStyle.length === "number") {
    for (let p = 0; p < inlineStyle.length; p += 1) {
      const prop = inlineStyle[p]?.toLowerCase();
      if (!prop || !WINNER_RULE_TARGET_PROPERTIES.has(prop)) continue;
      const val = inlineStyle.getPropertyValue(prop);
      const prio = inlineStyle.getPropertyPriority(prop) === "important";
      recordCandidate(
        prop,
        val,
        prio,
        [1_000, 0, 0],
        "element.style",
        "inline"
      );
    }
  }

  const grouped = new Map<
    string,
    {
      selector: string;
      source: string;
      specificity: string;
      specTuple: [number, number, number];
      maxOrder: number;
      properties: Record<string, string>;
    }
  >();

  for (const [prop, decl] of winners.entries()) {
    const groupKey = `${decl.source}::${decl.selector}`;
    const existing = grouped.get(groupKey);
    const specLabel =
      decl.source === "inline"
        ? "inline"
        : `(${decl.specificity[0]},${decl.specificity[1]},${decl.specificity[2]})`;
    if (existing) {
      existing.properties[prop] = decl.value;
      existing.maxOrder = Math.max(existing.maxOrder, decl.order);
    } else {
      grouped.set(groupKey, {
        selector: decl.selector,
        source: decl.source,
        specificity: specLabel,
        specTuple: decl.specificity,
        maxOrder: decl.order,
        properties: { [prop]: decl.value },
      });
    }
  }

  return Array.from(grouped.values())
    .sort((a, b) => {
      const cmp = compareSpecificity(b.specTuple, a.specTuple);
      return cmp !== 0 ? cmp : b.maxOrder - a.maxOrder;
    })
    .slice(0, 20)
    .map(({ selector, source, specificity, properties }) => ({
      selector,
      source,
      specificity,
      properties,
    }));
}

// ─── DOM Snapshot ───

export function buildDomSnapshot(
  element: Element,
  privacyMode: PrivacyMode,
  options?: { fallbackTriggerElement?: Element }
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
      ...AI_CRITICAL_CSS_PROPERTIES,
      ...EXTRA_COMPUTED_STYLE_KEYS,
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
  const relatedOverlays = findRelatedPortalOverlays(element);
  const { triggerElement } = findTriggerForPortalElement(
    element,
    privacyMode,
    options?.fallbackTriggerElement
  );
  const winnerRules = extractWinnerCssRules(element);
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
    ...(relatedOverlays.length > 0 ? { relatedOverlays } : {}),
    ...(triggerElement ? { triggerElement } : {}),
    ...(winnerRules.length > 0 ? { winnerRules } : {}),
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
