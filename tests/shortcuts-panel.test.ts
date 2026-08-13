import assert from "node:assert/strict";
import test from "node:test";
import { bindShortcutsPanel } from "../src/preview/shortcuts-panel.ts";

function createDOMEnvironment() {
  const listenersMap = new WeakMap<any, Record<string, Function[]>>();

  const createElement = (tagName: string, id?: string) => {
    const el = {
      nodeType: 1,
      nodeName: tagName.toUpperCase(),
      tagName: tagName.toUpperCase(),
      id: id || "",
      hidden: true,
      isContentEditable: false,
      childNodes: [] as any[],
      attributes: {} as Record<string, string>,
      focus() {
        if (doc) doc.activeElement = this;
      },
      contains(target: any) {
        if (target === this) return true;
        return this.childNodes.some((c) => c.contains?.(target));
      },
      appendChild(child: any) {
        child.parentNode = this;
        this.childNodes.push(child);
        return child;
      },
      addEventListener(type: string, fn: Function) {
        let map = listenersMap.get(this);
        if (!map) {
          map = {};
          listenersMap.set(this, map);
        }
        if (!map[type]) map[type] = [];
        map[type].push(fn);
      },
      removeEventListener(type: string, fn: Function) {
        const map = listenersMap.get(this);
        if (map && map[type]) {
          map[type] = map[type].filter((f) => f !== fn);
        }
      },
      dispatchEvent(event: any) {
        if (!event.target) event.target = this;
        const map = listenersMap.get(this);
        if (map && map[event.type]) {
          map[event.type].forEach((fn) => fn(event));
        }
        return true;
      },
    };
    return el;
  };

  const backdrop = createElement("div", "shortcuts-backdrop");
  const panelContent = createElement("div", "shortcuts-content");
  const closeBtn = createElement("button", "shortcuts-close-btn");
  backdrop.appendChild(panelContent);
  panelContent.appendChild(closeBtn);

  const inputEl = createElement("input", "test-input");
  const textareaEl = createElement("textarea", "test-textarea");
  const editableEl = createElement("div", "test-editable");
  editableEl.isContentEditable = true;

  const winListeners: Record<string, Function[]> = {};
  const win = {
    addEventListener(type: string, fn: Function) {
      if (!winListeners[type]) winListeners[type] = [];
      winListeners[type].push(fn);
    },
    removeEventListener(type: string, fn: Function) {
      if (winListeners[type])
        winListeners[type] = winListeners[type].filter((f) => f !== fn);
    },
    dispatchEvent(event: any) {
      if (winListeners[event.type]) {
        winListeners[event.type].forEach((fn) => fn(event));
      }
      return true;
    },
  };

  const doc = {
    activeElement: null as any,
    querySelector(selector: string) {
      if (selector === "#shortcuts-backdrop") return backdrop;
      if (selector === "#shortcuts-close-btn") return closeBtn;
      return null;
    },
  };

  return {
    doc,
    win,
    backdrop,
    closeBtn,
    panelContent,
    inputEl,
    textareaEl,
    editableEl,
  };
}

test("Preview 快捷键面板 - 8项键盘与鼠标行为验证", () => {
  const {
    doc,
    win,
    backdrop,
    closeBtn,
    panelContent,
    inputEl,
    textareaEl,
    editableEl,
  } = createDOMEnvironment();
  bindShortcutsPanel(doc as any, win as any);

  // 初始状态：面板隐藏
  assert.equal(backdrop.hidden, true);

  // 1. 按 `?` 打开快捷键面板，且关闭按钮获得焦点
  win.dispatchEvent({ type: "keydown", key: "?", preventDefault: () => {} });
  assert.equal(backdrop.hidden, false, "按 ? 应打开面板");
  assert.equal(doc.activeElement, closeBtn, "打开后关闭按钮获得焦点");

  // 2. 再按一次 `?` 关闭面板
  win.dispatchEvent({ type: "keydown", key: "?", preventDefault: () => {} });
  assert.equal(backdrop.hidden, true, "再次按 ? 应关闭面板");

  // 3. 面板打开时按 `Escape` 关闭
  win.dispatchEvent({ type: "keydown", key: "?", preventDefault: () => {} });
  assert.equal(backdrop.hidden, false);
  let escapePrevented = false;
  win.dispatchEvent({
    type: "keydown",
    key: "Escape",
    preventDefault: () => {
      escapePrevented = true;
    },
    stopPropagation: () => {},
  });
  assert.equal(backdrop.hidden, true, "按 Escape 应关闭面板");
  assert.equal(escapePrevented, true, "按 Escape 关闭面板时应阻止默认行为");

  // 4. 焦点位于 input、textarea 或 contenteditable 元素时，按 `?` 不应打开面板
  doc.activeElement = inputEl;
  win.dispatchEvent({ type: "keydown", key: "?", preventDefault: () => {} });
  assert.equal(backdrop.hidden, true, "焦点在 input 时按 ? 不打开面板");

  doc.activeElement = textareaEl;
  win.dispatchEvent({ type: "keydown", key: "?", preventDefault: () => {} });
  assert.equal(backdrop.hidden, true, "焦点在 textarea 时按 ? 不打开面板");

  doc.activeElement = editableEl;
  win.dispatchEvent({ type: "keydown", key: "?", preventDefault: () => {} });
  assert.equal(
    backdrop.hidden,
    true,
    "焦点在 contenteditable 时按 ? 不打开面板"
  );

  // 清理焦点
  doc.activeElement = null;

  // 5. 点击背景关闭面板
  win.dispatchEvent({ type: "keydown", key: "?", preventDefault: () => {} });
  assert.equal(backdrop.hidden, false);
  backdrop.dispatchEvent({ type: "click", target: backdrop });
  assert.equal(backdrop.hidden, true, "点击背景应关闭面板");

  // 6. 点击面板内部不关闭
  win.dispatchEvent({ type: "keydown", key: "?", preventDefault: () => {} });
  assert.equal(backdrop.hidden, false);
  backdrop.dispatchEvent({ type: "click", target: panelContent });
  assert.equal(backdrop.hidden, false, "点击面板内部不应关闭面板");

  // 7 & 8. 点击关闭按钮可以关闭
  closeBtn.dispatchEvent({ type: "click", target: closeBtn });
  assert.equal(backdrop.hidden, true, "点击关闭按钮应关闭面板");
});
