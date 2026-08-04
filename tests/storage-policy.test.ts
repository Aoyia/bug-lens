import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_STORAGE_POLICY,
  VIDEO_BITRATE_BY_COMPRESSION,
  normalizeRecordingOptions,
  normalizeStoragePolicy,
} from "../src/domain/storage-policy.ts";

describe("Recording video compression", () => {
  test("videoBitsPerSecond defaults from the storage policy compression tier", () => {
    const balanced = normalizeRecordingOptions({}, normalizeStoragePolicy({}));
    assert.equal(
      balanced.videoBitsPerSecond,
      VIDEO_BITRATE_BY_COMPRESSION[DEFAULT_STORAGE_POLICY.compression]
    );
    assert.equal(balanced.videoBitsPerSecond, 2_500_000);

    const small = normalizeRecordingOptions(
      {},
      normalizeStoragePolicy({ compression: "small" })
    );
    assert.equal(small.videoBitsPerSecond, VIDEO_BITRATE_BY_COMPRESSION.small);
    assert.equal(small.videoBitsPerSecond, 1_200_000);

    const quality = normalizeRecordingOptions(
      {},
      normalizeStoragePolicy({ compression: "quality" })
    );
    assert.equal(
      quality.videoBitsPerSecond,
      VIDEO_BITRATE_BY_COMPRESSION.quality
    );
  });

  test("explicit videoBitsPerSecond wins and is clamped", () => {
    const explicit = normalizeRecordingOptions(
      { videoBitsPerSecond: 3_000_000 },
      normalizeStoragePolicy({ compression: "small" })
    );
    assert.equal(explicit.videoBitsPerSecond, 3_000_000);

    const clamped = normalizeRecordingOptions(
      { videoBitsPerSecond: 100 },
      normalizeStoragePolicy({})
    );
    assert.equal(clamped.videoBitsPerSecond, 2_500_000);
  });

  test("captureFrameworkState is enabled by default and can be disabled", () => {
    const defaults = normalizeRecordingOptions({});
    assert.equal(defaults.captureFrameworkState, true);
    const disabled = normalizeRecordingOptions({
      captureFrameworkState: false,
    });
    assert.equal(disabled.captureFrameworkState, false);
  });
});
