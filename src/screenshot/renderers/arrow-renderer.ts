import type { ArrowAnnotation } from "../../domain/screenshot-payload.ts";
import {
  clampPointToRect,
  pointToSegmentDistance,
} from "../overlay-geometry.ts";
import type {
  AnnotationRenderer,
  RendererContext,
} from "./renderer-registry.ts";

export const arrowRenderer: AnnotationRenderer<ArrowAnnotation> = {
  type: "arrow",

  draw(ctx, ann) {
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
  },

  hitTest(ann, x, y) {
    return pointToSegmentDistance({ x, y }, ann.startPoint, ann.endPoint) <= 10;
  },

  hitTestHandle(ann, x, y) {
    const radius = 8;
    if (Math.hypot(x - ann.startPoint.x, y - ann.startPoint.y) <= radius) {
      return "start";
    }
    if (Math.hypot(x - ann.endPoint.x, y - ann.endPoint.y) <= radius) {
      return "end";
    }
    return null;
  },

  drag(ann, dx, dy) {
    ann.startPoint.x += dx;
    ann.startPoint.y += dy;
    ann.endPoint.x += dx;
    ann.endPoint.y += dy;
  },

  resize(ann, dx, dy, handle, rc) {
    const clampTo = (p: { x: number; y: number }) =>
      rc.selection ? clampPointToRect(p, rc.selection) : p;
    if (handle === "start") {
      ann.startPoint = clampTo({
        x: ann.startPoint.x + dx,
        y: ann.startPoint.y + dy,
      });
    } else if (handle === "end") {
      ann.endPoint = clampTo({
        x: ann.endPoint.x + dx,
        y: ann.endPoint.y + dy,
      });
    }
  },
};
