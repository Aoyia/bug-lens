import assert from "node:assert/strict";
import test from "node:test";

import { InteractionCapture } from "../src/recording/interaction-capture.ts";
import { applyInteractionEvent } from "../src/domain/interaction-ledger.ts";
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

test("CDP 截图通道挂起（超时）时，自动降级至 captureVisibleTab 且队列不被死锁阻塞", async () => {
  const validBase64 = Buffer.from("FALLBACK_IMAGE_DATA").toString("base64");
  let fallbackCalls = 0;
  installChromeMock({
    tabsQuery: async () => [{ id: 7, active: true }],
    captureVisibleTab: async () => {
      fallbackCalls++;
      return `data:image/jpeg;base64,${validBase64}`;
    },
    sendMessage: async () => ({
      ok: true,
      dataUrl: `data:image/jpeg;base64,${validBase64}`,
    }),
  });

  // 模拟 CDP Page.captureScreenshot 挂起（永久不返回）
  (globalThis as any).chrome.debugger = {
    sendCommand: async (_target: any, method: string) => {
      if (method === "Page.captureScreenshot") {
        return new Promise(() => {}); // 挂起
      }
      return {};
    },
  };

  const storedMap = new Map<string, InteractionRecord>();
  const screenshotSession: RecordingSession = {
    ...session,
    options: { ...session.options, captureScreenshots: true },
  };

  // 设置短超时 50ms 加速单元测试
  const capture = new InteractionCapture(
    {
      getActiveSession: async () => screenshotSession,
      getInteraction: async (id) => storedMap.get(id),
      saveInteractionWithinBudget: async (next) => {
        storedMap.set(next.id, next);
        return { stored: true, usedBytes: 1, limitReached: false };
      },
      saveEvidenceAssetWithinBudget: async () => {
        return { stored: true, usedBytes: 1, limitReached: false };
      },
      getInteractions: async () => Array.from(storedMap.values()),
    },
    async () => screenshotSession,
    () => false,
    50
  );

  const int1: InteractionRecord = { ...interaction, id: "int-timeout-1" };
  const int2: InteractionRecord = { ...interaction, id: "int-timeout-2" };

  await Promise.all([
    capture.handle(int1, { tab: { id: 7 }, frameId: 0 } as any),
    capture.handle(int2, { tab: { id: 7 }, frameId: 0 } as any),
  ]);

  assert.equal(
    fallbackCalls,
    2,
    "两笔交互均应在 CDP 超时后平稳降级至 captureVisibleTab"
  );
  assert.equal(storedMap.get("int-timeout-1")?.screenshot.status, "captured");
  assert.equal(storedMap.get("int-timeout-1")?.screenshot.source, "primary");
  assert.equal(storedMap.get("int-timeout-2")?.screenshot.status, "captured");
  assert.equal(storedMap.get("int-timeout-2")?.screenshot.source, "primary");
  assert.deepEqual(await capture.drain(), []);
});

