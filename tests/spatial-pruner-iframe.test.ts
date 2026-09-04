import assert from "node:assert/strict";
import test, { describe, beforeEach, afterEach } from "node:test";
import {
  SpatialPruner,
  type BoundingBox,
} from "../src/entrypoints/content/collector/spatial-pruner.ts";

class MockElement {}
class MockHTMLElement extends MockElement {}
class MockHTMLIFrameElement extends MockHTMLElement {}
class MockHTMLButtonElement extends MockHTMLElement {}

function createMockPrunerElement(opts: {
  tagName: string;
  id?: string;
  bounds: { left: number; top: number; width: number; height: number };
  ownerDocument?: any;
  contentDocument?: any;
}): any {
  const attrs = new Map<string, string>();
  if (opts.id) attrs.set("id", opts.id);

  const node: any = {
    tagName: opts.tagName.toUpperCase(),
    id: opts.id || "",
    classList: [],
    attributes: opts.id ? [{ name: "id", value: opts.id }] : [],
    getAttribute: (name: string) => attrs.get(name) || null,
    hasAttribute: (name: string) => attrs.has(name),
    setAttribute: (name: string, val: string) => attrs.set(name, val),
    removeAttribute: (name: string) => attrs.delete(name),
    getRootNode: () => node.ownerDocument || node,
    getBoundingClientRect: () => ({
      x: opts.bounds.left,
      y: opts.bounds.top,
      left: opts.bounds.left,
      top: opts.bounds.top,
      width: opts.bounds.width,
      height: opts.bounds.height,
      right: opts.bounds.left + opts.bounds.width,
      bottom: opts.bounds.top + opts.bounds.height,
    }),
    querySelectorAll: () => [],
    cloneNode: () =>
      createMockPrunerElement({
        tagName: opts.tagName,
        id: opts.id,
        bounds: opts.bounds,
      }),
    outerHTML: `<${opts.tagName.toLowerCase()}${opts.id ? ` id="${opts.id}"` : ""}></${opts.tagName.toLowerCase()}>`,
  };

  const tag = opts.tagName.toLowerCase();
  if (tag === "iframe") {
    Object.setPrototypeOf(node, MockHTMLIFrameElement.prototype);
    if (opts.contentDocument !== undefined) {
      node.contentDocument = opts.contentDocument;
    }
  } else if (tag === "button") {
    Object.setPrototypeOf(node, MockHTMLButtonElement.prototype);
  } else {
    Object.setPrototypeOf(node, MockHTMLElement.prototype);
  }

  node.ownerDocument = opts.ownerDocument;
  return node;
}

describe("R4: 空间剪枝穿透同源 iframe 与跨域安全降级 (tests/spatial-pruner-iframe.test.ts)", () => {
  let originalWindow: any;
  let originalDocument: any;
  let originalElement: any;
  let originalHTMLElement: any;
  let originalHTMLIFrameElement: any;
  let originalHTMLButtonElement: any;
  let originalGetComputedStyle: any;

  beforeEach(() => {
    originalWindow = (globalThis as any).window;
    originalDocument = (globalThis as any).document;
    originalElement = (globalThis as any).Element;
    originalHTMLElement = (globalThis as any).HTMLElement;
    originalHTMLIFrameElement = (globalThis as any).HTMLIFrameElement;
    originalHTMLButtonElement = (globalThis as any).HTMLButtonElement;
    originalGetComputedStyle = (globalThis as any).getComputedStyle;

    (globalThis as any).Element = MockElement;
    (globalThis as any).HTMLElement = MockHTMLElement;
    (globalThis as any).HTMLIFrameElement = MockHTMLIFrameElement;
    (globalThis as any).HTMLButtonElement = MockHTMLButtonElement;
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
    (globalThis as any).HTMLButtonElement = originalHTMLButtonElement;
    (globalThis as any).getComputedStyle = originalGetComputedStyle;
  });

  test("用例 1：空间剪枝检测并穿透同源 iframe 提取内部节点与定位器", () => {
    const topWin: any = {};
    topWin.top = topWin;
    topWin.parent = topWin;

    const hostDoc: any = {
      defaultView: topWin,
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: (sel: string) => {
        if (sel === "*") return [iframeEl];
        return [];
      },
    };

    const childWin: any = {
      top: topWin,
      parent: topWin,
    };

    const childDoc: any = {
      defaultView: childWin,
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: (sel: string) => {
        if (sel === "*") return [buttonEl];
        return [];
      },
    };

    const iframeEl = createMockPrunerElement({
      tagName: "iframe",
      id: "app-frame",
      bounds: { left: 100, top: 100, width: 400, height: 300 },
      ownerDocument: hostDoc,
      contentDocument: childDoc,
    });
    childWin.frameElement = iframeEl;

    const buttonEl = createMockPrunerElement({
      tagName: "button",
      id: "inner-btn",
      bounds: { left: 20, top: 20, width: 100, height: 40 },
      ownerDocument: childDoc,
    });

    (globalThis as any).window = topWin;
    (globalThis as any).document = hostDoc;

    const box: BoundingBox = { x: 100, y: 100, width: 200, height: 200 };
    const result = SpatialPruner.extractSpatialSnapshot(box, "safe");

    assert.ok(result.nodes.length >= 2, "应同时包含 iframe 容器及内部按钮");
    const btnNode = result.nodes.find((n) => n.element.tagName === "button");
    assert.ok(btnNode, "nodes 列表中必须包含内部 button 节点");
    assert.ok(
      btnNode.element.locators.some((l) => l.expression.includes(">>>")),
      "内部 button 的定位器应具有 >>> 穿透表达式"
    );
    assert.ok(
      btnNode.element.locators[0].expression.startsWith(
        "iframe#app-frame >>> "
      ),
      `首选定位器应以 iframe#app-frame >>> 开头，实际为: ${btnNode.element.locators[0].expression}`
    );
  });

  test("用例 2：跨域 iframe 访问异常时不崩溃并优雅降级", () => {
    const topWin: any = {};
    topWin.top = topWin;
    topWin.parent = topWin;

    const hostDoc: any = {
      defaultView: topWin,
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: (sel: string) => {
        if (sel === "*") return [crossIframe];
        return [];
      },
    };

    const crossIframe = createMockPrunerElement({
      tagName: "iframe",
      id: "cross-origin-frame",
      bounds: { left: 50, top: 50, width: 300, height: 200 },
      ownerDocument: hostDoc,
    });

    // 模拟跨域读取 contentDocument 抛出 DOMException
    Object.defineProperty(crossIframe, "contentDocument", {
      get() {
        throw new Error(
          "DOMException: Blocked a frame with origin from accessing a cross-origin frame."
        );
      },
    });

    (globalThis as any).window = topWin;
    (globalThis as any).document = hostDoc;

    const box: BoundingBox = { x: 0, y: 0, width: 400, height: 300 };

    assert.doesNotThrow(() => {
      const result = SpatialPruner.extractSpatialSnapshot(box, "safe");
      assert.ok(result, "空间剪枝应正常返回结果");
      const iframeNode = result.nodes.find(
        (n) => n.element.tagName === "iframe"
      );
      assert.ok(iframeNode, "应安全保留 iframe 容器本身的快照");
    });
  });
});
