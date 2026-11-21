import assert from "node:assert/strict";
import test from "node:test";
import {
  isEnterCommitKey,
  resolveEscapeTarget,
  shouldWarnEmptyActual,
} from "../src/entrypoints/content/collector/issue-editor.ts";

test("issue-editor: 实际为空且未提示过时拦截并返回 true", () => {
  assert.equal(shouldWarnEmptyActual("", false), true);
  assert.equal(shouldWarnEmptyActual("   ", false), true);
});

test("issue-editor: 已提示过（二次确认）后允许按空记录保存", () => {
  assert.equal(shouldWarnEmptyActual("", true), false);
  assert.equal(shouldWarnEmptyActual("  ", true), false);
});

test("issue-editor: 实际非空时始终允许提交", () => {
  assert.equal(shouldWarnEmptyActual("页面无响应", false), false);
  assert.equal(shouldWarnEmptyActual("页面无响应", true), false);
});

test("issue-editor: 单行输入框内按 Enter 触发保存并继续", () => {
  assert.equal(isEnterCommitKey({ key: "Enter" }), true);
  assert.equal(isEnterCommitKey({ key: "Enter", keyCode: 13 }), true);
});

test("issue-editor: 输入法组词状态下 Enter 不触发提交（中文候选词确认）", () => {
  assert.equal(isEnterCommitKey({ key: "Enter", isComposing: true }), false);
  assert.equal(
    isEnterCommitKey({ key: "Enter", isComposing: true, keyCode: 13 }),
    false
  );
  // 兼容值兜底：部分浏览器 isComposing 不可靠时 keyCode 229 同样拦截
  assert.equal(isEnterCommitKey({ key: "Enter", keyCode: 229 }), false);
});

test("issue-editor: 非 Enter 键不触发提交", () => {
  assert.equal(isEnterCommitKey({ key: "a" }), false);
  assert.equal(isEnterCommitKey({ key: "Tab" }), false);
  assert.equal(isEnterCommitKey({ key: "Escape" }), false);
  assert.equal(isEnterCommitKey({ key: "" }), false);
});

test("issue-editor: Esc 在文字批注浮层聚焦时让位给浮层（含与表单同聚焦的边界）", () => {
  assert.equal(resolveEscapeTarget(true, false), "text-overlay");
  assert.equal(resolveEscapeTarget(true, true), "text-overlay");
});

test("issue-editor: Esc 在表单字段聚焦时仅失焦，不取消编辑器", () => {
  assert.equal(resolveEscapeTarget(false, true), "form-field");
});

test("issue-editor: 非文本输入场景 Esc 取消整个编辑器（等价顶部 ✕）", () => {
  assert.equal(resolveEscapeTarget(false, false), "editor");
});

// ─── 轻量 DOM 模拟测试 IssueEditor 焦点防劫持与事件屏蔽 ───

type Handler = (event: any) => void;