test("底层截图双通道均挂起超时时，截图置为 unavailable，队列正常推进且后续交互不受阻断", async () => {
  let fallbackHanging = true;
  const validBase64 = Buffer.from("RECOVERED_IMAGE_DATA").toString("base64");

  installChromeMock({
    tabsQuery: async () => [{ id: 7, active: true }],
    captureVisibleTab: async () => {
      if (fallbackHanging) {
        return new Promise(() => {}); // 挂起
      }
      return `data:image/jpeg;base64,${validBase64}`;
    },
    sendMessage: async () => ({
      ok: true,
      dataUrl: `data:image/jpeg;base64,${validBase64}`,
    }),
  });

  (globalThis as any).chrome.debugger = {
    sendCommand: async () => new Promise(() => {}), // CDP 始终挂起
  };

  const storedMap = new Map<string, InteractionRecord>();
  const screenshotSession: RecordingSession = {
    ...session,
    options: { ...session.options, captureScreenshots: true },
  };

  const capture = new InteractionCapture(
    {
      getActiveSession: async () => screenshotSession,
      getInteraction: async (id) => storedMap.get(id),
      saveInteractionWithinBudget: async (next) => {
        storedMap.set(next.id, next);
        return { stored: true, usedBytes: 1, limitReached: false };
      },
      saveEvidenceAssetWithinBudget: async () => {
        return { stored: true, usedBytes: 1, limitReached: false };
      },
      getInteractions: async () => Array.from(storedMap.values()),
    },
    async () => screenshotSession,
    () => false,
    50
  );

  const intHang: InteractionRecord = { ...interaction, id: "int-hang" };
  // intHang 双通道均挂起，经 50ms + 50ms 超时后失败
  await capture.handle(intHang, { tab: { id: 7 }, frameId: 0 } as any);

  assert.equal(
    storedMap.get("int-hang")?.screenshot.status,
    "unavailable",
    "双通道超时后截图状态应标记为 unavailable"
  );

  // 恢复 captureVisibleTab 通道，验证队列未死锁，下一笔交互能顺利执行
  fallbackHanging = false;
  const intRecover: InteractionRecord = { ...interaction, id: "int-recover" };
  await capture.handle(intRecover, { tab: { id: 7 }, frameId: 0 } as any);

  assert.equal(
    storedMap.get("int-recover")?.screenshot.status,
    "captured",
    "队列未被阻塞，后续交互应能成功捕获截图"
  );
  assert.deepEqual(await capture.drain(), []);
});

test("会话停止调用 drain 时，扫描并收敛所有 pending 状态的交互为 unavailable 终态，且不覆盖已 captured 记录", async () => {
  const storedMap = new Map<string, InteractionRecord>();
  const existingCaptured: InteractionRecord = {
    ...interaction,
    id: "int-captured",
    screenshot: { status: "captured", source: "primary" },
  };
  const pendingInt1: InteractionRecord = {
    ...interaction,
    id: "int-pending-1",
    screenshot: { status: "pending" },
  };
  const pendingInt2: InteractionRecord = {
    ...interaction,
    id: "int-pending-2",
    screenshot: { status: "pending" },
  };
  const cancelledInt: InteractionRecord = {
    ...interaction,
    id: "int-cancelled",
    status: "cancelled",
    screenshot: { status: "pending" },
  };

  storedMap.set(existingCaptured.id, existingCaptured);
  storedMap.set(pendingInt1.id, pendingInt1);
  storedMap.set(pendingInt2.id, pendingInt2);
  storedMap.set(cancelledInt.id, cancelledInt);

  const testSession: RecordingSession = {
    ...session,
    id: "session-drain-converge",
  };

  const capture = new InteractionCapture(
    {
      getActiveSession: async () => testSession,
      getInteraction: async (id) => storedMap.get(id),
      saveInteractionWithinBudget: async (next) => {
        storedMap.set(next.id, next);
        return { stored: true, usedBytes: 1, limitReached: false };
      },
      getInteractions: async () => Array.from(storedMap.values()),
    },
    async () => testSession,
    () => false
  );

  // 执行 drain 收尾排空
  const errors = await capture.drain(1200, testSession.id);
  assert.deepEqual(errors, []);

  // 验证收敛效果
  assert.equal(
    storedMap.get("int-captured")?.screenshot.status,
    "captured",
    "已 captured 的截图不得被错误收敛覆盖"
  );
  assert.equal(
    storedMap.get("int-pending-1")?.screenshot.status,
    "unavailable",
    "pending 状态的交互必须统一收敛为 unavailable"
  );
  assert.equal(
    storedMap.get("int-pending-2")?.screenshot.status,
    "unavailable",
    "pending 状态的交互必须统一收敛为 unavailable"
  );
  assert.equal(
    storedMap.get("int-cancelled")?.status,
    "cancelled",
    "已取消的交互保持 cancelled"
  );
  assert.equal(
    storedMap.get("int-cancelled")?.screenshot.status,
    "unavailable",
    "已取消但截图处于 pending 的交互同样必须收敛为 unavailable"
  );
});

