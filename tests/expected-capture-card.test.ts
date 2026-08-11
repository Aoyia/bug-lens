import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  ExpectedCaptureCard,
  getAutoSkipRemainingSeconds,
} from "../src/entrypoints/content/collector/expected-capture-card.ts";

test("速记卡倒计时向上取整并在到期后归零", () => {
  const deadline = 15_000;

  assert.equal(getAutoSkipRemainingSeconds(deadline, 0), 15);
  assert.equal(getAutoSkipRemainingSeconds(deadline, 1), 15);
  assert.equal(getAutoSkipRemainingSeconds(deadline, 1_001), 14);
  assert.equal(getAutoSkipRemainingSeconds(deadline, 15_000), 0);
  assert.equal(getAutoSkipRemainingSeconds(deadline, 16_000), 0);
});

test("速记卡倒计时文案已覆盖中英文 locale", () => {
  for (const locale of ["zh_CN", "en"] as const) {
    const messages = JSON.parse(
      readFileSync(
        resolve(process.cwd(), `src/_locales/${locale}/messages.json`),
        "utf8"
      )
    );
    assert.ok(messages.expectedAutoSkipCountdown?.message);
  }
});

test("历史搜索在查询前经由 300ms 防抖状态", () => {
  const popupApp = readFileSync(
    resolve(process.cwd(), "src/components/popup/PopupApp.tsx"),
    "utf8"
  );

  assert.match(popupApp, /const HISTORY_SEARCH_DEBOUNCE_MS = 300/);
  assert.match(popupApp, /setDebouncedSearchQuery\(searchQuery\)/);
  assert.match(popupApp, /refreshHistory\(debouncedSearchQuery\)/);
});

// ─── 轻量 DOM mock（node 环境无 jsdom，沿用 recording-widget 测试的手写 mock 模式）───

type Handler = (event: any) => void;

function createElementMock(tag: string, created: any[]) {
  const el = {
    tagName: tag.toUpperCase(),
    style: {},
    attrs: {} as Record<string, string>,
    children: [] as any[],
    listeners: {} as Record<string, Handler[]>,
    value: "",
    placeholder: "",
    textContent: "",
    title: "",
    type: "",
    offsetWidth: undefined as number | undefined,
    offsetHeight: undefined as number | undefined,
    setAttribute(name: string, value: string) {
      this.attrs[name] = value;
    },
    addEventListener(type: string, fn: Handler) {
      (this.listeners[type] ||= []).push(fn);
    },
    removeEventListener(type: string, fn: Handler) {
      this.listeners[type] = (this.listeners[type] || []).filter(
        (f) => f !== fn
      );
    },
    append(...kids: any[]) {
      kids.forEach((k) => this.children.push(k));
    },
    appendChild(kid: any) {
      this.children.push(kid);
      return kid;
    },
    remove() {},
    focus() {},
    click() {
      (this.listeners["click"] || []).forEach((fn) =>
        fn({ stopPropagation() {}, preventDefault() {} })
      );
    },
  };
  created.push(el);
  return el;
}

function createDomMock() {
  const created: any[] = [];
  const windowListeners: Record<string, Handler[]> = {};
  const document = {
    createElement: (tag: string) => createElementMock(tag, created),
    documentElement: { appendChild() {} },
    body: {},
  };
  const window = {
    innerWidth: undefined as number | undefined,
    innerHeight: undefined as number | undefined,
    addEventListener(type: string, fn: Handler) {
      (windowListeners[type] ||= []).push(fn);
    },
    removeEventListener(type: string, fn: Handler) {
      windowListeners[type] = (windowListeners[type] || []).filter(
        (f) => f !== fn
      );
    },
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
  };
  return {
    created,
    document,
    window,
    dispatchKey(key: string) {
      (windowListeners["keydown"] || []).forEach((fn) =>
        fn({ key, preventDefault() {}, stopPropagation() {} })
      );
    },
    findByAttr(name: string, value: string) {
      return created.find((el) => el.attrs && el.attrs[name] === value);
    },
  };
}