function createEditorDomMock() {
  const created: any[] = [];
  const windowListeners: Record<string, Handler[]> = {};

  function makeEl(tag: string) {
    const el: any = {
      tagName: tag.toUpperCase(),
      style: {},
      attrs: {} as Record<string, string>,
      children: [] as any[],
      listeners: {} as Record<string, Handler[]>,
      value: "",
      _innerHTML: "",
      get innerHTML() {
        return this._innerHTML;
      },
      set innerHTML(html: string) {
        this._innerHTML = html;
        const tagRegex = /<([a-zA-Z0-9_-]+)([^>]*)>/g;
        let match;
        while ((match = tagRegex.exec(html)) !== null) {
          const [, tag, attrsStr] = match;
          if (tag === "style" || tag === "defs") continue;
          const child = makeEl(tag);
          const attrRegex = /([a-zA-Z0-9_-]+)(?:=["']([^"']*)["'])?/g;
          let attrMatch;
          while ((attrMatch = attrRegex.exec(attrsStr)) !== null) {
            const [, attrName, attrVal] = attrMatch;
            child.setAttribute(attrName, attrVal ?? "");
          }
          this.children.push(child);
        }
      },
      offsetWidth: 500,
      offsetHeight: 300,
      offsetLeft: 50,
      offsetTop: 50,
      classList: {
        classes: new Set<string>(),
        add(c: string) {
          this.classes.add(c);
        },
        remove(c: string) {
          this.classes.delete(c);
        },
        contains(c: string) {
          return this.classes.has(c);
        },
      },
      closest(sel: string) {
        if (sel.startsWith("[")) {
          const attr = sel.replace(/[\[\]]/g, "");
          if (attr in this.attrs) return this;
        }
        return null;
      },
      setAttribute(name: string, val: string) {
        this.attrs[name] = val;
      },
      removeAttribute(name: string) {
        delete this.attrs[name];
      },
      hasAttribute(name: string) {
        return name in this.attrs;
      },
      getAttribute(name: string) {
        return this.attrs[name] ?? null;
      },
      addEventListener(type: string, fn: Handler) {
        (this.listeners[type] ||= []).push(fn);
      },
      removeEventListener(type: string, fn: Handler) {
        this.listeners[type] = (this.listeners[type] || []).filter(
          (f) => f !== fn
        );
      },
      appendChild(kid: any) {
        this.children.push(kid);
        return kid;
      },
      append(...kids: any[]) {
        kids.forEach((k) => this.children.push(k));
      },
      remove() {},
      focus() {
        (document as any).activeElement = this;
      },
      blur() {
        if ((document as any).activeElement === this) {
          (document as any).activeElement = null;
        }
      },
      contains(child: any) {
        if (child === this) return true;
        return this.children.some(
          (c) => c === child || (c.contains && c.contains(child))
        );
      },
      getBoundingClientRect() {
        return {
          left: 0,
          top: 0,
          width: 1000,
          height: 800,
          right: 1000,
          bottom: 800,
        };
      },
      querySelector(sel: string) {
        return this.querySelectorAll(sel)[0] || null;
      },
      querySelectorAll(sel: string) {
        const results: any[] = [];
        const match = (item: any) => {
          if (!item) return;
          const attrMatch = sel.match(
            /^\[([a-zA-Z0-9_-]+)(?:="?([^"\]]*)"?)?\]$/
          );
          if (attrMatch) {
            const [, name, val] = attrMatch;
            if (
              val !== undefined ? item.attrs[name] === val : name in item.attrs
            ) {
              results.push(item);
            }
          } else if (sel.startsWith(".")) {
            if (item.className?.includes(sel.slice(1))) results.push(item);
          } else if (sel.toLowerCase() === item.tagName?.toLowerCase()) {
            results.push(item);
          }
          (item.children || []).forEach(match);
        };
        (this.children || []).forEach(match);
        return results;
      },
    };
    created.push(el);
    return el;
  }

  const document: any = {
    activeElement: null,
    createElement: (tag: string) => makeEl(tag),
    documentElement: {
      appendChild(kid: any) {
        created.push(kid);
      },
    },
    body: makeEl("body"),
  };

  const window: any = {
    innerWidth: 1200,
    innerHeight: 800,
    windowListeners,
    addEventListener(type: string, fn: Handler) {
      (windowListeners[type] ||= []).push(fn);
    },
    removeEventListener(type: string, fn: Handler) {
      windowListeners[type] = (windowListeners[type] || []).filter(
        (f) => f !== fn
      );
    },
    matchMedia: (query: string) => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    }),
    visualViewport: {
      addEventListener() {},
      removeEventListener() {},
    },
    setTimeout: (fn: Function) => {
      fn();
      return 1;
    },
    clearTimeout: () => {},
    requestAnimationFrame: (fn: Function) => {
      fn();
      return 1;
    },
  };

  return { created, document, window, windowListeners };
}

