import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  waitForDownloadCompletion,
  type SearchDownloadFn,
} from "../src/domain/download-path-resolver.ts";

function item(
  partial: Partial<chrome.downloads.DownloadItem>
): chrome.downloads.DownloadItem {
  return { state: "in_progress", ...partial } as chrome.downloads.DownloadItem;
}

/** 按队列逐次返回搜索结果，队列耗尽后保持最后一项。 */
function sequenceSearch(
  results: Array<chrome.downloads.DownloadItem | undefined>
): SearchDownloadFn {
  let index = 0;
  return async () => {
    const current =
      index < results.length ? results[index] : results[results.length - 1];
    index += 1;
    return current;
  };
}

describe("waitForDownloadCompletion", () => {
  test("下载已完成时立即返回绝对路径", async () => {
    const result = await waitForDownloadCompletion(
      1,
      sequenceSearch([item({ state: "complete", filename: "/tmp/a.zip" })]),
      100,
      10
    );
    assert.deepEqual(result, { state: "complete", filename: "/tmp/a.zip" });
  });

  test("下载进行中轮询至 complete 后返回路径", async () => {
    const result = await waitForDownloadCompletion(
      2,
      sequenceSearch([
        item({ state: "in_progress" }),
        item({ state: "in_progress", filename: "/tmp/b.zip" }),
        item({ state: "complete", filename: "/tmp/b.zip" }),
      ]),
      500,
      10
    );
    assert.deepEqual(result, { state: "complete", filename: "/tmp/b.zip" });
  });

  test("下载中断时返回 interrupted 及原因", async () => {
    const result = await waitForDownloadCompletion(
      3,
      sequenceSearch([
        item({
          state: "interrupted",
          filename: "/tmp/c.zip",
          error: "USER_CANCELED",
        }),
      ]),
      100,
      10
    );
    assert.deepEqual(result, {
      state: "interrupted",
      filename: "/tmp/c.zip",
      error: "USER_CANCELED",
    });
  });

  test("超时且从未生成目标文件名时返回 timeout", async () => {
    const result = await waitForDownloadCompletion(
      4,
      sequenceSearch([item({ state: "in_progress" })]),
      30,
      10
    );
    assert.deepEqual(result, { state: "timeout" });
  });

  test("超时但已生成目标文件名（下载进行中）仍视为路径有效", async () => {
    const result = await waitForDownloadCompletion(
      5,
      sequenceSearch([item({ state: "in_progress", filename: "/tmp/e.zip" })]),
      30,
      10
    );
    assert.deepEqual(result, { state: "complete", filename: "/tmp/e.zip" });
  });

  test("search 暂时查不到条目时继续轮询直至完成", async () => {
    const result = await waitForDownloadCompletion(
      6,
      sequenceSearch([
        undefined,
        undefined,
        item({ state: "complete", filename: "/tmp/f.zip" }),
      ]),
      500,
      10
    );
    assert.deepEqual(result, { state: "complete", filename: "/tmp/f.zip" });
  });

  test("下载进行中即使已有目标本地路径，仍持续轮询直至 complete 确认落盘", async () => {
    let callCount = 0;
    const search: SearchDownloadFn = async () => {
      callCount += 1;
      if (callCount === 1) {
        return item({ state: "in_progress", filename: "/tmp/early.zip" });
      }
      return item({ state: "complete", filename: "/tmp/early.zip" });
    };
    const result = await waitForDownloadCompletion(7, search, 500, 10);
    assert.deepEqual(result, { state: "complete", filename: "/tmp/early.zip" });
    assert.equal(callCount, 2);
  });

  test("下载进行中虽有目标路径但在完成前遭遇 interrupted，正确返回 interrupted 状态与错误原因", async () => {
    const result = await waitForDownloadCompletion(
      71,
      sequenceSearch([
        item({ state: "in_progress", filename: "/tmp/fail.zip" }),
        item({
          state: "interrupted",
          filename: "/tmp/fail.zip",
          error: "USER_CANCELED",
        }),
      ]),
      500,
      10
    );
    assert.deepEqual(result, {
      state: "interrupted",
      filename: "/tmp/fail.zip",
      error: "USER_CANCELED",
    });
  });

  test("若 filename 为空字符串或纯空格，继续轮询直至出现有效路径", async () => {
    const result = await waitForDownloadCompletion(
      8,
      sequenceSearch([
        item({ state: "in_progress", filename: "" }),
        item({ state: "in_progress", filename: "   " }),
        item({ state: "in_progress", filename: "/tmp/valid.zip" }),
      ]),
      500,
      10
    );
    assert.deepEqual(result, { state: "complete", filename: "/tmp/valid.zip" });
  });

  test("若下载状态为 complete 但无 filename，立即返回 complete 而不阻塞至超时", async () => {
    let callCount = 0;
    const search: SearchDownloadFn = async () => {
      callCount += 1;
      return item({ state: "complete", filename: "" });
    };
    const result = await waitForDownloadCompletion(9, search, 500, 10);
    assert.deepEqual(result, { state: "complete", filename: "" });
    assert.equal(callCount, 1);
  });

  test("search 抛出异常时容错重试，直至成功获取", async () => {
    let callCount = 0;
    const search: SearchDownloadFn = async () => {
      callCount += 1;
      if (callCount === 1) {
        throw new Error("Transient IPC failure");
      }
      return item({ state: "complete", filename: "/tmp/recovered.zip" });
    };
    const result = await waitForDownloadCompletion(10, search, 500, 10);
    assert.deepEqual(result, {
      state: "complete",
      filename: "/tmp/recovered.zip",
    });
    assert.equal(callCount, 2);
  });

  test("search 持续抛出异常直至超时，安全返回 timeout 而不崩溃进程", async () => {
    const search: SearchDownloadFn = async () => {
      throw new Error("Persistent IPC error");
    };
    const result = await waitForDownloadCompletion(11, search, 30, 10);
    assert.deepEqual(result, { state: "timeout" });
  });

  test("超时且 filename 一直为纯空格时返回 timeout", async () => {
    const result = await waitForDownloadCompletion(
      12,
      sequenceSearch([item({ state: "in_progress", filename: "    " })]),
      30,
      10
    );
    assert.deepEqual(result, { state: "timeout" });
  });

  test("timeoutMs <= 0 且无有效路径时立即返回 timeout", async () => {
    const result = await waitForDownloadCompletion(
      13,
      sequenceSearch([item({ state: "in_progress" })]),
      -10,
      -5
    );
    assert.deepEqual(result, { state: "timeout" });
  });

  test("timeoutMs <= 0 但首项已完成时正常返回 complete", async () => {
    const result = await waitForDownloadCompletion(
      14,
      sequenceSearch([
        item({ state: "complete", filename: "/tmp/immediate.zip" }),
      ]),
      0,
      0
    );
    assert.deepEqual(result, {
      state: "complete",
      filename: "/tmp/immediate.zip",
    });
  });

  test("timeoutMs 与 pollMs 传入 NaN 时安全回退默认值，不引发死循环且正常轮询完成", async () => {
    const result = await waitForDownloadCompletion(
      15,
      sequenceSearch([
        item({ state: "in_progress" }),
        item({ state: "complete", filename: "/tmp/nan-poll.zip" }),
      ]),
      NaN,
      NaN
    );
    assert.deepEqual(result, {
      state: "complete",
      filename: "/tmp/nan-poll.zip",
    });
  });

  test("timeoutMs 为 NaN 且首轮已完成时立即返回 complete", async () => {
    const result = await waitForDownloadCompletion(
      16,
      sequenceSearch([
        item({ state: "complete", filename: "/tmp/nan-handled.zip" }),
      ]),
      NaN,
      NaN
    );
    assert.deepEqual(result, {
      state: "complete",
      filename: "/tmp/nan-handled.zip",
    });
  });

  test("onTimingStats 回调正确收集轮询次数、等待时间与平均轮询周期且保持返回值纯净", async () => {
    let capturedStats: any;
    const result = await waitForDownloadCompletion(
      17,
      sequenceSearch([
        item({ state: "in_progress" }),
        item({ state: "in_progress" }),
        item({ state: "complete", filename: "/tmp/timed.zip" }),
      ]),
      500,
      10,
      (stats) => {
        capturedStats = stats;
      }
    );
    assert.deepEqual(result, {
      state: "complete",
      filename: "/tmp/timed.zip",
    });
    assert.ok(capturedStats);
    assert.equal(capturedStats.pollCount, 3);
    assert.ok(capturedStats.pollWaitMs >= 15);
    assert.ok(capturedStats.avgPollIntervalMs > 0);
    assert.ok(capturedStats.pathResolveMs >= 0);
    assert.ok(capturedStats.totalDurationMs >= capturedStats.pollWaitMs);
    // 验证数学闭环且无重复计算：等待时间 + 最终路径解析时间 === 轮询总耗时
    assert.ok(
      Math.abs(
        capturedStats.pollWaitMs +
          capturedStats.pathResolveMs -
          capturedStats.totalDurationMs
      ) < 0.001,
      "pollWaitMs + pathResolveMs 必须等于 totalDurationMs"
    );
  });

  test("chrome.downloads.onChanged 事件触发 complete 时零等待立即返回绝对路径并清理监听器", async () => {
    let listener: ((delta: any) => void) | undefined;
    let removed = false;
    const mockOnChanged = {
      addListener(cb: any) {
        listener = cb;
      },
      removeListener(cb: any) {
        if (cb === listener) removed = true;
      },
    };

    let searchCallCount = 0;
    const search: SearchDownloadFn = async () => {
      searchCallCount += 1;
      if (searchCallCount === 1) {
        return item({ state: "in_progress" });
      }
      return item({ state: "complete", filename: "/tmp/event-driven.zip" });
    };

    const startTime = performance.now();
    const waitPromise = waitForDownloadCompletion(
      99,
      search,
      10000,
      5000, // 轮询周期故意设为 5000ms
      undefined,
      mockOnChanged
    );

    // 稍后异步触发 onChanged 事件
    setTimeout(() => {
      assert.ok(listener, "监听器必须已挂载");
      listener!({
        id: 99,
        state: { current: "complete" },
        filename: { current: "/tmp/event-driven.zip" },
      });
    }, 20);

    const result = await waitPromise;
    const elapsed = performance.now() - startTime;

    assert.deepEqual(result, {
      state: "complete",
      filename: "/tmp/event-driven.zip",
    });
    // 验证远小于 5000ms 的轮询周期，立即由事件唤醒
    assert.ok(
      elapsed < 1000,
      `耗时应远小于轮询周期 5000ms，实际耗时 ${elapsed}ms`
    );
    assert.equal(removed, true, "完成时必须移除 onChanged 监听器");
  });

  test("chrome.downloads.onChanged 事件触发 interrupted 时立即返回错误原因", async () => {
    let listener: ((delta: any) => void) | undefined;
    const mockOnChanged = {
      addListener(cb: any) {
        listener = cb;
      },
      removeListener() {},
    };

    let searchCallCount = 0;
    const search: SearchDownloadFn = async () => {
      searchCallCount += 1;
      if (searchCallCount === 1) {
        return item({ state: "in_progress" });
      }
      return item({
        state: "interrupted",
        filename: "/tmp/interrupted.zip",
        error: "SERVER_BAD_CONTENT",
      });
    };

    const waitPromise = waitForDownloadCompletion(
      100,
      search,
      10000,
      5000,
      undefined,
      mockOnChanged
    );

    setTimeout(() => {
      listener!({
        id: 100,
        state: { current: "interrupted" },
        error: { current: "SERVER_BAD_CONTENT" },
      });
    }, 15);

    const result = await waitPromise;
    assert.deepEqual(result, {
      state: "interrupted",
      filename: "/tmp/interrupted.zip",
      error: "SERVER_BAD_CONTENT",
    });
  });

  test("chrome.downloads.onChanged 事件在 search 进行中触发时不会丢失事件且零等待即时返回（杜绝轮询期悬挂）", async () => {
    let listener: ((delta: any) => void) | undefined;
    const mockOnChanged = {
      addListener(cb: any) {
        listener = cb;
      },
      removeListener() {},
    };

    let searchCallCount = 0;
    const search: SearchDownloadFn = async () => {
      searchCallCount += 1;
      if (searchCallCount === 1) {
        // 模拟 search 本身有异步耗时（如 IPC 延迟 30ms）
        await new Promise((r) => setTimeout(r, 30));
        return item({ state: "in_progress" });
      }
      return item({ state: "complete", filename: "/tmp/in-flight-event.zip" });
    };

    const startTime = performance.now();
    const waitPromise = waitForDownloadCompletion(
      101,
      search,
      10000,
      3000, // 轮询周期故意设为 3000ms
      undefined,
      mockOnChanged
    );

    // 在第一次 search 执行的中途（10ms）派发 complete 事件
    setTimeout(() => {
      listener!({
        id: 101,
        state: { current: "complete" },
        filename: { current: "/tmp/in-flight-event.zip" },
      });
    }, 10);

    const result = await waitPromise;
    const elapsed = performance.now() - startTime;

    assert.deepEqual(result, {
      state: "complete",
      filename: "/tmp/in-flight-event.zip",
    });
    // 即使事件在 search 期间到达，也必须在 search 结束后立即返回，绝不能等待 3000ms 的轮询休眠
    assert.ok(
      elapsed < 1000,
      `在 search 途中到达的事件必须零等待唤醒，实际耗时 ${elapsed}ms`
    );
  });

  test("search 返回 undefined 时依靠 onChanged 事件携带的 complete 与 filename 依然能够成功结算", async () => {
    let listener: ((delta: any) => void) | undefined;
    const mockOnChanged = {
      addListener(cb: any) {
        listener = cb;
      },
      removeListener() {},
    };

    const search: SearchDownloadFn = async () => undefined;

    const waitPromise = waitForDownloadCompletion(
      102,
      search,
      2000,
      500,
      undefined,
      mockOnChanged
    );

    setTimeout(() => {
      listener!({
        id: 102,
        state: { current: "complete" },
        filename: { current: "/tmp/resilient.zip" },
      });
    }, 15);

    const result = await waitPromise;
    assert.deepEqual(result, {
      state: "complete",
      filename: "/tmp/resilient.zip",
    });
  });

  test("onChanged 在不同批次分别发送 filename 与 complete 时能完整保留路径（解决 Delta 碎片化）", async () => {
    let listener: ((delta: any) => void) | undefined;
    const mockOnChanged = {
      addListener(cb: any) {
        listener = cb;
      },
      removeListener() {},
    };

    let searchCallCount = 0;
    const search: SearchDownloadFn = async () => {
      searchCallCount += 1;
      if (searchCallCount === 1) {
        return item({ state: "in_progress", filename: "" });
      }
      return item({ state: "complete", filename: "" });
    };

    const waitPromise = waitForDownloadCompletion(
      103,
      search,
      2000,
      50,
      undefined,
      mockOnChanged
    );

    // Delta 1: 仅通知路径
    listener!({ id: 103, filename: { current: "/tmp/fragmented.zip" } });
    // Delta 2: 仅通知完成
    listener!({ id: 103, state: { current: "complete" } });

    const result = await waitPromise;
    assert.deepEqual(result, {
      state: "complete",
      filename: "/tmp/fragmented.zip",
    });
  });

  test("onChanged 事件仅推送 error 属性且 search 瞬时返回 undefined 时立即返回 interrupted 绝不超时挂起", async () => {
    let listener: ((delta: any) => void) | undefined;
    const mockOnChanged = {
      addListener(cb: any) {
        listener = cb;
      },
      removeListener() {},
    };

    const search: SearchDownloadFn = async () => undefined;

    const startTime = performance.now();
    const waitPromise = waitForDownloadCompletion(
      104,
      search,
      5000,
      1000,
      undefined,
      mockOnChanged
    );

    setTimeout(() => {
      listener!({
        id: 104,
        error: { current: "NETWORK_FAILED" },
      });
    }, 15);

    const result = await waitPromise;
    const elapsed = performance.now() - startTime;
    assert.deepEqual(result, {
      state: "interrupted",
      error: "NETWORK_FAILED",
      filename: undefined,
    });
    assert.ok(
      elapsed < 1000,
      `应在 1000ms 内即时返回 interrupted，实际耗时 ${elapsed}ms`
    );
  });

  test("高并发场景下多个不同 downloadId 的事件分发严格隔离互不干扰", async () => {
    const listeners: Array<(delta: any) => void> = [];
    const mockOnChanged = {
      addListener(cb: any) {
        listeners.push(cb);
      },
      removeListener(cb: any) {
        const idx = listeners.indexOf(cb);
        if (idx !== -1) listeners.splice(idx, 1);
      },
    };

    const broadcastDelta = (delta: any) => {
      // 模拟 Chrome 分发事件给所有已注册的 listener
      [...listeners].forEach((l) => l(delta));
    };

    const search: SearchDownloadFn = async () => item({ state: "in_progress" });

    // 启动 3 个并发等待，不同 downloadId
    const p1 = waitForDownloadCompletion(
      201,
      search,
      5000,
      2000,
      undefined,
      mockOnChanged
    );
    const p2 = waitForDownloadCompletion(
      202,
      search,
      5000,
      2000,
      undefined,
      mockOnChanged
    );
    const p3 = waitForDownloadCompletion(
      203,
      search,
      5000,
      2000,
      undefined,
      mockOnChanged
    );

    // 20ms 后仅分发 202 的完成事件
    setTimeout(() => {
      broadcastDelta({
        id: 202,
        state: { current: "complete" },
        filename: { current: "/tmp/download-202.zip" },
      });
    }, 20);

    // 40ms 后仅分发 201 的错误事件
    setTimeout(() => {
      broadcastDelta({
        id: 201,
        state: { current: "interrupted" },
        error: { current: "FILE_FAILED" },
      });
    }, 40);

    // 60ms 后仅分发 203 的完成事件
    setTimeout(() => {
      broadcastDelta({
        id: 203,
        state: { current: "complete" },
        filename: { current: "/tmp/download-203.zip" },
      });
    }, 60);

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

    assert.deepEqual(r1, {
      state: "interrupted",
      filename: undefined,
      error: "FILE_FAILED",
    });
    assert.deepEqual(r2, {
      state: "complete",
      filename: "/tmp/download-202.zip",
    });
    assert.deepEqual(r3, {
      state: "complete",
      filename: "/tmp/download-203.zip",
    });
    assert.equal(listeners.length, 0, "所有下载完成后必须全部清理 listener");
  });

  test("lastItem.filename 为纯空白字符时绝不覆盖已获取的有效文件名", async () => {
    let listener: ((delta: any) => void) | undefined;
    const mockOnChanged = {
      addListener(cb: any) {
        listener = cb;
      },
      removeListener() {},
    };

    let searchCallCount = 0;
    const search: SearchDownloadFn = async () => {
      searchCallCount += 1;
      if (searchCallCount === 1) {
        return item({ state: "in_progress", filename: "" });
      }
      // 模拟后续轮次返回脏空白路径
      return item({ state: "complete", filename: "   \t\n  " });
    };

    const waitPromise = waitForDownloadCompletion(
      301,
      search,
      5000,
      20,
      undefined,
      mockOnChanged
    );

    // 事件通知了有效路径，但尚未 complete
    setTimeout(() => {
      listener!({
        id: 301,
        filename: { current: "/tmp/protected-valid.zip" },
      });
    }, 10);

    const result = await waitPromise;
    assert.deepEqual(result, {
      state: "complete",
      filename: "/tmp/protected-valid.zip",
    });
  });

  test("onChanged 事件分发 complete 与有效路径时立即于循环头部零等待返回，绝不发起多余的异步 search 查询", async () => {
    let listener: ((delta: any) => void) | undefined;
    const mockOnChanged = {
      addListener(cb: any) {
        listener = cb;
      },
      removeListener() {},
    };

    let searchCallCount = 0;
    const search: SearchDownloadFn = async () => {
      searchCallCount += 1;
      if (searchCallCount === 1) {
        return item({ state: "in_progress", filename: "" });
      }
      // 如果触发了第 2 次 search，说明未能在事件到达后零等待直接短路
      return item({ state: "complete", filename: "/tmp/search-lag.zip" });
    };

    const waitPromise = waitForDownloadCompletion(
      302,
      search,
      5000,
      2000, // 轮询周期设长
      undefined,
      mockOnChanged
    );

    // 20ms 后由事件直接推送完成状态与绝对路径
    setTimeout(() => {
      listener!({
        id: 302,
        state: { current: "complete" },
        filename: { current: "/tmp/zero-wait-direct.zip" },
      });
    }, 20);

    const result = await waitPromise;
    assert.deepEqual(result, {
      state: "complete",
      filename: "/tmp/zero-wait-direct.zip",
    });
    // 验证 search 仅在初始探查调用了 1 次，事件到达唤醒后直接于循环头部返回，searchCallCount 绝不为 2
    assert.equal(
      searchCallCount,
      1,
      "事件携带完整终态与路径时必须于循环头部直接返回，禁止发起多余的第 2 次 search 异步查询"
    );
  });
});
