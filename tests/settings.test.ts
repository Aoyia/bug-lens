import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_APP_SETTINGS,
  mergeAppSettings,
  type AppSettings,
} from "../src/shared/settings.ts";
import { buildAiPrompt } from "../src/preview/evidence-package.ts";

describe("AppSettings Domain & Schema", () => {
  test("mergeAppSettings retains defaults when passed empty or invalid objects", () => {
    const res1 = mergeAppSettings(DEFAULT_APP_SETTINGS, undefined);
    assert.deepEqual(res1, DEFAULT_APP_SETTINGS);

    const res2 = mergeAppSettings(DEFAULT_APP_SETTINGS, null);
    assert.deepEqual(res2, DEFAULT_APP_SETTINGS);

    const res3 = mergeAppSettings(DEFAULT_APP_SETTINGS, {});
    assert.deepEqual(res3, DEFAULT_APP_SETTINGS);
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
});
