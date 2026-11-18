import { applyCharBudget } from "../format/budget.ts";
import {
  diffJsonValues,
  diffTextLines,
  formatDiffValueInline,
} from "../format/json-diff.ts";
import { formatRelativeTime } from "../format/time.ts";
import { openPack } from "../pack/open.ts";
import type { LoadedSessionPack } from "../pack/session-pack.ts";
import type { NetworkEntry } from "../pack/types.ts";
import { evaluateJsonPath } from "../query/json-path.ts";
import { findNetworkEntry } from "../query/network.ts";
import { resolveNetworkRequestBody } from "./get-request.ts";

export type CompareRequestPart = "response" | "request" | "headers" | "both";

function parseJsonIfPossible(raw: string | undefined): {
  isJson: boolean;
  value?: unknown;
  raw?: string;
} {
  if (raw === undefined) return { isJson: false, raw: undefined };
  const trimmed = raw.trim();
  if (!trimmed) return { isJson: false, raw };
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return { isJson: true, value: JSON.parse(trimmed), raw };
    } catch {
      return { isJson: false, raw };
    }
  }
  return { isJson: false, raw };
}

function extractSectionPayload(
  pack: LoadedSessionPack,
  entry: NetworkEntry,
  section: "request" | "response" | "headers",
  jsonPath?: string
): { isJson: boolean; value?: unknown; raw?: string } {
  const details = pack.getNetworkDetails()[entry.id];
  if (section === "headers") {
    return {
      isJson: true,
      value: {
        requestHeaders: details?.requestHeaders ?? entry.request?.headers ?? {},
        responseHeaders:
          details?.responseHeaders ?? entry.response?.headers ?? {},
      },
    };
  }
  const raw =
    section === "request"
      ? resolveNetworkRequestBody(
          entry as unknown as Record<string, unknown>,
          details as unknown as Record<string, unknown>,
          pack
        )
      : pack.getNetworkBody(entry);
  const parsed = parseJsonIfPossible(raw);
  if (jsonPath && parsed.isJson) {
    return {
      isJson: true,
      value: evaluateJsonPath(parsed.value, jsonPath),
    };
  }
  return parsed;
}

