import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { collectCascadeIndex } from "../src/screenshot/cascade-snapshot-collector.ts";

describe("Cascade Snapshot Collector (CSSOM 快照收集)", () => {
  test("在无 DOM 环境降级导出空快照结构", () => {
    const result = collectCascadeIndex({});
    assert.strictEqual(Array.isArray(result.sheets), true);
    assert.strictEqual(Array.isArray(result.rules), true);
    assert.strictEqual(Array.isArray(result.elements), true);
    assert.strictEqual(typeof result.perProperty, "object");
  });
});
