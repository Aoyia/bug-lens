import { createHash } from "node:crypto";
import type { LoadedSessionPack } from "../pack/session-pack.ts";
import type { ConsoleEntry } from "../pack/types.ts";

export interface ConsoleQueryOptions {
  levels?: string[];
  search?: string;
  regex?: string;
  fromMs?: number;
  toMs?: number;
  offset?: number;
  limit?: number;
  unfold?: boolean;
  minCount?: number;
}

export interface ConsoleQueryItem {
  index: number;
  id?: string;
  relativeMs?: number;
  level: string;
  text: string;
  location?: string;
  sourceMapped?: string;
  stack?: string;
  count: number;
  firstRelativeMs: number;
  lastRelativeMs: number;
  timeRangeMs: [number, number];
  signature?: string;
}

export function normalizeConsoleTemplate(text: string): string {
  if (!text) return "";
  return text
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      "[UUID]"
    )
    .replace(/\b1[6-9]\d{11}\b/g, "[TIMESTAMP]")
    .replace(
      /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/gi,
      "[TIMESTAMP]"
    )
    .replace(/\b\d+(?:\.\d+)?\s*(?:ms|s)\b/gi, "[DURATION]")
    .replace(/\b0x[0-9a-fA-F]+\b/g, "[HEX]")
    .trim()
    .slice(0, 500);
}

export function computeConsoleSignature(params: {
  level: string;
  location?: string;
  sourceMapped?: string;
  text: string;
}): string {
  const normLevel = (params.level || "log")
    .toLowerCase()
    .replace("warning", "warn");
  const normLocation = params.sourceMapped ?? params.location ?? "";
  const template = normalizeConsoleTemplate(params.text);
  const seed = `${normLevel}:${normLocation}:${template}`;
  return createHash("sha256").update(seed).digest("hex").slice(0, 12);
}

function normalizeStackTrace(
  stackTrace?: ConsoleEntry["stackTrace"],
  fallbackStack?: string
): string | undefined {
  if (typeof stackTrace === "string" && stackTrace.trim()) return stackTrace;
  if (Array.isArray(stackTrace) && stackTrace.length > 0) {
    return stackTrace
      .map((f) => {
        const fn = f.functionName || "<anonymous>";
        const sm = f.sourceMappedLocation;
        const loc =
          sm?.resolved && sm.originalFile
            ? `${sm.originalFile}:${sm.originalLine ?? 0}`
            : `${f.url ?? "?"}:${f.lineNumber ?? 0}`;
        return `at ${fn} (${loc})`;
      })
      .join("\n");
  }
  return fallbackStack;
}

function formatRelativeMs(ms?: number): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "—";
  const rounded = Math.round(ms);
  const sign = rounded >= 0 ? "+" : "-";
  return `${sign}${Math.abs(rounded)}ms`;
}