test("CDP 超时后触发熔断器，后续交互直接降级走备选通道，不再重复请求 CDP", async () => {
  const validBase64 = Buffer.from("FALLBACK_IMG").toString("base64");
  let cdpCalls = 0;
  let fallbackCalls = 0;

  installChromeMock({
    tabsQuery: async () => [{ id: 7, active: true }],
    captureVisibleTab: async () => {
      fallbackCalls++;
      return `data:image/jpeg;base64,${validBase64}`;
    },
    sendMessage: async () => ({
      ok: true,
      dataUrl: `data:image/jpeg;base64,${validBase64}`,
    }),
  });

  (globalThis as any).chrome.debugger = {
    sendCommand: async (_target: any, method: string) => {
      if (method === "Page.captureScreenshot") {
        cdpCalls++;
        return new Promise(() => {}); // 挂起触发超时
      }
      return {};
    },
  };

  const storedMap = new Map<string, InteractionRecord>();
  const screenshotSession: RecordingSession = {
    ...session,
    options: { ...session.options, captureScreenshots: true },
  };

  const capture = new InteractionCapture(
    {
      getActiveSession: async () => screenshotSession,
      getInteraction: async (id) => storedMap.get(id),
      saveInteractionWithinBudget: async (next) => {
        storedMap.set(next.id, next);
        return { stored: true, usedBytes: 1, limitReached: false };
      },
      saveEvidenceAssetWithinBudget: async () => {
        return { stored: true, usedBytes: 1, limitReached: false };
      },
      getInteractions: async () => Array.from(storedMap.values()),
    },
    async () => screenshotSession,
    () => false,
    30 // 30ms 极短超时
  );

  const int1: InteractionRecord = { ...interaction, id: "int-cb-1" };
  const int2: InteractionRecord = { ...interaction, id: "int-cb-2" };

  // 第一笔交互：CDP 超时 -> 触发熔断器 -> 降级走 fallback
  await capture.handle(int1, { tab: { id: 7 }, frameId: 0 } as any);
  assert.equal(cdpCalls, 1, "第 1 笔交互应尝试 CDP 调用");
  assert.equal(fallbackCalls, 1, "第 1 笔交互应降级至 fallback");
  assert.equal(storedMap.get("int-cb-1")?.screenshot.status, "captured");

  // 第二笔交互：熔断器已开，直接走 fallback，不再对 CDP 发起新调用
  await capture.handle(int2, { tab: { id: 7 }, frameId: 0 } as any);
  assert.equal(
    cdpCalls,
    1,
    "熔断器生效后，第 2 笔交互不得再次调用 CDP 浪费超时时间"
  );
  assert.equal(fallbackCalls, 2, "第 2 笔交互应直接由 fallback 捕获");
  assert.equal(storedMap.get("int-cb-2")?.screenshot.status, "captured");

  // reset 后熔断器恢复
  capture.reset();
  const int3: InteractionRecord = { ...interaction, id: "int-cb-3" };
  await capture.handle(int3, { tab: { id: 7 }, frameId: 0 } as any);
  assert.equal(cdpCalls, 2, "reset 之后新会话应重置熔断器并重新尝试 CDP");
  assert.deepEqual(await capture.drain(), []);
});

