import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  ScreenshotOverlay,
  buildScreenshotToastMessage,
} from "../src/screenshot/overlay/screenshot-overlay";
import { createOverlayMarkup } from "../src/screenshot/overlay/overlay-template";
import { ANNOTATION_TOOLBAR_CSS } from "../src/shared/ui/annotation-toolbar";
import { computeToolbarPosition } from "../src/screenshot/overlay/selection-controller";
import { MagnifierRenderer } from "../src/screenshot/overlay/overlay-widgets";

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

    // 极端窄屏 <= 360px 下单行紧凑防折行遮挡
    assert.ok(ANNOTATION_TOOLBAR_CSS.includes("@media (max-width: 360px)"));
    assert.ok(ANNOTATION_TOOLBAR_CSS.includes("flex-wrap: nowrap"));
    assert.ok(ANNOTATION_TOOLBAR_CSS.includes("overflow-x: auto"));

    const markup = createOverlayMarkup();
    assert.ok(markup.includes("touch-action: none;"));
    assert.ok(markup.includes(".handle::after"));
    assert.ok(markup.includes("inset: -10px;"));

    // .mag-tag 防止标签多行撑高
    assert.ok(markup.includes("text-overflow: ellipsis"));
    assert.ok(markup.includes("white-space: nowrap"));
    assert.ok(markup.includes("max-width: 100%"));
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

