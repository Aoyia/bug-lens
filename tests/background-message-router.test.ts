import assert from "node:assert/strict";
import test from "node:test";
import {
  createTestRuntime,
  makeSession,
} from "./helpers/background-runtime-harness.ts";
import { installChromeMock } from "./helpers/chrome-mock.ts";
import { message } from "../src/shared/protocol.ts";

installChromeMock();

function sender(tabId?: number, url?: string) {
  return {
    tab: tabId ? { id: tabId } : undefined,
    url,
    frameId: 0,
  } as chrome.runtime.MessageSender;
}

test("路由: 非 envelope 消息被忽略", async () => {
  const { runtime } = createTestRuntime();
  const result = await runtime.handleMessage(
    { type: "session/status" },
    sender(1)
  );
  assert.equal(result, undefined);
});

test("路由: target 非 background 的消息被忽略", async () => {
  const { runtime } = createTestRuntime();
  const result = await runtime.handleMessage(
    message("session/status", {}, undefined, "content"),
    sender(1)
  );
  assert.equal(result, undefined);
});

test("路由: 未知消息返回 UNSUPPORTED_MESSAGE", async () => {
  const { runtime } = createTestRuntime();
  const result = (await runtime.handleMessage(
    message("unknown/type" as never, {}),
    sender(1)
  )) as { ok: boolean; error: string };
  assert.equal(result.ok, false);
  assert.equal(result.error, "UNSUPPORTED_MESSAGE");
});

test("路由: session/status 返回当前活动会话", async () => {
  const { runtime, db } = createTestRuntime();
  const session = makeSession({ id: "sess-route", status: "RECORDING" });
  db.sessions.set(session.id, session);
  db.activeSessionId = session.id;

  const result = (await runtime.handleMessage(
    message("session/status", {}),
    sender(42)
  )) as { ok: boolean; session: { id: string } };
  assert.equal(result.ok, true);
  assert.equal(result.session.id, "sess-route");
});

test("路由: session/start 时截图 overlay 打开则拒绝", async () => {
  const { runtime } = createTestRuntime();
  // 先上报 overlay 打开
  await runtime.handleMessage(
    message("content/screenshot-overlay-state", { open: true }),
    sender(42)
  );
  const result = (await runtime.handleMessage(
    message("session/start", {
      tabId: 42,
      options: makeSession().options,
      commandId: "cmd-x",
    }),
    sender(42)
  )) as { ok: boolean; error: string };
  assert.equal(result.ok, false);
  assert.ok(result.error.includes("cannotStartWhileScreenshotActive"));
});

test("路由: content/hello 非录制会话返回 active:false", async () => {
  const { runtime } = createTestRuntime();
  const result = (await runtime.handleMessage(
    message("content/hello", {}),
    sender(42)
  )) as { ok: boolean; active: boolean };
  assert.equal(result.ok, true);
  assert.equal(result.active, false);
});

test("路由: content/hello 录制中且 tab 匹配返回 active:true", async () => {
  const { runtime, db } = createTestRuntime();
  const session = makeSession({ id: "sess-hello", status: "RECORDING" });
  db.sessions.set(session.id, session);
  db.activeSessionId = session.id;

  const result = (await runtime.handleMessage(
    message("content/hello", {}),
    sender(42)
  )) as { ok: boolean; active: boolean; sessionId?: string; nonce?: string };
  assert.equal(result.ok, true);
  assert.equal(result.active, true);
  assert.equal(result.sessionId, "sess-hello");
  assert.equal(result.nonce, "nonce-1");
});

test("路由: framework/state 会话不匹配时返回 stored:false", async () => {
  const { runtime, db } = createTestRuntime();
  const session = makeSession({ id: "sess-fw", status: "RECORDING" });
  db.sessions.set(session.id, session);
  db.activeSessionId = session.id;

  const result = (await runtime.handleMessage(
    message("framework/state", {
      state: { sessionId: "other-session", tree: {} },
    }),
    sender(42)
  )) as { ok: boolean; stored: boolean };
  assert.equal(result.ok, true);
  assert.equal(result.stored, false);
});

test("路由: framework/state 会话匹配时写入并返回 stored:true", async () => {
  const { runtime, db } = createTestRuntime();
  const session = makeSession({ id: "sess-fw2", status: "RECORDING" });
  db.sessions.set(session.id, session);
  db.activeSessionId = session.id;

  const result = (await runtime.handleMessage(
    message("framework/state", {
      state: { sessionId: "sess-fw2", tree: {} },
    }),
    sender(42)
  )) as { ok: boolean; stored: boolean };
  assert.equal(result.ok, true);
  assert.equal(result.stored, true);
});

