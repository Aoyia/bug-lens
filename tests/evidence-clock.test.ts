import assert from "node:assert/strict";
import test from "node:test";

import {
  formatElapsedEpochTime,
  networkDurationMs,
  networkRequestTime
} from "../src/domain/evidence-clock.ts";

test("Network wallTime is the epoch clock and timestamp stays monotonic", () => {
  assert.deepEqual(
    networkRequestTime({ wallTime: 1_780_000_000.125, timestamp: 12_345.678 }, () => 99),
    { createdAtEpochMs: 1_780_000_000_125, startedAtMonotonicMs: 12_345_678 }
  );
});

test("missing Network wallTime falls back to the local epoch clock", () => {
  assert.deepEqual(
    networkRequestTime({ timestamp: 12.5 }, () => 1_800_000_000_000),
    { createdAtEpochMs: 1_800_000_000_000, startedAtMonotonicMs: 12_500 }
  );
});

test("Network duration is derived only from its monotonic clock", () => {
  assert.equal(networkDurationMs(12_500, 12.875), 375);
  assert.equal(networkDurationMs(undefined, 12.875), undefined);
  assert.equal(networkDurationMs(13_000, 12.875), undefined);
});

test("preview elapsed time uses the session epoch timeline", () => {
  assert.equal(formatElapsedEpochTime(1_701_250, 1_700_000), "00:01.250");
  assert.equal(formatElapsedEpochTime(1_699_999, 1_700_000), undefined);
});