test("资产存储配额耗尽时，截图状态正确收敛为 unavailable，不残留 pending", async () => {
  const validBase64 = Buffer.from("IMAGE").toString("base64");
  installChromeMock({
    tabsQuery: async () => [{ id: 7, active: true }],
    captureVisibleTab: async () => `data:image/jpeg;base64,${validBase64}`,
    sendMessage: async () => ({
      ok: true,
      dataUrl: `data:image/jpeg;base64,${validBase64}`,
    }),
  });

  const storedMap = new Map<string, InteractionRecord>();
  const screenshotSession: RecordingSession = {
    ...session,
    options: { ...session.options, captureScreenshots: true },
  };

  const capture = new InteractionCapture(
    {
      getActiveSession: async () => screenshotSession,
      getInteraction: async (id) => storedMap.get(id),
      saveInteractionWithinBudget: async (next) => {
        storedMap.set(next.id, next);
        return { stored: true, usedBytes: 1, limitReached: false };
      },
      saveEvidenceAssetWithinBudget: async () => {
        // 模拟证据资产预算已满，拒绝落盘
        return { stored: false, usedBytes: 0, limitReached: true };
      },
      getInteractions: async () => Array.from(storedMap.values()),
    },
    async () => screenshotSession,
    () => false,
    50
  );

  const intQuota: InteractionRecord = {
    ...interaction,
    id: "int-quota-exceeded",
  };
  await capture.handle(intQuota, { tab: { id: 7 }, frameId: 0 } as any);

  const record = storedMap.get("int-quota-exceeded");
  assert.ok(record, "交互记录应存在");
  assert.equal(
    record?.screenshot.status,
    "unavailable",
    "资产预算已满时，截图状态必须置为 unavailable 而非残留 pending"
  );
  assert.deepEqual(await capture.drain(), []);
});

test("高频连续 cancelInteraction 与 finalizePending 并发调用时保持事务隔离性，无 pending 残留", async () => {
  const storedMap = new Map<string, InteractionRecord>();
  const testSession: RecordingSession = {
    ...session,
    id: "session-cancel-race",
  };

  const capture = new InteractionCapture(
    {
      getActiveSession: async () => testSession,
      getInteraction: async (id) => storedMap.get(id),
      saveInteractionWithinBudget: async (next) => {
        // 模拟微延迟，放大竞态窗口
        await new Promise((r) => setTimeout(r, 2));
        storedMap.set(next.id, next);
        return { stored: true, usedBytes: 1, limitReached: false };
      },
      getInteractions: async () => Array.from(storedMap.values()),
    },
    async () => testSession,
    () => false
  );

  // 初始化 5 个处于 pending 状态的交互
  for (let i = 0; i < 5; i++) {
    const item: InteractionRecord = {
      ...interaction,
      id: `int-race-${i}`,
      sessionId: testSession.id,
      status: "candidate",
      screenshot: { status: "pending" },
    };
    storedMap.set(item.id, item);
  }

  // 并发高频执行 cancel 与 finalizePending
  const cancelOps = [0, 1, 2].map((i) =>
    Promise.all([
      capture.cancel(
        `int-race-${i}`,
        storedMap.get(`int-race-${i}`),
        testSession.nonce,
        {
          tab: { id: 7 },
        } as any
      ),
      capture.cancel(
        `int-race-${i}`,
        storedMap.get(`int-race-${i}`),
        testSession.nonce,
        {
          tab: { id: 7 },
        } as any
      ),
    ])
  );

  const drainOp = capture.drain(1200, testSession.id);

  await Promise.all([...cancelOps, drainOp]);

  // 断言所有 5 笔记录均处于合法终态，绝无 pending
  for (let i = 0; i < 5; i++) {
    const rec = storedMap.get(`int-race-${i}`);
    assert.ok(rec, `记录 int-race-${i} 应当存在`);
    assert.notEqual(
      rec?.screenshot.status,
      "pending",
      `记录 int-race-${i} 截图状态绝不能残留为 pending`
    );
    assert.equal(
      rec?.screenshot.status,
      "unavailable",
      `记录 int-race-${i} 截图状态必须收敛为 unavailable`
    );
  }
});

