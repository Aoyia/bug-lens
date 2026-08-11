import type {
  EvidenceState,
  EvidenceSummary,
  IssueScene,
  NetworkEntry,
  RecordingSession,
} from "../shared/protocol.ts";

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
  // 截图状态是独立推导的：全失败 → failed，部分成功 → partial（与 enabledState 语义一致）
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
  // 响应体状态优先级：存在脱敏 → redacted；否则全不可用按是否有部分成功区分
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
      detail: media.count ? `${media.count} 个 WebM 分片` : "未写入录像",
    },
    {
      kind: "audio",
      state: !session.options.captureAudio ? "disabled" : videoState,
      count: session.options.captureAudio && media.count ? 1 : 0,
      sizeBytes: 0,
      detail: session.options.captureAudio
        ? "与标签页录像复用同一 WebM"
        : "未采集",
    },
    {
      kind: "screenshots",
      state: screenshotState,
      count: screenshotCount,
      sizeBytes: 0,
      detail: !session.options.captureScreenshots
        ? "未采集"
        : unavailableScreenshots
          ? `${screenshotCount} 成功，${unavailableScreenshots} 失败`
          : `${screenshotCount} 张`,
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
        ? `${issueScenes.length} 个问题现场`
        : "未标记问题",
    },
    {
      kind: "console",
      state: consoleState,
      count: session.quality.consoleEntryCount,
      sizeBytes: 0,
      detail: `${session.quality.consoleEntryCount} 条`,
    },
    {
      kind: "network",
      state: networkState,
      count: session.quality.networkEntryCount,
      sizeBytes: 0,
      detail: `${session.quality.networkEntryCount} 条`,
    },
    {
      kind: "networkBodies",
      state: bodiesState,
      count: networkBodyEntries.length,
      sizeBytes: bodyBytes,
      detail: !session.options.captureNetworkBodies
        ? "未采集"
        : redactedBodyCount
          ? `${redactedBodyCount} 条已脱敏${truncatedBodyCount ? `，${truncatedBodyCount} 条已截断` : ""}`
          : truncatedBodyCount
            ? `${truncatedBodyCount} 条已截断`
            : `${networkBodyEntries.length} 条`,
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
        ? "未采集"
        : frameworkStateCount > 0
          ? `${frameworkStateCount} 帧`
          : "页面未识别到 React/Vue 组件树",
    },
  ];
}
