import { strToU8 } from "fflate";
import {
  describeBrowserFromUserAgent,
  describeOsFromUserAgent,
} from "../domain/environment-capture.ts";
import {
  getSessionTitle,
  type ConsoleEntry,
  type FrameworkComponentNode,
  type FrameworkStateEvidence,
  type IssueScene,
  type NetworkEntry,
  type NetworkInitiator,
  type RecordingSession,
  type SourceMappedLocation,
  type TargetDomSnapshot,
} from "../shared/protocol";
import { Sha256 } from "./sha256.ts";

const DATA_URL_MAX_INLINE_CHARS = 256;
const REQUEST_BODY_CAS_THRESHOLD_BYTES = 2048;

const LAYOUT_STYLE_KEYS = [
  "display",
  "position",
  "top",
  "right",
  "bottom",
  "left",
  "width",
  "height",
  "minWidth",
  "maxWidth",
  "minHeight",
  "maxHeight",
  "margin",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
  "padding",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "boxSizing",
  "flex",
  "flexDirection",
  "justifyContent",
  "alignItems",
  "gridTemplateColumns",
  "overflow",
  "overflowX",
  "overflowY",
  "zIndex",
  "opacity",
  "visibility",
  "pointerEvents",
  "transform",
] as const;

export type PackMode = "ai-minimal" | "full-viewer";

export interface CasBlobRefV5 {
  hash: string;
  path: string;
  byteLength: number;
  mimeType: string;
}

export interface CasStatsV5 {
  totalBlobCount: number;
  totalBlobBytes: number;
  deduplicatedBytesSaved: number;
}

export interface ConsoleFoldedEntryV5 {
  signature: string;
  level: string;
  text: string;
  source: string;
  count: number;
  firstCreatedAt: number;
  lastCreatedAt: number;
  timeRangeMs: [number, number];
  timestamps: number[];
  location?: {
    url?: string;
    lineNumber?: number;
    columnNumber?: number;
  };
  sourceMappedLocation?: {
    originalFile: string;
    originalLine: number;
    originalColumn: number;
    originalFunctionName?: string;
  };
}

export interface InitiatorTopFrameV5 {
  type: "script" | "parser" | "other";
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
  functionName?: string;
  sourceMappedLocation?: {
    originalFile: string;
    originalLine: number;
    originalColumn: number;
    originalFunctionName?: string;
  };
}

export interface NetworkDetailItemV5 {
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  initiator?: InitiatorTopFrameV5;
  bodyBlob?: CasBlobRefV5;
  requestBodyBlob?: CasBlobRefV5;
}

export interface WebStorageDiffV5 {
  localStorageChanged?: Record<string, string | null>;
  sessionStorageChanged?: Record<string, string | null>;
}

/** 计算字节切片的 64 位小写十六进制 SHA-256 摘要（浏览器与 Node 通用）。 */
export function sha256HexBytes(bytes: Uint8Array): string {
  return new Sha256().update(bytes).digestHex();
}

/** 计算 UTF-8 文本的 64 位小写十六进制 SHA-256 摘要。 */
export function sha256HexText(text: string): string {
  return sha256HexBytes(strToU8(text));
}

/**
 * 规整化并提取控制台日志指纹（SHA-256 前 12 位），与 triage-cli 查询侧算法保持严格一致。
 */
export function computeConsoleSignatureV5(entry: {
  level?: string;
  text?: string;
  source?: string;
}): string {
  const normalized = (entry.text ?? "")
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      "[UUID]"
    )
    .replace(/\b1[6-9]\d{11}\b/g, "[TIMESTAMP]")
    .replace(/\b\d+(\.\d+)?ms\b/g, "[DURATION]");
  const seed = `${entry.level ?? "log"}:${entry.source || "consoleAPI"}:${normalized.slice(0, 200)}`;
  return sha256HexText(seed).slice(0, 12);
}

/** 仅当 SourceMap 成功映射出源码路径时返回精简位置对象；映射失败直接返回 undefined。 */
function extractResolvedSourceLocation(
  loc: SourceMappedLocation | undefined
): ConsoleFoldedEntryV5["sourceMappedLocation"] | undefined {
  if (!loc?.resolved || !loc.originalFile || loc.originalLine === undefined) {
    return undefined;
  }
  return {
    originalFile: loc.originalFile,
    originalLine: loc.originalLine,
    originalColumn: loc.originalColumn ?? 0,
    ...(loc.originalFunctionName
      ? { originalFunctionName: loc.originalFunctionName }
      : {}),
  };
}

