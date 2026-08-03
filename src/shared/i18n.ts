/**
 * Standardized IETF BCP-47 i18n helper utility for Chrome Extension & Offline Report
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
 * Normalizes any raw locale identifier (e.g. "zh_CN", "zh-CN", "zh", "en", "en_US") to standard BCP-47 tag.
 */
export function normalizeLocale(rawLocale?: string): SupportedLocale {
  if (!rawLocale) return "zh-CN";
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
      const uiLang = chrome.i18n.getUILanguage();
      if (uiLang) return normalizeLocale(uiLang);
    }
  } catch {
    // Fallback if chrome.i18n is unavailable
  }
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
      const message = chrome.i18n.getMessage(key, substitutions);
      if (message) return message;
    }
  } catch {
    // Fallback if chrome.i18n is unavailable in non-extension contexts
  }

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
      subs.forEach((sub, i) => {
        msg = msg.replace(new RegExp(`\\$${i + 1}`, "g"), sub);
        msg = msg.replace(/\$COUNT\$/g, sub);
        msg = msg.replace(/\$BYTES\$/g, sub);
        msg = msg.replace(/\$DAYS\$/g, sub);
        msg = msg.replace(/\$MAX\$/g, sub);
        msg = msg.replace(/\$CURRENT\$/g, sub);
        msg = msg.replace(/\$TOTAL\$/g, sub);
        msg = msg.replace(/\$SIZE\$/g, sub);
        msg = msg.replace(/\$ERROR\$/g, sub);
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
  // Translate text content
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

  // Translate placeholders
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

  // Translate title attributes
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
