/**
 * Chrome 扩展与离线报告共用的 IETF BCP-47 国际化工具
 */

export type SupportedLocale = "zh-CN" | "en-US";
export type I18nDict = Record<string, { message: string }>;
export type I18nBundle = {
  locale: SupportedLocale;
  lang?: string;
  dict: I18nDict;
};

declare global {
  interface Window {
    __WEB_BUG_REPORT_I18N__?: I18nBundle;
  }
}

/**
 * 将任意原始区域标识（如 "zh_CN"、"zh-CN"、"zh"、"en"、"en_US"）归一化为标准 BCP-47 标签。
 */
export function normalizeLocale(rawLocale?: string): SupportedLocale {
  if (!rawLocale) return "zh-CN";
  // 统一为 BCP-47 格式：zh_CN/zh-CN/zh → zh-CN，en → en-US
  const normalized = rawLocale.toLowerCase().replace(/_/g, "-");
  if (normalized.startsWith("en")) return "en-US";
  if (normalized.startsWith("zh")) return "zh-CN";
  return "zh-CN";
}

export function getLocale(): SupportedLocale {
  try {
    if (
      typeof chrome !== "undefined" &&
      chrome.i18n &&
      typeof chrome.i18n.getUILanguage === "function"
    ) {
      // 优先采用扩展 UI 语言
      const uiLang = chrome.i18n.getUILanguage();
      if (uiLang) return normalizeLocale(uiLang);
    }
  } catch {
    // chrome.i18n 不可用时的兜底
  }
  // 其次读取离线报告注入的全局 i18n bundle
  if (typeof window !== "undefined" && window.__WEB_BUG_REPORT_I18N__) {
    const bundle = window.__WEB_BUG_REPORT_I18N__;
    return normalizeLocale(bundle.locale || bundle.lang);
  }
  return "zh-CN";
}

export function isEn(): boolean {
  return getLocale() === "en-US";
}

export function t(
  key: string,
  substitutions?: string | string[],
  customDict?: I18nDict
): string {
  try {
    if (
      typeof chrome !== "undefined" &&
      chrome.i18n &&
      typeof chrome.i18n.getMessage === "function"
    ) {
      // 优先走 Chrome 官方 _locales 消息表
      const message = chrome.i18n.getMessage(key, substitutions);
      if (message) return message;
    }
  } catch {
    // 非扩展环境下 chrome.i18n 不可用时的兜底
  }

  // 非扩展环境（如离线报告）回退到内置字典
  const dict =
    customDict ||
    (typeof window !== "undefined"
      ? window.__WEB_BUG_REPORT_I18N__?.dict
      : undefined);
  if (dict && dict[key]?.message) {
    let msg = dict[key].message;
    if (substitutions) {
      const subs = Array.isArray(substitutions)
        ? substitutions
        : [substitutions];
      // 按命名占位符在消息中首次出现的顺序，依次映射替换参数（先出现者用第一个参数，依此类推）
      let namedIndex = 0;
      msg = msg.replace(
        /\$(COUNT|BYTES|DAYS|MAX|CURRENT|TOTAL|SIZE|ERROR|SECONDS|ACTION|ELEMENT|KEY|TYPE|VALUE)\$/g,
        () => {
          const value = subs[namedIndex] ?? "";
          namedIndex += 1;
          return value;
        }
      );
      // 兼容数字占位符 $1$ / $2$ …
      msg = msg.replace(/\$(\d+)\$/g, (_match, index: string) => {
        const value = subs[Number(index) - 1];
        return value ?? "";
      });
    }
    return msg;
  }

  return key;
}

export function applyI18n(
  container: HTMLElement | Document = document,
  customDict?: I18nDict
): void {
  // 批量翻译容器内带 data-i18n / data-i18n-ph / data-i18n-title 属性的元素
  // 翻译文本内容
  const elements = container.querySelectorAll<HTMLElement>("[data-i18n]");
  elements.forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (key) {
      const translated = t(key, undefined, customDict);
      if (translated && translated !== key) {
        el.textContent = translated;
      }
    }
  });

  // 翻译占位符
  const placeholderElements = container.querySelectorAll<
    HTMLInputElement | HTMLTextAreaElement
  >("[data-i18n-ph]");
  placeholderElements.forEach((el) => {
    const key = el.getAttribute("data-i18n-ph");
    if (key) {
      const translated = t(key, undefined, customDict);
      if (translated && translated !== key) {
        el.placeholder = translated;
      }
    }
  });

  // 翻译 title 属性
  const titleElements =
    container.querySelectorAll<HTMLElement>("[data-i18n-title]");
  titleElements.forEach((el) => {
    const key = el.getAttribute("data-i18n-title");
    if (key) {
      const translated = t(key, undefined, customDict);
      if (translated && translated !== key) {
        el.title = translated;
      }
    }
  });
}