function sampleTimestamps(all: number[]): number[] {
  if (all.length <= 5) return [...all];
  const last = all.length - 1;
  return [
    all[0]!,
    all[Math.floor(last * 0.25)]!,
    all[Math.floor(last * 0.5)]!,
    all[Math.floor(last * 0.75)]!,
    all[last]!,
  ];
}

/** 将原始控制台日志按特征指纹折叠去重，消除高频轮询日志膨胀。 */
export function foldConsoleEntries(
  entries: readonly Omit<ConsoleEntry, "sessionId">[],
  startedAtEpochMs: number
): {
  consoleSummary: ConsoleFoldedEntryV5[];
  metrics: {
    totalOriginalEntries: number;
    uniqueSignatureCount: number;
    errorCount: number;
    warningCount: number;
  };
} {
  interface Accumulator {
    item: ConsoleFoldedEntryV5;
    timestamps: number[];
  }
  const bySignature = new Map<string, Accumulator>();
  const ordered: Accumulator[] = [];
  let errorCount = 0;
  let warningCount = 0;

  for (const entry of entries) {
    const level = entry.level || "log";
    if (level === "error") errorCount += 1;
    else if (level === "warning" || level === "warn") warningCount += 1;

    const sig = computeConsoleSignatureV5(entry);
    const ts = typeof entry.createdAt === "number" ? entry.createdAt : 0;
    const existing = bySignature.get(sig);
    if (existing) {
      existing.item.count += 1;
      existing.item.firstCreatedAt = Math.min(existing.item.firstCreatedAt, ts);
      existing.item.lastCreatedAt = Math.max(existing.item.lastCreatedAt, ts);
      existing.timestamps.push(ts);
      continue;
    }

    const location =
      entry.url !== undefined ||
      entry.lineNumber !== undefined ||
      entry.columnNumber !== undefined
        ? {
            ...(entry.url !== undefined ? { url: entry.url } : {}),
            ...(entry.lineNumber !== undefined
              ? { lineNumber: entry.lineNumber }
              : {}),
            ...(entry.columnNumber !== undefined
              ? { columnNumber: entry.columnNumber }
              : {}),
          }
        : undefined;

    const resolvedSource = extractResolvedSourceLocation(
      entry.sourceMappedLocation
    );
    const acc: Accumulator = {
      item: {
        signature: sig,
        level,
        text: entry.text,
        source: entry.source || "consoleAPI",
        count: 1,
        firstCreatedAt: ts,
        lastCreatedAt: ts,
        timeRangeMs: [0, 0],
        timestamps: [ts],
        ...(location ? { location } : {}),
        ...(resolvedSource ? { sourceMappedLocation: resolvedSource } : {}),
      },
      timestamps: [ts],
    };
    bySignature.set(sig, acc);
    ordered.push(acc);
  }

  const anchor =
    startedAtEpochMs > 0
      ? startedAtEpochMs
      : (ordered[0]?.item.firstCreatedAt ?? 0);
  const consoleSummary = ordered.map(({ item, timestamps }) => {
    item.timeRangeMs = [
      item.firstCreatedAt - anchor,
      item.lastCreatedAt - anchor,
    ];
    item.timestamps = sampleTimestamps(timestamps);
    return item;
  });

  return {
    consoleSummary,
    metrics: {
      totalOriginalEntries: entries.length,
      uniqueSignatureCount: consoleSummary.length,
      errorCount,
      warningCount,
    },
  };
}

/** 对超长 inline `data:` Base64 URL 实施截断并保留 MIME 与 SHA-256 短摘要。 */
export function truncateDataUrl(url: string): string {
  if (!url.startsWith("data:") || url.length <= DATA_URL_MAX_INLINE_CHARS) {
    return url;
  }
  const commaIdx = url.indexOf(",");
  const header = commaIdx >= 0 ? url.slice(5, commaIdx) : url.slice(5);
  const mimeMatch = header.match(/^([^;,]+)/);
  const mimeType = mimeMatch?.[1]?.trim() || "application/octet-stream";
  const payload = commaIdx >= 0 ? url.slice(commaIdx + 1) : url;
  const hash8 = sha256HexText(payload).slice(0, 8);
  return `data:${mimeType};base64,[TRUNCATED:size=${url.length},hash=${hash8}]`;
}

