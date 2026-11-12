import type { AnnotationType } from "../../../domain/screenshot-payload";
import type { AnnotationRenderer, RendererContext } from "../annotation-types";
import { rectRenderer } from "./rect-renderer";
import { arrowRenderer } from "./arrow-renderer";
import { privacyRenderer } from "./privacy-renderer";
import { textRenderer } from "./text-renderer";

export type { AnnotationRenderer, RendererContext };

const REGISTRY: Record<AnnotationType, AnnotationRenderer> = {
  rect: rectRenderer,
  arrow: arrowRenderer,
  privacy: privacyRenderer,
  text: textRenderer,
};

export function getRenderer(type: AnnotationType): AnnotationRenderer {
  return REGISTRY[type];
}
