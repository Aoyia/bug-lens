import assert from "node:assert/strict";
import test from "node:test";

import { InteractionCapture } from "../src/recording/interaction-capture.ts";
import type { RecordingSessionEvent } from "../src/domain/recording-session.ts";
import { installChromeMock } from "./helpers/chrome-mock.ts";
import type {
  InteractionRecord,
  RecordingSession,
} from "../src/shared/protocol.ts";

const session: RecordingSession = {
  id: "session",
  schemaVersion: 2,
  extensionVersion: "0.1.0",
  status: "RECORDING",
  target: {
    tabId: 7,
    initialUrl: "https://example.test",
    initialTitle: "Example",
  },
  options: {
    captureAudio: false,
    captureVideo: false,
    captureScreenshots: false,
    captureConsole: true,
    captureNetwork: true,
    captureNetworkBodies: false,
    privacyMode: "safe",
    mediaTimesliceMs: 1_000,
    maxResponseBodyBytes: 1_000,
    maxSessionBytes: 1_000_000,
  },
  timeline: { createdAtEpochMs: 1, startedAtEpochMs: 2 },
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
  nonce: "page-nonce",
};

const interaction: InteractionRecord = {
  id: "interaction",
  sessionId: "page-nonce",
  kind: "click",
  status: "candidate",
  createdAt: 3,
  page: { url: "https://example.test", title: "Example", frameId: 0 },
  input: { pointerType: "mouse", button: 0, isTrusted: true },
  coordinates: {
    clientX: 1,
    clientY: 2,
    pageX: 1,
    pageY: 2,
    scrollX: 0,
    scrollY: 0,
    devicePixelRatio: 1,
    viewport: { width: 800, height: 600 },
  },
  element: {
    tagName: "BUTTON",
    classNames: [],
    attributes: {},
    boundingBox: { x: 0, y: 0, width: 10, height: 10 },
    locators: [],
  },
  screenshot: { status: "pending" },
};

test("interaction capture serializes accepted events behind one capture interface", async () => {
  let stored: InteractionRecord | undefined;
  const sessionEvents: RecordingSessionEvent[] = [];
  const capture = new InteractionCapture(
    {
      getActiveSession: async () => session,
      getInteraction: async () => stored,
      saveInteractionWithinBudget: async (next) => {
        stored = next;
        return { stored: true, usedBytes: 1, limitReached: false };
      },
    },
    async (_sessionId, event) => {
      sessionEvents.push(event);
      return session;
    },
    () => false
  );

  await capture.handle(interaction, {
    tab: { id: 7 },
  } as chrome.runtime.MessageSender);

  assert.equal(stored?.sessionId, session.id);
  assert.equal(stored?.screenshot.status, "disabled");
  assert.deepEqual(sessionEvents, [
    {
      type: "quality-delta",
      delta: { interactionCount: 1, confirmedInteractionCount: 0 },
    },
  ]);
  assert.deepEqual(await capture.drain(), []);
});

test("iframe 内交互（sender.frameId > 0）在坐标归一化后正常执行截图与标注，不再抛出 FRAME_GEOMETRY_UNAVAILABLE", async () => {
  installChromeMock({
    tabsQuery: async () => [{ id: 7, active: true }],
    captureVisibleTab: async () => "data:image/jpeg;base64,QUFB",
    sendMessage: async () => ({
      ok: true,
      dataUrl: "data:image/jpeg;base64,QU5OT1RBVEVE",
    }),
  });

  let stored: InteractionRecord | undefined;
  let savedAsset: unknown;
  const sessionEvents: RecordingSessionEvent[] = [];
  const iframeSession: RecordingSession = {
    ...session,
    options: { ...session.options, captureScreenshots: true },
  };
  const capture = new InteractionCapture(
    {
      getActiveSession: async () => iframeSession,
      getInteraction: async () => stored,
      saveInteractionWithinBudget: async (next) => {
        stored = next;
        return { stored: true, usedBytes: 1, limitReached: false };
      },
      saveEvidenceAssetWithinBudget: async (asset) => {
        savedAsset = asset;
        return { stored: true, usedBytes: 1, limitReached: false };
      },
    },
    async (_sessionId, event) => {
      sessionEvents.push(event);
      return iframeSession;
    },
    () => false
  );

  const iframeInteraction: InteractionRecord = {
    ...interaction,
    page: { ...interaction.page, frameId: -1 },
    coordinates: {
      ...interaction.coordinates,
      clientX: 150,
      clientY: 250,
      localX: 50,
      localY: 50,
    },
  };

  await capture.handle(iframeInteraction, {
    tab: { id: 7 },
    frameId: 1,
  } as chrome.runtime.MessageSender);

  assert.equal(stored?.page.frameId, 1, "应权威绑定 sender.frameId 并纠正 -1");
  assert.equal(
    stored?.screenshot.status,
    "captured",
    "截图状态应成功变为 captured"
  );
  if (stored?.screenshot.status === "captured") {
    assert.equal(stored.screenshot.source, "primary", "来源应为 primary");
  }
  assert.ok(savedAsset, "应保存标注后的截图资产");

  const qualityDelta = sessionEvents.find(
    (e): e is Extract<RecordingSessionEvent, { type: "quality-delta" }> =>
      e.type === "quality-delta" && "primaryScreenshotCount" in e.delta
  );
  assert.ok(qualityDelta, "应上报 primaryScreenshotCount 增量");
  assert.equal(qualityDelta.delta.primaryScreenshotCount, 1);
  assert.deepEqual(await capture.drain(), []);
});

