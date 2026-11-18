import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  ExpectedCaptureCard,
  computeCardPosition,
  getAutoSkipRemainingSeconds,
} from "../src/entrypoints/content/collector/expected-capture-card.ts";
import {
  buildActualDraft,
  pickDraftElement,
  resolveDraftKind,
} from "../src/entrypoints/content/collector/actual-draft.ts";
import { MarkFlow } from "../src/entrypoints/content/collector/mark-flow.ts";
import {
  MIN_SELECTION_PX,
  isDegenerateSelection,
  unionSelectionRect,
} from "../src/entrypoints/content/collector/selection-overlay.ts";
import { resolveSceneExpectation } from "../src/triage-cli/pack/narrative.ts";

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
    contains(child: any) {
      if (child === this) return true;
      return this.children.some(
        (c) => c === child || (c.contains && c.contains(child))
      );
    },
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
  /** 记录 window.setTimeout 的延迟，用于断言"卡片 open 时才起计时" */
  const timeouts: number[] = [];
  const document = {
    createElement: (tag: string) => createElementMock(tag, created),
    documentElement: { appendChild() {} },
    body: {},
  };
  const window = {
    innerWidth: 1024,
    innerHeight: 768,
    windowListeners,
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
    setTimeout: (fn: any, delay?: number) => {
      timeouts.push(delay ?? 0);
      return (globalThis as any).setTimeout(fn, delay);
    },
    clearTimeout,
  };
  return {
    created,
    document,
    window,
    timeouts,
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

/** 只创建卡片实例（不 open），用于断言 open 之前无任何计时器 */
function createCardHandle(
  deps: {
    onSubmit?: (expected: any, actual?: string, meta?: any) => void;
    onSkip?: (actual?: string, meta?: any) => void;
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
    onSubmit: (expected, actual, meta) => {
      calls.onSubmit += 1;
      deps.onSubmit?.(expected, actual, meta);
    },
    onSkip: (actual, meta) => {
      calls.onSkip += 1;
      deps.onSkip?.(actual, meta);
    },
    onCancel: () => {
      calls.onCancel += 1;
      deps.onCancel?.();
    },
  });
  return {
    dom,
    card,
    calls,
    restore() {
      card.close();
      (globalThis as any).document = prevDocument;
      (globalThis as any).window = prevWindow;
    },
  };
}

function openCard(
  deps: {
    onSubmit?: (expected: any, actual?: string, meta?: any) => void;
    onSkip?: (actual?: string, meta?: any) => void;
    onCancel?: () => void;
  } = {},
  context?: { anchorRect?: any; draft?: string }
) {
  const handle = createCardHandle(deps);
  handle.card.open(undefined, context);
  return handle;
}