test("issue-editor: 焦点隔离与防劫持屏障（反向焦点陷阱 + 宿主事件阻断）", async () => {
  const { IssueEditor } =
    await import("../src/entrypoints/content/collector/issue-editor.ts");
  const dom = createEditorDomMock();
  const prevDoc = (globalThis as any).document;
  const prevWin = (globalThis as any).window;
  const prevRaf = (globalThis as any).requestAnimationFrame;
  (globalThis as any).document = dom.document;
  (globalThis as any).window = dom.window;
  (globalThis as any).requestAnimationFrame = (fn: any) => fn();

  try {
    const editor = new IssueEditor({
      getSession: () => ({ sessionId: "test-session", nonce: "nonce-1" }),
      onClose: () => {},
      onReselect: () => {},
      onStopAfterCommit: () => {},
      isMac: true,
    });

    editor.open({
      id: "scene-1",
      page: { viewport: { width: 1000, height: 800 } },
      annotation: { point: { xRatio: 0.5, yRatio: 0.5 } },
    });

    const root = editor.element!;
    assert.ok(root, "编辑器根元素应成功创建");

    const focusinListeners = dom.windowListeners["focusin"] || [];
    assert.ok(
      focusinListeners.length > 0,
      "应向 window 注册 focusin 捕获监听器"
    );

    // 1. 内部字段聚焦时，stopImmediatePropagation 拦截，阻断向宿主 document 冒泡
    let innerStopped = false;
    focusinListeners[0]({
      target: root,
      stopImmediatePropagation: () => {
        innerStopped = true;
      },
    });
    assert.equal(
      innerStopped,
      true,
      "编辑器内部事件应终止立即传播以屏蔽宿主 focus trap"
    );

    // 2. 宿主模态框（如确认离开按钮）企图异步抢夺焦点时，拦截并拉回当前字段
    let restoredFocus = false;
    const actualInput = dom.created.find(
      (el) => "data-issue-actual" in el.attrs
    );
    assert.ok(actualInput, "应存在实际表现输入框");
    actualInput.focus = () => {
      restoredFocus = true;
    };

    let hijackStopped = false;
    let hijackPrevented = false;
    const hostModalButton = {
      tagName: "BUTTON",
      nodeType: 1,
    };
    focusinListeners[0]({
      target: hostModalButton,
      stopImmediatePropagation: () => {
        hijackStopped = true;
      },
      preventDefault: () => {
        hijackPrevented = true;
      },
    });
    assert.equal(hijackStopped, true, "外部抢焦时应阻断事件外溢");
    assert.equal(hijackPrevented, true, "外部抢焦时应阻止默认行为");
    assert.equal(
      restoredFocus,
      true,
      "外部抢焦时应将焦点强制拉回编辑器活跃输入框"
    );

    // 3. 输入框的键盘与指针事件调用 stopPropagation，阻断宿主全局拦截
    let keydownStopped = false;
    actualInput.listeners["keydown"]?.[0]?.({
      key: "a",
      stopPropagation: () => {
        keydownStopped = true;
      },
    });
    assert.equal(keydownStopped, true, "输入框按键应阻断向宿主页面冒泡");

    let mousedownStopped = false;
    actualInput.listeners["mousedown"]?.[0]?.({
      stopPropagation: () => {
        mousedownStopped = true;
      },
    });
    assert.equal(mousedownStopped, true, "输入框鼠标事件应阻断向宿主页面冒泡");

    // 4. Tab 键焦点循环测试（Shift+Tab 回退到保存停止按钮，Tab 前进到保存按钮）
    const saveBtn = dom.created.find((el) => "data-issue-save" in el.attrs);
    const saveStopBtn = dom.created.find(
      (el) => "data-issue-save-stop" in el.attrs
    );
    assert.ok(saveBtn, "应存在保存按钮");
    assert.ok(saveStopBtn, "应存在保存停止按钮");

    (dom.document as any).activeElement = actualInput;
    let tabPrevented = false;
    dom.windowListeners["keydown"]?.[0]?.({
      key: "Tab",
      shiftKey: false,
      preventDefault: () => {
        tabPrevented = true;
      },
      stopPropagation: () => {},
    });
    assert.equal(tabPrevented, true, "Tab 导航应阻止默认行为以防焦点外溢");
    assert.equal(
      (dom.document as any).activeElement,
      saveBtn,
      "Tab 键应前进至保存按钮"
    );

    // 5. 关闭后移除 window 上的捕获监听器
    editor.close(false);
    assert.equal(
      dom.windowListeners["focusin"]?.length ?? 0,
      0,
      "关闭后应注销 focusin 监听器"
    );
    assert.equal(
      dom.windowListeners["focus"]?.length ?? 0,
      0,
      "关闭后应注销 focus 监听器"
    );
    assert.equal(
      dom.windowListeners["keydown"]?.length ?? 0,
      0,
      "关闭后应注销 keydown 监听器"
    );
  } finally {
    (globalThis as any).document = prevDoc;
    (globalThis as any).window = prevWin;
    (globalThis as any).requestAnimationFrame = prevRaf;
  }
});

