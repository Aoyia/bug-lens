import { clampPointToRect } from "../overlay-geometry.ts";
import type { ToolStrategy } from "./tool-registry.ts";

export const textTool: ToolStrategy = {
  id: "text",

  onDown(p, ctx) {
    if (!ctx.selection) return false;
    ctx.setStartPoint(clampPointToRect(p, ctx.selection));
    return true;
  },

  onMove(_p, _ctx) {
    // 现实现：text 工具绘制阶段不产生临时批注
  },

  onUp(p, ctx) {
    const pos = ctx.selection
      ? clampPointToRect(p, ctx.selection)
      : { x: p.x, y: p.y };
    ctx.spawnInlineTextInput(pos.x, pos.y);
    return "spawned-text";
  },
};