test("Offscreen 标注阶段收到 abort 信号时立即中断熔断，不阻塞 drain 排空", async () => {
  const validBase64 = Buffer.from("OFFSCREEN_HANG").toString("base64");
  installChromeMock({
    tabsQuery: async () => [{ id: 7, active: true }],
    captureVisibleTab: async () => `data:image/jpeg;base64,${validBase64}`,
    sendMessage: async () => {
      // 模拟 Offscreen 标注挂起
      return new Promise(() => {});
    },
  });

  const storedMap = new Map<string, InteractionRecord>();
  const testSession: RecordingSession = {
    ...session,
    options: { ...session.options, captureScreenshots: true },
  };

  const capture = new InteractionCapture(
    {
      getActiveSession: async () => testSession,
      getInteraction: async (id) => storedMap.get(id),
      saveInteractionWithinBudget: async (next) => {
        storedMap.set(next.id, next);
        return { stored: true, usedBytes: 1, limitReached: false };
      },
      saveEvidenceAssetWithinBudget: async () => {
        return { stored: true, usedBytes: 1, limitReached: false };
      },
      getInteractions: async () => Array.from(storedMap.values()),
    },
    async () => testSession,
    () => false,
    200
  );

  const intOffscreen: InteractionRecord = {
    ...interaction,
    id: "int-offscreen-hang",
  };
  const handlePromise = capture.handle(intOffscreen, {
    tab: { id: 7 },
    frameId: 0,
  } as any);

  // 稍微等待进入 offscreen 阶段后触发 abort
  await new Promise((r) => setTimeout(r, 20));
  const t0 = Date.now();
  const errors = await capture.drain(500, testSession.id);
  const elapsed = Date.now() - t0;

  await handlePromise.catch(() => {});

  assert.deepEqual(errors, []);
  assert.ok(
    elapsed < 400,
    `drain 应立即中止，实际耗时 ${elapsed}ms (应远小于 500ms 超时)`
  );
  assert.equal(
    storedMap.get("int-offscreen-hang")?.screenshot.status,
    "unavailable",
    "中断后截图应收敛为 unavailable"
  );
});

test("会话停止导致的截图熔断不生成 SCREENSHOT_ABORTED capture-issue", async () => {
  installChromeMock({
    tabsQuery: async () => [{ id: 7, active: true }],
    // 让 captureVisibleTab 永远挂起，模拟截图执行中被停止
    captureVisibleTab: async () => new Promise(() => {}),
    sendMessage: async () => ({
      ok: true,
      dataUrl: "data:image/jpeg;base64,AAA",
    }),
  });

  const storedMap = new Map<string, InteractionRecord>();
  const sessionEvents: RecordingSessionEvent[] = [];
  let stopping = false;

  const testSession: RecordingSession = {
    ...session,
    id: "session-stop-no-issue",
    options: { ...session.options, captureScreenshots: true },
  };

  const capture = new InteractionCapture(
    {
      getActiveSession: async () => testSession,
      getInteraction: async (id) => storedMap.get(id),
      saveInteractionWithinBudget: async (next) => {
        storedMap.set(next.id, next);
        return { stored: true, usedBytes: 1, limitReached: false };
      },
      saveEvidenceAssetWithinBudget: async () => {
        return { stored: true, usedBytes: 1, limitReached: false };
      },
      getInteractions: async () => Array.from(storedMap.values()),
    },
    async (_sessionId, event) => {
      sessionEvents.push(event);
      return testSession;
    },
    () => stopping,
    200
  );

  const int: InteractionRecord = { ...interaction, id: "int-stop-no-issue" };
  const handlePromise = capture.handle(int, {
    tab: { id: 7 },
    frameId: 0,
  } as any);

  // 确保已进入截图阶段后再触发会话停止
  await new Promise((r) => setTimeout(r, 30));
  stopping = true;
  capture.abortPending(testSession.id);

  await handlePromise.catch(() => {});

  assert.equal(
    storedMap.get("int-stop-no-issue")?.screenshot.status,
    "unavailable",
    "停止后截图应收敛为 unavailable"
  );

  const issues = sessionEvents.filter((e) => e.type === "capture-issue");
  assert.deepEqual(issues, [], "会话停止导致的截图熔断不应生成 capture-issue");

  const unavailableDelta = sessionEvents.find(
    (e) =>
      e.type === "quality-delta" && e.delta.unavailableScreenshotCount === 1
  );
  assert.ok(unavailableDelta, "应上报 unavailableScreenshotCount +1");
});

