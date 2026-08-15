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
  return session.quality.issues.some((entry) => entry.source === source);
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
  const screenshotCount =
    session.quality.primaryScreenshotCount +
    session.quality.fallbackScreenshotCount;
  const unavailableScreenshots = session.quality.unavailableScreenshotCount;
  const networkBodyEntries = networkEntries.filter((entry) => entry.response);
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
  const videoState = enabledState(
    session.options.captureVideo,
    media.count,
    hasIssue(session, "media")
  );
  const screenshotState = !session.options.captureScreenshots
    ? "disabled"
    : unavailableScreenshots
      ? screenshotCount
        ? "partial"
        : "failed"
      : "captured";
  const consoleState = enabledState(
    session.options.captureConsole,
    session.quality.consoleEntryCount,
    hasIssue(session, "debugger")
  );
  const networkState = enabledState(
    session.options.captureNetwork,
    session.quality.networkEntryCount,
    hasIssue(session, "debugger")
  );
  let bodiesState: EvidenceState = "disabled";
  if (session.options.captureNetwork && session.options.captureNetworkBodies) {
    bodiesState = redactedBodyCount
      ? "redacted"
      : unavailableBodyCount
        ? networkBodyEntries.length
          ? "partial"
          : "failed"
        : "captured";
  }

  return [
    {
      kind: "video",
      state: videoState,
      count: media.count,
      sizeBytes: 0,
      detail: media.count
        ? t("webmChunks", String(media.count))
        : t("videoNotCaptured"),
    },
    {
      kind: "audio",
      state: !session.options.captureAudio ? "disabled" : videoState,
      count: session.options.captureAudio && media.count ? 1 : 0,
      sizeBytes: 0,
      detail: session.options.captureAudio
        ? t("audioReused")
        : t("notCaptured"),
    },
    {
      kind: "screenshots",
      state: screenshotState,
      count: screenshotCount,
      sizeBytes: 0,
      detail: !session.options.captureScreenshots
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
      state: issueScenes.some((scene) => scene.status === "failed")
        ? issueScenes.some((scene) => scene.status === "complete")
          ? "partial"
          : "failed"
        : issueScenes.some((scene) => scene.status === "partial")
          ? "partial"
          : "captured",
      count: issueScenes.length,
      sizeBytes: 0,
      detail: issueScenes.length
        ? t("issueSceneCountDetail", String(issueScenes.length))
        : t("noIssueScene"),
    },
    {
      kind: "console",
      state: consoleState,
      count: session.quality.consoleEntryCount,
      sizeBytes: 0,
      detail: t("countEntries", String(session.quality.consoleEntryCount)),
    },
    {
      kind: "network",
      state: networkState,
      count: session.quality.networkEntryCount,
      sizeBytes: 0,
      detail: t("countEntries", String(session.quality.networkEntryCount)),
    },
    {
      kind: "networkBodies",
      state: bodiesState,
      count: networkBodyEntries.length,
      sizeBytes: bodyBytes,
      detail: !session.options.captureNetworkBodies
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
      state: !session.options.captureFrameworkState
        ? "disabled"
        : frameworkStateCount > 0
          ? "captured"
          : "partial",
      count: frameworkStateCount,
      sizeBytes: 0,
      detail: !session.options.captureFrameworkState
        ? t("notCaptured")
        : frameworkStateCount > 0
          ? t("frameworkFrames", String(frameworkStateCount))
          : t("noFrameworkDetected"),
    },
  ];
}
