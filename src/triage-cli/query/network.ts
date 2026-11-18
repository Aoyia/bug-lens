import {
  isBenignStaticNoBodyRequest,
  isStaticAssetCandidate,
} from "../../domain/network-filter.ts";
import { formatDuration, formatRelativeTime } from "../format/time.ts";
import type { LoadedSessionPack } from "../pack/session-pack.ts";
import type { NetworkDetailEntry, NetworkEntry } from "../pack/types.ts";
import { evaluateJsonPath } from "./json-path.ts";

export type NetworkStatusFilter =
  "failed" | "biz_error" | "4xx" | "5xx" | "2xx" | "3xx" | "all" | number[];

export interface NetworkQueryOptions {
  status?: NetworkStatusFilter;
  bizError?: boolean;
  bizCode?: string;
  urlContains?: string;
  method?: string;
  type?: string;
  apiOnly?: boolean;
  offset?: number;
  limit?: number;
}

export interface NetworkSummaryRow {
  id: string;
  relativeMs?: number;
  method: string;
  status: number;
  durationMs?: number;
  type?: string;
  url: string;
  mimeType?: string;
  bodyStatus?: string;
  byteLength?: number;
  hasBody: boolean;
  isFailure: boolean;
  isStaticAsset?: boolean;
  isBenignStatic?: boolean;
  isBizError?: boolean;
  bizErrorCode?: string | number;
  bizErrorMessage?: string;
}

export interface BizErrorInfo {
  isBizError: boolean;
  code?: string | number;
  message?: string;
  matchedRule: string;
}

const COMMON_SUCCESS_CODES = new Set<unknown>([
  0,
  200,
  "0",
  "0000",
  "000000",
  "200",
  "SUCCESS",
  "OK",
  "success",
  "ok",
]);

const ERROR_KEYWORD_RE =
  /err|fail|invalid|denied|timeout|reject|not_found|unauthor|forbidden|exception/i;

const SKIP_BIZ_SCAN_TYPES = new Set(["image", "font", "media", "stylesheet"]);

const SKIP_BIZ_SCAN_MIME_PREFIXES = [
  "image/",
  "font/",
  "audio/",
  "video/",
  "text/css",
  "application/javascript",
  "text/javascript",
];

function extractBizMessage(
  parsed: Record<string, unknown>
): string | undefined {
  const raw = parsed.message ?? parsed.msg ?? parsed.errorMsg ?? parsed.error;
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && "message" in raw) {
    const nested = (raw as { message?: unknown }).message;
    return typeof nested === "string" ? nested : JSON.stringify(raw);
  }
  return undefined;
}

function isNonEmptyCodeValue(val: unknown): val is string | number {
  return (
    val !== undefined &&
    val !== null &&
    val !== "" &&
    typeof val !== "boolean" &&
    !COMMON_SUCCESS_CODES.has(val)
  );
}

function checkHeuristicBusinessError(body: string): BizErrorInfo | undefined {
  const isSuccessFalse = /"(?:success|isSuccess)"\s*:\s*false/i.test(body);
  const explicitErrMatch =
    /"(?:errorCode|errCode)"\s*:\s*(?:"([^"\\]+)"|(-?[1-9]\d*))/.exec(body);
  const genericCodeMatch =
    /"(?:code|retCode)"\s*:\s*(?:"([^"\\]+)"|(0|-?[1-9]\d*))/.exec(body);

  const rawExplicit = explicitErrMatch?.[1] ?? explicitErrMatch?.[2];
  const hasExplicitErr =
    rawExplicit !== undefined &&
    rawExplicit.length > 0 &&
    !COMMON_SUCCESS_CODES.has(rawExplicit);

  const rawGeneric = genericCodeMatch?.[1] ?? genericCodeMatch?.[2];
  const hasAbnormalGeneric =
    rawGeneric !== undefined &&
    rawGeneric.length > 0 &&
    !COMMON_SUCCESS_CODES.has(rawGeneric) &&
    (/-?[1-9]\d{2,}|-\d+/.test(rawGeneric) ||
      ERROR_KEYWORD_RE.test(rawGeneric));

  if (!isSuccessFalse && !hasExplicitErr && !hasAbnormalGeneric) {
    return undefined;
  }

  const resolvedCode =
    (hasExplicitErr ? rawExplicit : undefined) ??
    (hasAbnormalGeneric ? rawGeneric : undefined) ??
    genericCodeMatch?.[1] ??
    genericCodeMatch?.[2] ??
    "FAIL";
  if (COMMON_SUCCESS_CODES.has(resolvedCode) && !isSuccessFalse) {
    return { isBizError: false, matchedRule: "heuristic_regex_success" };
  }
  const msgMatch =
    /"(?:message|msg|errorMsg|error)"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/.exec(
      body
    );
  return {
    isBizError: true,
    code: resolvedCode,
    message: msgMatch ? msgMatch[1] : undefined,
    matchedRule: "heuristic_regex",
  };
}

