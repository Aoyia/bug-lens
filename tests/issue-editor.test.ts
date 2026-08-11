import assert from "node:assert/strict";
import test from "node:test";
import {
  isEnterCommitKey,
  resolveEscapeTarget,
  shouldWarnEmptyActual,
} from "../src/entrypoints/content/collector/issue-editor.ts";

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

test("issue-editor: 单行输入框内按 Enter 触发保存并继续", () => {
  assert.equal(isEnterCommitKey({ key: "Enter" }), true);
  assert.equal(isEnterCommitKey({ key: "Enter", keyCode: 13 }), true);
});

test("issue-editor: 输入法组词状态下 Enter 不触发提交（中文候选词确认）", () => {
  assert.equal(isEnterCommitKey({ key: "Enter", isComposing: true }), false);
  assert.equal(
    isEnterCommitKey({ key: "Enter", isComposing: true, keyCode: 13 }),
    false
  );
  // 兼容值兜底：部分浏览器 isComposing 不可靠时 keyCode 229 同样拦截
  assert.equal(isEnterCommitKey({ key: "Enter", keyCode: 229 }), false);
});

test("issue-editor: 非 Enter 键不触发提交", () => {
  assert.equal(isEnterCommitKey({ key: "a" }), false);
  assert.equal(isEnterCommitKey({ key: "Tab" }), false);
  assert.equal(isEnterCommitKey({ key: "Escape" }), false);
  assert.equal(isEnterCommitKey({ key: "" }), false);
});

test("issue-editor: Esc 在文字批注浮层聚焦时让位给浮层（含与表单同聚焦的边界）", () => {
  assert.equal(resolveEscapeTarget(true, false), "text-overlay");
  assert.equal(resolveEscapeTarget(true, true), "text-overlay");
});

test("issue-editor: Esc 在表单字段聚焦时仅失焦，不取消编辑器", () => {
  assert.equal(resolveEscapeTarget(false, true), "form-field");
});

test("issue-editor: 非文本输入场景 Esc 取消整个编辑器（等价顶部 ✕）", () => {
  assert.equal(resolveEscapeTarget(false, false), "editor");
});
