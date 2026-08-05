import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { unzipSync } from "fflate";
import {
  buildScreenshotZipPackage,
  base64ToUint8Array,
  stringToUint8Array,
} from "../src/screenshot/screenshot-zip-builder.ts";
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
      tree: {
        tagName: "div",
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        attributes: {},
        computedStyles: {},
        children: [],
      },
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

  test("buildScreenshotZipPackage 正确打包 ZIP 且解压出完整的 4 大关键资源文件（包含合并标注的 screenshot.png）", async () => {
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
      unzipped["screenshot.png"],
      "必须包含合并标注的 screenshot.png 物理截图"
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
  });
});
