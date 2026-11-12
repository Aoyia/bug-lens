export type NormalizedResponseBodyPolicy = "standard" | "full";

/**
 * 归一化响应正文采集策略：当传入 "full" 或 captureFullResponseBody 为 true 时为 "full"，否则为 "standard"。
 */
export function normalizeResponseBodyPolicy(
  policy?: string,
  captureFullResponseBody?: boolean
): NormalizedResponseBodyPolicy {
  return policy === "full" || captureFullResponseBody ? "full" : "standard";
}

/**
 * 录制通道配置补丁纯函数：封装音视频联动（关闭视频时强制关闭音频）等不变量。
 */
export function applyRecordingOptionPatch<
  T extends { captureVideo: boolean; captureAudio: boolean },
>(current: T, patch: Partial<T>): T {
  const next: T = { ...current, ...patch };
  if (!next.captureVideo) {
    next.captureAudio = false;
  }
  return next;
}
