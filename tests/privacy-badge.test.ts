import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { applyPrivacyBadge } from "../src/preview/privacy-badge.ts";
import type { RecordingSession } from "../src/shared/protocol.ts";

function makeBadgeElement() {
  return {
    hidden: true,
    textContent: "",
    title: "",
    classList: {
      _raw: false,
      _safe: false,
      toggle(cls: string, force: boolean) {
        if (cls === "is-raw") this._raw = force;
        if (cls === "is-safe") this._safe = force;
      },
    },
  };
}

function makeSession(mode: "safe" | "raw"): RecordingSession {
  return {
    id: "s1",
    schemaVersion: 2,
    extensionVersion: "0.4.0",
    status: "PREVIEW_READY",
    target: { tabId: 1, initialUrl: "https://example.test", initialTitle: "" },
    options: {
      captureAudio: false,
      captureVideo: true,
      captureScreenshots: true,
      captureConsole: true,
      captureNetwork: true,
      captureNetworkBodies: false,
      privacyMode: mode,
      mediaTimesliceMs: 1_000,
      maxResponseBodyBytes: 1_000,
      maxSessionBytes: 1_000_000,
    },
    timeline: { createdAtEpochMs: 1 },
    quality: {
      overall: "complete",
      interactionCount: 0,
      confirmedInteractionCount: 0,
      primaryScreenshotCount: 0,
      fallbackScreenshotCount: 0,
      unavailableScreenshotCount: 0,
      consoleEntryCount: 0,
      networkEntryCount: 0,
      issues: [],
    },
    nonce: "n",
  };
}

// i18n：注入最小字典，让 t() 返回真实文案而非 key
const zhDict = {
  privacyModeSafe: { message: "安全模式" },
  privacyModeSafeDesc: { message: "安全模式描述" },
  privacyModeRaw: { message: "原始模式 · 未脱敏" },
  privacyModeRawDesc: { message: "原始模式描述" },
};

beforeEach(() => {
  (globalThis as Record<string, unknown>).window = {
    __WEB_BUG_REPORT_I18N__: { locale: "zh-CN", dict: zhDict },
  };
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
});

test("raw 模式显示红色警示角标并提示未脱敏（C12）", () => {
  const badge = makeBadgeElement();
  applyPrivacyBadge(
    { getElementById: (id: string) => (id === "privacy-badge" ? badge : null) },
    makeSession("raw")
  );
  assert.equal(badge.hidden, false);
  assert.equal(badge.textContent, "原始模式 · 未脱敏");
  assert.equal(badge.classList._raw, true);
  assert.equal(badge.classList._safe, false);
  assert.ok(badge.title.includes("原始模式"), "title 应警示原始模式");
});

test("safe 模式显示中性角标（C12）", () => {
  const badge = makeBadgeElement();
  applyPrivacyBadge(
    { getElementById: (id: string) => (id === "privacy-badge" ? badge : null) },
    makeSession("safe")
  );
  assert.equal(badge.hidden, false);
  assert.equal(badge.textContent, "安全模式");
  assert.equal(badge.classList._safe, true);
  assert.equal(badge.classList._raw, false);
});

test("无会话时角标保持隐藏（C12）", () => {
  const badge = makeBadgeElement();
  applyPrivacyBadge(
    { getElementById: (id: string) => (id === "privacy-badge" ? badge : null) },
    undefined
  );
  assert.equal(badge.hidden, true);
});

test("缺少角标元素时静默返回（C12）", () => {
  assert.doesNotThrow(() =>
    applyPrivacyBadge({ getElementById: () => null }, makeSession("raw"))
  );
});
