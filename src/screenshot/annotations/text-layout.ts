export const TEXT_ANNOTATION_FONT_SIZE = 13;
export const TEXT_ANNOTATION_FONT_WEIGHT = 600;
export const TEXT_ANNOTATION_FONT_FAMILY =
  "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif";
/** 保持既有字符串值兼容，供 canvas ctx.font 直接使用 */
export const TEXT_ANNOTATION_FONT = `${TEXT_ANNOTATION_FONT_WEIGHT} ${TEXT_ANNOTATION_FONT_SIZE}px ${TEXT_ANNOTATION_FONT_FAMILY}`;
export const TEXT_MIN_WIDTH = 0;
export const TEXT_MAX_WIDTH = 600;
export const TEXT_PADDING_X = 0;
export const TEXT_PADDING_Y = 0;
export const TEXT_LINE_HEIGHT = 18;
export const TEXT_CORNER_RADIUS = 0;

// ===== 无框双色描边文字（去容器化，保真优先）=====
// 设计决策（第一性原理）：移除实心白底容器，消除对底层缺陷现场的像素遮挡。
// 利用双通道绘制（底层反色外光晕描边 + 顶层字符填充），在纯黑、纯白及复杂底色上均保持 WCAG AA 可读性。
export const TEXT_STROKE_WIDTH = 3.5;
export const TEXT_HALO_LIGHT = "rgba(255, 255, 255, 0.95)";
export const TEXT_HALO_DARK = "rgba(15, 23, 42, 0.88)";
export const TEXT_DEFAULT_COLOR = "#FA5352";

/** 根据文字前景颜色自动匹配反色外描边光晕色 */
export function getTextHaloColor(color?: string): string {
  const c = (color || TEXT_DEFAULT_COLOR).toLowerCase().trim();
  if (
    c === "#ffffff" ||
    c === "#fff" ||
    c === "white" ||
    c === "rgb(255, 255, 255)" ||
    c === "rgba(255, 255, 255, 1)"
  ) {
    return TEXT_HALO_DARK;
  }
  return TEXT_HALO_LIGHT;
}

/** 兼容旧代码引用的气泡容器常量（已废弃实体背景，设为透明） */
export const TEXT_BUBBLE_BACKGROUND = "transparent";
export const TEXT_BUBBLE_STROKE = "transparent";
export const TEXT_BUBBLE_SHADOW_COLOR = "transparent";
export const TEXT_BUBBLE_SHADOW_OFFSET_Y = 0;
export const TEXT_BUBBLE_SHADOW_BLUR = 0;
export const TEXT_PLACEHOLDER_COLOR = "rgba(100, 116, 139, 0.75)";

/**
 * 文字批注可选色板。
 */
export const TEXT_COLOR_PALETTE = [
  "#FA5352", // 红（固定默认）
  "#1f2937", // 黑
  "#9a3412", // 橙
  "#15803d", // 绿
  "#2563eb", // 蓝
  "#7c3aed", // 紫
] as const;

/** 校验色值是否属于文字批注色板（供将来取色器 UI 过滤/标记；渲染层不强制） */
export function isTextPaletteColor(color: string): boolean {
  return (TEXT_COLOR_PALETTE as readonly string[]).includes(color);
}

/** CJK/全角字符的估算宽度（px），13px 字体下实测约 13px */
const CJK_CHAR_WIDTH = 13;
/** ASCII 字母/数字的估算宽度（px），13px 字体下实测约 6.7px */
const DEFAULT_CHAR_WIDTH = 6.7;
/** ASCII 空格的估算宽度（px）：约 3.6px，远小于字母，独立估算让换行更贴近实测 */
const SPACE_CHAR_WIDTH = 3.6;

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
    if (ch === " ") {
      w += SPACE_CHAR_WIDTH;
    } else {
      w += isCJKChar(ch) ? CJK_CHAR_WIDTH : DEFAULT_CHAR_WIDTH;
    }
  }
  return w;
}

export interface TextLayoutOptions {
  measure?: (str: string) => number;
  maxWidth?: number;
}

export interface TextLayoutResult {
  lines: string[];
  width: number;
  height: number;
  bgWidth: number;
  bgHeight: number;
}

/**
 * 浏览器 word-wrap 语义的单段自动换行（不处理 \n，由调用方分段）：
 * - 空格处优先断行（英文按词换行，与 textarea 预览一致）
 * - CJK 字符可在任意位置断行（CJK 无词间空格，逐字断行）
 * - 单个超长词（自身宽度 > maxWidth）才在词内硬切
 * - 行首不保留空格（断行后从词开始），行尾空格剔除
 */
function wrapParagraph(
  p: string,
  maxWidth: number,
  measure: (s: string) => number
): string[] {
  const lines: string[] = [];
  let cur = "";

  const flush = () => {
    if (cur) {
      lines.push(cur.replace(/ +$/, ""));
      cur = "";
    }
  };

  // 分词：空格与 CJK 字符为独立 token（均可作为断行机会），
  // 其余连续串（英文词/数字）为不可断的整体 token。
  const tokens: string[] = [];
  let buf = "";
  const pushBuf = () => {
    if (buf) {
      tokens.push(buf);
      buf = "";
    }
  };
  for (const ch of p) {
    if (ch === " " || isCJKChar(ch)) {
      pushBuf();
      tokens.push(ch);
    } else {
      buf += ch;
    }
  }
  pushBuf();

  for (const tok of tokens) {
    const tokW = measure(tok);
    if (tokW > maxWidth) {
      // 超长 token（无断行机会的长词/长数字串）：先收尾当前行，再在词内硬切
      flush();
      let piece = "";
      for (const ch of tok) {
        const test = piece + ch;
        if (measure(test) > maxWidth && piece) {
          lines.push(piece);
          piece = ch;
        } else {
          piece = test;
        }
      }
      cur = piece;
      continue;
    }
    const test = cur + tok;
    if (measure(test) > maxWidth && cur.trim()) {
      flush();
      cur = tok === " " ? "" : tok; // 行首忽略空格
    } else {
      cur = test;
    }
  }
  flush();
  return lines;
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
      // 手动换行（\n）产生的空行保留：渲染时占一行行高，视觉为空行
      lines.push("");
      continue;
    }
    lines.push(...wrapParagraph(p, maxWidth, measureWidth));
  }

  let maxW = 0;
  for (const l of lines) {
    const w = measureWidth(l);
    if (w > maxW) maxW = w;
  }

  const width = Math.min(maxWidth, maxW);
  const height = lines.length * TEXT_LINE_HEIGHT;

  return { lines, width, height, bgWidth: width, bgHeight: height };
}
