import type {
  AnnotationItem,
  RectBounds,
} from "../../domain/screenshot-payload.ts";
import type { OverlayPhase } from "../overlay-state.ts";
import { rectTool } from "./rect-tool.ts";
import { arrowTool } from "./arrow-tool.ts";
import { privacyTool } from "./privacy-tool.ts";
import { textTool } from "./text-tool.ts";

/** 批注绘制工具（select 不纳入策略，保留在 SelectionController） */
export type AnnotationTool = "rect" | "arrow" | "privacy" | "text";

export type Point = { x: number; y: number };

export interface ToolContext {
  selection: RectBounds | null;
  getPhase: () => OverlayPhase;
  getStartPoint: () => Point | null;
  setStartPoint: (p: Point | null) => void;
  setTempAnnotation: (ann: AnnotationItem | null) => void;
  /** 提交当前 tempAnnotation（非空则入列表并清理）；渲染由 Controller 统一触发 */
  commitTemp: () => void;
  spawnInlineTextInput: (x: number, y: number) => void;
  rerender: () => void;
}

export interface ToolStrategy {
  readonly id: AnnotationTool;
  onDown(p: Point, ctx: ToolContext): boolean;
  onMove(p: Point, ctx: ToolContext): void;
  onUp(p: Point, ctx: ToolContext): "committed" | "spawned-text";
}

const STRATEGIES: Record<AnnotationTool, ToolStrategy> = {
  rect: rectTool,
  arrow: arrowTool,
  privacy: privacyTool,
  text: textTool,
};

export function getToolStrategy(tool: string): ToolStrategy | null {
  return (STRATEGIES as Record<string, ToolStrategy | undefined>)[tool] ?? null;
}
