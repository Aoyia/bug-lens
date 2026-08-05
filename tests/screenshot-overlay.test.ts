import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ScreenshotOverlay } from "../src/screenshot/screenshot-overlay.ts";

describe("Screenshot Overlay - 微信截图4大核心优化卡口", () => {
  test("安全实例化 ScreenshotOverlay 结构", () => {
    const overlay = new ScreenshotOverlay();
    assert.ok(overlay);
    assert.equal(typeof overlay.show, "function");
    assert.equal(typeof overlay.destroy, "function");
  });

  test("ScreenshotOverlay 必须暴露 8 点 Resize、Inline 文本框及工具栏智能避让的对应 DOM 方法", () => {
    const overlay = new ScreenshotOverlay();
    assert.ok(overlay);
    assert.equal(typeof (overlay as any).renderMagnifier, "function");
    assert.equal(typeof (overlay as any).renderSelectionBox, "function");
    assert.equal(typeof (overlay as any).showToast, "function");
    assert.equal(typeof (overlay as any).spawnInlineTextInput, "function");
    assert.equal((overlay as any).isSelectionLocked, false);
    assert.equal((overlay as any).handleDblClick, undefined);
  });
});