/**
 * 识别 HTTP 200~299 状态码下包装的业务异常
 */
export function detectBusinessError(body: string): BizErrorInfo {
  const trimmed = body.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return { isBizError: false, matchedRule: "not_json" };
  }

  try {
    const raw = JSON.parse(trimmed);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { isBizError: false, matchedRule: "primitive_json" };
    }
    const parsed = raw as Record<string, unknown>;
    const msg = extractBizMessage(parsed);

    if (
      parsed.success === false ||
      parsed.isSuccess === false ||
      parsed.result === false
    ) {
      return {
        isBizError: true,
        code:
          (parsed.code as string | number | undefined) ??
          (parsed.errCode as string | number | undefined) ??
          (parsed.errorCode as string | number | undefined) ??
          (parsed.result as string | number | undefined) ??
          "FAIL",
        message: msg,
        matchedRule: "explicit_success_false",
      };
    }

    const explicitErrCode = parsed.errorCode ?? parsed.errCode;
    if (isNonEmptyCodeValue(explicitErrCode)) {
      return {
        isBizError: true,
        code: explicitErrCode,
        message: msg,
        matchedRule: "explicit_error_code",
      };
    }

    const positiveSuccess =
      parsed.success === true || parsed.isSuccess === true;
    const rawCode = parsed.code ?? parsed.retCode;
    if (isNonEmptyCodeValue(rawCode) && !positiveSuccess) {
      return {
        isBizError: true,
        code: rawCode,
        message: msg,
        matchedRule: "abnormal_code_value",
      };
    }

    if (
      !positiveSuccess &&
      rawCode === undefined &&
      (typeof parsed.result === "number" ||
        typeof parsed.result === "string") &&
      isNonEmptyCodeValue(parsed.result) &&
      (typeof parsed.result === "number" ||
        ERROR_KEYWORD_RE.test(parsed.result))
    ) {
      return {
        isBizError: true,
        code: parsed.result,
        message: msg,
        matchedRule: "abnormal_result_value",
      };
    }

    if (
      !positiveSuccess &&
      parsed.status !== undefined &&
      parsed.status !== null
    ) {
      if (
        typeof parsed.status === "number" &&
        !COMMON_SUCCESS_CODES.has(parsed.status)
      ) {
        return {
          isBizError: true,
          code: parsed.status,
          message: msg,
          matchedRule: "abnormal_status_number",
        };
      }
      if (
        typeof parsed.status === "string" &&
        !COMMON_SUCCESS_CODES.has(parsed.status) &&
        !COMMON_SUCCESS_CODES.has(parsed.status.toLowerCase()) &&
        ERROR_KEYWORD_RE.test(parsed.status)
      ) {
        return {
          isBizError: true,
          code: parsed.status,
          message: msg,
          matchedRule: "abnormal_status_string",
        };
      }
    }

    const hasErrorObj =
      parsed.error &&
      typeof parsed.error === "object" &&
      Object.keys(parsed.error as object).length > 0;
    if (
      (typeof parsed.error === "string" && parsed.error.length > 0) ||
      (typeof parsed.exception === "string" && parsed.exception.length > 0) ||
      hasErrorObj
    ) {
      const errMsg =
        typeof parsed.error === "string"
          ? parsed.error
          : typeof parsed.exception === "string"
            ? parsed.exception
            : ((parsed.error as { message?: string })?.message ??
              JSON.stringify(parsed.error));
      const nestedCode = hasErrorObj
        ? (parsed.error as { code?: string | number }).code
        : undefined;
      return {
        isBizError: true,
        code:
          (isNonEmptyCodeValue(rawCode) ? rawCode : undefined) ??
          nestedCode ??
          "EXCEPTION",
        message: errMsg,
        matchedRule: "exception_field_present",
      };
    }
  } catch {
    const heuristic = checkHeuristicBusinessError(body);
    if (heuristic) return heuristic;
  }

  return { isBizError: false, matchedRule: "none" };
}

