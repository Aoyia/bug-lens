import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { fetchStyleSourceInfoWithCDP } from "../src/screenshot/cdp-style-source.ts";

describe("CDP Style Source Extractor", () => {
  test("在无 chrome.debugger 环境下实现安全降级返回空数组", async () => {
    // @ts-expect-error Mocking for non-extension node runtime
    globalThis.chrome = globalThis.chrome || {};

    const result = await fetchStyleSourceInfoWithCDP(999, [".btn"]);
    assert.strictEqual(Array.isArray(result), true);
    assert.strictEqual(result.length, 0);
  });
});
