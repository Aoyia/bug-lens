import { sanitizeUrl } from "./privacy-policy.ts";
import type { CacheEvidence, CacheSource, ConciseCallFrame, InitiatorEvidence } from "../shared/protocol.ts";

export interface CdpCallFrame {
  functionName?: string;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
}

export interface CdpStackTrace {
  callFrames?: CdpCallFrame[];
  parent?: CdpStackTrace;
  description?: string;
}

export interface CdpInitiator {
  type?: string;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
  stack?: CdpStackTrace;
}

const IGNORED_URL_PATTERNS = [
  /^chrome-extension:\/\//i,
  /^moz-extension:\/\//i,
  /node_modules\/(axios|core-js|zone\.js|tslib|webpack|vite)/i,
  /\/dist\/[^\/]+\.(bundle|chunk)\.js$/i
];

export function isThirdPartyOrFrameworkFrame(url?: string): boolean {
  if (!url) return true;
  return IGNORED_URL_PATTERNS.some((pattern) => pattern.test(url));
}

function toConciseFrame(frame: CdpCallFrame, privacyMode: "safe" | "raw"): ConciseCallFrame | undefined {
  if (!frame.url) return undefined;
  return {
    functionName: frame.functionName || undefined,
    url: sanitizeUrl(frame.url, privacyMode),
    lineNumber: (frame.lineNumber ?? 0) + 1,
    columnNumber: (frame.columnNumber ?? 0) + 1
  };
}

function findFirstAppFrame(stack?: CdpStackTrace, privacyMode: "safe" | "raw" = "safe"): ConciseCallFrame | undefined {
  if (!stack?.callFrames) return undefined;
  for (const frame of stack.callFrames) {
    if (frame.url && !isThirdPartyOrFrameworkFrame(frame.url)) {
      return toConciseFrame(frame, privacyMode);
    }
  }
  // 如果所有帧都被识别为框架，回退选取第一个有 URL 的帧
  const fallback = stack.callFrames.find((f) => Boolean(f.url));
  return fallback ? toConciseFrame(fallback, privacyMode) : undefined;
}

function findAsyncAnchorFrame(stack?: CdpStackTrace, privacyMode: "safe" | "raw" = "safe"): ConciseCallFrame | undefined {
  let current: CdpStackTrace | undefined = stack?.parent;
  let lastAppFrame: ConciseCallFrame | undefined = undefined;
  while (current) {
    const frame = findFirstAppFrame(current, privacyMode);
    if (frame) {
      lastAppFrame = frame;
    }
    current = current.parent;
  }
  return lastAppFrame;
}

export function extractCallStackChain(
  stack?: CdpStackTrace,
  privacyMode: "safe" | "raw" = "safe",
  maxDepth = 15
): ConciseCallFrame[] | undefined {
  if (!stack?.callFrames && !stack?.parent) return undefined;

  const result: ConciseCallFrame[] = [];
  let current: CdpStackTrace | undefined = stack;

  while (current && result.length < maxDepth) {
    if (current.callFrames) {
      for (const frame of current.callFrames) {
        if (result.length >= maxDepth) break;
        if (frame.url && isThirdPartyOrFrameworkFrame(frame.url)) {
          continue;
        }
        const concise = toConciseFrame(frame, privacyMode);
        if (concise) {
          result.push(concise);
        }
      }
    }

    if (current.parent && result.length < maxDepth) {
      const boundaryText = current.parent.description || "async";
      result.push({ asyncBoundary: boundaryText });
    }

    current = current.parent;
  }

  return result.length > 0 ? result : undefined;
}

export function sliceInitiator(cdpInitiator?: CdpInitiator, privacyMode: "safe" | "raw" = "safe"): InitiatorEvidence | undefined {
  if (!cdpInitiator) return undefined;

  const rawType = cdpInitiator.type || "other";
  const mappedType: InitiatorEvidence["type"] =
    rawType === "script" || rawType === "parser" || rawType === "preflight" ? rawType : "other";

  let topFrame: ConciseCallFrame | undefined;
  let asyncAnchorFrame: ConciseCallFrame | undefined;
  let stackChain: ConciseCallFrame[] | undefined;

  if (cdpInitiator.stack) {
    topFrame = findFirstAppFrame(cdpInitiator.stack, privacyMode);
    asyncAnchorFrame = findAsyncAnchorFrame(cdpInitiator.stack, privacyMode);
    stackChain = extractCallStackChain(cdpInitiator.stack, privacyMode);
  } else if (cdpInitiator.url) {
    topFrame = {
      url: sanitizeUrl(cdpInitiator.url, privacyMode),
      lineNumber: (cdpInitiator.lineNumber ?? 0) + 1,
      columnNumber: (cdpInitiator.columnNumber ?? 0) + 1
    };
    stackChain = [topFrame];
  }

  if (!topFrame && !asyncAnchorFrame && !stackChain && mappedType === "other") {
    return undefined;
  }

  return {
    type: mappedType,
    topFrame,
    asyncAnchorFrame,
    stack: stackChain
  };
}

export function deriveCacheEvidence(
  responseParams?: {
    fromDiskCache?: boolean;
    fromServiceWorker?: boolean;
    fromPrefetchCache?: boolean;
    status?: number;
    protocol?: string;
  },
  servedFromMemoryCache?: boolean
): CacheEvidence {
  let source: CacheSource = "network";
  const status = responseParams?.status;
  const revalidated = status === 304;

  if (servedFromMemoryCache) {
    source = "memory";
  } else if (responseParams?.fromServiceWorker) {
    source = "service-worker";
  } else if (responseParams?.fromPrefetchCache) {
    source = "prefetch";
  } else if (responseParams?.fromDiskCache) {
    source = "disk";
  }

  return {
    source,
    revalidated,
    protocol: responseParams?.protocol || undefined
  };
}
