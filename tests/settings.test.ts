import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_APP_SETTINGS,
  mergeAppSettings,
  loadAppSettings,
  saveAppSettings,
  APP_SETTINGS_STORAGE_KEY,
  type AppSettings,
} from "../src/shared/settings.ts";
import { VIDEO_BITRATE_BY_COMPRESSION } from "../src/domain/storage-policy.ts";
import { buildAiPrompt } from "../src/preview/evidence-package.ts";

describe("AppSettings Domain & Schema", () => {
  test("mergeAppSettings retains defaults when passed empty or invalid objects", () => {
    const res1 = mergeAppSettings(DEFAULT_APP_SETTINGS, undefined);
    assert.deepEqual(res1, DEFAULT_APP_SETTINGS);

    const res2 = mergeAppSettings(DEFAULT_APP_SETTINGS, null);
    assert.deepEqual(res2, DEFAULT_APP_SETTINGS);

    const res3 = mergeAppSettings(DEFAULT_APP_SETTINGS, {});
    assert.deepEqual(res3, DEFAULT_APP_SETTINGS);

    const res4 = mergeAppSettings(
      DEFAULT_APP_SETTINGS,
      "invalid-string" as any
    );
    assert.deepEqual(res4, DEFAULT_APP_SETTINGS);

    const res5 = mergeAppSettings(DEFAULT_APP_SETTINGS, [1, 2, 3] as any);
    assert.deepEqual(res5, DEFAULT_APP_SETTINGS);
  });

  test("mergeAppSettings overrides partial workflow and ai settings correctly", () => {
    const partial = {
      workflow: {
        language: "en-US",
        stopAction: "silentExport",
      },
      ai: {
        targetAssistant: "cursor",
        customInstructions: "Always check Next.js App Router server components",
      },
    };

    const merged = mergeAppSettings(DEFAULT_APP_SETTINGS, partial);
    assert.equal(merged.workflow.language, "en-US");
    assert.equal(merged.workflow.stopAction, "silentExport");
    assert.equal(merged.workflow.autoCopyPrompt, true); // 保留默认值
    assert.equal(merged.ai.targetAssistant, "cursor");
    assert.equal(
      merged.ai.customInstructions,
      "Always check Next.js App Router server components"
    );
    // 录制默认配置保持不变
    assert.equal(merged.defaultRecording.captureVideo, true);
  });

  test("mergeAppSettings handles customSensitiveKeys array and clamps storage bounds", () => {
    const custom = {
      privacy: {
        customSensitiveKeys: ["my_secret_token", "  tenant_id  ", ""],
        excludeUrlPatterns: ["*internal.corp.com*"],
      },
      storage: {
        retentionDays: 9999, // 应该被 clamp 到 365
        maxSessionBytes: 10, // 应该被 clamp 到 16MB
        compressionLevel: "quality",
      },
    };

    const merged = mergeAppSettings(DEFAULT_APP_SETTINGS, custom);
    assert.deepEqual(merged.privacy.customSensitiveKeys, [
      "my_secret_token",
      "tenant_id",
    ]);
    assert.deepEqual(merged.privacy.excludeUrlPatterns, [
      "*internal.corp.com*",
    ]);
    assert.equal(merged.storage.retentionDays, 365);
    assert.equal(merged.storage.maxSessionBytes, 16 * 1024 * 1024);
    assert.equal(merged.storage.compressionLevel, "quality");
  });

  test("buildAiPrompt injects custom assistant and custom instructions", () => {
    const mockSnapshot = {
      interactions: [],
      consoleEntries: [],
      networkEntries: [],
      issueScenes: [],
      session: {
        id: "test",
        title: "Test Session",
        quality: { overall: "healthy" },
        target: { initialUrl: "https://example.com" },
      },
    };

    const prompt = buildAiPrompt(mockSnapshot, "/path/to/bug.zip", {
      targetAssistant: "cursor",
      customInstructions: "Prioritize analyzing Zustand store mutations",
    });

    assert.ok(prompt.includes("Cursor"));
    assert.ok(prompt.includes("Prioritize analyzing Zustand store mutations"));
  });

  // R1 细化边界防护测试：非法枚举值安全回退
  test("mergeAppSettings falls back to target defaults when receiving illegal enum values", () => {
    const illegalValues = {
      workflow: {
        language: "fr-FR", // 非法语言
        stopAction: "invalidAction", // 非法停止行为
      },
      defaultRecording: {
        responseBodyPolicy: "unsupportedPolicy", // 非法响应体策略
        privacyMode: "completelyUnmasked", // 非法隐私模式
      },
      ai: {
        targetAssistant: "unsupportedAssistant", // 非法 AI 助手
        promptLanguage: "de-DE", // 非法 Prompt 语言
      },
      storage: {
        compressionLevel: "ultraSuperLossless", // 非法压缩档位
      },
    };

    const merged = mergeAppSettings(DEFAULT_APP_SETTINGS, illegalValues);

    // 全部回退到 target (DEFAULT_APP_SETTINGS) 的安全预设值
    assert.equal(merged.workflow.language, "auto");
    assert.equal(merged.workflow.stopAction, "preview");
    assert.equal(merged.defaultRecording.responseBodyPolicy, "standard");
    assert.equal(merged.defaultRecording.privacyMode, "safe");
    assert.equal(merged.ai.targetAssistant, "generic");
    assert.equal(merged.ai.promptLanguage, "auto");
    assert.equal(merged.storage.compressionLevel, "balanced");

    // 针对显式自定义的 target 也应回退到自定义 target 的值
    const customTarget: AppSettings = {
      ...DEFAULT_APP_SETTINGS,
      workflow: { ...DEFAULT_APP_SETTINGS.workflow, language: "en-US" },
      ai: { ...DEFAULT_APP_SETTINGS.ai, targetAssistant: "claude-code" },
      storage: { ...DEFAULT_APP_SETTINGS.storage, compressionLevel: "small" },
    };
    const mergedFromCustom = mergeAppSettings(customTarget, illegalValues);
    assert.equal(mergedFromCustom.workflow.language, "en-US");
    assert.equal(mergedFromCustom.ai.targetAssistant, "claude-code");
    assert.equal(mergedFromCustom.storage.compressionLevel, "small");
  });

  // R1 细化边界防护测试：NaN / 负数 / 超界数值纠偏
  test("mergeAppSettings safely corrects NaN, negative numbers, and out-of-range bounds", () => {
    // 1. 负数与 0 纠偏
    const negativeInput = {
      storage: {
        retentionDays: -50,
        maxSessionBytes: -1024,
      },
    };
    const mergedNegative = mergeAppSettings(
      DEFAULT_APP_SETTINGS,
      negativeInput
    );
    // retentionDays 最小为 1
    assert.equal(mergedNegative.storage.retentionDays, 1);
    // maxSessionBytes 最小为 16MB
    assert.equal(mergedNegative.storage.maxSessionBytes, 16 * 1024 * 1024);

    const zeroInput = {
      storage: {
        retentionDays: 0,
        maxSessionBytes: 0,
      },
    };
    const mergedZero = mergeAppSettings(DEFAULT_APP_SETTINGS, zeroInput);
    assert.equal(mergedZero.storage.retentionDays, 1);
    assert.equal(mergedZero.storage.maxSessionBytes, 16 * 1024 * 1024);

    // 2. 超出最大值上限纠偏
    const overflowInput = {
      storage: {
        retentionDays: 5000,
        maxSessionBytes: 50 * 1024 * 1024 * 1024, // 50GB
      },
    };
    const mergedOverflow = mergeAppSettings(
      DEFAULT_APP_SETTINGS,
      overflowInput
    );
    // retentionDays 最大为 365
    assert.equal(mergedOverflow.storage.retentionDays, 365);
    // maxSessionBytes 最大为 4GB
    assert.equal(
      mergedOverflow.storage.maxSessionBytes,
      4 * 1024 * 1024 * 1024
    );

    // 3. NaN, Infinity, -Infinity 及非数字类型防护
    const nanInput = {
      storage: {
        retentionDays: Number.NaN,
        maxSessionBytes: Number.POSITIVE_INFINITY,
      },
    };
    const mergedNan = mergeAppSettings(DEFAULT_APP_SETTINGS, nanInput);
    // 应保持原 target 值不变
    assert.equal(
      mergedNan.storage.retentionDays,
      DEFAULT_APP_SETTINGS.storage.retentionDays
    );
    assert.equal(
      mergedNan.storage.maxSessionBytes,
      DEFAULT_APP_SETTINGS.storage.maxSessionBytes
    );

    const invalidTypeInput = {
      storage: {
        retentionDays: "thirty" as any,
        maxSessionBytes: { bytes: 100 } as any,
      },
    };
    const mergedInvalidType = mergeAppSettings(
      DEFAULT_APP_SETTINGS,
      invalidTypeInput
    );
    assert.equal(
      mergedInvalidType.storage.retentionDays,
      DEFAULT_APP_SETTINGS.storage.retentionDays
    );
    assert.equal(
      mergedInvalidType.storage.maxSessionBytes,
      DEFAULT_APP_SETTINGS.storage.maxSessionBytes
    );

    // 4. 浮点数四舍五入取整
    const floatInput = {
      storage: {
        retentionDays: 14.8,
        maxSessionBytes: 32 * 1024 * 1024 + 0.6,
      },
    };
    const mergedFloat = mergeAppSettings(DEFAULT_APP_SETTINGS, floatInput);
    assert.equal(mergedFloat.storage.retentionDays, 15);
    assert.equal(mergedFloat.storage.maxSessionBytes, 32 * 1024 * 1024 + 1);
  });

  // R1 细化边界防护测试：100 项敏感词与 50 项排除 URL 截断及清洗
  test("mergeAppSettings truncates customSensitiveKeys to 100 items and excludeUrlPatterns to 50 items", () => {
    // 生成 120 个敏感词
    const longKeys = Array.from({ length: 120 }, (_, i) => ` key_${i} `);
    // 生成 80 个排除 URL
    const longUrls = Array.from(
      { length: 80 },
      (_, i) => `  https://internal-${i}.corp.net  `
    );

    const input = {
      privacy: {
        customSensitiveKeys: [
          ...longKeys,
          "", // 空串应被过滤
          "   ", // 纯空格应被过滤
          null as any, // 非字符串应被过滤
          12345 as any,
        ],
        excludeUrlPatterns: [
          ...longUrls,
          "",
          "   ",
          undefined as any,
          true as any,
        ],
      },
    };

    const merged = mergeAppSettings(DEFAULT_APP_SETTINGS, input);

    // customSensitiveKeys 必须严格截断至 100 项，且两端空格被 trim
    assert.equal(merged.privacy.customSensitiveKeys.length, 100);
    assert.equal(merged.privacy.customSensitiveKeys[0], "key_0");
    assert.equal(merged.privacy.customSensitiveKeys[99], "key_99");

    // excludeUrlPatterns 必须严格截断至 50 项，且两端空格被 trim
    assert.equal(merged.privacy.excludeUrlPatterns.length, 50);
    assert.equal(
      merged.privacy.excludeUrlPatterns[0],
      "https://internal-0.corp.net"
    );
    assert.equal(
      merged.privacy.excludeUrlPatterns[49],
      "https://internal-49.corp.net"
    );

    // 传入非数组时应安全保留原 target 值
    const invalidArrayInput = {
      privacy: {
        customSensitiveKeys: "not-an-array" as any,
        excludeUrlPatterns: { url: "test" } as any,
      },
    };
    const mergedInvalidArray = mergeAppSettings(
      DEFAULT_APP_SETTINGS,
      invalidArrayInput
    );
    assert.deepEqual(
      mergedInvalidArray.privacy.customSensitiveKeys,
      DEFAULT_APP_SETTINGS.privacy.customSensitiveKeys
    );
    assert.deepEqual(
      mergedInvalidArray.privacy.excludeUrlPatterns,
      DEFAULT_APP_SETTINGS.privacy.excludeUrlPatterns
    );
  });

  // R1 细化边界防护测试：AI 自定义排查指引 4000 字符硬截断
  test("mergeAppSettings truncates customInstructions to 4000 characters maximum", () => {
    const longInstructions = "X".repeat(5000);
    const input = {
      ai: {
        customInstructions: longInstructions,
      },
    };

    const merged = mergeAppSettings(DEFAULT_APP_SETTINGS, input);
    assert.equal(merged.ai.customInstructions.length, 4000);
    assert.equal(merged.ai.customInstructions, "X".repeat(4000));

    // 非字符串类型回退到 target
    const invalidTypeInput = {
      ai: {
        customInstructions: 98765 as any,
      },
    };
    const mergedInvalid = mergeAppSettings(
      DEFAULT_APP_SETTINGS,
      invalidTypeInput
    );
    assert.equal(
      mergedInvalid.ai.customInstructions,
      DEFAULT_APP_SETTINGS.ai.customInstructions
    );
  });
});

