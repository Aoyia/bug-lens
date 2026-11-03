import { applyCharBudget, DEFAULT_MAX_CHARS } from "../format/budget.ts";
import { parseWindowAssignmentJson } from "../pack/js-json.ts";
import { openPack } from "../pack/open.ts";
import { evaluateJsonPath } from "../query/json-path.ts";

export function runReadPackFileTool(args: {
  pack?: string;
  path: string;
  jsonPath?: string;
  offset?: number;
  maxChars?: number;
}): string {
  const loaded = openPack(args.pack);
  const cleanPath = args.path.replace(/^\.?\//, "");
  const rawText = loaded.getTextFile(cleanPath);

  if (rawText === undefined) {
    const available = loaded
      .listFiles()
      .map((f) => f.path)
      .slice(0, 30)
      .join(", ");
    throw new Error(
      `FILE_NOT_FOUND_IN_PACK: "${cleanPath}" does not exist in pack. Available files sample: [${available}]`
    );
  }

  if (args.jsonPath) {
    let parsed: unknown;
    if (cleanPath.endsWith(".js")) {
      parsed = parseWindowAssignmentJson(rawText, cleanPath);
    } else {
      try {
        parsed = JSON.parse(rawText);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `INVALID_JSON_FILE: Cannot apply jsonPath "${args.jsonPath}" to "${cleanPath}": ${msg}`
        );
      }
    }
    const extracted = evaluateJsonPath(parsed, args.jsonPath);
    return applyCharBudget(
      JSON.stringify(extracted, null, 2),
      args.maxChars ?? DEFAULT_MAX_CHARS
    );
  }

  const startOffset = Math.max(0, args.offset ?? 0);
  const maxChars = args.maxChars ?? DEFAULT_MAX_CHARS;
  const sliced = rawText.slice(startOffset);
  const nextOffset = startOffset + maxChars;

  return applyCharBudget(
    sliced,
    maxChars,
    rawText.length > nextOffset
      ? `Use offset=${nextOffset} to read the next chunk (total ${rawText.length} chars).`
      : undefined
  );
}
