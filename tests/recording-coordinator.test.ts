import assert from "node:assert/strict";
import test from "node:test";

import { RecordingCoordinator } from "../src/recording/recording-coordinator.ts";

test("recording lifecycle work is serialized", async () => {
  const coordinator = new RecordingCoordinator();
  const events: string[] = [];
  let releaseFirst!: () => void;
  let markStarted!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const first = coordinator.runLifecycle(async () => { events.push("first:start"); markStarted(); await firstGate; events.push("first:end"); });
  const second = coordinator.runLifecycle(async () => { events.push("second"); });
  await started;
  assert.deepEqual(events, ["first:start"]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, ["first:start", "first:end", "second"]);
});

test("duplicate stop requests share one flight and stopping state is explicit", async () => {
  const coordinator = new RecordingCoordinator();
  let calls = 0;
  let finish!: (value: number) => void;
  const pending = new Promise<number>((resolve) => { finish = resolve; });
  const first = coordinator.runStop("session", async () => { calls += 1; return pending; });
  const second = coordinator.runStop("session", async () => { calls += 1; return 2; });
  assert.equal(first, second);
  assert.equal(calls, 1);
  coordinator.beginStopping("session");
  assert.equal(coordinator.isStopping("session"), true);
  coordinator.finishStopping("session");
  assert.equal(coordinator.isStopping("session"), false);
  finish(1);
  assert.equal(await first, 1);
});
