import type {
  AnnotationItem,
  BoxModelGeometry,
  DomAnchorNode,
  DomAncestorNode,
  DomContextTreeV2,
  DomLeafNode,
  DomTreeNode,
  FlexSqueezeRiskInfo,
  GridItemContextInfo,
  LayoutContextInfo,
  RectBounds,
  SelectOptionItem,
  SelectStateSnapshot,
  TextOverflowInfo,
} from "../domain/screenshot-payload.ts";
import type { FrameworkProbeEntry } from "../shared/protocol.ts";
import { t } from "../shared/i18n.ts";

/** 主世界框架探针：content script 隔离世界读不到 __vue__/__reactFiber$ 等 expando 属性，须注入页面主世界读取 */
export interface FrameworkProbeFn {
  (elements: Element[]): Promise<Map<Element, FrameworkProbeEntry>>;
}

export interface DomSpatialCollectOptions {
  cropBounds: RectBounds;
  annotations?: AnnotationItem[];
  rootElement?: HTMLElement;
  /** 可选：对已选定的候选元素执行主世界组件探针（无则回退为隔离世界内的同步检测） */
  probeFramework?: FrameworkProbeFn;
  /** 开启样式微调模式：无损收集全量盒模型尺寸与弹性布局上下文 */
  styleAdjustmentMode?: boolean;
  /** 关闭剪枝逻辑：收集全页 DOM 元素而不是仅收集与选区相交的元素 */
  disablePruning?: boolean;
}

/** 红框/马赛克标注覆盖元素面积 ≥ 该比例才算"命中"（避免祖先级误标） */
const ANNOTATION_COVERAGE_THRESHOLD = 0.5;
/** 有效叶子采集上限（防止整页框选时叶子爆炸） */
const MAX_LEAVES = 20;
/** 锚点组件链最大层数 */
const MAX_COMPONENT_PATH = 5;
/** 锚点 selectorPath 保留的最近层级数（更早层级用 … 省略） */
const MAX_SELECTOR_PATH_DEPTH = 8;
/** 文本截断长度 */
const TEXT_LIMIT = 80;

