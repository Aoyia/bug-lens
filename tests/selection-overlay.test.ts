import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { t, type I18nBundle } from "../src/shared/i18n.ts";

const SOURCE = resolve(
  process.cwd(),
  "src/entrypoints/content/collector/selection-overlay.ts"
);

function loadDict(locale: "zh_CN" | "en") {
  return JSON.parse(
    readFileSync(
      resolve(process.cwd(), `src/_locales/${locale}/messages.json`),
      "utf8"
    )
  ) as Record<string, { message: string }>;
}

test("selection-overlay 的本地化键在 en 与 zh_CN 字典中均存在且非空", () => {
  for (const locale of ["zh_CN", "en"] as const) {
    const dict = loadDict(locale);
    for (const key of [
      "removeSelectionMark",
      "issueSceneCaptureFailed",
      "selectionModePick",
      "selectionModeScroll",
      "selectionMoveTop",
      "selectionMoveBottom",
    ]) {
      assert.ok(dict[key], `${locale} 缺少 ${key}`);
      assert.ok(
        dict[key].message.trim().length > 0,
        `${locale} 的 ${key} 文案为空`
      );
    }
  }
});

test("selection-overlay 不再包含硬编码中文用户可见文案", () => {
  const source = readFileSync(SOURCE, "utf8");
  assert.ok(!source.includes("移除该标记"), "移除按钮 tooltip 应走 i18n");
  assert.ok(!source.includes("问题现场采集失败"), "采集失败弹窗应走 i18n");
  assert.ok(!source.includes('"未知错误"'), "未知错误应复用 unknownError 键");
});

test("i18n: 注入 zh_CN 字典时移除标记 tooltip 渲染为中文", () => {
  const bundle: I18nBundle = {
    locale: "zh-CN",
    dict: {
      removeSelectionMark: { message: "移除该标记" },
      issueSceneCaptureFailed: { message: "问题现场采集失败：$ERROR$" },
    },
  };
  const prev = globalThis.window;
  (globalThis as any).window = { __WEB_BUG_REPORT_I18N__: bundle };
  try {
    assert.equal(t("removeSelectionMark"), "移除该标记");
    assert.equal(
      t("issueSceneCaptureFailed", ["timeout"]),
      "问题现场采集失败：timeout"
    );
  } finally {
    (globalThis as any).window = prev;
  }
});

test("i18n: 注入 en 字典时移除标记 tooltip 渲染为英文", () => {
  const bundle: I18nBundle = {
    locale: "en-US",
    dict: {
      removeSelectionMark: { message: "Remove this mark" },
      issueSceneCaptureFailed: {
        message: "Issue scene capture failed: $ERROR$",
      },
    },
  };
  const prev = globalThis.window;
  (globalThis as any).window = { __WEB_BUG_REPORT_I18N__: bundle };
  try {
    assert.equal(t("removeSelectionMark"), "Remove this mark");
    assert.equal(
      t("issueSceneCaptureFailed", ["boom"]),
      "Issue scene capture failed: boom"
    );
  } finally {
    (globalThis as any).window = prev;
  }
});

test("selection-overlay 采集失败路径不再使用阻塞式原生 alert()", () => {
  const source = readFileSync(SOURCE, "utf8");
  assert.ok(
    !source.includes("alert("),
    "采集失败反馈应走扩展自身非阻塞 Toast，而非阻塞页面的原生 alert()"
  );
});