export function runCompareRequestsTool(args: {
  pack?: string;
  left: string;
  right: string;
  part?: CompareRequestPart;
  jsonPath?: string;
  ignoreKeys?: string[];
  maxDiffs?: number;
  format?: "text" | "json";
  maxChars?: number;
}): string {
  const loaded = openPack(args.pack);
  if (loaded.kind !== "session") {
    throw new Error(
      `UNSUPPORTED_PACK_KIND: compare_requests requires a session evidence pack, but "${args.pack}" is a screenshot pack.`
    );
  }

  const leftEntry = findNetworkEntry(loaded, args.left);
  const rightEntry = findNetworkEntry(loaded, args.right);
  const part: CompareRequestPart = args.part ?? "response";
  const ignoreKeys = new Set(args.ignoreKeys ?? []);
  const maxDiffs = Math.max(1, args.maxDiffs ?? 80);

  const sections: Array<"request" | "response" | "headers"> =
    part === "both" ? ["request", "response", "headers"] : [part];

  const sectionResults = sections.map((sec) => {
    const leftData = extractSectionPayload(
      loaded,
      leftEntry,
      sec,
      args.jsonPath
    );
    const rightData = extractSectionPayload(
      loaded,
      rightEntry,
      sec,
      args.jsonPath
    );

    if (
      leftData.raw === undefined &&
      !leftData.isJson &&
      rightData.raw === undefined &&
      !rightData.isJson
    ) {
      return {
        section: sec,
        mode: "empty" as const,
        identical: true,
        changes: [],
        totalChanges: 0,
        truncated: false,
      };
    }

    if (leftData.isJson && rightData.isJson) {
      const diff = diffJsonValues(leftData.value, rightData.value, {
        ignoreKeys,
        maxDiffs,
      });
      return {
        section: sec,
        mode: "json" as const,
        identical: diff.totalChanges === 0,
        changes: diff.changes,
        totalChanges: diff.totalChanges,
        truncated: diff.truncated,
      };
    }

    const lineDiff = diffTextLines(
      leftData.raw ??
        (leftData.isJson ? JSON.stringify(leftData.value, null, 2) : ""),
      rightData.raw ??
        (rightData.isJson ? JSON.stringify(rightData.value, null, 2) : ""),
      maxDiffs
    );
    return {
      section: sec,
      mode: "text" as const,
      identical: lineDiff.totalHunks === 0,
      hunks: lineDiff.hunks,
      totalChanges: lineDiff.totalHunks,
      truncated: lineDiff.truncated,
    };
  });

  if (args.format === "json") {
    return applyCharBudget(
      JSON.stringify(
        {
          left: {
            id: leftEntry.id,
            method: leftEntry.method ?? "GET",
            status: leftEntry.status ?? 0,
            relativeMs: loaded.toRelativeMs(leftEntry.createdAt),
            url: leftEntry.url,
          },
          right: {
            id: rightEntry.id,
            method: rightEntry.method ?? "GET",
            status: rightEntry.status ?? 0,
            relativeMs: loaded.toRelativeMs(rightEntry.createdAt),
            url: rightEntry.url,
          },
          part,
          ...(args.jsonPath ? { jsonPath: args.jsonPath } : {}),
          sections: sectionResults,
        },
        null,
        2
      ),
      args.maxChars
    );
  }

  const lines: string[] = [];
  lines.push(
    `# Request Diff (\`${leftEntry.id}\` vs \`${rightEntry.id}\`, part=\`${part}\`${args.jsonPath ? `, jsonPath=\`${args.jsonPath}\`` : ""})`
  );
  lines.push(
    `- **Left**: ${leftEntry.method ?? "GET"} ${leftEntry.status ?? 0} (${formatRelativeTime(loaded.toRelativeMs(leftEntry.createdAt))}) | ${leftEntry.url}`
  );
  lines.push(
    `- **Right**: ${rightEntry.method ?? "GET"} ${rightEntry.status ?? 0} (${formatRelativeTime(loaded.toRelativeMs(rightEntry.createdAt))}) | ${rightEntry.url}`
  );

  for (const res of sectionResults) {
    lines.push(
      `\n## Section: ${res.section} (${res.mode}, ${res.totalChanges} difference(s))`
    );
    if (res.mode === "empty") {
      lines.push(`(No ${res.section} payload captured on either request)`);
      continue;
    }
    if (res.identical) {
      lines.push(`(Identical ${res.section} content)`);
      continue;
    }
    if (res.mode === "json") {
      lines.push(`| Kind | Path | Left | Right |`);
      lines.push(`| --- | --- | --- | --- |`);
      for (const c of res.changes) {
        const lStr = c.kind === "added" ? "—" : formatDiffValueInline(c.left);
        const rStr =
          c.kind === "removed" ? "—" : formatDiffValueInline(c.right);
        lines.push(`| ${c.kind} | \`${c.path}\` | \`${lStr}\` | \`${rStr}\` |`);
      }
    } else {
      for (const h of res.hunks) {
        const prefix =
          h.kind === "removed"
            ? `- [L${h.lineNumberLeft}]`
            : `+ [R${h.lineNumberRight}]`;
        lines.push(`${prefix} ${h.text}`);
      }
    }
    if (res.truncated) {
      lines.push(
        `\n… (${res.totalChanges - (res.mode === "json" ? res.changes.length : res.hunks.length)} more differences omitted; pass a narrower \`--jsonPath\` or higher \`--maxDiffs\`)`
      );
    }
  }

  return applyCharBudget(lines.join("\n"), args.maxChars);
}
