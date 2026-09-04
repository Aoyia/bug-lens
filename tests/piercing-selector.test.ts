import assert from "node:assert/strict";
import test, { describe, beforeEach, afterEach } from "node:test";
import {
  buildLocators,
  buildDomSnapshot,
  snapshotHtml,
  getFrameSelectorChain,
} from "../src/entrypoints/content/collector/dom-snapshot.ts";
import {
  parsePiercingSelector,
  formatPlaywrightLocator,
} from "../src/preview/playwright-generator.ts";

class MockElement {}
class MockHTMLElement extends MockElement {}
class MockHTMLIFrameElement extends MockHTMLElement {}
class MockHTMLInputElement extends MockHTMLElement {}
class MockHTMLButtonElement extends MockHTMLElement {}
class MockHTMLTextAreaElement extends MockHTMLElement {}
class MockHTMLSelectElement extends MockHTMLElement {}

function matchesSelector(el: any, sel: string): boolean {
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toLowerCase();
  if (sel === "*") return true;
  if (sel === tag) return true;
  if (sel.includes(",")) {
    return sel.split(",").some((s) => matchesSelector(el, s.trim()));
  }
  if (sel.startsWith("#")) {
    return el.id === sel.slice(1);
  }
  if (sel.startsWith(".")) {
    const cls = sel.slice(1);
    return Array.from(el.classList || []).includes(cls);
  }
  if (sel.includes("#")) {
    const [t, id] = sel.split("#");
    return (!t || t.toLowerCase() === tag) && el.id === id;
  }
  const attrMatch = sel.match(
    /^([a-z0-9_-]+)?\[([a-z0-9_-]+)(?:([*~^$]?=)"?([^"\]]*)"?)?\]$/i
  );
  if (attrMatch) {
    const [, tagPart, attrName, op, expectedVal] = attrMatch;
    if (tagPart && tagPart.toLowerCase() !== tag) return false;
    const actual = el.getAttribute(attrName);
    if (actual === null) return false;
    if (!op) return true;
    if (op === "=") return actual === expectedVal;
    if (op === "*=") return actual.includes(expectedVal);
    if (op === "^=") return actual.startsWith(expectedVal);
    if (op === "$=") return actual.endsWith(expectedVal);
  }
  if (sel.startsWith("role=")) {
    return el.getAttribute("role") === sel.slice(5);
  }
  return false;
}

