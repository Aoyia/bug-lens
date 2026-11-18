import { applyCharBudget } from "../format/budget.ts";
import { buildJsonOutline } from "../format/json-diff.ts";
import { formatDuration, formatRelativeTime } from "../format/time.ts";
import { getPackWorkspaceDir, openPack } from "../pack/open.ts";
import type { LoadedSessionPack } from "../pack/session-pack.ts";
import { inspectNetworkRequest } from "../query/network.ts";

export function extractBodyString(val: unknown): string | undefined {
  if (typeof val === "string") {
    return val.length > 0 ? val : undefined;
  }
  if (val && typeof val === "object") {
    if (
      "text" in val &&
      typeof (val as Record<string, unknown>).text === "string"
    ) {
      const textVal = (val as Record<string, unknown>).text as string;
      return textVal.length > 0 ? textVal : undefined;
    }
    try {
      const s = JSON.stringify(val);
      if (s && s !== "{}" && s !== "[]") return s;
    } catch {
      // ignore
    }
  }
  return undefined;
}

/**
 * 提取网络条目的请求体字符串，建立覆盖所有采集协议版本的寻址链路
 */
export function resolveNetworkRequestBody(
  entry: Record<string, unknown>,
  details?: Record<string, unknown>,
  pack?: Pick<LoadedSessionPack, "resolveBlobTextByHash">
): string | undefined {
  const reqObj = entry?.request as Record<string, unknown> | undefined;
  const inlineOrDetail =
    extractBodyString(details?.requestBody) ??
    extractBodyString(details?.postData) ??
    extractBodyString(entry?.requestBody) ??
    extractBodyString(entry?.postData) ??
    extractBodyString(reqObj?.postData) ??
    extractBodyString(reqObj?.body);
  if (inlineOrDetail !== undefined) return inlineOrDetail;

  if (!pack) return undefined;
  const reqHash =
    typeof reqObj?.bodyHash === "string" ? reqObj.bodyHash : undefined;
  const detailReqBlob = details?.requestBodyBlob as
    { hash?: string; path?: string } | undefined;
  return pack.resolveBlobTextByHash(
    reqHash ?? detailReqBlob?.hash,
    detailReqBlob?.path
  );
}

/**
 * 格式化请求体输出，针对 JSON 与普通字符串提供自适应排版与长度保护
 */
export function formatRequestBodySnippet(
  rawBody: string,
  maxChars = 4000
): string {
  const trimmed = rawBody.trim();
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      const parsed = JSON.parse(trimmed);
      const pretty = JSON.stringify(parsed, null, 2);
      if (pretty.length <= maxChars) return pretty;
      return (
        pretty.slice(0, maxChars) +
        `\n… [JSON request body truncated at ${maxChars} chars]`
      );
    } catch {
      // fallback to raw string formatting below
    }
  }
  if (rawBody.length > maxChars) {
    return (
      rawBody.slice(0, maxChars) +
      `\n… [Request body truncated at ${maxChars} chars]`
    );
  }
  return rawBody;
}

export function runGetRequestTool(args: {
  pack?: string;
  id: string;
  include?: Array<"summary" | "headers" | "initiator" | "body">;
  jsonPath?: string;
  bodyMaxChars?: number;
  outline?: boolean;
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
    const resolvedRequestBody = resolveNetworkRequestBody(
      res.entry as unknown as Record<string, unknown>,
      res.details as unknown as Record<string, unknown>,
      loaded
    );
    const enrichedRes = {
      ...res,
      resolvedRequestBody,
    };
    return applyCharBudget(JSON.stringify(enrichedRes, null, 2), args.maxChars);
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
  }

  const shouldIncludeReqBody =
    includeSet.has("body") || includeSet.has("headers");
  if (shouldIncludeReqBody) {
    const rawReqBody = resolveNetworkRequestBody(
      entry as unknown as Record<string, unknown>,
      details as unknown as Record<string, unknown>,
      loaded
    );
    if (rawReqBody !== undefined) {
      lines.push(`\n## Request Body`);
      lines.push(formatRequestBodySnippet(rawReqBody, 4000));
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
    } else if (args.outline) {
      const rawFull = loaded.getNetworkBody(entry) ?? res.bodyText;
      try {
        const parsed = JSON.parse(rawFull);
        const { outline, suggestedJsonPaths } = buildJsonOutline(parsed);
        lines.push(`\`\`\`json\n${JSON.stringify(outline, null, 2)}\n\`\`\``);
        if (suggestedJsonPaths.length > 0) {
          lines.push(
            `- **Suggested jsonPath queries**: ${suggestedJsonPaths.map((p) => `\`${p}\``).join(", ")}`
          );
        }
      } catch {
        lines.push(res.bodyText);
      }
    } else {
      lines.push(res.bodyText);
      if (res.bodyTruncated) {
        let jsonPathExample = "data";
        try {
          const rawFull = loaded.getNetworkBody(entry);
          if (rawFull) {
            const parsed = JSON.parse(rawFull);
            const { outline, suggestedJsonPaths } = buildJsonOutline(parsed, {
              maxDepth: 2,
              maxKeysPerLevel: 10,
            });
            if (suggestedJsonPaths.length > 0) {
              jsonPathExample = suggestedJsonPaths[0]!;
            }
            lines.push(
              `\n### Response JSON Outline (auto-generated for truncated payload)`
            );
            lines.push(
              `\`\`\`json\n${JSON.stringify(outline, null, 2)}\n\`\`\``
            );
          }
        } catch {
          // 非 JSON 响应跳过大纲
        }
        const blobHint =
          !fullBodyPath && workspaceDir && entry.response?.bodyHash
            ? `${workspaceDir}/network/blobs/${entry.response.bodyHash.replace(/^sha256:/i, "").slice(0, 16)}.bin`
            : undefined;
        const directTarget =
          fullBodyPath ??
          blobHint ??
          (workspaceDir
            ? `${workspaceDir}/${loaded.files.has("session-data.json") ? "session-data.json" : "data/session-data.json"}`
            : undefined);
        const directHint = directTarget
          ? ` Or query \`${directTarget}\` directly with \`jq\` / \`read_file\`.`
          : "";
        lines.push(
          `\n… [Response body truncated at ${args.bodyMaxChars ?? 8000} chars. Pass \`jsonPath\` (e.g. "${jsonPathExample}") or a higher \`bodyMaxChars\` to inspect further.${directHint}]`
        );
      }
    }
  }

  return applyCharBudget(lines.join("\n"), args.maxChars);
}
