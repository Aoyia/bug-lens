import type {
  AnnotationItem,
  RectBounds,
} from "../domain/screenshot-payload.ts";
import {
  pointInRectEdgeBand,
  pointToSegmentDistance,
} from "./overlay-geometry.ts";
import { computeTextLayout } from "./text-layout.ts";

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

      ctx.font =
        'bold 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

      const boundsRight = selection
        ? selection.x + selection.width
        : window.innerWidth;
      const maxTextWidth = Math.max(100, Math.min(300, boundsRight - px - 24));

      // 按换行符与 maxTextWidth 自动拆分多行
      const lines: string[] = [];
      const paragraphs = text.split("\n");
      for (const p of paragraphs) {
        if (!p) {
          lines.push("");
          continue;
        }
        let cur = "";
        for (const ch of p) {
          const test = cur + ch;
          if (ctx.measureText(test).width > maxTextWidth && cur !== "") {
            lines.push(cur);
            cur = ch;
          } else {
            cur = test;
          }
        }
        if (cur) lines.push(cur);
      }

      const paddingX = 10;
      const paddingY = 6;
      const lineHeight = 18;
      let maxW = 0;
      for (const l of lines) {
        const w = ctx.measureText(l).width;
        if (w > maxW) maxW = w;
      }

      const bgWidth = maxW + paddingX * 2;
      const bgHeight = paddingY * 2 + lines.length * lineHeight;

      ctx.fillStyle = "rgba(15, 23, 42, 0.92)";
      ctx.strokeStyle = "#0284c7";
      ctx.lineWidth = 1;

      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(px, py, bgWidth, bgHeight, 6);
      } else {
        ctx.rect(px, py, bgWidth, bgHeight);
      }
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "#f8fafc";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(
          lines[i],
          px + paddingX,
          py + paddingY + i * lineHeight + 1
        );
      }
    }
    ctx.restore();
  }

  if (selectedAnnotation) {
    renderSelectionHandles(ctx, selectedAnnotation);
  }
}

/**
 * 计算选中批注的删除按钮位置（与绘制逻辑完全一致，供命中检测复用）。
 * rect/privacy 位于右上角外侧，arrow 位于最右最上外侧，text 位于右上外侧。
 */
export function getDeleteButtonPosition(
  ann: AnnotationItem
): { x: number; y: number } | null {
  if (ann.type === "rect" || ann.type === "privacy") {
    const { x, y, width } = ann.bounds;
    return { x: x + width + 8, y: y - 8 };
  }
  if (ann.type === "arrow") {
    const maxX = Math.max(ann.startPoint.x, ann.endPoint.x);
    const minY = Math.min(ann.startPoint.y, ann.endPoint.y);
    return { x: maxX + 8, y: minY - 8 };
  }
  if (ann.type === "text") {
    // 与绘制共用同一布局函数：删除按钮锚点 = 气泡右上角外侧
    const layout = computeTextLayout(ann.text);
    return { x: ann.position.x + layout.bgWidth + 8, y: ann.position.y - 8 };
  }
  return null;
}

/** 绘制选中批注的调整手柄与删除按钮（无状态，仅依赖 ctx 与批注数据） */
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
    // 选中虚线框与绘制共用同一布局：气泡尺寸逐像素一致
    const layout = computeTextLayout(ann.text);
    const px = ann.position.x;
    const py = ann.position.y;

    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = "rgba(0, 122, 255, 0.85)";
    ctx.strokeRect(px - 2, py - 2, layout.bgWidth + 4, layout.bgHeight + 4);
    ctx.setLineDash([]);
  }

  // 绘制删除浮动图标按钮 (圆形红底 + 白色 ×)
  const deleteBtnPos = getDeleteButtonPosition(ann);
  if (deleteBtnPos) {
    const btnR = 9;
    ctx.save();
    ctx.fillStyle = "#ff4d4f";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.8;

    ctx.beginPath();
    ctx.arc(deleteBtnPos.x, deleteBtnPos.y, btnR, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(deleteBtnPos.x - 3.5, deleteBtnPos.y - 3.5);
    ctx.lineTo(deleteBtnPos.x + 3.5, deleteBtnPos.y + 3.5);
    ctx.moveTo(deleteBtnPos.x + 3.5, deleteBtnPos.y - 3.5);
    ctx.lineTo(deleteBtnPos.x - 3.5, deleteBtnPos.y + 3.5);
    ctx.stroke();

    ctx.restore();
  }

  ctx.restore();
}

/** 检测坐标是否命中选中批注的调整手柄（纯查询，无副作用） */
export function hitTestAnnotationHandle(
  ann: AnnotationItem,
  x: number,
  y: number
): { ann: AnnotationItem; handle: string } | null {
  // 删除按钮优先（绘制在批注外侧，半径 9 + 容差，命中区域略大于视觉尺寸便于点击）
  const deletePos = getDeleteButtonPosition(ann);
  if (deletePos) {
    const deleteRadius = 12;
    if (Math.hypot(x - deletePos.x, y - deletePos.y) <= deleteRadius) {
      return { ann, handle: "delete" };
    }
  }

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