/** 用真实 messages.json 构造 translator，断言文案确实来自 i18n 而非硬编码 */
function localeTranslator(locale: "zh_CN" | "en") {
  const messages = JSON.parse(
    readFileSync(
      resolve(process.cwd(), `src/_locales/${locale}/messages.json`),
      "utf8"
    )
  ) as Record<string, { message: string }>;
  return (key: string, substitutions?: string | string[]) => {
    const template = messages[key]?.message;
    if (!template) throw new Error(`missing i18n key: ${key} (${locale})`);
    const subs = Array.isArray(substitutions)
      ? substitutions
      : substitutions
        ? [substitutions]
        : [];
    // 与 shared/i18n.ts 的 formatMessage 保持一致：先数字占位符，再按顺序填命名占位符
    let namedIndex = 0;
    return template
      .replace(
        /\$(\d+)\$/g,
        (_m, index: string) => subs[Number(index) - 1] ?? ""
      )
      .replace(/\$([A-Z_]+)\$/g, () => {
        const value = subs[namedIndex] ?? "";
        namedIndex += 1;
        return value;
      });
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

test("速记卡定位纯函数：下方放得下贴下方，放不下翻上方，左右越界钳制", () => {
  const viewport = { width: 1024, height: 768 };
  const card = { width: 460, height: 260 };

  // 1. 下方空间充足（156 + 260 + 24 = 440 <= 768）→ 贴在锚点底部 + 16px
  assert.deepEqual(
    computeCardPosition(
      { top: 100, left: 100, width: 200, height: 40 },
      viewport,
      card
    ),
    { top: 156, left: 100, placement: "below" }
  );

  // 2. 下方不足（656 + 260 + 24 = 940 > 768）→ 翻到上方，锚点顶部 - 卡片高 - 16px
  assert.deepEqual(
    computeCardPosition(
      { top: 600, left: 100, width: 200, height: 40 },
      viewport,
      card
    ),
    { top: 324, left: 100, placement: "above" }
  );

  // 3. 右侧越界 → 钳到 1024 - 460 - 16 = 548；左边缘对齐锚点
  assert.deepEqual(
    computeCardPosition(
      { top: 600, left: 900, width: 200, height: 40 },
      viewport,
      card
    ),
    { top: 324, left: 548, placement: "above" }
  );

  // 4. 左侧越界 → 钳回 16px
  assert.equal(
    computeCardPosition(
      { top: 100, left: -50, width: 200, height: 40 },
      viewport,
      card
    ).left,
    16
  );

  // 5. 卡片不遮挡选区：下方/上方两种落点都在锚点框之外
  const below = computeCardPosition(
    { top: 100, left: 100, width: 200, height: 40 },
    viewport,
    card
  );
  assert.ok(below.top >= 100 + 40, "下方落点不得压住选区");
  const above = computeCardPosition(
    { top: 600, left: 100, width: 200, height: 40 },
    viewport,
    card
  );
  assert.ok(above.top + card.height <= 600, "上方落点不得压住选区");
});

test("速记卡：跟随锚点定位（不再使用固定位置/水平居中）", () => {
  const ctx = openCard(
    {},
    {
      anchorRect: { top: 100, left: 100, width: 200, height: 40 },
    }
  );
  try {
    const root = ctx.card.element as any;
    assert.ok(root, "卡片应已挂载");
    // 无 getBoundingClientRect 的 mock 环境按 min(460, vw-32) × 260 兜底测量
    assert.equal(root.style.top, "156px");
    assert.equal(root.style.left, "100px");
    assert.notEqual(root.style.transform, "translateX(-50%)");
  } finally {
    ctx.restore();
  }

  const belowFold = openCard(
    {},
    {
      anchorRect: { top: 600, left: 900, width: 200, height: 40 },
    }
  );
  try {
    const root = belowFold.card.element as any;
    assert.equal(root.style.top, "324px");
    assert.equal(root.style.left, "548px");
  } finally {
    belowFold.restore();
  }
});

test("速记卡：焦点隔离与防劫持屏障（阻止外部模态夺焦并阻断事件外溢）", () => {
  const ctx = openCard();
  try {
    const input = ctx.dom.findByAttr("data-expected-input", "true");
    assert.ok(input, "应存在期望输入框");

    // 1. 卡片内部聚焦时，阻止向 document/宿主外溢
    let stoppedImmediate = false;
    let preventedDefault = false;
    const innerFocusEvent = {
      target: input,
      stopImmediatePropagation: () => {
        stoppedImmediate = true;
      },
      preventDefault: () => {
        preventedDefault = true;
      },
    };
    const focusinListeners =
      (ctx.dom.window as any).windowListeners?.["focusin"] || [];
    // 验证捕获监听器已注册
    assert.ok(focusinListeners.length > 0, "应注册 window focusin 捕获监听器");
    focusinListeners[0](innerFocusEvent);
    assert.equal(
      stoppedImmediate,
      true,
      "卡片内部聚焦应阻断事件传播以屏蔽宿主 focus trap"
    );

    // 2. 外部元素（宿主页面弹窗等）企图抢夺焦点时，拦截并拉回卡片输入框
    let hostInputFocused = false;
    input.focus = () => {
      hostInputFocused = true;
    };
    stoppedImmediate = false;
    preventedDefault = false;
    const externalTarget = {
      tagName: "BUTTON",
      nodeType: 1,
    };
    Object.setPrototypeOf(
      externalTarget,
      (globalThis as any).HTMLElement?.prototype || {}
    );
    const externalFocusEvent = {
      target: externalTarget,
      stopImmediatePropagation: () => {
        stoppedImmediate = true;
      },
      preventDefault: () => {
        preventedDefault = true;
      },
    };
    focusinListeners[0](externalFocusEvent);
    assert.equal(stoppedImmediate, true, "外部抢焦时应阻断事件传播");
    assert.equal(preventedDefault, true, "外部抢焦时应阻止默认行为");
    assert.equal(hostInputFocused, true, "外部抢焦时应将焦点拉回速记卡输入框");

    // 3. 输入框键盘与指针事件阻断宿主冒泡
    let inputKeydownStopped = false;
    input.listeners["keydown"]?.[0]?.({
      key: "a",
      stopPropagation: () => {
        inputKeydownStopped = true;
      },
    });
    assert.equal(inputKeydownStopped, true, "按键事件应阻止向宿主冒泡");

    let inputMousedownStopped = false;
    input.listeners["mousedown"]?.[0]?.({
      stopPropagation: () => {
        inputMousedownStopped = true;
      },
    });
    assert.equal(inputMousedownStopped, true, "鼠标事件应阻止向宿主冒泡");
  } finally {
    ctx.restore();
  }
});

test("速记卡：快捷标签与文本框解耦，仅选标签输出 tag-only，补写文本保留 tags 并升级 explicit", () => {
  const submittedPayloads: any[] = [];
  const ctx = openCard({
    onSubmit: (expected) => submittedPayloads.push(expected),
  });
  try {
    const input = ctx.dom.findByAttr("data-expected-input", "true");
    const chip0 = ctx.dom.findByAttr(
      "data-expected-chip",
      "expectedChipNoResponse"
    );
    assert.ok(chip0, "应渲染快捷症状标签按钮");

    // 1. 勾选快捷标签不应篡改/污染输入框文本
    chip0.click();
    assert.equal(input.value, "");

    // 确认仅标签提交时为 tag-only 且携带 tags
    const confirmBtn = ctx.dom.findByAttr("data-expected-confirm", "true");
    confirmBtn.click();
    assert.equal(submittedPayloads.length, 1);
    assert.equal(submittedPayloads[0].confidence, "tag-only");
    assert.equal(submittedPayloads[0].text, "");
    assert.ok(submittedPayloads[0].tags?.length === 1);
  } finally {
    ctx.restore();
  }

  // 2. 输入明确期望后再叠加标签，提交应同时保留 text (explicit) 与 tags
  const mixedPayloads: any[] = [];
  const ctx2 = openCard({
    onSubmit: (expected) => mixedPayloads.push(expected),
  });
  try {
    const input = ctx2.dom.findByAttr("data-expected-input", "true");
    const chip = ctx2.dom.findByAttr(
      "data-expected-chip",
      "expectedChipLoadFailed"
    );
    input.value = "提交按钮点击后应保存成功";
    input.listeners["input"]?.[0]?.({ stopPropagation: () => {} });
    chip.click();
    assert.equal(input.value, "提交按钮点击后应保存成功");

    ctx2.dom.findByAttr("data-expected-confirm", "true").click();
    assert.equal(mixedPayloads.length, 1);
    assert.equal(mixedPayloads[0].confidence, "explicit");
    assert.equal(mixedPayloads[0].text, "提交按钮点击后应保存成功");
    assert.ok(mixedPayloads[0].tags?.length === 1);
  } finally {
    ctx2.restore();
  }
});

// ─── 改造 2/3：actual 草稿与超时兜底 ───

test("草稿生成：按元素语义优先级命中对应模板（中文 i18n）", () => {
  const tr = localeTranslator("zh_CN");

  assert.equal(
    buildActualDraft({ tagName: "button", text: "提交" }, tr),
    "按钮「提交」点击后无响应"
  );
  assert.equal(
    buildActualDraft({ tagName: "input", placeholder: "手机号" }, tr),
    "输入框「手机号」为空"
  );
  assert.equal(
    buildActualDraft(
      { tagName: "textarea", ariaLabel: "备注", value: "已付款" },
      tr
    ),
    "输入框「备注」当前值为「已付款」"
  );
  assert.equal(
    buildActualDraft(
      { tagName: "table", regionName: "订单", itemCount: 3 },
      tr
    ),
    "列表「订单」显示 3 条记录"
  );
  assert.equal(
    buildActualDraft(
      { tagName: "div", role: "dialog", dialogTitle: "确认删除" },
      tr
    ),
    "弹窗「确认删除」未按预期关闭/展示"
  );
  assert.equal(
    buildActualDraft({ tagName: "p", text: "价格显示为 0 元" }, tr),
    "元素「价格显示为 0 元」显示异常"
  );
  // 文案缺失 → 兜底，不编造业务语义
  assert.equal(buildActualDraft({ tagName: "div" }, tr), "DIV 元素与预期不符");
  assert.equal(buildActualDraft({ role: "button" }, tr), "页面元素与预期不符");
});

test("草稿生成：语义优先级（弹窗 > 按钮 > 输入框 > 列表 > 文本 > 兜底）", () => {
  assert.equal(resolveDraftKind({ tagName: "div", role: "dialog" }), "dialog");
  assert.equal(resolveDraftKind({ tagName: "button" }), "button");
  assert.equal(resolveDraftKind({ tagName: "a", text: "详情" }), "button");
  assert.equal(resolveDraftKind({ tagName: "select" }), "input");
  assert.equal(resolveDraftKind({ tagName: "table" }), "list");
  assert.equal(resolveDraftKind({ tagName: "p", text: "文案" }), "text");
  assert.equal(resolveDraftKind({ tagName: "canvas" }), "fallback");
});

test("草稿生成：中文与英文各生成一次，文案来自 i18n 而非硬编码", () => {
  const zh = localeTranslator("zh_CN");
  const en = localeTranslator("en");

  const zhButton = buildActualDraft({ tagName: "button", text: "提交" }, zh);
  const enButton = buildActualDraft({ tagName: "button", text: "Submit" }, en);
  assert.equal(zhButton, "按钮「提交」点击后无响应");
  assert.equal(enButton, 'Button "Submit" did nothing after clicking');
  assert.notEqual(zhButton, enButton);

  const zhDialog = buildActualDraft(
    { tagName: "div", role: "dialog", dialogTitle: "确认删除" },
    zh
  );
  const enDialog = buildActualDraft(
    { tagName: "div", role: "dialog", dialogTitle: "Confirm" },
    en
  );
  assert.equal(zhDialog, "弹窗「确认删除」未按预期关闭/展示");
  assert.equal(
    enDialog,
    'Dialog "Confirm" did not close or appear as expected'
  );

  // 两个 locale 都必须备齐新增 key，避免某一侧漏翻导致回退英文/原始 key
  for (const locale of ["zh_CN", "en"] as const) {
    const messages = JSON.parse(
      readFileSync(
        resolve(process.cwd(), `src/_locales/${locale}/messages.json`),
        "utf8"
      )
    ) as Record<string, { message: string }>;
    for (const key of [
      "expectedActualLabel",
      "expectedActualPlaceholder",
      "expectedActualClear",
      "actualDraftButton",
      "actualDraftInputEmpty",
      "actualDraftInputFilled",
      "actualDraftList",
      "actualDraftDialog",
      "actualDraftText",
      "actualDraftFallback",
      "actualDraftUnknownElement",
      "actualDraftAutoSaved",
    ]) {
      assert.ok(messages[key]?.message, `${locale} 缺少 ${key}`);
    }
  }
});

test("速记卡：进入即预填 actual 草稿，用户不动直接确认时 actual=草稿", () => {
  const payloads: { expected: any; actual?: string }[] = [];
  const draft = "按钮「提交」点击后无响应";
  const ctx = openCard(
    { onSubmit: (expected, actual) => payloads.push({ expected, actual }) },
    { draft }
  );
  try {
    const actualEl = ctx.dom.findByAttr("data-expected-actual", "true");
    assert.ok(actualEl, "应渲染 actual 草稿输入框");
    assert.equal(actualEl.value, draft, "进入速记卡即预填草稿");

    const input = ctx.dom.findByAttr("data-expected-input", "true");
    input.value = "提交后应跳转详情页";
    ctx.dom.findByAttr("data-expected-confirm", "true").click();

    assert.equal(payloads.length, 1);
    assert.equal(payloads[0].expected.confidence, "explicit");
    assert.equal(payloads[0].expected.text, "提交后应跳转详情页");
    assert.equal(payloads[0].actual, draft, "未改动草稿时 actual 取草稿");
  } finally {
    ctx.restore();
  }
});

test("速记卡：草稿可编辑、可一键清空（清空后不回填草稿）", () => {
  const draft = "按钮「提交」点击后无响应";
  const edited: (string | undefined)[] = [];
  const ctx = openCard(
    { onSubmit: (_expected, actual) => edited.push(actual) },
    { draft }
  );
  try {
    const actualEl = ctx.dom.findByAttr("data-expected-actual", "true");
    actualEl.value = "按钮「提交」点击后页面白屏";
    actualEl.listeners["input"]?.[0]?.({ stopPropagation: () => {} });
    const expectedEl = ctx.dom.findByAttr("data-expected-input", "true");
    expectedEl.value = "提交后应跳转详情页";
    ctx.dom.findByAttr("data-expected-confirm", "true").click();
    assert.equal(edited[0], "按钮「提交」点击后页面白屏", "用户改动优先于草稿");
  } finally {
    ctx.restore();
  }

  const cleared: (string | undefined)[] = [];
  let submitCount = 0;
  const ctx2 = openCard(
    {
      onSubmit: (_expected, actual) => {
        submitCount += 1;
        cleared.push(actual);
      },
    },
    { draft }
  );
  try {
    const actualEl = ctx2.dom.findByAttr("data-expected-actual", "true");
    ctx2.dom.findByAttr("data-expected-actual-clear", "true").click();
    assert.equal(actualEl.value, "");
    ctx2.dom.findByAttr("data-expected-confirm", "true").click();
    // 无 expected 且 actual 被清空 → 走原有 onSkip 语义，不伪造期望
    assert.equal(submitCount, 0);
    assert.equal(ctx2.calls.onSkip, 1);
  } finally {
    ctx2.restore();
  }
});

test("速记卡超时兜底：未输入任何内容时 actual=草稿，expected 保持 missing", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const skipped: (string | undefined)[] = [];
  let submitCount = 0;
  const draft = "列表「订单」显示 0 条记录";
  const ctx = openCard(
    {
      onSubmit: () => {
        submitCount += 1;
      },
      onSkip: (actual, meta) => skipped.push(`${actual}|auto=${meta?.auto}`),
    },
    { draft }
  );
  try {
    t.mock.timers.tick(15_000);

    assert.equal(
      submitCount,
      0,
      "没有任何期望输入时不应产出 ExpectedStatement"
    );
    assert.deepEqual(
      skipped,
      [`${draft}|auto=true`],
      "超时应带草稿兜底并标记 auto"
    );

    // 期望缺失语义：narrative 未写入 expected，confidence 必须为 missing
    const resolved = resolveSceneExpectation({ actual: draft });
    assert.equal(resolved.actual, draft);
    assert.equal(resolved.confidence, "missing");
    assert.match(resolved.confidenceNotice ?? "", /UNCAPTURED_EXPECTATION/);
  } finally {
    ctx.restore();
  }
});

test("速记卡超时不覆盖：用户已填 expected 时走原 buildExpected 逻辑，actual 仍带草稿", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const payloads: { expected: any; actual?: string; meta?: any }[] = [];
  const draft = "按钮「提交」点击后无响应";
  const ctx = openCard(
    {
      onSubmit: (expected, actual, meta) =>
        payloads.push({ expected, actual, meta }),
    },
    { draft }
  );
  try {
    const input = ctx.dom.findByAttr("data-expected-input", "true");
    input.value = "提交成功后应提示并跳转";
    input.listeners["input"]?.[0]?.({ stopPropagation: () => {} });

    const chip = ctx.dom.findByAttr(
      "data-expected-chip",
      "expectedChipLoadFailed"
    );
    chip.click();

    t.mock.timers.tick(15_000);

    assert.equal(payloads.length, 1);
    assert.equal(payloads[0].expected.confidence, "explicit");
    assert.equal(payloads[0].expected.text, "提交成功后应提示并跳转");
    assert.deepEqual(payloads[0].expected.tags, ["expectedChipLoadFailed"]);
    assert.equal(
      payloads[0].actual,
      draft,
      "actual 仍应携带草稿，不因超时丢失"
    );
    assert.equal(payloads[0].meta.auto, true);
  } finally {
    ctx.restore();
  }
});