/** 物理矩形相交校验 */
export function isRectIntersecting(a: RectBounds, b: RectBounds): boolean {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

/** 检查元素物理坐标是否包含指定点 */
export function isPointInsideRect(
  point: { x: number; y: number },
  rect: RectBounds
): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

/** inner 被 outer 覆盖的面积占比（0~1） */
export function coverageRatio(inner: RectBounds, outer: RectBounds): number {
  const iw =
    Math.min(inner.x + inner.width, outer.x + outer.width) -
    Math.max(inner.x, outer.x);
  const ih =
    Math.min(inner.y + inner.height, outer.y + outer.height) -
    Math.max(inner.y, outer.y);
  if (iw <= 0 || ih <= 0) return 0;
  const overlap = iw * ih;
  return overlap / Math.max(1, inner.width * inner.height);
}

/** 过滤焦点节点集：剔除属于其他节点父级/祖先的容器节点（只保留极小化末端节点） */
export function pruneAncestorElements(elements: Element[]): Element[] {
  if (elements.length <= 1) return [...elements];
  const result = new Set<Element>(elements);

  for (const a of elements) {
    for (const b of elements) {
      if (a !== b && typeof a.contains === "function" && a.contains(b)) {
        result.delete(a);
        break;
      }
    }
  }

  return Array.from(result);
}

/** 查找一组 DOM 节点的最小公共父节点 (Smallest Common Ancestor) */
export function findSmallestCommonAncestor(
  elements: Element[]
): Element | null {
  if (elements.length === 0) return null;

  // 1. 净化节点集：过滤掉包含其他节点的祖先容器
  const minimalEls = pruneAncestorElements(elements);
  if (minimalEls.length === 0) return null;

  // 2. 单节点场景：自动提升为其直接父节点（获取最小局部上下文），除非父节点无效
  if (minimalEls.length === 1) {
    const singleEl = minimalEls[0];
    return singleEl.parentElement || singleEl;
  }

  // 3. 多节点场景：计算 LCA
  const ancestorSet = new Set<Element>();
  let curr: Element | null = minimalEls[0];
  while (curr) {
    ancestorSet.add(curr);
    curr = curr.parentElement;
  }

  let commonAncestor: Element | null = minimalEls[1];
  while (commonAncestor && !ancestorSet.has(commonAncestor)) {
    commonAncestor = commonAncestor.parentElement;
  }

  if (!commonAncestor) return null;

  for (let i = 2; i < minimalEls.length; i++) {
    const target = minimalEls[i];
    while (
      commonAncestor &&
      typeof commonAncestor.contains === "function" &&
      !commonAncestor.contains(target)
    ) {
      commonAncestor = commonAncestor.parentElement;
    }
  }

  return commonAncestor;
}

/** 从元素向上收集框架组件链（React fiber.return / Vue parent 链），返回 [最近组件, ..., 根] */
export function detectComponentPath(el: Element): string[] | undefined {
  const path: string[] = [];
  const push = (name: string | undefined) => {
    if (!name || name === "undefined") return;
    if (/^[a-z]/.test(name)) return; // 跳过 HTML 内置标签名
    const normalized = `<${name}>`;
    if (!path.includes(normalized)) path.push(normalized);
  };
  try {
    // React Fiber：__reactFiber$ 挂载在每个 DOM 元素自身
    let reactKey: string | undefined;
    for (const k in el) {
      if (
        k.startsWith("__reactFiber$") ||
        k.startsWith("__reactInternalInstance$")
      ) {
        reactKey = k;
        break;
      }
    }
    if (reactKey) {
      let fiber = (el as unknown as Record<string, unknown>)[reactKey] as any;
      let hops = 0;
      while (fiber && hops < 12) {
        const type = fiber.type;
        push(
          typeof type === "function"
            ? type.name || type.displayName
            : typeof type === "object" && type
              ? type.displayName || type.name
              : undefined
        );
        fiber = fiber.return;
        hops += 1;
        if (path.length >= MAX_COMPONENT_PATH) break;
      }
      return path.length > 0 ? path : undefined;
    }

    // Vue：__vueParentComponent$ / __vueParentComponent / __vnode / __vue__
    // 仅挂在"组件根 DOM"上，须沿 DOM 向上查找最近的组件根，再沿 vnode parent 链收集组件名。
    let host: Element | null = el;
    while (host) {
      const anyHost = host as any;
      const vnode3 =
        anyHost.__vueParentComponent$ || anyHost.__vueParentComponent;
      if (vnode3) {
        let vnode = vnode3;
        let vHops = 0;
        while (vnode && vHops < 12) {
          const type = vnode.type;
          push(type?.name || type?.__name);
          vnode = vnode.parent;
          vHops += 1;
          if (path.length >= MAX_COMPONENT_PATH) break;
        }
        return path.length > 0 ? path : undefined;
      }
      const vnodeFromEl = anyHost.__vnode;
      if (vnodeFromEl && vnodeFromEl.component) {
        let vnode = vnodeFromEl.component;
        let vHops = 0;
        while (vnode && vHops < 12) {
          const type = vnode.type;
          push(type?.name || type?.__name);
          vnode = vnode.parent;
          vHops += 1;
          if (path.length >= MAX_COMPONENT_PATH) break;
        }
        return path.length > 0 ? path : undefined;
      }
      const vue2 = anyHost.__vue__;
      if (vue2) {
        let vue = vue2;
        let v2Hops = 0;
        while (vue && v2Hops < 12) {
          const options = vue.$options;
          push(options?.name || options?._componentTag);
          vue = vue.$parent;
          v2Hops += 1;
          if (path.length >= MAX_COMPONENT_PATH) break;
        }
        return path.length > 0 ? path : undefined;
      }
      host = host.parentElement;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** 尝试侦测单个框架组件实例名称（就近向上取第一个有名字的组件） */
export function detectFrameworkComponentName(el: Element): string | undefined {
  const path = detectComponentPath(el);
  return path?.[0];
}

/** 与浏览器默认值相同、无诊断价值的计算样式值（直接丢弃以压缩体积） */
const DROPPABLE_STYLE_VALUES: Record<string, ReadonlySet<string>> = {
  backgroundColor: new Set(["rgba(0, 0, 0, 0)", "transparent"]),
  display: new Set(["block", "inline"]),
  position: new Set(["static"]),
  flexDirection: new Set(["row", "normal"]),
  justifyContent: new Set(["normal"]),
  alignItems: new Set(["normal", "stretch"]),
  zIndex: new Set(["auto"]),
  overflow: new Set(["visible"]),
  opacity: new Set(["1"]),
  visibility: new Set(["visible"]),
  fontWeight: new Set(["400", "normal"]),
};

/** 该样式键值是否为默认值/无信息值（可丢弃） */
export function shouldDropComputedStyle(key: string, value: string): boolean {
  if (!value) return true;
  const droppable = DROPPABLE_STYLE_VALUES[key];
  return droppable ? droppable.has(value) : false;
}

/** 提取关键的布局与外观 Computed Styles（过滤默认值，锚点专用） */
export function extractKeyComputedStyles(
  el: Element,
  styleAdjustmentMode = true
): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const style = window.getComputedStyle(el);
    const keys = [
      "color",
      "backgroundColor",
      "fontSize",
      "fontWeight",
      "lineHeight",
      "boxSizing",
      "letterSpacing",
      "textAlign",
      "display",
      "position",
      "flexDirection",
      "justifyContent",
      "alignItems",
      "zIndex",
      "overflow",
      "opacity",
      "visibility",
    ];
    const res: Record<string, string> = {};
    for (const k of keys) {
      const val = style.getPropertyValue(
        k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
      );
      if (val) {
        if (styleAdjustmentMode || !shouldDropComputedStyle(k, val)) {
          res[k] = val;
        }
      }
    }
    return res;
  } catch {
    return {};
  }
}

/** 提取无损盒模型几何体 (Box-Model Geometry) */
export function extractBoxModelGeometry(
  el: Element
): BoxModelGeometry | undefined {
  if (
    typeof window === "undefined" ||
    !el ||
    typeof el.getBoundingClientRect !== "function"
  )
    return undefined;
  try {
    const style = window.getComputedStyle(el);
    const parsePx = (val: string) => parseFloat(val) || 0;

    const margin = {
      top: parsePx(style.marginTop),
      right: parsePx(style.marginRight),
      bottom: parsePx(style.marginBottom),
      left: parsePx(style.marginLeft),
    };
    const padding = {
      top: parsePx(style.paddingTop),
      right: parsePx(style.paddingRight),
      bottom: parsePx(style.paddingBottom),
      left: parsePx(style.paddingLeft),
    };
    const border = {
      top: parsePx(style.borderTopWidth),
      right: parsePx(style.borderRightWidth),
      bottom: parsePx(style.borderBottomWidth),
      left: parsePx(style.borderLeftWidth),
    };

    const rect = el.getBoundingClientRect();
    const renderedRect: RectBounds = {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };

    const contentWidth = Math.max(
      0,
      renderedRect.width -
        (padding.left + padding.right + border.left + border.right)
    );
    const contentHeight = Math.max(
      0,
      renderedRect.height -
        (padding.top + padding.bottom + border.top + border.bottom)
    );

    return {
      boxSizing: style.boxSizing || "content-box",
      margin,
      padding,
      border,
      contentSize: {
        width: Math.round(contentWidth * 100) / 100,
        height: Math.round(contentHeight * 100) / 100,
      },
      renderedRect,
    };
  } catch {
    return undefined;
  }
}

/** 检测 DOM 节点在 Flex 父级下的弹性挤压风险 */
export function detectFlexSqueezeRisk(
  el: Element,
  style: CSSStyleDeclaration,
  isFlexParent: boolean
): FlexSqueezeRiskInfo | undefined {
  if (!isFlexParent) return undefined;

  const flexShrink = parseFloat(style.flexShrink) ?? 1;
  if (flexShrink <= 0) return undefined;

  const htmlEl = el as HTMLElement;
  const rect = htmlEl.getBoundingClientRect
    ? htmlEl.getBoundingClientRect()
    : null;
  if (!rect || rect.width <= 0) return undefined;

  const renderedWidth = rect.width;
  // 固有内容宽度：使用 scrollWidth 与 offsetWidth/renderedWidth 的最大值
  const intrinsicWidth = Math.max(
    htmlEl.scrollWidth || 0,
    Math.ceil(renderedWidth)
  );

  const squeezedWidthDelta = Math.max(0, intrinsicWidth - renderedWidth);
  const squeezeRatio =
    intrinsicWidth > 0 ? squeezedWidthDelta / intrinsicWidth : 0;

  // 挤压成立条件：损耗宽度 > 4px 且 挤压百分比 > 5%
  const isSqueezed = squeezedWidthDelta > 4 && squeezeRatio > 0.05;
  if (!isSqueezed) return undefined;

  return {
    isSqueezed: true,
    intrinsicWidth: Math.round(intrinsicWidth),
    renderedWidth: Math.round(renderedWidth),
    squeezedWidthDelta: Math.round(squeezedWidthDelta),
    squeezeRatio: Math.round(squeezeRatio * 100) / 100,
    flexShrink,
    reason: `固有内容宽为 ${Math.round(intrinsicWidth)}px，但因父元素 Flex 限制且 flex-shrink=${flexShrink}，被强制挤压损耗了 ${Math.round(squeezedWidthDelta)}px (${Math.round(squeezeRatio * 100)}%)`,
  };
}

/** 检测 DOM 节点发生的 CSS Overflow 文本截断及溢出 */
export function detectTextOverflow(
  el: Element,
  style: CSSStyleDeclaration
): TextOverflowInfo | undefined {
  const htmlEl = el as HTMLElement;
  if (
    !htmlEl ||
    typeof htmlEl.scrollWidth !== "number" ||
    typeof htmlEl.clientWidth !== "number"
  ) {
    return undefined;
  }

  const overflowX = style.overflowX;
  const overflowY = style.overflowY;
  const textOverflow = style.textOverflow;
  const webkitLineClamp = style.webkitLineClamp;

  const isOverflowHidden =
    overflowX === "hidden" ||
    overflowY === "hidden" ||
    style.overflow === "hidden" ||
    overflowX === "clip" ||
    overflowY === "clip";

  if (!isOverflowHidden) return undefined;

  const scrollW = htmlEl.scrollWidth;
  const clientW = htmlEl.clientWidth;
  const scrollH = htmlEl.scrollHeight;
  const clientH = htmlEl.clientHeight;

  const widthOverflowDelta = Math.max(0, scrollW - clientW);
  const heightOverflowDelta = Math.max(0, scrollH - clientH);

  const hasWidthTruncation =
    widthOverflowDelta > 2 && textOverflow === "ellipsis";
  const hasMultiLineClamp =
    heightOverflowDelta > 2 &&
    webkitLineClamp !== "none" &&
    Boolean(webkitLineClamp);
  const hasHiddenClipping =
    (widthOverflowDelta > 2 || heightOverflowDelta > 2) && isOverflowHidden;

  if (!hasWidthTruncation && !hasMultiLineClamp && !hasHiddenClipping) {
    return undefined;
  }

  let truncationType: "single_line" | "multi_line" | "overflow_hidden" =
    "overflow_hidden";
  if (hasWidthTruncation) {
    truncationType = "single_line";
  } else if (hasMultiLineClamp) {
    truncationType = "multi_line";
  }

  return {
    isTruncated: true,
    truncationType,
    scrollDimension: { width: scrollW, height: scrollH },
    clientDimension: { width: clientW, height: clientH },
    overflowDelta: { width: widthOverflowDelta, height: heightOverflowDelta },
    reason: `元素发生 ${truncationType} 文本截断/溢出，实际内容尺寸 ${scrollW}x${scrollH}px，视区裁剪尺寸 ${clientW}x${clientH}px (损耗截断: ${widthOverflowDelta}px 宽 / ${heightOverflowDelta}px 高)`,
  };
}

/** 检测 CSS Grid 网格轨道溢出及撑爆风险 */
export function detectGridOverflow(
  el: Element,
  style: CSSStyleDeclaration,
  parentStyle: CSSStyleDeclaration | null
): GridItemContextInfo | undefined {
  if (!parentStyle || !parentStyle.display.includes("grid")) {
    return undefined;
  }

  const htmlEl = el as HTMLElement;
  const rect = htmlEl.getBoundingClientRect
    ? htmlEl.getBoundingClientRect()
    : null;
  if (!rect || rect.width <= 0) {
    return {
      isGridItem: true,
      gridTemplateColumns: parentStyle.gridTemplateColumns,
      gridTemplateRows: parentStyle.gridTemplateRows,
      gap: parentStyle.gap,
      isGridOverflow: false,
    };
  }

  const minWidth = style.minWidth;
  const isMinWidthAuto =
    minWidth === "auto" || minWidth === "" || minWidth === "0px";
  const isOverflowingGrid =
    htmlEl.scrollWidth > rect.width + 4 && isMinWidthAuto;

  return {
    isGridItem: true,
    gridTemplateColumns: parentStyle.gridTemplateColumns,
    gridTemplateRows: parentStyle.gridTemplateRows,
    gap: parentStyle.gap,
    isGridOverflow: isOverflowingGrid,
    reason: isOverflowingGrid
      ? `Grid 项因默认 min-width: auto 被固有内容尺寸 (${htmlEl.scrollWidth}px) 撑爆，超出列轨道宽度 (${Math.round(rect.width)}px)。建议添加 min-width: 0;`
      : undefined,
  };
}

/** 提取弹性/网格布局上下文 (Layout Context) */
export function extractLayoutContext(
  el: Element
): LayoutContextInfo | undefined {
  if (typeof window === "undefined" || !el) return undefined;
  try {
    const style = window.getComputedStyle(el);
    const parent = el.parentElement;
    let parentStyle: CSSStyleDeclaration | null = null;
    if (parent) {
      parentStyle = window.getComputedStyle(parent);
    }

    const parentDisplay = parentStyle ? parentStyle.display : "";
    const isFlexParent = parentDisplay.includes("flex");
    const isGridParent = parentDisplay.includes("grid");

    const isFlexOrGridItem = isFlexParent || isGridParent;

    const flexSelf = isFlexParent
      ? {
          flexGrow: parseFloat(style.flexGrow) || 0,
          flexShrink: parseFloat(style.flexShrink) || 1,
          flexBasis: style.flexBasis || "auto",
          alignSelf: style.alignSelf || "auto",
        }
      : undefined;

    const flexSqueezeRisk = detectFlexSqueezeRisk(el, style, isFlexParent);

    const parentContainer = parentStyle
      ? {
          display: parentStyle.display,
          flexDirection: parentStyle.flexDirection,
          justifyContent: parentStyle.justifyContent,
          alignItems: parentStyle.alignItems,
          gap: parentStyle.gap,
        }
      : undefined;

    const textOverflow = detectTextOverflow(el, style);
    const gridSelf = detectGridOverflow(el, style, parentStyle);

    return {
      isFlexOrGridItem,
      flexSelf,
      flexSqueezeRisk,
      textOverflow,
      gridSelf,
      parentContainer,
    };
  } catch {
    return undefined;
  }
}

/** 仅提取布局差异样式（叶子/祖先用，比锚点更精简） */
export function extractLayoutStyles(el: Element): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const style = window.getComputedStyle(el);
    const keys = [
      "display",
      "position",
      "flexDirection",
      "zIndex",
      "overflow",
      "opacity",
    ];
    const res: Record<string, string> = {};
    for (const k of keys) {
      const val = style.getPropertyValue(
        k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
      );
      if (val && !shouldDropComputedStyle(k, val)) {
        res[k] = val;
      }
    }
    return res;
  } catch {
    return {};
  }
}

