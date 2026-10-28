import { applyCharBudget } from "../format/budget.ts";
import { openPack } from "../pack/open.ts";
import { searchSessionPack, type SearchScope } from "../query/search.ts";

export function runSearchPackTool(args: {
  pack: string;
  query: string;
  scopes?: SearchScope[];
  limit?: number;
  contextChars?: number;
  format?: "text" | "json";
  maxChars?: number;
}): string {
  const loaded = openPack(args.pack);
  const radius = Math.min(2000, Math.max(40, args.contextChars ?? 180));

  if (loaded.kind === "screenshot") {
    const needle = args.query.trim().toLowerCase();
    const hits: Array<{ file: string; snippet: string }> = [];
    for (const fileInfo of loaded.listFiles()) {
      if (fileInfo.path.endsWith(".json") || fileInfo.path.endsWith(".md")) {
        const text = loaded.getTextFile(fileInfo.path) ?? "";
        const idx = text.toLowerCase().indexOf(needle);
        if (idx >= 0) {
          const start = Math.max(0, idx - radius);
          const end = Math.min(text.length, idx + needle.length + radius);
          hits.push({
            file: fileInfo.path,
            snippet: text.slice(start, end).replace(/\s+/g, " ").trim(),
          });
        }
      }
    }
    if (args.format === "json") {
      return applyCharBudget(
        JSON.stringify(
          { query: args.query, totalHits: hits.length, hits },
          null,
          2
        ),
        args.maxChars
      );
    }
    const lines = [
      `# Search Results in Screenshot Pack for "${args.query}" (${hits.length} files matched)`,
      ...hits.map((h) => `- **[${h.file}]**: ${h.snippet}`),
    ];
    return applyCharBudget(lines.join("\n"), args.maxChars);
  }

  const res = searchSessionPack(loaded, {
    query: args.query,
    scopes: args.scopes,
    limit: args.limit,
    contextChars: args.contextChars,
  });

  if (args.format === "json") {
    return applyCharBudget(JSON.stringify(res, null, 2), args.maxChars);
  }

  const lines: string[] = [];
  lines.push(
    `# Search Hits for "${res.query}" (showing ${res.hits.length} of ${res.totalHits} total hits)`
  );
  if (res.hits.length === 0) {
    lines.push(`(No matches found across requested scopes)`);
  } else {
    for (const hit of res.hits) {
      lines.push(`- **[${hit.scope}]** \`${hit.ref}\` — ${hit.snippet}`);
    }
  }
  return applyCharBudget(lines.join("\n"), args.maxChars);
}
