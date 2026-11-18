export type ConsoleNoiseCategory = "devtools-plugin" | "extension-internal";

export interface ConsoleNoiseClassification {
  isNoise: boolean;
  category?: ConsoleNoiseCategory;
  reason?: string;
}

const DEVTOOLS_PLUGIN_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /another version of vue devtools seems to be installed/i,
    reason: "vue-devtools-conflict-notice",
  },
  {
    pattern:
      /download the vue devtools extension for a better development experience/i,
    reason: "vue-devtools-download-tip",
  },
  {
    pattern: /download the react devtools for a better development experience/i,
    reason: "react-devtools-download-tip",
  },
  {
    pattern: /devtools.*detected.*please enable only one/i,
    reason: "devtools-duplicate-extension-tip",
  },
];

const EXTENSION_INTERNAL_BENIGN_PATTERN = /^\[bug[-\s]?lens(?:\s[^\]]*)?\]/i;
const EXTENSION_INTERNAL_SAFE_DIAG_PATTERN =
  /(?:hook installed|devtools hook|bridge ready|content script ready|session started|capture ready)/i;

/**
 * 识别与目标应用业务无关的良性插件提示/内部诊断日志（如 Vue/React DevTools 版本冲突提示）。
 * 仅对明确匹配的插件引导/冲突与非报错内部日志返回 true，避免吞掉真实业务异常。
 */
export function classifyConsoleNoise(input: {
  text?: string;
  level?: string;
  url?: string;
  source?: string;
}): ConsoleNoiseClassification {
  const text = (input.text ?? "").trim();
  if (!text) return { isNoise: false };

  for (const { pattern, reason } of DEVTOOLS_PLUGIN_PATTERNS) {
    if (pattern.test(text)) {
      return {
        isNoise: true,
        category: "devtools-plugin",
        reason,
      };
    }
  }

  const level = (input.level ?? "log").toLowerCase();
  if (EXTENSION_INTERNAL_BENIGN_PATTERN.test(text)) {
    if (level !== "error" || EXTENSION_INTERNAL_SAFE_DIAG_PATTERN.test(text)) {
      return {
        isNoise: true,
        category: "extension-internal",
        reason: "bug-lens-internal-log",
      };
    }
  }

  return { isNoise: false };
}

export function isBenignConsoleNoise(input: {
  text?: string;
  level?: string;
  url?: string;
  source?: string;
}): boolean {
  return classifyConsoleNoise(input).isNoise;
}