test("applyInteractionEvent 防止已 captured 的截图被迟到的 screenshot-unavailable 覆写降级", () => {
  const capturedRecord: InteractionRecord = {
    ...interaction,
    id: "int-captured-protect",
    status: "confirmed",
    screenshot: {
      status: "captured",
      source: "primary",
      assetId: "asset-protected-123",
    },
  };

  // 模拟迟到的 unavailable 事件（如超时或 abort 信号在 capture 成功后才触发）
  const result = applyInteractionEvent(capturedRecord, {
    type: "screenshot-unavailable",
    issue: "迟到的超时错误",
  });

  assert.equal(
    result?.screenshot.status,
    "captured",
    "已成功捕获的截图绝不允许被迟到的 unavailable 事件降级覆盖"
  );
  assert.equal(
    result?.screenshot.assetId,
    "asset-protected-123",
    "已关联的资产 ID 必须完整保留"
  );
});

test("drain() 未传参且 getActiveSession() 为 undefined 时，仍能基于内部索引全量收敛 pending 截图", async () => {
  installChromeMock({
    tabsQuery: async () => [{ id: 7, active: true }],
    captureVisibleTab: async () => "data:image/jpeg;base64,QUFB",
    sendMessage: async () => ({
      ok: true,
      dataUrl: "data:image/jpeg;base64,QUFB",
    }),
  });

  const storedMap = new Map<string, InteractionRecord>();
  const testSession: RecordingSession = {
    ...session,
    id: "session-paramless-drain",
    nonce: "session-paramless-drain",
    options: { ...session.options, captureScreenshots: true },
  };

  let activeSessionRef: RecordingSession | undefined = testSession;

  const capture = new InteractionCapture(
    {
      getActiveSession: async () => activeSessionRef,
      getInteraction: async (id) => storedMap.get(id),
      saveInteractionWithinBudget: async (next) => {
        storedMap.set(next.id, next);
        return { stored: true, usedBytes: 1, limitReached: false };
      },
    },
    async () => testSession,
    () => false,
    50
  );

  // 写入两个交互记录（通过 handle 接入索引，但人为置为 pending 状态模拟底层中断）
  const item1: InteractionRecord = {
    ...interaction,
    id: "int-no-param-1",
    sessionId: testSession.id,
    screenshot: { status: "pending" },
  };
  const item2: InteractionRecord = {
    ...interaction,
    id: "int-no-param-2",
    sessionId: testSession.id,
    screenshot: { status: "pending" },
  };

  await capture.handle(item1, { tab: { id: 7 } } as any);
  await capture.handle(item2, { tab: { id: 7 } } as any);

  // 人为将 DB 内的记录保持在 pending
  storedMap.set("int-no-param-1", {
    ...item1,
    screenshot: { status: "pending" },
  });
  storedMap.set("int-no-param-2", {
    ...item2,
    screenshot: { status: "pending" },
  });

  // 模拟 activeSession 此时已被外部流程置为 undefined（常见于生命周期提前 clearActive）
  activeSessionRef = undefined;

  // 调用无任何参数的 drain()
  const errors = await capture.drain();
  assert.deepEqual(errors, []);

  assert.equal(
    storedMap.get("int-no-param-1")?.screenshot.status,
    "unavailable",
    "item1 必须收敛为 unavailable"
  );
  assert.equal(
    storedMap.get("int-no-param-2")?.screenshot.status,
    "unavailable",
    "item2 必须收敛为 unavailable"
  );
});

