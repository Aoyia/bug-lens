import type { ArrowAnnotation } from "../../../domain/screenshot-payload";
import {
  clampPointToRect,
  pointToSegmentDistance,
} from "../../overlay/overlay-geometry";
import type { AnnotationRenderer, RendererContext } from "../annotation-types";

export const arrowRenderer: AnnotationRenderer<ArrowAnnotation> = {
  type: "arrow",

  draw(ctx, ann, rc) {
    const dpr = rc?.dpr ?? 1;
    const sx = ann.startPoint.x * dpr;
    const sy = ann.startPoint.y * dpr;
    const ex = ann.endPoint.x * dpr;
    const ey = ann.endPoint.y * dpr;

    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();

    const angle = Math.atan2(ey - sy, ex - sx);
    const headLen = 14 * dpr;
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
