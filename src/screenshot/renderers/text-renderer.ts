import type { TextAnnotation } from "../../domain/screenshot-payload.ts";
import {
  computeTextLayout,
  TEXT_ANNOTATION_FONT,
  TEXT_CORNER_RADIUS,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_WIDTH,
  TEXT_MIN_WIDTH,
  TEXT_PADDING_X,
  TEXT_PADDING_Y,
} from "../text-layout.ts";
import type {
  AnnotationRenderer,
  RendererContext,
} from "./renderer-registry.ts";

export const textRenderer: AnnotationRenderer<TextAnnotation> = {
  type: "text",

  draw(ctx, ann, rc) {
    const px = ann.position.x;
    const py = ann.position.y;
    const text = ann.text;

    ctx.font = TEXT_ANNOTATION_FONT;

    const boundsRight = rc.selection
      ? rc.selection.x + rc.selection.width
      : window.innerWidth;
    const maxTextWidth = Math.max(
      TEXT_MIN_WIDTH,
      Math.min(TEXT_MAX_WIDTH, boundsRight - px - 24)
    );

    // 布局与命中/删除按钮共用同一计算：换行 + 气泡尺寸与绘制逐像素一致
    const { lines, bgWidth, bgHeight } = computeTextLayout(text, {
      measure: (s) => ctx.measureText(s).width,
      maxWidth: maxTextWidth,
    });

    ctx.fillStyle = "rgba(15, 23, 42, 0.92)";
    ctx.strokeStyle = "#0284c7";
    ctx.lineWidth = 1;

    ctx.beginPath();
    if ((ctx as any).roundRect) {
      (ctx as any).roundRect(px, py, bgWidth, bgHeight, TEXT_CORNER_RADIUS);
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
        px + TEXT_PADDING_X,
        py + TEXT_PADDING_Y + i * TEXT_LINE_HEIGHT + 1
      );
    }
  },

  hitTest(ann, x, y) {
    // 命中区与绘制区共用布局：浏览器实测贴合气泡；node 单测无 2d ctx 退化为估算
    const layout = computeTextLayout(ann.text, { maxWidth: TEXT_MAX_WIDTH });
    const px = ann.position.x;
    const py = ann.position.y;
    return (
      x >= px - 4 &&
      x <= px + layout.bgWidth + 4 &&
      y >= py - 4 &&
      y <= py + layout.bgHeight + 4
    );
  },

  hitTestHandle(_ann, _x, _y) {
    return null; // text 无调整手柄
  },

  drag(ann, dx, dy) {
    ann.position.x += dx;
    ann.position.y += dy;
  },

  resize(_ann, _dx, _dy, _handle, _rc) {
    // text 无手柄，no-op（与现实现一致）
  },
};
