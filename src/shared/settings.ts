import {
  DEFAULT_RECORDING_OPTIONS,
  VIDEO_BITRATE_BY_COMPRESSION,
} from "../domain/storage-policy";
import type { LanguagePreference } from "./i18n";
import { getLanguagePreference } from "./i18n";

export interface WorkflowSettings {
  language: LanguagePreference;
  stopAction: "preview" | "silentExport";
  autoCopyPrompt: boolean;
  showWorkflowGuide: boolean;
}

export interface DefaultRecordingSettings {
  captureVideo: boolean;
  captureAudio: boolean;
  captureScreenshots: boolean;
  captureConsole: boolean;
  captureNetwork: boolean;
  responseBodyPolicy: "disabled" | "standard" | "full";
  captureFrameworkState: boolean;
  privacyMode: "safe" | "raw";
}

export interface AiSettings {
  targetAssistant: "generic" | "cursor" | "claude-code" | "antigravity";
  promptLanguage: "auto" | "zh-CN" | "en-US";
  customInstructions: string;
}

export interface PrivacySettings {
  customSensitiveKeys: string[];
  excludeUrlPatterns: string[];
}

export interface StorageSettings {
  retentionDays: number;
  compressionLevel: "balanced" | "quality" | "small";
  maxSessionBytes: number;
}

export interface AppSettings {
  workflow: WorkflowSettings;
  defaultRecording: DefaultRecordingSettings;
  ai: AiSettings;
  privacy: PrivacySettings;
  storage: StorageSettings;
}

export const DEFAULT_APP_SETTINGS: AppSettings = Object.freeze({
  workflow: Object.freeze({
    language: "auto",
    stopAction: "preview",
    autoCopyPrompt: true,
    showWorkflowGuide: true,
  }),
  defaultRecording: Object.freeze({
    captureVideo: true,
    captureAudio: false,
    captureScreenshots: true,
    captureConsole: true,
    captureNetwork: true,
    responseBodyPolicy: "standard",
    captureFrameworkState: true,
    privacyMode: "safe",
  }),
  ai: Object.freeze({
    targetAssistant: "generic",
    promptLanguage: "auto",
    customInstructions: "",
  }),
  privacy: Object.freeze({
    customSensitiveKeys: [],
    excludeUrlPatterns: [],
  }),
  storage: Object.freeze({
    retentionDays: 14,
    compressionLevel: "balanced",
    maxSessionBytes: 512 * 1024 * 1024,
  }),
});

export const APP_SETTINGS_STORAGE_KEY = "app-settings";

function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

/**
 * 递归安全深拷贝合并配置，确保缺省字段由默认值兜底
 */
export function mergeAppSettings(
  target: AppSettings,
  source?: unknown
): AppSettings {
  if (!isObject(source)) return { ...target };

  const srcWorkflow = isObject(source.workflow) ? source.workflow : {};
  const srcDefaultRec = isObject(source.defaultRecording)
    ? source.defaultRecording
    : {};
  const srcAi = isObject(source.ai) ? source.ai : {};
  const srcPrivacy = isObject(source.privacy) ? source.privacy : {};
  const srcStorage = isObject(source.storage) ? source.storage : {};

  return {
    workflow: {
      language:
        srcWorkflow.language === "zh-CN" ||
        srcWorkflow.language === "en-US" ||
        srcWorkflow.language === "auto"
          ? srcWorkflow.language
          : target.workflow.language,
      stopAction:
        srcWorkflow.stopAction === "silentExport"
          ? "silentExport"
          : target.workflow.stopAction,
      autoCopyPrompt:
        typeof srcWorkflow.autoCopyPrompt === "boolean"
          ? srcWorkflow.autoCopyPrompt
          : target.workflow.autoCopyPrompt,
      showWorkflowGuide:
        typeof srcWorkflow.showWorkflowGuide === "boolean"
          ? srcWorkflow.showWorkflowGuide
          : target.workflow.showWorkflowGuide,
    },
    defaultRecording: {
      captureVideo:
        typeof srcDefaultRec.captureVideo === "boolean"
          ? srcDefaultRec.captureVideo
          : target.defaultRecording.captureVideo,
      captureAudio:
        typeof srcDefaultRec.captureAudio === "boolean"
          ? srcDefaultRec.captureAudio
          : target.defaultRecording.captureAudio,
      captureScreenshots:
        typeof srcDefaultRec.captureScreenshots === "boolean"
          ? srcDefaultRec.captureScreenshots
          : target.defaultRecording.captureScreenshots,
      captureConsole:
        typeof srcDefaultRec.captureConsole === "boolean"
          ? srcDefaultRec.captureConsole
          : target.defaultRecording.captureConsole,
      captureNetwork:
        typeof srcDefaultRec.captureNetwork === "boolean"
          ? srcDefaultRec.captureNetwork
          : target.defaultRecording.captureNetwork,
      responseBodyPolicy:
        srcDefaultRec.responseBodyPolicy === "disabled" ||
        srcDefaultRec.responseBodyPolicy === "full" ||
        srcDefaultRec.responseBodyPolicy === "standard"
          ? srcDefaultRec.responseBodyPolicy
          : target.defaultRecording.responseBodyPolicy,
      captureFrameworkState:
        typeof srcDefaultRec.captureFrameworkState === "boolean"
          ? srcDefaultRec.captureFrameworkState
          : target.defaultRecording.captureFrameworkState,
      privacyMode:
        srcDefaultRec.privacyMode === "raw"
          ? "raw"
          : target.defaultRecording.privacyMode,
    },
    ai: {
      targetAssistant:
        srcAi.targetAssistant === "cursor" ||
        srcAi.targetAssistant === "claude-code" ||
        srcAi.targetAssistant === "antigravity"
          ? srcAi.targetAssistant
          : target.ai.targetAssistant,
      promptLanguage:
        srcAi.promptLanguage === "zh-CN" ||
        srcAi.promptLanguage === "en-US" ||
        srcAi.promptLanguage === "auto"
          ? srcAi.promptLanguage
          : target.ai.promptLanguage,
      customInstructions:
        typeof srcAi.customInstructions === "string"
          ? srcAi.customInstructions.slice(0, 4000)
          : target.ai.customInstructions,
    },
    privacy: {
      customSensitiveKeys: Array.isArray(srcPrivacy.customSensitiveKeys)
        ? srcPrivacy.customSensitiveKeys
            .filter((item): item is string => typeof item === "string")
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(0, 100)
        : target.privacy.customSensitiveKeys,
      excludeUrlPatterns: Array.isArray(srcPrivacy.excludeUrlPatterns)
        ? srcPrivacy.excludeUrlPatterns
            .filter((item): item is string => typeof item === "string")
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(0, 50)
        : target.privacy.excludeUrlPatterns,
    },
    storage: {
      retentionDays:
        typeof srcStorage.retentionDays === "number" &&
        Number.isFinite(srcStorage.retentionDays)
          ? Math.min(365, Math.max(1, Math.round(srcStorage.retentionDays)))
          : target.storage.retentionDays,
      compressionLevel:
        srcStorage.compressionLevel === "quality" ||
        srcStorage.compressionLevel === "small"
          ? srcStorage.compressionLevel
          : target.storage.compressionLevel,
      maxSessionBytes:
        typeof srcStorage.maxSessionBytes === "number" &&
        Number.isFinite(srcStorage.maxSessionBytes)
          ? Math.min(
              4 * 1024 * 1024 * 1024,
              Math.max(16 * 1024 * 1024, Math.round(srcStorage.maxSessionBytes))
            )
          : target.storage.maxSessionBytes,
    },
  };
}