test("速记卡主动跳过：onSkip 携带预填草稿且 auto=false，不产出 expected", () => {
  const received: { actual?: string; meta?: any }[] = [];
  const draft = "按钮「提交」点击后无响应";
  const ctx = openCard(
    { onSkip: (actual, meta) => received.push({ actual, meta }) },
    { draft }
  );
  try {
    const actualEl = ctx.dom.findByAttr("data-expected-actual", "true");
    assert.ok(actualEl, "应渲染 actual 草稿输入框");
    assert.equal(actualEl.value, draft, "进入速记卡即预填草稿");

    ctx.dom.findByAttr("data-expected-skip", "true").click();

    assert.equal(ctx.calls.onSkip, 1);
    assert.equal(ctx.calls.onSubmit, 0, "跳过不得产出 ExpectedStatement");
    assert.equal(received.length, 1);
    assert.equal(received[0].actual, draft, "主动跳过也要带上 actual 草稿");
    assert.equal(received[0].meta?.auto, false, "主动跳过不是超时兜底");

    // expected 语义不变：草稿绝不升格为预期
    const resolved = resolveSceneExpectation({ actual: draft });
    assert.equal(resolved.actual, draft);
    assert.equal(resolved.confidence, "missing");
  } finally {
    ctx.restore();
  }
});

