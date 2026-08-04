import type { RecordingOptions, StoragePolicy } from "../shared/protocol";

export const DEFAULT_STORAGE_POLICY: StoragePolicy = {
  retentionDays: 14,
  maxSessionBytes: 512 * 1024 * 1024,
  maxResponseBodyBytes: 2 * 1024 * 1024,
  compression: "balanced",
};

export const DEFAULT_RECORDING_OPTIONS: RecordingOptions = {
  captureAudio: false,
  captureVideo: true,
  captureScreenshots: true,
  captureConsole: true,
  captureNetwork: true,
  captureNetworkBodies: true,
  captureStaticBodies: false,
  captureFrameworkState: true,
  privacyMode: "safe",
  mediaTimesliceMs: 1_000,
  maxResponseBodyBytes: DEFAULT_STORAGE_POLICY.maxResponseBodyBytes,
  maxSessionBytes: DEFAULT_STORAGE_POLICY.maxSessionBytes,
};

/** 录像码率（bps）按存储策略压缩档位映射，作为未显式指定时的默认值。 */
export const VIDEO_BITRATE_BY_COMPRESSION = {
  quality: 4_000_000,
  balanced: 2_500_000,
  small: 1_200_000,
} as const;

function boundedInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  const number =
    typeof value === "number" && Number.isFinite(value)
      ? Math.round(value)
      : fallback;
  return Math.min(max, Math.max(min, number));
}

export function normalizeStoragePolicy(
  value: Partial<StoragePolicy> | undefined
): StoragePolicy {
  return {
    retentionDays: boundedInteger(
      value?.retentionDays,
      DEFAULT_STORAGE_POLICY.retentionDays,
      1,
      365
    ),
    maxSessionBytes: boundedInteger(
      value?.maxSessionBytes,
      DEFAULT_STORAGE_POLICY.maxSessionBytes,
      16 * 1024 * 1024,
      4 * 1024 * 1024 * 1024
    ),
    maxResponseBodyBytes: boundedInteger(
      value?.maxResponseBodyBytes,
      DEFAULT_STORAGE_POLICY.maxResponseBodyBytes,
      16 * 1024,
      64 * 1024 * 1024
    ),
    compression:
      value?.compression === "quality" || value?.compression === "small"
        ? value.compression
        : "balanced",
  };
}

export function normalizeRecordingOptions(
  value: Partial<RecordingOptions> | undefined,
  policy = DEFAULT_STORAGE_POLICY
): RecordingOptions {
  return {
    ...DEFAULT_RECORDING_OPTIONS,
    ...value,
    captureVideo: value?.captureVideo !== false,
    captureAudio: Boolean(value?.captureAudio) && value?.captureVideo !== false,
    captureScreenshots: value?.captureScreenshots !== false,
    captureConsole: value?.captureConsole !== false,
    captureNetwork: value?.captureNetwork !== false,
    captureNetworkBodies:
      value?.captureNetworkBodies !== false && value?.captureNetwork !== false,
    captureStaticBodies:
      Boolean(value?.captureStaticBodies) &&
      value?.captureNetworkBodies !== false,
    captureFrameworkState: value?.captureFrameworkState !== false,
    mediaTimesliceMs: boundedInteger(
      value?.mediaTimesliceMs,
      1_000,
      250,
      10_000
    ),
    videoBitsPerSecond:
      typeof value?.videoBitsPerSecond === "number" &&
      Number.isFinite(value.videoBitsPerSecond) &&
      value.videoBitsPerSecond >= 300_000 &&
      value.videoBitsPerSecond <= 12_000_000
        ? Math.round(value.videoBitsPerSecond)
        : VIDEO_BITRATE_BY_COMPRESSION[policy.compression],
    maxResponseBodyBytes: boundedInteger(
      value?.maxResponseBodyBytes,
      policy.maxResponseBodyBytes,
      16 * 1024,
      64 * 1024 * 1024
    ),
    maxSessionBytes: boundedInteger(
      value?.maxSessionBytes,
      policy.maxSessionBytes,
      16 * 1024 * 1024,
      4 * 1024 * 1024 * 1024
    ),
  };
}

export function expiresAt(
  createdAtEpochMs: number,
  retentionDays: number
): number {
  return createdAtEpochMs + retentionDays * 24 * 60 * 60 * 1_000;
}

export function isExpired(
  createdAtEpochMs: number,
  retentionDays: number,
  now = Date.now()
): boolean {
  return expiresAt(createdAtEpochMs, retentionDays) <= now;
}

export function estimateBytes(value: unknown): number {
  const seen = new WeakSet<object>();
  const measure = (current: unknown): number => {
    if (current == null) return 0;
    if (typeof current === "string")
      return new TextEncoder().encode(current).byteLength;
    if (typeof current === "number" || typeof current === "boolean") return 8;
    if (current instanceof ArrayBuffer) return current.byteLength;
    if (ArrayBuffer.isView(current)) return current.byteLength;
    if (Array.isArray(current))
      return current.reduce((total, item) => total + measure(item), 0);
    if (typeof current === "object") {
      if (seen.has(current)) return 0;
      seen.add(current);
      return Object.entries(current as Record<string, unknown>).reduce(
        (total, [key, item]) =>
          total + new TextEncoder().encode(key).byteLength + measure(item),
        0
      );
    }
    return 0;
  };
  return measure(value);
}
