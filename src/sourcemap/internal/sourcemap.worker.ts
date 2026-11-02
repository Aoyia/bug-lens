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

// 确定性负缓存（针对明确返回 HTTP 404/410、格式损坏或体积超限的脚本 URL，避免重复无效拉取）
const missingMapCache = new Set<string>();
const MAX_MISSING_CACHE_SIZE = 200;

// 在途请求合并（防止并发请求同一 scriptUrl 时重复发起网络拉取）
const inFlightEngineMap = new Map<string, Promise<TraceMappingEngine | null>>();

export function clearSourceMapWorkerCache(): void {
  engineCache.clear();
  missingMapCache.clear();
  inFlightEngineMap.clear();
}

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

function recordMissingMap(scriptUrl: string) {
  if (missingMapCache.has(scriptUrl)) return;
  if (missingMapCache.size >= MAX_MISSING_CACHE_SIZE) {
    const oldest = missingMapCache.values().next().value;
    if (oldest) missingMapCache.delete(oldest);
  }
  missingMapCache.add(scriptUrl);
}

async function resolveOrFetchEngine(
  scriptUrl: string,
  timeoutMs: number
): Promise<TraceMappingEngine | null> {
  // 1. O(1) 过滤非网络/内联可拉取协议（如 <anonymous>, eval, blob:, extensions:: 等）
  if (!SourceMapFetcher.isFetchableScriptUrl(scriptUrl)) {
    return null;
  }

  // 2. 命中正缓存
  const cached = getCachedEngine(scriptUrl);
  if (cached) return cached;

  // 3. 命中确定性负缓存（404 / 410 / INVALID_MAP / SIZE_EXCEEDED）
  if (missingMapCache.has(scriptUrl)) {
    return null;
  }

  // 4. 命中在途请求合并
  const existingInFlight = inFlightEngineMap.get(scriptUrl);
  if (existingInFlight) {
    return existingInFlight;
  }

  const fetchPromise = (async (): Promise<TraceMappingEngine | null> => {
    try {
      const candidateMapUrl = scriptUrl.startsWith("data:")
        ? scriptUrl
        : `${scriptUrl}.map`;
      const fetchRes = await SourceMapFetcher.fetchMap(
        candidateMapUrl,
        timeoutMs
      );

      if (fetchRes.success) {
        try {
          const engine = new TraceMappingEngine(fetchRes.mapData);
          setCachedEngine(scriptUrl, engine);
          return engine;
        } catch {
          recordMissingMap(scriptUrl);
          return null;
        }
      }

      // 仅对确定性不可用状态（HTTP 404/410、格式非法、超体积）记录负缓存；网络超时不记负缓存以支持重试
      if (
        fetchRes.status === 404 ||
        fetchRes.status === 410 ||
        fetchRes.reason === "INVALID_MAP" ||
        fetchRes.reason === "SIZE_EXCEEDED"
      ) {
        recordMissingMap(scriptUrl);
      }
      return null;
    } finally {
      inFlightEngineMap.delete(scriptUrl);
    }
  })();

  inFlightEngineMap.set(scriptUrl, fetchPromise);
  return fetchPromise;
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

  // 并行拉取所有独立 scriptUrl 的 SourceMap，将总耗时从 O(∑ Ti) 降为 O(max Ti)
  await Promise.all(
    Array.from(byUrl.entries()).map(async ([scriptUrl, scriptItems]) => {
      const engine = await resolveOrFetchEngine(scriptUrl, timeoutMs);

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
    })
  );

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
