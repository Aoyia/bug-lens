import type {
  AnnotationItem,
  AnnotationType,
  RectBounds,
} from "../../domain/screenshot-payload";
import type { OverlayPhase } from "../overlay/overlay-state";

/** 渲染器所需的只读上下文（由调用方注入；Controller 无 viewportImage 时传 null） */
export interface RendererContext {
  selection: RectBounds | null;
  viewportImage: HTMLImageElement | null;
  dpr?: number;
}

export interface AnnotationRenderer<T extends AnnotationItem = AnnotationItem> {
  readonly type: AnnotationType;
  draw(ctx: CanvasRenderingContext2D, ann: T, rc: RendererContext): void;
  hitTest(ann: T, x: number, y: number): boolean;
  hitTestHandle(ann: T, x: number, y: number): string | null;
  drag(ann: T, dx: number, dy: number): void;
  resize(
    ann: T,
    dx: number,
    dy: number,
    handle: string,
    rc: RendererContext
  ): void;
}

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