test("issue-editor: 方案A 预期展示为胶囊 Pill 并支持一键移除", async () => {
  const { IssueEditor } =
    await import("../src/entrypoints/content/collector/issue-editor.ts");
  const dom = createEditorDomMock();
  const prevDoc = (globalThis as any).document;
  const prevWin = (globalThis as any).window;
  const prevRaf = (globalThis as any).requestAnimationFrame;
  (globalThis as any).document = dom.document;
  (globalThis as any).window = dom.window;
  (globalThis as any).requestAnimationFrame = (fn: any) => fn();

  try {
    const editor = new IssueEditor({
      getSession: () => ({ sessionId: "test-session", nonce: "nonce-1" }),
      onClose: () => {},
      onReselect: () => {},
      onStopAfterCommit: () => {},
      isMac: true,
    });

    editor.open({
      id: "scene-pill",
      page: { viewport: { width: 1000, height: 800 } },
      annotation: { point: { xRatio: 0.5, yRatio: 0.5 } },
      narrative: {
        expected: { text: "页面应显示成功提示", confidence: "explicit" },
      },
    });

    const pill = dom.created.find(
      (el) => "data-issue-expected-pill" in el.attrs
    );
    assert.ok(pill, "存在前置预期时应渲染预期胶囊 Pill");

    const removeBtn = dom.created.find(
      (el) => "data-issue-expected-remove" in el.attrs
    );
    assert.ok(removeBtn, "预期胶囊应包含一键移除按钮");

    // 点击移除按钮
    let removed = false;
    pill.remove = () => {
      removed = true;
    };
    removeBtn.listeners["click"]?.[0]?.({
      stopPropagation: () => {},
    });
    assert.equal(removed, true, "点击移除按钮应从 DOM 中移除预期胶囊");

    // 验证卡片中不再包含原有多字段输入框
    const legacyExpectedInput = dom.created.find(
      (el) => "data-issue-expected" in el.attrs
    );
    const legacyNoteTextarea = dom.created.find(
      (el) => "data-issue-note" in el.attrs
    );
    assert.equal(
      legacyExpectedInput,
      undefined,
      "卡片中不应再有独立的预期输入框"
    );
    assert.equal(
      legacyNoteTextarea,
      undefined,
      "卡片中不应再有冗余的补充说明输入框"
    );

    editor.close(false);
  } finally {
    (globalThis as any).document = prevDoc;
    (globalThis as any).window = prevWin;
    (globalThis as any).requestAnimationFrame = prevRaf;
  }
});