test("selection-overlay 采集失败路径通过 onError 依赖上报错误", () => {
  const source = readFileSync(SOURCE, "utf8");
  assert.match(
    source,
    /this\.deps\.onError\(\s*t\(\s*"issueSceneCaptureFailed"/,
    "失败分支应调用注入的 onError 回调并携带本地化错误文案"
  );
});

test("interaction-collector 为选区采集失败接线了非阻塞 error 音色 Toast", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/entrypoints/content/interaction-collector.ts"),
    "utf8"
  );
  assert.match(
    source,
    /onError:\s*\(message\)\s*=>\s*\{?[\s\S]*?widget\.showToast\(\s*message,\s*5_?500,\s*"error"\s*\)/,
    "选区失败应复用导出失败的 error 音色 Toast 模式，而非原生对话框"
  );
});

function createMockHarness(viewportWidth = 1024, viewportHeight = 768) {
  const created: any[] = [];
  const windowListeners: Record<string, Function[]> = {};
  const sentMessages: any[] = [];

  class MockElement {}
  class MockHTMLElement extends MockElement {}

  function makeMockEl(tag: string) {
    const attrMap: Record<string, string> = {};
    let clientRect = {
      x: 20,
      y: 120,
      left: 20,
      top: 120,
      width: 120,
      height: 40,
      right: 140,
      bottom: 160,
    };

    const el: any = Object.assign(new MockElement(), {
      tagName: tag.toUpperCase(),
      id: "",
      className: "",
      style: {} as Record<string, string>,
      children: [] as any[],
      listeners: {} as Record<string, Function[]>,
      textContent: "",
      title: "",
      classList: {
        [Symbol.iterator]: function* () {},
        contains: (c: string) => el.className.includes(c),
      },
      attributes: [] as Array<{ name: string; value: string }>,
      parentElement: null as any,
      ownerDocument: null as any,
      append(...kids: any[]) {
        kids.forEach((k) => {
          k.parentElement = this;
          this.children.push(k);
        });
      },
      appendChild(kid: any) {
        kid.parentElement = this;
        this.children.push(kid);
        return kid;
      },
      remove() {
        if (this.parentElement) {
          this.parentElement.children = this.parentElement.children.filter(
            (c: any) => c !== this
          );
        }
      },
      closest() {
        return null;
      },
      matches() {
        return false;
      },
      getRootNode() {
        return mockDocument;
      },
      getAttribute(name: string) {
        return attrMap[name] ?? null;
      },
      setAttribute(name: string, value: string) {
        attrMap[name] = String(value);
      },
      removeAttribute(name: string) {
        delete attrMap[name];
      },
      hasAttribute(name: string) {
        return name in attrMap;
      },
      setBoundingClientRect(r: any) {
        clientRect = { ...r };
      },
      getBoundingClientRect() {
        return clientRect;
      },
      attachShadow() {
        const shadow: any = {
          children: [] as any[],
          append(...kids: any[]) {
            kids.forEach((k) => this.children.push(k));
          },
          appendChild(kid: any) {
            this.children.push(kid);
            return kid;
          },
          querySelectorAll(selector: string) {
            const found: any[] = [];
            const walk = (nodes: any[]) => {
              for (const n of nodes) {
                if (selector === "div" && n.tagName === "DIV") found.push(n);
                if (n.children?.length) walk(n.children);
              }
            };
            walk(this.children);
            return found;
          },
        };
        el.shadowRoot = shadow;
        return shadow;
      },
      addEventListener(type: string, fn: Function) {
        (this.listeners[type] ||= []).push(fn);
      },
      removeEventListener(type: string, fn: Function) {
        this.listeners[type] = (this.listeners[type] || []).filter(
          (f) => f !== fn
        );
      },
    });
    created.push(el);
    return el;
  }

  const targetA = makeMockEl("button");
  targetA.textContent = "提交";
  const targetB = makeMockEl("a");
  targetB.textContent = "详情";
  let currentPointTarget: any = targetA;

  const docEl = makeMockEl("html");
  const bodyEl = makeMockEl("body");
  const mockDocument: any = {
    documentElement: docEl,
    body: bodyEl,
    createElement: (tag: string) => makeMockEl(tag),
    elementsFromPoint: () => [currentPointTarget],
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
  };

  const mockWindow: any = {
    innerWidth: viewportWidth,
    innerHeight: viewportHeight,
    scrollX: 0,
    scrollY: 0,
    devicePixelRatio: 2,
    matchMedia: (query: string) => ({
      matches: false,
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    }),
    __WEB_BUG_REPORT_I18N__: {
      locale: "zh-CN",
      dict: {
        enterScreenshot: { message: "进入截图 ($1$)" },
        selectedCountHint: { message: "已选 $1$ 个元素" },
        markModeHint: { message: "点击选择元素 ($1$)" },
        selectionModePick: { message: "选元素" },
        selectionModeScroll: { message: "滚页面" },
        selectionMoveTop: { message: "移至顶部" },
        selectionMoveBottom: { message: "移至底部" },
        clearShort: { message: "清空" },
        cancelShort: { message: "取消" },
        removeSelectionMark: { message: "移除该标记" },
      },
    },
    addEventListener(type: string, fn: Function) {
      (windowListeners[type] ||= []).push(fn);
    },
    removeEventListener(type: string, fn: Function) {
      windowListeners[type] = (windowListeners[type] || []).filter(
        (f) => f !== fn
      );
    },
  };

  const prevDoc = (globalThis as any).document;
  const prevWin = (globalThis as any).window;
  const prevElement = (globalThis as any).Element;
  const prevHTMLElement = (globalThis as any).HTMLElement;
  const prevChrome = (globalThis as any).chrome;
  const prevRaf = (globalThis as any).requestAnimationFrame;
  const prevLoc = (globalThis as any).location;

  (globalThis as any).document = mockDocument;
  (globalThis as any).window = mockWindow;
  (globalThis as any).Element = MockElement;
  (globalThis as any).HTMLElement = MockHTMLElement;
  (globalThis as any).requestAnimationFrame = (fn: Function) => {
    fn();
    return 1;
  };
  (globalThis as any).location = { href: "https://example.com/" };
  (globalThis as any).chrome = {
    runtime: {
      sendMessage: async (msg: any) => {
        sentMessages.push(msg);
        return {
          ok: true,
          scene: {
            id: "scene-1",
            page: {
              viewport: { width: viewportWidth, height: viewportHeight },
            },
            annotation: msg.payload.annotation,
          },
        };
      },
    },
  };

  const cleanup = () => {
    (globalThis as any).document = prevDoc;
    (globalThis as any).window = prevWin;
    (globalThis as any).Element = prevElement;
    (globalThis as any).HTMLElement = prevHTMLElement;
    (globalThis as any).chrome = prevChrome;
    (globalThis as any).requestAnimationFrame = prevRaf;
    (globalThis as any).location = prevLoc;
  };

  return {
    mockDocument,
    mockWindow,
    windowListeners,
    sentMessages,
    targetA,
    targetB,
    setPointTarget: (t: any) => {
      currentPointTarget = t;
    },
    cleanup,
  };
}

test("selection-overlay: PC 桌面端 (1024×768) 100% 还原为 999px 单行胶囊，无移动端切换按钮与属性污染", async () => {
  const harness = createMockHarness(1024, 768);
  const { SelectionOverlay } =
    await import("../src/entrypoints/content/collector/selection-overlay.ts");

  try {
    const overlay = new SelectionOverlay({
      getSession: () => ({
        sessionId: "sess-1",
        nonce: "nonce-1",
        privacyMode: "safe",
      }),
      onCaptureComplete: () => {},
      onCancel: () => {},
      onError: () => {},
      getEditorElement: () => undefined,
      shortcutKeyText: "Option+S",
    });

    overlay.open();
    const layer = overlay.element as any;
    assert.ok(layer, "选区遮罩层应已创建");

    // PC 桌面态：不挂载移动端标记
    assert.equal(layer.getAttribute("data-wbr-mobile-mode"), null);
    assert.equal(overlay.isMobile, false);

    const shadow = layer.shadowRoot;
    const hint = shadow.children[2];

    // 验证 PC 视觉 100% 还原 35067f2 之前的单行胶囊形态
    assert.equal(hint.style.top, "18px");
    assert.equal(hint.style.bottom, "auto");
    assert.equal(hint.style.borderRadius, "999px");
    assert.equal(hint.style.gap, "12px");
    assert.equal(hint.style.whiteSpace, "nowrap");
    assert.equal(hint.style.flexWrap, "nowrap");

    const modeToggleGroup = hint.children[0];
    const statusText = hint.children[1];
    const btnGroup = hint.children[2];
    const flipBtn = btnGroup.children[3];

    // PC 端隐藏模式分段切换按钮与换位按钮
    assert.equal(modeToggleGroup.style.display, "none");
    assert.equal(statusText.style.display, "inline");
    assert.equal(flipBtn.style.display, "none");

    overlay.close();
  } finally {
    harness.cleanup();
  }
});

test("selection-overlay: 移动仿真态 (375×667) 贴底紧凑条、一键置顶换位、滚页面切换与放行滚轮", async () => {
  const harness = createMockHarness(375, 667);
  const { SelectionOverlay } =
    await import("../src/entrypoints/content/collector/selection-overlay.ts");

  try {
    let completed = 0;
    const overlay = new SelectionOverlay({
      getSession: () => ({
        sessionId: "sess-1",
        nonce: "nonce-1",
        privacyMode: "safe",
      }),
      onCaptureComplete: () => {
        completed += 1;
      },
      onCancel: () => {},
      onError: () => {},
      getEditorElement: () => undefined,
      shortcutKeyText: "Option+S",
    });

    overlay.open();
    const layer = overlay.element as any;
    assert.ok(layer, "选区遮罩层应已创建");

    // 1. 移动仿真属性标记
    assert.equal(layer.getAttribute("data-wbr-mobile-mode"), "true");
    assert.equal(overlay.isMobile, true);

    const shadow = layer.shadowRoot;
    const hint = shadow.children[2];

    // 2. 默认停靠视口底部居中，单行紧凑布局
    assert.equal(hint.style.bottom, "12px");
    assert.equal(hint.style.top, "auto");
    assert.equal(hint.style.borderRadius, "20px");
    assert.equal(hint.style.maxWidth, "calc(100vw - 16px)");
    assert.equal(hint.style.whiteSpace, "nowrap");
    assert.equal(hint.style.flexWrap, "nowrap");

    const modeToggleGroup = hint.children[0];
    const statusText = hint.children[1];
    const btnGroup = hint.children[2];

    const pickBtn = modeToggleGroup.children[0];
    const scrollBtn = modeToggleGroup.children[1];
    const finishBtn = btnGroup.children[0];
    const flipBtn = btnGroup.children[3];

    assert.equal(modeToggleGroup.style.display, "flex");
    assert.equal(statusText.style.display, "none");
    assert.equal(flipBtn.style.display, "inline-flex");
    assert.equal(flipBtn.title, "移至顶部");

    // 3. 一键上下换位测试
    flipBtn.listeners["click"]?.[0]?.({
      preventDefault() {},
      stopPropagation() {},
    });
    assert.equal(hint.style.top, "12px");
    assert.equal(hint.style.bottom, "auto");
    assert.equal(flipBtn.title, "移至底部");

    flipBtn.listeners["click"]?.[0]?.({
      preventDefault() {},
      stopPropagation() {},
    });
    assert.equal(hint.style.bottom, "12px");
    assert.equal(hint.style.top, "auto");
    assert.equal(flipBtn.title, "移至顶部");

    // 4. 模式切换：选元素 vs 滚页面
    assert.equal(overlay.selectionMode, "pick");
    assert.equal(layer.style.pointerEvents, "auto");

    // 点击「滚页面」：遮罩 pointerEvents 设为 none，控制条保留 auto
    scrollBtn.listeners["click"]?.[0]?.({
      preventDefault() {},
      stopPropagation() {},
    });
    assert.equal(overlay.selectionMode, "scroll");
    assert.equal(layer.style.pointerEvents, "none");
    assert.equal(hint.style.pointerEvents, "auto");

    // 点击「选元素」：遮罩恢复 auto
    pickBtn.listeners["click"]?.[0]?.({
      preventDefault() {},
      stopPropagation() {},
    });
    assert.equal(overlay.selectionMode, "pick");
    assert.equal(layer.style.pointerEvents, "auto");

    // 5. 模拟触控点击落点与删除热区
    layer.listeners["pointerdown"]?.[0]?.({ stopPropagation() {} });
    layer.listeners["click"]?.[0]?.({
      button: 0,
      clientX: 50,
      clientY: 140,
      preventDefault() {},
      stopPropagation() {},
    });

    const boxesContainer = shadow.children[1];
    assert.equal(boxesContainer.children.length, 1);
    const boxEl = boxesContainer.children[0];
    const removeBtn = boxEl.children[0];
    assert.equal(removeBtn.className, "wbr-selection-remove-btn");

    // 验证滚页面模式下已选框 pointerEvents 设为 none 不拦截滑动，切回 pick 恢复 auto
    assert.equal(boxEl.style.pointerEvents, "auto");
    scrollBtn.listeners["click"]?.[0]?.({
      preventDefault() {},
      stopPropagation() {},
    });
    assert.equal(boxEl.style.pointerEvents, "none");
    pickBtn.listeners["click"]?.[0]?.({
      preventDefault() {},
      stopPropagation() {},
    });
    assert.equal(boxEl.style.pointerEvents, "auto");

    // 6. 验证 window scroll 实时重绘已选框（且不被 Math.max(0) 钉死在顶部）
    harness.targetA.setBoundingClientRect({
      x: 20,
      y: 50,
      left: 20,
      top: 50,
      width: 120,
      height: 40,
      right: 140,
      bottom: 90,
    });
    harness.windowListeners["scroll"]?.[0]?.();
    assert.equal(boxEl.style.top, "47px"); // 50 - padY(3)
    assert.equal(boxEl.style.display, "block");

    // 向上滚出部分视口：top 为负值，不应被强制 clamp 到 0
    harness.targetA.setBoundingClientRect({
      x: 20,
      y: -10,
      left: 20,
      top: -10,
      width: 120,
      height: 40,
      right: 140,
      bottom: 30,
    });
    harness.windowListeners["scroll"]?.[0]?.();
    assert.equal(boxEl.style.top, "-13px"); // -10 - 3, 允许自然滚出顶部
    assert.equal(boxEl.style.display, "block");

    // 完全滚出视口：display 应变为 none，彻底不挡视口顶栏 Header
    harness.targetA.setBoundingClientRect({
      x: 20,
      y: -200,
      left: 20,
      top: -200,
      width: 120,
      height: 40,
      right: 140,
      bottom: -160,
    });
    harness.windowListeners["scroll"]?.[0]?.();
    assert.equal(boxEl.style.display, "none");

    // 重新滚回视口：恢复 display: block
    harness.targetA.setBoundingClientRect({
      x: 20,
      y: 100,
      left: 20,
      top: 100,
      width: 120,
      height: 40,
      right: 140,
      bottom: 140,
    });
    harness.windowListeners["scroll"]?.[0]?.();
    assert.equal(boxEl.style.display, "block");
    assert.equal(boxEl.style.top, "97px");

    // 7. 触控选中第二个目标并完成截图
    harness.setPointTarget(harness.targetB);
    layer.listeners["pointerdown"]?.[0]?.({ stopPropagation() {} });
    layer.listeners["click"]?.[0]?.({
      button: 0,
      clientX: 80,
      clientY: 140,
      preventDefault() {},
      stopPropagation() {},
    });

    assert.ok(finishBtn.textContent.includes("2"));
    finishBtn.listeners["click"]?.[0]?.({
      preventDefault() {},
      stopPropagation() {},
    });
    await new Promise((r) => setTimeout(r, 10));

    assert.equal(harness.sentMessages.length, 1);
    assert.equal(harness.sentMessages[0].payload.targets.length, 2);
    assert.equal(completed, 1);
  } finally {
    harness.cleanup();
  }
});

test("scroll-lock: 支持 allowWheel、allowTouchMove 以及 pause/resume/update 动态控制", async () => {
  const { lockViewportScroll } =
    await import("../src/shared/dom/scroll-lock.ts");

  const listeners: Record<string, Function[]> = {};
  const mockWin: any = {
    addEventListener(type: string, fn: Function) {
      (listeners[type] ||= []).push(fn);
    },
    removeEventListener(type: string, fn: Function) {
      listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
    },
  };

  const prevWin = (globalThis as any).window;
  (globalThis as any).window = mockWin;

  try {
    // 1. 默认锁定：wheel 与 touchmove 均应 preventDefault
    const ctrl = lockViewportScroll({ lockOverflow: false });

    let wheelPrevented = false;
    listeners["wheel"]?.[0]?.({
      type: "wheel",
      preventDefault: () => {
        wheelPrevented = true;
      },
      stopPropagation: () => {},
    });
    assert.equal(wheelPrevented, true);

    let touchPrevented = false;
    listeners["touchmove"]?.[0]?.({
      type: "touchmove",
      preventDefault: () => {
        touchPrevented = true;
      },
      stopPropagation: () => {},
    });
    assert.equal(touchPrevented, true);

    // 2. update 允许 wheel 放行
    ctrl.update({ allowWheel: true });
    wheelPrevented = false;
    listeners["wheel"]?.[0]?.({
      type: "wheel",
      preventDefault: () => {
        wheelPrevented = true;
      },
      stopPropagation: () => {},
    });
    assert.equal(wheelPrevented, false, "allowWheel: true 时应放行 wheel");

    // 3. pause 暂停锁定：touchmove 也放行
    ctrl.pause();
    touchPrevented = false;
    listeners["touchmove"]?.[0]?.({
      type: "touchmove",
      preventDefault: () => {
        touchPrevented = true;
      },
      stopPropagation: () => {},
    });
    assert.equal(touchPrevented, false, "pause 状态下应放行所有滚动事件");

    // 4. resume 恢复锁定
    ctrl.resume();
    touchPrevented = false;
    listeners["touchmove"]?.[0]?.({
      type: "touchmove",
      preventDefault: () => {
        touchPrevented = true;
      },
      stopPropagation: () => {},
    });
    assert.equal(touchPrevented, true, "resume 状态下恢复拦截 touchmove");

    // 5. release 完全解绑
    ctrl.release();
    assert.equal(listeners["wheel"]?.length, 0);
    assert.equal(listeners["touchmove"]?.length, 0);
  } finally {
    (globalThis as any).window = prevWin;
  }
});

test("selection-overlay: 删除按钮样式包含 34×34px 扩展触控热区并支持点击移除", async () => {
  const harness = createMockHarness(375, 667);
  const { SelectionOverlay } =
    await import("../src/entrypoints/content/collector/selection-overlay.ts");

  try {
    const overlay = new SelectionOverlay({
      getSession: () => ({
        sessionId: "sess-1",
        nonce: "nonce-1",
        privacyMode: "safe",
      }),
      onCaptureComplete: () => {},
      onCancel: () => {},
      onError: () => {},
      getEditorElement: () => undefined,
      shortcutKeyText: "Option+S",
    });

    overlay.open();
    const layer = overlay.element as any;
    const shadow = layer.shadowRoot;

    // 验证注入的 style 标签
    const styleEl = shadow.children[3];
    assert.ok(styleEl, "shadow 中应注入样式表");
    assert.ok(
      styleEl.textContent.includes(".wbr-selection-remove-btn::after"),
      "应包含删除按钮 ::after 伪元素样式"
    );
    assert.ok(
      styleEl.textContent.includes("inset: -8px"),
      "删除按钮 ::after 应设 inset: -8px 以扩展 34×34px 触控热区"
    );

    // 选中一个元素
    layer.listeners["pointerdown"]?.[0]?.({ stopPropagation() {} });
    layer.listeners["click"]?.[0]?.({
      button: 0,
      clientX: 50,
      clientY: 140,
      preventDefault() {},
      stopPropagation() {},
    });

    const boxesContainer = shadow.children[1];
    assert.equal(boxesContainer.children.length, 1);
    const boxEl = boxesContainer.children[0];
    const removeBtn = boxEl.children[0];

    // 点击删除按钮移除该元素
    removeBtn.listeners["click"]?.[0]?.({
      preventDefault() {},
      stopPropagation() {},
    });
    assert.equal(boxesContainer.children.length, 0);

    overlay.close();
  } finally {
    harness.cleanup();
  }
});

test("selection-overlay: 动态视口变更时 (PC <-> Mobile) 自适应切换形态与滚动锁定策略", async () => {
  const harness = createMockHarness(1024, 768);
  const { SelectionOverlay } =
    await import("../src/entrypoints/content/collector/selection-overlay.ts");

  try {
    const overlay = new SelectionOverlay({
      getSession: () => ({
        sessionId: "sess-1",
        nonce: "nonce-1",
        privacyMode: "safe",
      }),
      onCaptureComplete: () => {},
      onCancel: () => {},
      onError: () => {},
      getEditorElement: () => undefined,
      shortcutKeyText: "Option+S",
    });

    overlay.open();
    const layer = overlay.element as any;
    assert.equal(overlay.isMobile, false);

    const shadow = layer.shadowRoot;
    const hint = shadow.children[2];
    assert.equal(hint.style.borderRadius, "999px");
    assert.equal(hint.style.top, "18px");

    // 模拟视口缩小到 375 移动仿真模式
    harness.mockWindow.innerWidth = 375;
    harness.mockWindow.innerHeight = 667;
    harness.windowListeners["resize"]?.[0]?.();

    assert.equal(overlay.isMobile, true);
    assert.equal(layer.getAttribute("data-wbr-mobile-mode"), "true");
    assert.equal(hint.style.borderRadius, "20px");
    assert.equal(hint.style.bottom, "12px");
    assert.equal(hint.style.top, "auto");
    assert.equal(hint.style.overflowX, "auto");
    assert.equal(hint.style.scrollbarWidth, "none");

    // 移动态切入滚页面模式
    const modeToggleGroup = hint.children[0];
    const scrollBtn = modeToggleGroup.children[1];
    scrollBtn.listeners["click"]?.[0]?.({
      preventDefault() {},
      stopPropagation() {},
    });
    assert.equal(overlay.selectionMode, "scroll");
    assert.equal(layer.style.pointerEvents, "none");

    // 模拟视口恢复到 1024 桌面模式：必须强制重置为 pick 模式并恢复指针事件与 overflow
    harness.mockWindow.innerWidth = 1024;
    harness.mockWindow.innerHeight = 768;
    harness.windowListeners["resize"]?.[0]?.();

    assert.equal(overlay.isMobile, false);
    assert.equal(
      overlay.selectionMode,
      "pick",
      "切回 PC 端必须重置为 pick 模式"
    );
    assert.equal(
      layer.style.pointerEvents,
      "auto",
      "切回 PC 端必须恢复指针事件"
    );
    assert.equal(layer.getAttribute("data-wbr-mobile-mode"), null);
    assert.equal(hint.style.borderRadius, "999px");
    assert.equal(hint.style.top, "18px");
    assert.equal(hint.style.bottom, "auto");
    assert.equal(hint.style.overflowX, "visible");

    overlay.close();
  } finally {
    harness.cleanup();
  }
});
