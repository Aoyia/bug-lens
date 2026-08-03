import assert from "node:assert/strict";
import test from "node:test";

import {
  RecordingCoordinator,
  type StoppingPersistence,
} from "../src/recording/recording-coordinator.ts";

test("recording lifecycle work is serialized", async () => {
  const coordinator = new RecordingCoordinator();
  const events: string[] = [];
  let releaseFirst!: () => void;
  let markStarted!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const first = coordinator.runLifecycle(async () => {
    events.push("first:start");
    markStarted();
    await firstGate;
    events.push("first:end");
  });
  const second = coordinator.runLifecycle(async () => {
    events.push("second");
  });
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
  const pending = new Promise<number>((resolve) => {
    finish = resolve;
  });
  const first = coordinator.runStop("session", async () => {
    calls += 1;
    return pending;
  });
  const second = coordinator.runStop("session", async () => {
    calls += 1;
    return 2;
  });
  assert.equal(first, second);
  assert.equal(calls, 1);
  coordinator.beginStopping("session");
  assert.equal(coordinator.isStopping("session"), true);
  coordinator.finishStopping("session");
  assert.equal(coordinator.isStopping("session"), false);
  finish(1);
  assert.equal(await first, 1);
});

test("stopping state is persisted via StoppingPersistence adapter", async () => {
  let persisted: string[] = [];
  const persistence: StoppingPersistence = {
    save(ids) {
      persisted = [...ids];
    },
    async load() {
      return persisted;
    },
  };
  const coordinator = new RecordingCoordinator(persistence);

  coordinator.beginStopping("session-a");
  assert.deepEqual(persisted, ["session-a"]);
  assert.equal(coordinator.isStopping("session-a"), true);

  coordinator.beginStopping("session-b");
  assert.deepEqual(persisted.sort(), ["session-a", "session-b"]);

  coordinator.finishStopping("session-a");
  assert.deepEqual(persisted, ["session-b"]);
  assert.equal(coordinator.isStopping("session-a"), false);
  assert.equal(coordinator.isStopping("session-b"), true);

  coordinator.finishStopping("session-b");
  assert.deepEqual(persisted, []);
});

test("restoreStoppingIds recovers state from persistence", async () => {
  const persistence: StoppingPersistence = {
    save() {},
    async load() {
      return ["restored-1", "restored-2"];
    },
  };
  const coordinator = new RecordingCoordinator(persistence);
  assert.equal(coordinator.isStopping("restored-1"), false);

  await coordinator.restoreStoppingIds();
  assert.equal(coordinator.isStopping("restored-1"), true);
  assert.equal(coordinator.isStopping("restored-2"), true);
  assert.equal(coordinator.isStopping("unknown"), false);
});

test("coordinator works without persistence (backward compatible)", () => {
  const coordinator = new RecordingCoordinator();
  coordinator.beginStopping("session");
  assert.equal(coordinator.isStopping("session"), true);
  coordinator.finishStopping("session");
  assert.equal(coordinator.isStopping("session"), false);
});
