import type { TextAnnotation } from "../../../domain/screenshot-payload";
import {
  computeTextLayout,
  getTextHaloColor,
  TEXT_ANNOTATION_FONT,
  TEXT_DEFAULT_COLOR,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_WIDTH,
  TEXT_STROKE_WIDTH,
} from "../text-layout";
import type { AnnotationRenderer, RendererContext } from "./renderer-registry";

export const textRenderer: AnnotationRenderer<TextAnnotation> = {
  type: "text",

  draw(ctx, ann, rc) {
    const px = ann.position.x;
    const py = ann.position.y;
    const text = ann.text;

    ctx.save();
    ctx.font = TEXT_ANNOTATION_FONT;

    const boundsRight = rc.selection
      ? rc.selection.x + rc.selection.width
      : window.innerWidth;
    const maxTextWidth = Math.max(
      60,
      Math.min(TEXT_MAX_WIDTH, boundsRight - px - 8)
    );

    // 布局计算：按真实文字度量折行
    const { lines } = computeTextLayout(text, {
      measure: (s) => ctx.measureText(s).width,
      maxWidth: maxTextWidth,
    });

    const textColor = ann.color || TEXT_DEFAULT_COLOR;
    const haloColor = getTextHaloColor(textColor);

    ctx.textAlign = "left";
    ctx.textBaseline = "top";

    // 通道 1：底层反色外光晕描边（解决明暗杂色背景下的辨识度）
    ctx.strokeStyle = haloColor;
    ctx.lineWidth = TEXT_STROKE_WIDTH;
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;
    for (let i = 0; i < lines.length; i++) {
      ctx.strokeText(lines[i], px, py + i * TEXT_LINE_HEIGHT);
    }

    // 通道 2：顶层字符填充
    ctx.fillStyle = textColor;
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], px, py + i * TEXT_LINE_HEIGHT);
    }

    ctx.restore();
  },

  hitTest(ann, x, y) {
    const layout = computeTextLayout(ann.text);
    const px = ann.position.x;
    const py = ann.position.y;
    const hitTolerance = 6;
    return (
      x >= px - hitTolerance &&
      x <= px + layout.width + hitTolerance &&
      y >= py - hitTolerance &&
      y <= py + layout.height + hitTolerance
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