/**
 * 从 chrome.storage.local 加载全局配置。若不存在则尝试从既有老存储回填迁移。
 */
export async function loadAppSettings(): Promise<AppSettings> {
  let raw: unknown;
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const res = await chrome.storage.local.get([
        APP_SETTINGS_STORAGE_KEY,
        "last-recording-options",
        "user_language_preference",
      ]);
      raw = res[APP_SETTINGS_STORAGE_KEY];

      // 若未存过 app-settings，尝试从历史配置兼容初始化
      if (!raw) {
        const lastOpts = res["last-recording-options"] as
          Record<string, unknown> | undefined;
        const langPref = res["user_language_preference"] as
          LanguagePreference | undefined;

        const initial: AppSettings = {
          ...DEFAULT_APP_SETTINGS,
          workflow: {
            ...DEFAULT_APP_SETTINGS.workflow,
            language: langPref || getLanguagePreference() || "auto",
          },
          defaultRecording: {
            ...DEFAULT_APP_SETTINGS.defaultRecording,
            ...(lastOpts
              ? {
                  captureVideo: lastOpts.captureVideo !== false,
                  captureAudio: Boolean(lastOpts.captureAudio),
                  captureScreenshots: lastOpts.captureScreenshots !== false,
                  captureConsole: lastOpts.captureConsole !== false,
                  captureNetwork: lastOpts.captureNetwork !== false,
                  responseBodyPolicy:
                    lastOpts.captureNetworkBodies === false
                      ? "disabled"
                      : lastOpts.captureFullResponseBody
                        ? "full"
                        : "standard",
                  captureFrameworkState:
                    lastOpts.captureFrameworkState !== false,
                  privacyMode: lastOpts.privacyMode === "raw" ? "raw" : "safe",
                }
              : {}),
          },
        };
        return initial;
      }
    }
  } catch {
    // 忽略异常，降级到默认值
  }

  return mergeAppSettings(DEFAULT_APP_SETTINGS, raw);
}

/**
 * 保存全局配置到 chrome.storage.local
 */
export async function saveAppSettings(
  settings: Partial<AppSettings> | ((prev: AppSettings) => AppSettings)
): Promise<AppSettings> {
  const prev = await loadAppSettings();
  const next =
    typeof settings === "function"
      ? settings(prev)
      : mergeAppSettings(prev, settings);

  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const lastOpts = {
        captureVideo: next.defaultRecording.captureVideo,
        captureAudio: next.defaultRecording.captureAudio,
        captureScreenshots: next.defaultRecording.captureScreenshots,
        captureConsole: next.defaultRecording.captureConsole,
        captureNetwork: next.defaultRecording.captureNetwork,
        captureNetworkBodies:
          next.defaultRecording.responseBodyPolicy !== "disabled",
        captureFullResponseBody:
          next.defaultRecording.responseBodyPolicy === "full",
        captureFrameworkState: next.defaultRecording.captureFrameworkState,
        privacyMode: next.defaultRecording.privacyMode,
        videoBitsPerSecond:
          VIDEO_BITRATE_BY_COMPRESSION[next.storage.compressionLevel],
        maxSessionBytes: next.storage.maxSessionBytes,
      };
      await chrome.storage.local.set({
        [APP_SETTINGS_STORAGE_KEY]: next,
        "last-recording-options": lastOpts,
      });
    }
  } catch {
    // 忽略异常
  }

  return next;
}