function openCard(
  deps: {
    onSubmit?: (expected: any) => void;
    onSkip?: () => void;
    onCancel?: () => void;
  } = {}
) {
  const dom = createDomMock();
  const prevDocument = (globalThis as any).document;
  const prevWindow = (globalThis as any).window;
  (globalThis as any).document = dom.document;
  (globalThis as any).window = dom.window;
  const calls = { onSubmit: 0, onSkip: 0, onCancel: 0 };
  const card = new ExpectedCaptureCard({
    onSubmit: (expected) => {
      calls.onSubmit += 1;
      deps.onSubmit?.(expected);
    },
    onSkip: () => {
      calls.onSkip += 1;
      deps.onSkip?.();
    },
    onCancel: () => {
      calls.onCancel += 1;
      deps.onCancel?.();
    },
  });
  card.open();
  return {
    dom,
    card,
    calls,
    restore() {
      (globalThis as any).document = prevDocument;
      (globalThis as any).window = prevWindow;
    },
  };
}

test("速记卡：Escape 取消整条标记流程（onCancel），而非跳过进入选择（onSkip）", () => {
  const ctx = openCard();
  try {
    ctx.dom.dispatchKey("Escape");
    assert.equal(ctx.calls.onCancel, 1, "Escape 应触发 onCancel");
    assert.equal(ctx.calls.onSkip, 0, "Escape 不应触发 onSkip");
    assert.equal(ctx.calls.onSubmit, 0, "Escape 不应触发 onSubmit");
    assert.equal(ctx.card.isOpen, false, "取消后卡片应关闭");
  } finally {
    ctx.restore();
  }
});

test("速记卡：取消后再次按 Escape 不会重复触发", () => {
  const ctx = openCard();
  try {
    ctx.dom.dispatchKey("Escape");
    ctx.dom.dispatchKey("Escape");
    assert.equal(ctx.calls.onCancel, 1, "submitted 守卫应阻止重复取消");
  } finally {
    ctx.restore();
  }
});

test("速记卡：Enter 提交路径不回归（有输入时 onSubmit）", () => {
  const ctx = openCard();
  try {
    const input = ctx.dom.findByAttr("data-expected-input", "true");
    assert.ok(input, "应存在期望输入框");
    input.value = "用户输入的期望";
    ctx.dom.dispatchKey("Enter");
    assert.equal(ctx.calls.onSubmit, 1);
    assert.equal(ctx.calls.onSkip, 0);
    assert.equal(ctx.calls.onCancel, 0);
  } finally {
    ctx.restore();
  }
});

test("速记卡：跳过按钮路径不回归（onSkip）", () => {
  const ctx = openCard();
  try {
    const skipBtn = ctx.dom.findByAttr("data-expected-skip", "true");
    assert.ok(skipBtn, "应存在跳过按钮");
    skipBtn.click();
    assert.equal(ctx.calls.onSkip, 1);
    assert.equal(ctx.calls.onCancel, 0);
    assert.equal(ctx.calls.onSubmit, 0);
  } finally {
    ctx.restore();
  }
});

test("速记卡：确认按钮路径不回归（有输入时 onSubmit）", () => {
  const ctx = openCard();
  try {
    const input = ctx.dom.findByAttr("data-expected-input", "true");
    input.value = "确认的期望";
    const confirmBtn = ctx.dom.findByAttr("data-expected-confirm", "true");
    assert.ok(confirmBtn, "应存在确认按钮");
    confirmBtn.click();
    assert.equal(ctx.calls.onSubmit, 1);
    assert.equal(ctx.calls.onSkip, 0);
    assert.equal(ctx.calls.onCancel, 0);
  } finally {
    ctx.restore();
  }
});

test("速记卡：interaction-collector 为速记卡接线了 onCancel", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/entrypoints/content/interaction-collector.ts"),
    "utf8"
  );
  assert.match(
    source,
    /onCancel\(\)\s*\{[\s\S]*?widget\.setIssueSelecting\(false\)/,
    "collector 应通过 onCancel 复位标记按钮且不进入选择"
  );
});