/** 生成唯一的 cssSelector */
/** 导出辅助计算 CSS 选择器和去除冗余的工具函数 */
export function buildCssSelector(el: Element): string {
  if (el.id) return `#${el.id}`;
  let path = el.tagName.toLowerCase();
  if (el.className && typeof el.className === "string") {
    const classes = el.className
      .trim()
      .split(/\s+/)
      .filter((c) => c && !c.includes(":") && !c.includes("["));
    if (classes.length > 0) {
      path += `.${classes.slice(0, 2).join(".")}`;
    }
  }
  return path;
}

export function formatDomNodeSelectorFields(el: Element): {
  selector: string;
  tagName?: string;
  className?: string;
  id?: string;
} {
  const tagName = el.tagName.toLowerCase();
  const id = el.id || undefined;
  const rawClass =
    el.className && typeof el.className === "string"
      ? el.className.trim()
      : undefined;
  const selector = buildCssSelector(el);

  // 方案 B：当 selector（如 "#submit-btn" 或 "span.field-title"）已包含 tagName 与 className 信息时，
  // 动态省略重复的 tagName 与 className 字段。
  const selectorCoversTagAndClass =
    selector.startsWith(`${tagName}.`) || selector === `#${id}`;

  return {
    selector,
    id,
    tagName: selectorCoversTagAndClass ? undefined : tagName,
    className: selectorCoversTagAndClass ? undefined : rawClass,
  };
}

