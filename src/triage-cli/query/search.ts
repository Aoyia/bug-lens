import { formatInteractionLine } from "../format/element.ts";
import { formatRelativeTime } from "../format/time.ts";
import type { LoadedSessionPack } from "../pack/session-pack.ts";

export type SearchScope =
  "console" | "network-url" | "network-body" | "interactions" | "framework";

export interface SearchHit {
  scope: SearchScope;
  ref: string;
  relativeMs?: number;
  snippet: string;
}

export interface SearchPackOptions {
  query: string;
  scopes?: SearchScope[];
  limit?: number;
  contextChars?: number;
}

function makeSnippets(
  rawText: string,
  needleLower: string,
  radius = 180,
  maxMatches = 3
): string[] {
  const text = needleLower.includes("svg")
    ? rawText
    : rawText.replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, "<svg/>");
  const lower = text.toLowerCase();
  const ranges: Array<{ start: number; end: number }> = [];
  let searchFrom = 0;

  while (searchFrom < lower.length && ranges.length < maxMatches) {
    const idx = lower.indexOf(needleLower, searchFrom);
    if (idx < 0) break;
    const start = Math.max(0, idx - radius);
    const end = Math.min(text.length, idx + needleLower.length + radius);
    const prev = ranges[ranges.length - 1];
    if (prev && start <= prev.end) {
      prev.end = Math.max(prev.end, end);
    } else {
      ranges.push({ start, end });
    }
    searchFrom = idx + Math.max(1, needleLower.length);
  }

  if (ranges.length === 0) {
    return [
      text
        .slice(0, radius * 2)
        .replace(/\s+/g, " ")
        .trim(),
    ];
  }

  return ranges.map(({ start, end }) => {
    const prefix = start > 0 ? "…" : "";
    const suffix = end < text.length ? "…" : "";
    return prefix + text.slice(start, end).replace(/\s+/g, " ").trim() + suffix;
  });
}

export function searchSessionPack(
  pack: LoadedSessionPack,
  options: SearchPackOptions
): {
  query: string;
  totalHits: number;
  hits: SearchHit[];
} {
  const needle = options.query.trim();
  if (!needle) {
    return { query: needle, totalHits: 0, hits: [] };
  }
  const needleLower = needle.toLowerCase();
  const scopes = new Set<SearchScope>(
    options.scopes && options.scopes.length > 0
      ? options.scopes
      : ["console", "network-url", "network-body", "interactions", "framework"]
  );
  const limit = Math.max(1, options.limit ?? 30);
  const radius = Math.min(2000, Math.max(40, options.contextChars ?? 180));
  const hits: SearchHit[] = [];

  if (scopes.has("console")) {
    pack.getConsoleEntries().forEach((entry, idx) => {
      const hay = `${entry.text ?? ""} ${entry.url ?? ""} ${entry.stackTrace ?? entry.stack ?? ""}`;
      if (hay.toLowerCase().includes(needleLower)) {
        const rel = pack.toRelativeMs(entry.createdAt);
        const [snippet] = makeSnippets(hay, needleLower, radius, 1);
        hits.push({
          scope: "console",
          ref: `console#${idx}`,
          relativeMs: rel,
          snippet: `${formatRelativeTime(rel)} [${entry.level ?? "log"}] ${snippet}`,
        });
      }
    });
  }

  if (scopes.has("network-url")) {
    for (const entry of pack.getNetworkEntries()) {
      if (entry.url.toLowerCase().includes(needleLower)) {
        const rel = pack.toRelativeMs(entry.createdAt);
        hits.push({
          scope: "network-url",
          ref: entry.id,
          relativeMs: rel,
          snippet: `${formatRelativeTime(rel)} ${entry.method ?? "GET"} ${entry.status ?? 0} ${entry.url}`,
        });
      }
    }
  }

  if (scopes.has("network-body")) {
    for (const entry of pack.getNetworkEntries()) {
      const body = pack.getNetworkBody(entry);
      if (body && body.toLowerCase().includes(needleLower)) {
        const rel = pack.toRelativeMs(entry.createdAt);
        const snippets = makeSnippets(body, needleLower, radius, 3);
        for (const snippet of snippets) {
          hits.push({
            scope: "network-body",
            ref: entry.id,
            relativeMs: rel,
            snippet: `${formatRelativeTime(rel)} (${entry.url}) ${snippet}`,
          });
        }
      }
    }
  }

  if (scopes.has("interactions")) {
    pack.getInteractions().forEach((item, idx) => {
      const line = formatInteractionLine(
        item,
        idx,
        pack.toRelativeMs(item.createdAt)
      );
      const rawJson = JSON.stringify(item.element ?? item.target ?? {});
      if (
        line.toLowerCase().includes(needleLower) ||
        rawJson.toLowerCase().includes(needleLower)
      ) {
        hits.push({
          scope: "interactions",
          ref: `interaction#${idx}`,
          relativeMs: pack.toRelativeMs(item.createdAt),
          snippet: line,
        });
      }
    });
  }

  if (scopes.has("framework")) {
    pack.getFrameworkStates().forEach((st, idx) => {
      const raw = JSON.stringify(st);
      if (raw.toLowerCase().includes(needleLower)) {
        const rel = pack.toRelativeMs(st.capturedAtEpochMs);
        const snippets = makeSnippets(raw, needleLower, radius, 2);
        for (const snippet of snippets) {
          hits.push({
            scope: "framework",
            ref: `frameworkState#${idx}`,
            relativeMs: rel,
            snippet: `${formatRelativeTime(rel)} [trigger=${st.trigger ?? "?"}] ${snippet}`,
          });
        }
      }
    });
  }

  return {
    query: needle,
    totalHits: hits.length,
    hits: hits.slice(0, limit),
  };
}
