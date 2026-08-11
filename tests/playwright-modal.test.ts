import assert from "node:assert/strict";
import test from "node:test";
import { bindPlaywrightModalClose } from "../src/preview/playwright-modal.ts";

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

test("Playwright 弹窗 - Escape 关闭行为与解绑", () => {
  const win = createFakeWin();
  const modal = { hidden: false };

  const unbind = bindPlaywrightModalClose(modal as any, win as any);

  // 1. 弹窗打开时按 Escape 关闭
  win.dispatchEvent({ type: "keydown", key: "Escape" });
  assert.equal(modal.hidden, true, "弹窗打开时按 Escape 应关闭");

  // 2. 弹窗已隐藏时按 Escape 保持隐藏（不产生副作用）
  win.dispatchEvent({ type: "keydown", key: "Escape" });
  assert.equal(modal.hidden, true, "弹窗已隐藏时按 Escape 不应改变状态");

  // 3. 弹窗打开时按其他键不应关闭
  modal.hidden = false;
  win.dispatchEvent({ type: "keydown", key: "x" });
  assert.equal(modal.hidden, false, "按非 Escape 键不应关闭弹窗");

  // 4. 解绑后按 Escape 不再关闭
  unbind();
  win.dispatchEvent({ type: "keydown", key: "Escape" });
  assert.equal(modal.hidden, false, "解绑后按 Escape 不应再关闭弹窗");
});
