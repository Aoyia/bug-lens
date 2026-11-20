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
    for (const key of ["removeSelectionMark", "issueSceneCaptureFailed"]) {
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
    /onError:\s*\(message\)\s*=>\s*widget\.showToast\(message,\s*5_500,\s*"error"\)/,
    "选区失败应复用导出失败的 error 音色 Toast 模式，而非原生对话框"
  );
});

test("selection-overlay: 窄视口提示条支持换行与 calc(100vw - 24px) 约束，且无 hover 触控点击可多选落点", async () => {
  const { SelectionOverlay } =
    await import("../src/entrypoints/content/collector/selection-overlay.ts");

  const created: any[] = [];
  const windowListeners: Record<string, Function[]> = {};
  const sentMessages: any[] = [];

  class MockElement {}
  class MockHTMLElement extends MockElement {}

  function makeMockEl(tag: string) {
    const attrMap: Record<string, string> = {};
    const el: any = Object.assign(new MockElement(), {
      tagName: tag.toUpperCase(),
      id: "",
      style: {} as Record<string, string>,
      children: [] as any[],
      listeners: {} as Record<string, Function[]>,
      textContent: "",
      title: "",
      classList: {
        [Symbol.iterator]: function* () {},
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
      remove() {},
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
      hasAttribute(name: string) {
        return name in attrMap;
      },
      getBoundingClientRect() {
        return {
          x: 20,
          y: 120,
          left: 20,
          top: 120,
          width: 120,
          height: 40,
          right: 140,
          bottom: 160,
        };
      },
      attachShadow() {
        const shadow: any = {
          children: [] as any[],
          append(...kids: any[]) {
            kids.forEach((k) => this.children.push(k));
          },
          querySelectorAll() {
            return [];
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
    innerWidth: 375,
    innerHeight: 667,
    scrollX: 0,
    scrollY: 0,
    devicePixelRatio: 2,
    __WEB_BUG_REPORT_I18N__: {
      locale: "zh-CN",
      dict: {
        enterScreenshot: { message: "进入截图 ($1$)" },
        selectedCountHint: { message: "已选 $1$ 个元素" },
        markModeHint: { message: "点击选择元素 ($1$)" },
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
            page: { viewport: { width: 375, height: 667 } },
            annotation: msg.payload.annotation,
          },
        };
      },
    },
  };

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
    const shadow = layer.shadowRoot;
    const hint = shadow.children[2];

    assert.equal(hint.style.flexWrap, "wrap");
    assert.equal(hint.style.justifyContent, "center");
    assert.equal(hint.style.whiteSpace, "normal");
    assert.equal(hint.style.textAlign, "center");
    assert.equal(hint.style.maxWidth, "calc(100vw - 24px)");
    assert.equal(hint.style.borderRadius, "16px");
    assert.equal(hint.style.gap, "8px");
    assert.equal(hint.style.boxSizing, "border-box");

    const statusText = hint.children[0];
    const btnGroup = hint.children[1];
    assert.equal(statusText.style.minWidth, "0");
    assert.equal(btnGroup.children.length, 3);
    for (const btn of btnGroup.children) {
      assert.equal(btn.style.flexShrink, "0");
    }

    // 模拟无 hover (不触发 pointermove) 的移动端触控点击多选
    layer.listeners["pointerdown"]?.[0]?.({ stopPropagation() {} });
    layer.listeners["click"]?.[0]?.({
      button: 0,
      clientX: 50,
      clientY: 140,
      preventDefault() {},
      stopPropagation() {},
    });

    currentPointTarget = targetB;
    layer.listeners["pointerdown"]?.[0]?.({ stopPropagation() {} });
    layer.listeners["click"]?.[0]?.({
      button: 0,
      clientX: 80,
      clientY: 140,
      preventDefault() {},
      stopPropagation() {},
    });

    const finishBtn = btnGroup.children[0];
    assert.ok(
      finishBtn.textContent.includes("2"),
      "无 hover 点击两次应累计选中 2 个元素"
    );

    finishBtn.listeners["click"]?.[0]?.({
      preventDefault() {},
      stopPropagation() {},
    });
    await new Promise((r) => setTimeout(r, 10));

    assert.equal(sentMessages.length, 1, "点击完成按钮应触发采集消息");
    assert.equal(
      sentMessages[0].payload.targets.length,
      2,
      "应携带触控多选的两个目标元素"
    );
    assert.equal(completed, 1, "应回调 onCaptureComplete");
  } finally {
    (globalThis as any).document = prevDoc;
    (globalThis as any).window = prevWin;
    (globalThis as any).Element = prevElement;
    (globalThis as any).HTMLElement = prevHTMLElement;
    (globalThis as any).chrome = prevChrome;
    (globalThis as any).requestAnimationFrame = prevRaf;
    (globalThis as any).location = prevLoc;
  }
});
