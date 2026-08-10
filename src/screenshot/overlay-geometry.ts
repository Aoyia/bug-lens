import type { RectBounds } from "../domain/screenshot-payload.ts";

/** 点到线段的最短距离（用于箭头批注命中检测） */
export function pointToSegmentDistance(
  p: { x: number; y: number },
  v: { x: number; y: number },
  w: { x: number; y: number }
): number {
  const l2 = (w.x - v.x) ** 2 + (w.y - v.y) ** 2;
  if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y);
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(
    p.x - (v.x + t * (w.x - v.x)),
    p.y - (v.y + t * (w.y - v.y))
  );
}

/** 将点限制在指定矩形内 */
export function clampPointToRect(
  p: { x: number; y: number },
  rect: RectBounds
): { x: number; y: number } {
  const minX = rect.x;
  const maxX = rect.x + rect.width;
  const minY = rect.y;
  const maxY = rect.y + rect.height;
  return {
    x: Math.max(minX, Math.min(p.x, maxX)),
    y: Math.max(minY, Math.min(p.y, maxY)),
  };
}

/** 8 点 Resize 手柄：基于初始选区与位移计算新选区（与截图框拖拽共用） */
export function computeResizedRect(
  handle: string,
  initial: RectBounds,
  dx: number,
  dy: number
): RectBounds {
  let { x, y, width, height } = initial;

  if (handle.includes("n")) {
    const newH = height - dy;
    if (newH > 10) {
      y = y + dy;
      height = newH;
    }
  }
  if (handle.includes("s")) {
    const newH = height + dy;
    if (newH > 10) height = newH;
  }
  if (handle.includes("w")) {
    const newW = width - dx;
    if (newW > 10) {
      x = x + dx;
      width = newW;
    }
  }
  if (handle.includes("e")) {
    const newW = width + dx;
    if (newW > 10) width = newW;
  }

  return { x, y, width, height };
}

/** 判断点是否落在选区的边缘区域（外沿命中且非内部），用于锁定后的平移拖拽 */
export function hitTestSelectionEdge(
  x: number,
  y: number,
  selection: RectBounds,
  threshold = 10
): boolean {
  const outerHit =
    x >= selection.x - threshold &&
    x <= selection.x + selection.width + threshold &&
    y >= selection.y - threshold &&
    y <= selection.y + selection.height + threshold;
  const innerHit =
    x > selection.x + threshold &&
    x < selection.x + selection.width - threshold &&
    y > selection.y + threshold &&
    y < selection.y + selection.height - threshold;
  return outerHit && !innerHit;
}

/** 拖拽截图框整体平移：计算目标坐标并限制在视口内 */
export function computeDraggedPosition(
  initial: RectBounds,
  dx: number,
  dy: number
): { x: number; y: number } {
  const maxLeft = Math.max(0, window.innerWidth - initial.width);
  const maxTop = Math.max(0, window.innerHeight - initial.height);
  const targetX = initial.x + dx;
  const targetY = initial.y + dy;
  return {
    x: Math.max(0, Math.min(targetX, maxLeft)),
    y: Math.max(0, Math.min(targetY, maxTop)),
  };
}
