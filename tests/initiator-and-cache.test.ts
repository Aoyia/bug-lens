import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveCacheEvidence, isThirdPartyOrFrameworkFrame, sliceInitiator } from "../src/domain/initiator-slicer.ts";

describe("Initiator 堆栈剪枝与 Cache 来源判定单元测试", () => {
  describe("isThirdPartyOrFrameworkFrame 过滤逻辑", () => {
    it("过滤 chrome-extension 和第三方库帧", () => {
      assert.equal(isThirdPartyOrFrameworkFrame("chrome-extension://abc/background.js"), true);
      assert.equal(isThirdPartyOrFrameworkFrame("https://example.com/node_modules/axios/index.js"), true);
      assert.equal(isThirdPartyOrFrameworkFrame("https://example.com/node_modules/core-js/modules/es.promise.js"), true);
      assert.equal(isThirdPartyOrFrameworkFrame("https://example.com/app/main.ts"), false);
      assert.equal(isThirdPartyOrFrameworkFrame("http://localhost:3000/src/services/api.ts"), false);
    });
  });

  describe("sliceInitiator 剪枝逻辑", () => {
    it("从堆栈中精准提取首个业务帧，并剔除第三方库帧", () => {
      const cdpInitiator = {
        type: "script",
        stack: {
          callFrames: [
            { functionName: "dispatch", url: "https://example.com/node_modules/axios/lib/core/dispatchRequest.js", lineNumber: 10, columnNumber: 5 },
            { functionName: "getUserProfile", url: "https://example.com/src/services/user-service.ts?token=secret123", lineNumber: 41, columnNumber: 12 },
            { functionName: "onClick", url: "https://example.com/src/components/UserCard.tsx", lineNumber: 87, columnNumber: 3 }
          ]
        }
      };

      const sliced = sliceInitiator(cdpInitiator, "safe");
      assert.ok(sliced);
      assert.equal(sliced.type, "script");
      assert.ok(sliced.topFrame);
      assert.equal(sliced.topFrame.functionName, "getUserProfile");
      assert.equal(sliced.topFrame.url, "https://example.com/src/services/user-service.ts?token=[REDACTED]"); // 验证 URL 中的 Query Value 已被脱敏为 [REDACTED]
      assert.equal(sliced.topFrame.lineNumber, 42); // 1-indexed (41 + 1)
      assert.equal(sliced.topFrame.columnNumber, 13); // 1-indexed (12 + 1)
    });

    it("精准提炼 parent 异步起点的业务帧", () => {
      const cdpInitiator = {
        type: "script",
        stack: {
          callFrames: [
            { functionName: "request", url: "https://example.com/node_modules/axios/lib/axios.js", lineNumber: 5, columnNumber: 2 }
          ],
          parent: {
            callFrames: [
              { functionName: "fetchData", url: "https://example.com/src/actions/fetch.ts", lineNumber: 19, columnNumber: 8 }
            ]
          }
        }
      };

      const sliced = sliceInitiator(cdpInitiator, "raw");
      assert.ok(sliced);
      assert.ok(sliced.topFrame);
      assert.equal(sliced.topFrame.functionName, "request");
      assert.ok(sliced.asyncAnchorFrame);
      assert.equal(sliced.asyncAnchorFrame.functionName, "fetchData");
      assert.equal(sliced.asyncAnchorFrame.url, "https://example.com/src/actions/fetch.ts");
    });

    it("仅含有 url 的简单 initiator 能够提取 topFrame", () => {
      const cdpInitiator = {
        type: "parser",
        url: "https://example.com/index.html?key=val",
        lineNumber: 0,
        columnNumber: 0
      };

      const sliced = sliceInitiator(cdpInitiator, "safe");
      assert.ok(sliced);
      assert.equal(sliced.type, "parser");
      assert.equal(sliced.topFrame?.url, "https://example.com/index.html?key=[REDACTED]");
      assert.equal(sliced.topFrame?.lineNumber, 1);
      assert.ok(sliced.stack);
      assert.equal(sliced.stack.length, 1);
    });

    it("正确解析多层 Request Call Stack 链表并自动插入 asyncBoundary 节点", () => {
      const cdpInitiator = {
        type: "script",
        stack: {
          callFrames: [
            { functionName: "r.send", url: "https://example.com/sdk-glue.js", lineNumber: 0, columnNumber: 84752 },
            { functionName: "e", url: "https://example.com/bdms.js", lineNumber: 0, columnNumber: 1199 }
          ],
          parent: {
            description: "setTimeout",
            callFrames: [
              { functionName: "e.event", url: "https://example.com/f3ea53a.js", lineNumber: 3, columnNumber: 909 }
            ]
          }
        }
      };

      const sliced = sliceInitiator(cdpInitiator, "raw");
      assert.ok(sliced);
      assert.ok(sliced.stack);
      assert.equal(sliced.stack.length, 4); // 2 个同步帧 + 1 个 asyncBoundary 节点 + 1 个异步帧
      assert.equal(sliced.stack[0].functionName, "r.send");
      assert.equal(sliced.stack[1].functionName, "e");
      assert.equal(sliced.stack[2].asyncBoundary, "setTimeout");
      assert.equal(sliced.stack[3].functionName, "e.event");
    });
  });

  describe("deriveCacheEvidence Cache 来源推导", () => {
    it("正确识别 Memory Cache", () => {
      const cache = deriveCacheEvidence({ status: 200, protocol: "h2" }, true);
      assert.equal(cache.source, "memory");
      assert.equal(cache.revalidated, false);
      assert.equal(cache.protocol, "h2");
    });

    it("正确识别 Service Worker 缓存", () => {
      const cache = deriveCacheEvidence({ fromServiceWorker: true, status: 200 }, false);
      assert.equal(cache.source, "service-worker");
      assert.equal(cache.revalidated, false);
    });

    it("正确识别 Disk Cache", () => {
      const cache = deriveCacheEvidence({ fromDiskCache: true, status: 200 }, false);
      assert.equal(cache.source, "disk");
      assert.equal(cache.revalidated, false);
    });

    it("正确识别 Prefetch Cache", () => {
      const cache = deriveCacheEvidence({ fromPrefetchCache: true, status: 200 }, false);
      assert.equal(cache.source, "prefetch");
    });

    it("正确识别 304 协商重校验 (Revalidated Network)", () => {
      const cache = deriveCacheEvidence({ status: 304, protocol: "h2" }, false);
      assert.equal(cache.source, "network");
      assert.equal(cache.revalidated, true);
    });
  });
});