export function isHttpNetworkFailure(entry: NetworkEntry): boolean {
  const st = entry.status ?? 0;
  return st === 0 || st >= 400 || Boolean(entry.errorText);
}

/**
 * 解析网络条目的业务异常信息：优先读取 v5 预标注字段（零磁盘 I/O），仅在按需开启 allowBodyScan 时才读取 2xx 响应体。
 */
export function resolveNetworkBusinessError(
  pack: Pick<LoadedSessionPack, "getNetworkBody">,
  entry: NetworkEntry,
  options: { allowBodyScan?: boolean; maxScanBytes?: number } = {}
): BizErrorInfo {
  if (entry.businessError) {
    return {
      isBizError: true,
      code: entry.businessError.code ?? "FAIL",
      message: entry.businessError.message,
      matchedRule: "manifest_v5_pretagged",
    };
  }
  const st = entry.status ?? 0;
  if (!options.allowBodyScan || st < 200 || st >= 300) {
    return { isBizError: false, matchedRule: "skipped" };
  }
  const typeLower = (entry.type ?? "").toLowerCase();
  if (typeLower && SKIP_BIZ_SCAN_TYPES.has(typeLower)) {
    return { isBizError: false, matchedRule: "skipped_non_api_type" };
  }
  const mimeLower = (entry.response?.mimeType ?? "").toLowerCase();
  if (
    mimeLower &&
    SKIP_BIZ_SCAN_MIME_PREFIXES.some((prefix) => mimeLower.startsWith(prefix))
  ) {
    return { isBizError: false, matchedRule: "skipped_non_json_mime" };
  }
  if (
    options.maxScanBytes !== undefined &&
    typeof entry.response?.byteLength === "number" &&
    entry.response.byteLength > options.maxScanBytes &&
    typeof entry.response?.body !== "string"
  ) {
    return { isBizError: false, matchedRule: "skipped_size_limit" };
  }
  const rawBody = pack.getNetworkBody(entry);
  return rawBody
    ? detectBusinessError(rawBody)
    : { isBizError: false, matchedRule: "no_body" };
}

export function formatNetworkStatusTag(
  status: number,
  bizInfo?: Pick<BizErrorInfo, "isBizError" | "code">,
  prefixHttpError = false
): string {
  if (bizInfo?.isBizError) {
    return `${status} [BIZ_ERR: code=${bizInfo.code ?? "ERR"}]`;
  }
  return prefixHttpError ? `!${status}` : String(status);
}

function matchesStatusFilter(
  entry: NetworkEntry,
  filter?: NetworkStatusFilter,
  bizInfo?: BizErrorInfo
): boolean {
  if (!filter || filter === "all") return true;
  if (filter === "biz_error") return Boolean(bizInfo?.isBizError);
  const st = entry.status ?? 0;
  if (filter === "failed") return isHttpNetworkFailure(entry);
  if (filter === "4xx") return st >= 400 && st < 500;
  if (filter === "5xx") return st >= 500 && st < 600;
  if (filter === "2xx") return st >= 200 && st < 300;
  if (filter === "3xx") return st >= 300 && st < 400;
  if (Array.isArray(filter)) return filter.includes(st);
  return true;
}

