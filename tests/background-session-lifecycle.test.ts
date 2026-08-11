import assert from "node:assert/strict";
import test from "node:test";
import {
  createTestRuntime,
  makeSession,
} from "./helpers/background-runtime-harness.ts";
import { installChromeMock } from "./helpers/chrome-mock.ts";

installChromeMock();

test("startSession: 同 commandId 二次启动返回同一会话（幂等）", async () => {
  const { runtime, db } = createTestRuntime();
  const session = makeSession();
  db.sessions.set(session.id, session);
  db.commands.set("command:cmd-dup", {
    key: "command:cmd-dup",
    commandId: "cmd-dup",
    kind: "start",
    sessionId: session.id,
    createdAtEpochMs: Date.now(),
  });
  db.activeSessionId = session.id;

  const result = await runtime.startSession({
    tabId: 42,
    options: session.options,
    commandId: "cmd-dup",
  });
  assert.equal(result.id, session.id);
});

test("startSession: commandId 已被 stop 指令占用时抛指令冲突", async () => {
  const { runtime, db } = createTestRuntime();
  db.commands.set("command:cmd-x", {
    key: "command:cmd-x",
    commandId: "cmd-x",
    kind: "stop",
    sessionId: "sess-x",
    createdAtEpochMs: Date.now(),
  });

  await assert.rejects(
    runtime.startSession({
      tabId: 42,
      options: makeSession().options,
      commandId: "cmd-x",
    }),
    /COMMAND_KIND_CONFLICT/
  );
});

test("startSession: 已有活动会话时抛 SESSION_ALREADY_ACTIVE", async () => {
  const { runtime, db } = createTestRuntime();
  const active = makeSession({ id: "sess-active", status: "RECORDING" });
  db.sessions.set(active.id, active);
  db.activeSessionId = active.id;

  await assert.rejects(
    runtime.startSession({
      tabId: 42,
      options: active.options,
      commandId: "cmd-new",
    }),
    /SESSION_ALREADY_ACTIVE/
  );
});

test("startSession: 启动失败时回滚资源并落 failed 事件", async () => {
  const { runtime, db, cdpCollector, contentScripts, streamHealthMonitor } =
    createTestRuntime();
  // 让 media 启动失败：chrome.runtime.sendMessage 返回 ok:false
  // 通过让 tabCapture 不返回 streamId 触发 MEDIA_STREAM_ID_FAILED（降级而非失败），
  // 因此改用 cdpCollector.attach 抛错触发整体失败。
  cdpCollector.attachIssue = {
    code: "DEBUGGER_ATTACH_FAILED",
    message: "attach failed",
    source: "debugger",
    recoverable: true,
    occurredAt: Date.now(),
  };
  // attach 返回 issue 不是 throw，所以让 media 也失败：拦截 sendMessage
  // 简化：直接让 contentScripts.activate 抛错模拟中途失败
  contentScripts.activate = async () => {
    throw new Error("inject failed");
  };

  const result = await runtime.startSession({
    tabId: 42,
    options: makeSession().options,
    commandId: "cmd-fail",
  });

  assert.equal(result.status, "FAILED");
  assert.ok(
    result.quality.issues.some((entry) => entry.code === "SESSION_START_FAILED")
  );
  assert.equal(db.activeSessionId, undefined);
  assert.ok(contentScripts.calls.some((call) => call.startsWith("remove:")));
  assert.ok(
    streamHealthMonitor.calls.some((call) => call.startsWith("reset:"))
  );
});

test("startSession: 成功启动后进入 RECORDING 且初始化健康监测", async () => {
  const { runtime, db, streamHealthMonitor, navigationCapture } =
    createTestRuntime();

  const result = await runtime.startSession({
    tabId: 42,
    options: makeSession().options,
    commandId: "cmd-ok",
  });

  assert.equal(result.status, "RECORDING");
  assert.equal(db.activeSessionId, result.id);
  assert.ok(
    streamHealthMonitor.calls.some((call) => call.startsWith("initialize:"))
  );
  assert.ok(navigationCapture.calls.includes("attach"));
});

test("stopSession: 无活动会话时返回 undefined", async () => {
  const { runtime } = createTestRuntime();
  const result = await runtime.stopSession();
  assert.equal(result, undefined);
});

test("stopSession: 正常停止后进入 PREVIEW_READY 并清活动标记", async () => {
  const { runtime, db, recordingCoordinator } = createTestRuntime();
  const session = makeSession({ id: "sess-stop", status: "RECORDING" });
  db.sessions.set(session.id, session);
  db.activeSessionId = session.id;

  const result = await runtime.stopSession("cmd-stop-1");
  assert.ok(result);
  assert.equal(result.status, "PREVIEW_READY");
  assert.equal(db.activeSessionId, undefined);
  assert.ok(recordingCoordinator.calls.includes("beginStopping:sess-stop"));
  assert.ok(recordingCoordinator.calls.includes("finishStopping:sess-stop"));
});

