import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  collectSpatialDomTree,
  detectComponentPath,
  detectFrameworkComponentName,
  pruneAncestorElements,
  findSmallestCommonAncestor,
  buildSelectorPath,
  buildCssSelector,
} from "../src/screenshot/probes/dom-spatial-collector";
import { runMainWorldFrameworkProbe } from "../src/screenshot/probes/main-world-probe";

function createMockElement(
  tagName: string,
  text: string,
  bounds: { left: number; top: number; width: number; height: number },
  parent: any = null,
  id = "",
  className = ""
) {
  const el: any = {
    tagName,
    nodeType: 1,
    id,
    className,
    innerText: text,
    textContent: text,
    childNodes: text ? [{ nodeType: 3, textContent: text }] : [],
    children: [],
    parentElement: parent,
    shadowRoot: null,
    attributes: [],
    getAttribute: (attr: string) => (attr === "id" ? id : null),
    hasAttribute: (attr: string) => attr === "id" && !!id,
    contains: (other: any) => {
      let curr = other;
      while (curr) {
        if (curr === el) return true;
        curr = curr.parentElement;
      }
      return false;
    },
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

describe("Adversarial Challenge 1: Single-child tree collapse (Wrapper Node Collapse)", () => {
  test("1.1 带有 componentFile 的单子节点严禁被折叠裁剪", async () => {
    const root = createMockElement(
      "DIV",
      "",
      { left: 0, top: 0, width: 500, height: 500 },
      null,
      "app-root"
    );
    const middleWrapper = createMockElement(
      "SECTION",
      "",
      { left: 10, top: 10, width: 200, height: 100 },
      root,
      "sec-wrapper"
    );
    const leafBtn = createMockElement(
      "BUTTON",
      "点击操作",
      { left: 20, top: 20, width: 80, height: 40 },
      middleWrapper,
      "btn-action"
    );
    const sibling = createMockElement(
      "BUTTON",
      "旁支按钮",
      { left: 300, top: 20, width: 80, height: 40 },
      root,
      "btn-sibling"
    );

    root.children = [middleWrapper, sibling];
    middleWrapper.children = [leafBtn];
    root.querySelectorAll = () => [middleWrapper, leafBtn, sibling];

    const probeMap = new Map();
    // middleWrapper 具有 componentFile，但没有 props / data
    probeMap.set(middleWrapper, {
      framework: "vue",
      version: 3,
      componentName: "SectionWrapper",
      componentPath: ["App", "SectionWrapper"],
      componentFile: "src/components/SectionWrapper.vue",
    });

    probeMap.set(leafBtn, {
      framework: "vue",
      version: 3,
      componentName: "ActionButton",
      componentPath: ["App", "SectionWrapper", "ActionButton"],
      componentFile: "src/components/ActionButton.vue",
    });

    const cropBounds = { x: 0, y: 0, width: 500, height: 500 };
    const result = await collectSpatialDomTree({
      cropBounds,
      rootElement: root,
      disablePruning: true,
      probeFramework: async () => probeMap,
    });

    const findNodeByComp = (node: any, name: string): any => {
      if (node.componentName === name) return node;
      if (node.children) {
        for (const c of node.children) {
          const res = findNodeByComp(c, name);
          if (res) return res;
        }
      }
      return null;
    };

    const wrapperNode = findNodeByComp(result.tree, "SectionWrapper");
    assert.ok(
      wrapperNode,
      "SectionWrapper 节点必须在 DOM 树中保留，不得被折叠剔除！"
    );
    assert.equal(
      wrapperNode.componentFile,
      "src/components/SectionWrapper.vue"
    );
    assert.equal(wrapperNode.selector, "#sec-wrapper");
    assert.equal(wrapperNode.children?.length, 1);
    assert.equal(wrapperNode.children?.[0].componentName, "ActionButton");
  });

  test("1.2 带有 props 的单子节点严禁被折叠裁剪", async () => {
    const root = createMockElement(
      "DIV",
      "",
      { left: 0, top: 0, width: 500, height: 500 },
      null,
      "app-root"
    );
    const middleWrapper = createMockElement(
      "DIV",
      "",
      { left: 10, top: 10, width: 200, height: 100 },
      root,
      "themed-wrapper"
    );
    const leafBtn = createMockElement(
      "BUTTON",
      "确认",
      { left: 20, top: 20, width: 80, height: 40 },
      middleWrapper,
      "btn-confirm"
    );
    const sibling = createMockElement(
      "BUTTON",
      "旁支按钮",
      { left: 300, top: 20, width: 80, height: 40 },
      root,
      "btn-sibling"
    );

    root.children = [middleWrapper, sibling];
    middleWrapper.children = [leafBtn];
    root.querySelectorAll = () => [middleWrapper, leafBtn, sibling];

    const probeMap = new Map();
    // middleWrapper 只有 props，无 componentFile / data
    probeMap.set(middleWrapper, {
      framework: "react",
      version: 18,
      componentName: "ThemedBox",
      componentPath: ["App", "ThemedBox"],
      props: { theme: "dark", elevation: 2 },
    });

    const cropBounds = { x: 0, y: 0, width: 500, height: 500 };
    const result = await collectSpatialDomTree({
      cropBounds,
      rootElement: root,
      disablePruning: true,
      probeFramework: async () => probeMap,
    });

    const findNodeBySelector = (node: any, sel: string): any => {
      if (node.selector === sel) return node;
      if (node.children) {
        for (const c of node.children) {
          const res = findNodeBySelector(c, sel);
          if (res) return res;
        }
      }
      return null;
    };

    const wrapperNode = findNodeBySelector(result.tree, "#themed-wrapper");
    assert.ok(wrapperNode, "#themed-wrapper 带有 props，必须保留在 DOM 树中！");
    assert.deepEqual(wrapperNode.props, { theme: "dark", elevation: 2 });
    assert.equal(wrapperNode.componentName, "ThemedBox");
  });

  test("1.3 带有 data (state) 的单子节点严禁被折叠裁剪", async () => {
    const root = createMockElement(
      "DIV",
      "",
      { left: 0, top: 0, width: 500, height: 500 },
      null,
      "app-root"
    );
    const middleWrapper = createMockElement(
      "DIV",
      "",
      { left: 10, top: 10, width: 200, height: 100 },
      root,
      "stateful-wrapper"
    );
    const leafBtn = createMockElement(
      "BUTTON",
      "保存",
      { left: 20, top: 20, width: 80, height: 40 },
      middleWrapper,
      "btn-save"
    );
    const sibling = createMockElement(
      "BUTTON",
      "旁支按钮",
      { left: 300, top: 20, width: 80, height: 40 },
      root,
      "btn-sibling"
    );

    root.children = [middleWrapper, sibling];
    middleWrapper.children = [leafBtn];
    root.querySelectorAll = () => [middleWrapper, leafBtn, sibling];

    const probeMap = new Map();
    // middleWrapper 只有 data，无 componentFile / props
    probeMap.set(middleWrapper, {
      framework: "vue",
      version: 3,
      componentName: "StatefulContainer",
      componentPath: ["App", "StatefulContainer"],
      data: { isSubmitting: false, retryCount: 1 },
    });

    const cropBounds = { x: 0, y: 0, width: 500, height: 500 };
    const result = await collectSpatialDomTree({
      cropBounds,
      rootElement: root,
      disablePruning: true,
      probeFramework: async () => probeMap,
    });

    const findNodeByComp = (node: any, name: string): any => {
      if (node.componentName === name) return node;
      if (node.children) {
        for (const c of node.children) {
          const res = findNodeByComp(c, name);
          if (res) return res;
        }
      }
      return null;
    };

    const wrapperNode = findNodeByComp(result.tree, "StatefulContainer");
    assert.ok(wrapperNode, "StatefulContainer 带有 data，严禁被折叠！");
    assert.deepEqual(wrapperNode.data, { isSubmitting: false, retryCount: 1 });
  });

  test("1.4 实证边界发现：若单子节点仅有 componentLine (无 componentFile / props / data / 新 componentPath)，节点将被折叠", async () => {
    const root = createMockElement(
      "DIV",
      "",
      { left: 0, top: 0, width: 500, height: 500 },
      null,
      "app-root"
    );
    const lineOnlyWrapper = createMockElement(
      "DIV",
      "",
      { left: 10, top: 10, width: 200, height: 100 },
      root,
      "line-wrapper"
    );
    const leafBtn = createMockElement(
      "BUTTON",
      "提交",
      { left: 20, top: 20, width: 80, height: 40 },
      lineOnlyWrapper,
      "btn-sub"
    );
    const sibling = createMockElement(
      "BUTTON",
      "旁支按钮",
      { left: 300, top: 20, width: 80, height: 40 },
      root,
      "btn-sibling"
    );

    root.children = [lineOnlyWrapper, sibling];
    lineOnlyWrapper.children = [leafBtn];
    root.querySelectorAll = () => [lineOnlyWrapper, leafBtn, sibling];

    const probeMap = new Map();
    // lineOnlyWrapper 仅有 componentLine
    probeMap.set(lineOnlyWrapper, {
      framework: "react",
      version: 18,
      componentLine: 42,
    });

    const cropBounds = { x: 0, y: 0, width: 500, height: 500 };
    const result = await collectSpatialDomTree({
      cropBounds,
      rootElement: root,
      disablePruning: true,
      probeFramework: async () => probeMap,
    });

    const leafNode = result.tree?.children?.find(
      (c) => c.selector === "#btn-sub"
    );
    assert.ok(leafNode);
    // 实证断言：因为 isWrapperCandidate 未检查 componentLine，该节点被折叠进 collapsedWrappers
    assert.ok(
      leafNode.collapsedWrappers?.includes("#line-wrapper"),
      "实证观察：单子节点若仅存在 componentLine，会被当成 wrapper 折叠进子节点"
    );
  });

  test("1.5 无语义纯布局 wrapper 节点（无状态、无源码、单子）能够正确折叠进子节点的 collapsedWrappers", async () => {
    const root = createMockElement(
      "DIV",
      "",
      { left: 0, top: 0, width: 500, height: 500 },
      null,
      "app-root"
    );
    const pureLayoutDiv = createMockElement(
      "DIV",
      "",
      { left: 10, top: 10, width: 200, height: 100 },
      root,
      "pure-layout-wrapper"
    );
    const leafBtn = createMockElement(
      "BUTTON",
      "提交",
      { left: 20, top: 20, width: 80, height: 40 },
      pureLayoutDiv,
      "btn-leaf"
    );
    const sibling = createMockElement(
      "BUTTON",
      "旁支按钮",
      { left: 300, top: 20, width: 80, height: 40 },
      root,
      "btn-sibling"
    );

    root.children = [pureLayoutDiv, sibling];
    pureLayoutDiv.children = [leafBtn];
    root.querySelectorAll = () => [pureLayoutDiv, leafBtn, sibling];

    const cropBounds = { x: 0, y: 0, width: 500, height: 500 };
    const result = await collectSpatialDomTree({
      cropBounds,
      rootElement: root,
      disablePruning: true,
    });

    // 纯布局 div 没有组件信息、没有文本、只有一个子节点，且非 SCA，应当被折叠
    const directChild = result.tree?.children?.find(
      (c) => c.selector === "#btn-leaf"
    );
    assert.ok(directChild);
    assert.ok(
      directChild.collapsedWrappers?.includes("#pure-layout-wrapper"),
      "纯布局 wrapper 必须被收纳进 collapsedWrappers"
    );
  });
});

describe("Adversarial Challenge 2: Vue 3 setupState vs instance.data 优先级与混合 API 探测", () => {
  const fakeProbeEl = (id: string, expando: any) => ({
    getAttribute: (name: string) =>
      name === "data-bug-lens-probe-id" ? id : null,
    ...expando,
  });

  test("2.1 纯 Vue 3 <script setup> (setupState 存在且包含 Ref，instance.data 为 reactive({}))", () => {
    const el = fakeProbeEl("probe-vue3-pure-setup", {
      __vueParentComponent$: {
        type: { __name: "SetupComp", __file: "src/views/SetupComp.vue" },
        setupState: {
          count: { __v_isRef: true, value: 42 },
          name: "BugLens",
          __v_isReadonly: false,
        },
        data: {}, // Vue 3 空响应式对象
        parent: null,
      },
    });

    const savedDoc = (globalThis as any).document;
    (globalThis as any).document = { querySelectorAll: () => [el] };
    try {
      const res = runMainWorldFrameworkProbe(["probe-vue3-pure-setup"])[
        "probe-vue3-pure-setup"
      ];
      assert.ok(res);
      assert.equal(res.componentName, "SetupComp");
      assert.equal(res.componentFile, "src/views/SetupComp.vue");
      assert.deepEqual(res.data, { count: 42, name: "BugLens" });
    } finally {
      (globalThis as any).document = savedDoc;
    }
  });

  test("2.2 纯 Options API (setupState 为空/未定义，instance.data 包含业务数据)", () => {
    const el = fakeProbeEl("probe-vue3-pure-options", {
      __vueParentComponent$: {
        type: { name: "OptionsComp", __file: "src/views/OptionsComp.vue" },
        setupState: {},
        data: { message: "Options Hello", count: 99 },
        parent: null,
      },
    });

    const savedDoc = (globalThis as any).document;
    (globalThis as any).document = { querySelectorAll: () => [el] };
    try {
      const res = runMainWorldFrameworkProbe(["probe-vue3-pure-options"])[
        "probe-vue3-pure-options"
      ];
      assert.ok(res);
      assert.equal(res.componentName, "OptionsComp");
      assert.deepEqual(res.data, { message: "Options Hello", count: 99 });
    } finally {
      (globalThis as any).document = savedDoc;
    }
  });

  test("2.3 混合模式实证挑战：setupState 与 instance.data 同时存在非空字段时的行为探测", () => {
    const el = fakeProbeEl("probe-vue3-mixed", {
      __vueParentComponent$: {
        type: { __name: "MixedComp", __file: "src/views/MixedComp.vue" },
        setupState: {
          setupField: "from_setup",
          conflictField: "setup_priority",
        },
        data: {
          optionsField: "from_options",
          conflictField: "options_fallback",
        },
        parent: null,
      },
    });

    const savedDoc = (globalThis as any).document;
    (globalThis as any).document = { querySelectorAll: () => [el] };
    try {
      const res = runMainWorldFrameworkProbe(["probe-vue3-mixed"])[
        "probe-vue3-mixed"
      ];
      assert.ok(res);
      assert.ok(res.data);
      // 检查 setupState 是否保留
      assert.equal(res.data.setupField, "from_setup");
      assert.equal(res.data.conflictField, "setup_priority");

      // 实证记录：optionsField 是否被保留或被遮蔽
      const optionsFieldRetained = "optionsField" in res.data;
      // 在当前实现中，由于 if (!rawData && vnodeOrVm.data) 逻辑，optionsField 被 setupState 独占遮蔽
      assert.equal(
        optionsFieldRetained,
        false,
        "实证确认：当前实现中 setupState 存在时独占生效，options API 字段未执行并集融合"
      );
    } finally {
      (globalThis as any).document = savedDoc;
    }
  });

  test("2.4 setupState 内部携带函数、组件对象与敏感字段时的脱敏与防爆验证", () => {
    const el = fakeProbeEl("probe-vue3-sanitize", {
      __vueParentComponent$: {
        type: { __name: "SanitizeComp", __file: "src/views/SanitizeComp.vue" },
        setupState: {
          apiKey: "my-secret-key-12345",
          userToken: "jwt-token-val",
          increment: () => {},
          childComp: { name: "ChildComp", setup: () => {} },
          normalNumber: 123,
        },
        data: {},
        parent: null,
      },
    });

    const savedDoc = (globalThis as any).document;
    (globalThis as any).document = { querySelectorAll: () => [el] };
    try {
      const res = runMainWorldFrameworkProbe(["probe-vue3-sanitize"])[
        "probe-vue3-sanitize"
      ];
      assert.ok(res);
      assert.ok(res.data);
      assert.equal(res.data.apiKey, "[REDACTED_SENSITIVE_KEY]");
      assert.equal(res.data.userToken, "[REDACTED_SENSITIVE_KEY]");
      assert.equal(res.data.increment, "[Function]");
      assert.equal(res.data.normalNumber, 123);
    } finally {
      (globalThis as any).document = savedDoc;
    }
  });
});

describe("Adversarial Challenge 3: 空间锚点 (anchors)、叶子 (leaves)、祖先 (ancestors) 数据挂载一致性", () => {
  test("3.1 标注命中元素入选 anchors，且与 leaves 严格互斥", async () => {
    const root = createMockElement(
      "DIV",
      "",
      { left: 0, top: 0, width: 800, height: 800 },
      null,
      "app-root"
    );
    const anchorBtn = createMockElement(
      "BUTTON",
      "红色标注重点按钮",
      { left: 50, top: 50, width: 100, height: 40 },
      root,
      "anchor-btn"
    );
    const regularLeaf = createMockElement(
      "SPAN",
      "常规叶子文本",
      { left: 200, top: 50, width: 120, height: 30 },
      root,
      "leaf-span"
    );

    root.children = [anchorBtn, regularLeaf];
    root.contains = (o: any) =>
      o === root || o === anchorBtn || o === regularLeaf;
    root.querySelectorAll = () => [anchorBtn, regularLeaf];

    const cropBounds = { x: 0, y: 0, width: 800, height: 800 };
    const annotations: any[] = [
      {
        id: "ann-rect-1",
        type: "rect",
        bounds: { x: 50, y: 50, width: 100, height: 40 },
      },
    ];

    const probeMap = new Map();
    probeMap.set(anchorBtn, {
      framework: "react",
      version: 18,
      componentName: "AnchorBtn",
      componentFile: "src/components/AnchorBtn.tsx",
      componentLine: 10,
    });
    probeMap.set(regularLeaf, {
      framework: "react",
      version: 18,
      componentName: "LeafSpan",
      componentFile: "src/components/LeafSpan.tsx",
      componentLine: 20,
    });

    const result = await collectSpatialDomTree({
      cropBounds,
      rootElement: root,
      annotations,
      disablePruning: true,
      probeFramework: async () => probeMap,
    });

    // 验证 anchors 与 leaves 互斥性
    assert.equal(result.anchors.length, 1);
    assert.equal(result.anchors[0].selector, "#anchor-btn");
    assert.equal(
      result.anchors[0].componentFile,
      "src/components/AnchorBtn.tsx"
    );
    assert.equal(result.anchors[0].componentLine, 10);
    assert.equal(result.anchors[0].intentFlags.isHighlightedFocus, true);

    assert.equal(result.leaves.length, 1);
    assert.equal(result.leaves[0].selector, "#leaf-span");
    assert.equal(result.leaves[0].componentFile, "src/components/LeafSpan.tsx");
    assert.equal(result.leaves[0].componentLine, 20);

    const anchorInLeaves = result.leaves.some(
      (l) => l.selector === "#anchor-btn"
    );
    assert.equal(
      anchorInLeaves,
      false,
      "Anchor 元素绝不得出现在 leaves 数组中！"
    );
  });

  test("3.2 相对坐标系 (relativeRect) 在 anchors 与 leaves 中精确无漂移", async () => {
    const root = createMockElement(
      "DIV",
      "",
      { left: 0, top: 0, width: 1000, height: 1000 },
      null,
      "app-root"
    );
    const el1 = createMockElement(
      "BUTTON",
      "按钮1",
      { left: 150, top: 250, width: 100, height: 50 },
      root,
      "btn-1"
    );

    root.children = [el1];
    root.querySelectorAll = () => [el1];

    const cropBounds = { x: 100, y: 200, width: 400, height: 400 };
    const annotations: any[] = [
      {
        id: "ann-rect-1",
        type: "rect",
        bounds: { x: 150, y: 250, width: 100, height: 50 },
      },
    ];

    const result = await collectSpatialDomTree({
      cropBounds,
      rootElement: root,
      annotations,
    });

    assert.equal(result.anchors.length, 1);
    const anchor = result.anchors[0];
    // 相对坐标 = 绝对坐标 - cropBounds 原点
    assert.equal(
      anchor.relativeRect.x,
      50,
      "relativeRect.x 应为 150 - 100 = 50"
    );
    assert.equal(
      anchor.relativeRect.y,
      50,
      "relativeRect.y 应为 250 - 200 = 50"
    );
    assert.equal(anchor.relativeRect.width, 100);
    assert.equal(anchor.relativeRect.height, 50);
  });

  test("3.3 祖先节点 (ancestors) 的 depth、SCA 相对层级与组件挂载一致性", async () => {
    const sca = createMockElement(
      "DIV",
      "",
      { left: 0, top: 0, width: 800, height: 800 },
      null,
      "sca-container"
    );
    const parent = createMockElement(
      "DIV",
      "",
      { left: 10, top: 10, width: 400, height: 400 },
      sca,
      "parent-box"
    );
    const child = createMockElement(
      "BUTTON",
      "深层按钮",
      { left: 20, top: 20, width: 100, height: 30 },
      parent,
      "child-btn"
    );
    const sibling = createMockElement(
      "BUTTON",
      "同级按钮",
      { left: 500, top: 20, width: 100, height: 30 },
      sca,
      "sibling-btn"
    );

    sca.children = [parent, sibling];
    parent.children = [child];
    sca.contains = (o: any) =>
      o === sca || o === parent || o === child || o === sibling;
    parent.contains = (o: any) => o === parent || o === child;
    sca.querySelectorAll = () => [parent, child, sibling];

    const probeMap = new Map();
    probeMap.set(sca, {
      framework: "vue",
      version: 3,
      componentName: "ScaRoot",
      componentFile: "src/views/ScaRoot.vue",
    });
    probeMap.set(parent, {
      framework: "vue",
      version: 3,
      componentName: "ParentCard",
      componentFile: "src/components/ParentCard.vue",
    });
    probeMap.set(child, {
      framework: "vue",
      version: 3,
      componentName: "ChildButton",
      componentFile: "src/components/ChildButton.vue",
      componentLine: 45,
    });

    const cropBounds = { x: 0, y: 0, width: 800, height: 800 };
    const result = await collectSpatialDomTree({
      cropBounds,
      rootElement: sca,
      disablePruning: true,
      probeFramework: async () => probeMap,
    });

    assert.equal(result.smallestCommonAncestorSelector, "#sca-container");

    // 检查 ancestors 集合
    assert.ok(result.ancestors.length > 0);
    const parentAncestor = result.ancestors.find(
      (a) => a.selector === "#parent-box"
    );
    assert.ok(parentAncestor, "parent-box 必须在 ancestors 列表中");
    assert.equal(parentAncestor.componentFile, "src/components/ParentCard.vue");
    assert.equal(parentAncestor.componentName, "ParentCard");
    assert.equal(parentAncestor.depth, 1, "parent-box 距离 sca 的 depth 为 1");

    const scaAncestor = result.ancestors.find(
      (a) => a.selector === "#sca-container"
    );
    assert.ok(scaAncestor, "sca-container 自身作为公共祖先 depth 应为 0");
    assert.equal(scaAncestor.depth, 0);
    assert.equal(scaAncestor.componentFile, "src/views/ScaRoot.vue");
  });
});

describe("Adversarial Challenge 4: 多层包装折叠与深度路径继承", () => {
  test("4.1 连续三层纯布局 wrapper 折叠时，collapsedWrappers 保持从外到内层级有序", async () => {
    const root = createMockElement(
      "DIV",
      "",
      { left: 0, top: 0, width: 600, height: 600 },
      null,
      "root-div"
    );
    const wrap1 = createMockElement(
      "DIV",
      "",
      { left: 10, top: 10, width: 400, height: 400 },
      root,
      "outer-wrap"
    );
    const wrap2 = createMockElement(
      "DIV",
      "",
      { left: 20, top: 20, width: 300, height: 300 },
      wrap1,
      "mid-wrap"
    );
    const wrap3 = createMockElement(
      "DIV",
      "",
      { left: 30, top: 30, width: 200, height: 200 },
      wrap2,
      "inner-wrap"
    );
    const button = createMockElement(
      "BUTTON",
      "目标按钮",
      { left: 40, top: 40, width: 100, height: 40 },
      wrap3,
      "target-btn"
    );
    const sibling = createMockElement(
      "DIV",
      "旁支内容",
      { left: 450, top: 10, width: 100, height: 100 },
      root,
      "sibling-node"
    );

    root.children = [wrap1, sibling];
    wrap1.children = [wrap2];
    wrap2.children = [wrap3];
    wrap3.children = [button];
    root.querySelectorAll = () => [wrap1, wrap2, wrap3, button, sibling];

    const result = await collectSpatialDomTree({
      cropBounds: { x: 0, y: 0, width: 600, height: 600 },
      rootElement: root,
      disablePruning: true,
    });

    const targetNode = result.tree?.children?.find(
      (c) => c.selector === "#target-btn"
    );
    assert.ok(targetNode, "target-btn 必须被保留");
    assert.deepEqual(
      targetNode.collapsedWrappers,
      ["#outer-wrap", "#mid-wrap", "#inner-wrap"],
      "三层连续包装 div 应当依次有序折叠进 collapsedWrappers"
    );
  });

  test("4.2 父子组件链切换：组件 A 嵌套组件 B，即使均为单子，二者均被保留且 componentPath 正确压缩", async () => {
    const root = createMockElement(
      "DIV",
      "",
      { left: 0, top: 0, width: 600, height: 600 },
      null,
      "root-div"
    );
    const compAEl = createMockElement(
      "DIV",
      "",
      { left: 10, top: 10, width: 400, height: 400 },
      root,
      "comp-a"
    );
    const compBEl = createMockElement(
      "BUTTON",
      "提交",
      { left: 20, top: 20, width: 100, height: 40 },
      compAEl,
      "comp-b"
    );
    const sibling = createMockElement(
      "DIV",
      "旁支内容",
      { left: 450, top: 10, width: 100, height: 100 },
      root,
      "sibling-node"
    );

    root.children = [compAEl, sibling];
    compAEl.children = [compBEl];
    root.querySelectorAll = () => [compAEl, compBEl, sibling];

    const probeMap = new Map();
    probeMap.set(compAEl, {
      framework: "vue",
      version: 3,
      componentName: "CompA",
      componentPath: ["App", "CompA"],
      componentFile: "src/views/CompA.vue",
    });
    probeMap.set(compBEl, {
      framework: "vue",
      version: 3,
      componentName: "CompB",
      componentPath: ["App", "CompA", "CompB"],
      componentFile: "src/components/CompB.vue",
    });

    const result = await collectSpatialDomTree({
      cropBounds: { x: 0, y: 0, width: 600, height: 600 },
      rootElement: root,
      disablePruning: true,
      probeFramework: async () => probeMap,
    });

    const nodeA = result.tree?.children?.find((c) => c.selector === "#comp-a");
    assert.ok(nodeA, "CompA 节点由于身份切换与具备 componentFile，严禁折叠");
    assert.equal(nodeA.componentName, "CompA");
    assert.deepEqual(nodeA.componentPath, ["App", "CompA"]);

    const nodeB = nodeA.children?.find((c) => c.selector === "#comp-b");
    assert.ok(nodeB, "CompB 节点必须作为 CompA 的子节点存在");
    assert.equal(nodeB.componentName, "CompB");
    assert.deepEqual(nodeB.componentPath, ["App", "CompA", "CompB"]);
  });
});
