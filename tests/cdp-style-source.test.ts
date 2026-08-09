import { test } from "node:test";
import assert from "node:assert";
import { shouldCaptureResponseBody } from "../src/evidence/cdp-evidence-collector.ts";
import {
  fetchStyleSourceInfoWithCDP,
  isTabAlreadyAttached,
} from "../src/screenshot/cdp-style-source.ts";

test("shouldCaptureResponseBody 能正确允许文本类型并排除图片/字体/音视频等大文件", () => {
  // 文本类 JSON / HTML / JS / XML / Form -> 应当拉取
  assert.equal(shouldCaptureResponseBody("application/json"), true);
  assert.equal(shouldCaptureResponseBody("text/html; charset=utf-8"), true);
  assert.equal(shouldCaptureResponseBody("application/javascript"), true);
  assert.equal(shouldCaptureResponseBody("text/css"), true);
  assert.equal(shouldCaptureResponseBody("application/xml"), true);

  // 图像 / 字体 / 媒体 -> 应当跳过
  assert.equal(shouldCaptureResponseBody("image/png"), false);
  assert.equal(shouldCaptureResponseBody("image/jpeg"), false);
  assert.equal(shouldCaptureResponseBody("font/woff2"), false);
  assert.equal(shouldCaptureResponseBody("video/mp4"), false);

  // 无 mimeType 时根据后缀判断
  assert.equal(
    shouldCaptureResponseBody(undefined, "https://example.com/api/data"),
    true
  );
  assert.equal(
    shouldCaptureResponseBody(undefined, "https://example.com/logo.png"),
    false
  );
  assert.equal(
    shouldCaptureResponseBody(undefined, "https://example.com/font.woff2"),
    false
  );
});

test("isTabAlreadyAttached 在无 chrome.debugger 环境下安全降级返回 false", async () => {
  const result = await isTabAlreadyAttached(123);
  assert.equal(result, false);
});

test("fetchStyleSourceInfoWithCDP 在无调试器的 Node 环境中可以静默降级并返回空数组", async () => {
  const res = await fetchStyleSourceInfoWithCDP(123, [".header", ".button"]);
  assert.deepEqual(res, []);
});
