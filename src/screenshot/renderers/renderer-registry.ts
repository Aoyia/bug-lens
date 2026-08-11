import type {
  AnnotationItem,
  AnnotationType,
  RectBounds,
} from "../../domain/screenshot-payload.ts";
import { rectRenderer } from "./rect-renderer.ts";
import { arrowRenderer } from "./arrow-renderer.ts";
import { privacyRenderer } from "./privacy-renderer.ts";
import { textRenderer } from "./text-renderer.ts";

/** 渲染器所需的只读上下文（由调用方注入；Controller 无 viewportImage 时传 null） */
export interface RendererContext {
  selection: RectBounds | null;
  viewportImage: HTMLImageElement | null;
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

const REGISTRY: Record<AnnotationType, AnnotationRenderer> = {
  rect: rectRenderer,
  arrow: arrowRenderer,
  privacy: privacyRenderer,
  text: textRenderer,
};

export function getRenderer(type: AnnotationType): AnnotationRenderer {
  return REGISTRY[type];
}
