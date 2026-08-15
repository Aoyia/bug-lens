import assert from "node:assert/strict";
import test from "node:test";

import { InteractionCapture } from "../src/recording/interaction-capture.ts";
import type { RecordingSessionEvent } from "../src/domain/recording-session.ts";
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

test("iframe 内交互的截图失败会给出用户可读文案与独立错误码（A7）", async () => {
  let stored: InteractionRecord | undefined;
  const sessionEvents: RecordingSessionEvent[] = [];
  // iframe 截图仅在开启点击截图时触发
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
    },
    async (_sessionId, event) => {
      sessionEvents.push(event);
      return iframeSession;
    },
    () => false
  );

  await capture.handle(interaction, {
    tab: { id: 7 },
    frameId: 1,
  } as chrome.runtime.MessageSender);

  const issueEvent = sessionEvents.find(
    (
      event
    ): event is Extract<RecordingSessionEvent, { type: "capture-issue" }> =>
      event.type === "capture-issue"
  );
  assert.ok(issueEvent, "iframe 截图失败应产生 capture-issue 事件");
  assert.equal(issueEvent.issue.code, "IFRAME_CAPTURE_UNSUPPORTED");
  assert.equal(
    issueEvent.issue.message,
    "iframeCaptureUnsupported",
    "错误文案应走 i18n key 而非开发者术语"
  );
  assert.ok(
    !issueEvent.issue.message.includes("FRAME_GEOMETRY_UNAVAILABLE:"),
    "告警不应包含开发者内部前缀"
  );
  assert.deepEqual(await capture.drain(), []);
});
