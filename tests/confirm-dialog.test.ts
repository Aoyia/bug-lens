import assert from "node:assert/strict";
import test from "node:test";
import { bindConfirmDialogDismiss } from "../src/popup/confirm-dialog.ts";

function createFakeWin() {
  const listeners: Record<string, Function[]> = {};
  return {
    addEventListener(type: string, fn: Function) {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(fn);
    },
    removeEventListener(type: string, fn: Function) {
      if (listeners[type]) {
        listeners[type] = listeners[type].filter((f) => f !== fn);
      }
    },
    dispatchEvent(event: any) {
      if (listeners[event.type]) {
        listeners[event.type].forEach((fn) => fn(event));
      }
      return true;
    },
  };
}

test("confirm-dialog: 打开时焦点移动到安全默认操作（取消按钮）", () => {
  const win = createFakeWin();
  const focused: string[] = [];
  const cancelButton = {
    focus() {
      focused.push("cancel");
    },
  };
  const trigger = {
    focus() {
      focused.push("trigger");
    },
  };

  bindConfirmDialogDismiss({
    cancelButton: cancelButton as any,
    trigger: trigger as any,
    onCancel: () => {},
    win: win as any,
  });

  assert.deepEqual(focused, ["cancel"], "对话框打开时焦点应落在取消按钮");
});

test("confirm-dialog: Escape 取消对话框并阻止默认行为与传播", () => {
  const win = createFakeWin();
  let cancelled = 0;
  const calls: string[] = [];

  const unbind = bindConfirmDialogDismiss({
    onCancel: () => {
      cancelled++;
    },
    win: win as any,
  });

  win.dispatchEvent({
    type: "keydown",
    key: "Escape",
    preventDefault() {
      calls.push("preventDefault");
    },
    stopPropagation() {
      calls.push("stopPropagation");
    },
  });
  assert.equal(cancelled, 1, "Escape 应触发取消回调");
  assert.ok(
    calls.includes("preventDefault"),
    "Escape 应阻止默认行为（避免弹窗壳层把 Escape 当作关闭整个 popup）"
  );
  assert.ok(calls.includes("stopPropagation"), "Escape 应阻止事件继续传播");

  // 非 Escape 键不应取消
  win.dispatchEvent({ type: "keydown", key: "Enter" });
  assert.equal(cancelled, 1, "非 Escape 键不应取消对话框");

  // 解绑后 Escape 不再取消
  unbind();
  win.dispatchEvent({
    type: "keydown",
    key: "Escape",
    preventDefault() {},
    stopPropagation() {},
  });
  assert.equal(cancelled, 1, "解绑后按 Escape 不应再取消");
});

test("confirm-dialog: 关闭（解绑）后焦点归还给触发元素", () => {
  const win = createFakeWin();
  const focused: string[] = [];
  const trigger = {
    focus() {
      focused.push("trigger");
    },
  };

  const unbind = bindConfirmDialogDismiss({
    trigger: trigger as any,
    onCancel: () => {},
    win: win as any,
  });

  unbind();
  assert.deepEqual(focused, ["trigger"], "关闭后焦点应归还触发元素");
});
