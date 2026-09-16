import assert from "node:assert/strict";
import test from "node:test";

import { applySessionEvent } from "../src/domain/recording-session.ts";
import type { CaptureIssue, RecordingSession } from "../src/shared/protocol.ts";

function session(
  status: RecordingSession["status"] = "PREPARING"
): RecordingSession {
  return {
    id: "session-1",
    schemaVersion: 1,
    extensionVersion: "0.1.0",
    status,
    target: {
      tabId: 7,
      initialUrl: "https://example.test",
      initialTitle: "Example",
    },
    options: {
      captureAudio: false,
      privacyMode: "safe",
      mediaTimesliceMs: 1_000,
    },
    timeline: { createdAtEpochMs: 1_000 },
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
    nonce: "nonce-1",
    commandIds: { start: "start-1" },
  };
}

function issue(code: string): CaptureIssue {
  return {
    code,
    message: code,
    source: "media",
    recoverable: false,
    occurredAt: 1_100,
  };
}

test("media failure during startup remains degraded after startup completes", () => {
  const degraded = applySessionEvent(session(), {
    type: "capture-issue",
    issue: issue("MEDIA_FAILED"),
  });
  const started = applySessionEvent(degraded, {
    type: "started",
    atEpochMs: 1_200,
  });

  assert.equal(started.status, "DEGRADED");
  assert.equal(started.quality.overall, "partial");
  assert.deepEqual(
    started.quality.issues.map((item) => item.code),
    ["MEDIA_FAILED"]
  );
});

test("independent quality deltas accumulate instead of overwriting each other", () => {
  const withConsole = applySessionEvent(session("RECORDING"), {
    type: "quality-delta",
    delta: { consoleEntryCount: 1 },
  });
  const withNetwork = applySessionEvent(withConsole, {
    type: "quality-delta",
    delta: { networkEntryCount: 1 },
  });

  assert.equal(withNetwork.quality.consoleEntryCount, 1);
  assert.equal(withNetwork.quality.networkEntryCount, 1);
});

test("late capture events cannot regress a preview-ready session", () => {
  const ready = session("PREVIEW_READY");
  const result = applySessionEvent(ready, {
    type: "capture-issue",
    issue: issue("LATE_ERROR"),
  });

  assert.deepEqual(result, ready);
});

test("browser restart recovers an active session as partial preview evidence", () => {
  const recovered = applySessionEvent(session("RECORDING"), {
    type: "recover",
    atEpochMs: 5_000,
    issue: issue("BROWSER_RESTARTED"),
  });

  assert.equal(recovered.status, "PREVIEW_READY");
  assert.equal(recovered.timeline.stoppedAtEpochMs, 5_000);
  assert.equal(recovered.timeline.durationMs, 4_000);
  assert.equal(recovered.quality.overall, "partial");
  assert.equal(recovered.quality.issues.at(-1)?.code, "BROWSER_RESTARTED");
});

test("stop command is persisted once and duplicate stops keep the first timestamp", () => {
  const stopping = applySessionEvent(session("RECORDING"), {
    type: "stop-requested",
    atEpochMs: 2_000,
    commandId: "stop-1",
  });
  const duplicate = applySessionEvent(stopping, {
    type: "stop-requested",
    atEpochMs: 3_000,
    commandId: "stop-1",
  });

  assert.equal(duplicate.status, "STOPPING");
  assert.equal(duplicate.timeline.stoppedAtEpochMs, 2_000);
  assert.equal(duplicate.commandIds?.stop, "stop-1");
});

test("session correctly transitions between paused and resumed states", () => {
  const recording = session("RECORDING");
  const paused = applySessionEvent(recording, {
    type: "paused",
    atEpochMs: 3_000,
    pausedDurationMs: 500,
  });

  assert.equal(paused.timeline.isPaused, true);
  assert.equal(paused.timeline.pausedAtEpochMs, 3_000);
  assert.equal(paused.timeline.pausedDurationMs, 500);

  const resumed = applySessionEvent(paused, {
    type: "resumed",
    atEpochMs: 5_000,
    pausedDurationMs: 2_500,
  });

  assert.equal(resumed.timeline.isPaused, false);
  assert.equal(resumed.timeline.pausedAtEpochMs, undefined);
  assert.equal(resumed.timeline.pausedDurationMs, 2_500);
});

test("stop-completed deducts pausedDurationMs from durationMs", () => {
  const recording = session("RECORDING");
  recording.timeline.startedAtEpochMs = 1_000;
  recording.timeline.pausedDurationMs = 2_000;

  const stopped = applySessionEvent(recording, {
    type: "stop-completed",
    atEpochMs: 10_000,
    pausedDurationMs: 3_000,
  });

  assert.equal(stopped.status, "PREVIEW_READY");
  assert.equal(stopped.timeline.stoppedAtEpochMs, 10_000);
  assert.equal(stopped.timeline.pausedDurationMs, 3_000);
  // 10000 - 1000 - 3000 = 6000
  assert.equal(stopped.timeline.durationMs, 6_000);
  assert.equal(stopped.timeline.isPaused, false);
});
