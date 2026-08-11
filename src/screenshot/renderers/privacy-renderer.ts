import type { PrivacyAnnotation } from "../../domain/screenshot-payload.ts";
import { pointInRectEdgeBand } from "../overlay-geometry.ts";
import type {
  AnnotationRenderer,
  RendererContext,
} from "./renderer-registry.ts";

export const privacyRenderer: AnnotationRenderer<PrivacyAnnotation> = {
  type: "privacy",

  draw(ctx, ann, rc) {
    const x = Math.round(ann.bounds.x);
    const y = Math.round(ann.bounds.y);
    const w = Math.round(ann.bounds.width);
    const h = Math.round(ann.bounds.height);
    const dpr = window.devicePixelRatio || 1;

    if (w > 0 && h > 0 && rc.viewportImage) {
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
          rc.viewportImage,
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
  },

  hitTest(ann, x, y) {
    // 与 rect 同规则：边缘带命中，内部空心穿透
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