test("issue-editor: 移动仿真态三段式无遮挡与行内文本批注钳制", async () => {
  const { IssueEditor } =
    await import("../src/entrypoints/content/collector/issue-editor.ts");
  const dom = createEditorDomMock();
  dom.window.innerWidth = 375;
  dom.window.innerHeight = 667;

  const prevDoc = (globalThis as any).document;
  const prevWin = (globalThis as any).window;
  const prevRaf = (globalThis as any).requestAnimationFrame;
  (globalThis as any).document = dom.document;
  (globalThis as any).window = dom.window;
  (globalThis as any).requestAnimationFrame = (fn: any) => fn();

  try {
    const editor = new IssueEditor({
      getSession: () => ({ sessionId: "test-session", nonce: "nonce-1" }),
      onClose: () => {},
      onReselect: () => {},
      onStopAfterCommit: () => {},
      isMac: true,
    });

    editor.open({
      id: "scene-mobile",
      page: { viewport: { width: 375, height: 667 } },
      annotation: {
        point: { xRatio: 0.95, yRatio: 0.3 },
        targetBox: {
          xRatio: 0.88,
          yRatio: 0.25,
          widthRatio: 0.1,
          heightRatio: 0.08,
        },
      },
      narrative: {
        expected: { text: "页面应显示成功提示", confidence: "explicit" },
      },
    });

    const root = editor.element!;
    assert.equal(
      root.getAttribute("data-wbr-mobile-mode"),
      "true",
      "375px 窄屏应自动同步 data-wbr-mobile-mode='true'"
    );

    // 校验 CSS 三段式关键规则与容器标记
    assert.ok(
      root.innerHTML.includes(
        '#__wbr_issue_editor__[data-wbr-mobile-mode="true"]'
      ),
      "样式中应包含移动仿真态根节点覆盖"
    );
    assert.ok(
      root.innerHTML.includes("[data-issue-canvas-container]"),
      "样式中应包含中段画布容器定义"
    );
    assert.ok(
      root.innerHTML.includes("container-type: size !important;"),
      "画布容器应使用 container-type: size 尺寸查询容器"
    );
    assert.ok(
      root.innerHTML.includes("display: inline-flex !important;"),
      "画布应使用 inline-flex 1:1 包裹图片真实像素尺寸"
    );
    assert.ok(
      root.innerHTML.includes("max-width: calc(100cqw - 16px) !important;"),
      "图片应使用 100cqw 与 100cqh 容器查询尺寸适配"
    );
    assert.ok(
      !root.innerHTML.includes(
        "height: 100% !important;\n        width: auto !important;\n        border-radius: 2px !important;"
      ),
      "移动态画布不得再写死 height: 100% 避免上下黑边与 SVG 错位"
    );
    assert.ok(
      root.innerHTML.includes("[data-issue-control-card]"),
      "样式中应包含底段控制卡自然贴底定义"
    );
    assert.ok(
      root.innerHTML.includes("[data-issue-drag-handle]"),
      "样式中应隐藏移动仿真态拖拽手柄"
    );

    const controlCard = dom.created.find(
      (el) => "data-issue-control-card" in el.attrs
    );
    assert.ok(controlCard, "应存在控制卡片");
    // 移动仿真态下控制卡靠 flex 自然贴底，不设置悬浮 left/top
    assert.equal(
      controlCard.style.left ?? "",
      "",
      "移动仿真态控制卡不应写入绝对浮动 left"
    );
    assert.equal(
      controlCard.style.top ?? "",
      "",
      "移动仿真态控制卡不应写入绝对浮动 top"
    );

    // 验证文本批注工具在 375px 视口右边缘点击时的钳制
    const textToolBtn = dom.created.find(
      (el) => el.attrs["data-issue-tool"] === "text"
    );
    assert.ok(textToolBtn, "应存在文本批注工具按钮");
    textToolBtn.listeners["click"]?.[0]?.({
      stopPropagation: () => {},
      preventDefault: () => {},
    });

    const svg = dom.created.find((el) => "data-issue-svg" in el.attrs);
    svg.getBoundingClientRect = () => ({
      left: 0,
      top: 52,
      width: 375,
      height: 480,
      right: 375,
      bottom: 532,
    });

    // 用户在接近右边缘 x=360 点击画布
    svg.listeners["pointerdown"]?.[0]?.({
      pointerId: 1,
      clientX: 360,
      clientY: 180,
      target: svg,
      preventDefault: () => {},
    });

    // 查找生成的文本批注输入框
    const textInput = dom.created.find(
      (el) =>
        el.tagName === "INPUT" &&
        !("data-issue-actual" in el.attrs) &&
        !("data-expected-input" in el.attrs)
    );
    assert.ok(textInput, "点击文本工具应生成文本批注 input");
    const inputLeft = Number.parseFloat(textInput.style.left);
    assert.ok(
      inputLeft <= 375 - 168 - 8,
      `文本输入框 left (${inputLeft}) 应被向左钳制，预留至少 168px 宽度与 8px 右边距`
    );
    const maxW = Number.parseFloat(textInput.style.maxWidth);
    assert.ok(
      inputLeft + maxW <= 375,
      `文本输入框右侧 (left=${inputLeft} + maxWidth=${maxW}) 绝对不超出 375px 视口`
    );

    // 用户在接近底边缘 clientY=530 点击画布（svg.bottom=532）
    svg.listeners["pointerdown"]?.[0]?.({
      pointerId: 2,
      clientX: 100,
      clientY: 530,
      target: svg,
      preventDefault: () => {},
    });

    const textInputs = dom.created.filter(
      (el) =>
        el.tagName === "INPUT" &&
        !("data-issue-actual" in el.attrs) &&
        !("data-expected-input" in el.attrs)
    );
    const bottomInput = textInputs[textInputs.length - 1];
    assert.ok(bottomInput, "底缘点击应生成文本批注 input");
    const inputTop = Number.parseFloat(bottomInput.style.top);
    // svg bottom 为 532，估计高度 28，下边距至少 4px，所以 top 最大不得超过 532 - 28 - 4 = 500
    assert.ok(
      inputTop <= 532 - 28 - 4,
      `底缘点击生成的文本输入框 top (${inputTop}) 应被画布底边界钳制 (<= 500)，避免压到底部控制卡`
    );
    assert.ok(
      inputTop >= 52 + 4,
      `文本输入框 top (${inputTop}) 应在 svg.top (52) 之内`
    );

    editor.close(false);
  } finally {
    (globalThis as any).document = prevDoc;
    (globalThis as any).window = prevWin;
    (globalThis as any).requestAnimationFrame = prevRaf;
  }
});

