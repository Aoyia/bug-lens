import type { SourceSnippetContext } from "../../shared/protocol.js";

export function normalizeSourcePath(rawPath?: string | null): string {
  if (!rawPath) return "unknown";
  return rawPath
    .replace(/\\/g, "/")
    .replace(/^(webpack|vite|rollup|turbopack):\/\/[^\/]*\//, "")
    .replace(/^(\.\/|\/)/, "")
    .replace(/^\/?(@fs|node_modules)\//, "");
}

export function extractSnippetWindow(
  rawContent: string | null | undefined,
  targetLine: number,
  sourceFile: string,
  highlightColumn?: number,
  linesBefore = 5,
  linesAfter = 5
): SourceSnippetContext | undefined {
  if (!rawContent || targetLine < 1) return undefined;

  const allLines = rawContent.split(/\r?\n/);
  const total = allLines.length;
  if (total === 0) return undefined;

  const startLine = Math.max(1, targetLine - linesBefore);
  const endLine = Math.min(total, targetLine + linesAfter);

  if (startLine > total) return undefined;

  const lines = allLines.slice(startLine - 1, endLine);

  return {
    sourceFile: normalizeSourcePath(sourceFile),
    startLine,
    errorLine: targetLine,
    lines,
    highlightColumn,
  };
}
