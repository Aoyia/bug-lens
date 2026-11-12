import type {
  AnnotationTool,
  Point,
  ToolContext,
  ToolStrategy,
} from "../annotation-types";
import { rectTool } from "./rect-tool";
import { arrowTool } from "./arrow-tool";
import { privacyTool } from "./privacy-tool";
import { textTool } from "./text-tool";

export type { AnnotationTool, Point, ToolContext, ToolStrategy };

const STRATEGIES: Record<AnnotationTool, ToolStrategy> = {
  rect: rectTool,
  arrow: arrowTool,
  privacy: privacyTool,
  text: textTool,
};

export function getToolStrategy(tool: string): ToolStrategy | null {
  return (STRATEGIES as Record<string, ToolStrategy | undefined>)[tool] ?? null;
}