function createMockElement(opts: {
  tagName: string;
  id?: string;
  className?: string;
  attributes?: Record<string, string>;
  parentElement?: any;
  ownerDocument?: any;
  value?: string;
  textContent?: string;
  role?: string;
  ariaLabel?: string;
}): any {
  const attrs = new Map<string, string>();
  if (opts.id) attrs.set("id", opts.id);
  if (opts.attributes) {
    for (const [k, v] of Object.entries(opts.attributes)) {
      attrs.set(k, v);
    }
  }
  if (opts.role) attrs.set("role", opts.role);
  if (opts.ariaLabel) attrs.set("aria-label", opts.ariaLabel);

  const children: any[] = [];

  const node: any = {
    tagName: opts.tagName.toUpperCase(),
    id: opts.id || "",
    className: opts.className || "",
    type: opts.attributes?.type || "text",
    classList: {
      length: opts.className
        ? opts.className.split(/\s+/).filter(Boolean).length
        : 0,
      [Symbol.iterator]() {
        const list = opts.className
          ? opts.className.split(/\s+/).filter(Boolean)
          : [];
        return list[Symbol.iterator]();
      },
    },
    parentElement: opts.parentElement || null,
    children,
    textContent: opts.textContent || "",
    value: opts.value || "",
    getAttribute(name: string) {
      return attrs.has(name) ? attrs.get(name)! : null;
    },
    hasAttribute(name: string) {
      return attrs.has(name);
    },
    setAttribute(name: string, val: string) {
      attrs.set(name, String(val));
    },
    removeAttribute(name: string) {
      attrs.delete(name);
    },
    get attributes() {
      return Array.from(attrs.entries()).map(([name, value]) => ({
        name,
        value,
      }));
    },
    getRootNode() {
      let curr = node;
      while (curr.parentElement) {
        curr = curr.parentElement;
      }
      return node.ownerDocument || curr;
    },
    getBoundingClientRect() {
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        width: 100,
        height: 30,
        right: 100,
        bottom: 30,
      };
    },
    querySelectorAll(selector: string) {
      const results: any[] = [];
      function walk(n: any) {
        for (const child of n.children) {
          if (matchesSelector(child, selector)) {
            results.push(child);
          }
          walk(child);
        }
      }
      walk(node);
      return results;
    },
    closest(sel: string) {
      let curr = node;
      while (curr) {
        if (matchesSelector(curr, sel)) return curr;
        curr = curr.parentElement;
      }
      return null;
    },
    remove() {
      if (node.parentElement) {
        const idx = node.parentElement.children.indexOf(node);
        if (idx >= 0) node.parentElement.children.splice(idx, 1);
        node.parentElement = null;
      }
    },
    appendChild(child: any) {
      child.parentElement = node;
      children.push(child);
      return child;
    },
    cloneNode(deep: boolean) {
      const cloned = createMockElement({
        tagName: node.tagName,
        id: node.id,
        className: node.className,
        attributes: Object.fromEntries(attrs.entries()),
        textContent: node.textContent,
        value: node.value,
        role: node.role,
        ariaLabel: node.ariaLabel,
      });
      if (deep) {
        for (const child of children) {
          cloned.appendChild(child.cloneNode(true));
        }
      }
      return cloned;
    },
    get outerHTML() {
      const tag = node.tagName.toLowerCase();
      let attrStr = "";
      for (const [k, v] of attrs.entries()) {
        attrStr += ` ${k}="${v}"`;
      }
      let inner = "";
      for (const c of children) {
        inner += c.outerHTML;
      }
      if (!inner && node.textContent) {
        inner = node.textContent;
      }
      return `<${tag}${attrStr}>${inner}</${tag}>`;
    },
  };

  const tagLower = opts.tagName.toLowerCase();
  if (tagLower === "iframe") {
    Object.setPrototypeOf(node, MockHTMLIFrameElement.prototype);
  } else if (tagLower === "button") {
    Object.setPrototypeOf(node, MockHTMLButtonElement.prototype);
  } else if (tagLower === "input") {
    Object.setPrototypeOf(node, MockHTMLInputElement.prototype);
  } else if (tagLower === "textarea") {
    Object.setPrototypeOf(node, MockHTMLTextAreaElement.prototype);
  } else if (tagLower === "select") {
    Object.setPrototypeOf(node, MockHTMLSelectElement.prototype);
  } else {
    Object.setPrototypeOf(node, MockHTMLElement.prototype);
  }

  node.ownerDocument = opts.ownerDocument || {
    defaultView: null,
    querySelectorAll(sel: string) {
      return node.querySelectorAll(sel);
    },
  };

  return node;
}

