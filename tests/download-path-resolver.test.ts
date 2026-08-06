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
});
