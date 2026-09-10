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

export type DownloadTimingStats = {
  downloadCallMs?: number;
  pollWaitMs: number;
  pollCount: number;
  avgPollIntervalMs: number;
  pathResolveMs: number;
  totalDurationMs: number;
};

export type SearchDownloadFn = (
  downloadId: number
) => Promise<chrome.downloads.DownloadItem | undefined>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type DownloadOnChangedEvent = {
  addListener: (
    callback: (delta: chrome.downloads.DownloadDelta) => void
  ) => void;
  removeListener: (
    callback: (delta: chrome.downloads.DownloadDelta) => void
  ) => void;
};

/**
 * 等待下载项完成并返回其绝对路径。
 *
 * 优先采用 chrome.downloads.onChanged 事件驱动感知（零等待即时回调），
 * 同时保留低开销轮询机制作为可靠性兜底，彻底消除固定 50ms 轮询造成的额外时延。
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
  pollMs = 50,
  onTimingStats?: (stats: DownloadTimingStats) => void,
  onChangedEvent?: DownloadOnChangedEvent
): Promise<DownloadCompletionResult> {
  const safeTimeoutMs = Number.isFinite(timeoutMs)
    ? Math.max(0, timeoutMs)
    : 15000;
  const safePollMs = Number.isFinite(pollMs) ? Math.max(1, pollMs) : 50;
  const deadline = Date.now() + safeTimeoutMs;
  const pollStart = performance.now();
  let pollCount = 0;
  let lastItem: chrome.downloads.DownloadItem | undefined;

  let latestFilename = "";
  let latestState: string | undefined;
  let latestError: string | undefined;
  let eventPending = false;

  const eventSource =
    onChangedEvent ??
    (typeof chrome !== "undefined" && chrome.downloads?.onChanged
      ? chrome.downloads.onChanged
      : undefined);

  let wakeUp: (() => void) | undefined;
  let changeListener:
    ((delta: chrome.downloads.DownloadDelta) => void) | undefined;

  if (eventSource?.addListener) {
    changeListener = (delta: chrome.downloads.DownloadDelta) => {
      if (delta.id !== downloadId) return;
      if (delta.filename?.current && delta.filename.current.trim().length > 0) {
        latestFilename = delta.filename.current;
        if (lastItem) {
          lastItem.filename = delta.filename.current;
        }
      }
      if (delta.state?.current) {
        if (latestState !== "complete" && latestState !== "interrupted") {
          latestState = delta.state.current;
        } else if (delta.state.current === "interrupted") {
          latestState = "interrupted";
        }
      }
      if (delta.error?.current) {
        latestError = delta.error.current;
        latestState = "interrupted";
      }
      if (
        delta.state?.current === "complete" ||
        delta.state?.current === "interrupted" ||
        (delta.filename?.current && delta.filename.current.trim().length > 0) ||
        delta.error?.current
      ) {
        eventPending = true;
        wakeUp?.();
      }
    };
    try {
      eventSource.addListener(changeListener);
    } catch {
      changeListener = undefined;
    }
  }

  const emitStats = (pathResolveMs = 0) => {
    if (!onTimingStats) return;
    const totalLoopMs = performance.now() - pollStart;
    const pollWaitMs = Math.max(0, totalLoopMs - pathResolveMs);
    const avgPollIntervalMs = pollCount > 0 ? totalLoopMs / pollCount : 0;
    onTimingStats({
      pollWaitMs,
      pollCount,
      avgPollIntervalMs,
      pathResolveMs,
      totalDurationMs: totalLoopMs,
    });
  };

  try {
    for (;;) {
      // 零等待感知：若已由事件通知跃迁至终态且真实物理路径已就绪，立即零等待回调返回，消灭无谓的 search 异步查询延迟
      if (
        latestFilename.trim().length > 0 &&
        (latestState === "complete" || latestState === "interrupted")
      ) {
        emitStats(0);
        if (latestState === "interrupted") {
          return {
            state: "interrupted",
            filename: latestFilename,
            error: latestError || lastItem?.error,
          };
        }
        return { state: "complete", filename: latestFilename };
      }

      pollCount += 1;
      const tSearchStart = performance.now();
      try {
        lastItem = await search(downloadId);
      } catch {
        lastItem = undefined;
      }
      const searchDurationMs = performance.now() - tSearchStart;
      if (lastItem) {
        if (lastItem.filename && lastItem.filename.trim().length > 0) {
          latestFilename = lastItem.filename;
        }
        if (lastItem.state) {
          if (latestState !== "complete" && latestState !== "interrupted") {
            latestState = lastItem.state;
          } else if (lastItem.state === "interrupted") {
            latestState = "interrupted";
          }
        }
        if (lastItem.error) {
          latestError = lastItem.error;
          latestState = "interrupted";
        }
      }

      if (
        latestState === "interrupted" ||
        latestError ||
        lastItem?.state === "interrupted" ||
        lastItem?.error
      ) {
        emitStats(searchDurationMs);
        const resolvedFilename =
          latestFilename.trim().length > 0
            ? latestFilename
            : lastItem?.filename && lastItem.filename.trim().length > 0
              ? lastItem.filename
              : undefined;
        return {
          state: "interrupted",
          filename: resolvedFilename,
          error: latestError || lastItem?.error,
        };
      }
      if (latestState === "complete") {
        emitStats(searchDurationMs);
        const resolvedFilename =
          latestFilename.trim().length > 0
            ? latestFilename
            : lastItem?.filename && lastItem.filename.trim().length > 0
              ? lastItem.filename
              : "";
        return { state: "complete", filename: resolvedFilename };
      }

      if (Date.now() >= deadline) {
        // 轮询超时兜底：若已到达截止时间但已生成目标文件名（下载进行中，路径已确定），
        // 仍返回该路径；否则返回 timeout，调用方回退为占位符提示词。
        emitStats(searchDurationMs);
        const candidateFilename =
          latestFilename.trim().length > 0
            ? latestFilename
            : lastItem?.filename && lastItem.filename.trim().length > 0
              ? lastItem.filename
              : undefined;
        if (candidateFilename) {
          return { state: "complete", filename: candidateFilename };
        }
        return { state: "timeout" };
      }

      // 若在 search 执行期间或当前轮次触发了事件，立即进入下一轮评估，绝不进入等待睡眠
      if (eventPending) {
        eventPending = false;
        continue;
      }

      // 等待下一次轮询，或由 chrome.downloads.onChanged 事件立即零等待唤醒
      const remainingTime = Math.max(0, deadline - Date.now());
      const waitMs = Math.min(safePollMs, remainingTime);
      if (waitMs <= 0) {
        continue;
      }
      await new Promise<void>((resolve) => {
        let timer: any;
        const onWake = () => {
          if (timer) clearTimeout(timer);
          wakeUp = undefined;
          eventPending = false;
          resolve();
        };
        wakeUp = onWake;
        timer = setTimeout(onWake, waitMs);
      });
    }
  } finally {
    if (changeListener && eventSource?.removeListener) {
      try {
        eventSource.removeListener(changeListener);
      } catch {}
    }
  }
}
