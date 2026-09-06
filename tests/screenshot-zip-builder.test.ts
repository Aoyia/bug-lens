import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { unzipSync } from "fflate";
import {
  buildScreenshotZipPackage,
  base64ToUint8Array,
  stringToUint8Array,
} from "../src/screenshot/pipeline/screenshot-zip-builder";
import type { AIScreenshotPayload } from "../src/domain/screenshot-payload.ts";

describe("Screenshot ZIP Builder - 资源包压缩与解压验证", () => {
  const dummyPayload: AIScreenshotPayload = {
    version: "1.0",
    timestamp: 1700000000000,
    cropBounds: { x: 0, y: 0, width: 100, height: 100 },
    image: {
      base64Data:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      width: 100,
      height: 100,
      devicePixelRatio: 1,
    },
    annotations: [],
    annotationGroups: [],
    domContextTree: {
      smallestCommonAncestorSelector: "body",
      meta: {
        leafCount: 0,
        maxDepth: 0,
      },
      anchors: [],
      leaves: [],
      ancestors: [],
    },
    environment: {
      url: "https://example.com",
      title: "Example Test",
      userAgent: "NodeTestAgent",
      viewport: { width: 1024, height: 768 },
      mediaBreakpoint: "desktop",
      recentConsoleErrors: [],
      recentFailedRequests: [],
    },
  };

  test("base64ToUint8Array 与 stringToUint8Array 正常转换数据", () => {
    const u8 = base64ToUint8Array(dummyPayload.image.base64Data);
    assert.ok(u8 instanceof Uint8Array);
    assert.ok(u8.byteLength > 0);

    const strU8 = stringToUint8Array("hello bug lens");
    assert.equal(new TextDecoder().decode(strU8), "hello bug lens");
  });

  test("buildScreenshotZipPackage 正确打包 ZIP 且解压出完整的 4 大关键资源文件（包含合并标注的 screenshot.jpg）", async () => {
    const pack = buildScreenshotZipPackage(dummyPayload);
    assert.ok(pack);
    assert.ok(pack.filename.startsWith("bug-lens-screenshot-"));
    assert.ok(pack.filename.endsWith(".zip"));
    assert.ok(
      pack.markdownPrompt.includes("请作为高级 Frontend/Fullstack 调试专家")
    );

    // 将生成的 Uint8Array Blob 解压进行强力验证
    const u8 = new Uint8Array(await pack.blob.arrayBuffer());
    const unzipped = unzipSync(u8);

    assert.ok(
      unzipped["screenshot.jpg"],
      "必须包含合并标注的 screenshot.jpg 物理截图"
    );
    assert.ok(
      unzipped["ai-prompt.md"],
      "必须包含 Markdown 格式的 ai-prompt.md"
    );
    assert.ok(
      unzipped["dom-context.json"],
      "必须包含选区 DOM 树 dom-context.json"
    );
    assert.ok(
      unzipped["environment.json"],
      "必须包含环境日志 environment.json"
    );

    const promptText = new TextDecoder().decode(unzipped["ai-prompt.md"]);
    assert.ok(promptText.includes("https://example.com"));
    // zip 内 ai-prompt.md 使用引导文案而非路径占位符（打包先于下载，无法预知真实路径）
    assert.ok(
      !promptText.includes("请将这里替换为导出的 ZIP 绝对路径"),
      "ai-prompt.md 不应包含路径占位符"
    );
    // JSON 采用标准美化格式化（2 空格缩进，便于阅读）
    const domText = new TextDecoder().decode(unzipped["dom-context.json"]);
    assert.equal(domText, JSON.stringify(dummyPayload.domContextTree, null, 2));
    const envText = new TextDecoder().decode(unzipped["environment.json"]);
    assert.equal(envText, JSON.stringify(dummyPayload.environment, null, 2));
  });

  test("base64ToUint8Array 支持无 data: 前缀的纯 base64 字符串", () => {
    const rawBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const u8 = base64ToUint8Array(rawBase64);
    assert.ok(u8 instanceof Uint8Array);
    assert.equal(u8.byteLength, 70);
  });

  test("buildScreenshotZipPackage 正确打包包含 cascade.json 的完整 ZIP 且图片字节精确一致", async () => {
    const payloadWithCascade: AIScreenshotPayload = {
      ...dummyPayload,
      cascadeIndex: {
        meta: {
          timestamp: 1700000000000,
          bounds: { x: 0, y: 0, width: 100, height: 100 },
        },
        elements: [],
        rules: [],
      } as any,
    };
    const pack = buildScreenshotZipPackage(payloadWithCascade);
    const u8 = new Uint8Array(await pack.blob.arrayBuffer());
    const unzipped = unzipSync(u8);

    assert.ok(unzipped["screenshot.jpg"]);
    assert.ok(unzipped["cascade.json"]);

    // 验证 Level 0 存储的图片解压后字节与原始图片完全一致
    const expectedImgU8 = base64ToUint8Array(dummyPayload.image.base64Data);
    assert.deepEqual(unzipped["screenshot.jpg"], expectedImgU8);
  });

  test("buildScreenshotZipPackage 正确打包包含 frameworkComponentStates/vueComponentStates 与 componentFile/componentLine 的 ZIP 产物并完成解压强验证", async () => {
    const states = [
      {
        componentName: "<TodoItem>",
        componentPath: ["<App>", "<TodoList>", "<TodoItem>"],
        framework: "vue" as const,
        componentFile: "src/components/TodoItem.vue",
        componentLine: 55,
        props: { id: "item-1" },
        data: { title: "Buy groceries" },
      },
    ];

    const payloadWithFramework: AIScreenshotPayload = {
      ...dummyPayload,
      domContextTree: {
        ...dummyPayload.domContextTree,
        anchors: [
          {
            selector: "li.todo-item",
            selectorPath: "ul > li.todo-item",
            componentName: "<TodoItem>",
            componentPath: ["<App>", "<TodoList>", "<TodoItem>"],
            componentFile: "src/components/TodoItem.vue",
            componentLine: 55,
            relativeRect: { x: 10, y: 10, width: 80, height: 25 },
            computedStyles: {},
            intentFlags: { isArrowTarget: true },
          },
        ],
        tree: {
          tagName: "div",
          selector: "div#app",
          componentName: "<App>",
          componentFile: "src/App.vue",
          children: [
            {
              tagName: "li",
              selector: "li.todo-item",
              componentName: "<TodoItem>",
              componentPath: ["<App>", "<TodoList>", "<TodoItem>"],
              componentFile: "src/components/TodoItem.vue",
              componentLine: 55,
              props: { id: "item-1" },
              data: { title: "Buy groceries" },
            },
          ],
        },
      },
      environment: {
        ...dummyPayload.environment,
        frameworkComponentStates: states,
        vueComponentStates: states,
      },
    };

    const pack = buildScreenshotZipPackage(payloadWithFramework);
    const u8 = new Uint8Array(await pack.blob.arrayBuffer());
    const unzipped = unzipSync(u8);

    // 1. 验证 dom-context.json
    assert.ok(unzipped["dom-context.json"]);
    const domParsed = JSON.parse(
      new TextDecoder().decode(unzipped["dom-context.json"])
    );
    assert.equal(
      domParsed.anchors[0].componentFile,
      "src/components/TodoItem.vue"
    );
    assert.equal(domParsed.anchors[0].componentLine, 55);
    assert.equal(domParsed.tree.componentFile, "src/App.vue");
    assert.equal(
      domParsed.tree.children[0].componentFile,
      "src/components/TodoItem.vue"
    );
    assert.equal(domParsed.tree.children[0].componentLine, 55);

    // 2. 验证 environment.json 双写
    assert.ok(unzipped["environment.json"]);
    const envParsed = JSON.parse(
      new TextDecoder().decode(unzipped["environment.json"])
    );
    assert.deepEqual(envParsed.frameworkComponentStates, states);
    assert.deepEqual(envParsed.vueComponentStates, states);

    // 3. 验证 ai-prompt.md 源码指引
    assert.ok(unzipped["ai-prompt.md"]);
    const promptMd = new TextDecoder().decode(unzipped["ai-prompt.md"]);
    assert.match(promptMd, /- 🎯 源码物理定位 \(Source Code Location\):/);
    assert.match(promptMd, /src\/components\/TodoItem\.vue:55/);
    assert.match(
      promptMd,
      /💡 提示：已捕获物理源码路径，请直接在 IDE 中打开对应文件及行号进行代码排查与修复。/
    );
    assert.match(
      promptMd,
      /源码直达：若上方已定位物理源码路径，优先在 IDE 中直接打开对应文件及行号/
    );
  });
});