test("issue-editor: PC 桌面端保持 100% 原样悬浮定位与拖拽钳制", async () => {
  const { IssueEditor } =
    await import("../src/entrypoints/content/collector/issue-editor.ts");
  const dom = createEditorDomMock();
  dom.window.innerWidth = 1200;
  dom.window.innerHeight = 800;

  const prevDoc = (globalThis as any).document;
  const prevWin = (globalThis as any).window;
  const prevRaf = (globalThis as any).requestAnimationFrame;
  (globalThis as any).document = dom.document;
  (globalThis as any).window = dom.window;
  (globalThis as any).requestAnimationFrame = (fn: any) => fn();

  try {
    const editor = new IssueEditor({
      getSession: () => ({ sessionId: "test-session", nonce: "nonce-1" }),
      onClose: () => {},
      onReselect: () => {},
      onStopAfterCommit: () => {},
      isMac: true,
    });

    editor.open({
      id: "scene-desktop",
      page: { viewport: { width: 1200, height: 800 } },
      annotation: {
        point: { xRatio: 0.5, yRatio: 0.5 },
        targetBox: {
          xRatio: 0.45,
          yRatio: 0.45,
          widthRatio: 0.1,
          heightRatio: 0.1,
        },
      },
    });

    const root = editor.element!;
    assert.equal(
      root.getAttribute("data-wbr-mobile-mode"),
      null,
      "PC 桌面端不得挂载 data-wbr-mobile-mode"
    );

    const controlCard = dom.created.find(
      (el) => "data-issue-control-card" in el.attrs
    );
    assert.ok(controlCard, "应存在控制卡片");

    const svg = dom.created.find((el) => "data-issue-svg" in el.attrs);
    svg.getBoundingClientRect = () => ({
      left: 100,
      top: 50,
      width: 1000,
      height: 700,
      right: 1100,
      bottom: 750,
    });

    // 桌面端卡片宽度 500px 时定位
    controlCard.offsetWidth = 500;
    controlCard.offsetHeight = 52;
    dom.windowListeners["resize"]?.[0]?.();

    const desktopLeft = Number.parseFloat(controlCard.style.left);
    assert.ok(
      Number.isFinite(desktopLeft) && desktopLeft > 8,
      `PC 端应根据目标元素就近计算悬浮 left: ${desktopLeft}`
    );

    // 模拟桌面端用户拖拽手柄
    const dragHandle = dom.created.find(
      (el) => "data-issue-drag-handle" in el.attrs
    );
    assert.ok(dragHandle, "PC 端应存在拖拽手柄");

    dragHandle.listeners["pointerdown"]?.[0]?.({
      pointerId: 1,
      clientX: 600,
      clientY: 400,
      preventDefault() {},
    });
    dragHandle.listeners["pointermove"]?.[0]?.({
      pointerId: 1,
      clientX: 1500,
      clientY: 400,
    });
    const maxAllowedLeft = 1200 - 500 - 8; // 692
    const draggedRight = Number.parseFloat(controlCard.style.left);
    assert.equal(
      draggedRight,
      maxAllowedLeft,
      "向右拖出屏幕应受视口右边距 8px 钳制"
    );

    dragHandle.listeners["pointermove"]?.[0]?.({
      pointerId: 1,
      clientX: -200,
      clientY: 400,
    });
    const draggedLeft = Number.parseFloat(controlCard.style.left);
    assert.equal(draggedLeft, 8, "向左拖出屏幕应受视口左边距 8px 钳制");

    dragHandle.listeners["pointerup"]?.[0]?.({ pointerId: 1 });

    // 动态 resize 切换测试：从 1200px 缩小至 375px
    dom.window.innerWidth = 375;
    dom.window.innerHeight = 667;
    dom.windowListeners["resize"]?.[0]?.();

    assert.equal(
      root.getAttribute("data-wbr-mobile-mode"),
      "true",
      "动态 resize 至 375px 应自动切换为移动仿真态"
    );
    assert.equal(
      controlCard.style.left ?? "",
      "",
      "切换至移动仿真态后应清理悬浮 left"
    );

    // 再次 resize 回 1200px
    dom.window.innerWidth = 1200;
    dom.window.innerHeight = 800;
    dom.windowListeners["resize"]?.[0]?.();

    assert.equal(
      root.getAttribute("data-wbr-mobile-mode"),
      null,
      "resize 回 1200px 应自动移除移动仿真标记"
    );

    editor.close(false);
  } finally {
    (globalThis as any).document = prevDoc;
    (globalThis as any).window = prevWin;
    (globalThis as any).requestAnimationFrame = prevRaf;
  }
});
