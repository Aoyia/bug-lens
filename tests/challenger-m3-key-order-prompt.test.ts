import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { unzipSync } from "fflate";
import {
  normalizeDomTreeKeyOrder,
  normalizeDomTreeNodeKeyOrder,
  normalizeDomAnchorNodeKeyOrder,
  normalizeDomLeafNodeKeyOrder,
  normalizeDomAncestorNodeKeyOrder,
  normalizePayloadKeyOrder,
  formatPayloadToMarkdown,
  formatPayloadToHtml,
  buildAiPromptTemplate,
  formatPayloadToMarkdownForZip,
  type AIScreenshotPayload,
  type DomContextTreeV2,
  type DomTreeNode,
  type DomAnchorNode,
  type DomLeafNode,
  type DomAncestorNode,
  type FrameworkComponentStateSnapshot,
} from "../src/domain/screenshot-payload.ts";
import { buildScreenshotZipPackage } from "../src/screenshot/pipeline/screenshot-zip-builder.ts";
import { setUserLanguagePreference } from "../src/shared/i18n.ts";

const createBasePayload = (
  overrides: Partial<AIScreenshotPayload> = {}
): AIScreenshotPayload => ({
  version: "1.0",
  timestamp: 1700000000000,
  cropBounds: { x: 0, y: 0, width: 800, height: 600 },
  image: {
    base64Data:
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    width: 800,
    height: 600,
    devicePixelRatio: 2,
  },
  annotations: [],
  annotationGroups: [],
  domContextTree: {
    smallestCommonAncestorSelector: "div#root",
    meta: {
      anchorCount: 0,
      leafCount: 0,
      ancestorCount: 0,
      truncated: false,
    },
    anchors: [],
    leaves: [],
    ancestors: [],
  },
  environment: {
    url: "https://test.bug-lens.com/app",
    title: "Bug Lens Stress Test",
    userAgent: "Mozilla/5.0 Challenger/1.0",
    viewport: { width: 1280, height: 800 },
    mediaBreakpoint: "desktop",
    recentConsoleErrors: [],
    recentFailedRequests: [],
  },
  ...overrides,
});

