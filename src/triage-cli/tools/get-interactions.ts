import { applyCharBudget } from "../format/budget.ts";
import { formatInteractionLine } from "../format/element.ts";
import { openPack } from "../pack/open.ts";
import {
  buildImageContentBlocks,
  type McpContentBlock,
} from "./image-helper.ts";

export function runGetInteractionsTool(args: {
  pack?: string;
  fromIndex?: number;
  limit?: number;
  kinds?: string[];
  includeScreenshot?: boolean;
  format?: "text" | "json";
  maxChars?: number;
}): McpContentBlock[] {
  const loaded = openPack(args.pack);
  if (loaded.kind !== "session") {
    throw new Error(
      `UNSUPPORTED_PACK_KIND: get_interactions requires a session evidence pack, but "${args.pack}" is a screenshot pack.`
    );
  }

  const all = loaded.getInteractions();
  const kindSet =
    args.kinds && args.kinds.length > 0
      ? new Set(args.kinds.map((k) => k.toLowerCase()))
      : undefined;

  const indexed = all
    .map((item, index) => ({
      index,
      relativeMs: loaded.toRelativeMs(item.createdAt) ?? item.elapsedMs,
      item,
    }))
    .filter(({ index, item }) => {
      if (args.fromIndex !== undefined && index < args.fromIndex) return false;
      if (kindSet && !kindSet.has((item.kind ?? "").toLowerCase()))
        return false;
      return true;
    });

  const limit = Math.max(1, args.limit ?? 60);
  const sliced = indexed.slice(0, limit);

  let textOut: string;
  if (args.format === "json") {
    textOut = applyCharBudget(
      JSON.stringify(
        {
          totalInteractions: all.length,
          matchedCount: indexed.length,
          items: sliced,
        },
        null,
        2
      ),
      args.maxChars
    );
  } else {
    const lines: string[] = [];
    lines.push(
      `# Recorded Interactions (showing ${sliced.length} of ${indexed.length} matched, total=${all.length})`
    );
    if (sliced.length === 0) {
      lines.push(`(No interactions matched)`);
    } else {
      for (const { index, relativeMs, item } of sliced) {
        lines.push(`- ${formatInteractionLine(item, index, relativeMs)}`);
      }
    }
    if (indexed.length > sliced.length) {
      const nextIdx = (sliced[sliced.length - 1]?.index ?? 0) + 1;
      lines.push(
        `\n… ${indexed.length - sliced.length} more interactions available. Pass fromIndex=${nextIdx} to continue.`
      );
    }
    textOut = applyCharBudget(lines.join("\n"), args.maxChars);
  }

  const blocks: McpContentBlock[] = [{ type: "text", text: textOut }];
  if (args.includeScreenshot) {
    for (const { index, item } of sliced.slice(0, 3)) {
      const imgPath =
        item.screenshot?.dataUrl && !item.screenshot.dataUrl.startsWith("data:")
          ? item.screenshot.dataUrl
          : undefined;
      if (imgPath) {
        blocks.push(
          ...buildImageContentBlocks(
            loaded,
            imgPath,
            `Interaction [${index}] screenshot`
          )
        );
      }
    }
  }
  return blocks;
}