export function queryNetwork(
  pack: LoadedSessionPack,
  options: NetworkQueryOptions = {}
): {
  totalEntries: number;
  matchedCount: number;
  hiddenStaticCount: number;
  staticNoBodyCount: number;
  offset: number;
  limit: number;
  items: NetworkSummaryRow[];
} {
  const entries = pack.getNetworkEntries();
  const urlNeedle = options.urlContains?.toLowerCase();
  const methodUpper = options.method?.toUpperCase();
  const typeLower = options.type?.toLowerCase();
  const needsBizScan = Boolean(
    options.bizError || options.bizCode || options.status === "biz_error"
  );
  const bizCodePatterns = options.bizCode
    ? options.bizCode
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    : [];

  const matched: NetworkSummaryRow[] = [];
  let hiddenStaticCount = 0;
  let staticNoBodyCount = 0;

  for (const entry of entries) {
    if (urlNeedle && !entry.url.toLowerCase().includes(urlNeedle)) continue;
    if (methodUpper && (entry.method ?? "GET").toUpperCase() !== methodUpper) {
      continue;
    }
    if (typeLower && (entry.type ?? "").toLowerCase() !== typeLower) {
      continue;
    }
    if (options.status && options.status !== "biz_error") {
      if (!matchesStatusFilter(entry, options.status)) continue;
    }

    const st = entry.status ?? 0;
    const bizInfo = resolveNetworkBusinessError(pack, entry, {
      allowBodyScan: needsBizScan,
    });

    if (options.bizError && !bizInfo.isBizError) continue;
    if (bizCodePatterns.length > 0) {
      if (!bizInfo.isBizError) continue;
      const codeStr = String(bizInfo.code ?? "").toLowerCase();
      if (!bizCodePatterns.some((p) => codeStr.includes(p))) continue;
    }
    if (options.status === "biz_error" && !bizInfo.isBizError) continue;

    const isHttpFailure = isHttpNetworkFailure(entry);
    const isFailure = isHttpFailure || bizInfo.isBizError;
    const hasBody =
      Boolean(entry.response?.bodyPath) ||
      Boolean(entry.response?.bodyHash) ||
      typeof entry.response?.body === "string" ||
      entry.response?.bodyStatus === "captured";
    const isStaticAsset =
      entry.isStaticAsset ??
      isStaticAssetCandidate({
        url: entry.url,
        type: entry.type,
        mimeType: entry.response?.mimeType,
      });
    const isBenignStatic =
      entry.isBenignStatic ??
      isBenignStaticNoBodyRequest({
        url: entry.url,
        type: entry.type,
        mimeType: entry.response?.mimeType,
        status: st,
        byteLength: entry.response?.byteLength,
        bodyStatus: entry.response?.bodyStatus,
        hasBody,
        isFailure,
      });

    if (isBenignStatic) {
      staticNoBodyCount += 1;
    }

    if (options.apiOnly && !isFailure && (isStaticAsset || isBenignStatic)) {
      hiddenStaticCount += 1;
      continue;
    }

    matched.push({
      id: entry.id,
      relativeMs: pack.toRelativeMs(entry.createdAt),
      method: entry.method ?? "GET",
      status: st,
      durationMs: entry.durationMs,
      type: entry.type,
      url: entry.url,
      mimeType: entry.response?.mimeType,
      bodyStatus: entry.response?.bodyStatus,
      byteLength: entry.response?.byteLength,
      hasBody,
      isFailure,
      ...(isStaticAsset ? { isStaticAsset: true } : {}),
      ...(isBenignStatic ? { isBenignStatic: true } : {}),
      isBizError: bizInfo.isBizError ? true : undefined,
      bizErrorCode: bizInfo.code,
      bizErrorMessage: bizInfo.message,
    });
  }

  // 当未显式过滤状态时，失败请求排最前，API 请求居中，0B 良性静态资源沉底
  if (!options.status && !options.bizError) {
    matched.sort((a, b) => {
      if (a.isFailure !== b.isFailure) return a.isFailure ? -1 : 1;
      const aStatic = Boolean(a.isBenignStatic);
      const bStatic = Boolean(b.isBenignStatic);
      if (aStatic !== bStatic) return aStatic ? 1 : -1;
      return (a.relativeMs ?? 0) - (b.relativeMs ?? 0);
    });
  }

  const offset = Math.max(0, options.offset ?? 0);
  const limit = Math.max(1, options.limit ?? 50);

  return {
    totalEntries: entries.length,
    matchedCount: matched.length,
    hiddenStaticCount,
    staticNoBodyCount,
    offset,
    limit,
    items: matched.slice(offset, offset + limit),
  };
}

