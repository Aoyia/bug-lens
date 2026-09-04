/**
 * 下载完成状态解析助手。
 *
 * 背景：截图/静默导出的 ZIP 下载发生在 background（content script 无
 * chrome.downloads 权限），下载完成后需要拿到文件的真实本地绝对路径，
 * 用于把 AI 提示词中的路径占位符替换为真实路径。
 *
 * chrome.downloads.DownloadItem.filename 即文件落盘后的绝对路径，
 * 因此等待下载项进入 complete（或已生成目标文件名）即可安全取用。
 */

export type DownloadCompletionResult =
  | { state: "complete"; filename: string }
  | { state: "interrupted"; filename?: string; error?: string }
  | { state: "timeout"; filename?: string };

export type SearchDownloadFn = (
  downloadId: number
) => Promise<chrome.downloads.DownloadItem | undefined>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 轮询等待下载项完成并返回其绝对路径。
 *
 * - 命中 interrupted：返回中断原因，调用方可据此降级提示。
 * - 命中 complete：视为成功并返回落盘绝对路径。
 * - 超时：若已生成目标文件名（下载进行中，路径已确定），仍返回该路径；
 *   否则返回 timeout，调用方回退为占位符提示词。
 */
export async function waitForDownloadCompletion(
  downloadId: number,
  search: SearchDownloadFn,
  timeoutMs = 15000,
  pollMs = 50
): Promise<DownloadCompletionResult> {
  const safeTimeoutMs = Number.isFinite(timeoutMs)
    ? Math.max(0, timeoutMs)
    : 15000;
  const safePollMs = Number.isFinite(pollMs) ? Math.max(1, pollMs) : 50;
  const deadline = Date.now() + safeTimeoutMs;
  let lastItem: chrome.downloads.DownloadItem | undefined;
  for (;;) {
    try {
      lastItem = await search(downloadId);
    } catch {
      lastItem = undefined;
    }
    if (lastItem) {
      if (lastItem.state === "interrupted") {
        return {
          state: "interrupted",
          filename: lastItem.filename,
          error: lastItem.error,
        };
      }
      if (lastItem.state === "complete") {
        return { state: "complete", filename: lastItem.filename || "" };
      }
    }
    if (Date.now() >= deadline) {
      // 轮询超时兜底：若已到达截止时间但已生成目标文件名（下载进行中，路径已确定），
      // 仍返回该路径；否则返回 timeout，调用方回退为占位符提示词。
      if (lastItem?.state === "complete") {
        return { state: "complete", filename: lastItem.filename || "" };
      }
      if (lastItem?.filename && lastItem.filename.trim().length > 0) {
        return { state: "complete", filename: lastItem.filename };
      }
      return { state: "timeout" };
    }
    await sleep(safePollMs);
  }
}
