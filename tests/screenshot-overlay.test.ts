import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ScreenshotOverlay,
  buildScreenshotToastMessage,
} from "../src/screenshot/overlay/screenshot-overlay";
import { createOverlayMarkup } from "../src/screenshot/overlay/overlay-template";
import { ANNOTATION_TOOLBAR_CSS } from "../src/shared/ui/annotation-toolbar";
import { computeToolbarPosition } from "../src/screenshot/overlay/selection-controller";

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
    assert.equal(typeof (overlay as any).handleDoubleClick, "function");
  });

  test("截图完成 toast 文案随 promptInjectedWithPath 分支", () => {
    // 非扩展环境（无 chrome.i18n / 离线字典）下 t() 回退返回 key
    assert.equal(buildScreenshotToastMessage(true), "screenshotToastWithPath");
    assert.equal(
      buildScreenshotToastMessage(false),
      "screenshotToastWithoutPath"
    );
  });

  test("移动端适配 CSS：工具栏支持换行防溢出、手柄扩展透明点击热区与 touch-action: none", () => {
    assert.ok(ANNOTATION_TOOLBAR_CSS.includes("max-width: calc(100vw - 16px)"));
    assert.ok(ANNOTATION_TOOLBAR_CSS.includes("flex-wrap: wrap"));
    assert.ok(ANNOTATION_TOOLBAR_CSS.includes("box-sizing: border-box"));
    assert.ok(ANNOTATION_TOOLBAR_CSS.includes("row-gap: 4px"));
    assert.ok(ANNOTATION_TOOLBAR_CSS.includes("width: max-content"));

    const markup = createOverlayMarkup();
    assert.ok(markup.includes("touch-action: none;"));
    assert.ok(markup.includes(".handle::after"));
    assert.ok(markup.includes("inset: -10px;"));
  });

  test("computeToolbarPosition：窄屏折行高度与左右边界钳制", () => {
    // 1) 375x667 窄屏左边缘小选区（两行折行高度 72px）→ 下方空间充足且左边缘钳制到 8
    const leftPos = computeToolbarPosition(
      { x: 10, y: 100, width: 60, height: 80 },
      340,
      72,
      375,
      667
    );
    assert.equal(leftPos.viewportLeft, 8);
    assert.equal(leftPos.left, -2);
    assert.equal(leftPos.viewportTop, 188);
    assert.equal(leftPos.top, 88);

    // 2) 底部空间不足（< 72 + 16）但顶部充足 → 放选区上方（按两行高度定位）
    const topPos = computeToolbarPosition(
      { x: 20, y: 200, width: 100, height: 420 },
      340,
      72,
      375,
      667
    );
    assert.equal(topPos.viewportTop, 200 - 72 - 8);
    assert.equal(topPos.top, -80);
    assert.ok(topPos.viewportLeft >= 8 && topPos.viewportLeft + 340 <= 367);

    // 3) 全屏选区上下均不足 → 内嵌在视口底部安全边距 12px
    const fullPos = computeToolbarPosition(
      { x: 0, y: 0, width: 375, height: 667 },
      340,
      72,
      375,
      667
    );
    assert.equal(fullPos.viewportTop, 667 - 72 - 12);
    assert.equal(fullPos.viewportLeft, 27);
  });
});
