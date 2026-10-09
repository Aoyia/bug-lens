import type {
  AnnotationItem,
  RectBounds,
} from "../../domain/screenshot-payload";
import {
  pointInRectEdgeBand,
  pointToSegmentDistance,
} from "../overlay/overlay-geometry";
import {
  computeTextLayout,
  getTextHaloColor,
  TEXT_ANNOTATION_FONT,
  TEXT_DEFAULT_COLOR,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_WIDTH,
  TEXT_STROKE_WIDTH,
} from "./text-layout";

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

  // 3. 绘制用户标注图层
  const list = [...annotations];
  if (tempAnnotation) list.push(tempAnnotation);

  for (const ann of list) {
    ctx.save();
    ctx.strokeStyle = ann.color || "#FA5252";
    ctx.fillStyle = ann.color || "#FA5252";
    ctx.lineWidth = 2.5;

    if (ann.type === "rect") {
      const lw = 2;
      const rx = Math.floor(ann.bounds.x);
      const ry = Math.floor(ann.bounds.y);
      const rw = Math.round(ann.bounds.width);
      const rh = Math.round(ann.bounds.height);

      const rOuter = Math.min(6, Math.min(rw, rh) / 2);
      const rInner = Math.max(0, rOuter - lw);

      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.fillStyle = ann.color || "#FA5252";

      ctx.beginPath();
      if (ctx.roundRect && rw > 2 * lw && rh > 2 * lw) {
        ctx.roundRect(rx, ry, rw, rh, rOuter);
        ctx.roundRect(rx + lw, ry + lw, rw - 2 * lw, rh - 2 * lw, rInner);
      } else {
        ctx.rect(rx, ry, rw, rh);
        if (rw > 2 * lw && rh > 2 * lw) {
          ctx.rect(rx + lw, ry + lw, rw - 2 * lw, rh - 2 * lw);
        }
      }
      ctx.fill("evenodd");
      ctx.restore();
    } else if (ann.type === "arrow") {
      const sx = ann.startPoint.x;
      const sy = ann.startPoint.y;
      const ex = ann.endPoint.x;
      const ey = ann.endPoint.y;

      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();

      const angle = Math.atan2(ey - sy, ex - sx);
      const headLen = 14;
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(
        ex - headLen * Math.cos(angle - Math.PI / 6),
        ey - headLen * Math.sin(angle - Math.PI / 6)
      );
      ctx.lineTo(
        ex - headLen * Math.cos(angle + Math.PI / 6),
        ey - headLen * Math.sin(angle + Math.PI / 6)
      );
      ctx.closePath();
      ctx.fill();
    } else if (ann.type === "privacy") {
      const x = Math.round(ann.bounds.x);
      const y = Math.round(ann.bounds.y);
      const w = Math.round(ann.bounds.width);
      const h = Math.round(ann.bounds.height);
      const dpr = window.devicePixelRatio || 1;

      if (w > 0 && h > 0 && viewportImage) {
        const tileSize = 8;
        const sampleW = Math.max(1, Math.floor(w / tileSize));
        const sampleH = Math.max(1, Math.floor(h / tileSize));

        const offCanvas = document.createElement("canvas");
        offCanvas.width = sampleW;
        offCanvas.height = sampleH;
        const offCtx = offCanvas.getContext("2d");
        if (offCtx) {
          offCtx.imageSmoothingEnabled = false;
          offCtx.drawImage(
            viewportImage,
            x * dpr,
            y * dpr,
            w * dpr,
            h * dpr,
            0,
            0,
            sampleW,
            sampleH
          );

          ctx.save();
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(offCanvas, 0, 0, sampleW, sampleH, x, y, w, h);
          ctx.restore();
        }
      } else if (w > 0 && h > 0) {
        ctx.fillStyle = "rgba(100, 116, 139, 0.7)";
        ctx.fillRect(x, y, w, h);
      }
    } else if (ann.type === "text") {
      const px = ann.position.x;
      const py = ann.position.y;
      const text = ann.text;

      ctx.save();
      ctx.font = TEXT_ANNOTATION_FONT;

      const boundsRight = selection
        ? selection.x + selection.width
        : window.innerWidth;
      const maxTextWidth = Math.max(
        60,
        Math.min(TEXT_MAX_WIDTH, boundsRight - px - 8)
      );

      const { lines } = computeTextLayout(text, {
        measure: (s) => ctx.measureText(s).width,
        maxWidth: maxTextWidth,
      });

      const textColor = ann.color || TEXT_DEFAULT_COLOR;
      const haloColor = getTextHaloColor(textColor);

      ctx.textAlign = "left";
      ctx.textBaseline = "top";

      // 通道 1：底层反色外光晕描边
      ctx.strokeStyle = haloColor;
      ctx.lineWidth = TEXT_STROKE_WIDTH;
      ctx.lineJoin = "round";
      ctx.miterLimit = 2;
      for (let i = 0; i < lines.length; i++) {
        ctx.strokeText(lines[i], px, py + i * TEXT_LINE_HEIGHT);
      }

      // 通道 2：顶层文字填充
      ctx.fillStyle = textColor;
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], px, py + i * TEXT_LINE_HEIGHT);
      }
      ctx.restore();
    }
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
  const radius = 8;

  if (ann.type === "rect" || ann.type === "privacy") {
    const { x: bx, y: by, width: bw, height: bh } = ann.bounds;
    const handles = [
      { name: "nw", x: bx, y: by },
      { name: "ne", x: bx + bw, y: by },
      { name: "se", x: bx + bw, y: by + bh },
      { name: "sw", x: bx, y: by + bh },
    ];
    for (const h of handles) {
      if (Math.hypot(x - h.x, y - h.y) <= radius) {
        return { ann, handle: h.name };
      }
    }
  } else if (ann.type === "arrow") {
    if (Math.hypot(x - ann.startPoint.x, y - ann.startPoint.y) <= radius) {
      return { ann, handle: "start" };
    }
    if (Math.hypot(x - ann.endPoint.x, y - ann.endPoint.y) <= radius) {
      return { ann, handle: "end" };
    }
  }
  return null;
}

/** 矩形批注（rect/privacy）的命中容差：仅边框 ±6px 环形带可命中，内部视为空白穿透 */
const RECT_EDGE_HIT_TOLERANCE = 6;

/** 检测坐标是否命中任意批注（纯查询，无副作用），命中顺序：后添加者优先 */
export function hitTestAnnotation(
  annotations: AnnotationItem[],
  x: number,
  y: number
): AnnotationItem | null {
  for (let i = annotations.length - 1; i >= 0; i--) {
    const ann = annotations[i];
    if (ann.type === "rect" || ann.type === "privacy") {
      // 仅边框 ±6px 环形带可命中：避免上层方框内部遮罩下层方框无法选中
      if (pointInRectEdgeBand(x, y, ann.bounds, RECT_EDGE_HIT_TOLERANCE)) {
        return ann;
      }
    } else if (ann.type === "text") {
      // 与绘制共用同一布局：命中区 = 气泡区域（±4px 容差），杜绝"点空白也选中"
      const layout = computeTextLayout(ann.text);
      const px = ann.position.x;
      const py = ann.position.y;
      if (
        x >= px - 4 &&
        x <= px + layout.bgWidth + 4 &&
        y >= py - 4 &&
        y <= py + layout.bgHeight + 4
      ) {
        return ann;
      }
    } else if (ann.type === "arrow") {
      const dist = pointToSegmentDistance(
        { x, y },
        ann.startPoint,
        ann.endPoint
      );
      if (dist <= 10) {
        return ann;
      }
    }
  }
  return null;
}
