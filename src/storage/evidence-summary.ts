import type {
  EvidenceState,
  EvidenceSummary,
  IssueScene,
  NetworkEntry,
  RecordingSession,
} from "../shared/protocol.ts";
import { t } from "../shared/i18n.ts";

type MediaSummary = { count: number; mimeType?: string };

function hasIssue(session: RecordingSession, source: string): boolean {
  return (session?.quality?.issues ?? []).some(
    (entry) => entry.source === source
  );
}

/**
 * 由「开关 / 采集数量 / 是否故障」推导证据状态：
 * - 未开启 → disabled；有故障且一条没采到 → failed；有故障但采到部分 → partial；
 * - 其余正常 → captured。
 */
function enabledState(
  enabled: boolean,
  count: number,
  failed: boolean
): EvidenceState {
  if (!enabled) return "disabled";
  if (failed && count === 0) return "failed";
  if (failed) return "partial";
  return "captured";
}

/**
 * 汇总会话各类证据的采集概况（数量、状态、体积），供会话列表与详情页展示。
 * 网络响应体还会统计实际捕获字节数与脱敏/截断条数。
 */
export function buildEvidenceSummary(
  session: RecordingSession,
  media: MediaSummary,
  networkEntries: NetworkEntry[],
  issueScenes: IssueScene[] = [],
  frameworkStateCount = 0
): EvidenceSummary[] {
  const quality = session?.quality ?? {
    overall: "complete",
    interactionCount: 0,
    confirmedInteractionCount: 0,
    primaryScreenshotCount: 0,
    fallbackScreenshotCount: 0,
    unavailableScreenshotCount: 0,
    consoleEntryCount: 0,
    networkEntryCount: 0,
    issues: [],
  };
  const options = session?.options ?? {
    captureAudio: false,
    captureVideo: false,
    captureScreenshots: false,
    captureConsole: false,
    captureNetwork: false,
    captureNetworkBodies: false,
    privacyMode: "safe" as const,
    mediaTimesliceMs: 1000,
    maxResponseBodyBytes: 0,
    maxSessionBytes: 0,
  };
  const screenshotCount =
    (quality.primaryScreenshotCount ?? 0) +
    (quality.fallbackScreenshotCount ?? 0);
  const unavailableScreenshots = quality.unavailableScreenshotCount ?? 0;
  const networkBodyEntries = (networkEntries ?? []).filter(
    (entry) => entry?.response
  );
  const bodyBytes = networkBodyEntries.reduce(
    (total, entry) =>
      total +
      (entry.response?.capturedByteLength ?? entry.response?.byteLength ?? 0),
    0
  );
  const redactedBodyCount = networkBodyEntries.filter(
    (entry) => entry.response?.bodyStatus === "redacted"
  ).length;
  const truncatedBodyCount = networkBodyEntries.filter(
    (entry) => entry.response?.truncated
  ).length;
  const unavailableBodyCount = networkBodyEntries.filter(
    (entry) =>
      entry.response?.bodyStatus === "unavailable" ||
      entry.response?.bodyStatus === "pending"
  ).length;
  const mediaCount = media?.count ?? 0;
  const videoState = enabledState(
    Boolean(options.captureVideo),
    mediaCount,
    hasIssue(session, "media")
  );
  const screenshotState = !options.captureScreenshots
    ? "disabled"
    : unavailableScreenshots
      ? screenshotCount
        ? "partial"
        : "failed"
      : "captured";
  const consoleState = enabledState(
    Boolean(options.captureConsole),
    quality.consoleEntryCount ?? 0,
    hasIssue(session, "debugger")
  );
  const networkState = enabledState(
    Boolean(options.captureNetwork),
    quality.networkEntryCount ?? 0,
    hasIssue(session, "debugger")
  );
  let bodiesState: EvidenceState = "disabled";
  if (options.captureNetwork && options.captureNetworkBodies) {
    bodiesState = redactedBodyCount
      ? "redacted"
      : unavailableBodyCount
        ? networkBodyEntries.length
          ? "partial"
          : "failed"
        : "captured";
  }

  const safeIssueScenes = issueScenes ?? [];
  const issueScenesState: EvidenceState = safeIssueScenes.some(
    (scene) => scene?.status === "failed"
  )
    ? safeIssueScenes.some((scene) => scene?.status === "complete")
      ? "partial"
      : "failed"
    : safeIssueScenes.some((scene) => scene?.status === "partial")
      ? "partial"
      : "captured";

  return [
    {
      kind: "video",
      state: videoState,
      count: mediaCount,
      sizeBytes: 0,
      detail: mediaCount
        ? t("webmChunks", String(mediaCount))
        : t("videoNotCaptured"),
    },
    {
      kind: "audio",
      state: !options.captureAudio ? "disabled" : videoState,
      count: options.captureAudio && mediaCount ? 1 : 0,
      sizeBytes: 0,
      detail: options.captureAudio ? t("audioReused") : t("notCaptured"),
    },
    {
      kind: "screenshots",
      state: screenshotState,
      count: screenshotCount,
      sizeBytes: 0,
      detail: !options.captureScreenshots
        ? t("notCaptured")
        : unavailableScreenshots
          ? t("screenshotDetailPartial", [
              String(screenshotCount),
              String(unavailableScreenshots),
            ])
          : t("countItems", String(screenshotCount)),
    },
    {
      kind: "issueScenes",
      state: issueScenesState,
      count: safeIssueScenes.length,
      sizeBytes: 0,
      detail: safeIssueScenes.length
        ? t("issueSceneCountDetail", String(safeIssueScenes.length))
        : t("noIssueScene"),
    },
    {
      kind: "console",
      state: consoleState,
      count: quality.consoleEntryCount ?? 0,
      sizeBytes: 0,
      detail: t("countEntries", String(quality.consoleEntryCount ?? 0)),
    },
    {
      kind: "network",
      state: networkState,
      count: quality.networkEntryCount ?? 0,
      sizeBytes: 0,
      detail: t("countEntries", String(quality.networkEntryCount ?? 0)),
    },
    {
      kind: "networkBodies",
      state: bodiesState,
      count: networkBodyEntries.length,
      sizeBytes: bodyBytes,
      detail: !options.captureNetworkBodies
        ? t("notCaptured")
        : redactedBodyCount && truncatedBodyCount
          ? t("redactedAndTruncatedBodies", [
              String(redactedBodyCount),
              String(truncatedBodyCount),
            ])
          : redactedBodyCount
            ? t("redactedBodies", String(redactedBodyCount))
            : truncatedBodyCount
              ? t("truncatedBodies", String(truncatedBodyCount))
              : t("countEntries", String(networkBodyEntries.length)),
    },
    {
      kind: "frameworkStates",
      state: !options.captureFrameworkState
        ? "disabled"
        : frameworkStateCount > 0
          ? "captured"
          : "partial",
      count: frameworkStateCount,
      sizeBytes: 0,
      detail: !options.captureFrameworkState
        ? t("notCaptured")
        : frameworkStateCount > 0
          ? t("frameworkFrames", String(frameworkStateCount))
          : t("noFrameworkDetected"),
    },
  ];
}