/** 对 CDP Initiator 仅提取顶层调用帧，彻底清除深层混淆堆栈与失败 SourceMap 占位节点。 */
export function pruneInitiatorTopFrame(
  initiator: NetworkInitiator | undefined
): InitiatorTopFrameV5 | undefined {
  if (!initiator) return undefined;
  const normalizedType: InitiatorTopFrameV5["type"] =
    initiator.type === "parser"
      ? "parser"
      : initiator.type === "script"
        ? "script"
        : "other";

  const topFrame =
    initiator.concise?.topFrame ?? initiator.stackTrace?.[0] ?? undefined;
  const url = topFrame?.url ?? initiator.url;
  const lineNumber = topFrame?.lineNumber ?? initiator.lineNumber;
  const columnNumber = topFrame?.columnNumber ?? initiator.columnNumber;
  const functionName = topFrame?.functionName;
  const resolvedSource = extractResolvedSourceLocation(
    topFrame?.sourceMappedLocation
  );

  return {
    type: normalizedType,
    ...(functionName ? { functionName } : {}),
    ...(url !== undefined ? { url } : {}),
    ...(lineNumber !== undefined ? { lineNumber } : {}),
    ...(columnNumber !== undefined ? { columnNumber } : {}),
    ...(resolvedSource ? { sourceMappedLocation: resolvedSource } : {}),
  };
}

function isStaticBinaryAssetMime(mimeType?: string): boolean {
  if (!mimeType) return false;
  const normalized = mimeType.trim().toLowerCase().split(";")[0] ?? "";
  if (normalized === "image/svg+xml") return false;
  return (
    normalized.startsWith("image/") ||
    normalized.startsWith("video/") ||
    normalized.startsWith("audio/") ||
    normalized.startsWith("font/") ||
    normalized === "application/octet-stream" ||
    normalized.startsWith("application/font") ||
    normalized.startsWith("application/x-font") ||
    normalized === "application/vnd.ms-fontobject"
  );
}

function findHeaderIgnoreCase(
  headers: Record<string, string> | undefined,
  headerName: string
): string | undefined {
  if (!headers) return undefined;
  const target = headerName.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === target) return v;
  }
  return undefined;
}

/**
 * 将网络请求/响应体写入包内 SHA-256 CAS 存储 (`network/blobs/<sha256:16>.bin`)，
 * 同步执行 Data URL 截断与 Initiator Top-Frame 剪枝。
 */
