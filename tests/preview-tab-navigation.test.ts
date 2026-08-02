import assert from "node:assert/strict";
import test from "node:test";
import { PreviewPageShell } from "../src/preview/page-shell.ts";

function createPreviewDOM() {
  const listenersMap = new WeakMap<any, Record<string, Function[]>>();

  const createMockElement = (tagName: string, attributes: Record<string, string> = {}) => {
    const el = {
      nodeType: 1,
      nodeName: tagName.toUpperCase(),
      tagName: tagName.toUpperCase(),
      id: attributes.id || "",
      hidden: false,
      dataset: {} as Record<string, string>,
      attributes: { ...attributes },
      childNodes: [] as any[],
      classList: {
        _classes: new Set<string>((attributes.class || "").split(" ").filter(Boolean)),
        add(...cls: string[]) { cls.forEach((c) => this._classes.add(c)); },
        remove(...cls: string[]) { cls.forEach((c) => this._classes.delete(c)); },
        contains(c: string) { return this._classes.has(c); },
      },
      setAttribute(k: string, v: string) { this.attributes[k] = v; },
      getAttribute(k: string) { return this.attributes[k] || null; },
      removeAttribute(k: string) { delete this.attributes[k]; },
      focus() {
        if (doc) doc.activeElement = this;
      },
      appendChild(child: any) {
        child.parentNode = this;
        this.childNodes.push(child);
        return child;
      },
      addEventListener(type: string, fn: Function) {
        let map = listenersMap.get(this);
        if (!map) { map = {}; listenersMap.set(this, map); }
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
        event.target = this;
        const map = listenersMap.get(this);
        if (map && map[event.type]) {
          map[event.type].forEach((fn) => fn(event));
        }
        return true;
      }
    };
    return el;
  };

  const tabsConfig = [
    { key: "issues", paneId: "tab-pane-issues" },
    { key: "steps", paneId: "tab-pane-steps" },
    { key: "console", paneId: "tab-pane-console" },
    { key: "network", paneId: "tab-pane-network" }
  ];

  const tabButtons: any[] = [];
  const tabPanes: any[] = [];

  tabsConfig.forEach((cfg, idx) => {
    const btn = createMockElement("button", {
      class: `zen-tab-btn ${idx === 0 ? "active" : ""}`,
      "aria-selected": idx === 0 ? "true" : "false"
    });
    btn.dataset.tab = cfg.key;
    tabButtons.push(btn);

    const pane = createMockElement("div", {
      id: cfg.paneId,
      class: "zen-tab-pane"
    });
    pane.hidden = idx !== 0;
    tabPanes.push(pane);
  });

  const otherElement = createMockElement("input", { id: "search-input", class: "search-input" });

  const docListeners: Record<string, Function[]> = {};

  const doc = {
    activeElement: null as any,
    addEventListener(type: string, fn: Function) {
      if (!docListeners[type]) docListeners[type] = [];
      docListeners[type].push(fn);
    },
    removeEventListener(type: string, fn: Function) {
      if (docListeners[type]) docListeners[type] = docListeners[type].filter((f) => f !== fn);
    },
    dispatchEvent(event: any) {
      if (docListeners[event.type]) {
        docListeners[event.type].forEach((fn) => fn(event));
      }
      return true;
    },
    querySelectorAll(selector: string) {
      if (selector === ".zen-tab-btn[data-tab]") return tabButtons;
      if (selector === ".zen-tab-pane") return tabPanes;
      return [];
    },
    querySelector(selector: string) {
      if (selector === "#toast-message") return createMockElement("div", { id: "toast-message" });
      const match = selector.match(/\.zen-tab-btn\[data-tab="([^"]+)"\]/);
      if (match) {
        return tabButtons.find((btn) => btn.dataset.tab === match[1]) || null;
      }
      return null;
    }
  };

  return { doc, tabButtons, tabPanes, otherElement };
}

test("Preview Tab 键盘导航 - 8项键盘方向键与状态断言", () => {
  const { doc, tabButtons, tabPanes, otherElement } = createPreviewDOM();
  let tabChangeCount = 0;

  const shell = new PreviewPageShell(doc as any, () => {
    tabChangeCount += 1;
  });

  // 初始状态：activeTab 为 "issues" (第 0 个 button)
  assert.equal(shell.activeTab, "issues");
  assert.equal(tabButtons[0].classList.contains("active"), true);
  assert.equal(tabButtons[0].getAttribute("aria-selected"), "true");
  assert.equal(tabPanes[0].hidden, false);
  assert.equal(tabPanes[1].hidden, true);
  assert.equal(tabChangeCount, 0);

  // 7. 焦点不在 Tab 按钮时，左右方向键不应切换
  doc.activeElement = otherElement;
  doc.dispatchEvent({ type: "keydown", key: "ArrowRight", preventDefault: () => {} });
  assert.equal(shell.activeTab, "issues", "非 Tab 按钮获得焦点时方向键不触发切换");
  assert.equal(tabChangeCount, 0, "onTabChange 不被调用");

  // 1. 焦点位于 Tab 按钮时，ArrowRight 切换到下一个 Tab
  tabButtons[0].focus();
  assert.equal(doc.activeElement, tabButtons[0]);

  doc.dispatchEvent({ type: "keydown", key: "ArrowRight", preventDefault: () => {} });

  // 4. 切换后更新 active class
  assert.equal(tabButtons[0].classList.contains("active"), false);
  assert.equal(tabButtons[1].classList.contains("active"), true);

  // 5. 切换后正确更新 aria-selected
  assert.equal(tabButtons[0].getAttribute("aria-selected"), "false");
  assert.equal(tabButtons[1].getAttribute("aria-selected"), "true");

  // 6. 对应 tab pane 显示，其他 pane 隐藏
  assert.equal(tabPanes[0].hidden, true);
  assert.equal(tabPanes[1].hidden, false);
  assert.equal(shell.activeTab, "steps");

  // 8. onTabChange 按预期增加
  assert.equal(tabChangeCount, 1);

  // 2. ArrowLeft 切换到上一个 Tab
  doc.dispatchEvent({ type: "keydown", key: "ArrowLeft", preventDefault: () => {} });
  assert.equal(shell.activeTab, "issues");
  assert.equal(tabButtons[0].classList.contains("active"), true);
  assert.equal(tabPanes[0].hidden, false);
  assert.equal(tabChangeCount, 2);

  // 3. 首尾循环测试：在第 0 个按 ArrowLeft 应该循环到最后一个 ("network", 索引 3)
  doc.dispatchEvent({ type: "keydown", key: "ArrowLeft", preventDefault: () => {} });
  assert.equal(shell.activeTab, "network");
  assert.equal(tabButtons[3].classList.contains("active"), true);
  assert.equal(tabButtons[3].getAttribute("aria-selected"), "true");
  assert.equal(tabPanes[3].hidden, false);
  assert.equal(tabChangeCount, 3);

  // 在最后一个按 ArrowRight 应该循环到第一个 ("issues", 索引 0)
  doc.dispatchEvent({ type: "keydown", key: "ArrowRight", preventDefault: () => {} });
  assert.equal(shell.activeTab, "issues");
  assert.equal(tabButtons[0].classList.contains("active"), true);
  assert.equal(tabPanes[0].hidden, false);
  assert.equal(tabChangeCount, 4);

  // 9. selectTab 手动指定选项卡测试
  shell.selectTab("console");
  assert.equal(shell.activeTab, "console");
  assert.equal(tabButtons[2].classList.contains("active"), true);
  assert.equal(tabPanes[2].hidden, false);
});