export function formatNetworkRow(row: NetworkSummaryRow): string {
  const timeStr = formatRelativeTime(row.relativeMs);
  const durStr = formatDuration(row.durationMs);
  const statusStr = formatNetworkStatusTag(
    row.status,
    { isBizError: Boolean(row.isBizError), code: row.bizErrorCode },
    row.isFailure && !row.isBizError
  );
  const bodyTag = row.hasBody
    ? `[body:${row.byteLength ?? "?"}B]`
    : `[${row.bodyStatus ?? "no-body"}]`;
  const errSuffix = row.bizErrorMessage
    ? ` (bizError: ${row.bizErrorMessage})`
    : "";
  return `${row.id} | ${timeStr} | ${row.method} ${statusStr} (${durStr}) | ${row.type ?? "?"} | ${bodyTag} | ${row.url}${errSuffix}`;
}

export interface InspectRequestOptions {
  include?: Array<"summary" | "headers" | "initiator" | "body">;
  jsonPath?: string;
  bodyMaxChars?: number;
}

export interface InspectedRequestResult {
  entry: NetworkEntry;
  relativeMs?: number;
  details?: NetworkDetailEntry;
  bodyText?: string;
  extractedJson?: unknown;
  bodyTruncated?: boolean;
  bizError?: BizErrorInfo;
}

export function findNetworkEntry(
  pack: LoadedSessionPack,
  requestId: string
): NetworkEntry {
  const entries = pack.getNetworkEntries();
  const entry =
    entries.find((e) => e.id === requestId) ??
    entries.find((e) => e.id.endsWith(requestId) || e.url.includes(requestId));

  if (!entry) {
    throw new Error(
      `REQUEST_NOT_FOUND: No network entry found matching "${requestId}". Call query_network first to list available entry IDs.`
    );
  }
  return entry;
}

export function inspectNetworkRequest(
  pack: LoadedSessionPack,
  requestId: string,
  options: InspectRequestOptions = {}
): InspectedRequestResult {
  const entry = findNetworkEntry(pack, requestId);

  const includeSet = new Set(
    options.include && options.include.length > 0
      ? options.include
      : ["summary", "headers", "initiator", "body"]
  );

  const detailsMap = pack.getNetworkDetails();
  const details =
    includeSet.has("headers") ||
    includeSet.has("initiator") ||
    includeSet.has("body")
      ? detailsMap[entry.id]
      : undefined;

  let bodyText: string | undefined;
  let extractedJson: unknown;
  let bodyTruncated = false;
  let bizError: BizErrorInfo | undefined;

  if (includeSet.has("body") || options.jsonPath) {
    const rawBody = pack.getNetworkBody(entry);
    if (rawBody !== undefined) {
      if ((entry.status ?? 0) >= 200 && (entry.status ?? 0) < 300) {
        bizError = detectBusinessError(rawBody);
      }
      if (options.jsonPath) {
        try {
          const parsed = JSON.parse(rawBody);
          extractedJson = evaluateJsonPath(parsed, options.jsonPath);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new Error(
            `INVALID_RESPONSE_JSON: Cannot evaluate jsonPath "${options.jsonPath}" because response body is not valid JSON (${msg})`
          );
        }
      } else {
        const maxChars = options.bodyMaxChars ?? 8000;
        if (rawBody.length > maxChars) {
          bodyText = rawBody.slice(0, maxChars);
          bodyTruncated = true;
        } else {
          bodyText = rawBody;
        }
      }
    }
  }

  return {
    entry,
    relativeMs: pack.toRelativeMs(entry.createdAt),
    details,
    bodyText,
    extractedJson,
    bodyTruncated,
    bizError,
  };
}
