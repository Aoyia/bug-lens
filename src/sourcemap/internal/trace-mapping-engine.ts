import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";
import type { SourceMappedLocation } from "../../shared/protocol.js";
import {
  normalizeSourcePath,
  extractSnippetWindow,
} from "./source-snippet-slicer.js";

export interface QueryLocation {
  line: number; // 1-indexed line
  column?: number; // 1-indexed column (optional)
}

export class TraceMappingEngine {
  private tracer: TraceMap;

  constructor(sourceMapJsonOrString: any) {
    this.tracer = new TraceMap(
      typeof sourceMapJsonOrString === "string"
        ? JSON.parse(sourceMapJsonOrString)
        : sourceMapJsonOrString
    );
  }

  public resolve(
    compiledLine: number,
    compiledColumn = 1,
    snippetLinesBefore = 5,
    snippetLinesAfter = 5
  ): SourceMappedLocation {
    try {
      if (compiledLine < 1) {
        return { resolved: false, failureReason: "NO_MAPPING" };
      }

      // @jridgewell/trace-mapping accepts 1-indexed line, 0-indexed column
      const pos = originalPositionFor(this.tracer, {
        line: compiledLine,
        column: Math.max(0, compiledColumn - 1),
      });

      if (!pos || !pos.source || pos.line == null) {
        return { resolved: false, failureReason: "NO_MAPPING" };
      }

      const cleanFile = normalizeSourcePath(pos.source);
      const originalLine = pos.line;
      const originalColumn = pos.column != null ? pos.column + 1 : undefined;
      const originalFunctionName = pos.name || undefined;

      let sourceContent: string | null = null;
      if (this.tracer.sources && this.tracer.sourcesContent) {
        const sourceIndex = this.tracer.sources.indexOf(pos.source);
        if (sourceIndex !== -1 && this.tracer.sourcesContent[sourceIndex]) {
          sourceContent = this.tracer.sourcesContent[sourceIndex];
        }
      }

      const sourceSnippet = extractSnippetWindow(
        sourceContent,
        originalLine,
        cleanFile,
        originalColumn,
        snippetLinesBefore,
        snippetLinesAfter
      );

      return {
        resolved: true,
        originalFile: cleanFile,
        originalLine,
        originalColumn,
        originalFunctionName,
        sourceSnippet,
      };
    } catch {
      return { resolved: false, failureReason: "INVALID_MAP" };
    }
  }
}