describe("Storage 存储读写与历史版本兼容迁移测试", () => {
  let originalChrome: unknown;
  let mockStorage: Map<string, unknown>;

  beforeEach(() => {
    originalChrome = (globalThis as any).chrome;
    mockStorage = new Map<string, unknown>();

    (globalThis as any).chrome = {
      storage: {
        local: {
          get: async (keys: string | string[] | Record<string, unknown>) => {
            const result: Record<string, unknown> = {};
            const keyList = Array.isArray(keys)
              ? keys
              : typeof keys === "string"
                ? [keys]
                : Object.keys(keys);
            for (const k of keyList) {
              if (mockStorage.has(k)) {
                result[k] = mockStorage.get(k);
              }
            }
            return result;
          },
          set: async (items: Record<string, unknown>) => {
            for (const [k, v] of Object.entries(items)) {
              mockStorage.set(k, v);
            }
          },
        },
      },
    };
  });

  afterEach(() => {
    (globalThis as any).chrome = originalChrome;
  });

  test("loadAppSettings returns DEFAULT_APP_SETTINGS when storage is completely empty", async () => {
    const loaded = await loadAppSettings();
    assert.deepEqual(loaded, DEFAULT_APP_SETTINGS);
  });

  test("loadAppSettings migrates and backfills legacy recording options and language preference", async () => {
    // 注入老版本数据（无 app-settings，仅有 last-recording-options 和 user_language_preference）
    mockStorage.set("user_language_preference", "zh-CN");
    mockStorage.set("last-recording-options", {
      captureVideo: false,
      captureAudio: true,
      captureScreenshots: false,
      captureConsole: false,
      captureNetwork: true,
      captureNetworkBodies: false, // 对应 responseBodyPolicy: "disabled"
      captureFullResponseBody: false,
      captureFrameworkState: false,
      privacyMode: "raw",
    });

    const loaded = await loadAppSettings();

    // 验证语言回填
    assert.equal(loaded.workflow.language, "zh-CN");
    // 验证录制通道回填与升级转换
    assert.equal(loaded.defaultRecording.captureVideo, false);
    assert.equal(loaded.defaultRecording.captureAudio, true);
    assert.equal(loaded.defaultRecording.captureScreenshots, false);
    assert.equal(loaded.defaultRecording.captureConsole, false);
    assert.equal(loaded.defaultRecording.captureNetwork, true);
    assert.equal(loaded.defaultRecording.responseBodyPolicy, "disabled");
    assert.equal(loaded.defaultRecording.captureFrameworkState, false);
    assert.equal(loaded.defaultRecording.privacyMode, "raw");
    // 验证其他未迁移字段正确保留缺省配置
    assert.equal(loaded.ai.targetAssistant, "generic");
    assert.equal(loaded.storage.retentionDays, 14);
  });

  test("loadAppSettings correctly converts captureFullResponseBody to full policy", async () => {
    mockStorage.set("last-recording-options", {
      captureVideo: true,
      captureNetworkBodies: true,
      captureFullResponseBody: true,
    });

    const loaded = await loadAppSettings();
    assert.equal(loaded.defaultRecording.responseBodyPolicy, "full");
  });

  test("loadAppSettings correctly converts standard network body option", async () => {
    mockStorage.set("last-recording-options", {
      captureVideo: true,
      captureNetworkBodies: true,
      captureFullResponseBody: false,
    });

    const loaded = await loadAppSettings();
    assert.equal(loaded.defaultRecording.responseBodyPolicy, "standard");
  });

  test("loadAppSettings reads existing app-settings directly and deep merges missing properties", async () => {
    mockStorage.set(APP_SETTINGS_STORAGE_KEY, {
      workflow: {
        language: "en-US",
        stopAction: "silentExport",
      },
      ai: {
        targetAssistant: "claude-code",
      },
    });

    const loaded = await loadAppSettings();
    assert.equal(loaded.workflow.language, "en-US");
    assert.equal(loaded.workflow.stopAction, "silentExport");
    assert.equal(loaded.ai.targetAssistant, "claude-code");
    // 缺省的 defaultRecording、storage 和 privacy 均由 DEFAULT_APP_SETTINGS 补齐
    assert.equal(loaded.defaultRecording.captureVideo, true);
    assert.equal(loaded.storage.retentionDays, 14);
  });

  test("saveAppSettings persists app-settings and mirrors recording options to legacy storage key", async () => {
    const updated = await saveAppSettings({
      workflow: {
        ...DEFAULT_APP_SETTINGS.workflow,
        language: "en-US",
        stopAction: "silentExport",
      },
      defaultRecording: {
        ...DEFAULT_APP_SETTINGS.defaultRecording,
        captureAudio: true,
        responseBodyPolicy: "full",
        privacyMode: "raw",
      },
      storage: {
        ...DEFAULT_APP_SETTINGS.storage,
        compressionLevel: "quality",
        maxSessionBytes: 1024 * 1024 * 1024,
      },
    });

    // 验证返回值
    assert.equal(updated.workflow.language, "en-US");
    assert.equal(updated.defaultRecording.captureAudio, true);
    assert.equal(updated.defaultRecording.responseBodyPolicy, "full");
    assert.equal(updated.storage.compressionLevel, "quality");

    // 验证 chrome.storage.local 写入的 APP_SETTINGS_STORAGE_KEY
    const savedAppSettings = mockStorage.get(
      APP_SETTINGS_STORAGE_KEY
    ) as AppSettings;
    assert.ok(savedAppSettings, "APP_SETTINGS_STORAGE_KEY 必须被写入");
    assert.equal(savedAppSettings.workflow.language, "en-US");
    assert.equal(savedAppSettings.defaultRecording.captureAudio, true);

    // 验证镜像回写至 last-recording-options 的结构与字段映射
    const mirroredOptions = mockStorage.get("last-recording-options") as any;
    assert.ok(mirroredOptions, "last-recording-options 必须被镜像写入");
    assert.equal(mirroredOptions.captureVideo, true);
    assert.equal(mirroredOptions.captureAudio, true);
    assert.equal(mirroredOptions.captureScreenshots, true);
    assert.equal(mirroredOptions.captureConsole, true);
    assert.equal(mirroredOptions.captureNetwork, true);
    assert.equal(
      mirroredOptions.captureNetworkBodies,
      true,
      "responseBodyPolicy 为 full 时 captureNetworkBodies 应为 true"
    );
    assert.equal(
      mirroredOptions.captureFullResponseBody,
      true,
      "responseBodyPolicy 为 full 时 captureFullResponseBody 应为 true"
    );
    assert.equal(mirroredOptions.privacyMode, "raw");
    assert.equal(
      mirroredOptions.videoBitsPerSecond,
      VIDEO_BITRATE_BY_COMPRESSION.quality
    );
    assert.equal(mirroredOptions.maxSessionBytes, 1024 * 1024 * 1024);
  });

  test("saveAppSettings supports functional state updater", async () => {
    // 先保存初始状态
    await saveAppSettings({
      storage: {
        ...DEFAULT_APP_SETTINGS.storage,
        retentionDays: 30,
      },
    });

    // 使用函数更新器递增/修改
    const updated = await saveAppSettings((prev) => ({
      ...prev,
      storage: {
        ...prev.storage,
        retentionDays: 90,
      },
    }));

    assert.equal(updated.storage.retentionDays, 90);
    const inStorage = mockStorage.get(APP_SETTINGS_STORAGE_KEY) as AppSettings;
    assert.equal(inStorage.storage.retentionDays, 90);
  });

  test("loadAppSettings degrades safely when storage read throws exception", async () => {
    (globalThis as any).chrome = {
      storage: {
        local: {
          get: async () => {
            throw new Error("Storage quota exceeded or disk disconnected");
          },
        },
      },
    };

    const loaded = await loadAppSettings();
    assert.deepEqual(loaded, DEFAULT_APP_SETTINGS);
  });

  test("saveAppSettings degrades safely when storage write throws exception", async () => {
    (globalThis as any).chrome = {
      storage: {
        local: {
          get: async () => ({}),
          set: async () => {
            throw new Error("Storage write permission denied");
          },
        },
      },
    };

    const result = await saveAppSettings({
      workflow: { ...DEFAULT_APP_SETTINGS.workflow, language: "en-US" },
    });
    assert.equal(result.workflow.language, "en-US");
  });

  test("loadAppSettings and saveAppSettings degrade safely when chrome is undefined", async () => {
    (globalThis as any).chrome = undefined;

    const loaded = await loadAppSettings();
    assert.deepEqual(loaded, DEFAULT_APP_SETTINGS);

    const saved = await saveAppSettings({
      workflow: { ...DEFAULT_APP_SETTINGS.workflow, language: "en-US" },
    });
    assert.equal(saved.workflow.language, "en-US");
  });

  test("loadAppSettings migrates with only user_language_preference present", async () => {
    mockStorage.set("user_language_preference", "en-US");

    const loaded = await loadAppSettings();
    assert.equal(loaded.workflow.language, "en-US");
    assert.deepEqual(
      loaded.defaultRecording,
      DEFAULT_APP_SETTINGS.defaultRecording
    );
  });

  test("loadAppSettings migrates with empty object in last-recording-options", async () => {
    mockStorage.set("last-recording-options", {});

    const loaded = await loadAppSettings();
    assert.equal(loaded.defaultRecording.captureVideo, true);
    assert.equal(loaded.defaultRecording.captureAudio, false);
    assert.equal(loaded.defaultRecording.responseBodyPolicy, "standard");
    assert.equal(loaded.defaultRecording.privacyMode, "safe");
  });

  test("loadAppSettings handles non-raw privacyMode fallback to safe", async () => {
    mockStorage.set("last-recording-options", {
      privacyMode: "nonStandardMode",
    });

    const loaded = await loadAppSettings();
    assert.equal(loaded.defaultRecording.privacyMode, "safe");
  });

  test("saveAppSettings preserves sibling properties during deep partial save", async () => {
    // 首次保存 workflow 设置
    await saveAppSettings({
      workflow: {
        ...DEFAULT_APP_SETTINGS.workflow,
        language: "zh-CN",
        stopAction: "silentExport",
      },
    });

    // 仅更新 storage.retentionDays，不传 workflow
    const updated = await saveAppSettings({
      storage: {
        ...DEFAULT_APP_SETTINGS.storage,
        retentionDays: 90,
      },
    });

    assert.equal(updated.storage.retentionDays, 90);
    // 原有的 workflow.stopAction 应完整保留
    assert.equal(updated.workflow.stopAction, "silentExport");
    assert.equal(updated.workflow.language, "zh-CN");
  });
});
