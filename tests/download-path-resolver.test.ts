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
});
