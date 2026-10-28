import { applyCharBudget } from "../format/budget.ts";
import { openPack } from "../pack/open.ts";
import { formatConsoleItem, queryConsole } from "../query/console.ts";

export function runQueryConsoleTool(args: {
  pack: string;
  levels?: string[];
  search?: string;
  regex?: string;
  fromMs?: number;
  toMs?: number;
  offset?: number;
  limit?: number;
  format?: "text" | "json";
  maxChars?: number;
}): string {
  const loaded = openPack(args.pack);
  if (loaded.kind === "screenshot") {
    const rawErrors = loaded.environment?.recentConsoleErrors ?? [];
    const searchLower = args.search?.toLowerCase();
    const regexObj = args.regex ? new RegExp(args.regex, "i") : undefined;
    const matched = rawErrors.filter((e) => {
      const hay = `${e.message ?? ""}\n${e.stack ?? ""}`;
      if (searchLower && !hay.toLowerCase().includes(searchLower)) return false;
      if (regexObj && !regexObj.test(hay)) return false;
      return true;
    });
    if (args.format === "json") {
      return applyCharBudget(
        JSON.stringify(
          {
            totalEntries: rawErrors.length,
            matchedCount: matched.length,
            items: matched,
          },
          null,
          2
        ),
        args.maxChars
      );
    }
    const lines = [
      `# Screenshot Pack Console Errors (${matched.length} of ${rawErrors.length})`,
      ...matched.map(
        (e, idx) =>
          `[#${idx}] [ERROR] ${e.message ?? ""}${e.stack ? `\n    ${e.stack.split("\n").slice(0, 4).join("\n    ")}` : ""}`
      ),
    ];
    return applyCharBudget(lines.join("\n"), args.maxChars);
  }

  const res = queryConsole(loaded, {
    levels: args.levels,
    search: args.search,
    regex: args.regex,
    fromMs: args.fromMs,
    toMs: args.toMs,
    offset: args.offset,
    limit: args.limit,
  });

  if (args.format === "json") {
    return applyCharBudget(JSON.stringify(res, null, 2), args.maxChars);
  }

  const lines: string[] = [];
  lines.push(
    `# Console Logs (matched ${res.matchedCount} of ${res.totalEntries} total, showing offset=${res.offset}..${res.offset + res.items.length})`
  );
  if (res.items.length === 0) {
    lines.push(`(No console entries matched the given filters)`);
  } else {
    for (const item of res.items) {
      lines.push(formatConsoleItem(item));
    }
  }
  const remaining = res.matchedCount - (res.offset + res.items.length);
  if (remaining > 0) {
    lines.push(
      `\n… ${remaining} more entries available. Use offset=${res.offset + res.items.length} to continue.`
    );
  }

  return applyCharBudget(lines.join("\n"), args.maxChars);
}