describe("Adversarial Challenge 1: Edge Cases in normalizeDomTreeKeyOrder", () => {
  test("1.1 极简稀疏节点（Sparse Keys）：仅含必填属性，无任何可选属性", () => {
    // DomTreeNode 极简状态
    const sparseTreeNode: DomTreeNode = {
      selector: "div.empty",
    };
    const normTree = normalizeDomTreeNodeKeyOrder(sparseTreeNode);
    const keysTree = Object.keys(normTree);

    // 确保没有漏出值为 undefined 的多余可选 key（除了设计中保留的必填字段）
    assert.ok(keysTree.includes("selector"), "必须包含 selector");
    assert.strictEqual(normTree.componentFile, undefined);
    assert.strictEqual(normTree.componentLine, undefined);
    assert.strictEqual(normTree.componentName, undefined);
    assert.strictEqual(normTree.children, undefined);

    // 验证 JSON 序列化不含 undefined 键且合法可解析
    const jsonTree = JSON.stringify(normTree);
    const parsedTree = JSON.parse(jsonTree);
    assert.strictEqual(parsedTree.selector, "div.empty");
    assert.strictEqual(parsedTree.componentFile, undefined);
    assert.strictEqual(parsedTree.children, undefined);

    // DomAnchorNode 极简状态
    const sparseAnchor: DomAnchorNode = {
      selector: "button.submit",
      selectorPath: "div > button.submit",
      relativeRect: { x: 10, y: 10, width: 100, height: 30 },
      computedStyles: { display: "block" },
      intentFlags: {},
    };
    const normAnchor = normalizeDomAnchorNodeKeyOrder(sparseAnchor);
    assert.strictEqual(normAnchor.componentFile, undefined);
    assert.strictEqual(normAnchor.componentLine, undefined);
    assert.strictEqual(normAnchor.componentName, undefined);
    assert.strictEqual(normAnchor.tagName, undefined);

    // DomLeafNode 极简状态
    const sparseLeaf: DomLeafNode = {
      tagName: "span",
      selector: "span.text",
      relativeRect: { x: 0, y: 0, width: 50, height: 20 },
    };
    const normLeaf = normalizeDomLeafNodeKeyOrder(sparseLeaf);
    assert.strictEqual(normLeaf.componentFile, undefined);
    assert.strictEqual(normLeaf.componentLine, undefined);
    assert.strictEqual(normLeaf.id, undefined);

    // DomAncestorNode 极简状态
    const sparseAncestor: DomAncestorNode = {
      selector: "main",
      depth: 0,
    };
    const normAncestor = normalizeDomAncestorNodeKeyOrder(sparseAncestor);
    assert.strictEqual(normAncestor.componentFile, undefined);
    assert.strictEqual(normAncestor.componentName, undefined);
    assert.strictEqual(normAncestor.tagName, undefined);
  });

  test("1.2 未知/非标准属性透传（Unexpected Properties）：...rest 机制与 children 置底稳定性", () => {
    const nodeWithUnexpectedProps: any = {
      selector: "div.custom",
      tagName: "div",
      componentFile: "src/Custom.tsx",
      componentLine: 10,
      __custom_meta: { debug: true },
      x_ray_score: 99.8,
      injectedByPlugin: "v1.2.0",
      children: [
        {
          selector: "span.inner",
          unexpectedInnerField: "hello",
        },
      ],
    };

    const normNode = normalizeDomTreeNodeKeyOrder(nodeWithUnexpectedProps);
    const keys = Object.keys(normNode);

    // 验证额外字段完整保留，未被丢弃
    assert.deepStrictEqual((normNode as any).__custom_meta, { debug: true });
    assert.strictEqual((normNode as any).x_ray_score, 99.8);
    assert.strictEqual((normNode as any).injectedByPlugin, "v1.2.0");

    // 关键断言：children 必须始终处于最末尾（置底），不受未知属性注入影响！
    assert.strictEqual(
      keys[keys.length - 1],
      "children",
      "无论存在多少未知属性，children 必须永远置底"
    );

    // 验证子节点内部同样递归维持 children 置底
    const childKeys = Object.keys(normNode.children![0]);
    assert.strictEqual(
      (normNode.children![0] as any).unexpectedInnerField,
      "hello"
    );

    // 验证 DomContextTreeV2 根级别的未知属性透传与 tree 置底
    const treeWithUnexpected: any = {
      smallestCommonAncestorSelector: "div#app",
      meta: {
        anchorCount: 0,
        leafCount: 0,
        ancestorCount: 0,
        truncated: false,
      },
      anchors: [],
      leaves: [],
      ancestors: [],
      sessionExtraTag: "canary-build",
      extraMetrics: [1, 2, 3],
      tree: normNode,
    };

    const normContextTree = normalizeDomTreeKeyOrder(treeWithUnexpected);
    const contextKeys = Object.keys(normContextTree);
    assert.strictEqual(
      (normContextTree as any).sessionExtraTag,
      "canary-build"
    );
    assert.deepStrictEqual((normContextTree as any).extraMetrics, [1, 2, 3]);
    assert.strictEqual(
      contextKeys[contextKeys.length - 1],
      "tree",
      "无论 context tree 有多少未知属性，tree 必须永远置底"
    );
  });

  test("1.3 确定性键顺序全排列检验（Key Order Invariance）", () => {
    // 构造具有多种不同字段存在/缺失组合的节点，验证 Key 的相对顺序绝对单调
    const variations: DomTreeNode[] = [
      // 仅有 componentFile
      { selector: "div", componentFile: "src/A.vue" },
      // 仅有 componentLine
      { selector: "div", componentLine: 12 },
      // 有 name + file + line
      {
        selector: "div",
        componentName: "<App>",
        componentFile: "src/A.tsx",
        componentLine: 12,
      },
      // 有 path + file + line + props + data
      {
        selector: "div",
        componentPath: ["<Root>", "<App>"],
        componentFile: "src/A.tsx",
        componentLine: 12,
        props: { foo: 1 },
        data: { bar: 2 },
      },
      // 全部可选字段拉满
      {
        intentFlags: { isHighlightedFocus: true },
        isErrorSignal: true,
        componentName: "<Complex>",
        componentPath: ["<Root>", "<Complex>"],
        componentFile: "src/Complex.tsx",
        componentLine: 99,
        props: { a: 1 },
        data: { b: 2 },
        tagName: "section",
        id: "hero",
        className: "hero-banner",
        selector: "section#hero.hero-banner",
        innerText: "Welcome",
        visibility: "visible",
        exposure: "exposed",
        obscuredBy: undefined,
        relativeRect: { x: 0, y: 0, width: 800, height: 400 },
        layoutContext: { isFlexOrGridItem: true },
        collapsedWrappers: ["div.wrapper"],
        selectState: undefined,
        boxModel: undefined,
        computedStyles: { color: "black" },
        children: [],
      },
    ];

    const expectedSequence = [
      "intentFlags",
      "isErrorSignal",
      "componentName",
      "componentPath",
      "componentFile",
      "componentLine",
      "props",
      "data",
      "tagName",
      "id",
      "className",
      "selector",
      "innerText",
      "visibility",
      "exposure",
      "obscuredBy",
      "relativeRect",
      "layoutContext",
      "collapsedWrappers",
      "selectState",
      "boxModel",
      "computedStyles",
      "children",
    ];

    for (const v of variations) {
      const norm = normalizeDomTreeNodeKeyOrder(v);
      const keys = Object.keys(norm);
      let lastIndex = -1;
      for (const k of keys) {
        const seqIndex = expectedSequence.indexOf(k);
        if (seqIndex !== -1) {
          assert.ok(
            seqIndex > lastIndex,
            `Key order violation: "${k}" (index ${seqIndex}) appeared after previous key at index ${lastIndex} in keys: ${keys.join(", ")}`
          );
          lastIndex = seqIndex;
        }
      }
    }
  });

  test("1.4 深度嵌套树极限压力测试（Deep Tree Recursion: 100层）", () => {
    // 构造 100 层的 DOM 树
    let deepRoot: DomTreeNode = {
      selector: "div#level-100",
      tagName: "div",
      componentFile: "src/Level100.vue",
      componentLine: 100,
    };

    for (let i = 99; i >= 1; i--) {
      deepRoot = {
        selector: `div#level-${i}`,
        tagName: "div",
        componentName: `<Level${i}>`,
        componentFile: `src/levels/Level${i}.tsx`,
        componentLine: i,
        children: [deepRoot],
      };
    }

    const t0 = Date.now();
    const normalized = normalizeDomTreeNodeKeyOrder(deepRoot);
    const elapsed = Date.now() - t0;

    assert.ok(
      elapsed < 200,
      `100层深度树归一化耗时 (${elapsed}ms) 必须在合理范围内 (<200ms)`
    );

    // 遍历深度验证每一层都正确保持 key 顺序与数据完整性
    let current: DomTreeNode | undefined = normalized;
    let depth = 1;
    while (current) {
      const keys = Object.keys(current);
      if (current.children) {
        assert.strictEqual(keys[keys.length - 1], "children");
      }
      if (current.componentFile) {
        assert.ok(keys.indexOf("componentFile") < keys.indexOf("tagName"));
      }
      current = current.children?.[0];
      depth++;
    }
    assert.strictEqual(depth, 101, "必须完整递归遍历 100 层子节点");
  });

  test("1.5 500层超深树与 1,000 兄弟节点广度树压力测试", () => {
    // 1. 500 层深度树
    let deep500: DomTreeNode = { selector: "span#leaf" };
    for (let i = 499; i >= 1; i--) {
      deep500 = { selector: `div#node-${i}`, children: [deep500] };
    }
    const t0 = Date.now();
    const normDeep = normalizeDomTreeNodeKeyOrder(deep500);
    const elapsedDeep = Date.now() - t0;
    assert.ok(
      elapsedDeep < 300,
      `500层深度树归一化耗时 (${elapsedDeep}ms) 必须在合理范围内 (<300ms)`
    );
    assert.ok(normDeep.children);

    // 2. 1,000 兄弟子节点的广度树
    const siblings: DomTreeNode[] = [];
    for (let i = 0; i < 1000; i++) {
      siblings.push({
        selector: `li#item-${i}`,
        tagName: "li",
        componentFile: `src/Item${i % 10}.vue`,
        componentLine: (i % 50) + 1,
      });
    }
    const broadRoot: DomTreeNode = {
      selector: "ul#list",
      tagName: "ul",
      children: siblings,
    };
    const t1 = Date.now();
    const normBroad = normalizeDomTreeNodeKeyOrder(broadRoot);
    const elapsedBroad = Date.now() - t1;
    assert.ok(
      elapsedBroad < 300,
      `1000兄弟节点广度树归一化耗时 (${elapsedBroad}ms) 必须在合理范围内 (<300ms)`
    );
    assert.strictEqual(normBroad.children?.length, 1000);
    assert.strictEqual(
      Object.keys(normBroad)[Object.keys(normBroad).length - 1],
      "children"
    );
  });

  test("1.6 极端空/缺省结构容错（空数组、无 tree、可选属性为 undefined）", () => {
    const minimalContextTree: DomContextTreeV2 = {
      smallestCommonAncestorSelector: "html",
      meta: {
        anchorCount: 0,
        leafCount: 0,
        ancestorCount: 0,
        truncated: false,
      },
      anchors: [],
      leaves: [],
      ancestors: [],
    };
    const norm = normalizeDomTreeKeyOrder(minimalContextTree);
    assert.strictEqual(norm.smallestCommonAncestorSelector, "html");
    assert.deepStrictEqual(norm.anchors, []);
    assert.deepStrictEqual(norm.leaves, []);
    assert.deepStrictEqual(norm.ancestors, []);
    assert.strictEqual(norm.tree, undefined);
    assert.ok(
      !("tree" in norm),
      "tree 为 undefined 时不应在序列化对象中显式包含 tree 键"
    );
  });
});

