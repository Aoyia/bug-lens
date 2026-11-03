import { formatDuration, formatRelativeTime } from "../format/time.ts";
import type { LoadedSessionPack } from "../pack/session-pack.ts";
import type { NetworkDetailEntry, NetworkEntry } from "../pack/types.ts";
import { evaluateJsonPath } from "./json-path.ts";

export type NetworkStatusFilter =
  "failed" | "4xx" | "5xx" | "2xx" | "3xx" | "all" | number[];

export interface NetworkQueryOptions {
  status?: NetworkStatusFilter;
  urlContains?: string;
  method?: string;
  type?: string;
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
}

function matchesStatusFilter(
  entry: NetworkEntry,
  filter?: NetworkStatusFilter
): boolean {
  if (!filter || filter === "all") return true;
  const st = entry.status ?? 0;
  const isErr = st === 0 || st >= 400 || Boolean(entry.errorText);
  if (filter === "failed") return isErr;
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
  offset: number;
  limit: number;
  items: NetworkSummaryRow[];
} {
  const entries = pack.getNetworkEntries();
  const urlNeedle = options.urlContains?.toLowerCase();
  const methodUpper = options.method?.toUpperCase();
  const typeLower = options.type?.toLowerCase();

  const matched: NetworkSummaryRow[] = [];

  for (const entry of entries) {
    if (!matchesStatusFilter(entry, options.status)) continue;
    if (urlNeedle && !entry.url.toLowerCase().includes(urlNeedle)) continue;
    if (methodUpper && (entry.method ?? "GET").toUpperCase() !== methodUpper) {
      continue;
    }
    if (typeLower && (entry.type ?? "").toLowerCase() !== typeLower) {
      continue;
    }

    const st = entry.status ?? 0;
    const isFailure = st === 0 || st >= 400 || Boolean(entry.errorText);
    const hasBody =
      Boolean(entry.response?.bodyPath) ||
      typeof entry.response?.body === "string" ||
      entry.response?.bodyStatus === "captured";

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
    });
  }

  // 当未显式过滤状态时，失败请求排在前面以便快速发现异常，其余按时间顺序
  if (!options.status) {
    matched.sort((a, b) => {
      if (a.isFailure !== b.isFailure) return a.isFailure ? -1 : 1;
      return (a.relativeMs ?? 0) - (b.relativeMs ?? 0);
    });
  }

  const offset = Math.max(0, options.offset ?? 0);
  const limit = Math.max(1, options.limit ?? 50);

  return {
    totalEntries: entries.length,
    matchedCount: matched.length,
    offset,
    limit,
    items: matched.slice(offset, offset + limit),
  };
}

export function formatNetworkRow(row: NetworkSummaryRow): string {
  const timeStr = formatRelativeTime(row.relativeMs);
  const durStr = formatDuration(row.durationMs);
  const flag = row.isFailure ? "!" : "";
  const bodyTag = row.hasBody
    ? `[body:${row.byteLength ?? "?"}B]`
    : `[${row.bodyStatus ?? "no-body"}]`;
  return `${row.id} | ${timeStr} | ${row.method} ${flag}${row.status} (${durStr}) | ${row.type ?? "?"} | ${bodyTag} | ${row.url}`;
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
}

export function inspectNetworkRequest(
  pack: LoadedSessionPack,
  requestId: string,
  options: InspectRequestOptions = {}
): InspectedRequestResult {
  const entries = pack.getNetworkEntries();
  const entry =
    entries.find((e) => e.id === requestId) ??
    entries.find((e) => e.id.endsWith(requestId) || e.url.includes(requestId));

  if (!entry) {
    throw new Error(
      `REQUEST_NOT_FOUND: No network entry found matching "${requestId}". Call query_network first to list available entry IDs.`
    );
  }

  const includeSet = new Set(
    options.include && options.include.length > 0
      ? options.include
      : ["summary", "headers", "initiator", "body"]
  );

  const detailsMap = pack.getNetworkDetails();
  const details =
    includeSet.has("headers") || includeSet.has("initiator")
      ? detailsMap[entry.id]
      : undefined;

  let bodyText: string | undefined;
  let extractedJson: unknown;
  let bodyTruncated = false;

  if (includeSet.has("body") || options.jsonPath) {
    const rawBody = pack.getNetworkBody(entry);
    if (rawBody !== undefined) {
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
  };
}
