export const TEXT_ANNOTATION_FONT_SIZE = 13;
export const TEXT_ANNOTATION_FONT_WEIGHT = 400;
export const TEXT_ANNOTATION_FONT_FAMILY =
  "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif";
/** 保持既有字符串值不变（向后兼容），供 canvas ctx.font 直接使用 */
export const TEXT_ANNOTATION_FONT = `${TEXT_ANNOTATION_FONT_SIZE}px ${TEXT_ANNOTATION_FONT_FAMILY}`;
export const TEXT_MIN_WIDTH = 80;
export const TEXT_MAX_WIDTH = 320;
export const TEXT_PADDING_X = 10;
export const TEXT_PADDING_Y = 6;
export const TEXT_LINE_HEIGHT = 18;
export const TEXT_CORNER_RADIUS = 6;

/** CJK/全角字符的估算宽度（px），13px 字体下实测约 13px */
const CJK_CHAR_WIDTH = 13;
/** 其余字符（ASCII 字母/数字/空格）的估算宽度（px），13px 字体下实测约 6.7px */
const DEFAULT_CHAR_WIDTH = 6.7;

function isCJKChar(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return (
    (code >= 0x2e80 && code <= 0x9fff) || // CJK 部首 + 统一表意文字
    (code >= 0xf900 && code <= 0xfaff) || // 兼容表意文字
    (code >= 0xff00 && code <= 0xffef) // 全角形式
  );
}

/**
 * 估算一段文本的渲染宽度（px）。
 * 无 2D ctx 环境（node 单测）与命中检测共用：比旧 `length * 12` 精确一个量级，
 * 中文/英文混排的换行与气泡尺寸更贴近浏览器实测，偏差由命中容差 ±4px 吸收。
 */
export function estimateTextWidth(str: string): number {
  let w = 0;
  for (const ch of str) {
    w += isCJKChar(ch) ? CJK_CHAR_WIDTH : DEFAULT_CHAR_WIDTH;
  }
  return w;
}

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
  const measureWidth = measure ?? estimateTextWidth;
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
      const w = measureWidth(test);
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
    const w = measureWidth(l);
    if (w > maxW) maxW = w;
  }

  const bgWidth = Math.max(
    TEXT_MIN_WIDTH,
    Math.min(maxWidth, maxW + TEXT_PADDING_X * 2)
  );
  const bgHeight = TEXT_PADDING_Y * 2 + lines.length * TEXT_LINE_HEIGHT;

  return { lines, bgWidth, bgHeight };
}
