import { applyCharBudget } from "../format/budget.ts";
import { openPack } from "../pack/open.ts";
import { queryTimeline, type TimelineEventKind } from "../query/timeline.ts";

export function runTimelineTool(args: {
  pack?: string;
  aroundSceneId?: string;
  fromMs?: number;
  toMs?: number;
  windowMs?: number;
  kinds?: TimelineEventKind[];
  includeAllConsole?: boolean;
  includeAllNetwork?: boolean;
  limit?: number;
  format?: "text" | "json";
  maxChars?: number;
}): string {
  const loaded = openPack(args.pack);
  if (loaded.kind !== "session") {
    throw new Error(
      `UNSUPPORTED_PACK_KIND: timeline requires a session evidence pack, but "${args.pack}" is a screenshot pack.`
    );
  }

  const result = queryTimeline(loaded, {
    aroundSceneId: args.aroundSceneId,
    fromMs: args.fromMs,
    toMs: args.toMs,
    windowMs: args.windowMs,
    kinds: args.kinds,
    includeAllConsole: args.includeAllConsole,
    includeAllNetwork: args.includeAllNetwork,
    limit: args.limit,
  });

  if (args.format === "json") {
    return applyCharBudget(JSON.stringify(result, null, 2), args.maxChars);
  }

  const lines: string[] = [];
  lines.push(
    `# Unified Timeline (${result.windowDescription}) — showing ${result.events.length} of ${result.totalMatched} events`
  );
  if (result.events.length === 0) {
    lines.push(`(No events matched the specified time window and filters)`);
  } else {
    for (const ev of result.events) {
      lines.push(`- ${ev.summary}`);
    }
  }
  if (result.totalMatched > result.events.length) {
    lines.push(
      `\n… ${result.totalMatched - result.events.length} more events omitted. Pass a higher \`limit\` or narrow \`fromMs\`/\`toMs\`.`
    );
  }

  return applyCharBudget(lines.join("\n"), args.maxChars);
}