test("速记卡主动跳过：用户改过 actual 时带改后的值，而不是原始草稿", () => {
  const received: { actual?: string; meta?: any }[] = [];
  const draft = "按钮「提交」点击后无响应";
  const ctx = openCard(
    { onSkip: (actual, meta) => received.push({ actual, meta }) },
    { draft }
  );
  try {
    const actualEl = ctx.dom.findByAttr("data-expected-actual", "true");
    actualEl.value = "按钮「提交」点击后页面白屏";
    actualEl.listeners["input"]?.[0]?.({ stopPropagation: () => {} });

    ctx.dom.findByAttr("data-expected-skip", "true").click();

    assert.equal(ctx.calls.onSkip, 1);
    assert.equal(received.length, 1);
    assert.equal(
      received[0].actual,
      "按钮「提交」点击后页面白屏",
      "跳过时 actual 取用户改后的值（readActual 语义）"
    );
    assert.equal(received[0].meta?.auto, false);
  } finally {
    ctx.restore();
  }
});

// ─── 改造 4：先框选、后速记卡（顺序 / 取消 / 计时 / 定位 / 草稿元素）───

type FlowSnapshot = { id: string };

function createFlow() {
  const order: string[] = [];
  const flow = new MarkFlow<FlowSnapshot>({
    openOverlay(anchor) {
      order.push(
        anchor ? `openOverlay:${anchor.x},${anchor.y}` : "openOverlay"
      );
    },
    closeOverlay() {
      order.push("closeOverlay");
    },
    openCard(anchorRect, draft) {
      order.push(`openCard:${anchorRect.top}/${anchorRect.left}/${draft}`);
    },
    closeCard() {
      order.push("closeCard");
    },
    capture(snapshot) {
      order.push(`capture:${snapshot.id}`);
    },
    onCancel() {
      order.push("onCancel");
    },
  });
  return { flow, order };
}

