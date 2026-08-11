import type { TextAnnotation } from "../../domain/screenshot-payload.ts";
import {
  computeTextLayout,
  TEXT_ANNOTATION_FONT,
  TEXT_BUBBLE_BACKGROUND,
  TEXT_BUBBLE_SHADOW_BLUR,
  TEXT_BUBBLE_SHADOW_COLOR,
  TEXT_BUBBLE_SHADOW_OFFSET_Y,
  TEXT_BUBBLE_STROKE,
  TEXT_CORNER_RADIUS,
  TEXT_DEFAULT_COLOR,
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

    ctx.fillStyle = TEXT_BUBBLE_BACKGROUND;
    ctx.strokeStyle = TEXT_BUBBLE_STROKE;
    ctx.lineWidth = 1;

    // 轻阴影：暗色截图上白底气泡边缘更清晰（画完气泡立即重置，文字不带阴影）
    ctx.shadowColor = TEXT_BUBBLE_SHADOW_COLOR;
    ctx.shadowBlur = TEXT_BUBBLE_SHADOW_BLUR;
    ctx.shadowOffsetY = TEXT_BUBBLE_SHADOW_OFFSET_Y;

    ctx.beginPath();
    if ((ctx as any).roundRect) {
      (ctx as any).roundRect(px, py, bgWidth, bgHeight, TEXT_CORNER_RADIUS);
    } else {
      ctx.rect(px, py, bgWidth, bgHeight);
    }
    ctx.fill();
    ctx.stroke();

    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // 文字色可配置（白底上深色系可读）；未设置时用默认近黑
    ctx.fillStyle = ann.color || TEXT_DEFAULT_COLOR;
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
    // 命中区与绘制区共用同一布局函数：浏览器 draw 传入 ctx.measureText 实测，
    // 命中检测用默认字符分类估算器（无 2D ctx 也可运行），偏差由 ±4px 容差吸收。
    const layout = computeTextLayout(ann.text);
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
