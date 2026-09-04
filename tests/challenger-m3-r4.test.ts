import assert from "node:assert/strict";
import test, { describe, beforeEach, afterEach } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import {
  buildLocators,
  buildDomSnapshot,
  snapshotHtml,
  getFrameSelectorChain,
  getFrameSelector,
  cssEscape,
} from "../src/entrypoints/content/collector/dom-snapshot.ts";
import {
  parsePiercingSelector,
  formatPlaywrightLocator,
  generatePlaywrightScript,
} from "../src/preview/playwright-generator.ts";
import {
  SpatialPruner,
  type BoundingBox,
} from "../src/entrypoints/content/collector/spatial-pruner.ts";
import type {
  RecordingSession,
  InteractionRecord,
} from "../src/shared/protocol.ts";

// ─── DOM Mock Classes ───
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
    const rawId = sel.slice(1).replace(/\\([: "'])/g, "$1");
    return el.id === rawId || el.id === sel.slice(1);
  }
  if (sel.startsWith(".")) {
    const cls = sel.slice(1);
    return Array.from(el.classList || []).includes(cls);
  }
  const attrMatch = sel.match(
    /^([a-z0-9_-]+)?\[([a-z0-9_-]+)(?:([*~^$]?=)"?([^"\]]*)"?)?\]$/i
  );
  if (attrMatch) {
    const [, tagPart, attrName, op, rawExpected] = attrMatch;
    if (tagPart && tagPart.toLowerCase() !== tag) return false;
    const actual = el.getAttribute(attrName);
    if (actual === null) return false;
    if (!op) return true;
    const expected = rawExpected?.replace(/\\([: "'])/g, "$1") ?? "";
    if (op === "=") return actual === expected || actual === rawExpected;
    if (op === "*=") return actual.includes(expected);
    if (op === "^=") return actual.startsWith(expected);
    if (op === "$=") return actual.endsWith(expected);
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
  bounds?: { left: number; top: number; width: number; height: number };
  contentDocument?: any;
}): any {
  const attrs = new Map<string, string>();
  if (opts.id) attrs.set("id", opts.id);
  if (opts.className) attrs.set("class", opts.className);
  if (opts.attributes) {
    for (const [k, v] of Object.entries(opts.attributes)) {
      attrs.set(k, v);
    }
  }
  if (opts.role) attrs.set("role", opts.role);
  if (opts.ariaLabel) attrs.set("aria-label", opts.ariaLabel);

  const children: any[] = [];
  const classListItems = opts.className
    ? opts.className.split(/\s+/).filter(Boolean)
    : [];

  const node: any = {
    tagName: opts.tagName.toUpperCase(),
    id: opts.id || "",
    className: opts.className || "",
    type: opts.attributes?.type || "text",
    classList: {
      length: classListItems.length,
      [Symbol.iterator]() {
        return classListItems[Symbol.iterator]();
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
      const b = opts.bounds || {
        left: 10,
        top: 10,
        width: 100,
        height: 30,
      };
      return {
        x: b.left,
        y: b.top,
        left: b.left,
        top: b.top,
        width: b.width,
        height: b.height,
        right: b.left + b.width,
        bottom: b.top + b.height,
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
        bounds: opts.bounds,
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
    if (opts.contentDocument !== undefined) {
      node.contentDocument = opts.contentDocument;
    }
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

describe("Challenger Adversarial Stress Suite: M3 R4 穿透定位器与 DOM 快照极限测试", () => {
  let originalWindow: any;
  let originalDocument: any;
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
    originalDocument = (globalThis as any).document;
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
    (globalThis as any).document = originalDocument;
    (globalThis as any).Element = originalElement;
    (globalThis as any).HTMLElement = originalHTMLElement;
    (globalThis as any).HTMLIFrameElement = originalHTMLIFrameElement;
    (globalThis as any).HTMLInputElement = originalHTMLInputElement;
    (globalThis as any).HTMLButtonElement = originalHTMLButtonElement;
    (globalThis as any).HTMLTextAreaElement = originalHTMLTextAreaElement;
    (globalThis as any).HTMLSelectElement = originalHTMLSelectElement;
    (globalThis as any).getComputedStyle = originalGetComputedStyle;
  });

  // ─────────────────────────────────────────────────────────────
  // 1. 极限多层嵌套 (4-6 层同源与跨域混合)
  // ─────────────────────────────────────────────────────────────

  test("对抗 1.1：4 层同源嵌套生成 4 级穿透定位器并成功转换为 Playwright 链式调用", () => {
    // 拓扑：topWin -> f1 -> f2 -> f3 -> f4
    const topWin: any = {};
    topWin.top = topWin;
    topWin.parent = topWin;
    const topDoc: any = { defaultView: topWin, querySelectorAll: () => [] };

    let parentWin = topWin;
    let parentDoc = topDoc;
    const iframeIds = ["f1", "f2", "f3", "f4"];
    let deepestWin: any = null;
    let deepestDoc: any = null;

    for (const fid of iframeIds) {
      const iframe = createMockElement({
        tagName: "iframe",
        id: fid,
        ownerDocument: parentDoc,
      });
      const childWin: any = {
        top: topWin,
        parent: parentWin,
        frameElement: iframe,
      };
      const childDoc: any = {
        defaultView: childWin,
        querySelectorAll: (s: string) => root.querySelectorAll(s),
      };
      const root = createMockElement({
        tagName: "div",
        ownerDocument: childDoc,
      });
      parentDoc = childDoc;
      parentWin = childWin;
      deepestWin = childWin;
      deepestDoc = childDoc;
    }

    const targetButton = createMockElement({
      tagName: "button",
      id: "deep-btn",
      ownerDocument: deepestDoc,
    });
    deepestDoc.querySelectorAll = (sel: string) =>
      matchesSelector(targetButton, sel) ? [targetButton] : [];

    const chain = getFrameSelectorChain(deepestWin);
    assert.equal(chain.length, 4, "4 层同源嵌套应产生 4 级 iframe 链");
    assert.deepEqual(chain, [
      "iframe#f1",
      "iframe#f2",
      "iframe#f3",
      "iframe#f4",
    ]);

    const locators = buildLocators(targetButton, "safe");
    assert.ok(locators.length > 0);
    const expectedPrefix =
      "iframe#f1 >>> iframe#f2 >>> iframe#f3 >>> iframe#f4 >>> ";
    assert.ok(
      locators[0].expression.startsWith(expectedPrefix),
      `定位器应包含 4 级穿透前缀，实际为: ${locators[0].expression}`
    );

    const pw = formatPlaywrightLocator(locators[0]);
    assert.equal(
      pw,
      'page.frameLocator("iframe#f1").frameLocator("iframe#f2").frameLocator("iframe#f3").frameLocator("iframe#f4").locator("#deep-btn")'
    );
  });

  test("对抗 1.2：5 层同源嵌套（边界上限）正常生成 5 级链且未截断", () => {
    // 拓扑：topWin -> f1 -> f2 -> f3 -> f4 -> f5
    const topWin: any = {};
    topWin.top = topWin;
    topWin.parent = topWin;
    let parentWin = topWin;
    let parentDoc: any = { defaultView: topWin, querySelectorAll: () => [] };

    let deepestWin: any = null;
    let deepestDoc: any = null;

    for (let i = 1; i <= 5; i++) {
      const fid = `layer-${i}`;
      const iframe = createMockElement({
        tagName: "iframe",
        id: fid,
        ownerDocument: parentDoc,
      });
      const childWin: any = {
        top: topWin,
        parent: parentWin,
        frameElement: iframe,
      };
      const childDoc: any = {
        defaultView: childWin,
        querySelectorAll: () => [],
      };
      parentDoc = childDoc;
      parentWin = childWin;
      deepestWin = childWin;
      deepestDoc = childDoc;
    }

    const chain = getFrameSelectorChain(deepestWin);
    assert.equal(chain.length, 5, "恰好 5 层嵌套应完整保留 5 级选择器");
    assert.deepEqual(chain, [
      "iframe#layer-1",
      "iframe#layer-2",
      "iframe#layer-3",
      "iframe#layer-4",
      "iframe#layer-5",
    ]);
  });

  test("对抗 1.3：6 层嵌套超过限制时平稳截断至 5 层防死循环，不发生挂死或栈溢出", () => {
    // 拓扑：topWin -> f1 -> f2 -> f3 -> f4 -> f5 -> f6
    const topWin: any = {};
    topWin.top = topWin;
    topWin.parent = topWin;
    let parentWin = topWin;
    let parentDoc: any = { defaultView: topWin, querySelectorAll: () => [] };

    let deepestWin: any = null;
    let deepestDoc: any = null;

    for (let i = 1; i <= 6; i++) {
      const fid = `level-${i}`;
      const iframe = createMockElement({
        tagName: "iframe",
        id: fid,
        ownerDocument: parentDoc,
      });
      const childWin: any = {
        top: topWin,
        parent: parentWin,
        frameElement: iframe,
      };
      const childDoc: any = {
        defaultView: childWin,
        querySelectorAll: () => [],
      };
      parentDoc = childDoc;
      parentWin = childWin;
      deepestWin = childWin;
      deepestDoc = childDoc;
    }

    const start = performance.now();
    const chain = getFrameSelectorChain(deepestWin);
    const elapsed = performance.now() - start;

    assert.ok(elapsed < 100, "6 层嵌套解析应在 100ms 内完成，无死循环");
    assert.equal(chain.length, 5, "超过 5 层应被安全截断至 5 层");
    // 回溯截断保留了最深处的 5 层（level-2 至 level-6）
    assert.deepEqual(chain, [
      "iframe#level-2",
      "iframe#level-3",
      "iframe#level-4",
      "iframe#level-5",
      "iframe#level-6",
    ]);

    // 验证快照攀爬 ancestors 同样在 5 层限制内安全退出
    const targetEl = createMockElement({
      tagName: "span",
      id: "deep-span",
      ownerDocument: deepestDoc,
    });
    const snapshot = buildDomSnapshot(targetEl, "safe");
    assert.ok(snapshot.ancestors.length <= 5, "祖先链不能超过 5 层限制");
  });

  test("对抗 1.4：6 层同源与跨域极端混合嵌套容错测试（SecurityError 降级）", () => {
    // 拓扑：topWin -> f1(同源) -> f2(跨域) -> f3(同源) -> f4(跨域) -> f5(同源) -> f6(跨域)
    const topWin: any = {};
    topWin.top = topWin;
    topWin.parent = topWin;

    let parentWin = topWin;
    let parentDoc: any = { defaultView: topWin, querySelectorAll: () => [] };
    let deepestWin: any = null;
    let deepestDoc: any = null;

    for (let i = 1; i <= 6; i++) {
      const isCrossOrigin = i % 2 === 0;
      const fid = `mix-frame-${i}`;
      const iframe = createMockElement({
        tagName: "iframe",
        id: fid,
        attributes: { name: `frame-name-${i}` },
        ownerDocument: parentDoc,
      });

      const childWin: any = {
        top: topWin,
        parent: parentWin,
        name: `frame-name-${i}`,
        location: { pathname: `/page-${i}` },
      };

      if (isCrossOrigin) {
        // 模拟跨域：访问 frameElement 抛出 DOMException / SecurityError
        Object.defineProperty(childWin, "frameElement", {
          get() {
            throw new Error("SecurityError: Blocked a cross-origin frame.");
          },
        });
      } else {
        childWin.frameElement = iframe;
      }

      const childDoc: any = {
        defaultView: childWin,
        querySelectorAll: () => [],
      };
      parentDoc = childDoc;
      parentWin = childWin;
      deepestWin = childWin;
      deepestDoc = childDoc;
    }

    assert.doesNotThrow(() => {
      const chain = getFrameSelectorChain(deepestWin);
      assert.ok(
        chain.length > 0 && chain.length <= 5,
        "混合嵌套应平稳降级且受限于 5 层"
      );
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 2. 特殊字符健壮性 (冒号、反斜杠、引号、空格)
  // ─────────────────────────────────────────────────────────────

  test("对抗 2.1：各类特殊字符（冒号、空格、引号、反斜杠）在 ID 选择器中的转义与代码生成", () => {
    const specialIds = [
      "user:email", // 冒号（常见于 PrimeNG/JSF/Tailwind）
      "save btn", // 空格
      'quote"btn', // 双引号
      "back\\slash", // 反斜杠
      "colon:space id", // 复合
    ];

    for (const id of specialIds) {
      const doc: any = { defaultView: null, querySelectorAll: () => [] };
      const el = createMockElement({
        tagName: "button",
        id,
        ownerDocument: doc,
      });
      doc.querySelectorAll = (sel: string) =>
        matchesSelector(el, sel) ? [el] : [];

      const locators = buildLocators(el, "safe");
      const idLoc = locators.find((l) => l.kind === "id");
      assert.ok(idLoc, `ID '${id}' 应该生成 ID 定位器`);

      const pw = formatPlaywrightLocator(idLoc!);
      // 验证生成的 Playwright 语句是合法的 JS 表达式（能被 eval / Function 解析）
      assert.doesNotThrow(() => {
        new Function("page", `return ${pw};`);
      }, `生成的 Playwright 语句必须具备合法的 JS 语法: ${pw}`);

      assert.ok(
        pw.startsWith("page.locator("),
        `应生成 page.locator 语句，实际为: ${pw}`
      );
    }
  });

  test("对抗 2.2：data-testid 包含特殊字符（冒号、双引号、空格）时的转义与解析实证", () => {
    // 观察项：data-testid 包含特殊字符时，buildLocators 进行 cssEscape，
    // formatPlaywrightLocator 现已支持双引号与特殊字符反转义，还原干净的原生属性字面量

    // Case 1: 冒号 (auth:login:btn)
    const elColon = createMockElement({
      tagName: "button",
      attributes: { "data-testid": "auth:login:btn" },
    });
    const locColon = buildLocators(elColon, "safe").find(
      (l) => l.kind === "testId"
    )!;
    const pwColon = formatPlaywrightLocator(locColon);
    // 验证：已正确反转义冒号，生成精确的原生属性字面量
    assert.equal(pwColon, 'page.getByTestId("auth:login:btn")');

    // Case 2: 双引号 (dialog"confirm)
    const elQuote = createMockElement({
      tagName: "button",
      attributes: { "data-testid": 'dialog"confirm' },
    });
    const locQuote = buildLocators(elQuote, "safe").find(
      (l) => l.kind === "testId"
    )!;
    const pwQuote = formatPlaywrightLocator(locQuote);
    // 验证：正则已支持双引号提取并反转义，正确输出 dialog"confirm
    assert.equal(pwQuote, 'page.getByTestId("dialog\\"confirm")');
    // 生成的整行 JavaScript 语句语法合法
    assert.doesNotThrow(() => {
      new Function("page", `return ${pwQuote};`);
    });

    // Case 3: 空格 (action button)
    const elSpace = createMockElement({
      tagName: "button",
      attributes: { "data-testid": "action button" },
    });
    const locSpace = buildLocators(elSpace, "safe").find(
      (l) => l.kind === "testId"
    )!;
    const pwSpace = formatPlaywrightLocator(locSpace);
    // 验证：已正确反转义空格，生成干净的字面量
    assert.equal(pwSpace, 'page.getByTestId("action button")');
  });

  test("对抗 2.3：iframe 容器自身带有特殊字符（冒号、空格、引号）的选择器生成", () => {
    const frameWithColon = createMockElement({
      tagName: "iframe",
      id: "widget:frame",
    });
    assert.equal(getFrameSelector(frameWithColon), "iframe#widget\\:frame");

    const frameWithTestId = createMockElement({
      tagName: "iframe",
      attributes: { "data-testid": "sub:frame:1" },
    });
    assert.equal(
      getFrameSelector(frameWithTestId),
      'iframe[data-testid="sub\\:frame\\:1"]'
    );

    const frameWithName = createMockElement({
      tagName: "iframe",
      attributes: { name: 'my"special"frame' },
    });
    assert.equal(
      getFrameSelector(frameWithName),
      'iframe[name="my\\"special\\"frame"]'
    );

    // 验证作为穿透选择器拼装到 Playwright generator 中时是否合法
    const pw = formatPlaywrightLocator({
      kind: "id",
      expression: `${getFrameSelector(frameWithName)} >>> #confirm`,
    });
    assert.doesNotThrow(() => {
      new Function("page", `return ${pw};`);
    }, `转义后的 frameLocator 表达式必须是合法 JS 代码: ${pw}`);
  });

  test("对抗 2.4：Tailwind 特殊字符类名（hover:bg-blue-500, w-1/2, mt-2.5）在快照中的表现", () => {
    const doc: any = { defaultView: null, querySelectorAll: () => [] };
    const el = createMockElement({
      tagName: "div",
      className: "flex w-1/2 hover:bg-blue-500 mt-2.5 [color:red]",
      ownerDocument: doc,
    });

    const snapshot = buildDomSnapshot(el, "safe");
    assert.deepEqual(snapshot.element.classNames, [
      "flex",
      "w-1/2",
      "hover:bg-blue-500",
      "mt-2.5",
      "[color:red]",
    ]);

    const htmlRes = snapshotHtml(el);
    assert.ok(
      htmlRes.sanitizedHtml?.includes("hover:bg-blue-500"),
      "HTML 快照必须保留类名"
    );
    assert.ok(
      htmlRes.sanitizedHtml?.includes("w-1/2"),
      "HTML 快照必须保留含斜杠的类名"
    );
  });

  // ─────────────────────────────────────────────────────────────
  // 3. 动态销毁/脱离文档的 iframe 在快照与空间剪枝中的容错
  // ─────────────────────────────────────────────────────────────

  test("对抗 3.1：孤儿/已脱离文档的 iframe 调用 snapshotHtml 不报错且正确打标", () => {
    const detachedIframe = createMockElement({
      tagName: "iframe",
      id: "detached-frame",
      attributes: { src: "https://example.com/widget", srcdoc: "<b>bad</b>" },
      parentElement: null, // 未挂载或已被 remove
    });

    const res = snapshotHtml(detachedIframe);
    assert.ok(res.sanitizedHtml, "脱离文档的 iframe 应生成 HTML");
    assert.ok(
      res.sanitizedHtml.includes('data-bug-lens-frame="true"'),
      "应附带 frame 标识"
    );
    assert.ok(
      !res.sanitizedHtml.includes("srcdoc"),
      "敏感 srcdoc 必须已被清理"
    );
  });

  test("对抗 3.2：宿主 iframe 被动态销毁/置空后，子元素调用 buildDomSnapshot 优雅降级", () => {
    // 浏览器标准：脱离文档的 iframe 其 window.top === window, window.parent === window
    const detachedWin: any = {};
    detachedWin.top = detachedWin;
    detachedWin.parent = detachedWin;
    detachedWin.frameElement = null;

    const childDoc: any = {
      defaultView: detachedWin,
      querySelectorAll: () => [],
    };
    const orphanButton = createMockElement({
      tagName: "button",
      id: "orphan-btn",
      ownerDocument: childDoc,
      parentElement: null,
    });

    assert.doesNotThrow(() => {
      const snapshot = buildDomSnapshot(orphanButton, "safe");
      assert.ok(snapshot, "已脱离 iframe 的子元素生成快照不能抛出异常");
      assert.equal(snapshot.element.id, "orphan-btn");
      assert.equal(snapshot.frameSelector, undefined);
    });
  });

  test("对抗 3.3：SpatialPruner 面对 contentDocument 为 null 或抛出异常的 iframe 具备健壮容错", () => {
    const topWin: any = {};
    topWin.top = topWin;
    topWin.parent = topWin;

    // 模拟包含 3 种异常 iframe 的文档：
    // 1. contentDocument === null（已卸载 iframe）
    // 2. contentDocument 抛错（跨域/崩溃 iframe）
    // 3. 正常同源 iframe
    const hostDoc: any = {
      defaultView: topWin,
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: (sel: string) => {
        if (sel === "*") return [iframeNull, iframeThrow, iframeNormal];
        return [];
      },
    };

    const iframeNull = createMockElement({
      tagName: "iframe",
      id: "null-frame",
      bounds: { left: 0, top: 0, width: 200, height: 200 },
      ownerDocument: hostDoc,
      contentDocument: null,
    });

    const iframeThrow = createMockElement({
      tagName: "iframe",
      id: "throw-frame",
      bounds: { left: 0, top: 0, width: 200, height: 200 },
      ownerDocument: hostDoc,
    });
    Object.defineProperty(iframeThrow, "contentDocument", {
      get() {
        throw new Error("Simulated Document Access Failure");
      },
    });

    const normalDoc: any = {
      querySelectorAll: () => [normalBtn],
    };
    const normalBtn = createMockElement({
      tagName: "button",
      id: "ok-btn",
      bounds: { left: 10, top: 10, width: 50, height: 30 },
      ownerDocument: normalDoc,
    });
    const iframeNormal = createMockElement({
      tagName: "iframe",
      id: "normal-frame",
      bounds: { left: 0, top: 0, width: 200, height: 200 },
      ownerDocument: hostDoc,
      contentDocument: normalDoc,
    });

    (globalThis as any).window = topWin;
    (globalThis as any).document = hostDoc;

    const box: BoundingBox = { x: 0, y: 0, width: 300, height: 300 };

    assert.doesNotThrow(() => {
      const result = SpatialPruner.extractSpatialSnapshot(box, "safe");
      assert.ok(
        result.nodes.length >= 2,
        "遇到损坏 iframe 时不阻断正常 iframe 采集"
      );
    });
  });

  test("对抗 3.4【已修复】：Firefox 或脱离文档 iframe 中 getComputedStyle 返回 null 时安全降级不崩溃", () => {
    // 根据 W3C/MDN：在 Firefox 中，display:none iframe 或 detached iframe 内元素调用 getComputedStyle 会返回 null
    (globalThis as any).getComputedStyle = () => null;

    const btn = createMockElement({
      tagName: "button",
      id: "btn-style-null",
    });

    // 验证：buildDomSnapshot 进行非空防御，不抛出 TypeError，平稳返回默认空样式与非隐藏状态
    assert.doesNotThrow(() => {
      const snapshot = buildDomSnapshot(btn, "safe");
      assert.ok(snapshot, "快照应成功生成");
      assert.equal(snapshot.element.id, "btn-style-null");
      assert.equal(snapshot.state.hidden, false);
      assert.deepEqual(snapshot.computedStyle, {});
    });
  });

  test("对抗 3.5：detached window (parent === null) 调用 getFrameSelectorChain 防御性退出返回空数组", () => {
    const detachedWin: any = {
      top: null,
      parent: null,
      name: "orphan-frame",
    };
    const chain = getFrameSelectorChain(detachedWin);
    assert.deepEqual(
      chain,
      [],
      "脱离文档无 parent 的 window 不应误判为 iframe"
    );
  });

  // ─────────────────────────────────────────────────────────────
  // 4. 端到端 Playwright 脚本生成可解析性压力测试
  // ─────────────────────────────────────────────────────────────

  test("对抗 4.1：极端复杂会话（包含多层嵌套 iframe + 特殊字符）生成的 Playwright 代码是合法 TypeScript/JavaScript", () => {
    const session: RecordingSession = {
      id: "stress-session-001",
      createdAt: 1700000000000,
      target: {
        initialUrl: 'https://example.com/app?tab=1&name="test"&path=a\\b',
      },
      options: { privacyMode: "safe" },
      timeline: {
        createdAtEpochMs: 1700000000000,
        startedAtEpochMs: 1700000000000,
      },
      stats: { interactionCount: 3, durationMs: 5000 },
    };

    const interactions: InteractionRecord[] = [
      {
        id: "step-1",
        sessionId: "stress-session-001",
        kind: "click",
        createdAt: 1700000001000,
        coordinates: {
          clientX: 100,
          clientY: 200,
          pageX: 100,
          pageY: 200,
          scrollX: 0,
          scrollY: 0,
          devicePixelRatio: 1,
          viewport: { width: 1280, height: 800 },
        },
        element: {
          tagName: "button",
          id: "action:save:confirm",
          classNames: ["btn", "hover:bg-blue-600"],
          attributes: { "data-testid": 'modal"submit"btn' },
          text: 'Confirm & "Proceed" \\ OK',
          boundingBox: { x: 100, y: 200, width: 120, height: 40 },
          locators: [
            {
              kind: "id",
              expression:
                'iframe#outer\\:frame >>> iframe[name="inner\\"frame"] >>> #action\\:save\\:confirm',
              matchCount: 1,
              stabilityScore: 0.95,
              reasons: ["穿越双层特殊字符 iframe"],
            },
          ],
        },
      },
      {
        id: "step-2",
        sessionId: "stress-session-001",
        kind: "input",
        createdAt: 1700000002000,
        coordinates: {
          clientX: 100,
          clientY: 250,
          pageX: 100,
          pageY: 250,
          scrollX: 0,
          scrollY: 0,
          devicePixelRatio: 1,
          viewport: { width: 1280, height: 800 },
        },
        metadata: {
          value: 'Text with `backticks`, "quotes", and $variables\nNewline',
        },
        element: {
          tagName: "input",
          id: "user name input",
          classNames: ["input"],
          attributes: {},
          boundingBox: { x: 100, y: 250, width: 200, height: 30 },
          locators: [
            {
              kind: "id",
              expression: "iframe#sub-frame >>> #user\\ name\\ input",
              matchCount: 1,
              stabilityScore: 0.9,
              reasons: ["带空格 ID"],
            },
          ],
        },
      },
    ];

    const script = generatePlaywrightScript({
      session,
      interactions,
      consoleEntries: [
        {
          id: "c1",
          level: "error",
          message: 'Uncaught Error: "fail"',
          timestamp: 1700000003000,
        } as any,
      ],
      networkEntries: [],
    });

    assert.ok(script.includes("Bug Lens — Playwright reproduction script"));
    assert.ok(script.includes("frameLocator"));

    // 生成的脚本本身是标准 TypeScript (.spec.ts)
    // 经 ts.transpileModule 编译为纯 JS，验证零语法诊断错误
    const transpiled = ts.transpileModule(script, {
      compilerOptions: { module: ts.ModuleKind.ESNext },
      reportDiagnostics: true,
    });
    assert.deepEqual(
      transpiled.diagnostics,
      [],
      "生成的 TypeScript 脚本编译诊断必须为 0 错误"
    );

    // 剥离 import 语句后在 Node vm.Script 中验证可解析性
    const executableScript = transpiled.outputText.replace(
      /import\s+.*?;/g,
      "// import stripped"
    );
    assert.doesNotThrow(() => {
      new vm.Script(executableScript);
    }, "编译为 JS 后的 Playwright 脚本在语法引擎中必须是严格合法的 JavaScript");
  });
});
