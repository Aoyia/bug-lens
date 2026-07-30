import type { EvidenceState, EvidenceSummary, IssueScene, NetworkEntry, RecordingSession } from "../shared/protocol.ts";

type MediaSummary = { count: number; mimeType?: string };

function hasIssue(session: RecordingSession, source: string): boolean {
  return session.quality.issues.some((entry) => entry.source === source);
}

function enabledState(enabled: boolean, count: number, failed: boolean): EvidenceState {
  if (!enabled) return "disabled";
  if (failed && count === 0) return "failed";
  if (failed) return "partial";
  return "captured";
}

export function buildEvidenceSummary(session: RecordingSession, media: MediaSummary, networkEntries: NetworkEntry[], issueScenes: IssueScene[] = []): EvidenceSummary[] {
  const screenshotCount = session.quality.primaryScreenshotCount + session.quality.fallbackScreenshotCount;
  const unavailableScreenshots = session.quality.unavailableScreenshotCount;
  const networkBodyEntries = networkEntries.filter((entry) => entry.response);
  const bodyBytes = networkBodyEntries.reduce((total, entry) => total + (entry.response?.capturedByteLength ?? entry.response?.byteLength ?? 0), 0);
  const redactedBodyCount = networkBodyEntries.filter((entry) => entry.response?.bodyStatus === "redacted").length;
  const truncatedBodyCount = networkBodyEntries.filter((entry) => entry.response?.truncated).length;
  const unavailableBodyCount = networkBodyEntries.filter((entry) => entry.response?.bodyStatus === "unavailable" || entry.response?.bodyStatus === "pending").length;
  const videoState = enabledState(session.options.captureVideo, media.count, hasIssue(session, "media"));
  const screenshotState = !session.options.captureScreenshots ? "disabled" : unavailableScreenshots ? (screenshotCount ? "partial" : "failed") : "captured";
  const consoleState = enabledState(session.options.captureConsole, session.quality.consoleEntryCount, hasIssue(session, "debugger"));
  const networkState = enabledState(session.options.captureNetwork, session.quality.networkEntryCount, hasIssue(session, "debugger"));
  let bodiesState: EvidenceState = "disabled";
  if (session.options.captureNetwork && session.options.captureNetworkBodies) {
    bodiesState = redactedBodyCount
      ? "redacted"
      : unavailableBodyCount ? (networkBodyEntries.length ? "partial" : "failed") : "captured";
  }
  return [
    { kind: "video", state: videoState, count: media.count, sizeBytes: 0, detail: media.count ? `${media.count} 个 WebM 分片` : "未写入录像" },
    { kind: "audio", state: !session.options.captureAudio ? "disabled" : videoState, count: session.options.captureAudio && media.count ? 1 : 0, sizeBytes: 0, detail: session.options.captureAudio ? "与标签页录像复用同一 WebM" : "未采集" },
    { kind: "screenshots", state: screenshotState, count: screenshotCount, sizeBytes: 0, detail: !session.options.captureScreenshots ? "未采集" : unavailableScreenshots ? `${screenshotCount} 成功，${unavailableScreenshots} 失败` : `${screenshotCount} 张` },
    { kind: "issueScenes", state: issueScenes.some((scene) => scene.status === "failed") ? (issueScenes.some((scene) => scene.status === "complete") ? "partial" : "failed") : issueScenes.some((scene) => scene.status === "partial") ? "partial" : "captured", count: issueScenes.length, sizeBytes: 0, detail: issueScenes.length ? `${issueScenes.length} 个问题现场` : "未标记问题" },
    { kind: "console", state: consoleState, count: session.quality.consoleEntryCount, sizeBytes: 0, detail: `${session.quality.consoleEntryCount} 条` },
    { kind: "network", state: networkState, count: session.quality.networkEntryCount, sizeBytes: 0, detail: `${session.quality.networkEntryCount} 条` },
    { kind: "networkBodies", state: bodiesState, count: networkBodyEntries.length, sizeBytes: bodyBytes, detail: !session.options.captureNetworkBodies ? "未采集" : redactedBodyCount ? `${redactedBodyCount} 条已脱敏${truncatedBodyCount ? `，${truncatedBodyCount} 条已截断` : ""}` : truncatedBodyCount ? `${truncatedBodyCount} 条已截断` : `${networkBodyEntries.length} 条` }
  ];
}
