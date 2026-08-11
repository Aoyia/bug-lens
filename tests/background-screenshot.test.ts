import assert from "node:assert/strict";
import test from "node:test";
import {
  createTestRuntime,
  makeSession,
} from "./helpers/background-runtime-harness.ts";
import { installChromeMock } from "./helpers/chrome-mock.ts";

installChromeMock();

test("triggerScreenshotInTab: 录制进行中拒绝触发", async () => {
  const { runtime, db, contentScripts } = createTestRuntime();
  const session = makeSession({ id: "sess-rec", status: "RECORDING" });
  db.sessions.set(session.id, session);
  db.activeSessionId = session.id;

  await runtime.triggerScreenshotInTab(42, 1);

  // 录制中直接 return：不执行 activate（bootstrap 的 restore 属正常恢复流程）
  assert.ok(!contentScripts.calls.some((call) => call.startsWith("activate:")));
});

test("triggerScreenshotInTab: 非 http(s) 页面拒绝触发", async () => {
  const { runtime } = createTestRuntime();
  const { handlers } = installChromeMock();
  handlers.tabsGet = async () => ({
    id: 42,
    windowId: 1,
    url: "chrome://extensions/",
    title: "Extensions",
  });

  await runtime.triggerScreenshotInTab(42, 1);
  // 不抛错即为通过（静默跳过）
});

test("triggerScreenshotInTab: 成功链路注入脚本并唤起 overlay", async () => {
  const { runtime, contentScripts } = createTestRuntime();
  let captured: unknown;
  const { handlers } = installChromeMock();
  handlers.tabsSendMessage = async (tabId: number, msg: unknown) => {
    captured = { tabId, msg };
    return {};
  };

  await runtime.triggerScreenshotInTab(42, 1);

  assert.ok(contentScripts.calls.some((call) => call.startsWith("activate:")));
  assert.ok(captured);
  assert.equal((captured as { tabId: number }).tabId, 42);
  assert.equal(
    (captured as { msg: { type: string } }).msg.type,
    "TRIGGER_SCREENSHOT_OVERLAY"
  );
});

test("路由: screenshot/trigger 无 tabId 时用 sender.tab.id", async () => {
  const { runtime, contentScripts } = createTestRuntime();
  const { handlers } = installChromeMock();
  let captured: unknown;
  handlers.tabsSendMessage = async (tabId: number, msg: unknown) => {
    captured = { tabId, msg };
    return {};
  };

  const result = await runtime.handleMessage(
    {
      protocolVersion: 3,
      messageId: "m1",
      type: "screenshot/trigger",
      sentAt: Date.now(),
      payload: {},
    },
    { tab: { id: 77 }, frameId: 0 } as chrome.runtime.MessageSender
  );

  assert.equal((result as { ok: boolean }).ok, true);
  assert.equal((captured as { tabId: number }).tabId, 77);
  assert.ok(
    contentScripts.calls.some((call) => call.startsWith("activate:77"))
  );
});

test("路由: screenshot/download 触发下载并解析绝对路径", async () => {
  const { runtime } = createTestRuntime();
  const { handlers } = installChromeMock();
  handlers.downloadsDownload = async () => 9;
  handlers.downloadsSearch = (_query, callback) =>
    callback([{ id: 9, filename: "/tmp/shot.png", state: "complete" }]);

  const result = (await runtime.handleMessage(
    {
      protocolVersion: 3,
      messageId: "m2",
      type: "screenshot/download",
      sentAt: Date.now(),
      payload: { dataUrl: "data:image/png;base64,AAA", filename: "shot.png" },
    },
    { frameId: 0 } as chrome.runtime.MessageSender
  )) as { ok: boolean; downloadId: number; absolutePath: string };

  assert.equal(result.ok, true);
  assert.equal(result.downloadId, 9);
  assert.equal(result.absolutePath, "/tmp/shot.png");
});

test("路由: screenshot/framework-probe 无 tabId 时返回空结果", async () => {
  const { runtime } = createTestRuntime();
  const result = (await runtime.handleMessage(
    {
      protocolVersion: 3,
      messageId: "m3",
      type: "screenshot/framework-probe",
      sentAt: Date.now(),
      payload: { probeIds: ["p1"] },
    },
    { frameId: 0 } as chrome.runtime.MessageSender
  )) as { ok: boolean; results: Record<string, unknown> };

  assert.equal(result.ok, true);
  assert.deepEqual(result.results, {});
});

test("路由: screenshot/style-source 无 tabId 时返回空 sources", async () => {
  const { runtime } = createTestRuntime();
  const result = (await runtime.handleMessage(
    {
      protocolVersion: 3,
      messageId: "m4",
      type: "screenshot/style-source",
      sentAt: Date.now(),
      payload: { selectors: [".btn"] },
    },
    { frameId: 0 } as chrome.runtime.MessageSender
  )) as { ok: boolean; sources: unknown[] };

  assert.equal(result.ok, true);
  assert.deepEqual(result.sources, []);
});

test("快捷键: startRecordingViaShortcut 截图打开时拒绝", async () => {
  const { runtime, db } = createTestRuntime();
  const { handlers } = installChromeMock();
  // 上报截图 overlay 打开
  await runtime.handleMessage(
    {
      protocolVersion: 3,
      messageId: "m5",
      type: "content/screenshot-overlay-state",
      sentAt: Date.now(),
      payload: { open: true },
    },
    { tab: { id: 42 }, frameId: 0 } as chrome.runtime.MessageSender
  );

  await runtime.startRecordingViaShortcut();
  assert.equal(db.activeSessionId, undefined);
  void handlers;
});

test("快捷键: startRecordingViaShortcut 正常启动录制", async () => {
  const { runtime, db } = createTestRuntime();
  const { handlers } = installChromeMock();
  handlers.storageLocalGet = async () => ({});
  handlers.tabsQuery = async () => [
    { id: 42, windowId: 1, url: "https://example.com/", title: "Example" },
  ];

  await runtime.startRecordingViaShortcut();
  assert.ok(db.activeSessionId);
  const session = db.sessions.get(db.activeSessionId)!;
  assert.equal(session.status, "RECORDING");
});

test("快捷键: startScreenshotViaShortcut 触发截图", async () => {
  const { runtime, contentScripts } = createTestRuntime();
  const { handlers } = installChromeMock();
  let captured: unknown;
  handlers.tabsSendMessage = async (tabId: number, msg: unknown) => {
    captured = { tabId, msg };
    return {};
  };
  handlers.tabsQuery = async () => [
    { id: 42, windowId: 1, url: "https://example.com/", title: "Example" },
  ];

  await runtime.startScreenshotViaShortcut();
  assert.equal((captured as { tabId: number }).tabId, 42);
  assert.ok(contentScripts.calls.some((call) => call.startsWith("activate:")));
});
