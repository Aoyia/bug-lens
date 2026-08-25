import { SourceMapFetcher } from "./sourcemap-fetcher.js";
import { TraceMappingEngine } from "./trace-mapping-engine.js";
import type { SourceMappedLocation } from "../../shared/protocol.js";

export interface BatchItem {
  id: string;
  scriptUrl: string;
  line: number;
  column?: number;
}

export interface ResolveBatchRequest {
  type: "RESOLVE_BATCH_REQUEST";
  requestId: string;
  items: BatchItem[];
  snippetLinesBefore?: number;
  snippetLinesAfter?: number;
  timeoutMs?: number;
}

export interface ResolveBatchResponse {
  type: "RESOLVE_BATCH_RESPONSE";
  requestId: string;
  results: Record<string, SourceMappedLocation>;
}

// In-Worker LRU Cache
const engineCache = new Map<string, TraceMappingEngine>();
const MAX_CACHE_SIZE = 10;

function getCachedEngine(mapUrlOrScript: string): TraceMappingEngine | null {
  if (engineCache.has(mapUrlOrScript)) {
    const engine = engineCache.get(mapUrlOrScript)!;
    engineCache.delete(mapUrlOrScript);
    engineCache.set(mapUrlOrScript, engine);
    return engine;
  }
  return null;
}

function setCachedEngine(mapUrlOrScript: string, engine: TraceMappingEngine) {
  if (engineCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = engineCache.keys().next().value;
    if (oldestKey) engineCache.delete(oldestKey);
  }
  engineCache.set(mapUrlOrScript, engine);
}

export async function processBatchResolution(
  request: ResolveBatchRequest
): Promise<ResolveBatchResponse> {
  const results: Record<string, SourceMappedLocation> = {};
  const {
    items,
    snippetLinesBefore = 5,
    snippetLinesAfter = 5,
    timeoutMs = 5000,
  } = request;

  // Group items by scriptUrl to avoid duplicate fetches
  const byUrl = new Map<string, BatchItem[]>();
  for (const item of items) {
    if (!byUrl.has(item.scriptUrl)) {
      byUrl.set(item.scriptUrl, []);
    }
    byUrl.get(item.scriptUrl)!.push(item);
  }

  for (const [scriptUrl, scriptItems] of byUrl.entries()) {
    let engine = getCachedEngine(scriptUrl);

    if (!engine) {
      // 1. Try scriptUrl.map directly or probe
      const candidateMapUrl = `${scriptUrl}.map`;
      const fetchRes = await SourceMapFetcher.fetchMap(
        candidateMapUrl,
        timeoutMs
      );

      if (fetchRes.success) {
        try {
          engine = new TraceMappingEngine(fetchRes.mapData);
          setCachedEngine(scriptUrl, engine);
        } catch {
          // invalid map
        }
      }
    }

    for (const item of scriptItems) {
      if (engine) {
        results[item.id] = engine.resolve(
          item.line,
          item.column || 1,
          snippetLinesBefore,
          snippetLinesAfter
        );
      } else {
        results[item.id] = {
          resolved: false,
          failureReason: "FETCH_FAILED",
        };
      }
    }
  }

  return {
    type: "RESOLVE_BATCH_RESPONSE",
    requestId: request.requestId,
    results,
  };
}

// In standard Web Worker context
if (
  typeof self !== "undefined" &&
  typeof (self as any).postMessage === "function"
) {
  self.onmessage = async (e: MessageEvent) => {
    if (e.data && e.data.type === "RESOLVE_BATCH_REQUEST") {
      const response = await processBatchResolution(e.data);
      self.postMessage(response);
    }
  };
}