test("stopSession: discard 模式下删除会话并清活动标记", async () => {
  const { runtime, db } = createTestRuntime();
  const session = makeSession({ id: "sess-discard", status: "RECORDING" });
  db.sessions.set(session.id, session);
  db.activeSessionId = session.id;

  const result = await runtime.stopSession("cmd-discard", false, true);
  assert.equal(result, undefined);
  assert.ok(db.deleted.includes("sess-discard"));
  assert.equal(db.activeSessionId, undefined);
  assert.equal(db.sessions.has("sess-discard"), false);
});

test("stopSession: silentExport 成功时清 active 且返回结果", async () => {
  const { runtime, db } = createTestRuntime();
  const session = makeSession({ id: "sess-silent", status: "RECORDING" });
  db.sessions.set(session.id, session);
  db.activeSessionId = session.id;

  // 拦截 offscreen/export-pack 响应，返回成功打包结果
  const { handlers } = installChromeMock();
  handlers.sendMessage = async (message: unknown) => {
    const type = (message as { type?: string })?.type;
    if (type === "offscreen/export-pack") {
      return {
        ok: true,
        blobUrl: "blob:export",
        filename: "evidence.zip",
        prompt: "导出完成",
      };
    }
    return { ok: true };
  };

  const result = await runtime.stopSession("cmd-silent", false, false, true);
  assert.ok(result);
  assert.equal(result.silentExportResult?.ok, true);
  // silentExport 成功时也应清 active（见 performStopSession 逻辑）
  assert.equal(db.activeSessionId, undefined);
});

test("continueInterruptedSession: 无可恢复问题时拒绝续录", async () => {
  const { runtime, db } = createTestRuntime();
  const session = makeSession({
    id: "sess-plain",
    status: "PREVIEW_READY",
    quality: { ...makeSession().quality, issues: [] },
  });
  db.sessions.set(session.id, session);

  await assert.rejects(
    runtime.continueInterruptedSession("sess-plain", "cmd-resume"),
    /未处于可继续状态/
  );
});

test("continueInterruptedSession: 带 SESSION_ 问题时允许续录", async () => {
  const { runtime, db } = createTestRuntime();
  const session = makeSession({
    id: "sess-interrupted",
    status: "PREVIEW_READY",
    quality: {
      ...makeSession().quality,
      issues: [
        {
          code: "SESSION_INTERRUPTED_BY_BROWSER_RESTART",
          message: "interrupted",
          source: "storage" as const,
          recoverable: true,
          occurredAt: Date.now(),
        },
      ],
    },
  });
  db.sessions.set(session.id, session);

  const result = await runtime.continueInterruptedSession(
    "sess-interrupted",
    "cmd-resume"
  );
  assert.ok(result);
  assert.equal(result.resumedFromSessionId, "sess-interrupted");
});

test("openPendingPreview: 已有同 sessionId 预览标签时不重复开页", async () => {
  const { runtime, db } = createTestRuntime();
  const session = makeSession({
    id: "sess-preview",
    status: "PREVIEW_READY",
    previewPending: true,
  });
  db.sessions.set(session.id, session);
  // 模拟已存在预览标签
  const originalTabsQuery = (globalThis as { chrome: any }).chrome.tabs.query;
  (globalThis as { chrome: any }).chrome.tabs.query = async () => [
    { url: "chrome-extension://test/preview.html?sessionId=sess-preview" },
  ];
  try {
    const result = await runtime.openPendingPreview(session);
    assert.ok(result);
    assert.equal(result.previewPending, false);
  } finally {
    (globalThis as { chrome: any }).chrome.tabs.query = originalTabsQuery;
  }
});

test("reconcileSessionQuality: 重算质量快照写入会话", async () => {
  const { runtime, db } = createTestRuntime();
  const session = makeSession({
    id: "sess-quality",
    status: "RECORDING",
  });
  db.sessions.set(session.id, session);
  db.activeSessionId = session.id;
  db.interactions = [
    {
      id: "i1",
      sessionId: "sess-quality",
      status: "confirmed",
      kind: "click",
      target: { selector: ".btn", label: "Button" },
      screenshot: { status: "captured", source: "primary" },
    },
    {
      id: "i2",
      sessionId: "sess-quality",
      status: "cancelled",
      kind: "input",
      target: { selector: ".inp", label: "Input" },
      screenshot: { status: "unavailable" },
    },
  ];
  db.consoleEntries = [{ sessionId: "sess-quality", level: "error" }];

  await runtime.reconcileSessionQuality("sess-quality");
  const updated = db.sessions.get("sess-quality")!;
  assert.equal(updated.quality.interactionCount, 1);
  assert.equal(updated.quality.confirmedInteractionCount, 1);
  assert.equal(updated.quality.primaryScreenshotCount, 1);
  assert.equal(updated.quality.consoleEntryCount, 1);
});
