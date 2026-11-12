import { applyCharBudget } from "../format/budget.ts";
import { formatDuration, formatRelativeTime } from "../format/time.ts";
import { getPackWorkspaceDir, openPack } from "../pack/open.ts";
import { inspectNetworkRequest } from "../query/network.ts";

export function runGetRequestTool(args: {
  pack?: string;
  id: string;
  include?: Array<"summary" | "headers" | "initiator" | "body">;
  jsonPath?: string;
  bodyMaxChars?: number;
  format?: "text" | "json";
  maxChars?: number;
}): string {
  const loaded = openPack(args.pack);
  if (loaded.kind !== "session") {
    throw new Error(
      `UNSUPPORTED_PACK_KIND: get_request requires a session evidence pack, but "${args.pack}" is a screenshot pack.`
    );
  }

  const res = inspectNetworkRequest(loaded, args.id, {
    include: args.include,
    jsonPath: args.jsonPath,
    bodyMaxChars: args.bodyMaxChars,
  });

  if (args.format === "json") {
    return applyCharBudget(JSON.stringify(res, null, 2), args.maxChars);
  }

  const { entry, details } = res;
  const workspaceDir = getPackWorkspaceDir(loaded);
  const fullBodyPath =
    workspaceDir && entry.response?.bodyPath
      ? `${workspaceDir}/${entry.response.bodyPath}`
      : undefined;
  const includeSet = new Set(
    args.include && args.include.length > 0
      ? args.include
      : ["summary", "headers", "initiator", "body"]
  );

  const lines: string[] = [];
  if (includeSet.has("summary")) {
    lines.push(
      `# Request \`${entry.id}\` (${entry.method ?? "GET"} ${entry.status ?? 0})`
    );
    lines.push(`- **URL**: ${entry.url}`);
    lines.push(
      `- **Time**: ${formatRelativeTime(res.relativeMs)} | Duration: ${formatDuration(entry.durationMs)} | Type: ${entry.type ?? "—"}`
    );
    lines.push(
      `- **Response Info**: mimeType=${entry.response?.mimeType ?? "—"}, bodyStatus=${entry.response?.bodyStatus ?? "—"}, byteLength=${entry.response?.byteLength ?? "—"}, bodyPath=${fullBodyPath ? `\`${fullBodyPath}\`` : (entry.response?.bodyPath ?? "inline/none")}`
    );
    if (entry.errorText) {
      lines.push(`- **Error**: ${entry.errorText}`);
    }
  }

  if (includeSet.has("headers")) {
    const reqHeaders = details?.requestHeaders ?? entry.request?.headers;
    const resHeaders = details?.responseHeaders ?? entry.response?.headers;
    if (reqHeaders && Object.keys(reqHeaders).length > 0) {
      lines.push(`\n## Request Headers`);
      lines.push(JSON.stringify(reqHeaders, null, 2));
    }
    if (resHeaders && Object.keys(resHeaders).length > 0) {
      lines.push(`\n## Response Headers`);
      lines.push(JSON.stringify(resHeaders, null, 2));
    }
    const reqBody =
      details?.requestBody ??
      details?.postData ??
      entry.request?.postData ??
      entry.request?.body;
    if (reqBody) {
      lines.push(`\n## Request Body`);
      lines.push(reqBody.slice(0, 4000));
    }
  }

  if (includeSet.has("initiator") && details?.initiator) {
    lines.push(`\n## Initiator`);
    lines.push(JSON.stringify(details.initiator, null, 2).slice(0, 3000));
  }

  if (args.jsonPath !== undefined) {
    lines.push(`\n## Extracted Response Body (jsonPath: \`${args.jsonPath}\`)`);
    lines.push(JSON.stringify(res.extractedJson, null, 2));
  } else if (includeSet.has("body")) {
    lines.push(`\n## Response Body`);
    if (res.bodyText === undefined) {
      lines.push(`(No response body captured for this entry)`);
    } else {
      lines.push(res.bodyText);
      if (res.bodyTruncated) {
        const directHint = fullBodyPath
          ? ` Or query \`${fullBodyPath}\` directly with \`jq\` / \`read_file\`.`
          : workspaceDir
            ? ` Or query \`${workspaceDir}/data/session-data.json\` directly with \`jq\`.`
            : "";
        lines.push(
          `\n… [Response body truncated at ${args.bodyMaxChars ?? 8000} chars. Pass \`jsonPath\` (e.g. "data.definition.form.elements[id=ssd_a]") or a higher \`bodyMaxChars\` to inspect further.${directHint}]`
        );
      }
    }
  }

  return applyCharBudget(lines.join("\n"), args.maxChars);
}
