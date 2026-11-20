import { test } from "node:test";
import assert from "node:assert";
import { shouldCaptureResponseBody } from "../src/evidence/cdp-evidence-collector.ts";
import {
  fetchStyleSourceInfoWithCDP,
  isTabAlreadyAttached,
} from "../src/screenshot/probes/cdp-style-source";

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

test("fetchStyleSourceInfoWithCDP 当目标 Tab 已被外部调试器（如 DevTools）附着时直接返回 [] 且不调用 attach/sendCommand/detach", async () => {
  const originalChrome = (globalThis as { chrome?: unknown }).chrome;
  let attachCalls = 0;
  let sendCommandCalls = 0;
  let detachCalls = 0;

  (globalThis as { chrome?: unknown }).chrome = {
    debugger: {
      getTargets: async () => [{ tabId: 123, attached: true }],
      attach: async () => {
        attachCalls += 1;
      },
      sendCommand: async () => {
        sendCommandCalls += 1;
        return {};
      },
      detach: async () => {
        detachCalls += 1;
      },
    },
  };

  try {
    const res = await fetchStyleSourceInfoWithCDP(123, [".header", ".button"]);
    assert.deepEqual(res, []);
    assert.equal(attachCalls, 0);
    assert.equal(sendCommandCalls, 0);
    assert.equal(detachCalls, 0);
  } finally {
    if (originalChrome === undefined) {
      delete (globalThis as { chrome?: unknown }).chrome;
    } else {
      (globalThis as { chrome?: unknown }).chrome = originalChrome;
    }
  }
});

test("fetchStyleSourceInfoWithCDP 在未附着时正常 attach -> sendCommand -> finally detach", async () => {
  const originalChrome = (globalThis as { chrome?: unknown }).chrome;
  const calls: string[] = [];

  (globalThis as { chrome?: unknown }).chrome = {
    debugger: {
      getTargets: async () => [{ tabId: 123, attached: false }],
      attach: async () => {
        calls.push("attach");
      },
      sendCommand: async (_target: unknown, method: string) => {
        calls.push(`cmd:${method}`);
        if (method === "DOM.getDocument") return { root: { nodeId: 1 } };
        if (method === "DOM.querySelector") return { nodeId: 2 };
        if (method === "CSS.getMatchedStylesForNode") {
          return {
            matchedCSSRules: [
              {
                rule: {
                  selectorList: { text: ".header" },
                  range: { startLine: 10, startColumn: 2 },
                },
              },
            ],
          };
        }
        return {};
      },
      detach: async () => {
        calls.push("detach");
      },
    },
  };

  try {
    const res = await fetchStyleSourceInfoWithCDP(123, [".header"]);
    assert.equal(res.length, 1);
    assert.deepEqual(res[0], {
      selectorText: ".header",
      startLine: 10,
      startColumn: 2,
    });
    assert.equal(calls[0], "attach");
    assert.ok(calls.includes("cmd:DOM.enable"));
    assert.ok(calls.includes("cmd:CSS.enable"));
    assert.equal(calls[calls.length - 1], "detach");
  } finally {
    if (originalChrome === undefined) {
      delete (globalThis as { chrome?: unknown }).chrome;
    } else {
      (globalThis as { chrome?: unknown }).chrome = originalChrome;
    }
  }
});
