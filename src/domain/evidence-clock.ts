export type NetworkRequestTiming = {
  wallTime?: number;
  timestamp?: number;
};

export type NormalizedNetworkTime = {
  createdAtEpochMs: number;
  startedAtMonotonicMs?: number;
};

export function networkRequestTime(
  timing: NetworkRequestTiming,
  now: () => number = Date.now
): NormalizedNetworkTime {
  return {
    createdAtEpochMs:
      typeof timing.wallTime === "number"
        ? Math.round(timing.wallTime * 1000)
        : now(),
    startedAtMonotonicMs:
      typeof timing.timestamp === "number"
        ? Math.round(timing.timestamp * 1000)
        : undefined,
  };
}

export function networkDurationMs(
  startedAtMonotonicMs: number | undefined,
  finishedTimestampSeconds: number | undefined
): number | undefined {
  if (startedAtMonotonicMs == null || finishedTimestampSeconds == null)
    return undefined;
  const finishedAtMonotonicMs = finishedTimestampSeconds * 1000;
  const duration = finishedAtMonotonicMs - startedAtMonotonicMs;
  return duration >= 0 ? Math.round(duration) : undefined;
}

export function formatElapsedEpochTime(
  epochMs: number,
  originEpochMs: number
): string | undefined {
  const elapsedMs = epochMs - originEpochMs;
  if (elapsedMs < 0) return undefined;
  const wholeSeconds = Math.floor(elapsedMs / 1000);
  const minutes = String(Math.floor(wholeSeconds / 60)).padStart(2, "0");
  const seconds = String(wholeSeconds % 60).padStart(2, "0");
  const milliseconds = String(elapsedMs % 1000).padStart(3, "0");
  return `${minutes}:${seconds}.${milliseconds}`;
}