const SELECTION_RECT = { top: 100, left: 20, width: 200, height: 40 };

test("标记顺序：overlay 先开、card 后开、capture 最后（精确调用序列）", () => {
  const { flow, order } = createFlow();

  flow.begin({ x: 12, y: 34 });
  assert.deepEqual(order, ["openOverlay:12,34"], "点标记只进框选，不弹卡");
  assert.equal(flow.currentPhase, "selecting");

  flow.selectionReady(
    { id: "sel-1" },
    SELECTION_RECT,
    "按钮「提交」点击后无响应"
  );
  assert.deepEqual(
    order,
    ["openOverlay:12,34", "openCard:100/20/按钮「提交」点击后无响应"],
    "框选完成后卡片贴着选区 rect 弹出"
  );
  assert.equal(flow.currentPhase, "card");
  assert.deepEqual(flow.snapshot, { id: "sel-1" });

  flow.resolveCard();
  assert.deepEqual(
    order,
    [
      "openOverlay:12,34",
      "openCard:100/20/按钮「提交」点击后无响应",
      "capture:sel-1",
    ],
    "卡片落定后才截图，快照透传给 capture"
  );
  assert.equal(flow.currentPhase, "idle");
  assert.equal(flow.snapshot, undefined, "截图后不得残留 pending 快照");
});