describe("Adversarial Challenge 2: Boundary Paths & Special Characters in Prompt Rendering", () => {
  test("2.1 特殊字符路径（反引号、引号、中文字符、空格、Markdown 符号）", async () => {
    await setUserLanguagePreference("zh-CN");

    const specialPaths = [
      {
        file: "src/components/`OrderButton`.tsx",
        line: 42,
        name: "<OrderButton>",
      },
      {
        file: "src/views/用户中心/订单 详情 [v2] (beta)/Dialog's.vue",
        line: 108,
        name: "<OrderDialog>",
      },
      {
        file: "src/icons/icon-arrow->right.svg",
        line: undefined,
        name: "<ArrowIcon>",
      },
    ];

    const payload = createBasePayload({
      domContextTree: {
        smallestCommonAncestorSelector: "div#root",
        meta: {
          anchorCount: 2,
          leafCount: 1,
          ancestorCount: 0,
          truncated: false,
        },
        anchors: [
          {
            selector: "button.submit",
            selectorPath: "div#root > button.submit",
            componentName: specialPaths[0].name,
            componentFile: specialPaths[0].file,
            componentLine: specialPaths[0].line,
            relativeRect: { x: 0, y: 0, width: 100, height: 30 },
            computedStyles: {},
            intentFlags: { isArrowTarget: true },
          },
          {
            selector: "div.dialog",
            selectorPath: "div#root > div.dialog",
            componentName: specialPaths[1].name,
            componentFile: specialPaths[1].file,
            componentLine: specialPaths[1].line,
            relativeRect: { x: 0, y: 0, width: 300, height: 200 },
            computedStyles: {},
            intentFlags: {},
          },
        ],
        leaves: [
          {
            tagName: "svg",
            selector: "svg.arrow",
            componentName: specialPaths[2].name,
            componentFile: specialPaths[2].file,
            relativeRect: { x: 5, y: 5, width: 16, height: 16 },
          },
        ],
        ancestors: [],
      },
    });

    const mdPrompt = formatPayloadToMarkdown(payload);

    // 核心断言：包含源码物理定位模块
    assert.match(mdPrompt, /- 🎯 源码物理定位 \(Source Code Location\):/);

    // 核心断言：首个标注锚点作为核心标注组件
    assert.match(
      mdPrompt,
      /核心标注组件: <OrderButton> -> `src\/components\/`OrderButton`\.tsx:42`/
    );

    // 核心断言：中文空格特殊路径完整呈现
    assert.ok(
      mdPrompt.includes(
        "src/views/用户中心/订单 详情 [v2] (beta)/Dialog's.vue:108"
      ),
      "中文字符与空格路径必须完整无损输出"
    );

    // 验证转为 HTML 剪切板时，HTML 实体转义生效防 XSS
    const htmlClipboard = formatPayloadToHtml(
      payload,
      payload.image.base64Data
    );
    assert.ok(!htmlClipboard.includes("<script>"), "严禁包含未转义标签");
    assert.ok(
      htmlClipboard.includes("&lt;OrderButton&gt;"),
      "组件尖括号必须在 HTML 中被转义为实体"
    );
  });

  test("2.2 超长物理路径（1500+ 字符）稳定性", () => {
    const veryLongDirectory = "nested_dir_segment_1234567890/".repeat(50);
    const veryLongFile = `src/${veryLongDirectory}VeryLongDeeplyNestedComponent.tsx`;

    const payload = createBasePayload({
      domContextTree: {
        smallestCommonAncestorSelector: "div#root",
        meta: {
          anchorCount: 1,
          leafCount: 0,
          ancestorCount: 0,
          truncated: false,
        },
        anchors: [
          {
            selector: "div.deep",
            selectorPath: "div#root > div.deep",
            componentName: "<DeepComponent>",
            componentFile: veryLongFile,
            componentLine: 9999,
            relativeRect: { x: 0, y: 0, width: 100, height: 100 },
            computedStyles: {},
            intentFlags: {},
          },
        ],
        leaves: [],
        ancestors: [],
      },
    });

    const mdPrompt = formatPayloadToMarkdown(payload);
    assert.ok(mdPrompt.includes(veryLongFile), "超长路径必须完整输出无截断");
    assert.ok(mdPrompt.includes(":9999"), "大行号必须正确拼接");
  });

  test("2.3 Windows 反斜杠路径兼容性", () => {
    const winPath = "src\\components\\sub\\WindowsButton.tsx";
    const payload = createBasePayload({
      domContextTree: {
        smallestCommonAncestorSelector: "div#root",
        meta: {
          anchorCount: 1,
          leafCount: 0,
          ancestorCount: 0,
          truncated: false,
        },
        anchors: [
          {
            selector: "button.win",
            selectorPath: "div#root > button.win",
            componentName: "<WindowsButton>",
            componentFile: winPath,
            componentLine: 35,
            relativeRect: { x: 0, y: 0, width: 80, height: 28 },
            computedStyles: {},
            intentFlags: {},
          },
        ],
        leaves: [],
        ancestors: [],
      },
    });

    const mdPrompt = formatPayloadToMarkdown(payload);
    assert.ok(mdPrompt.includes("src\\components\\sub\\WindowsButton.tsx:35"));
  });

  test("2.4 componentLine 边界值（0, 负数, NaN, 大数值）", () => {
    // 0 在 JS 中为 falsy，需观察是否被转为空串或处理
    const payloadWithZeroLine = createBasePayload({
      domContextTree: {
        smallestCommonAncestorSelector: "div#root",
        meta: {
          anchorCount: 1,
          leafCount: 0,
          ancestorCount: 0,
          truncated: false,
        },
        anchors: [
          {
            selector: "div.box",
            selectorPath: "div#root > div.box",
            componentName: "<Box>",
            componentFile: "src/Box.tsx",
            componentLine: 0, // 0 号边界
            relativeRect: { x: 0, y: 0, width: 50, height: 50 },
            computedStyles: {},
            intentFlags: {},
          },
        ],
        leaves: [],
        ancestors: [],
      },
    });

    const md = formatPayloadToMarkdown(payloadWithZeroLine);
    // componentLine 为 0 时 falsy，判定不附加行号，输出 `src/Box.tsx` 而非 `:0` 或 `:undefined`
    assert.match(md, /`src\/Box\.tsx`/);
    assert.doesNotMatch(md, /:undefined/);
  });

  test("2.5 zipPath 包含特殊正则替换字符（$&, $1, 空格, 中文, 引号）防格式注入", () => {
    const trickyZipPaths = [
      "/Users/tester/My Downloads/$&/$1/$'/test-file.zip",
      "/Users/测试员/带空格 的 路径 (版本 2.0)/bug-lens.zip",
      '/opt/app/"quoted"/package.zip',
    ];

    for (const zp of trickyZipPaths) {
      const md = formatPayloadToMarkdown(createBasePayload(), zp);
      // 核心断言：zipPath 必须按字面量准确完整注入，绝不被正则替换引擎破坏！
      assert.ok(
        md.includes(zp),
        `zipPath "${zp}" 必须以原始字面量形式出现，不得发生正则替换错误或转义丢失`
      );
    }
  });

  test("2.6 formatPayloadToMarkdownForZip 与 buildScreenshotZipPackage 打包特殊路径解压断言", async () => {
    const payloadWithSpecialChars = createBasePayload({
      domContextTree: {
        smallestCommonAncestorSelector: "div#app",
        meta: {
          anchorCount: 1,
          leafCount: 0,
          ancestorCount: 0,
          truncated: false,
        },
        anchors: [
          {
            selector: "button.test",
            selectorPath: "div#app > button.test",
            componentName: "<SpecialButton>",
            componentFile: "src/components/特殊组件 & [Test].vue",
            componentLine: 77,
            relativeRect: { x: 10, y: 10, width: 80, height: 30 },
            computedStyles: {},
            intentFlags: {},
          },
        ],
        leaves: [],
        ancestors: [],
      },
      environment: {
        url: "https://example.com/special",
        title: "Special Chars Test",
        userAgent: "ChallengerAgent",
        viewport: { width: 1024, height: 768 },
        mediaBreakpoint: "desktop",
        recentConsoleErrors: [],
        recentFailedRequests: [],
        frameworkComponentStates: [
          {
            componentName: "<SpecialButton>",
            componentFile: "src/components/特殊组件 & [Test].vue",
            componentLine: 77,
            framework: "vue",
          },
        ],
        vueComponentStates: [
          {
            componentName: "<SpecialButton>",
            componentFile: "src/components/特殊组件 & [Test].vue",
            componentLine: 77,
            framework: "vue",
          },
        ],
      },
    });

    const pack = buildScreenshotZipPackage(payloadWithSpecialChars);
    const u8 = new Uint8Array(await pack.blob.arrayBuffer());
    const unzipped = unzipSync(u8);

    // 验证 zip 内 ai-prompt.md
    assert.ok(unzipped["ai-prompt.md"]);
    const prompt = new TextDecoder().decode(unzipped["ai-prompt.md"]);
    assert.ok(prompt.includes("src/components/特殊组件 & [Test].vue:77"));

    // 验证 zip 内 dom-context.json
    assert.ok(unzipped["dom-context.json"]);
    const domContext = JSON.parse(
      new TextDecoder().decode(unzipped["dom-context.json"])
    );
    assert.strictEqual(
      domContext.anchors[0].componentFile,
      "src/components/特殊组件 & [Test].vue"
    );
    assert.strictEqual(domContext.anchors[0].componentLine, 77);
  });

  test("2.7 路径包含 Markdown 链接语法与换行符防破坏注入", () => {
    const maliciousPaths = [
      "src/components/[malicious-link](https://evil.com)/Button.tsx",
      "src/components/newline\nin\npath/Button.vue",
    ];

    const payload = createBasePayload({
      domContextTree: {
        smallestCommonAncestorSelector: "div#root",
        meta: {
          anchorCount: 2,
          leafCount: 0,
          ancestorCount: 0,
          truncated: false,
        },
        anchors: [
          {
            selector: "button.link",
            selectorPath: "div#root > button.link",
            componentName: "<EvilLink>",
            componentFile: maliciousPaths[0],
            componentLine: 1,
            relativeRect: { x: 0, y: 0, width: 50, height: 20 },
            computedStyles: {},
            intentFlags: {},
          },
          {
            selector: "button.newline",
            selectorPath: "div#root > button.newline",
            componentName: "<NewlineComp>",
            componentFile: maliciousPaths[1],
            componentLine: 2,
            relativeRect: { x: 0, y: 30, width: 50, height: 20 },
            computedStyles: {},
            intentFlags: {},
          },
        ],
        leaves: [],
        ancestors: [],
      },
    });

    const md = formatPayloadToMarkdown(payload);
    assert.ok(
      md.includes(
        "src/components/[malicious-link](https://evil.com)/Button.tsx:1"
      )
    );
    assert.ok(md.includes("src/components/newline\nin\npath/Button.vue:2"));
  });

  test("2.8 相同文件/行号的多个组件多源注册去重幂等性", () => {
    // 同一个文件行号在 anchors, leaves, tree, frameworkComponentStates 中被多次重复命中
    const payload = createBasePayload({
      domContextTree: {
        smallestCommonAncestorSelector: "div#root",
        meta: {
          anchorCount: 2,
          leafCount: 1,
          ancestorCount: 0,
          truncated: false,
        },
        anchors: [
          {
            selector: "button#dup1",
            selectorPath: "div > button#dup1",
            componentName: "<SharedButton>",
            componentFile: "src/SharedButton.tsx",
            componentLine: 42,
            relativeRect: { x: 0, y: 0, width: 10, height: 10 },
            computedStyles: {},
            intentFlags: { isArrowTarget: true },
          },
          {
            selector: "button#dup2",
            selectorPath: "div > button#dup2",
            componentName: "<SharedButton>",
            componentFile: "src/SharedButton.tsx",
            componentLine: 42,
            relativeRect: { x: 0, y: 10, width: 10, height: 10 },
            computedStyles: {},
            intentFlags: {},
          },
        ],
        leaves: [
          {
            tagName: "span",
            selector: "span.text",
            componentName: "<SharedButton>",
            componentFile: "src/SharedButton.tsx",
            componentLine: 42,
            relativeRect: { x: 0, y: 20, width: 10, height: 10 },
          },
        ],
        ancestors: [],
        tree: {
          selector: "div#root",
          componentName: "<SharedButton>",
          componentFile: "src/SharedButton.tsx",
          componentLine: 42,
        },
      },
      environment: {
        ...createBasePayload().environment,
        frameworkComponentStates: [
          {
            componentName: "<SharedButton>",
            componentFile: "src/SharedButton.tsx",
            componentLine: 42,
            framework: "react",
          },
        ],
      },
    });

    const md = formatPayloadToMarkdown(payload);
    // 尽管被 5 个不同来源同时上报，清单中该路径必须被精确去重为仅 1 条！
    const occurrences = md.split("`src/SharedButton.tsx:42`").length - 1;
    // 出现 2 次：一次在核心标注组件，一次在清单列表（列表内仅且只有 1 条）
    assert.strictEqual(
      occurrences,
      2,
      "清单中必须完美去重，不得出现重复路径行"
    );
  });
});

