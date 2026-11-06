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
      setAttribute(name: string, val: string) {
        this.attrs[name] = val;
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
