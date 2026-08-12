import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  collectSpatialDomTree,
  calculateNodeSemanticScore,
  detectErrorSignal,
  checkElementExposure,
  extractSelectState,
} from "../src/screenshot/dom-spatial-collector.ts";

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
    childNodes: text ? [{ nodeType: 3, textContent: text }] : [],
    children: [],
    parentElement: parent,
    shadowRoot: null,
    attributes: [],
    getAttribute: () => null,
    hasAttribute: () => false,
    contains: (other: any) => other === el,
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

describe("dom-spatial-collector 物理遮挡与曝光判定", () => {
  test("框外物理剪枝恒生效，高保真模式下框内长文本全量保留", async () => {
    const mockRoot = createMockElement("DIV", "", {
      left: 0,
      top: 0,
      width: 1000,
      height: 1000,
    });

    const longText =
      "这是一段极其漫长且非常非常长的框内测试文本，用来严格验证在标准模式下文本是否会被 60 字符硬截断策略所裁剪，而在高保真模式下该长文本能够被 100% 完整无损保留。";
    const insideEl = createMockElement(
      "BUTTON",
      longText,
      { left: 10, top: 10, width: 40, height: 40 },
      mockRoot
    );

    const outsideEl = createMockElement(
      "BUTTON",
      "选区外无关元素",
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

    // 1. 验证框外元素在两种模式下均被严格剪枝排除
    assert.equal(
      treeStandard.leaves.some((l) => l.innerText?.includes("选区外")),
      false,
      "标准模式剔除框外节点"
    );
    assert.equal(
      treeFull.leaves.some((l) => l.innerText?.includes("选区外")),
      false,
      "高保真模式依然严格剔除框外节点"
    );

    // 2. 验证框内长文本在标准模式下被截断，在高保真模式下无损保留
    const standardLeaf = treeStandard.leaves[0];
    const fullLeaf = treeFull.leaves[0];

    assert.ok(standardLeaf.innerText?.endsWith("..."), "标准模式截断为 ...");
    assert.equal(fullLeaf.innerText, longText, "高保真模式无损保留完整字串");
  });

  test("标准模式与高保真模式下，智能收集 input、img 属性文本与可见性字段", async () => {
    const mockRoot = createMockElement("DIV", "", {
      left: 0,
      top: 0,
      width: 1000,
      height: 1000,
    });

    const inputEl = createMockElement(
      "INPUT",
      "",
      { left: 10, top: 10, width: 40, height: 20 },
      mockRoot
    );
    inputEl.value = "用户输入的测试值";

    const imgEl = createMockElement(
      "IMG",
      "",
      { left: 60, top: 10, width: 30, height: 30 },
      mockRoot
    );
    imgEl.getAttribute = (attr: string) => (attr === "alt" ? "用户头像" : null);

    mockRoot.children = [inputEl, imgEl];
    mockRoot.querySelectorAll = () => [inputEl, imgEl];

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

    assert.ok(
      treeStandard.leaves.some((l) => l.innerText === "用户输入的测试值"),
      "标准模式由于智能打分与属性感知，成功保留 INPUT 节点"
    );
    assert.equal(
      treeFull.leaves.length,
      2,
      "高保真模式下跳过 hasOwnText，直接收集框内所有 candidate 节点"
    );
    assert.equal(treeFull.leaves[0].visibility, "visible");
    assert.equal(treeFull.leaves[0].exposure, "exposed");
  });

  test("detectErrorSignal 与 calculateNodeSemanticScore 计算准确度", () => {
    const errEl = createMockElement("DIV", "密码错误", {
      left: 0,
      top: 0,
      width: 100,
      height: 20,
    });
    errEl.className = "input-error-msg";

    assert.equal(detectErrorSignal(errEl), true, "识别 error-msg 为错误信号");
    const score = calculateNodeSemanticScore(errEl);
    assert.ok(score >= 15, "包含错误特征的节点获得高强加分");
  });

  test("checkElementExposure 视口露出与上层遮挡检测", () => {
    const baseEl = createMockElement("BUTTON", "底层按钮", {
      left: 10,
      top: 10,
      width: 100,
      height: 30,
    });

    const overlayEl = createMockElement("DIV", "遮罩层", {
      left: 0,
      top: 0,
      width: 500,
      height: 500,
    });
    overlayEl.className = "modal-mask";

    // 模拟 document.elementFromPoint
    const origDoc = (globalThis as any).document;
    (globalThis as any).document = {
      ...(origDoc || {}),
      elementFromPoint: (x: number, y: number) => {
        if (x >= 0 && x <= 500 && y >= 0 && y <= 500) {
          return overlayEl;
        }
        return null;
      },
    };

    try {
      const expResult = checkElementExposure(baseEl);
      assert.equal(expResult.exposure, "obscured");
      assert.ok(expResult.obscuredBy?.includes("modal-mask"));
    } finally {
      (globalThis as any).document = origDoc;
    }
  });

  test("extractSelectState 提取 <select> 的 options 选中/未选中列表", () => {
    const selectEl = createMockElement("SELECT", "", {
      left: 10,
      top: 10,
      width: 100,
      height: 30,
    });
    selectEl.selectedIndex = 1;

    const opt1 = { value: "bj", text: "北京", selected: false };
    const opt2 = { value: "sh", text: "上海", selected: true };
    const opt3 = { value: "gz", text: "广州", selected: false, disabled: true };

    selectEl.options = [opt1, opt2, opt3];

    const state = extractSelectState(selectEl);
    assert.ok(state);
    assert.equal(state.selectedIndex, 1);
    assert.equal(state.options.length, 3);
    assert.equal(state.options[0].selected, false);
    assert.equal(state.options[1].selected, true);
    assert.equal(state.options[2].disabled, true);
  });
});