test("开启截图且 Offscreen 标注成功时保存 primary 截图", async () => {
  installChromeMock({
    tabsQuery: async () => [{ id: 7, active: true }],
    captureVisibleTab: async () => "data:image/jpeg;base64,QUFB",
    sendMessage: async () => ({
      ok: true,
      dataUrl: "data:image/jpeg;base64,QU5OT1RBVEVE",
    }),
  });

  let storedInteraction: InteractionRecord | undefined;
  let savedAsset: unknown;
  const sessionEvents: RecordingSessionEvent[] = [];
  const screenshotSession: RecordingSession = {
    ...session,
    options: { ...session.options, captureScreenshots: true },
  };

  const capture = new InteractionCapture(
    {
      getActiveSession: async () => screenshotSession,
      getInteraction: async () => storedInteraction,
      saveInteractionWithinBudget: async (next) => {
        storedInteraction = next;
        return { stored: true, usedBytes: 1, limitReached: false };
      },
      saveEvidenceAssetWithinBudget: async (asset) => {
        savedAsset = asset;
        return { stored: true, usedBytes: 1, limitReached: false };
      },
    },
    async (_sessionId, event) => {
      sessionEvents.push(event);
      return screenshotSession;
    },
    () => false
  );

  await capture.handle(interaction, {
    tab: { id: 7 },
    frameId: 0,
  } as chrome.runtime.MessageSender);

  assert.equal(storedInteraction?.screenshot.status, "captured");
  if (storedInteraction?.screenshot.status === "captured") {
    assert.equal(storedInteraction.screenshot.source, "primary");
  }
  assert.ok(savedAsset, "应已保存截图资产");
  const qualityDelta = sessionEvents.find(
    (e): e is Extract<RecordingSessionEvent, { type: "quality-delta" }> =>
      e.type === "quality-delta" && "primaryScreenshotCount" in e.delta
  );
  assert.ok(qualityDelta, "应上报 primaryScreenshotCount 增量");
  assert.equal(qualityDelta.delta.primaryScreenshotCount, 1);
  assert.deepEqual(await capture.drain(), []);
});

