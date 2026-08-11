import type { RectAnnotation } from "../../domain/screenshot-payload.ts";
import { pointInRectEdgeBand } from "../overlay-geometry.ts";
import type {
  AnnotationRenderer,
  RendererContext,
} from "./renderer-registry.ts";

export const rectRenderer: AnnotationRenderer<RectAnnotation> = {
  type: "rect",

  draw(ctx, ann) {
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
    if ((ctx as any).roundRect && rw > 2 * lw && rh > 2 * lw) {
      (ctx as any).roundRect(rx, ry, rw, rh, rOuter);
      (ctx as any).roundRect(
        rx + lw,
        ry + lw,
        rw - 2 * lw,
        rh - 2 * lw,
        rInner
      );
    } else {
      ctx.rect(rx, ry, rw, rh);
      if (rw > 2 * lw && rh > 2 * lw) {
        ctx.rect(rx + lw, ry + lw, rw - 2 * lw, rh - 2 * lw);
      }
    }
    ctx.fill("evenodd");
    ctx.restore();
  },

  hitTest(ann, x, y) {
    // 边缘带命中：仅边框 ±6px 环形区域可选中，内部空心穿透（解决重叠方框只能选上层）
    return pointInRectEdgeBand(x, y, ann.bounds);
  },

  hitTestHandle(ann, x, y) {
    const radius = 8;
    const { x: bx, y: by, width: bw, height: bh } = ann.bounds;
    const handles = [
      { name: "nw", x: bx, y: by },
      { name: "ne", x: bx + bw, y: by },
      { name: "se", x: bx + bw, y: by + bh },
      { name: "sw", x: bx, y: by + bh },
    ];
    for (const h of handles) {
      if (Math.hypot(x - h.x, y - h.y) <= radius) return h.name;
    }
    return null;
  },

  drag(ann, dx, dy) {
    ann.bounds.x += dx;
    ann.bounds.y += dy;
  },

  resize(ann, dx, dy, handle, _rc) {
    let { x, y, width, height } = ann.bounds;
    if (handle === "nw") {
      x += dx;
      width -= dx;
      y += dy;
      height -= dy;
    } else if (handle === "ne") {
      width += dx;
      y += dy;
      height -= dy;
    } else if (handle === "se") {
      width += dx;
      height += dy;
    } else if (handle === "sw") {
      x += dx;
      width -= dx;
      height += dy;
    }
    if (width > 10 && height > 10) {
      ann.bounds = { x, y, width, height };
    }
  },
};
