import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import {
  getSessionTitle,
  message,
  type RecordingSession,
} from "../src/shared/protocol.ts";
import { db } from "../src/storage/db.ts";
import {
  createTestRuntime,
  makeSession,
} from "./helpers/background-runtime-harness.ts";
import { installChromeMock } from "./helpers/chrome-mock.ts";

installChromeMock();

test("getSessionTitle utility handles customTitle, initialTitle, and fallbacks", () => {
  assert.equal(getSessionTitle(undefined, "fallback"), "fallback");
  assert.equal(getSessionTitle(null, "fallback"), "fallback");

  // 仅有 initialTitle
  const session1 = {
    target: { initialTitle: "Page Title 1" },
  };
  assert.equal(getSessionTitle(session1, "fallback"), "Page Title 1");

  // 有 customTitle 时优先使用 customTitle
  const session2 = {
    customTitle: "My Custom Bug",
    target: { initialTitle: "Page Title 1" },
  };
  assert.equal(getSessionTitle(session2, "fallback"), "My Custom Bug");

  // customTitle 为全空格时回退到 initialTitle
  const session3 = {
    customTitle: "   ",
    target: { initialTitle: "Page Title 1" },
  };
  assert.equal(getSessionTitle(session3, "fallback"), "Page Title 1");

  // customTitle 与 initialTitle 均为空时使用 fallback
  const session4 = {
    customTitle: "",
    target: { initialTitle: "" },
  };
  assert.equal(getSessionTitle(session4, "fallback"), "fallback");
});

test("db.listSessionOverviews matches customTitle in search queries", async () => {
  const sessionId = "sess-custom-title-1";
  const session: RecordingSession = {
    id: sessionId,
    schemaVersion: 2,
    extensionVersion: "0.1.0",
    status: "PREVIEW_READY",
    customTitle: "结算页支付按钮点击无响应",
    target: {
      tabId: 10,
      initialUrl: "https://shop.example.test/checkout",
      initialTitle: "Checkout Page",
    },
    options: {
      captureAudio: false,
      captureVideo: true,
      captureScreenshots: true,
      captureConsole: true,
      captureNetwork: true,
      captureNetworkBodies: true,
      privacyMode: "safe",
      mediaTimesliceMs: 1000,
      maxResponseBodyBytes: 1024,
      maxSessionBytes: 100 * 1024 * 1024,
    },
    timeline: { createdAtEpochMs: Date.now() },
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
    nonce: "nonce-custom-title-1",
  };

  await db.saveSession(session);

  // 1. 通过 customTitle 关键词查询
  const matchedCustom = await db.listSessionOverviews("支付按钮");
  assert.equal(
    matchedCustom.some((item) => item.session.id === sessionId),
    true
  );

  // 2. 通过 initialTitle 关键词查询（仍然兼容）
  const matchedInitial = await db.listSessionOverviews("Checkout");
  assert.equal(
    matchedInitial.some((item) => item.session.id === sessionId),
    true
  );

  // 3. 不匹配的关键词
  const notMatched = await db.listSessionOverviews("完全不相关的关键词999");
  assert.equal(
    notMatched.some((item) => item.session.id === sessionId),
    false
  );
});

test("message-router handles session/rename correctly", async () => {
  const { runtime, db: memDb } = createTestRuntime();
  const sessionId = "sess-rename-router-1";
  const session = makeSession({
    id: sessionId,
    status: "PREVIEW_READY",
    target: {
      tabId: 12,
      initialUrl: "https://example.test",
      initialTitle: "Initial Title",
    },
  });

  memDb.sessions.set(sessionId, session);

  const sender = {
    tab: { id: 1 },
    url: "chrome-extension://id/popup.html",
    frameId: 0,
  } as chrome.runtime.MessageSender;

  const res = (await runtime.handleMessage(
    message("session/rename", {
      sessionId,
      title: "新自定义名称",
    }),
    sender
  )) as { ok: boolean; session?: RecordingSession };

  assert.equal(res?.ok, true);
  assert.equal(res?.session?.customTitle, "新自定义名称");

  const stored = await memDb.getSession(sessionId);
  assert.equal(stored?.customTitle, "新自定义名称");

  // 清空重命名（应置为 undefined）
  const clearRes = (await runtime.handleMessage(
    message("session/rename", {
      sessionId,
      title: "   ",
    }),
    sender
  )) as { ok: boolean; session?: RecordingSession };

  assert.equal(clearRes?.ok, true);
  assert.equal(clearRes?.session?.customTitle, undefined);

  const storedAfterClear = await memDb.getSession(sessionId);
  assert.equal(storedAfterClear?.customTitle, undefined);
});
