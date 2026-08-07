import type {
  AnnotationItem,
  DomAnchorNode,
  DomAncestorNode,
  DomContextTreeV2,
  DomLeafNode,
  RectBounds,
} from "../domain/screenshot-payload.ts";
import type { FrameworkProbeEntry } from "../shared/protocol.ts";

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

/** 查找一组 DOM 节点的最小公共父节点 (Smallest Common Ancestor) */
export function findSmallestCommonAncestor(
  elements: Element[]
): Element | null {
  if (elements.length === 0) return null;
  if (elements.length === 1) return elements[0].parentElement || elements[0];

  const getAncestors = (el: Element): Element[] => {
    const list: Element[] = [];
    let curr: Element | null = el;
    while (curr) {
      list.unshift(curr);
      curr = curr.parentElement;
    }
    return list;
  };

  const ancestorChains = elements.map(getAncestors);
  let commonAncestor = ancestorChains[0][0];
  const minLength = Math.min(...ancestorChains.map((c) => c.length));

  for (let i = 0; i < minLength; i++) {
    const target = ancestorChains[0][i];
    if (ancestorChains.every((chain) => chain[i] === target)) {
      commonAncestor = target;
    } else {
      break;
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
      let fiber = (el as any)[reactKey];
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
export function extractKeyComputedStyles(el: Element): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const style = window.getComputedStyle(el);
    const keys = [
      "color",
      "backgroundColor",
      "fontSize",
      "fontWeight",
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
      if (val && !shouldDropComputedStyle(k, val)) {
        res[k] = val;
      }
    }
    return res;
  } catch {
    return {};
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

/** 归一化文本：去空白、截断 */
function cleanText(el: Element, limit = TEXT_LIMIT): string | undefined {
  const raw = (el as HTMLElement).innerText || el.textContent || "";
  const cleaned = raw.trim().replace(/\s+/g, " ").slice(0, limit);
  return cleaned || undefined;
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
    if (bounds.width <= 0 || bounds.height <= 0) continue;
    if (isRectIntersecting(cropBounds, bounds)) candidates.push(el);
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

  // 3. 有效叶子：含非空文本的叶子元素（排除锚点，按文本长度取 top N）
  const leafPool: Array<{ el: Element; textLen: number }> = [];
  for (const el of candidates) {
    if (anchorSet.has(el)) continue;
    if (!hasOwnText(el)) continue;
    const text = (el as HTMLElement).innerText?.trim() ?? "";
    leafPool.push({ el, textLen: text.length });
  }
  leafPool.sort((a, b) => b.textLen - a.textLen);
  const leafEls = leafPool.slice(0, MAX_LEAVES).map((i) => i.el);
  const truncated = leafPool.length > MAX_LEAVES;

  // 4. SCA：锚点 + 叶子 的公共祖先
  const focusEls = [...anchorSet.keys(), ...leafEls];
  const sca =
    findSmallestCommonAncestor(focusEls) ||
    rootElement ||
    (focusEls[0] ?? document.body);
  const scaSelector = buildCssSelector(sca);

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
      tagName: el.tagName.toLowerCase(),
      id: el.id || undefined,
      className:
        el.className && typeof el.className === "string"
          ? el.className.trim()
          : undefined,
      selector: buildCssSelector(el),
      depth,
      componentName: componentOf(el)?.componentName,
      layoutStyle: extractLayoutStyles(el),
    }));

  // 6. 组装三段式结果
  const anchors: DomAnchorNode[] = Array.from(anchorSet.entries()).map(
    ([el, intentFlags]) => {
      const bounds = boundsOf(el);
      const text = cleanText(el);
      const comp = componentOf(el);
      return {
        tagName: el.tagName.toLowerCase(),
        id: el.id || undefined,
        className:
          el.className && typeof el.className === "string"
            ? el.className.trim()
            : undefined,
        selector: buildCssSelector(el),
        selectorPath: buildSelectorPath(el, sca),
        innerText: intentFlags.isPrivacyRedacted ? "[REDACTED]" : text,
        relativeRect: {
          x: Math.round(bounds.x - cropBounds.x),
          y: Math.round(bounds.y - cropBounds.y),
          width: bounds.width,
          height: bounds.height,
        },
        computedStyles: extractKeyComputedStyles(el),
        componentName: comp?.componentName ?? comp?.componentPath?.[0],
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
    const text = cleanText(el, 60);
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
      componentName: componentOf(el)?.componentName,
      layoutStyle: extractLayoutStyles(el),
    };
  });

  return {
    smallestCommonAncestorSelector: scaSelector,
    meta: {
      anchorCount: anchors.length,
      leafCount: leaves.length,
      ancestorCount: ancestors.length,
      truncated,
    },
    anchors,
    leaves,
    ancestors,
  };
}
