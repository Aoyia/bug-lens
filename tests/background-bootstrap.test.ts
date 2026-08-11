import assert from "node:assert/strict";
import test from "node:test";
import {
  createTestRuntime,
  makeSession,
} from "./helpers/background-runtime-harness.ts";
import { installChromeMock } from "./helpers/chrome-mock.ts";

installChromeMock();

test("bootstrap: 无活动会话时直接返回", async () => {
  const { runtime } = createTestRuntime();
  await runtime.bootstrapRuntimeState();
  // 不抛错即为通过
});

test("bootstrap: 纪元不符时按浏览器重启中断恢复", async () => {
  const { runtime, db } = createTestRuntime();
  const session = makeSession({
    id: "sess-epoch",
    status: "RECORDING",
    browserEpoch: "old-epoch",
  });
  db.sessions.set(session.id, session);
  db.activeSessionId = session.id;

  await runtime.bootstrapRuntimeState();

  const updated = db.sessions.get("sess-epoch")!;
  // recover 后自动打开 preview，成功开页即清 previewPending 与 active
  assert.ok(
    updated.quality.issues.some(
      (entry) => entry.code === "SESSION_INTERRUPTED_BY_BROWSER_RESTART"
    )
  );
  assert.equal(updated.previewPending, false);
  assert.equal(db.activeSessionId, undefined);
});

test("bootstrap: STOPPING 状态续停完成", async () => {
  const { runtime, db } = createTestRuntime();
  const session = makeSession({
    id: "sess-stopping",
    status: "STOPPING",
    browserEpoch: "epoch-1",
    commandIds: { start: "cmd-start", stop: "cmd-stop-1" },
  });
  db.sessions.set(session.id, session);
  db.activeSessionId = session.id;

  await runtime.bootstrapRuntimeState();

  const updated = db.sessions.get("sess-stopping")!;
  assert.equal(updated.status, "PREVIEW_READY");
  assert.equal(db.activeSessionId, undefined);
});

test("bootstrap: PREPARING 状态按启动中断恢复", async () => {
  const { runtime, db } = createTestRuntime();
  const session = makeSession({
    id: "sess-preparing",
    status: "PREPARING",
    browserEpoch: "epoch-1",
  });
  db.sessions.set(session.id, session);
  db.activeSessionId = session.id;

  await runtime.bootstrapRuntimeState();

  const updated = db.sessions.get("sess-preparing")!;
  assert.ok(
    updated.quality.issues.some(
      (entry) => entry.code === "SESSION_START_INTERRUPTED"
    )
  );
  assert.equal(updated.previewPending, false);
  assert.equal(db.activeSessionId, undefined);
});

test("bootstrap: 目标标签页缺失时系统停止会话", async () => {
  const { runtime, db } = createTestRuntime();
  const session = makeSession({
    id: "sess-missing-tab",
    status: "RECORDING",
    browserEpoch: "epoch-1",
  });
  db.sessions.set(session.id, session);
  db.activeSessionId = session.id;
  const { handlers } = installChromeMock();
  handlers.tabsGet = async () => {
    throw new Error("tab not found");
  };

  await runtime.bootstrapRuntimeState();

  const updated = db.sessions.get("sess-missing-tab")!;
  assert.equal(updated.status, "PREVIEW_READY");
  assert.equal(db.activeSessionId, undefined);
});

test("bootstrap: 媒体上下文丢失时落 MEDIA_CONTEXT_LOST", async () => {
  const { runtime, db } = createTestRuntime();
  const session = makeSession({
    id: "sess-media-lost",
    status: "RECORDING",
    browserEpoch: "epoch-1",
  });
  db.sessions.set(session.id, session);
  db.activeSessionId = session.id;
  const { handlers } = installChromeMock();
  // offscreen 文档存在但媒体不活跃
  handlers.getContexts = async () => [{ contextType: "OFFSCREEN_DOCUMENT" }];
  handlers.sendMessage = async (msg: unknown) => {
    const type = (msg as { type?: string })?.type;
    if (type === "offscreen/status") return { active: false };
    return { ok: true };
  };

  await runtime.bootstrapRuntimeState();

  const updated = db.sessions.get("sess-media-lost")!;
  assert.ok(
    updated.quality.issues.some((entry) => entry.code === "MEDIA_CONTEXT_LOST")
  );
});

test("bootstrap: 正常活动会话恢复 content（无媒体上下文时降级）", async () => {
  const { runtime, db, contentScripts, streamHealthMonitor } =
    createTestRuntime();
  const session = makeSession({
    id: "sess-alive",
    status: "RECORDING",
    browserEpoch: "epoch-1",
  });
  db.sessions.set(session.id, session);
  db.activeSessionId = session.id;

  await runtime.bootstrapRuntimeState();

  const updated = db.sessions.get("sess-alive")!;
  // 默认 chrome mock 无 offscreen 文档 → 媒体上下文丢失 → 降级（真实行为）
  assert.equal(updated.status, "DEGRADED");
  assert.ok(
    updated.quality.issues.some((entry) => entry.code === "MEDIA_CONTEXT_LOST")
  );
  assert.ok(contentScripts.calls.some((call) => call.startsWith("restore:")));
  assert.ok(
    streamHealthMonitor.calls.some((call) => call.startsWith("initialize:"))
  );
});