export function processNetworkForSchemaV5(
  entries: readonly NetworkEntry[],
  startedAtEpochMs: number
): {
  networkEntries: Array<Record<string, unknown>>;
  networkDetails: Record<string, NetworkDetailItemV5>;
  blobFiles: Array<{ name: string; data: Uint8Array }>;
  casStats: CasStatsV5;
  metrics: {
    totalRequests: number;
    failedRequests: number;
    totalNetworkBytes: number;
    casDeduplicatedCount: number;
  };
} {
  const casRegistry = new Map<string, Uint8Array>();
  let rawStoredBlobBytes = 0;
  let totalBlobRefs = 0;
  let totalNetworkBytes = 0;
  let failedRequests = 0;

  const storeInCas = (text: string, mimeType: string): CasBlobRefV5 => {
    const bytes = strToU8(text);
    const hash16 = sha256HexBytes(bytes).slice(0, 16);
    const path = `network/blobs/${hash16}.bin`;
    if (!casRegistry.has(hash16)) {
      casRegistry.set(hash16, bytes);
    }
    rawStoredBlobBytes += bytes.byteLength;
    totalBlobRefs += 1;
    return {
      hash: hash16,
      path,
      byteLength: bytes.byteLength,
      mimeType,
    };
  };

  const networkDetails: Record<string, NetworkDetailItemV5> = {};
  const networkEntries = entries.map((entry) => {
    const cleanUrl = truncateDataUrl(entry.url);
    const elapsedMs =
      startedAtEpochMs > 0
        ? Math.max(0, entry.createdAt - startedAtEpochMs)
        : 0;
    const status = entry.status;
    if (
      Boolean(entry.error) ||
      Boolean(entry.canceled) ||
      Boolean(entry.blockedReason) ||
      Boolean(entry.corsErrorStatus) ||
      (typeof status === "number" && status >= 400)
    ) {
      failedRequests += 1;
    }

    const reqContentType = findHeaderIgnoreCase(
      entry.requestHeaders,
      "content-type"
    );
    let requestObj: Record<string, unknown> | undefined;
    let requestBodyBlob: CasBlobRefV5 | undefined;
    if (typeof entry.requestBody === "string" && entry.requestBody.length > 0) {
      const reqBytes = strToU8(entry.requestBody);
      if (reqBytes.byteLength > REQUEST_BODY_CAS_THRESHOLD_BYTES) {
        requestBodyBlob = storeInCas(
          entry.requestBody,
          reqContentType ?? "text/plain"
        );
        requestObj = {
          byteLength: reqBytes.byteLength,
          bodyHash: requestBodyBlob.hash,
          ...(reqContentType ? { contentType: reqContentType } : {}),
        };
      } else {
        requestObj = {
          byteLength: reqBytes.byteLength,
          body: entry.requestBody,
          ...(reqContentType ? { contentType: reqContentType } : {}),
        };
      }
    } else if (reqContentType) {
      requestObj = { contentType: reqContentType };
    }

    const respMime = entry.response?.mimeType ?? "application/octet-stream";
    const isBinary =
      isStaticBinaryAssetMime(entry.response?.mimeType) ||
      entry.response?.redactionReason === "binary-body";
    const fromCache = Boolean(
      (entry.response?.cache && entry.response.cache.source !== "network") ||
      entry.response?.fromDiskCache ||
      entry.response?.fromPrefetchCache
    );

    let bodyBlob: CasBlobRefV5 | undefined;
    let responseByteLength = entry.response?.byteLength ?? 0;
    const hasInlineRespBody =
      typeof entry.response?.body === "string" &&
      entry.response.body.length > 0;
    const skipBinaryBlob =
      isBinary && entry.response?.redactionReason === "binary-body";

    if (hasInlineRespBody && !skipBinaryBlob) {
      bodyBlob = storeInCas(entry.response!.body!, respMime);
      if (!responseByteLength) {
        responseByteLength = bodyBlob.byteLength;
      }
    }
    totalNetworkBytes +=
      responseByteLength || entry.response?.encodedDataLength || 0;

    const responseObj = entry.response
      ? {
          mimeType: respMime,
          byteLength: responseByteLength,
          bodyStatus: entry.response.bodyStatus,
          ...(bodyBlob ? { bodyHash: bodyBlob.hash } : {}),
          ...(fromCache ? { fromCache: true } : {}),
          ...(isBinary ? { isBinary: true } : {}),
          ...(entry.response.truncated ? { truncated: true } : {}),
          ...(entry.response.error ? { error: entry.response.error } : {}),
          ...(entry.response.cache ? { cache: entry.response.cache } : {}),
        }
      : undefined;

    const prunedInitiator = pruneInitiatorTopFrame(entry.initiator);
    const detailItem: NetworkDetailItemV5 = {
      ...(entry.requestHeaders ? { requestHeaders: entry.requestHeaders } : {}),
      ...(entry.response?.headers
        ? { responseHeaders: entry.response.headers }
        : {}),
      ...(prunedInitiator ? { initiator: prunedInitiator } : {}),
      ...(bodyBlob ? { bodyBlob } : {}),
      ...(requestBodyBlob ? { requestBodyBlob } : {}),
    };
    if (Object.keys(detailItem).length > 0) {
      networkDetails[entry.id] = detailItem;
    }

    return {
      id: entry.id,
      createdAt: entry.createdAt,
      elapsedMs,
      method: entry.method,
      url: cleanUrl,
      ...(entry.type ? { type: entry.type } : {}),
      ...(entry.status !== undefined ? { status: entry.status } : {}),
      ...(entry.statusText ? { statusText: entry.statusText } : {}),
      ...(entry.durationMs !== undefined
        ? { durationMs: entry.durationMs }
        : {}),
      ...(entry.error ? { error: entry.error } : {}),
      ...(entry.canceled ? { canceled: true } : {}),
      ...(entry.blockedReason ? { blockedReason: entry.blockedReason } : {}),
      ...(entry.corsErrorStatus
        ? { corsErrorStatus: entry.corsErrorStatus }
        : {}),
      ...(entry.initiator?.type ? { initiatorType: entry.initiator.type } : {}),
      ...(requestObj ? { request: requestObj } : {}),
      ...(responseObj ? { response: responseObj } : {}),
    };
  });

  const blobFiles: Array<{ name: string; data: Uint8Array }> = [];
  let totalBlobBytes = 0;
  for (const [hash16, bytes] of casRegistry.entries()) {
    blobFiles.push({ name: `network/blobs/${hash16}.bin`, data: bytes });
    totalBlobBytes += bytes.byteLength;
  }

  return {
    networkEntries,
    networkDetails,
    blobFiles,
    casStats: {
      totalBlobCount: blobFiles.length,
      totalBlobBytes,
      deduplicatedBytesSaved: Math.max(0, rawStoredBlobBytes - totalBlobBytes),
    },
    metrics: {
      totalRequests: networkEntries.length,
      failedRequests,
      totalNetworkBytes,
      casDeduplicatedCount: Math.max(0, totalBlobRefs - blobFiles.length),
    },
  };
}

function stringifyStorageValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function diffStorageRecord(
  prev: Map<string, string>,
  currObj: Record<string, unknown> | undefined
): Record<string, string | null> | undefined {
  if (!currObj) return undefined;
  const changed: Record<string, string | null> = {};
  const nextKeys = new Set<string>();

  for (const [key, rawVal] of Object.entries(currObj)) {
    nextKeys.add(key);
    const valStr = stringifyStorageValue(rawVal);
    if (prev.get(key) !== valStr) {
      changed[key] = valStr;
      prev.set(key, valStr);
    }
  }
  for (const oldKey of [...prev.keys()]) {
    if (!nextKeys.has(oldKey)) {
      changed[oldKey] = null;
      prev.delete(oldKey);
    }
  }
  return Object.keys(changed).length > 0 ? changed : undefined;
}

function collectFlatComponents(
  state: FrameworkStateEvidence
): FrameworkComponentNode[] {
  const result: FrameworkComponentNode[] = [];
  if (state.snapshot?.targetComponent) {
    result.push(state.snapshot.targetComponent);
  }
  if (state.snapshot?.rootComponent) {
    result.push(state.snapshot.rootComponent);
  }
  if (state.snapshot?.parentChain?.length) {
    result.push(...state.snapshot.parentChain);
  }
  return result;
}

/**
 * 将框架状态序列中的 WebStorage 快照替换为增量差分：
 * 首个包含 storage 的快照作为基线保留全量，后续快照仅记录变化/移除的键 (`webStorageDiff`)。
 */
export function slimFrameworkStatesForV5(
  states: readonly FrameworkStateEvidence[]
): Array<Record<string, unknown>> {
  const prevLocal = new Map<string, string>();
  const prevSession = new Map<string, string>();
  let baselineCaptured = false;

  return states.map((state) => {
    const components = collectFlatComponents(state);
    const framework = components[0]?.framework ?? "unknown";
    const base: Record<string, unknown> = {
      id: state.id,
      capturedAtEpochMs: state.capturedAtEpochMs,
      trigger: state.trigger,
      framework,
      page: state.page,
      ...(state.snapshot ? { snapshot: state.snapshot } : {}),
      ...(!state.snapshot && components.length > 0 ? { components } : {}),
      ...(state.globalState ? { globalState: state.globalState } : {}),
    };

    if (!state.webStorage) {
      return base;
    }

    if (!baselineCaptured) {
      baselineCaptured = true;
      for (const [k, v] of Object.entries(
        state.webStorage.localStorage ?? {}
      )) {
        prevLocal.set(k, stringifyStorageValue(v));
      }
      for (const [k, v] of Object.entries(
        state.webStorage.sessionStorage ?? {}
      )) {
        prevSession.set(k, stringifyStorageValue(v));
      }
      return {
        ...base,
        webStorage: state.webStorage,
      };
    }

    const localStorageChanged = diffStorageRecord(
      prevLocal,
      state.webStorage.localStorage
    );
    const sessionStorageChanged = diffStorageRecord(
      prevSession,
      state.webStorage.sessionStorage
    );
    const webStorageDiff: WebStorageDiffV5 = {
      ...(localStorageChanged ? { localStorageChanged } : {}),
      ...(sessionStorageChanged ? { sessionStorageChanged } : {}),
    };

    return {
      ...base,
      ...(Object.keys(webStorageDiff).length > 0 ? { webStorageDiff } : {}),
    };
  });
}

function buildTargetSelector(target: TargetDomSnapshot): string {
  const el = target.element;
  const preferred = el.locators?.find(
    (loc) => loc.stabilityScore >= 0.7 && loc.expression
  );
  if (preferred) return preferred.expression;
  const parts = [el.tagName];
  if (el.id) parts.push(`#${el.id}`);
  else if (el.classNames?.length) {
    parts.push(
      el.classNames
        .slice(0, 2)
        .map((c) => `.${c}`)
        .join("")
    );
  }
  return parts.join("");
}

