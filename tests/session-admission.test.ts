import assert from "node:assert/strict";
import test from "node:test";
import {
  getAdmissionRejection,
  isTrackedTab,
} from "../src/domain/session-admission.ts";
import type { RecordingSession } from "../src/shared/protocol.ts";

function createMockSession(
  overrides: Partial<RecordingSession> = {}
): RecordingSession {
  return {
    id: "session-1",
    status: "RECORDING",
    target: {
      tabId: 100,
      windowId: 1,
      initialUrl: "https://example.com",
      initialTitle: "Example",
    },
    targets: [
      {
        tabId: 100,
        windowId: 1,
        url: "https://example.com",
        title: "Example",
        isPrimary: true,
      },
      {
        tabId: 101,
        windowId: 1,
        url: "https://example.com/derived",
        title: "Derived Tab",
        isPrimary: false,
      },
    ],
    options: {
      privacyMode: "safe",
      captureConsole: true,
      captureNetwork: true,
      captureFrameworkState: false,
      autoTrackDerivedTabs: true,
    },
    timeline: {
      createdAtEpochMs: 1000,
      startedAtEpochMs: 1000,
    },
    quality: {
      interactionCount: 0,
      confirmedInteractionCount: 0,
      primaryScreenshotCount: 0,
      fallbackScreenshotCount: 0,
      unavailableScreenshotCount: 0,
      consoleEntryCount: 0,
      networkEntryCount: 0,
    },
    nonce: "test-nonce-123",
    ...overrides,
  };
}

test("domain/session-admission: isTrackedTab matches primary and derived targets", () => {
  const session = createMockSession();

  assert.equal(isTrackedTab(session, 100), true);
  assert.equal(isTrackedTab(session, 101), true);
  assert.equal(isTrackedTab(session, 999), false);
  assert.equal(isTrackedTab(session, undefined), false);
  assert.equal(isTrackedTab(undefined, 100), false);

  // extraTracked: Set
  const extraSet = new Set([200, 201]);
  assert.equal(isTrackedTab(session, 200, extraSet), true);
  assert.equal(isTrackedTab(session, 999, extraSet), false);

  // extraTracked: Function
  const extraFn = (id: number) => id === 300;
  assert.equal(isTrackedTab(session, 300, extraFn), true);
  assert.equal(isTrackedTab(session, 999, extraFn), false);
});

test("domain/session-admission: getAdmissionRejection validates standard admission chain", () => {
  const session = createMockSession();
  const notStopping = () => false;

  // 1. 主 tab 准入通过
  assert.equal(
    getAdmissionRejection({
      session,
      tabId: 100,
      nonce: "test-nonce-123",
      isStopping: notStopping,
    }),
    undefined
  );

  // 2. 派生 tab 准入通过（核心修复场景）
  assert.equal(
    getAdmissionRejection({
      session,
      tabId: 101,
      nonce: "test-nonce-123",
      isStopping: notStopping,
    }),
    undefined
  );

  // 3. 陌生 tab 拒绝
  assert.equal(
    getAdmissionRejection({
      session,
      tabId: 999,
      nonce: "test-nonce-123",
      isStopping: notStopping,
    }),
    "TAB_NOT_TRACKED"
  );

  // 4. tabId 为 undefined
  assert.equal(
    getAdmissionRejection({
      session,
      tabId: undefined,
      nonce: "test-nonce-123",
      isStopping: notStopping,
    }),
    "TAB_NOT_TRACKED"
  );

  // 5. nonce 不匹配或缺失
  assert.equal(
    getAdmissionRejection({
      session,
      tabId: 101,
      nonce: "wrong-nonce",
      isStopping: notStopping,
    }),
    "NONCE_MISMATCH"
  );
  assert.equal(
    getAdmissionRejection({
      session,
      tabId: 101,
      nonce: undefined,
      isStopping: notStopping,
    }),
    "NONCE_MISMATCH"
  );

  // 6. 会话停止中
  assert.equal(
    getAdmissionRejection({
      session,
      tabId: 101,
      nonce: "test-nonce-123",
      isStopping: (id) => id === "session-1",
    }),
    "STOPPING"
  );

  // 7. 会话状态非录制
  const idleSession = createMockSession({ status: "STOPPING" });
  assert.equal(
    getAdmissionRejection({
      session: idleSession,
      tabId: 101,
      nonce: "test-nonce-123",
      isStopping: notStopping,
    }),
    "NOT_RECORDING"
  );

  // 8. 无活动会话
  assert.equal(
    getAdmissionRejection({
      session: undefined,
      tabId: 101,
      nonce: "test-nonce-123",
      isStopping: notStopping,
    }),
    "NO_SESSION"
  );
});
