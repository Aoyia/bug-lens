import assert from "node:assert/strict";
import test from "node:test";
import {
  detectIdleGaps,
  MAX_IDLE_GAP_THRESHOLD_MS,
} from "../src/recording/idle-monitor.ts";

test("detectIdleGaps correctly identifies gaps larger than threshold", () => {
  const timestamps = [
    1000,
    2000,
    3000,
    3000 + MAX_IDLE_GAP_THRESHOLD_MS + 1000, // 5分01秒空闲断层
    3000 + MAX_IDLE_GAP_THRESHOLD_MS + 5000,
  ];

  const gaps = detectIdleGaps(timestamps, MAX_IDLE_GAP_THRESHOLD_MS);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].startIndex, 2);
  assert.equal(gaps[0].endIndex, 3);
  assert.equal(gaps[0].formattedGap, "5.0 min");
});

test("detectIdleGaps returns empty array when no large gap exists", () => {
  const timestamps = [1000, 2000, 3000, 4000, 5000];
  const gaps = detectIdleGaps(timestamps);
  assert.equal(gaps.length, 0);
});
