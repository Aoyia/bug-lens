import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  extractBoxModelGeometry,
  extractLayoutContext,
} from "../src/screenshot/dom-spatial-collector.ts";

describe("Box-Model Geometry & Layout Engine Extractor", () => {
  test("在非 DOM 环境安全降级返回 undefined", () => {
    // @ts-expect-error Mock element
    const result = extractBoxModelGeometry(null);
    assert.strictEqual(result, undefined);
  });

  test("在非 DOM 环境安全降级返回 undefined 布局上下文", () => {
    // @ts-expect-error Mock element
    const result = extractLayoutContext(null);
    assert.strictEqual(result, undefined);
  });
});
