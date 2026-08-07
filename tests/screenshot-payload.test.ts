import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  formatPayloadToMarkdown,
  formatPayloadToMarkdownForZip,
  formatPayloadToHtml,
  type AIScreenshotPayload,
} from "../src/domain/screenshot-payload.ts";

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

  test("formatPayloadToMarkdown generates valid Markdown with annotations and errors", () => {
    const md = formatPayloadToMarkdown(mockPayload);
    assert.match(md, /请作为高级 Frontend\/Fullstack 调试专家/);
    assert.match(md, /https:\/\/example\.com\/checkout/);
    assert.match(md, /1 条 Console 报错 \| 1 个失败网络请求/);
    assert.match(md, /\(dpr: \d+\.\d{2}\)/);
    // 未提供路径时保留占位符，等待用户手动替换
    assert.match(md, /请将这里替换为导出的 ZIP 绝对路径/);
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
});
