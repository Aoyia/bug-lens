import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  clearSourceMapWorkerCache,
  processBatchResolution,
} from "../src/sourcemap/internal/sourcemap.worker.js";
import {
  SourceMapWorkerClient,
  registerInProcessResolver,
} from "../src/sourcemap/internal/sourcemap-worker-client.js";
import { SourceMapFetcher } from "../src/sourcemap/internal/sourcemap-fetcher.js";

registerInProcessResolver(processBatchResolution);

describe("SourceMapWorker & Client", () => {
  test("processes batch resolution with in-memory direct fallback", async () => {
    clearSourceMapWorkerCache();
    const client = new SourceMapWorkerClient();
    const results = await client.resolveBatch([
      {
        id: "entry_1",
        scriptUrl: "https://example.com/not-exist.js",
        line: 10,
        column: 5,
      },
    ]);

    assert.ok(results["entry_1"]);
    assert.equal(results["entry_1"].resolved, false);
    assert.equal(results["entry_1"].failureReason, "FETCH_FAILED");
  });

  test("handles empty items array gracefully", async () => {
    const client = new SourceMapWorkerClient();
    const results = await client.resolveBatch([]);
    assert.deepEqual(results, {});
  });

  test("并行拉取多个独立 scriptUrl（耗时从累加 O(∑ Ti) 降为 O(max Ti)）+ 虚拟协议 O(1) 预过滤 + HTTP 404 负缓存", async () => {
    clearSourceMapWorkerCache();
    const originalFetchMap = SourceMapFetcher.fetchMap.bind(SourceMapFetcher);
    let fetchCalls = 0;

    SourceMapFetcher.fetchMap = async (url: string) => {
      fetchCalls += 1;
      await new Promise((r) => setTimeout(r, 60));
      return {
        success: false,
        reason: "FETCH_FAILED",
        status: 404,
      };
    };

    try {
      const t0 = performance.now();
      const res = await processBatchResolution({
        type: "RESOLVE_BATCH_REQUEST",
        requestId: "req_parallel",
        items: [
          {
            id: "1",
            scriptUrl: "https://cdn.example.com/a.js",
            line: 1,
            column: 1,
          },
          {
            id: "2",
            scriptUrl: "https://cdn.example.com/b.js",
            line: 1,
            column: 1,
          },
          {
            id: "3",
            scriptUrl: "https://cdn.example.com/c.js",
            line: 1,
            column: 1,
          },
          {
            id: "4",
            scriptUrl: "https://cdn.example.com/d.js",
            line: 1,
            column: 1,
          },
          // 非网络虚拟协议：应被 O(1) 过滤，不触发 fetchMap
          { id: "5", scriptUrl: "<anonymous>", line: 1, column: 1 },
          {
            id: "6",
            scriptUrl: "blob:https://example.com/uuid",
            line: 1,
            column: 1,
          },
          {
            id: "7",
            scriptUrl: "extensions::SafeBuiltins",
            line: 1,
            column: 1,
          },
        ],
      });
      const elapsedMs = performance.now() - t0;

      // 4 个 60ms 请求并行执行，总耗时应远小于串行的 240ms
      assert.ok(
        elapsedMs < 180,
        `并行拉取耗时应小于 180ms，实际为 ${elapsedMs.toFixed(1)}ms`
      );
      // 仅对 4 个 https 脚本调用了 fetchMap，3 个虚拟协议直接被 O(1) 拦截
      assert.equal(fetchCalls, 4);
      assert.equal(res.results["1"].resolved, false);
      assert.equal(res.results["5"].resolved, false);

      // 再次请求相同的 404 脚本 URL，应直接命中负缓存，不再发起网络请求
      await processBatchResolution({
        type: "RESOLVE_BATCH_REQUEST",
        requestId: "req_negative_cache",
        items: [
          {
            id: "8",
            scriptUrl: "https://cdn.example.com/a.js",
            line: 2,
            column: 1,
          },
          {
            id: "9",
            scriptUrl: "https://cdn.example.com/b.js",
            line: 3,
            column: 1,
          },
        ],
      });
      assert.equal(fetchCalls, 4);
    } finally {
      SourceMapFetcher.fetchMap = originalFetchMap;
      clearSourceMapWorkerCache();
    }
  });
});