test("会话存储配额超限时，finalizePending 通过 saveInteraction 强制收敛状态，确保 DB 0 pending", async () => {
  const storedMap = new Map<string, InteractionRecord>();
  let directSaveCalled = false;

  const testSession: RecordingSession = {
    ...session,
    id: "session-budget-full",
    nonce: "session-budget-full",
  };

  const capture = new InteractionCapture(
    {
      getActiveSession: async () => testSession,
      getInteraction: async (id) => storedMap.get(id),
      saveInteractionWithinBudget: async () => {
        // 模拟存储配额 100% 满，拒绝写入
        return { stored: false, usedBytes: 999999, limitReached: true };
      },
      saveInteraction: async (record) => {
        directSaveCalled = true;
        storedMap.set(record.id, record);
      },
      getInteractions: async () => Array.from(storedMap.values()),
    },
    async () => testSession,
    () => false
  );

  const pendingItem: InteractionRecord = {
    ...interaction,
    id: "int-budget-full-1",
    sessionId: testSession.id,
    screenshot: { status: "pending" },
  };
  storedMap.set(pendingItem.id, pendingItem);

  await capture.finalizePending(testSession.id);

  assert.ok(
    directSaveCalled,
    "当预算写入被拒时，必须调用底层直接 saveInteraction 保证终态收敛"
  );
  const finalRecord = storedMap.get("int-budget-full-1");
  assert.equal(
    finalRecord?.screenshot.status,
    "unavailable",
    "即便配额耗尽，截图状态仍必须收敛为 unavailable，绝不残留 pending"
  );
});

test("连续多次会话 reset() 时，干净重置 latestTopViewport 与 captureQueue，无跨会话状态污染", async () => {
  installChromeMock({
    tabsQuery: async () => [{ id: 7, active: true }],
    captureVisibleTab: async () => "data:image/jpeg;base64,QUFB",
  });

  const storedMap = new Map<string, InteractionRecord>();
  let currentSession: RecordingSession = {
    ...session,
    id: "session-1-mobile",
    nonce: "session-1-mobile",
    target: {
      tabId: 7,
      initialUrl: "https://mobile.example",
      initialTitle: "Mobile",
      environment: {
        viewportWidth: 375,
        viewportHeight: 667,
        devicePixelRatio: 3,
        userAgent: "iPhone",
      },
    },
  };

  const capture = new InteractionCapture(
    {
      getActiveSession: async () => currentSession,
      getInteraction: async (id) => storedMap.get(id),
      saveInteractionWithinBudget: async (next) => {
        storedMap.set(next.id, next);
        return { stored: true, usedBytes: 1, limitReached: false };
      },
    },
    async () => currentSession,
    () => false
  );

  // 会话 1：通过主帧建立 375x667 的移动端顶层视口缓存
  const intMobile: InteractionRecord = {
    ...interaction,
    id: "int-mobile-1",
    sessionId: currentSession.id,
    page: { url: "https://mobile.example", title: "Mobile", frameId: 0 },
    coordinates: {
      ...interaction.coordinates,
      viewport: { width: 375, height: 667 },
    },
  };
  await capture.handle(intMobile, { tab: { id: 7 }, frameId: 0 } as any);
  await capture.drain(500, currentSession.id);

  // 重置进入会话 2（桌面端 1920x1080）
  capture.reset();
  currentSession = {
    ...session,
    id: "session-2-desktop",
    nonce: "session-2-desktop",
    target: {
      tabId: 7,
      initialUrl: "https://desktop.example",
      initialTitle: "Desktop",
      environment: {
        viewportWidth: 1920,
        viewportHeight: 1080,
        devicePixelRatio: 1,
        userAgent: "Chrome Desktop",
      },
    },
  };

  // 会话 2 中的第一笔交互来自子 iframe (frameId: 2)，无自身视口，应回退至会话 2 环境视口 (1920x1080)
  const intDesktopIframe: InteractionRecord = {
    ...interaction,
    id: "int-desktop-iframe-1",
    sessionId: currentSession.id,
    page: { url: "https://desktop.example/frame", title: "Frame", frameId: 2 },
    coordinates: {
      ...interaction.coordinates,
      viewport: { width: 0, height: 0 },
    },
  };
  await capture.handle(intDesktopIframe, { tab: { id: 7 }, frameId: 2 } as any);

  const storedDesktop = storedMap.get("int-desktop-iframe-1");
  assert.equal(
    storedDesktop?.coordinates.viewport.width,
    1920,
    "reset() 之后不得残留会话 1 的移动端视口 (375)，必须根据会话 2 决议为 1920"
  );
  assert.equal(
    storedDesktop?.coordinates.viewport.height,
    1080,
    "reset() 之后不得残留会话 1 的移动端视口 (667)，必须根据会话 2 决议为 1080"
  );

  await capture.drain(500, currentSession.id);
});

