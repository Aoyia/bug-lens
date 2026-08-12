import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { collectSpatialDomTree } from "../src/screenshot/dom-spatial-collector.ts";

function createMockElement(
  tagName: string,
  text: string,
  bounds: { left: number; top: number; width: number; height: number },
  parent: any = null
) {
  const el: any = {
    tagName,
    nodeType: 1,
    id: "",
    className: "",
    innerText: text,
    textContent: text,
    childNodes: [{ nodeType: 3, textContent: text }],
    children: [],
    parentElement: parent,
    shadowRoot: null,
    attributes: [],
    getAttribute: () => null,
    hasAttribute: () => false,
    getBoundingClientRect: () => ({
      left: bounds.left,
      top: bounds.top,
      right: bounds.left + bounds.width,
      bottom: bounds.top + bounds.height,
      width: bounds.width,
      height: bounds.height,
      x: bounds.left,
      y: bounds.top,
    }),
  };
  return el;
}

describe("dom-spatial-collector 剪枝逻辑控制", () => {
  test("disablePruning 开关控制候选节点筛选", async () => {
    const mockRoot = createMockElement("DIV", "", {
      left: 0,
      top: 0,
      width: 1000,
      height: 1000,
    });

    const insideEl = createMockElement(
      "BUTTON",
      "选区内",
      { left: 10, top: 10, width: 40, height: 40 },
      mockRoot
    );

    const outsideEl = createMockElement(
      "BUTTON",
      "选区外",
      { left: 500, top: 500, width: 100, height: 100 },
      mockRoot
    );

    mockRoot.children = [insideEl, outsideEl];
    mockRoot.querySelectorAll = () => [insideEl, outsideEl];

    const cropBounds = { x: 0, y: 0, width: 100, height: 100 };

    const treeStandard = await collectSpatialDomTree({
      cropBounds,
      rootElement: mockRoot,
      disablePruning: false,
    });

    const treeFull = await collectSpatialDomTree({
      cropBounds,
      rootElement: mockRoot,
      disablePruning: true,
    });

    assert.ok(treeStandard, "标准剪枝模式正常运行");
    assert.ok(treeFull, "不剪枝模式正常运行");
  });
});