test("bootstrap: 媒体上下文正常时保持 RECORDING", async () => {
  const { runtime, db } = createTestRuntime();
  const session = makeSession({
    id: "sess-alive2",
    status: "RECORDING",
    browserEpoch: "epoch-1",
  });
  db.sessions.set(session.id, session);
  db.activeSessionId = session.id;
  const { handlers } = installChromeMock();
  handlers.getContexts = async () => [{ contextType: "OFFSCREEN_DOCUMENT" }];
  handlers.sendMessage = async (msg: unknown) => {
    const type = (msg as { type?: string })?.type;
    if (type === "offscreen/status") return { active: true };
    return { ok: true };
  };
  handlers.tabsGet = async () => ({
    id: 42,
    windowId: 1,
    url: "https://example.com/",
    title: "Example",
  });

  await runtime.bootstrapRuntimeState();

  const updated = db.sessions.get("sess-alive2")!;
  assert.equal(updated.status, "RECORDING");
  assert.ok(
    !updated.quality.issues.some((entry) => entry.code === "MEDIA_CONTEXT_LOST")
  );
});

test("bootstrap: 非活动状态且 previewPending 时打开预览", async () => {
  const { runtime, db } = createTestRuntime();
  const session = makeSession({
    id: "sess-pending",
    status: "PREVIEW_READY",
    browserEpoch: "epoch-1",
    previewPending: true,
  });
  db.sessions.set(session.id, session);
  db.activeSessionId = session.id;

  await runtime.bootstrapRuntimeState();

  const updated = db.sessions.get("sess-pending")!;
  assert.equal(updated.previewPending, false);
});

test("handleTabRemoved: 目标标签页关闭时停止会话", async () => {
  const { runtime, db } = createTestRuntime();
  const session = makeSession({
    id: "sess-tab-removed",
    status: "RECORDING",
    browserEpoch: "epoch-1",
  });
  db.sessions.set(session.id, session);
  db.activeSessionId = session.id;

  await runtime.handleTabRemoved(42);

  const updated = db.sessions.get("sess-tab-removed")!;
  assert.equal(updated.status, "PREVIEW_READY");
  assert.equal(db.activeSessionId, undefined);
});

test("handleTabUpdated: 非 complete 状态不触发恢复", async () => {
  const { runtime, db, contentScripts } = createTestRuntime();
  const session = makeSession({
    id: "sess-nav",
    status: "RECORDING",
    browserEpoch: "epoch-1",
  });
  db.sessions.set(session.id, session);
  db.activeSessionId = session.id;

  await runtime.handleTabUpdated(42, { status: "loading" });
  assert.equal(contentScripts.calls.length, 0);
});

test("handleTabUpdated: complete 时恢复采集（含 CDP 重连）", async () => {
  const { runtime, db, contentScripts, streamHealthMonitor } =
    createTestRuntime();
  const session = makeSession({
    id: "sess-nav2",
    status: "RECORDING",
    browserEpoch: "epoch-1",
  });
  db.sessions.set(session.id, session);
  db.activeSessionId = session.id;

  await runtime.handleTabUpdated(42, { status: "complete" });

  assert.ok(contentScripts.calls.some((call) => call.startsWith("restore:")));
  assert.ok(
    streamHealthMonitor.calls.includes("updateStream:content:reconnecting")
  );
  assert.ok(streamHealthMonitor.calls.includes("updateStream:content:ok"));
});

test("handleDebuggerDetach: 非停止中会话触发 cdp 重连", async () => {
  const { runtime, db, cdpCollector, streamHealthMonitor } =
    createTestRuntime();
  const session = makeSession({
    id: "sess-detach",
    status: "RECORDING",
    browserEpoch: "epoch-1",
  });
  db.sessions.set(session.id, session);
  db.activeSessionId = session.id;

  await runtime.handleDebuggerDetach({ tabId: 42 }, "target_closed");

  assert.ok(cdpCollector.calls.includes("handleDetach"));
  assert.ok(streamHealthMonitor.calls.includes("updateStream:cdp:disrupted"));
  assert.ok(streamHealthMonitor.calls.includes("updateStream:cdp:ok"));
});

test("handleDebuggerDetach: 停止中会话不触发重连", async () => {
  const { runtime, db, cdpCollector, recordingCoordinator } =
    createTestRuntime();
  const session = makeSession({
    id: "sess-detach-stop",
    status: "STOPPING",
    browserEpoch: "epoch-1",
  });
  db.sessions.set(session.id, session);
  db.activeSessionId = session.id;
  recordingCoordinator.stopping.add("sess-detach-stop");

  await runtime.handleDebuggerDetach({ tabId: 42 }, "target_closed");

  assert.ok(!cdpCollector.calls.includes("handleDetach"));
});
