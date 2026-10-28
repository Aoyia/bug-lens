export const DEFAULT_MAX_CHARS = 24000;

export function applyCharBudget(
  text: string,
  maxChars: number = DEFAULT_MAX_CHARS,
  continuationHint?: string
): string {
  const effectiveMax =
    typeof maxChars === "number" && maxChars > 200
      ? Math.floor(maxChars)
      : DEFAULT_MAX_CHARS;
  if (text.length <= effectiveMax) return text;

  const hint = continuationHint
    ? ` ${continuationHint}`
    : " Pass a larger maxChars or narrower filter/jsonPath to inspect further.";
  const footer = `\n\n… [Truncated to ${effectiveMax} chars (original ${text.length} chars).${hint}]`;
  const sliceLen = Math.max(100, effectiveMax - footer.length);
  const slice = text.slice(0, sliceLen);
  const lastNewline = slice.lastIndexOf("\n");
  const cut = lastNewline > sliceLen * 0.75 ? lastNewline : sliceLen;
  return slice.slice(0, cut).trimEnd() + footer;
}