test("存储配额超限时，正常录制流中出现截图失败或取消仍可通过 saveInteraction 保底写入 unavailable 终态", async () => {
  const storedMap = new Map<string, InteractionRecord>();
  let directSaveCount = 0;

  const testSession: RecordingSession = {
    ...session,
    id: "session-budget-runtime-fail",
    nonce: "session-budget-runtime-fail",
    options: { ...session.options, captureScreenshots: true },
  };

  const capture = new InteractionCapture(
    {
      getActiveSession: async () => testSession,
      getInteraction: async (id) => storedMap.get(id),
      saveInteractionWithinBudget: async (next) => {
        // 允许首次 pending 存入，之后模拟配额超限
        if (!storedMap.has(next.id)) {
          storedMap.set(next.id, next);
          return { stored: true, usedBytes: 100, limitReached: false };
        }
        return { stored: false, usedBytes: 999999, limitReached: true };
      },
      saveInteraction: async (record) => {
        directSaveCount++;
        storedMap.set(record.id, record);
      },
    },
    async () => testSession,
    () => false,
    50
  );

  // 1. 测试 cancelInteraction 在配额超限下仍能成功取消并收敛 pending
  const cancelItem: InteractionRecord = {
    ...interaction,
    id: "int-cancel-budget-full",
    sessionId: testSession.id,
    screenshot: { status: "pending" },
  };
  await capture.handle(cancelItem, { tab: { id: 7 } } as any);
  await capture.cancel(
    "int-cancel-budget-full",
    cancelItem,
    testSession.nonce,
    {
      tab: { id: 7 },
    } as any
  );

  const cancelledRecord = storedMap.get("int-cancel-budget-full");
  assert.equal(
    cancelledRecord?.status,
    "cancelled",
    "配额超限时 cancelInteraction 仍必须成功写入 cancelled 状态"
  );
  assert.equal(
    cancelledRecord?.screenshot.status,
    "unavailable",
    "配额超限时 cancelInteraction 仍必须收敛 pending 截图为 unavailable"
  );
  assert.ok(
    directSaveCount > 0,
    "必须通过底层直接 saveInteraction 确保终态收敛"
  );
});

test("reset() 清空内部 sessionInteractions 追踪集合，避免跨多会话长期运行内存泄漏", async () => {
  const storedMap = new Map<string, InteractionRecord>();
  const testSession: RecordingSession = {
    ...session,
    id: "session-mem-leak-check",
    nonce: "session-mem-leak-check",
  };

  const capture = new InteractionCapture(
    {
      getActiveSession: async () => testSession,
      getInteraction: async (id) => storedMap.get(id),
      saveInteractionWithinBudget: async (next) => {
        storedMap.set(next.id, next);
        return { stored: true, usedBytes: 1, limitReached: false };
      },
    },
    async () => testSession,
    () => false
  );

  const item: InteractionRecord = {
    ...interaction,
    id: "int-mem-1",
    sessionId: testSession.id,
  };
  await capture.handle(item, { tab: { id: 7 } } as any);

  // 结束并 drain 当前会话
  await capture.drain(100, testSession.id);
  // drain 之后，已收敛的 session 应当已从追踪映射中移除
  assert.equal((capture as any).sessionInteractions.has(testSession.id), false);

  // reset() 执行后，整个 sessionInteractions 应干净为空
  capture.reset();
  assert.equal((capture as any).sessionInteractions.size, 0);
});