test("标记顺序：框选未完成时重复 selectionReady 不二次弹卡", () => {
  const { flow, order } = createFlow();
  flow.begin();
  flow.selectionReady({ id: "a" }, SELECTION_RECT, "草稿A");
  flow.selectionReady({ id: "b" }, SELECTION_RECT, "草稿B");
  assert.deepEqual(order, ["openOverlay", "openCard:100/20/草稿A"]);

  flow.begin();
  assert.deepEqual(
    order,
    ["openOverlay", "openCard:100/20/草稿A"],
    "流程进行中忽略重复入口"
  );
});

test("取消：框选阶段取消 → card.open 从未调用、pending 清空、可再次开始", () => {
  const { flow, order } = createFlow();
  flow.begin({ x: 5, y: 6 });
  flow.cancel();

  assert.equal(
    order.some((entry) => entry.startsWith("openCard")),
    false,
    "框选取消不得弹出速记卡"
  );
  assert.deepEqual(order, ["openOverlay:5,6", "closeOverlay", "onCancel"]);
  assert.equal(flow.currentPhase, "idle");
  assert.equal(flow.snapshot, undefined, "取消后不残留 pending 快照");
  assert.equal(flow.isBusy, false);

  order.length = 0;
  flow.begin();
  assert.deepEqual(order, ["openOverlay"], "取消后可重新进入框选");
  assert.equal(flow.currentPhase, "selecting");
});