describe("R4: 穿透式 DOM 快照与层级选择器规范 (tests/piercing-selector.test.ts)", () => {
  let originalWindow: any;
  let originalElement: any;
  let originalHTMLElement: any;
  let originalHTMLIFrameElement: any;
  let originalHTMLInputElement: any;
  let originalHTMLButtonElement: any;
  let originalHTMLTextAreaElement: any;
  let originalHTMLSelectElement: any;
  let originalGetComputedStyle: any;

  beforeEach(() => {
    originalWindow = (globalThis as any).window;
    originalElement = (globalThis as any).Element;
    originalHTMLElement = (globalThis as any).HTMLElement;
    originalHTMLIFrameElement = (globalThis as any).HTMLIFrameElement;
    originalHTMLInputElement = (globalThis as any).HTMLInputElement;
    originalHTMLButtonElement = (globalThis as any).HTMLButtonElement;
    originalHTMLTextAreaElement = (globalThis as any).HTMLTextAreaElement;
    originalHTMLSelectElement = (globalThis as any).HTMLSelectElement;
    originalGetComputedStyle = (globalThis as any).getComputedStyle;

    (globalThis as any).Element = MockElement;
    (globalThis as any).HTMLElement = MockHTMLElement;
    (globalThis as any).HTMLIFrameElement = MockHTMLIFrameElement;
    (globalThis as any).HTMLInputElement = MockHTMLInputElement;
    (globalThis as any).HTMLButtonElement = MockHTMLButtonElement;
    (globalThis as any).HTMLTextAreaElement = MockHTMLTextAreaElement;
    (globalThis as any).HTMLSelectElement = MockHTMLSelectElement;
    (globalThis as any).getComputedStyle = () => ({
      getPropertyValue: () => "",
    });
  });

  afterEach(() => {
    (globalThis as any).window = originalWindow;
    (globalThis as any).Element = originalElement;
    (globalThis as any).HTMLElement = originalHTMLElement;
    (globalThis as any).HTMLIFrameElement = originalHTMLIFrameElement;
    (globalThis as any).HTMLInputElement = originalHTMLInputElement;
    (globalThis as any).HTMLButtonElement = originalHTMLButtonElement;
    (globalThis as any).HTMLTextAreaElement = originalHTMLTextAreaElement;
    (globalThis as any).HTMLSelectElement = originalHTMLSelectElement;
    (globalThis as any).getComputedStyle = originalGetComputedStyle;
  });

  test("用例 1：同一文档单层 iframe 生成带 >>> 的穿透定位器", () => {
    const topWin: any = {};
    topWin.top = topWin;
    topWin.parent = topWin;

    const hostDoc: any = { defaultView: topWin, querySelectorAll: () => [] };
    const iframeEl = createMockElement({
      tagName: "iframe",
      id: "app-frame",
      ownerDocument: hostDoc,
    });

    const childWin: any = {
      top: topWin,
      parent: topWin,
      frameElement: iframeEl,
    };
    const childDoc: any = {
      defaultView: childWin,
      querySelectorAll: (sel: string) => childRoot.querySelectorAll(sel),
    };
    const childRoot = createMockElement({
      tagName: "div",
      ownerDocument: childDoc,
    });
    const buttonEl = createMockElement({
      tagName: "button",
      attributes: { "data-testid": "submit-btn" },
      ownerDocument: childDoc,
    });
    childRoot.appendChild(buttonEl);

    const locators = buildLocators(buttonEl, "safe");
    assert.ok(locators.length > 0, "应生成定位器候选");
    assert.equal(locators[0].kind, "testId");
    assert.equal(
      locators[0].expression,
      'iframe#app-frame >>> [data-testid="submit-btn"]'
    );
    assert.ok(
      locators[0].reasons.some((r) =>
        r.includes("位于子 Frame (iframe#app-frame)")
      ),
      "reasons 需包含子 Frame 说明"
    );
  });

  test("用例 2：多层嵌套同源 iframe 递归生成多级穿透选择器", () => {
    const topWin: any = {};
    topWin.top = topWin;
    topWin.parent = topWin;
    const topDoc: any = { defaultView: topWin, querySelectorAll: () => [] };

    const outerIframe = createMockElement({
      tagName: "iframe",
      id: "outer-frame",
      ownerDocument: topDoc,
    });

    const outerWin: any = {
      top: topWin,
      parent: topWin,
      frameElement: outerIframe,
    };
    const outerDoc: any = { defaultView: outerWin, querySelectorAll: () => [] };

    const innerIframe = createMockElement({
      tagName: "iframe",
      attributes: { name: "inner-frame" },
      ownerDocument: outerDoc,
    });

    const innerWin: any = {
      top: topWin,
      parent: outerWin,
      frameElement: innerIframe,
    };
    const innerDoc: any = {
      defaultView: innerWin,
      querySelectorAll: (sel: string) => innerRoot.querySelectorAll(sel),
    };

    const innerRoot = createMockElement({
      tagName: "div",
      ownerDocument: innerDoc,
    });
    const inputEl = createMockElement({
      tagName: "input",
      id: "user-input",
      ownerDocument: innerDoc,
    });
    innerRoot.appendChild(inputEl);

    const chain = getFrameSelectorChain(innerWin);
    assert.deepEqual(chain, [
      "iframe#outer-frame",
      'iframe[name="inner-frame"]',
    ]);

    const locators = buildLocators(inputEl, "safe");
    const idLoc = locators.find((l) => l.kind === "id");
    assert.ok(idLoc, "应生成 id 定位器");
    assert.equal(
      idLoc?.expression,
      'iframe#outer-frame >>> iframe[name="inner-frame"] >>> #user-input'
    );
  });

  test("用例 3：跨域 iframe (无法读取 frameElement) 降级使用 window.name 或 pathname", () => {
    const topWin: any = {};
    topWin.top = topWin;
    topWin.parent = topWin;

    const crossOriginWin: any = {
      top: topWin,
      parent: topWin,
      name: "payment-frame",
      location: { pathname: "/checkout" },
    };
    Object.defineProperty(crossOriginWin, "frameElement", {
      get() {
        throw new Error(
          "SecurityError: Blocked a frame with origin from accessing a cross-origin frame."
        );
      },
    });

    const doc: any = {
      defaultView: crossOriginWin,
      querySelectorAll: (sel: string) => root.querySelectorAll(sel),
    };
    const root = createMockElement({
      tagName: "div",
      ownerDocument: doc,
    });
    const btnEl = createMockElement({
      tagName: "button",
      textContent: "Pay Now",
      ownerDocument: doc,
    });
    root.appendChild(btnEl);

    const chain = getFrameSelectorChain(crossOriginWin);
    assert.deepEqual(chain, ['iframe[name="payment-frame"]']);

    const locators = buildLocators(btnEl, "safe");
    assert.ok(locators.length > 0);
    assert.ok(
      locators[0].expression.startsWith('iframe[name="payment-frame"] >>> ')
    );
  });

  test("用例 4：parsePiercingSelector 语法解析测试", () => {
    assert.deepEqual(parsePiercingSelector("button.submit"), {
      frameSelectors: [],
      targetSelector: "button.submit",
    });

    assert.deepEqual(parsePiercingSelector("iframe#main >>> button.submit"), {
      frameSelectors: ["iframe#main"],
      targetSelector: "button.submit",
    });

    assert.deepEqual(
      parsePiercingSelector('iframe#a >>> iframe#b >>> [data-testid="btn"]'),
      {
        frameSelectors: ["iframe#a", "iframe#b"],
        targetSelector: '[data-testid="btn"]',
      }
    );
  });

  test("用例 5：Playwright 生成器转换为链式 frameLocator", () => {
    const res1 = formatPlaywrightLocator({
      kind: "testId",
      expression: 'iframe#sub >>> [data-testid="pay-btn"]',
    });
    assert.equal(
      res1,
      'page.frameLocator("iframe#sub").getByTestId("pay-btn")'
    );

    const res2 = formatPlaywrightLocator({
      kind: "role",
      expression: "iframe#a >>> iframe#b >>> role=button",
    });
    assert.equal(
      res2,
      'page.frameLocator("iframe#a").frameLocator("iframe#b").getByRole("button").first()'
    );

    const res3 = formatPlaywrightLocator({
      kind: "id",
      expression: "iframe#sub >>> #save-btn",
    });
    assert.equal(res3, 'page.frameLocator("iframe#sub").locator("#save-btn")');
  });

  test("用例 6：DOM 祖先树贯通 (Ancestor Penetration)", () => {
    const topWin: any = {};
    topWin.top = topWin;
    topWin.parent = topWin;
    const topDoc: any = { defaultView: topWin, querySelectorAll: () => [] };

    const hostDiv = createMockElement({
      tagName: "div",
      className: "host",
      ownerDocument: topDoc,
    });
    const iframeF = createMockElement({
      tagName: "iframe",
      id: "f",
      ownerDocument: topDoc,
      parentElement: hostDiv,
    });
    hostDiv.appendChild(iframeF);

    const childWin: any = {
      top: topWin,
      parent: topWin,
      frameElement: iframeF,
    };
    const childDoc: any = {
      defaultView: childWin,
      querySelectorAll: () => [],
    };

    const childDiv = createMockElement({
      tagName: "div",
      className: "child",
      ownerDocument: childDoc,
    });
    const button = createMockElement({
      tagName: "button",
      ownerDocument: childDoc,
      parentElement: childDiv,
    });
    childDiv.appendChild(button);

    const snapshot = buildDomSnapshot(button, "safe");
    assert.ok(
      snapshot.ancestors.length >= 3,
      "应爬升并跨越 iframe 包含宿主祖先"
    );
    assert.equal(snapshot.ancestors[0].tagName, "div");
    assert.equal(snapshot.ancestors[1].tagName, "iframe");
    assert.equal(snapshot.ancestors[1].id, "f");
    assert.equal(snapshot.ancestors[2].tagName, "div");
    assert.ok(snapshot.ancestors[2].classNames.includes("host"));
  });

  test("用例 7：snapshotHtml 保留 <iframe> 节点", () => {
    const wrapper = createMockElement({
      tagName: "div",
      className: "wrapper",
    });
    const iframe = createMockElement({
      tagName: "iframe",
      id: "sub",
      attributes: { src: "about:blank" },
    });
    const script = createMockElement({
      tagName: "script",
      textContent: "bad()",
    });
    wrapper.appendChild(iframe);
    wrapper.appendChild(script);

    const res = snapshotHtml(wrapper);
    assert.ok(res.sanitizedHtml, "应该生成 sanitizedHtml");
    assert.ok(
      res.sanitizedHtml.includes('<iframe id="sub"'),
      "快照必须保留 iframe 骨架"
    );
    assert.ok(
      res.sanitizedHtml.includes('data-bug-lens-frame="true"'),
      "快照应对 iframe 打上 data-bug-lens-frame 标记"
    );
    assert.ok(
      !res.sanitizedHtml.includes("<script"),
      "危险的 script 标签必须被清洗移除"
    );
  });

  test("用例 8：testId 包含双引号与转义字符（冒号、空格）时 formatPlaywrightLocator 还原原生属性字面量", () => {
    const res1 = formatPlaywrightLocator({
      kind: "testId",
      expression: '[data-testid="dialog\\"confirm"]',
    });
    assert.equal(res1, 'page.getByTestId("dialog\\"confirm")');

    const res2 = formatPlaywrightLocator({
      kind: "testId",
      expression: '[data-testid="auth\\:login\\:btn"]',
    });
    assert.equal(res2, 'page.getByTestId("auth:login:btn")');

    const res3 = formatPlaywrightLocator({
      kind: "testId",
      expression: 'iframe#sub >>> [data-testid="action\\ button"]',
    });
    assert.equal(
      res3,
      'page.frameLocator("iframe#sub").getByTestId("action button")'
    );
  });

  test("用例 9：buildDomSnapshot 在 getComputedStyle 为 null 时安全降级且 hidden 判定正常", () => {
    (globalThis as any).getComputedStyle = () => null;

    const btn = createMockElement({
      tagName: "button",
      id: "safe-null-style-btn",
    });

    assert.doesNotThrow(() => {
      const snapshot = buildDomSnapshot(btn, "safe");
      assert.ok(snapshot);
      assert.equal(snapshot.element.id, "safe-null-style-btn");
      assert.equal(snapshot.state.hidden, false);
      assert.deepEqual(snapshot.computedStyle, {});
    });
  });

  test("用例 10：getFrameSelectorChain 面对脱离文档无 parent 的 Window 时防御性退出返回空数组", () => {
    const orphanWin: any = {
      top: null,
      parent: null,
      name: "detached",
    };
    const chain = getFrameSelectorChain(orphanWin);
    assert.deepEqual(chain, []);
  });
});
