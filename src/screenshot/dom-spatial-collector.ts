import type {
  AIElementNode,
  AnnotationItem,
  RectBounds,
} from "../domain/screenshot-payload.ts";
import { recentErrorsTracker } from "./recent-errors-tracker.ts";

export interface DomSpatialCollectOptions {
  cropBounds: RectBounds;
  annotations?: AnnotationItem[];
  rootElement?: HTMLElement;
}

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

/** 尝试侦测 React Fiber 或 Vue 组件实例名称 */
export function detectFrameworkComponentName(el: Element): string | undefined {
  try {
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
    if (!reactKey) {
      const propNames = Object.getOwnPropertyNames(el);
      reactKey = propNames.find(
        (k) =>
          k.startsWith("__reactFiber$") ||
          k.startsWith("__reactInternalInstance$")
      );
    }

    if (reactKey) {
      let fiber = (el as any)[reactKey];
      while (fiber) {
        const compName =
          (typeof fiber.type === "function" ? fiber.type.name : undefined) ||
          fiber.type?.name ||
          fiber.type?.displayName ||
          fiber.elementType?.name;
        if (compName) {
          return `<${compName}>`;
        }
        fiber = fiber.return;
      }
    }

    // Vue Component Key
    if ((el as any).__vueParentComponent$) {
      const vnode = (el as any).__vueParentComponent$;
      const name = vnode.type?.name || vnode.type?.__name;
      if (name) return `<${name}>`;
    }
    if ((el as any).__vue__) {
      const vue = (el as any).__vue__;
      const name = vue.$options?.name || vue.$options?._componentTag;
      if (name) return `<${name}>`;
    }
  } catch {
    // 忽略异常，降级返回 undefined
  }
  return undefined;
}

/** 提取 15 个最关键的布局与外观 Computed Styles */
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
      "width",
      "height",
    ];
    const res: Record<string, string> = {};
    for (const k of keys) {
      const val = style.getPropertyValue(
        k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
      );
      if (val && val !== "normal" && val !== "auto" && val !== "none") {
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

/** 核心 DOM 采集入口 */
export function collectSpatialDomTree(options: DomSpatialCollectOptions): {
  smallestCommonAncestorSelector: string;
  tree: AIElementNode;
} {
  const { cropBounds, annotations = [], rootElement = document.body } = options;

  // 1. 获取选区物理坐标与全量视口 DOM 节点
  const allElements = Array.from(rootElement.querySelectorAll("*"));
  const intersectedDomList: Element[] = [];

  // 区分马赛克与箭头批注
  const privacyMasks = annotations.filter((a) => a.type === "privacy");
  const arrows = annotations.filter((a) => a.type === "arrow");
  const rects = annotations.filter((a) => a.type === "rect");
  const texts = annotations.filter((a) => a.type === "text");

  for (const el of allElements) {
    if (
      el.shadowRoot ||
      el.tagName === "SCRIPT" ||
      el.tagName === "STYLE" ||
      el.tagName === "NOSCRIPT"
    ) {
      continue;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;

    const elBounds: RectBounds = {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    };

    if (isRectIntersecting(cropBounds, elBounds)) {
      intersectedDomList.push(el);
    }
  }

  // 2. 计算最小公共父节点 (SCA)
  const sca = findSmallestCommonAncestor(intersectedDomList) || rootElement;
  const scaSelector = buildCssSelector(sca);

  // 3. 构建节点递归导出函数
  const buildNode = (el: Element): AIElementNode | null => {
    const rect = el.getBoundingClientRect();
    const elBounds: RectBounds = {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };

    // 检查是否受马赛克保护，若在马赛克内则执行 [REDACTED] 双向脱敏
    const isPrivacyRedacted = privacyMasks.some(
      (m) => m.type === "privacy" && isRectIntersecting(elBounds, m.bounds)
    );

    // 检查是否被箭头直接指向
    const isArrowTarget = arrows.some(
      (a) => a.type === "arrow" && isPointInsideRect(a.endPoint, elBounds)
    );

    // 检查是否被红框选中
    const isHighlightedFocus = rects.some(
      (r) => r.type === "rect" && isRectIntersecting(elBounds, r.bounds)
    );

    // 检查附近文本批注
    const textCommentObj = texts.find(
      (t) => t.type === "text" && isPointInsideRect(t.position, elBounds)
    );

    const relativeRect: RectBounds = {
      x: Math.round(elBounds.x - cropBounds.x),
      y: Math.round(elBounds.y - cropBounds.y),
      width: elBounds.width,
      height: elBounds.height,
    };

    const rawText = (el as HTMLElement).innerText || el.textContent || "";
    const cleanText = rawText.trim().replace(/\s+/g, " ").slice(0, 100);

    const node: AIElementNode = {
      tagName: el.tagName.toLowerCase(),
      id: el.id || undefined,
      className:
        el.className && typeof el.className === "string"
          ? el.className.trim()
          : undefined,
      innerText: isPrivacyRedacted ? "[REDACTED]" : cleanText || undefined,
      selector: buildCssSelector(el),
      rect: elBounds,
      relativeRect,
      computedStyles: extractKeyComputedStyles(el),
      frameworkMetadata: {
        componentName: detectFrameworkComponentName(el),
      },
      intentFlags: {
        isArrowTarget: isArrowTarget || undefined,
        isHighlightedFocus: isHighlightedFocus || undefined,
        isPrivacyRedacted: isPrivacyRedacted || undefined,
        textComment: textCommentObj ? textCommentObj.text : undefined,
      },
    };

    // 递归处理子节点
    const childrenList: AIElementNode[] = [];
    for (let i = 0; i < el.children.length; i++) {
      const childEl = el.children[i];
      const childRect = childEl.getBoundingClientRect();
      if (childRect.width > 0 && childRect.height > 0) {
        const childBounds: RectBounds = {
          x: childRect.left,
          y: childRect.top,
          width: childRect.width,
          height: childRect.height,
        };
        if (isRectIntersecting(cropBounds, childBounds)) {
          const childNode = buildNode(childEl);
          if (childNode) childrenList.push(childNode);
        }
      }
    }

    if (childrenList.length > 0) {
      node.children = childrenList;
    }

    return node;
  };

  const tree = buildNode(sca) || {
    tagName: sca.tagName.toLowerCase(),
    selector: scaSelector,
    rect: cropBounds,
    relativeRect: {
      x: 0,
      y: 0,
      width: cropBounds.width,
      height: cropBounds.height,
    },
    computedStyles: {},
  };

  return {
    smallestCommonAncestorSelector: scaSelector,
    tree,
  };
}
