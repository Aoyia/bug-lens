import { applyCharBudget } from "../format/budget.ts";
import { openPack } from "../pack/open.ts";
import {
  formatNetworkRow,
  queryNetwork,
  type NetworkStatusFilter,
} from "../query/network.ts";

export function runQueryNetworkTool(args: {
  pack?: string;
  status?: NetworkStatusFilter;
  urlContains?: string;
  method?: string;
  type?: string;
  offset?: number;
  limit?: number;
  format?: "text" | "json";
  maxChars?: number;
}): string {
  const loaded = openPack(args.pack);
  if (loaded.kind === "screenshot") {
    const rawReqs = loaded.environment?.recentFailedRequests ?? [];
    const urlNeedle = args.urlContains?.toLowerCase();
    const methodUpper = args.method?.toUpperCase();
    const matched = rawReqs.filter((r) => {
      if (urlNeedle && !(r.url ?? "").toLowerCase().includes(urlNeedle)) {
        return false;
      }
      if (methodUpper && (r.method ?? "GET").toUpperCase() !== methodUpper) {
        return false;
      }
      return true;
    });
    if (args.format === "json") {
      return applyCharBudget(
        JSON.stringify(
          {
            totalEntries: rawReqs.length,
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
      `# Screenshot Pack Failed Network Requests (${matched.length} of ${rawReqs.length})`,
      ...matched.map(
        (r, idx) =>
          `- [#${idx}] ${r.method ?? "GET"} !${r.status ?? 0} ${r.statusText ?? ""} | ${r.url ?? ""}`
      ),
    ];
    return applyCharBudget(lines.join("\n"), args.maxChars);
  }

  const res = queryNetwork(loaded, {
    status: args.status,
    urlContains: args.urlContains,
    method: args.method,
    type: args.type,
    offset: args.offset,
    limit: args.limit,
  });

  if (args.format === "json") {
    return applyCharBudget(JSON.stringify(res, null, 2), args.maxChars);
  }

  const lines: string[] = [];
  lines.push(
    `# Network Requests (matched ${res.matchedCount} of ${res.totalEntries} total, showing offset=${res.offset}..${res.offset + res.items.length})`
  );
  if (res.items.length === 0) {
    lines.push(`(No network requests matched the given filters)`);
  } else {
    for (const row of res.items) {
      lines.push(`- ${formatNetworkRow(row)}`);
    }
  }
  const remaining = res.matchedCount - (res.offset + res.items.length);
  if (remaining > 0) {
    lines.push(
      `\n… ${remaining} more requests available. Use offset=${res.offset + res.items.length} to continue, or call get_request(id) to inspect a specific request.`
    );
  }

  return applyCharBudget(lines.join("\n"), args.maxChars);
}
