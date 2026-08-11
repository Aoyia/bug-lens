export const TEXT_ANNOTATION_FONT =
  "13px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif";
export const TEXT_MIN_WIDTH = 80;
export const TEXT_MAX_WIDTH = 320;
export const TEXT_PADDING_X = 10;
export const TEXT_PADDING_Y = 6;
export const TEXT_LINE_HEIGHT = 18;
export const TEXT_CORNER_RADIUS = 6;

export interface TextLayoutOptions {
  measure?: (str: string) => number;
  maxWidth?: number;
}

export interface TextLayoutResult {
  lines: string[];
  bgWidth: number;
  bgHeight: number;
}

export function computeTextLayout(
  text: string,
  options: TextLayoutOptions = {}
): TextLayoutResult {
  const { measure, maxWidth = TEXT_MAX_WIDTH } = options;
  const paragraphList = text.split("\n");
  const lines: string[] = [];

  for (const p of paragraphList) {
    if (!p) {
      lines.push("");
      continue;
    }
    let cur = "";
    for (const ch of p) {
      const test = cur + ch;
      const w = measure ? measure(test) : test.length * 12;
      if (w > maxWidth && cur) {
        lines.push(cur);
        cur = ch;
      } else {
        cur = test;
      }
    }
    if (cur) lines.push(cur);
  }

  let maxW = 0;
  for (const l of lines) {
    const w = measure ? measure(l) : l.length * 12;
    if (w > maxW) maxW = w;
  }

  const bgWidth = Math.max(
    TEXT_MIN_WIDTH,
    Math.min(maxWidth, maxW + TEXT_PADDING_X * 2)
  );
  const bgHeight = TEXT_PADDING_Y * 2 + lines.length * TEXT_LINE_HEIGHT;

  return { lines, bgWidth, bgHeight };
}
