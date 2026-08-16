/**
 * Chrome 扩展与离线报告共用的 IETF BCP-47 国际化工具
 */

export type SupportedLocale = "zh-CN" | "en-US";
export type LanguagePreference = "auto" | "zh-CN" | "en-US";
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

let activePreference: LanguagePreference = "auto";
const loadedDicts: Partial<Record<SupportedLocale, I18nDict>> = {};
const languageListeners = new Set<
  (pref: LanguagePreference, locale: SupportedLocale) => void
>();

function notifyLanguageListeners(): void {
  const currentLocale = getLocale();
  for (const listener of languageListeners) {
    try {
      listener(activePreference, currentLocale);
    } catch {
      // 避免单个监听器异常影响其他监听器
    }
  }
}

export function onLanguagePreferenceChange(
  listener: (pref: LanguagePreference, locale: SupportedLocale) => void
): () => void {
  languageListeners.add(listener);
  return () => {
    languageListeners.delete(listener);
  };
}

/**
 * 监听 storage.sync 变更，实现多页面/Content Script/Popup 间的语言偏好热同步
 */
if (
  typeof chrome !== "undefined" &&
  chrome.storage &&
  chrome.storage.onChanged
) {
  try {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === "sync" && changes.user_language_preference) {
        const nextPref = changes.user_language_preference.newValue as
          LanguagePreference | undefined;
        if (nextPref) {
          activePreference = nextPref;
          if (nextPref !== "auto") {
            void loadLocaleDict(nextPref).then(() => {
              notifyLanguageListeners();
            });
          } else {
            notifyLanguageListeners();
          }
        }
      }
    });
  } catch {
    // 忽略不受支持环境的异常
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

export function getLanguagePreference(): LanguagePreference {
  return activePreference;
}

export async function loadLocaleDict(
  locale: SupportedLocale
): Promise<I18nDict | undefined> {
  if (loadedDicts[locale]) return loadedDicts[locale];
  try {
    if (
      typeof chrome !== "undefined" &&
      chrome.runtime &&
      chrome.runtime.getURL
    ) {
      const folder = locale === "en-US" ? "en" : "zh_CN";
      const url = chrome.runtime.getURL(`_locales/${folder}/messages.json`);
      const res = await fetch(url);
      if (res.ok) {
        const dict = (await res.json()) as I18nDict;
        loadedDicts[locale] = dict;
        return dict;
      }
    }
  } catch {
    // 无法获取文件时静默处理
  }
  return undefined;
}

export async function initI18nPreference(): Promise<LanguagePreference> {
  try {
    if (
      typeof chrome !== "undefined" &&
      chrome.storage &&
      chrome.storage.sync
    ) {
      const stored = (await chrome.storage.sync.get([
        "user_language_preference",
      ])) as {
        user_language_preference?: LanguagePreference;
      };
      if (stored?.user_language_preference) {
        activePreference = stored.user_language_preference;
      }
    }
  } catch {
    // sync 不可用时回退
  }
  if (activePreference !== "auto") {
    await loadLocaleDict(activePreference);
  }
  notifyLanguageListeners();
  return activePreference;
}

export async function setUserLanguagePreference(
  pref: LanguagePreference
): Promise<void> {
  activePreference = pref;
  try {
    if (
      typeof chrome !== "undefined" &&
      chrome.storage &&
      chrome.storage.sync
    ) {
      await chrome.storage.sync.set({ user_language_preference: pref });
    }
  } catch {
    // sync 不可用时静默跳过
  }
  if (pref !== "auto") {
    await loadLocaleDict(pref);
  }
  notifyLanguageListeners();
}

export function getLocale(): SupportedLocale {
  if (activePreference !== "auto") {
    return activePreference;
  }

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

function formatMessage(
  template: string,
  substitutions?: string | string[]
): string {
  if (!substitutions) return template;
  const subs = Array.isArray(substitutions) ? substitutions : [substitutions];
  let msg = template.replace(/\$(\d+)\$/g, (_match, index: string) => {
    const value = subs[Number(index) - 1];
    return value ?? "";
  });
  let namedIndex = 0;
  msg = msg.replace(/\$([A-Z_]+)\$/g, () => {
    const value = subs[namedIndex] ?? "";
    namedIndex += 1;
    return value;
  });
  return msg;
}

export function t(
  key: string,
  substitutions?: string | string[],
  customDict?: I18nDict
): string {
  // 如果手动指定了语言，且已有对应的静态字典，使用字典匹配
  const targetLocale =
    activePreference !== "auto" ? activePreference : undefined;
  if (targetLocale && loadedDicts[targetLocale]) {
    const dict = loadedDicts[targetLocale];
    if (dict && dict[key]?.message) {
      return formatMessage(dict[key].message, substitutions);
    }
  }

  try {
    if (
      typeof chrome !== "undefined" &&
      chrome.i18n &&
      typeof chrome.i18n.getMessage === "function"
    ) {
      // 默认走 Chrome 官方 _locales 消息表
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
    return formatMessage(dict[key].message, substitutions);
  }

  return key;
}

export function applyI18n(
  container: HTMLElement | Document = document,
  customDict?: I18nDict
): void {
  // 批量翻译容器内带 data-i18n / data-i18n-ph / data-i18n-title 属性的元素
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

  const altElements =
    container.querySelectorAll<HTMLImageElement>("[data-i18n-alt]");
  altElements.forEach((el) => {
    const key = el.getAttribute("data-i18n-alt");
    if (key) {
      const translated = t(key, undefined, customDict);
      if (translated && translated !== key) {
        el.alt = translated;
      }
    }
  });
}
