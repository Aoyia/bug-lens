import type {
  AnnotationItem,
  RectBounds,
} from "../../domain/screenshot-payload";
import { getRenderer } from "./renderers/renderer-registry";
import { computeTextLayout } from "./text-layout";

/** renderAnnotations 的渲染输入：仅读状态，不改动任何调用方状态 */
export interface RenderAnnotationsOptions {
  selection: RectBounds | null;
  annotations: AnnotationItem[];
  tempAnnotation: AnnotationItem | null;
  selectedAnnotation: AnnotationItem | null;
  viewportImage: HTMLImageElement | null;
}

/**
 * 在 Overlay 的画布上绘制：全屏遮罩 Mask → 选区镂空 → 用户标注图层 → 选中批注手柄。
 * 无副作用：不读取或修改任何实例状态，只消费传入的 options 与 canvas 上下文。
 */
export function renderAnnotations(
  ctx: CanvasRenderingContext2D,
  options: RenderAnnotationsOptions
): void {
  const {
    selection,
    annotations,
    tempAnnotation,
    selectedAnnotation,
    viewportImage,
  } = options;

  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  // 1. 绘制全屏 45% 暗黑色遮罩 Mask
  ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  // 2. 动态擦除（镂空）选区内部，使其 100% 透出真实的原始鲜艳颜色！
  if (selection) {
    ctx.clearRect(selection.x, selection.y, selection.width, selection.height);
  }

  // 3. 绘制用户标注图层（委托给 RendererRegistry）
  const list = [...annotations];
  if (tempAnnotation) list.push(tempAnnotation);
  const rc = { selection, viewportImage };

  for (const ann of list) {
    ctx.save();
    ctx.strokeStyle = ann.color || "#FA5252";
    ctx.fillStyle = ann.color || "#FA5252";
    ctx.lineWidth = 2.5;
    getRenderer(ann.type).draw(ctx, ann, rc);
    ctx.restore();
  }

  if (selectedAnnotation) {
    renderSelectionHandles(ctx, selectedAnnotation);
  }
}

/**
 * 绘制选中批注的调整手柄与选中虚线框（无状态，仅依赖 ctx 与批注数据）。
 * 删除批注依赖 Delete/Backspace 键，不再提供浮动删除按钮。
 */
export function renderSelectionHandles(
  ctx: CanvasRenderingContext2D,
  ann: AnnotationItem
): void {
  const handleRadius = 4;
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#007aff";
  ctx.lineWidth = 1.5;

  const drawPoint = (hx: number, hy: number) => {
    ctx.beginPath();
    ctx.arc(hx, hy, handleRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  };

  if (ann.type === "rect" || ann.type === "privacy") {
    const { x, y, width, height } = ann.bounds;
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = "rgba(0, 122, 255, 0.85)";
    ctx.strokeRect(x - 2, y - 2, width + 4, height + 4);
    ctx.setLineDash([]);
    ctx.strokeStyle = "#007aff";

    drawPoint(x, y);
    drawPoint(x + width, y);
    drawPoint(x + width, y + height);
    drawPoint(x, y + height);
  } else if (ann.type === "arrow") {
    ctx.strokeStyle = "#007aff";
    drawPoint(ann.startPoint.x, ann.startPoint.y);
    drawPoint(ann.endPoint.x, ann.endPoint.y);
  } else if (ann.type === "text") {
    const layout = computeTextLayout(ann.text);
    const px = ann.position.x;
    const py = ann.position.y;

    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = "rgba(0, 122, 255, 0.85)";
    ctx.strokeRect(px - 3, py - 3, layout.width + 6, layout.height + 6);
    ctx.setLineDash([]);
  }

  ctx.restore();
}

/** 检测坐标是否命中选中批注的调整手柄（纯查询，无副作用；不含删除按钮） */
export function hitTestAnnotationHandle(
  ann: AnnotationItem,
  x: number,
  y: number
): { ann: AnnotationItem; handle: string } | null {
  const handle = getRenderer(ann.type).hitTestHandle(ann, x, y);
  return handle ? { ann, handle } : null;
}

/** 检测坐标是否命中任意批注（纯查询，无副作用），命中顺序：后添加者优先 */
export function hitTestAnnotation(
  annotations: AnnotationItem[],
  x: number,
  y: number
): AnnotationItem | null {
  for (let i = annotations.length - 1; i >= 0; i--) {
    const ann = annotations[i];
    if (getRenderer(ann.type).hitTest(ann, x, y)) {
      return ann;
    }
  }
  return null;
}