test("路由: session/delete 删除录制中会话被拒绝", async () => {
  const { runtime, db } = createTestRuntime();
  const session = makeSession({ id: "sess-del", status: "RECORDING" });
  db.sessions.set(session.id, session);
  db.activeSessionId = session.id;

  const result = (await runtime.handleMessage(
    message("session/delete", { sessionId: "sess-del" }),
    sender(1)
  )) as { ok: boolean; error: string };
  assert.equal(result.ok, false);
  // 错误文案走 i18n：测试环境 t() 返回 key 本身，不再硬编码中文
  assert.ok(result.error.includes("cannotDeleteActiveRecording"));
});

test("路由: session/delete 删除历史会话成功", async () => {
  const { runtime, db } = createTestRuntime();
  const session = makeSession({
    id: "sess-old",
    status: "PREVIEW_READY",
    previewPending: false,
  });
  db.sessions.set(session.id, session);

  const result = (await runtime.handleMessage(
    message("session/delete", { sessionId: "sess-old" }),
    sender(1)
  )) as { ok: boolean; deleted: boolean };
  assert.equal(result.ok, true);
  assert.equal(result.deleted, true);
  assert.ok(db.deleted.includes("sess-old"));
});

test("路由: interaction/candidate 转交 interactionCapture", async () => {
  const { runtime, interactionCapture } = createTestRuntime();
  const result = await runtime.handleMessage(
    message("interaction/candidate", {
      interaction: {
        id: "i1",
        sessionId: "sess-1",
        kind: "click",
        status: "candidate",
        target: { selector: ".a", label: "A" },
        screenshot: { status: "unavailable" },
      },
    }),
    sender(42)
  );
  assert.equal((result as { ok: boolean }).ok, true);
  assert.ok(interactionCapture.calls.includes("handle"));
});

test("路由: issue-scene/cancel 转交 issueSceneCapture", async () => {
  const { runtime, issueSceneCapture } = createTestRuntime();
  const result = await runtime.handleMessage(
    message("issue-scene/cancel", {
      issueSceneId: "scene-1",
      nonce: "nonce-1",
    }),
    sender(42)
  );
  assert.equal((result as { ok: boolean }).ok, true);
  assert.ok(issueSceneCapture.calls.includes("cancel"));
});

test("路由: storage/update 更新存储策略", async () => {
  const { runtime, db } = createTestRuntime();
  const result = (await runtime.handleMessage(
    message("storage/update", {
      policy: { retentionDays: 30 },
    }),
    sender(1)
  )) as { ok: boolean; policy: { retentionDays: number } };
  assert.equal(result.ok, true);
  assert.equal(result.policy.retentionDays, 30);
});

test("路由: offscreen/storage-state 拒写时更新 storage 健康流为 failed", async () => {
  const { runtime, db, streamHealthMonitor } = createTestRuntime();
  const session = makeSession({ id: "sess-st", status: "RECORDING" });
  db.sessions.set(session.id, session);
  db.activeSessionId = session.id;
  const { handlers } = installChromeMock();
  handlers.getURL = () => "chrome-extension://test/offscreen.html";

  const result = await runtime.handleMessage(
    message(
      "offscreen/storage-state",
      { sessionId: "sess-st", stored: false, limitReached: false },
      "sess-st"
    ),
    sender(undefined, "chrome-extension://test/offscreen.html")
  );
  assert.equal((result as { ok: boolean }).ok, true);
  assert.ok(streamHealthMonitor.calls.includes("updateStream:storage:failed"));
});

test("路由: offscreen/media-state 错误时落 MEDIA_RECORDER_FAILED", async () => {
  const { runtime, db } = createTestRuntime();
  const session = makeSession({ id: "sess-media", status: "RECORDING" });
  db.sessions.set(session.id, session);
  db.activeSessionId = session.id;
  const { handlers } = installChromeMock();
  handlers.getURL = () => "chrome-extension://test/offscreen.html";

  const result = await runtime.handleMessage(
    message(
      "offscreen/media-state",
      { sessionId: "sess-media", state: "error", error: "recorder failed" },
      "sess-media"
    ),
    sender(undefined, "chrome-extension://test/offscreen.html")
  );
  assert.equal((result as { ok: boolean }).ok, true);
  const updated = db.sessions.get("sess-media")!;
  assert.ok(
    updated.quality.issues.some(
      (entry) => entry.code === "MEDIA_RECORDER_FAILED"
    )
  );
});