describe("MagnifierRenderer 放大镜修复验证", () => {
  let savedWindow: any;
  let savedDoc: any;

  beforeEach(() => {
    savedWindow = globalThis.window;
    savedDoc = globalThis.document;
  });

  afterEach(() => {
    globalThis.window = savedWindow;
    globalThis.document = savedDoc;
  });

  test("MagnifierRenderer hide() 强制隐藏 magnifier-box", () => {
    const magBox = { style: { display: "flex", left: "0px", top: "0px" } };
    const shadowRootMock = {
      querySelector(sel: string) {
        if (sel === ".magnifier-box") return magBox;
        return null;
      },
    } as any;

    const renderer = new MagnifierRenderer({
      shadowRoot: shadowRootMock,
      getViewportImage: () => null,
      shouldHide: () => false,
    });

    renderer.hide();
    assert.equal(magBox.style.display, "none");
  });

  test("MagnifierRenderer 动态读取真实尺寸且底边溢出始终为 0px（在 375x667 视口实测）", () => {
    const magBox = {
      style: { display: "none", left: "0px", top: "0px" } as any,
      offsetWidth: 130,
      offsetHeight: 174,
      getBoundingClientRect() {
        return {
          width: 130,
          height: 174,
          left: 0,
          top: 0,
          right: 130,
          bottom: 174,
        };
      },
    };
    const magCanvas = {
      width: 130,
      height: 100,
      getContext: () => null,
    };
    const magPos = { textContent: "" };
    const magTag = { textContent: "" };

    const shadowRootMock = {
      querySelector(sel: string) {
        if (sel === ".magnifier-box") return magBox;
        if (sel === ".magnifier-canvas") return magCanvas;
        if (sel === ".mag-pos") return magPos;
        if (sel === ".mag-tag") return magTag;
        return null;
      },
    } as any;

    (globalThis as any).window = {
      innerWidth: 375,
      innerHeight: 667,
      document: { documentElement: { clientWidth: 375, clientHeight: 667 } },
    };

    (globalThis as any).document = {
      elementsFromPoint: () => [],
      elementFromPoint: () => null,
    };

    const renderer = new MagnifierRenderer({
      shadowRoot: shadowRootMock,
      getViewportImage: () => null,
      shouldHide: () => false,
    });

    // 1) 靠底边拖拽 y=520 (原硬编码 130 下会溢底 41.59px)
    renderer.render(355, 520);
    assert.equal(magBox.style.display, "flex");
    const top520 = parseFloat(magBox.style.top);
    const left520 = parseFloat(magBox.style.left);
    assert.ok(top520 + 174 <= 667 - 8, `520 坐标下不应溢底: top=${top520}`);
    assert.ok(left520 + 130 <= 375 - 8, `355 坐标下不应溢右: left=${left520}`);
    assert.ok(top520 >= 8, `top 不应越出顶边: ${top520}`);
    assert.ok(left520 >= 8, `left 不应越出左边: ${left520}`);

    // 2) 靠极底角 y=635
    renderer.render(355, 635);
    const top635 = parseFloat(magBox.style.top);
    assert.ok(top635 + 174 <= 667 - 8, `635 坐标下不应溢底: top=${top635}`);
    assert.ok(top635 >= 8);

    // 3) 超出底边 y=700
    renderer.render(100, 700);
    const top700 = parseFloat(magBox.style.top);
    assert.equal(top700, 667 - 174 - 8, "极端越界时顶边钳制在安全位置");
  });

  test("MagnifierRenderer DOM 采样排除 #bug-lens-screenshot-host 与 [data-wbr-ignore='true']", () => {
    const magBox = {
      style: { display: "none", left: "0px", top: "0px" } as any,
      offsetWidth: 130,
      offsetHeight: 174,
      getBoundingClientRect: () => ({
        width: 130,
        height: 174,
        left: 0,
        top: 0,
        right: 130,
        bottom: 174,
      }),
    };
    const magCanvas = { width: 130, height: 100, getContext: () => null };
    const magTag = { textContent: "" };

    const shadowRootMock = {
      querySelector(sel: string) {
        if (sel === ".magnifier-box") return magBox;
        if (sel === ".magnifier-canvas") return magCanvas;
        if (sel === ".mag-tag") return magTag;
        return null;
      },
    } as any;

    (globalThis as any).window = {
      innerWidth: 375,
      innerHeight: 667,
      document: { documentElement: { clientWidth: 375, clientHeight: 667 } },
    };

    // 模拟命中宿主自身
    const hostEl = {
      id: "bug-lens-screenshot-host",
      tagName: "DIV",
      closest: (sel: string) =>
        sel === "#bug-lens-screenshot-host" ? hostEl : null,
    };
    const normalEl = {
      id: "product-card",
      tagName: "DIV",
      closest: () => null,
      getAttribute: () => null,
    };

    (globalThis as any).document = {
      elementsFromPoint: () => [hostEl, normalEl],
    };

    const renderer = new MagnifierRenderer({
      shadowRoot: shadowRootMock,
      getViewportImage: () => null,
      shouldHide: () => false,
    });

    renderer.render(100, 100);
    // 应当跳过 hostEl，正确采样到 normalEl，而不是显示 div#bug-lens-scree
    assert.equal(magTag.textContent, "div#product-card");

    // 模拟仅命中宿主和忽略节点
    const ignoreEl = {
      id: "__wbr_toast__",
      tagName: "DIV",
      closest: () => null,
      getAttribute: (attr: string) =>
        attr === "data-wbr-ignore" ? "true" : null,
    };
    (globalThis as any).document.elementsFromPoint = () => [hostEl, ignoreEl];

    renderer.render(100, 100);
    assert.equal(magTag.textContent, "", "所有节点为宿主/忽略节点时标签为空");
  });

  test("MagnifierRenderer 首帧先写 magPos/magTag 文本再测量与钳制（杜绝先测量后加字导致首帧溢底）", () => {
    let measuredHeightWhenQueried = 0;
    const magTag = { textContent: "" };
    const magPos = { textContent: "" };
    const magBox = {
      style: { display: "none", left: "0px", top: "0px" } as any,
      offsetWidth: 130,
      offsetHeight: 174,
      getBoundingClientRect() {
        // 若在写 magTag 前测量，高度仅 159；写入后测量高度为 174
        const height = magTag.textContent ? 174 : 159;
        measuredHeightWhenQueried = height;
        return {
          width: 130,
          height,
          left: 0,
          top: 0,
          right: 130,
          bottom: height,
        };
      },
    };
    const magCanvas = { width: 130, height: 100, getContext: () => null };

    const shadowRootMock = {
      querySelector(sel: string) {
        if (sel === ".magnifier-box") return magBox;
        if (sel === ".magnifier-canvas") return magCanvas;
        if (sel === ".mag-pos") return magPos;
        if (sel === ".mag-tag") return magTag;
        return null;
      },
    } as any;

    (globalThis as any).window = {
      innerWidth: 375,
      innerHeight: 667,
      document: { documentElement: { clientWidth: 375, clientHeight: 667 } },
    };

    const targetEl = {
      id: "cta-btn",
      tagName: "BUTTON",
      closest: () => null,
      getAttribute: () => null,
    };

    (globalThis as any).document = {
      elementsFromPoint: () => [targetEl],
    };

    const renderer = new MagnifierRenderer({
      shadowRoot: shadowRootMock,
      getViewportImage: () => null,
      shouldHide: () => false,
    });

    // 靠底边 y=520 处触发首帧渲染
    renderer.render(355, 520);

    // 断言测量时 magTag 已经写入，测得的高度为 174
    assert.equal(magTag.textContent, "button#cta-btn");
    assert.equal(
      measuredHeightWhenQueried,
      174,
      "getBoundingClientRect 测量时必须已写入文本内容"
    );

    // 且顶边钳制值基于 174 计算，绝不溢底
    const top = parseFloat(magBox.style.top);
    assert.ok(
      top + 174 <= 667 - 8,
      `首帧必须包含文本高度后钳制，计算得 top=${top}`
    );
  });
});