test("取消：卡片阶段取消 → 不 capture、卡片关闭、pending 清空", () => {
  const { flow, order } = createFlow();
  flow.begin();
  flow.selectionReady({ id: "sel-2" }, SELECTION_RECT, "草稿");
  order.length = 0;

  flow.cancel();
  assert.deepEqual(order, ["closeCard", "onCancel"]);
  assert.equal(
    order.some((entry) => entry.startsWith("capture")),
    false,
    "卡片取消后不得继续截图"
  );
  assert.equal(flow.currentPhase, "idle");
  assert.equal(flow.snapshot, undefined);
});

test("计时：卡片 open 之前无 15s 定时器，open 当下才启动自动跳过", () => {
  const handle = createCardHandle();
  try {
    assert.deepEqual(handle.dom.timeouts, [], "未 open 时不得启动任何计时器");

    handle.card.open(undefined, {
      anchorRect: { top: 100, left: 100, width: 200, height: 40 },
    });

    assert.equal(
      handle.dom.timeouts.filter((delay) => delay === 15_000).length,
      1,
      "open 后恰好启动一个 15s 超时"
    );
  } finally {
    handle.restore();
  }
});

test("定位：贴底部翻上方、贴顶部贴下方、贴左边钳制 16px（精确数值 + DOM 落点）", () => {
  const viewport = { width: 1024, height: 768 };
  const card = { width: 460, height: 260 };

  // 贴底部：556 + 260 + 24 > 768 → 翻到上方 500 - 260 - 16 = 224
  assert.deepEqual(
    computeCardPosition(
      { top: 500, left: 100, width: 200, height: 40 },
      viewport,
      card
    ),
    { top: 224, left: 100, placement: "above" }
  );
  // 贴顶部：64 + 260 + 24 <= 768 → 下方 8 + 40 + 16 = 64
  assert.deepEqual(
    computeCardPosition(
      { top: 8, left: 100, width: 200, height: 40 },
      viewport,
      card
    ),
    { top: 64, left: 100, placement: "below" }
  );
  // 贴左边：left 4 钳到 16，top 100 + 40 + 16 = 156
  assert.deepEqual(
    computeCardPosition(
      { top: 100, left: 4, width: 200, height: 40 },
      viewport,
      card
    ),
    { top: 156, left: 16, placement: "below" }
  );
  // 选区越过视口左上边界：落点全部钳进视口
  assert.deepEqual(
    computeCardPosition(
      { top: -200, left: -200, width: 120, height: 50 },
      viewport,
      card
    ),
    { top: 16, left: 16, placement: "below" }
  );

  // 卡片真实落点与纯函数一致（mock 环境按 460 × 260 兜底测量）
  const bottom = openCard(
    {},
    { anchorRect: { top: 500, left: 100, width: 200, height: 40 } }
  );
  try {
    const root = bottom.card.element as any;
    assert.equal(root.style.top, "224px");
    assert.equal(root.style.left, "100px");
  } finally {
    bottom.restore();
  }

  const left = openCard(
    {},
    { anchorRect: { top: 100, left: 4, width: 200, height: 40 } }
  );
  try {
    const root = left.card.element as any;
    assert.equal(root.style.top, "156px");
    assert.equal(root.style.left, "16px");
  } finally {
    left.restore();
  }
});

