import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
  SourceMapCoordinator,
  mergeIntervals,
  isTimeInIntervals,
} from "../src/sourcemap/index.js";
import { SourceMapWorkerClient } from "../src/sourcemap/internal/sourcemap-worker-client.js";
import type {
  ConsoleEntry,
  NetworkEntry,
  Interaction,
  IssueScene,
} from "../src/shared/protocol.js";

describe("SourceMapCoordinator 算法性能优化（方案一）", () => {
  test("mergeIntervals 合并重叠与相邻区间", () => {
    const raw = [
      { start: 100, end: 200 },
      { start: 150, end: 300 },
      { start: 500, end: 600 },
      { start: 250, end: 400 },
    ];
    const merged = mergeIntervals(raw);
    assert.deepEqual(merged, [
      { start: 100, end: 400 },
      { start: 500, end: 600 },
    ]);
  });

  test("isTimeInIntervals 二分查找在 O(log K) 内命中区间", () => {
    const intervals = [
      { start: 100, end: 400 },
      { start: 500, end: 600 },
      { start: 1000, end: 2000 },
    ];

    assert.equal(isTimeInIntervals(intervals, 99), false);
    assert.equal(isTimeInIntervals(intervals, 100), true);
    assert.equal(isTimeInIntervals(intervals, 250), true);
    assert.equal(isTimeInIntervals(intervals, 400), true);
    assert.equal(isTimeInIntervals(intervals, 450), false);
    assert.equal(isTimeInIntervals(intervals, 550), true);
    assert.equal(isTimeInIntervals(intervals, 1500), true);
    assert.equal(isTimeInIntervals(intervals, 2001), false);
  });

  test("Query Deduplication: 坐标哈希去重与结果 1:N 扇出分发", async () => {
    // 模拟一个 WorkerClient，统计实际接收到的去重查询数量
    let receivedBatchSize = 0;
    const mockClient = {
      resolveBatch: async (items: any[]) => {
        receivedBatchSize = items.length;
        const res: Record<string, any> = {};
        for (const item of items) {
          res[item.id] = {
            resolved: true,
            originalFile: "src/main.ts",
            originalLine: item.line,
            originalColumn: item.column,
          };
        }
        return res;
      },
    } as any;

    const coordinator = new SourceMapCoordinator(mockClient);

    // 构造 5 个发起方坐标完全相同的网络请求 (main.ts:2:10)
    const networkEntries: NetworkEntry[] = Array.from(
      { length: 5 },
      (_, i) => ({
        id: `net_${i}`,
        sessionId: "s_1",
        createdAt: 1000 + i * 10,
        resourceType: "Fetch",
        method: "GET",
        initiator: {
          type: "script",
          concise: {
            topFrame: {
              url: "http://localhost:5173/src/main.ts",
              lineNumber: 1, // 0-indexed -> 2
              columnNumber: 9, // 0-indexed -> 10
              functionName: "createApp",
            },
          },
        },
      })
    );

    const result = await coordinator.enrichEntries([], networkEntries);

    // 断言 1: Worker 仅收到 1 个去重后的请求，而不是 5 个
    assert.equal(receivedBatchSize, 1);

    // 断言 2: 所有 5 个网络条目都成功获得了扇出回填的 SourceMap 映射
    assert.equal(result.networkEntries.length, 5);
    for (let i = 0; i < 5; i++) {
      const topFrame = result.networkEntries[i].initiator?.concise?.topFrame;
      assert.equal(topFrame?.sourceMappedLocation?.resolved, true);
      assert.equal(topFrame?.sourceMappedLocation?.originalFile, "src/main.ts");
    }
  });

  test("filters out normal 200 static scripts but includes failed requests and dynamic APIs", () => {
    const staticScript: NetworkEntry = {
      id: "net_script",
      sessionId: "s_1",
      createdAt: 1000000,
      url: "http://localhost:5173/src/App.vue",
      resourceType: "Script",
      method: "GET",
      status: 200,
      initiator: {
        type: "script",
        url: "http://localhost:5173/src/main.ts",
        lineNumber: 2,
        columnNumber: 10,
      },
    };
    assert.equal(
      SourceMapCoordinator.shouldResolveNetwork(staticScript),
      false
    );

    const failedApi: NetworkEntry = {
      ...staticScript,
      id: "net_failed",
      status: 500,
    };
    assert.equal(SourceMapCoordinator.shouldResolveNetwork(failedApi), true);

    const fetchApi: NetworkEntry = {
      ...staticScript,
      id: "net_fetch",
      resourceType: "Fetch",
      status: 200,
    };
    assert.equal(SourceMapCoordinator.shouldResolveNetwork(fetchApi), true);
  });
});