test("开启截图但 Offscreen 标注超时或失败时自动降级保存 fallback 原图", async () => {
  installChromeMock({
    tabsQuery: async () => [{ id: 7, active: true }],
    captureVisibleTab: async () => "data:image/jpeg;base64,RAWIMAGE",
    sendMessage: async () => {
      throw new Error("OFFSCREEN_COMMUNICATION_ERROR");
    },
  });

  let storedInteraction: InteractionRecord | undefined;
  let savedAsset: any;
  const sessionEvents: RecordingSessionEvent[] = [];
  const screenshotSession: RecordingSession = {
    ...session,
    options: { ...session.options, captureScreenshots: true },
  };

  const capture = new InteractionCapture(
    {
      getActiveSession: async () => screenshotSession,
      getInteraction: async () => storedInteraction,
      saveInteractionWithinBudget: async (next) => {
        storedInteraction = next;
        return { stored: true, usedBytes: 1, limitReached: false };
      },
      saveEvidenceAssetWithinBudget: async (asset) => {
        savedAsset = asset;
        return { stored: true, usedBytes: 1, limitReached: false };
      },
    },
    async (_sessionId, event) => {
      sessionEvents.push(event);
      return screenshotSession;
    },
    () => false
  );

  await capture.handle(interaction, {
    tab: { id: 7 },
    frameId: 0,
  } as chrome.runtime.MessageSender);

  assert.equal(
    storedInteraction?.screenshot.status,
    "captured",
    "降级后截图状态仍应为 captured"
  );
  if (storedInteraction?.screenshot.status === "captured") {
    assert.equal(
      storedInteraction.screenshot.source,
      "fallback",
      "来源应标记为 fallback"
    );
  }
  assert.ok(savedAsset, "降级原图应已写入资产库，绝不丢图");
  const qualityDelta = sessionEvents.find(
    (e): e is Extract<RecordingSessionEvent, { type: "quality-delta" }> =>
      e.type === "quality-delta" && "fallbackScreenshotCount" in e.delta
  );
  assert.ok(qualityDelta, "应上报 fallbackScreenshotCount 增量");
  assert.equal(qualityDelta.delta.fallbackScreenshotCount, 1);
  assert.deepEqual(await capture.drain(), []);
});

test("子 iframe 视口退化时，resolveTopViewport 兜底为 session 权威顶层视口并正确传递给 Offscreen 标注", async () => {
  let offscreenPayload: any;
  const validBase64 = Buffer.from("VALID_TEST_IMAGE_DATA").toString("base64");
  installChromeMock({
    tabsQuery: async () => [{ id: 7, active: true }],
    captureVisibleTab: async () => `data:image/jpeg;base64,${validBase64}`,
    sendMessage: async (msg: any) => {
      if (msg?.type === "offscreen/annotate-image") {
        offscreenPayload = msg.payload;
        return { ok: true, dataUrl: `data:image/jpeg;base64,${validBase64}` };
      }
      return { ok: true };
    },
  });

  let storedInteraction: InteractionRecord | undefined;
  let savedAsset: any;
  const sessionWithEnv: RecordingSession = {
    ...session,
    target: {
      ...session.target,
      environment: {
        userAgent: "Chrome",
        platform: "MacIntel",
        language: "zh-CN",
        screenWidth: 1920,
        screenHeight: 1080,
        devicePixelRatio: 1,
        viewportWidth: 1920,
        viewportHeight: 1080,
        online: true,
        capturedAtEpochMs: Date.now(),
      },
    },
    options: { ...session.options, captureScreenshots: true },
  };

  const capture = new InteractionCapture(
    {
      getActiveSession: async () => sessionWithEnv,
      getInteraction: async () => storedInteraction,
      saveInteractionWithinBudget: async (next) => {
        storedInteraction = next;
        return { stored: true, usedBytes: 1, limitReached: false };
      },
      saveEvidenceAssetWithinBudget: async (asset) => {
        savedAsset = asset;
        return { stored: true, usedBytes: 1, limitReached: false };
      },
    },
    async () => sessionWithEnv,
    () => false
  );

  const childDegradedInteraction: InteractionRecord = {
    ...interaction,
    id: "child-degraded-int",
    page: { ...interaction.page, frameId: 3 },
    coordinates: {
      ...interaction.coordinates,
      viewport: { width: 320, height: 240 }, // 退化视口
    },
  };

  await capture.handle(childDegradedInteraction, {
    tab: { id: 7 },
    frameId: 3,
  } as chrome.runtime.MessageSender);

  assert.ok(offscreenPayload, "应向 offscreen 发送 annotate 消息");
  assert.equal(
    offscreenPayload.viewportWidth,
    1920,
    "Offscreen 批注视口宽度应被 resolveTopViewport 纠正为权威顶层视口 1920"
  );
  assert.equal(
    offscreenPayload.viewportHeight,
    1080,
    "Offscreen 批注视口高度应被 resolveTopViewport 纠正为权威顶层视口 1080"
  );
  assert.equal(
    storedInteraction?.coordinates.viewport.width,
    1920,
    "落库的交互记录视口宽度应为 1920"
  );
  assert.equal(savedAsset?.width, 1920, "落库的截图资产宽度应为 1920");
});
