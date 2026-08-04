import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  isRectIntersecting,
  SpatialPruner,
  type BoundingBox,
} from "../src/entrypoints/content/collector/spatial-pruner";
import { TemporalTracer } from "../src/entrypoints/content/collector/temporal-tracer";
import { SpatialTemporalSnapshotBuilder } from "../src/entrypoints/content/collector/spatial-temporal-builder";

describe("Spatial & Temporal Snapshot Tests", () => {
  test("isRectIntersecting correctly identifies overlapping bounding boxes", () => {
    const boxA: BoundingBox = { x: 10, y: 10, width: 100, height: 100 };
    const boxB: BoundingBox = { x: 50, y: 50, width: 100, height: 100 };
    const boxC: BoundingBox = { x: 200, y: 200, width: 50, height: 50 };

    assert.equal(
      isRectIntersecting(boxA, boxB),
      true,
      "boxA and boxB should overlap"
    );
    assert.equal(
      isRectIntersecting(boxA, boxC),
      false,
      "boxA and boxC should not overlap"
    );
  });

  test("TemporalTracer collects and filters logs within target time window", () => {
    TemporalTracer.reset();
    const now = Date.now();

    TemporalTracer.addLog({
      timestamp: now - 10000, // 10s 前
      type: "console",
      level: "error",
      message: "Old error",
    });

    TemporalTracer.addLog({
      timestamp: now - 2000, // 2s 前
      type: "console",
      level: "error",
      message: "Recent error",
    });

    const trace = TemporalTracer.traceRecentContext(now, 5000);
    assert.equal(trace.logs.length, 1);
    assert.equal(trace.logs[0].message, "Recent error");
  });

  test("SpatialTemporalSnapshotBuilder correctly formats structured Markdown", () => {
    const snapshot = {
      timestamp: 1700000000000,
      url: "https://example.com/app",
      title: "Test App",
      viewport: { width: 1920, height: 1080 },
      spatial: {
        boundingBox: { x: 100, y: 100, width: 200, height: 150 },
        nodes: [],
        components: [
          {
            framework: "react" as const,
            name: "UserProfileCard",
            props: { userId: 123 },
            state: { isLoading: false },
          },
        ],
      },
      temporal: {
        timeWindowMs: 5000,
        logs: [
          {
            timestamp: 1700000000000,
            type: "console" as const,
            level: "error" as const,
            message: "Failed to load user avatar",
          },
        ],
      },
    };

    const markdown = SpatialTemporalSnapshotBuilder.formatToMarkdown(snapshot);
    assert.ok(markdown.includes("UserProfileCard"));
    assert.ok(markdown.includes("Failed to load user avatar"));
    assert.ok(markdown.includes("1920x1080"));
  });
});
