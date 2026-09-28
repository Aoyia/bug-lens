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

  // 内存硬兜底：防止扩展更新阶段 Chrome 进程缓存旧 messages.json 导致原始 key 泄露
  const fallback = BUILTIN_FALLBACK_MESSAGES[key];
  if (fallback) {
    const isEnglish = isEn();
    return formatMessage(isEnglish ? fallback.en : fallback.zh, substitutions);
  }

  return key;
}

const BUILTIN_FALLBACK_MESSAGES: Record<string, { zh: string; en: string }> = {
  autoSaveActive: { zh: "实时保存中", en: "Auto-save active" },
  savedSuccess: { zh: "已自动保存", en: "Auto-saved" },
  settingsTitle: { zh: "全局设置", en: "Settings" },
  navWorkflow: { zh: "工作流偏好", en: "Workflow" },
  navAi: { zh: "AI 与导出定制", en: "AI & Export" },
  navRecording: { zh: "默认录制通道", en: "Default Streams" },
  navPrivacy: { zh: "安全与脱敏", en: "Privacy & Security" },
  navStorage: { zh: "存储与配额", en: "Storage & Retention" },
  navShortcuts: { zh: "快捷键指南", en: "Shortcuts" },
  settingLanguage: { zh: "界面语言", en: "Interface Language" },
  settingLanguageDesc: {
    zh: "选择插件界面的展示语言",
    en: "Choose the display language for the extension",
  },
  settingStopAction: { zh: "录制停止后行为", en: "Stop Recording Action" },
  settingStopActionDesc: {
    zh: "点击结束录制后的默认处理流程",
    en: "Default workflow after stopping a recording",
  },
  stopActionPreview: {
    zh: "打开审查预览页（推荐）",
    en: "Open Preview (Recommended)",
  },
  stopActionSilentExport: {
    zh: "静默导出下载 ZIP（不打开预览）",
    en: "Silent Export ZIP (Skip Preview)",
  },
  settingAutoCopyPrompt: {
    zh: "自动复制 AI Prompt",
    en: "Auto-copy AI Prompt",
  },
  settingAutoCopyPromptDesc: {
    zh: "证据包导出完成后自动将分析提示词写入系统剪贴板",
    en: "Automatically copy AI_PROMPT.md to clipboard on export",
  },
  settingShowGuide: { zh: "显示工作流引导", en: "Show Workflow Guide" },
  settingShowGuideDesc: {
    zh: "是否在面板中展示 3 步工作流认知卡片",
    en: "Display the 3-step workflow guide in the popup panel",
  },
  settingTargetAssistant: {
    zh: "目标 AI 编程助手",
    en: "Target AI Assistant",
  },
  settingTargetAssistantDesc: {
    zh: "为特定 AI 助手优化导出的 AI_PROMPT.md 提示词引导格式",
    en: "Optimize AI_PROMPT.md structure for your preferred AI tool",
  },
  assistantGeneric: { zh: "通用 (Generic)", en: "Generic" },
  assistantCursor: { zh: "Cursor", en: "Cursor" },
  assistantClaudeCode: { zh: "Claude Code", en: "Claude Code" },
  assistantAntigravity: { zh: "Antigravity", en: "Antigravity" },
  settingPromptLanguage: { zh: "Prompt 输出语言", en: "Prompt Language" },
  settingPromptLanguageDesc: {
    zh: "导出的诊断提示词所使用的语言",
    en: "Language used for generated AI diagnosis prompts",
  },
  settingCustomInstructions: {
    zh: "自定义诊断排查指引",
    en: "Custom Diagnostic Instructions",
  },
  settingCustomInstructionsDesc: {
    zh: "追加到 AI_PROMPT.md 中的团队技术栈规范或专属排查指引（最多 4000 字符）",
    en: "Custom directives appended to AI_PROMPT.md (up to 4000 characters)",
  },
  settingCustomSensitiveKeys: {
    zh: "自定义敏感键名",
    en: "Custom Sensitive Keys",
  },
  settingCustomSensitiveKeysDesc: {
    zh: "额外的敏感 Header 或 JSON 字段名（用英文逗号分隔，如：auth_token, user_pin）",
    en: "Extra header or JSON property names to redact (comma-separated, e.g. auth_token, user_pin)",
  },
  settingExcludeUrls: { zh: "网络抓取排除规则", en: "URL Exclusion Rules" },
  settingExcludeUrlsDesc: {
    zh: "忽略特定内部域名或 URL 的网络请求抓取（每行一个）",
    en: "Ignore network requests matching these domains or patterns (one per line)",
  },
  settingVideoQuality: { zh: "视频录制码率", en: "Video Bitrate" },
  settingVideoQualityDesc: {
    zh: "平衡视频体积与排查清晰度",
    en: "Balance recording video file size and visual clarity",
  },
  qualityBalanced: { zh: "平衡 (2.5 Mbps)", en: "Balanced (2.5 Mbps)" },
  qualityHigh: { zh: "画质优先 (4.0 Mbps)", en: "High Quality (4.0 Mbps)" },
  qualitySmall: { zh: "体积优先 (1.2 Mbps)", en: "Compact (1.2 Mbps)" },
  settingRetention: { zh: "历史会话保留期限", en: "Session Retention Period" },
  settingRetentionDesc: {
    zh: "超过保留期限的历史录制将在扩展启动时自动清理",
    en: "Expired sessions will be cleaned up on extension startup",
  },
  retentionDays7: { zh: "7 天", en: "7 Days" },
  retentionDays14: { zh: "14 天（默认）", en: "14 Days (Default)" },
  retentionDays30: { zh: "30 天", en: "30 Days" },
  retentionDays90: { zh: "90 天", en: "90 Days" },
  settingMaxSessionBytes: {
    zh: "单会话存储上限",
    en: "Max Session Budget",
  },
  settingMaxSessionBytesDesc: {
    zh: "单次录制的最大存储预算",
    en: "Maximum storage budget allocated for a single recording",
  },
  clearAllData: { zh: "清空所有历史数据", en: "Clear All Historical Data" },
  clearAllDataDesc: {
    zh: "彻底清理本地 IndexedDB 中存储的所有历史录制与现场截图（不可恢复）",
    en: "Purge all historical recordings and screenshots in local IndexedDB (irreversible)",
  },
  clearAllDataSuccess: {
    zh: "本地历史数据已清空",
    en: "Historical data cleared successfully",
  },
  shortcutStartRecording: {
    zh: "开始/停止录制",
    en: "Start/Stop Recording",
  },
  shortcutTakeScreenshot: {
    zh: "截屏标记现场",
    en: "Capture Screenshot Scene",
  },
  shortcutOpenPopup: { zh: "唤起插件面板", en: "Open Extension Popup" },
  openChromeShortcuts: {
    zh: "前往 Chrome 快捷键设置",
    en: "Open Chrome Shortcuts Settings",
  },
  saveSettings: { zh: "保存设置", en: "Save Settings" },
  resetDefaults: { zh: "恢复默认值", en: "Reset to Defaults" },
};

export function applyI18n(
  container: HTMLElement | Document = document,
  customDict?: I18nDict
): void {
  // 同步文档语言元数据（<html lang>），保证读屏发音、浏览器词典与 :lang() 选择器
  // 与界面语言一致；离线报告页面同样依赖此函数完成初始化同步。
  if (typeof document !== "undefined") {
    document.documentElement.lang = getLocale();
  }
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

  const ariaElements =
    container.querySelectorAll<HTMLElement>("[data-i18n-aria]");
  ariaElements.forEach((el) => {
    const key = el.getAttribute("data-i18n-aria");
    if (key) {
      const translated = t(key, undefined, customDict);
      if (translated && translated !== key) {
        el.setAttribute("aria-label", translated);
      }
    }
  });
}
