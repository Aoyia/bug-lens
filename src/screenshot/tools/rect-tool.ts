import { clampPointToRect } from "../overlay-geometry.ts";
import type { ToolStrategy } from "./tool-registry.ts";

export const rectTool: ToolStrategy = {
  id: "rect",

  onDown(p, ctx) {
    if (!ctx.selection) return false;
    ctx.setStartPoint(clampPointToRect(p, ctx.selection));
    return true;
  },

  onMove(p, ctx) {
    const start = ctx.getStartPoint();
    if (!start || !ctx.selection) return;
    const current = clampPointToRect(p, ctx.selection);
    ctx.setTempAnnotation({
      id: `ann_${Date.now()}`,
      type: "rect",
      bounds: {
        x: Math.min(start.x, current.x),
        y: Math.min(start.y, current.y),
        width: Math.abs(current.x - start.x),
        height: Math.abs(current.y - start.y),
      },
    });
  },

  onUp(_p, ctx) {
    ctx.commitTemp();
    return "committed";
  },
};