test("选区 rect：多框取并集，<8px 或空白视为退化选区", () => {
  assert.deepEqual(
    unionSelectionRect([
      { top: 100, left: 50, width: 40, height: 20 },
      { top: 80, left: 120, width: 60, height: 50 },
    ]),
    { top: 80, left: 50, width: 130, height: 50 }
  );
  assert.deepEqual(unionSelectionRect([]), {
    top: 0,
    left: 0,
    width: 0,
    height: 0,
  });

  assert.equal(
    isDegenerateSelection({ top: 0, left: 0, width: 200, height: 40 }),
    false
  );
  assert.equal(
    isDegenerateSelection({
      top: 0,
      left: 0,
      width: MIN_SELECTION_PX - 1,
      height: 40,
    }),
    true,
    "宽 < 8px 视为退化"
  );
  assert.equal(
    isDegenerateSelection({
      top: 0,
      left: 0,
      width: 40,
      height: MIN_SELECTION_PX - 1,
    }),
    true,
    "高 < 8px 视为退化"
  );
  assert.equal(
    isDegenerateSelection({ top: 0, left: 0, width: 0, height: 0 }),
    true
  );
});

test("草稿元素选择：中心点命中 > 框内最大面积 > 最后交互元素兜底", () => {
  const hit = { tagName: "BUTTON" } as any;
  const big = { tagName: "TABLE" } as any;
  const small = { tagName: "SPAN" } as any;
  const fallback = { tagName: "DIV" } as any;

  assert.equal(
    pickDraftElement({
      hitTest: hit,
      candidates: [{ element: big, area: 90_000 }],
      fallback,
    }),
    hit,
    "中心点命中优先"
  );

  assert.equal(
    pickDraftElement({
      hitTest: undefined,
      candidates: [
        { element: small, area: 12 },
        { element: big, area: 9_600 },
      ],
      fallback,
    }),
    big,
    "无命中时取框内面积最大"
  );

  assert.equal(
    pickDraftElement({ candidates: [], fallback }),
    fallback,
    "选区有内容但无候选时退化到最后交互元素"
  );

  assert.equal(
    pickDraftElement({ candidates: [], fallback, emptySelection: true }),
    undefined,
    "空白/极小题不得用最后交互元素冒充选区内容"
  );

  assert.equal(
    pickDraftElement({}),
    undefined,
    "全部缺失时返回 undefined 不抛错"
  );
});

test("草稿兜底文案：空白选区走「无元素」分支，不编造现象", () => {
  const tr = localeTranslator("zh_CN");
  const element = pickDraftElement({ candidates: [], emptySelection: true });
  assert.equal(element, undefined);
  assert.equal(buildActualDraft({}, tr), "页面元素与预期不符");
});

test("interaction-collector：标记入口只进框选，卡片在框选完成回调里打开", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/entrypoints/content/interaction-collector.ts"),
    "utf8"
  );
  const beginStart = source.indexOf("function beginIssueSelection");
  const begin = source.slice(
    beginStart,
    source.indexOf("function resolveDraftAnchorElement", beginStart)
  );
  assert.match(begin, /markFlow\?\.begin\(anchor\)/);
  assert.equal(
    begin.includes("expectedCard?.open"),
    false,
    "beginIssueSelection 不得直接弹卡（必须先框选）"
  );
  assert.equal(
    source.includes("proceedToIssueSelection"),
    false,
    "旧的「卡片→框选」顺序函数应已移除"
  );

  const readyStart = source.indexOf("onSelectionReady(snapshot)");
  const ready = source.slice(
    readyStart,
    source.indexOf("onCaptureComplete(", readyStart)
  );
  assert.match(ready, /pickDraftElement\(\{/);
  assert.match(
    ready,
    /markFlow\?\.selectionReady\(snapshot, snapshot\.rect, draft\)/
  );
});
