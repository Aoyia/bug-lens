import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  formatPayloadToMarkdown,
  formatPayloadToMarkdownForZip,
  buildAiPromptTemplate,
  formatPayloadToHtml,
  normalizePayloadKeyOrder,
  normalizeDomTreeKeyOrder,
  normalizeDomAnchorNodeKeyOrder,
  normalizeDomTreeNodeKeyOrder,
  normalizeDomLeafNodeKeyOrder,
  normalizeDomAncestorNodeKeyOrder,
  type AIScreenshotPayload,
  type FrameworkComponentStateSnapshot,
  type VueComponentStateSnapshot,
} from "../src/domain/screenshot-payload.ts";

import {
  findSmallestCommonAncestor,
  pruneAncestorElements,
} from "../src/screenshot/probes/dom-spatial-collector";

describe("Screenshot Payload Formatter", () => {
  const mockPayload: AIScreenshotPayload = {
    version: "1.0",
    timestamp: 1700000000000,
    cropBounds: { x: 100, y: 200, width: 400, height: 300 },
    image: {
      base64Data:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      width: 400,
      height: 300,
      devicePixelRatio: 2,
    },
    annotations: [
      {
        id: "ann_1",
        type: "text",
        position: { x: 150, y: 220 },
        text: "按钮点击失效",
      },
      {
        id: "ann_2",
        type: "arrow",
        startPoint: { x: 50, y: 50 },
        endPoint: { x: 150, y: 220 },
      },
      {
        id: "ann_3",
        type: "privacy",
        bounds: { x: 300, y: 200, width: 80, height: 30 },
      },
    ],
    annotationGroups: [
      {
        groupId: "group_1",
        shapeId: "ann_2",
        textId: "ann_1",
        type: "arrow_with_text",
      },
    ],
    domContextTree: {
      smallestCommonAncestorSelector: "div#app > form.login-form",
      meta: {
        leafCount: 1,
        maxDepth: 2,
      },
      tree: {
        tagName: "form",
        className: "login-form",
        selector: "form.login-form",
        componentName: "<LoginForm>",
        children: [
          {
            tagName: "button",
            id: "submit-btn",
            className: "btn btn-primary",
            selector: "button#submit-btn",
            innerText: "提交订单",
            relativeRect: { x: 50, y: 20, width: 100, height: 40 },
            componentName: "<OrderSubmitButton>",
            componentPath: ["<App>", "<OrderSubmitButton>"],
          },
        ],
      },
    },
    environment: {
      url: "https://example.com/checkout",
      title: "Checkout Page",
      userAgent: "Mozilla/5.0 (Macintosh)",
      viewport: { width: 1440, height: 900 },
      mediaBreakpoint: "desktop",
      recentConsoleErrors: [
        {
          message:
            "Uncaught TypeError: Cannot read properties of undefined (reading 'submit')",
          stack:
            "TypeError: Cannot read properties of undefined\n at onClick (app.js:42)",
          timestamp: 1700000000000,
        },
      ],
      recentFailedRequests: [
        {
          url: "https://example.com/api/v1/checkout",
          method: "POST",
          status: 500,
          statusText: "Internal Server Error",
          timestamp: 1700000000000,
        },
      ],
    },
  };

  test("formatPayloadToMarkdown generates valid Markdown with annotations and errors (Chinese)", async () => {
    const { setUserLanguagePreference } = await import("../src/shared/i18n.ts");
    await setUserLanguagePreference("zh-CN");
    const md = formatPayloadToMarkdown(mockPayload);
    assert.match(md, /请作为高级 Frontend\/Fullstack 调试专家/);
    assert.match(md, /https:\/\/example\.com\/checkout/);
    assert.match(md, /1 条 Console 报错 \| 1 个失败网络请求/);
    assert.match(md, /\(dpr: \d+\.\d{2}\)/);
    // 未提供路径时保留占位符，等待用户手动替换
    assert.match(md, /请将这里替换为导出的 ZIP 绝对路径/);
  });

  test("formatPayloadToMarkdown generates valid Markdown in English", async () => {
    const { setUserLanguagePreference } = await import("../src/shared/i18n.ts");
    await setUserLanguagePreference("en-US");
    const md = formatPayloadToMarkdown(mockPayload);
    assert.match(
      md,
      /Please act as a Senior Frontend\/Fullstack Debugging Expert/
    );
    assert.match(md, /https:\/\/example\.com\/checkout/);
    assert.match(md, /1 console error\(s\) \| 1 failed network request\(s\)/);
    assert.match(
      md,
      /File Path:\n\{Please replace this with the absolute path/
    );

    // Reset back
    await setUserLanguagePreference("auto");
  });

  test("包含 cascadeIndex 时在 Markdown Prompt 中追加级联快照说明", () => {
    const payloadWithCascade: AIScreenshotPayload = {
      ...mockPayload,
      cascadeIndex: {
        version: "1.0",
        timestamp: 1700000000000,
        cropBounds: { x: 0, y: 0, width: 100, height: 100 },
        sheets: [],
        rules: [],
        elements: [],
        perProperty: {},
        meta: {
          sheetCount: 0,
          ruleCount: 0,
          elementCount: 0,
          truncatedRules: 0,
          truncatedSheets: 0,
          cdpLineInfo: true,
        },
      },
    };
    const md = formatPayloadToMarkdown(payloadWithCascade, "/tmp/test.zip");
    assert.strictEqual(md.includes("Cascade Index"), true);
    assert.strictEqual(md.includes("cascade.json"), true);
  });

  test("当存在 Flex 弹性挤压风险节点时在 Prompt 中自动注入诊断提示", () => {
    const payloadWithSqueeze: AIScreenshotPayload = {
      ...mockPayload,
      domContextTree: {
        ...mockPayload.domContextTree,
        anchors: [
          {
            selector: ".user-tag-badge",
            selectorPath: "body > div > .user-tag-badge",
            relativeRect: { x: 0, y: 0, width: 80, height: 20 },
            computedStyles: {},
            intentFlags: {},
            layoutContext: {
              isFlexOrGridItem: true,
              flexSqueezeRisk: {
                isSqueezed: true,
                intrinsicWidth: 120,
                renderedWidth: 80,
                squeezedWidthDelta: 40,
                squeezeRatio: 0.33,
                flexShrink: 1,
                reason: "Flex 被强制挤压",
              },
            },
          },
        ],
      },
    };
    const md = formatPayloadToMarkdown(payloadWithSqueeze);
    assert.strictEqual(md.includes("Flex 布局限制存在挤压变形风险"), true);
    assert.strictEqual(md.includes(".user-tag-badge"), true);
    assert.strictEqual(md.includes("flex-shrink: 1"), true);
  });

  test("当存在文本截断或 Grid 轨道溢出节点时在 Prompt 中自动注入诊断提示", () => {
    const payloadWithLayoutDeviations: AIScreenshotPayload = {
      ...mockPayload,
      domContextTree: {
        ...mockPayload.domContextTree,
        anchors: [
          {
            selector: ".product-title",
            selectorPath: "body > div > .product-title",
            relativeRect: { x: 0, y: 0, width: 100, height: 20 },
            computedStyles: {},
            intentFlags: {},
            layoutContext: {
              isFlexOrGridItem: true,
              textOverflow: {
                isTruncated: true,
                truncationType: "single_line",
                scrollDimension: { width: 160, height: 20 },
                clientDimension: { width: 100, height: 20 },
                overflowDelta: { width: 60, height: 0 },
                reason: "单行省略",
              },
              gridSelf: {
                isGridItem: true,
                isGridOverflow: true,
                reason: "Grid 项撑爆",
              },
            },
          },
        ],
      },
    };
    const md = formatPayloadToMarkdown(payloadWithLayoutDeviations);
    assert.strictEqual(md.includes("文本隐蔽截断与 Overflow 溢出"), true);
    assert.strictEqual(md.includes("CSS Grid 子项因默认"), true);
    assert.strictEqual(md.includes(".product-title"), true);
  });

  test("formatPayloadToMarkdown injects the real ZIP absolute path when zipPath is provided", () => {
    const md = formatPayloadToMarkdown(
      mockPayload,
      "/Users/tester/Downloads/bug-lens-screenshot-2026-08-06.zip"
    );
    assert.match(
      md,
      /文件路径：\n\/Users\/tester\/Downloads\/bug-lens-screenshot-2026-08-06\.zip/
    );
    assert.doesNotMatch(md, /请将这里替换为导出的 ZIP 绝对路径/);
  });

  test("formatPayloadToMarkdownForZip 使用引导文案而非占位符，避免误导 AI", () => {
    const md = formatPayloadToMarkdownForZip(mockPayload);
    // 保留提示词主体
    assert.match(md, /请作为高级 Frontend\/Fullstack 调试专家/);
    // 不包含占位符
    assert.doesNotMatch(md, /请将这里替换为导出的 ZIP 绝对路径/);
    // 包含引导文案与剪贴板路径提示
    assert.match(md, /真实绝对路径已写入剪贴板提示词/);
  });

  test("formatPayloadToHtml generates HTML with embedded image and markdown pre tag", () => {
    const html = formatPayloadToHtml(mockPayload, mockPayload.image.base64Data);
    assert.match(html, /<div data-bug-lens-version="1\.0"/);
    assert.match(html, /<img src="data:image\/png;base64,/);
    assert.match(html, /<pre style="/);
    assert.match(html, /请作为高级 Frontend\/Fullstack 调试专家/);
  });

  test("normalizePayloadKeyOrder and normalizeDomTreeKeyOrder put tree / image at the very bottom", () => {
    const normalizedPayload = normalizePayloadKeyOrder(mockPayload);
    const payloadKeys = Object.keys(normalizedPayload);
    assert.strictEqual(payloadKeys[0], "version");
    assert.strictEqual(payloadKeys[1], "timestamp");
    assert.strictEqual(payloadKeys[2], "annotations");
    assert.strictEqual(payloadKeys[payloadKeys.length - 1], "image");

    const normalizedTree = normalizeDomTreeKeyOrder(mockPayload.domContextTree);
    const treeKeys = Object.keys(normalizedTree);
    assert.strictEqual(treeKeys[0], "smallestCommonAncestorSelector");
    assert.strictEqual(treeKeys[1], "meta");
    assert.strictEqual(treeKeys[treeKeys.length - 1], "tree");

    if (normalizedTree.tree) {
      const nodeKeys = Object.keys(normalizedTree.tree);
      assert.strictEqual(nodeKeys[nodeKeys.length - 1], "children");
    }
  });

  test("pruneAncestorElements 应当正确过滤包裹子节点的父容器", () => {
    assert.strictEqual(typeof pruneAncestorElements, "function");
    assert.strictEqual(typeof findSmallestCommonAncestor, "function");

    const makeNode = (name: string, children: any[] = []) => {
      const node = {
        nodeName: name,
        contains: (other: any) => {
          if (other === node) return true;
          return children.some(
            (c) => c === other || (c.contains && c.contains(other))
          );
        },
        parentElement: null as any,
      };
      for (const child of children) {
        child.parentElement = node;
      }
      return node as unknown as Element;
    };

    const button = makeNode("BUTTON");
    const input = makeNode("INPUT");
    const wrapper = makeNode("DIV", [button, input]);
    const form = makeNode("FORM", [wrapper]);

    // pruneAncestorElements 依然保持极小化叶节点收集逻辑
    const pruned = pruneAncestorElements([form, button]);
    assert.strictEqual(pruned.length, 1);
    assert.strictEqual(pruned[0], button);

    // 修复后：findSmallestCommonAncestor 不再被 prune 竞争影响
    // 1. 包含父级 Form 和子级 Button 的场景，应该正确返回父级 Form，而不是降维提升到 wrapper
    assert.strictEqual(findSmallestCommonAncestor([form, button]), form);

    // 2. 真正的单节点场景，提升为其直接父节点
    assert.strictEqual(findSmallestCommonAncestor([button]), wrapper);

    // 3. 两个无父子关系的兄弟节点，返回它们的共同父节点 wrapper
    assert.strictEqual(findSmallestCommonAncestor([button, input]), wrapper);
  });

  test("normalizeDomTreeKeyOrder 保持 componentFile 与 componentLine 的确定性 key 顺序", () => {
    // 1. DomAnchorNode
    const anchorNode: any = {
      tagName: "button",
      computedStyles: { color: "red" },
      componentLine: 42,
      selector: "button#submit",
      componentFile: "src/components/TodoItem.vue",
      selectorPath: "div > button#submit",
      intentFlags: { isArrowTarget: true },
      componentName: "<TodoItem>",
      componentPath: ["<App>", "<TodoList>", "<TodoItem>"],
      relativeRect: { x: 0, y: 0, width: 100, height: 40 },
    };
    const normAnchor = normalizeDomAnchorNodeKeyOrder(anchorNode);
    const anchorKeys = Object.keys(normAnchor);
    const nameIdx = anchorKeys.indexOf("componentName");
    const pathIdx = anchorKeys.indexOf("componentPath");
    const fileIdx = anchorKeys.indexOf("componentFile");
    const lineIdx = anchorKeys.indexOf("componentLine");
    const tagIdx = anchorKeys.indexOf("tagName");
    assert.ok(nameIdx < pathIdx, "componentName should precede componentPath");
    assert.ok(pathIdx < fileIdx, "componentPath should precede componentFile");
    assert.ok(fileIdx < lineIdx, "componentFile should precede componentLine");
    assert.ok(lineIdx < tagIdx, "componentLine should precede tagName");

    // 2. DomTreeNode
    const treeNode: any = {
      children: [],
      tagName: "div",
      data: { count: 1 },
      componentLine: 10,
      props: { title: "demo" },
      selector: "div.container",
      componentFile: "src/App.tsx",
      componentName: "<App>",
      componentPath: ["<App>"],
      relativeRect: { x: 0, y: 0, width: 200, height: 100 },
    };
    const normTree = normalizeDomTreeNodeKeyOrder(treeNode);
    const treeKeys = Object.keys(normTree);
    const tNameIdx = treeKeys.indexOf("componentName");
    const tPathIdx = treeKeys.indexOf("componentPath");
    const tFileIdx = treeKeys.indexOf("componentFile");
    const tLineIdx = treeKeys.indexOf("componentLine");
    const tPropsIdx = treeKeys.indexOf("props");
    const tDataIdx = treeKeys.indexOf("data");
    assert.ok(
      tNameIdx < tPathIdx,
      "componentName should precede componentPath"
    );
    assert.ok(
      tPathIdx < tFileIdx,
      "componentPath should precede componentFile"
    );
    assert.ok(
      tFileIdx < tLineIdx,
      "componentFile should precede componentLine"
    );
    assert.ok(tLineIdx < tPropsIdx, "componentLine should precede props");
    assert.ok(tPropsIdx < tDataIdx, "props should precede data");

    // 3. DomLeafNode
    const leafNode: any = {
      computedStyles: {},
      componentLine: 15,
      relativeRect: { x: 0, y: 0, width: 50, height: 20 },
      selector: "span.label",
      componentFile: "src/components/Label.vue",
      componentName: "<Label>",
      tagName: "span",
    };
    const normLeaf = normalizeDomLeafNodeKeyOrder(leafNode);
    const leafKeys = Object.keys(normLeaf);
    const lNameIdx = leafKeys.indexOf("componentName");
    const lFileIdx = leafKeys.indexOf("componentFile");
    const lLineIdx = leafKeys.indexOf("componentLine");
    const lTagIdx = leafKeys.indexOf("tagName");
    assert.ok(
      lNameIdx < lFileIdx,
      "componentName should precede componentFile"
    );
    assert.ok(
      lFileIdx < lLineIdx,
      "componentFile should precede componentLine"
    );
    assert.ok(lLineIdx < lTagIdx, "componentLine should precede tagName");

    // 4. DomAncestorNode
    const ancestorNode: any = {
      depth: 1,
      componentFile: "src/Layout.vue",
      selector: "div.layout",
      componentName: "<Layout>",
      tagName: "div",
    };
    const normAncestor = normalizeDomAncestorNodeKeyOrder(ancestorNode);
    const ancKeys = Object.keys(normAncestor);
    const aNameIdx = ancKeys.indexOf("componentName");
    const aFileIdx = ancKeys.indexOf("componentFile");
    const aSelIdx = ancKeys.indexOf("selector");
    assert.ok(
      aNameIdx < aFileIdx,
      "componentName should precede componentFile"
    );
    assert.ok(aFileIdx < aSelIdx, "componentFile should precede selector");
  });

  test("buildAiPromptTemplate 生成包含「🎯 源码物理定位」的直接文件与行号排查指引（中文模式）", async () => {
    const { setUserLanguagePreference } = await import("../src/shared/i18n.ts");
    await setUserLanguagePreference("zh-CN");

    const payloadWithSource: AIScreenshotPayload = {
      ...mockPayload,
      domContextTree: {
        ...mockPayload.domContextTree,
        anchors: [
          {
            selector: "button#submit-btn",
            selectorPath: "div#app > form.login-form > button#submit-btn",
            componentName: "<OrderSubmitButton>",
            componentPath: ["<App>", "<OrderSubmitButton>"],
            componentFile: "src/components/OrderSubmitButton.tsx",
            componentLine: 42,
            relativeRect: { x: 50, y: 20, width: 100, height: 40 },
            computedStyles: {},
            intentFlags: { isArrowTarget: true },
          },
        ],
        tree: {
          tagName: "form",
          selector: "form.login-form",
          componentName: "<LoginForm>",
          componentFile: "src/views/LoginForm.vue",
          componentPath: ["<App>", "<LoginForm>"],
          children: [
            {
              tagName: "button",
              selector: "button#submit-btn",
              componentName: "<OrderSubmitButton>",
              componentPath: ["<App>", "<OrderSubmitButton>"],
              componentFile: "src/components/OrderSubmitButton.tsx",
              componentLine: 42,
              props: { disabled: false },
              data: { submitting: false },
            },
          ],
        },
      },
      environment: {
        ...mockPayload.environment,
        frameworkComponentStates: [
          {
            componentName: "<OrderSubmitButton>",
            componentPath: ["<App>", "<OrderSubmitButton>"],
            framework: "react",
            componentFile: "src/components/OrderSubmitButton.tsx",
            componentLine: 42,
            props: { disabled: false },
            data: { submitting: false },
          },
        ],
        vueComponentStates: [
          {
            componentName: "<OrderSubmitButton>",
            componentPath: ["<App>", "<OrderSubmitButton>"],
            framework: "react",
            componentFile: "src/components/OrderSubmitButton.tsx",
            componentLine: 42,
            props: { disabled: false },
            data: { submitting: false },
          },
        ],
      },
    };

    const md = buildAiPromptTemplate(payloadWithSource);
    assert.match(md, /- 🎯 源码物理定位 \(Source Code Location\):/);
    assert.match(
      md,
      /核心标注组件: <OrderSubmitButton> -> `src\/components\/OrderSubmitButton\.tsx:42`/
    );
    assert.match(
      md,
      /\* `src\/components\/OrderSubmitButton\.tsx:42` \(<OrderSubmitButton>\)/
    );
    assert.match(md, /\* `src\/views\/LoginForm\.vue` \(<LoginForm>\)/);
    assert.match(
      md,
      /💡 提示：已捕获物理源码路径，请直接在 IDE 中打开对应文件及行号进行代码排查与修复。/
    );
    assert.match(
      md,
      /源码直达：若上方已定位物理源码路径，优先在 IDE 中直接打开对应文件及行号/
    );
    assert.match(md, /frameworkComponentStates/);
  });

  test("buildAiPromptTemplate 生成包含「🎯 源码物理定位」的直接文件与行号排查指引（英文模式）", async () => {
    const { setUserLanguagePreference } = await import("../src/shared/i18n.ts");
    await setUserLanguagePreference("en-US");

    const payloadWithSource: AIScreenshotPayload = {
      ...mockPayload,
      domContextTree: {
        ...mockPayload.domContextTree,
        anchors: [
          {
            selector: "button#submit-btn",
            selectorPath: "div#app > form.login-form > button#submit-btn",
            componentName: "<OrderSubmitButton>",
            componentFile: "src/components/OrderSubmitButton.tsx",
            componentLine: 42,
            relativeRect: { x: 50, y: 20, width: 100, height: 40 },
            computedStyles: {},
            intentFlags: { isArrowTarget: true },
          },
        ],
      },
      environment: {
        ...mockPayload.environment,
        frameworkComponentStates: [
          {
            componentName: "<OrderSubmitButton>",
            framework: "react",
            componentFile: "src/components/OrderSubmitButton.tsx",
            componentLine: 42,
          },
        ],
      },
    };

    const md = buildAiPromptTemplate(payloadWithSource);
    assert.match(md, /- 🎯 源码物理定位 \(Source Code Location\):/);
    assert.match(
      md,
      /Primary Component: <OrderSubmitButton> -> `src\/components\/OrderSubmitButton\.tsx:42`/
    );
    assert.match(
      md,
      /💡 Tip: Physical source paths captured\. Open the file and line directly in your IDE to investigate and patch\./
    );
    assert.match(
      md,
      /Source Direct Navigation: If physical source paths are identified above/
    );

    await setUserLanguagePreference("auto");
  });

  test("buildAiPromptTemplate 生产构建降级指引（无 componentFile）", async () => {
    const { setUserLanguagePreference } = await import("../src/shared/i18n.ts");
    await setUserLanguagePreference("zh-CN");

    const prodPayload: AIScreenshotPayload = {
      ...mockPayload,
      domContextTree: {
        ...mockPayload.domContextTree,
        anchors: [],
        tree: {
          tagName: "div",
          selector: "div.root",
          componentName: "<App>",
        },
      },
    };

    const mdZh = buildAiPromptTemplate(prodPayload);
    assert.match(mdZh, /- 🎯 源码物理定位 \(Source Code Location\):/);
    assert.match(
      mdZh,
      /未捕获到物理源码路径（页面可能处于生产构建或混淆模式），请参考 DOM 结构与组件名/
    );

    await setUserLanguagePreference("en-US");
    const mdEn = buildAiPromptTemplate(prodPayload);
    assert.match(mdEn, /- 🎯 源码物理定位 \(Source Code Location\):/);
    assert.match(
      mdEn,
      /No physical source paths captured \(the page may be a production build or minified\)/
    );

    await setUserLanguagePreference("auto");
  });

  test("FrameworkComponentStateSnapshot 与 VueComponentStateSnapshot 双向类型兼容与环境支持", () => {
    const snapshot: FrameworkComponentStateSnapshot = {
      componentName: "TodoItem",
      componentPath: ["App", "TodoList", "TodoItem"],
      framework: "vue",
      componentFile: "src/components/TodoItem.vue",
      componentLine: undefined,
      props: { item: { id: 1, text: "Buy milk" } },
      data: { isEditing: false },
    };
    const vueSnapshot: VueComponentStateSnapshot = snapshot;
    assert.strictEqual(vueSnapshot.componentName, "TodoItem");
    assert.strictEqual(vueSnapshot.framework, "vue");
    assert.strictEqual(
      vueSnapshot.componentFile,
      "src/components/TodoItem.vue"
    );
  });
});