describe("Adversarial Challenge 3: Production Fallback Behavior (No File Info Available)", () => {
  test("3.1 纯生产构建环境（多组件，全量缺失 componentFile）优雅降级（中/英文）", async () => {
    const prodPayload = createBasePayload({
      domContextTree: {
        smallestCommonAncestorSelector: "div#main",
        meta: {
          anchorCount: 1,
          leafCount: 2,
          ancestorCount: 1,
          truncated: false,
        },
        anchors: [
          {
            selector: "button.submit",
            selectorPath: "div#main > button.submit",
            componentName: "<OrderSubmit>",
            // 生产环境下 componentFile 为 undefined
            relativeRect: { x: 0, y: 0, width: 80, height: 30 },
            computedStyles: {},
            intentFlags: {},
          },
        ],
        leaves: [
          {
            tagName: "span",
            selector: "span.price",
            componentName: "<PriceDisplay>",
            relativeRect: { x: 0, y: 35, width: 60, height: 20 },
          },
          {
            tagName: "p",
            selector: "p.desc",
            componentName: "<ProductDescription>",
            relativeRect: { x: 0, y: 60, width: 200, height: 40 },
          },
        ],
        ancestors: [
          {
            selector: "div.card",
            depth: 1,
            componentName: "<ProductCard>",
          },
        ],
      },
    });

    // 1. 中文生产降级测试
    await setUserLanguagePreference("zh-CN");
    const mdZh = buildAiPromptTemplate(prodPayload);
    assert.match(mdZh, /- 🎯 源码物理定位 \(Source Code Location\):/);
    assert.match(
      mdZh,
      /未捕获到物理源码路径（页面可能处于生产构建或混淆模式），请参考 DOM 结构与组件名（如 <OrderSubmit>, <PriceDisplay>, <ProductDescription>）在工程中进行全局搜索。/
    );
    // 确保没有出现由于缺少物理路径而报错或生成空路径 `undefined`
    assert.doesNotMatch(mdZh, /undefined/);
    assert.doesNotMatch(mdZh, /核心标注组件:.*-> ``/);

    // 2. 英文生产降级测试
    await setUserLanguagePreference("en-US");
    const mdEn = buildAiPromptTemplate(prodPayload);
    assert.match(mdEn, /- 🎯 源码物理定位 \(Source Code Location\):/);
    assert.match(
      mdEn,
      /No physical source paths captured \(the page may be a production build or minified\)\. Please refer to DOM structure and component name\(s\) \(e\.g\. <OrderSubmit>, <PriceDisplay>, <ProductDescription>\) for global codebase search\./
    );
    assert.doesNotMatch(mdEn, /undefined/);

    await setUserLanguagePreference("auto");
  });

  test("3.2 原生无组件 DOM 页面（零组件名，零物理文件）完全静默降级", async () => {
    const rawDomPayload = createBasePayload({
      domContextTree: {
        smallestCommonAncestorSelector: "div#container",
        meta: {
          anchorCount: 1,
          leafCount: 0,
          ancestorCount: 0,
          truncated: false,
        },
        anchors: [
          {
            selector: "div.pure-native",
            selectorPath: "div#container > div.pure-native",
            relativeRect: { x: 0, y: 0, width: 100, height: 100 },
            computedStyles: {},
            intentFlags: {},
          },
        ],
        leaves: [],
        ancestors: [],
      },
    });

    await setUserLanguagePreference("zh-CN");
    const mdZh = buildAiPromptTemplate(rawDomPayload);
    // 当完全没有组件名时，提示中不得包含空括号 "（如 ）"
    assert.doesNotMatch(mdZh, /（如 ）/);
    assert.match(
      mdZh,
      /未捕获到物理源码路径（页面可能处于生产构建或混淆模式），请参考 DOM 结构与组件名在工程中进行全局搜索。/
    );

    await setUserLanguagePreference("en-US");
    const mdEn = buildAiPromptTemplate(rawDomPayload);
    assert.doesNotMatch(mdEn, /\(e\.g\. \)/);
    assert.match(
      mdEn,
      /No physical source paths captured \(the page may be a production build or minified\)\. Please refer to DOM structure and component name\(s\) for global codebase search\./
    );

    await setUserLanguagePreference("auto");
  });

  test("3.3 生产环境单字母混淆组件名容错（Minified Component Names: a, b, c）", async () => {
    const minifiedPayload = createBasePayload({
      domContextTree: {
        smallestCommonAncestorSelector: "div#app",
        meta: {
          anchorCount: 1,
          leafCount: 2,
          ancestorCount: 0,
          truncated: false,
        },
        anchors: [
          {
            selector: "button.btn",
            selectorPath: "div#app > button.btn",
            componentName: "a",
            relativeRect: { x: 0, y: 0, width: 80, height: 25 },
            computedStyles: {},
            intentFlags: {},
          },
        ],
        leaves: [
          {
            tagName: "span",
            selector: "span.text",
            componentName: "b",
            relativeRect: { x: 0, y: 0, width: 40, height: 20 },
          },
          {
            tagName: "i",
            selector: "i.icon",
            componentName: "c",
            relativeRect: { x: 0, y: 0, width: 16, height: 16 },
          },
        ],
        ancestors: [],
      },
    });

    await setUserLanguagePreference("zh-CN");
    const mdZh = buildAiPromptTemplate(minifiedPayload);
    // 单字母混淆组件名应规整封装为 <a>, <b>, <c>
    assert.match(mdZh, /（如 <a>, <b>, <c>）/);
  });

  test("3.4 混合模式：部分组件包含源码路径，部分组件丢失源码路径", async () => {
    await setUserLanguagePreference("zh-CN");
    const mixedPayload = createBasePayload({
      domContextTree: {
        smallestCommonAncestorSelector: "div#app",
        meta: {
          anchorCount: 2,
          leafCount: 0,
          ancestorCount: 0,
          truncated: false,
        },
        anchors: [
          // 锚点 1：有文件
          {
            selector: "button#anchor-with-file",
            selectorPath: "div#app > button#anchor-with-file",
            componentName: "<TrackedButton>",
            componentFile: "src/components/TrackedButton.tsx",
            componentLine: 88,
            relativeRect: { x: 0, y: 0, width: 100, height: 35 },
            computedStyles: {},
            intentFlags: { isArrowTarget: true },
          },
          // 锚点 2：三方组件或生产注入，无文件
          {
            selector: "div#third-party",
            selectorPath: "div#app > div#third-party",
            componentName: "<ThirdPartyWidget>",
            relativeRect: { x: 0, y: 50, width: 120, height: 40 },
            computedStyles: {},
            intentFlags: {},
          },
        ],
        leaves: [],
        ancestors: [],
      },
    });

    const md = buildAiPromptTemplate(mixedPayload);
    // 只要有任何有效物理路径，进入常规精准定位模式
    assert.match(
      md,
      /核心标注组件: <TrackedButton> -> `src\/components\/TrackedButton\.tsx:88`/
    );
    assert.ok(md.includes("src/components/TrackedButton.tsx:88"));
    // 无文件的三方组件不应作为文件项生成空条目
    assert.doesNotMatch(md, /`undefined`/);
    assert.doesNotMatch(md, /\* ``/);
  });

  test("3.5 Dual-Write 双写协议兼容性验证（仅 vueComponentStates 或仅 frameworkComponentStates）", () => {
    const mockState: FrameworkComponentStateSnapshot = {
      componentName: "<DualWriteComp>",
      componentFile: "src/DualWriteComp.vue",
      componentLine: 15,
      framework: "vue",
    };

    // Case 1: 仅有旧版 vueComponentStates
    const legacyPayload = createBasePayload({
      environment: {
        ...createBasePayload().environment,
        vueComponentStates: [mockState],
        frameworkComponentStates: undefined,
      },
    });
    const mdLegacy = buildAiPromptTemplate(legacyPayload);
    assert.ok(
      mdLegacy.includes("src/DualWriteComp.vue:15"),
      "当仅存在旧版 vueComponentStates 时，源码定位必须无缝回退并提取"
    );

    // Case 2: 仅有新版 frameworkComponentStates
    const modernPayload = createBasePayload({
      environment: {
        ...createBasePayload().environment,
        vueComponentStates: undefined,
        frameworkComponentStates: [mockState],
      },
    });
    const mdModern = buildAiPromptTemplate(modernPayload);
    assert.ok(
      mdModern.includes("src/DualWriteComp.vue:15"),
      "当仅存在新版 frameworkComponentStates 时，源码定位必须正常提取"
    );
  });

  test("3.6 极端缺省 Payload（缺少环境字段或全部为默认值）防崩溃与格式保全", () => {
    const emptyPayload: any = {
      version: "1.0",
      timestamp: 1700000000000,
      cropBounds: { x: 0, y: 0, width: 0, height: 0 },
      image: { base64Data: "", width: 0, height: 0, devicePixelRatio: 1 },
      annotations: [],
      annotationGroups: [],
      domContextTree: {
        smallestCommonAncestorSelector: "",
        meta: {
          anchorCount: 0,
          leafCount: 0,
          ancestorCount: 0,
          truncated: false,
        },
        anchors: [],
        leaves: [],
        ancestors: [],
      },
      environment: {
        url: "",
        title: "",
        userAgent: "",
        viewport: { width: 0, height: 0 },
        mediaBreakpoint: "",
        recentConsoleErrors: [],
        recentFailedRequests: [],
      },
    };

    // 无论字段多么空匮，都不允许抛出 TypeError 或返回畸变内容
    const md = buildAiPromptTemplate(emptyPayload);
    assert.ok(typeof md === "string");
    assert.match(md, /未知页面/);
    assert.match(md, /未知 URL/);
    assert.match(md, /- 选区尺寸：0x0 \(dpr: 1\.00\)/);
    assert.match(md, /- 异常日志：0 条 Console 报错 \| 0 个失败网络请求/);
    assert.match(md, /- 🎯 源码物理定位 \(Source Code Location\):/);
  });
});
