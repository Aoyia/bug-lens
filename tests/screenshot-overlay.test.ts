import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ScreenshotOverlay,
  buildScreenshotToastMessage,
} from "../src/screenshot/screenshot-overlay.ts";

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

  test("截图完成 toast 文案随 promptInjectedWithPath 分支", () => {
    // 非扩展环境（无 chrome.i18n / 离线字典）下 t() 回退返回 key
    assert.equal(buildScreenshotToastMessage(true), "screenshotToastWithPath");
    assert.equal(
      buildScreenshotToastMessage(false),
      "screenshotToastWithoutPath"
    );
  });
});