export function queryConsole(
  pack: LoadedSessionPack,
  options: ConsoleQueryOptions = {}
): {
  totalEntries: number;
  matchedCount: number;
  folded: boolean;
  offset: number;
  limit: number;
  items: ConsoleQueryItem[];
} {
  const entries = pack.getConsoleEntries();
  const levelSet =
    options.levels && options.levels.length > 0
      ? new Set(
          options.levels.flatMap((l) => {
            const lower = l.toLowerCase();
            if (lower === "warn" || lower === "warning") {
              return ["warn", "warning"];
            }
            return [lower];
          })
        )
      : undefined;

  const searchLower = options.search?.toLowerCase();
  const regexObj = options.regex ? new RegExp(options.regex, "i") : undefined;

  const rawMatched: Array<{
    entry: ConsoleEntry;
    index: number;
    relMs?: number;
    lastRelMs?: number;
    repeatCount: number;
    level: string;
    text: string;
    loc?: string;
    sourceMapped?: string;
    stackStr?: string;
    signature: string;
  }> = [];

  entries.forEach((entry: ConsoleEntry, index: number) => {
    const level = (entry.level ?? "log").toLowerCase();
    if (levelSet && !levelSet.has(level)) return;

    const relMs = pack.toRelativeMs(entry.createdAt);
    const lastRelMs = pack.toRelativeMs(entry.lastCreatedAt) ?? relMs;
    if (
      options.fromMs !== undefined &&
      (lastRelMs === undefined || lastRelMs < options.fromMs)
    ) {
      return;
    }
    if (
      options.toMs !== undefined &&
      (relMs === undefined || relMs > options.toMs)
    ) {
      return;
    }

    const text = entry.text ?? "";
    const url = entry.url ?? entry.source ?? "";
    const stackStr = normalizeStackTrace(entry.stackTrace, entry.stack);
    const haystack = `${text}\n${url}\n${stackStr ?? ""}`;

    if (searchLower && !haystack.toLowerCase().includes(searchLower)) {
      return;
    }
    if (regexObj && !regexObj.test(haystack)) {
      return;
    }

    const loc = url
      ? `${url}${entry.lineNumber !== undefined ? `:${entry.lineNumber}` : ""}`
      : undefined;
    const sm = entry.sourceMappedLocation;
    const fnName = sm?.originalFunctionName ?? sm?.originalName;
    const sourceMapped =
      sm?.resolved && sm.originalFile
        ? `${sm.originalFile}:${sm.originalLine ?? 0}${sm.originalColumn !== undefined ? `:${sm.originalColumn}` : ""}${fnName ? ` (${fnName})` : ""}`
        : undefined;

    const signature =
      entry.summarySignature ??
      computeConsoleSignature({
        level,
        location: loc,
        sourceMapped,
        text,
      });

    rawMatched.push({
      entry,
      index,
      relMs,
      lastRelMs,
      repeatCount: Math.max(1, entry.repeatCount ?? 1),
      level,
      text,
      loc,
      sourceMapped,
      stackStr,
      signature,
    });
  });

  let finalItems: ConsoleQueryItem[] = [];

  const signatureCounts = new Map<string, number>();
  for (const m of rawMatched) {
    signatureCounts.set(
      m.signature,
      (signatureCounts.get(m.signature) ?? 0) + m.repeatCount
    );
  }

  if (options.unfold) {
    finalItems = [];
    for (const m of rawMatched) {
      const sampleTs = m.entry.summaryTimestamps;
      if (m.repeatCount > 1 && Array.isArray(sampleTs) && sampleTs.length > 0) {
        for (const ts of sampleTs) {
          const tsRel = pack.toRelativeMs(ts) ?? m.relMs ?? 0;
          finalItems.push({
            index: m.index,
            id: m.entry.id,
            relativeMs: tsRel,
            level: m.level,
            text: m.text,
            location: m.loc,
            sourceMapped: m.sourceMapped,
            stack: m.stackStr,
            count: 1,
            firstRelativeMs: tsRel,
            lastRelativeMs: tsRel,
            timeRangeMs: [tsRel, tsRel],
            signature: m.signature,
          });
        }
      } else {
        const ms = m.relMs ?? 0;
        const lastMs = m.lastRelMs ?? ms;
        finalItems.push({
          index: m.index,
          id: m.entry.id,
          relativeMs: m.relMs,
          level: m.level,
          text: m.text,
          location: m.loc,
          sourceMapped: m.sourceMapped,
          stack: m.stackStr,
          count: m.repeatCount,
          firstRelativeMs: ms,
          lastRelativeMs: lastMs,
          timeRangeMs: [ms, lastMs],
          signature: m.signature,
        });
      }
    }
  } else {
    const groupMap = new Map<string, ConsoleQueryItem>();
    for (const m of rawMatched) {
      const firstMs = m.relMs ?? 0;
      const lastMs = m.lastRelMs ?? firstMs;
      const existing = groupMap.get(m.signature);
      if (!existing) {
        groupMap.set(m.signature, {
          index: m.index,
          id: m.entry.id,
          relativeMs: m.relMs,
          level: m.level,
          text: m.text,
          location: m.loc,
          sourceMapped: m.sourceMapped,
          stack: m.stackStr,
          count: m.repeatCount,
          firstRelativeMs: firstMs,
          lastRelativeMs: lastMs,
          timeRangeMs: [firstMs, lastMs],
          signature: m.signature,
        });
      } else {
        existing.count += m.repeatCount;
        if (firstMs < existing.firstRelativeMs) {
          existing.firstRelativeMs = firstMs;
        }
        if (lastMs > existing.lastRelativeMs) {
          existing.lastRelativeMs = lastMs;
        }
        existing.timeRangeMs = [
          existing.firstRelativeMs,
          existing.lastRelativeMs,
        ];
        if (!existing.stack && m.stackStr) existing.stack = m.stackStr;
        if (!existing.sourceMapped && m.sourceMapped)
          existing.sourceMapped = m.sourceMapped;
      }
    }
    finalItems = Array.from(groupMap.values());
  }

  if (options.minCount !== undefined && options.minCount > 1) {
    const min = options.minCount;
    if (options.unfold) {
      finalItems = finalItems.filter(
        (item) =>
          (signatureCounts.get(item.signature ?? "") ?? item.count) >= min
      );
    } else {
      finalItems = finalItems.filter((item) => item.count >= min);
    }
  }

  const offset = Math.max(0, options.offset ?? 0);
  const limit = Math.max(1, options.limit ?? 50);

  return {
    totalEntries: pack.getConsoleTotalCount(),
    matchedCount: finalItems.length,
    folded: !options.unfold,
    offset,
    limit,
    items: finalItems.slice(offset, offset + limit),
  };
}

export function formatConsoleItem(
  item: ConsoleQueryItem,
  options: { unfold?: boolean } = {}
): string {
  const rawLevel = (item.level ?? "log").toUpperCase();
  const levelTag = rawLevel === "WARNING" ? "WARN" : rawLevel;
  const count = item.count ?? 1;
  const firstMs = item.firstRelativeMs ?? item.relativeMs ?? 0;
  const lastMs = item.lastRelativeMs ?? firstMs;

  let timesStr = "";
  if (options.unfold || count <= 1) {
    timesStr = `[x1 time | ${formatRelativeMs(firstMs)}]`;
  } else {
    timesStr = `[x${count} times | ${formatRelativeMs(firstMs)}..${formatRelativeMs(lastMs)}]`;
  }

  const idStr = String(item.index).padStart(3, "0");
  let line = `[#${idStr}] [${levelTag}] ${timesStr} ${item.text}`;

  const indent = "       "; // 7 spaces to align under [#042]
  if (item.sourceMapped) {
    line += `\n${indent}sourceMapped: ${item.sourceMapped}`;
  } else if (item.location) {
    line += `\n${indent}location: ${item.location}`;
  }

  if (item.stack) {
    const stackLines = item.stack
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .slice(0, 5);
    if (stackLines.length > 0) {
      line += `\n${indent}stack: ${stackLines[0]}`;
      for (let i = 1; i < stackLines.length; i++) {
        line += `\n${indent}       ${stackLines[i]}`;
      }
    }
  }

  return line;
}
