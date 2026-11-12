import type { TextAnnotation } from "../../../domain/screenshot-payload";
import {
  computeTextLayout,
  getTextHaloColor,
  TEXT_ANNOTATION_FONT,
  TEXT_ANNOTATION_FONT_FAMILY,
  TEXT_ANNOTATION_FONT_SIZE,
  TEXT_ANNOTATION_FONT_WEIGHT,
  TEXT_DEFAULT_COLOR,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_WIDTH,
  TEXT_STROKE_WIDTH,
} from "../text-layout";
import type { AnnotationRenderer } from "../annotation-types";

export const textRenderer: AnnotationRenderer<TextAnnotation> = {
  type: "text",

  draw(ctx, ann, rc) {
    const dpr = rc?.dpr ?? 1;
    const px = ann.position.x * dpr;
    const py = ann.position.y * dpr;
    const text = ann.text;

    ctx.save();
    ctx.font =
      dpr === 1
        ? TEXT_ANNOTATION_FONT
        : `${TEXT_ANNOTATION_FONT_WEIGHT} ${TEXT_ANNOTATION_FONT_SIZE * dpr}px ${TEXT_ANNOTATION_FONT_FAMILY}`;

    const boundsRight = rc.selection
      ? rc.selection.x + rc.selection.width
      : typeof window !== "undefined"
        ? window.innerWidth
        : (ctx.canvas?.width || 800) / dpr;
    const maxTextWidth = Math.max(
      60,
      Math.min(TEXT_MAX_WIDTH, boundsRight - ann.position.x - 8)
    );

    // 布局计算：按真实文字度量折行（dpr > 1 时将物理像素测量值还原为逻辑像素以复用统一换行）
    const { lines } = computeTextLayout(text, {
      measure: (s) => ctx.measureText(s).width / dpr,
      maxWidth: maxTextWidth,
    });

    const textColor = ann.color || TEXT_DEFAULT_COLOR;
    const haloColor = getTextHaloColor(textColor);
    const lineHeight = TEXT_LINE_HEIGHT * dpr;
    const strokeWidth = TEXT_STROKE_WIDTH * dpr;

    ctx.textAlign = "left";
    ctx.textBaseline = "top";

    // 通道 1：底层反色外光晕描边（解决明暗杂色背景下的辨识度）
    if (typeof ctx.strokeText === "function") {
      ctx.strokeStyle = haloColor;
      ctx.lineWidth = strokeWidth;
      ctx.lineJoin = "round";
      ctx.miterLimit = 2;
      for (let i = 0; i < lines.length; i++) {
        ctx.strokeText(lines[i], px, py + i * lineHeight);
      }
    }

    // 通道 2：顶层字符填充
    ctx.fillStyle = textColor;
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], px, py + i * lineHeight);
    }

    ctx.restore();
  },

  hitTest(ann, x, y) {
    const layout = computeTextLayout(ann.text);
    const px = ann.position.x;
    const py = ann.position.y;
    const hitTolerance = 4;
    return (
      x >= px - hitTolerance &&
      x <= px + layout.bgWidth + hitTolerance &&
      y >= py - hitTolerance &&
      y <= py + layout.bgHeight + hitTolerance
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