/** 为异常现场生成 `issues/<sceneId>/dom-context.json` 与 `dom-styles.json` 文件。 */
export function buildIssueSceneDomFilesV5(
  scene: IssueScene
): Array<{ name: string; data: Uint8Array }> {
  const target = scene.target ?? scene.targets?.[0];
  if (!target?.element) {
    return [];
  }
  const extendedTarget = target as TargetDomSnapshot & {
    relatedOverlays?: unknown[];
    triggerElement?: Record<string, unknown>;
    winnerRules?: unknown[];
  };
  const targetSelector = buildTargetSelector(target);

  const domContext = {
    sceneId: scene.id,
    capturedAtEpochMs: target.capturedAtEpochMs,
    targetSelector,
    targetElement: {
      tagName: target.element.tagName,
      ...(target.element.id ? { id: target.element.id } : {}),
      classNames: target.element.classNames,
      attributes: target.element.attributes,
      ...(target.sanitizedHtml ? { sanitizedHtml: target.sanitizedHtml } : {}),
      boundingBox: target.element.boundingBox,
      ancestors: target.ancestors,
      state: target.state,
    },
    ...(extendedTarget.relatedOverlays?.length
      ? { relatedOverlays: extendedTarget.relatedOverlays }
      : {}),
    ...(extendedTarget.triggerElement
      ? { triggerElement: extendedTarget.triggerElement }
      : {}),
  };

  const computedLayoutStyles: Record<string, string> = {};
  for (const key of LAYOUT_STYLE_KEYS) {
    if (target.computedStyle?.[key] !== undefined) {
      computedLayoutStyles[key] = target.computedStyle[key]!;
    }
  }
  for (const [k, v] of Object.entries(target.computedStyle ?? {})) {
    if (!(k in computedLayoutStyles)) {
      computedLayoutStyles[k] = v;
    }
  }

  const domStyles = {
    sceneId: scene.id,
    targetSelector,
    computedLayoutStyles,
    winnerRules: extendedTarget.winnerRules ?? [],
  };

  return [
    {
      name: `issues/${scene.id}/dom-context.json`,
      data: strToU8(JSON.stringify(domContext, null, 2)),
    },
    {
      name: `issues/${scene.id}/dom-styles.json`,
      data: strToU8(JSON.stringify(domStyles, null, 2)),
    },
  ];
}

/** 生成 Schema v5 的精简会话级摘要，兼容 Triage CLI `summary.metrics` 与人类可读环境字段。 */
export function buildSessionSummaryV5(input: {
  session: RecordingSession;
  interactionCount: number;
  screenshotCount: number;
  finalFramePath?: string;
  consoleMetrics: {
    totalOriginalEntries: number;
    uniqueSignatureCount: number;
    errorCount: number;
    warningCount: number;
  };
  networkMetrics: {
    totalRequests: number;
    failedRequests: number;
    totalNetworkBytes: number;
    casDeduplicatedCount: number;
  };
  issueSceneCount: number;
  frameworkStateCount: number;
  hasMedia: boolean;
}): Record<string, unknown> {
  const { session } = input;
  const env = session.target.environment;
  return {
    url: session.target.initialUrl,
    title: getSessionTitle(session, session.target.initialTitle),
    durationMs: session.timeline.durationMs,
    privacyMode: session.options.privacyMode,
    quality: session.quality.overall,
    ...(env
      ? {
          environment: {
            os: describeOsFromUserAgent(env.userAgent),
            browser: describeBrowserFromUserAgent(env.userAgent),
            language: env.language,
            screen: `${env.screenWidth}x${env.screenHeight}@${env.devicePixelRatio}x`,
            viewport: {
              width: env.viewportWidth,
              height: env.viewportHeight,
              dpr: env.devicePixelRatio,
            },
            userAgent: env.userAgent,
          },
        }
      : {}),
    ...(input.finalFramePath ? { finalFramePath: input.finalFramePath } : {}),
    hasMedia: input.hasMedia,
    metrics: {
      interactionCount: input.interactionCount,
      screenshotCount: input.screenshotCount,
      consoleSummary: input.consoleMetrics,
      networkSummary: input.networkMetrics,
      issueSceneCount: input.issueSceneCount,
      frameworkStateCount: input.frameworkStateCount,
    },
  };
}
