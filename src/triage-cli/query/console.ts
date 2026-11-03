import { formatRelativeTime } from "../format/time.ts";
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

export function queryConsole(
  pack: LoadedSessionPack,
  options: ConsoleQueryOptions = {}
): {
  totalEntries: number;
  matchedCount: number;
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

  const matched: ConsoleQueryItem[] = [];

  entries.forEach((entry: ConsoleEntry, index: number) => {
    const level = (entry.level ?? "log").toLowerCase();
    if (levelSet && !levelSet.has(level)) return;

    const relMs = pack.toRelativeMs(entry.createdAt);
    if (
      options.fromMs !== undefined &&
      relMs !== undefined &&
      relMs < options.fromMs
    ) {
      return;
    }
    if (
      options.toMs !== undefined &&
      relMs !== undefined &&
      relMs > options.toMs
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

    matched.push({
      index,
      id: entry.id,
      relativeMs: relMs,
      level,
      text,
      location: loc,
      sourceMapped,
      stack: stackStr,
    });
  });

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

export function formatConsoleItem(item: ConsoleQueryItem): string {
  const timeStr = formatRelativeTime(item.relativeMs);
  const locPart = item.sourceMapped
    ? ` (${item.location ?? "?"} -> ${item.sourceMapped})`
    : item.location
      ? ` (${item.location})`
      : "";
  let line = `[#${item.index}] ${timeStr} [${item.level.toUpperCase()}] ${item.text}${locPart}`;
  if (item.stack) {
    const stackLines = item.stack
      .split("\n")
      .slice(0, 5)
      .map((l) => `    ${l.trim()}`)
      .join("\n");
    line += `\n${stackLines}`;
  }
  return line;
}
