import type { RectBounds } from "../../domain/screenshot-payload";

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

/**
 * 过滤焦点节点集：剔除属于其他节点父级/祖先的容器节点（只保留极小化末端节点）。
 * 优先通过 parentElement 链以 O(N·D) 复杂度向上剪枝，兼容无 parentElement 的测试桩回退到 contains。
 */
export function pruneAncestorElements(elements: Element[]): Element[] {
  if (elements.length <= 1) return [...elements];
  const result = new Set<Element>(elements);
  let usedParentChain = false;

  for (const el of elements) {
    let parent = el.parentElement;
    while (parent) {
      usedParentChain = true;
      result.delete(parent);
      parent = parent.parentElement;
    }
  }

  if (!usedParentChain) {
    for (const a of elements) {
      for (const b of elements) {
        if (a !== b && typeof a.contains === "function" && a.contains(b)) {
          result.delete(a);
          break;
        }
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

  // 1. 真正的单节点场景：输入的原始节点只有一个，自动提升为其直接父节点（获取最小局部上下文）
  if (elements.length === 1) {
    const singleEl = elements[0];
    return singleEl.parentElement || singleEl;
  }

  // 2. 检查 elements 集合中是否本身就存在一个能包含所有其他节点的“根容器”
  for (const candidate of elements) {
    if (
      elements.every(
        (el) =>
          candidate === el ||
          (typeof candidate.contains === "function" && candidate.contains(el))
      )
    ) {
      return candidate;
    }
  }

  // 3. 多节点场景：计算公共祖先链 LCA
  const ancestorSet = new Set<Element>();
  let curr: Element | null = elements[0];
  while (curr) {
    ancestorSet.add(curr);
    curr = curr.parentElement;
  }

  let commonAncestor: Element | null = elements[1];
  while (commonAncestor && !ancestorSet.has(commonAncestor)) {
    commonAncestor = commonAncestor.parentElement;
  }

  if (!commonAncestor) return null;

  for (let i = 2; i < elements.length; i++) {
    const target = elements[i];
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
