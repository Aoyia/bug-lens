import assert from "node:assert/strict";
import test from "node:test";
import { shouldWarnEmptyActual } from "../src/entrypoints/content/collector/issue-editor.ts";

test("issue-editor: 实际为空且未提示过时拦截并返回 true", () => {
  assert.equal(shouldWarnEmptyActual("", false), true);
  assert.equal(shouldWarnEmptyActual("   ", false), true);
});

test("issue-editor: 已提示过（二次确认）后允许按空记录保存", () => {
  assert.equal(shouldWarnEmptyActual("", true), false);
  assert.equal(shouldWarnEmptyActual("  ", true), false);
});

test("issue-editor: 实际非空时始终允许提交", () => {
  assert.equal(shouldWarnEmptyActual("页面无响应", false), false);
  assert.equal(shouldWarnEmptyActual("页面无响应", true), false);
});
