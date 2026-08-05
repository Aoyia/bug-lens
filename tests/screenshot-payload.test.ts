import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  formatPayloadToMarkdown,
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
      tree: {
        tagName: "button",
        id: "submit-btn",
        className: "btn btn-primary",
        innerText: "提交订单",
        selector: "button#submit-btn",
        rect: { x: 150, y: 220, width: 100, height: 40 },
        relativeRect: { x: 50, y: 20, width: 100, height: 40 },
        computedStyles: {
          color: "rgb(255, 255, 255)",
          backgroundColor: "rgb(0, 122, 255)",
        },
        frameworkMetadata: {
          componentName: "<OrderSubmitButton>",
          eventListeners: ["click"],
        },
        intentFlags: {
          isArrowTarget: true,
          textComment: "按钮点击失效",
        },
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
  });

  test("formatPayloadToHtml generates HTML with embedded image and markdown pre tag", () => {
    const html = formatPayloadToHtml(mockPayload, mockPayload.image.base64Data);
    assert.match(html, /<div data-bug-lens-version="1\.0"/);
    assert.match(html, /<img src="data:image\/png;base64,/);
    assert.match(html, /<pre style="/);
    assert.match(html, /请作为高级 Frontend\/Fullstack 调试专家/);
  });
});
