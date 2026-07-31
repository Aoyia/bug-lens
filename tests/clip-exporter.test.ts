import assert from "node:assert/strict";
import test from "node:test";
import { calculateClipRange } from "../src/domain/clip-calculator.ts";

test("calculateClipRange centers 5-second window around timestamp", () => {
  const startedAt = 1_000_000;
  const nodeTimestamp = 1_010_000; // 10s mark
  const durationSec = 20;

  const range = calculateClipRange(nodeTimestamp, startedAt, durationSec, 2.5);
  assert.deepEqual(range, { startTime: 7.5, endTime: 12.5 });
});

test("calculateClipRange handles beginning edge (less than 2.5s)", () => {
  const startedAt = 1_000_000;
  const nodeTimestamp = 1_001_000; // 1s mark
  const durationSec = 10;

  const range = calculateClipRange(nodeTimestamp, startedAt, durationSec, 2.5);
  assert.deepEqual(range, { startTime: 0, endTime: 5 });
});

test("calculateClipRange handles ending edge (near end of video)", () => {
  const startedAt = 1_000_000;
  const nodeTimestamp = 1_009_000; // 9s mark
  const durationSec = 10;

  const range = calculateClipRange(nodeTimestamp, startedAt, durationSec, 2.5);
  assert.deepEqual(range, { startTime: 5, endTime: 10 });
});

test("calculateClipRange handles video total duration less than 5s", () => {
  const startedAt = 1_000_000;
  const nodeTimestamp = 1_002_000; // 2s mark
  const durationSec = 3.5;

  const range = calculateClipRange(nodeTimestamp, startedAt, durationSec, 2.5);
  assert.deepEqual(range, { startTime: 0, endTime: 3.5 });
});