/** 从 SCA 到 el 的完整 selector 路径（保留最近 N 层，更早用 … 省略） */
export function buildSelectorPath(el: Element, sca: Element): string {
  const parts: string[] = [];
  let curr: Element | null = el;
  while (curr && curr !== sca) {
    parts.unshift(buildCssSelector(curr));
    curr = curr.parentElement;
  }
  parts.unshift(buildCssSelector(sca));
  if (parts.length > MAX_SELECTOR_PATH_DEPTH) {
    const kept = parts.slice(parts.length - MAX_SELECTOR_PATH_DEPTH);
    return `… > ${kept.join(" > ")}`;
  }
  return parts.join(" > ");
}

/** 提取元素的直属文本内容（仅包含 Direct Text Nodes，不递归包含子元素的文本，避免父子节点重复） */
export function getDirectInnerText(
  el: Element,
  maxLen = 60
): string | undefined {
  let text = "";
  for (let i = 0; i < el.childNodes.length; i++) {
    const node = el.childNodes[i];
    if (node.nodeType === 3 /* Node.TEXT_NODE */) {
      text += node.textContent || "";
    }
  }
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return undefined;
  return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen)}...` : cleaned;
}

/** 提取 <select> 节点的完整 options 状态快照 */
export function extractSelectState(
  el: Element
): SelectStateSnapshot | undefined {
  if (el.tagName !== "SELECT") return undefined;
  const selectEl = el as HTMLSelectElement;
  const rawOptions = Array.from(selectEl.options || []);
  if (rawOptions.length === 0) {
    return {
      selectedIndex: selectEl.selectedIndex ?? -1,
      multiple: !!selectEl.multiple,
      options: [],
    };
  }

  const MAX_OPTIONS = 30;
  const options: SelectOptionItem[] = rawOptions
    .slice(0, MAX_OPTIONS)
    .map((opt) => ({
      value: opt.value || "",
      text: (opt.text || opt.textContent || "").trim(),
      selected: !!opt.selected,
      disabled: opt.disabled || undefined,
    }));

  if (rawOptions.length > MAX_OPTIONS) {
    options.push({
      value: "...",
      text: t("exceedMaxOptions", String(rawOptions.length)),
      selected: false,
      disabled: true,
    });
  }

  return {
    selectedIndex: selectEl.selectedIndex ?? -1,
    multiple: !!selectEl.multiple,
    options,
  };
}

/** 提取干净的 DOM 文本内容 (单行，限制长度) */
export function cleanText(el: Element, maxLen = 60): string | undefined {
  if (el.tagName === "SELECT") {
    const selectState = extractSelectState(el);
    if (!selectState || selectState.options.length === 0) {
      const val = (el as HTMLSelectElement).value || "";
      return val ? `[Select: ${val}]` : undefined;
    }
    const selectedTexts = selectState.options
      .filter((o) => o.selected)
      .map((o) => o.text || o.value);
    const selectedStr =
      selectedTexts.length > 0 ? selectedTexts.join(", ") : t("noneSelected");
    const allOptStr = selectState.options
      .map((o) => (o.selected ? `${o.text}*` : o.text))
      .join(", ");
    const fullSummary = t("selectOptionSummary", [selectedStr, allOptStr]);

    return maxLen && Number.isFinite(maxLen) && fullSummary.length > maxLen
      ? `${fullSummary.slice(0, maxLen)}...`
      : fullSummary;
  }

  const isInput = el.tagName === "INPUT" || el.tagName === "TEXTAREA";
  const raw = isInput
    ? (el as HTMLInputElement).value ||
      (el as HTMLInputElement).placeholder ||
      ""
    : (el as HTMLElement).innerText ||
      el.textContent ||
      el.getAttribute("aria-label") ||
      el.getAttribute("alt") ||
      "";
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (!cleaned) return undefined;
  return maxLen && Number.isFinite(maxLen) && cleaned.length > maxLen
    ? `${cleaned.slice(0, maxLen)}...`
    : cleaned;
}

/** 节点可见性检测 */
export function checkElementVisibility(
  el: Element
): "visible" | "hidden_css" | "zero_size" {
  if (typeof window === "undefined" || !el.getBoundingClientRect) {
    return "visible";
  }
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    if (typeof window.getComputedStyle === "function") {
      const style = window.getComputedStyle(el);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.opacity === "0"
      ) {
        return "hidden_css";
      }
    }
    return "zero_size";
  }

  if (typeof window.getComputedStyle === "function") {
    const style = window.getComputedStyle(el);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0"
    ) {
      return "hidden_css";
    }
  }
  return "visible";
}

export interface ElementExposureResult {
  exposure: "exposed" | "obscured" | "clipped" | "hidden_css";
  obscuredBy?: string;
}

/** 物理遮挡与视口露出生效算子 (Visual Overlap & Viewport Exposure Operator) */
export function checkElementExposure(
  el: Element,
  bounds?: RectBounds
): ElementExposureResult {
  const vis = checkElementVisibility(el);
  if (vis === "hidden_css" || vis === "zero_size") {
    return { exposure: "hidden_css" };
  }

  if (
    typeof document === "undefined" ||
    typeof document.elementFromPoint !== "function"
  ) {
    return { exposure: "exposed" };
  }

  const b =
    bounds ||
    (el.getBoundingClientRect
      ? el.getBoundingClientRect()
      : { x: 0, y: 0, width: 0, height: 0 });
  if (b.width <= 0 || b.height <= 0) {
    return { exposure: "hidden_css" };
  }

  // 1. 视口与父级 overflow 裁剪判定
  let parent = el.parentElement;
  while (
    parent &&
    parent !== document.body &&
    parent !== document.documentElement
  ) {
    if (
      typeof window !== "undefined" &&
      typeof window.getComputedStyle === "function"
    ) {
      const parentStyle = window.getComputedStyle(parent);
      if (
        parentStyle &&
        (parentStyle.overflow === "hidden" ||
          parentStyle.overflowX === "hidden" ||
          parentStyle.overflowY === "hidden" ||
          parentStyle.overflow === "clip")
      ) {
        if (typeof parent.getBoundingClientRect === "function") {
          const pRect = parent.getBoundingClientRect();
          if (
            b.x + b.width <= pRect.left ||
            b.x >= pRect.right ||
            b.y + b.height <= pRect.top ||
            b.y >= pRect.bottom
          ) {
            return { exposure: "clipped" };
          }
        }
      }
    }
    parent = parent.parentElement;
  }

  // 2. 视口点击采样点测试 (Sampling points: Center, 25%, 75%)
  const cx = Math.round(b.x + b.width / 2);
  const cy = Math.round(b.y + b.height / 2);

  const points = [
    { x: cx, y: cy },
    {
      x: Math.round(b.x + b.width * 0.25),
      y: Math.round(b.y + b.height * 0.25),
    },
    {
      x: Math.round(b.x + b.width * 0.75),
      y: Math.round(b.y + b.height * 0.75),
    },
  ];

  let topEl: Element | null = null;
  let exposedHitCount = 0;

  const winWidth =
    typeof window !== "undefined" && window.innerWidth
      ? window.innerWidth
      : 10000;
  const winHeight =
    typeof window !== "undefined" && window.innerHeight
      ? window.innerHeight
      : 10000;

  for (const pt of points) {
    if (pt.x < 0 || pt.y < 0 || pt.x > winWidth || pt.y > winHeight) {
      continue;
    }

    const hit = document.elementFromPoint(pt.x, pt.y);
    if (!hit) continue;

    const isSelfHit =
      hit === el ||
      (typeof el.contains === "function" && el.contains(hit)) ||
      (typeof hit.contains === "function" && hit.contains(el));

    if (isSelfHit) {
      exposedHitCount++;
    } else if (!topEl) {
      topEl = hit;
    }
  }

  if (exposedHitCount > 0) {
    return { exposure: "exposed" };
  }

  if (topEl) {
    return {
      exposure: "obscured",
      obscuredBy: buildCssSelector(topEl),
    };
  }

  return { exposure: "exposed" };
}

/** 节点的 Bug 异常与错误意图分析 */
export function detectErrorSignal(el: Element): boolean {
  const className =
    (el.className && typeof el.className === "string" ? el.className : "") ||
    "";
  const id = el.id || "";
  const role = el.getAttribute ? el.getAttribute("role") || "" : "";
  const combined = `${className} ${id} ${role}`.toLowerCase();

  const hasErrorKeyword =
    /error|invalid|danger|warning|fail|disabled|alert|tooltip/.test(combined);
  const hasAriaInvalid = el.getAttribute
    ? el.getAttribute("aria-invalid") === "true"
    : false;
  return hasErrorKeyword || hasAriaInvalid;
}

/** 计算标准模式下节点的语义价值诊断分值 (Semantic Value Score) */
export function calculateNodeSemanticScore(
  el: Element,
  duplicateCount = 0
): number {
  let score = 0;
  const tag = el.tagName.toUpperCase();

  // 1. 元素交互类型分
  const isInteractive =
    tag === "INPUT" ||
    tag === "BUTTON" ||
    tag === "SELECT" ||
    tag === "TEXTAREA" ||
    tag === "A" ||
    (el.hasAttribute && el.hasAttribute("contenteditable")) ||
    (el.getAttribute && el.getAttribute("role") === "button");

  const isHeader =
    /^H[1-6]$/.test(tag) ||
    (el.getAttribute && el.getAttribute("role") === "heading");
  const isMedia =
    tag === "IMG" || tag === "SVG" || tag === "CANVAS" || tag === "VIDEO";
  const isTextLeaf = hasOwnText(el);

  if (isInteractive) score += 8;
  else if (isHeader) score += 6;
  else if (isMedia) score += 4;
  else if (isTextLeaf) score += 4;
  else score += 1;

  // 2. 可见性与物理曝光状态打分
  const exp = checkElementExposure(el);
  const isErr = detectErrorSignal(el);

  if (exp.exposure === "exposed") {
    score += 5;
  } else if (exp.exposure === "obscured" && isErr) {
    // 被上层遮挡但带有 Bug 异常特征 (+3分)
    score += 3;
  } else if (exp.exposure === "obscured") {
    // 普通被遮挡节点 (-6分)
    score -= 6;
  } else if (exp.exposure === "clipped" || exp.exposure === "hidden_css") {
    score -= 5;
  }

  // 3. Bug 异常与错误特征 (+10分)
  if (isErr) score += 10;

  // 4. 定位符 (+4分)
  if (
    el.id ||
    (el.hasAttribute && el.hasAttribute("data-testid")) ||
    (el.hasAttribute && el.hasAttribute("name")) ||
    (el.hasAttribute && el.hasAttribute("aria-label"))
  ) {
    score += 4;
  }

  // 5. 同质化衰减 (第 3 个起衰减 x0.3)
  if (duplicateCount >= 2) {
    score *= 0.3;
  }

  return score;
}

/** 是否含非空文本 */
function hasOwnText(el: Element): boolean {
  const text = (el as HTMLElement).innerText?.trim();
  if (!text) return false;
  // 子元素若全部无文本，则本元素是"文本承载点"
  for (let i = 0; i < el.children.length; i++) {
    if ((el.children[i] as HTMLElement).innerText?.trim()) return false;
  }
  return true;
}

/** 从 from 向上走到 to 的层级距离（to 为 0；链上不存在返回 -1） */
export function domDepthRelativeTo(from: Element, to: Element): number {
  let d = 0;
  let curr: Element | null = from;
  while (curr && curr !== to) {
    d += 1;
    curr = curr.parentElement;
  }
  return curr === to ? d : -1;
}

/** 核心 DOM 采集入口：锚点优先三段式 */
export async function collectSpatialDomTree(
  options: DomSpatialCollectOptions
): Promise<DomContextTreeV2> {
  const {
    cropBounds,
    annotations = [],
    rootElement = document.body,
    probeFramework,
    disablePruning = false,
  } = options;

  // 1. 选区相交元素候选池
  const allElements = Array.from(rootElement.querySelectorAll("*"));
  const candidates: Element[] = [];
  const rectCache = new Map<Element, RectBounds>();

  const boundsOf = (el: Element): RectBounds => {
    const cached = rectCache.get(el);
    if (cached) return cached;
    const rect = el.getBoundingClientRect();
    const bounds: RectBounds = {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
    rectCache.set(el, bounds);
    return bounds;
  };

  for (const el of allElements) {
    if (
      el.shadowRoot ||
      el.tagName === "SCRIPT" ||
      el.tagName === "STYLE" ||
      el.tagName === "NOSCRIPT"
    ) {
      continue;
    }
    const bounds = boundsOf(el);
    const parentInCandidates =
      el.parentElement && candidates.includes(el.parentElement);
    if (
      bounds.width > 0 &&
      bounds.height > 0 &&
      isRectIntersecting(cropBounds, bounds)
    ) {
      candidates.push(el);
    } else if (parentInCandidates && detectErrorSignal(el)) {
      // 隐式报错/提示节点：父节点在框内，自身已被隐藏或为 0 尺寸
      candidates.push(el);
    }
  }

  const privacyMasks = annotations.filter((a) => a.type === "privacy");
  const arrows = annotations.filter((a) => a.type === "arrow");
  const rects = annotations.filter((a) => a.type === "rect");
  const texts = annotations.filter((a) => a.type === "text");

  // 2. 锚点：标注精确命中的元素（红框/马赛克按面积占比判定，箭头/文本按点命中）
  const anchorSet = new Map<Element, DomAnchorNode["intentFlags"]>();
  const addAnchor = (
    el: Element,
    flags: Partial<DomAnchorNode["intentFlags"]>
  ) => {
    const existing = anchorSet.get(el) ?? {};
    anchorSet.set(el, { ...existing, ...flags });
  };

  for (const el of candidates) {
    const bounds = boundsOf(el);
    for (const mask of privacyMasks) {
      if (
        mask.type === "privacy" &&
        coverageRatio(bounds, mask.bounds) >= ANNOTATION_COVERAGE_THRESHOLD
      ) {
        addAnchor(el, { isPrivacyRedacted: true });
      }
    }
    for (const r of rects) {
      if (
        r.type === "rect" &&
        coverageRatio(bounds, r.bounds) >= ANNOTATION_COVERAGE_THRESHOLD
      ) {
        addAnchor(el, { isHighlightedFocus: true });
      }
    }
    for (const a of arrows) {
      if (a.type === "arrow" && isPointInsideRect(a.endPoint, bounds)) {
        addAnchor(el, { isArrowTarget: true });
      }
    }
    for (const t of texts) {
      if (t.type === "text" && isPointInsideRect(t.position, bounds)) {
        addAnchor(el, { textComment: t.text });
      }
    }
  }

  const isHighFidelity = !!options.disablePruning;
  const textMaxLen = isHighFidelity ? Number.POSITIVE_INFINITY : 60;
  const styleAdjustmentMode =
    (options.styleAdjustmentMode ?? true) || isHighFidelity;

  // 3. 有效节点收集：高保真模式下不跑 hasOwnText，直接收集框内所有 candidates；标准模式跑多维打分精选
  let leafEls: Element[] = [];
  let truncated = false;

  if (isHighFidelity) {
    leafEls = candidates.filter((el) => !anchorSet.has(el));
    truncated = false;
  } else {
    const selectorCounts = new Map<string, number>();
    const scoredPool: Array<{ el: Element; score: number }> = [];

    for (const el of candidates) {
      if (anchorSet.has(el)) continue;
      const classNameStr =
        el.className && typeof el.className === "string" ? el.className : "";
      const selectorKey = el.tagName + (classNameStr ? `.${classNameStr}` : "");
      const count = selectorCounts.get(selectorKey) ?? 0;
      selectorCounts.set(selectorKey, count + 1);

      const score = calculateNodeSemanticScore(el, count);
      if (score > 0) {
        scoredPool.push({ el, score });
      }
    }
    scoredPool.sort((a, b) => b.score - a.score);
    leafEls = scoredPool.slice(0, MAX_LEAVES).map((i) => i.el);
    truncated = scoredPool.length > MAX_LEAVES;
  }

  // 4. SCA：求最小公共祖先（优先只基于极小化锚点；若无标注则基于极小化叶节点）
  const anchorEls = Array.from(anchorSet.keys());
  const scaTargetEls = anchorEls.length > 0 ? anchorEls : leafEls;
  const sca =
    findSmallestCommonAncestor(scaTargetEls) ||
    rootElement ||
    (scaTargetEls[0] ?? document.body);
  const scaSelector = buildCssSelector(sca);

  const focusEls = [...anchorSet.keys(), ...leafEls];

  // 5. 祖先链：锚点/叶子的去重祖先（含 SCA），depth 统一为相对 SCA 的距离
  const ancestorSet = new Set<Element>();
  const collectAncestors = (el: Element) => {
    let curr = el.parentElement;
    while (curr) {
      ancestorSet.add(curr);
      if (curr === sca) break;
      curr = curr.parentElement;
    }
  };
  for (const el of focusEls) collectAncestors(el);

  // 5.5 主世界组件探针：content script 隔离世界读不到 __vue__/__reactFiber$，
  //     由 background 注入页面主世界读取 Vue/React 组件链（失败则回退同步检测）
  const componentMap = probeFramework
    ? await probeFramework([...anchorSet.keys(), ...leafEls, ...ancestorSet])
    : null;
  const componentOf = (el: Element): FrameworkProbeEntry | undefined => {
    const probed = componentMap?.get(el);
    if (probed) return probed;
    const path = detectComponentPath(el);
    return path ? { componentName: path[0], componentPath: path } : undefined;
  };

  const ancestors: DomAncestorNode[] = Array.from(ancestorSet)
    .map((el) => ({ el, depth: domDepthRelativeTo(el, sca) }))
    .sort((a, b) => a.depth - b.depth)
    .map(({ el, depth }) => ({
      ...formatDomNodeSelectorFields(el),
      depth,
      componentName: componentOf(el)?.componentName,
      computedStyles: extractKeyComputedStyles(el, styleAdjustmentMode),
      layoutStyle: extractLayoutStyles(el),
    }));

  // 6. 组装三段式结果
  const anchors: DomAnchorNode[] = Array.from(anchorSet.entries()).map(
    ([el, intentFlags]) => {
      const bounds = boundsOf(el);
      const text = cleanText(el, textMaxLen);
      const comp = componentOf(el);
      const exp = checkElementExposure(el, bounds);
      return {
        ...formatDomNodeSelectorFields(el),
        selectorPath: buildSelectorPath(el, sca),
        innerText: intentFlags.isPrivacyRedacted ? "[REDACTED]" : text,
        relativeRect: {
          x: Math.round(bounds.x - cropBounds.x),
          y: Math.round(bounds.y - cropBounds.y),
          width: bounds.width,
          height: bounds.height,
        },
        visibility: checkElementVisibility(el),
        exposure: exp.exposure,
        obscuredBy: exp.obscuredBy,
        isErrorSignal: detectErrorSignal(el) || undefined,
        selectState: extractSelectState(el),
        computedStyles: extractKeyComputedStyles(el, styleAdjustmentMode),
        boxModel: styleAdjustmentMode ? extractBoxModelGeometry(el) : undefined,
        layoutContext: styleAdjustmentMode
          ? extractLayoutContext(el)
          : undefined,
        componentName: comp?.componentName,
        componentPath: comp?.componentPath,
        intentFlags: {
          isArrowTarget: intentFlags.isArrowTarget || undefined,
          isHighlightedFocus: intentFlags.isHighlightedFocus || undefined,
          isPrivacyRedacted: intentFlags.isPrivacyRedacted || undefined,
          textComment: intentFlags.textComment || undefined,
        },
      };
    }
  );

  const leaves: DomLeafNode[] = leafEls.map((el) => {
    const bounds = boundsOf(el);
    const text = cleanText(el, textMaxLen);
    const exp = checkElementExposure(el, bounds);
    return {
      tagName: el.tagName.toLowerCase(),
      id: el.id || undefined,
      selector: buildCssSelector(el),
      innerText: text,
      relativeRect: {
        x: Math.round(bounds.x - cropBounds.x),
        y: Math.round(bounds.y - cropBounds.y),
        width: bounds.width,
        height: bounds.height,
      },
      visibility: checkElementVisibility(el),
      exposure: exp.exposure,
      obscuredBy: exp.obscuredBy,
      isErrorSignal: detectErrorSignal(el) || undefined,
      selectState: extractSelectState(el),
      componentName: componentOf(el)?.componentName,
      computedStyles: extractKeyComputedStyles(el, styleAdjustmentMode),
      layoutStyle: extractLayoutStyles(el),
      boxModel: styleAdjustmentMode ? extractBoxModelGeometry(el) : undefined,
      layoutContext: styleAdjustmentMode ? extractLayoutContext(el) : undefined,
    };
  });

  // 5.9 构造嵌套 Tree 结构（支持父子节点 componentPath 继承压缩）
  const isSamePath = (pathA?: string[], pathB?: string[]): boolean => {
    if (pathA === pathB) return true;
    if (!pathA || !pathB) return false;
    if (pathA.length !== pathB.length) return false;
    return pathA.every((val, idx) => val === pathB[idx]);
  };

  const buildDomTree = (
    nodeEl: Element,
    parentPath?: string[]
  ): DomTreeNode => {
    const isAnchor = anchorSet.has(nodeEl);
    const isLeaf = leafEls.includes(nodeEl);
    const comp = componentOf(nodeEl);
    const bounds = boundsOf(nodeEl);
    const intentFlags = isAnchor ? anchorSet.get(nodeEl) : undefined;
    const rawText = isAnchor
      ? cleanText(nodeEl, 60)
      : getDirectInnerText(nodeEl, 60);

    const childrenEls: Element[] = [];
    for (let i = 0; i < nodeEl.children.length; i++) {
      const child = nodeEl.children[i];
      if (focusEls.includes(child) || Array.from(ancestorSet).includes(child)) {
        childrenEls.push(child);
      }
    }

    const currentPath = comp?.componentPath;
    // 如果子节点的 componentPath 与父节点完全一致，则省去子节点上的 componentPath 字段以压减体积
    const shouldKeepPath = currentPath && !isSamePath(currentPath, parentPath);

    // 单子节点折叠逻辑 (Wrapper Node Collapse):
    // 如果当前节点不是 SCA (顶层根)、不是 Anchor、在此节点处没有产生新组件身份切换且只有一个保留的子节点，
    // 并且本身没有直属文本节点，则将其包装层信息透传给子节点折叠。
    const isSca = nodeEl === sca;
    const isWrapperCandidate =
      !isSca &&
      !isAnchor &&
      !shouldKeepPath &&
      !rawText &&
      childrenEls.length === 1;

    if (isWrapperCandidate) {
      const wrapperSelector = buildCssSelector(nodeEl);
      const childNode = buildDomTree(childrenEls[0], parentPath);
      childNode.collapsedWrappers = [
        wrapperSelector,
        ...(childNode.collapsedWrappers || []),
      ];
      return childNode;
    }

    const node: DomTreeNode = {
      ...formatDomNodeSelectorFields(nodeEl),
      innerText:
        isAnchor && intentFlags?.isPrivacyRedacted ? "[REDACTED]" : rawText,
      relativeRect: {
        x: Math.round(bounds.x - cropBounds.x),
        y: Math.round(bounds.y - cropBounds.y),
        width: bounds.width,
        height: bounds.height,
      },
      computedStyles: isAnchor ? extractKeyComputedStyles(nodeEl) : undefined,
      componentName:
        comp?.componentName ??
        comp?.componentPath?.[comp?.componentPath.length - 1],
      componentPath: shouldKeepPath ? currentPath : undefined,
      intentFlags: intentFlags
        ? {
            isArrowTarget: intentFlags.isArrowTarget || undefined,
            isHighlightedFocus: intentFlags.isHighlightedFocus || undefined,
            isPrivacyRedacted: intentFlags.isPrivacyRedacted || undefined,
            textComment: intentFlags.textComment || undefined,
          }
        : undefined,
    };

    if (childrenEls.length > 0) {
      node.children = childrenEls.map((child) =>
        buildDomTree(child, currentPath)
      );
    }
    return node;
  };

  const domTree = buildDomTree(sca);

  return {
    smallestCommonAncestorSelector: scaSelector,
    meta: {
      anchorCount: anchors.length,
      leafCount: leaves.length,
      ancestorCount: ancestors.length,
      truncated,
    },
    tree: domTree,
    anchors,
    leaves,
    ancestors,
  };
}
