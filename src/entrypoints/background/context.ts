import {
  type CaptureIssue,
  type RecordingSession,
} from "../../shared/protocol";
import {
  applySessionEvent as reduceSession,
  type RecordingSessionEvent,
} from "../../domain/recording-session";
import { waitForDownloadCompletion } from "../../domain/download-path-resolver";
import type { CdpEvidenceCollector } from "../../evidence/cdp-evidence-collector";
import type { ContentScriptManager } from "../../recording/content-script-manager";
import type { InteractionCapture } from "../../recording/interaction-capture";
import type { IssueSceneCapture } from "../../recording/issue-scene-capture";
import type { NavigationCapture } from "../../recording/navigation-capture";
import type { RecordingCoordinator } from "../../recording/recording-coordinator";
import type { StreamHealthMonitor } from "../../recording/stream-health-monitor";
import type { db } from "../../storage/db";

/** background 编排运行时的外部依赖（由入口装配真实实例，测试注入 fake）。 */
export type BackgroundDeps = {
  db: typeof db;
  extensionVersion: string;
  browserEpochPromise: Promise<string>;
  streamHealthMonitor: StreamHealthMonitor;
  recordingCoordinator: RecordingCoordinator;
  contentScripts: ContentScriptManager;
  cdpCollector: CdpEvidenceCollector;
  interactionCapture: InteractionCapture;
  issueSceneCapture: IssueSceneCapture;
  navigationCapture: NavigationCapture;
};

/**
 * Background 编排上下文：持有全部实例与共享状态，各领域模块只依赖本上下文，
 * 避免模块间循环依赖（lifecycle / bootstrap / router / screenshot 互不直接引用）。
 */
export interface BackgroundContext extends BackgroundDeps {
  /** 独立截图 overlay 是否打开（content script 上报）。用于与视频录制互斥。 */
  isScreenshotOverlayOpen: { get(): boolean; set(v: boolean): void };
  /** 会话事件入口：写库后返回最新会话，状态迁移逻辑集中在 recording-session 域 reducer。 */
  applySessionEvent(
    sessionId: string,
    event: RecordingSessionEvent
  ): Promise<RecordingSession>;
  issue(
    code: string,
    messageText: string,
    source: CaptureIssue["source"],
    recoverable?: boolean
  ): CaptureIssue;
  /** 等待下载完成后返回真实绝对路径（silent export 注入 prompt 用）。 */
  resolveDownloadedFilePath(
    downloadId: number,
    maxWaitMs?: number
  ): Promise<string | undefined>;
}

/** 会话事件入口（供入口装配与上下文共用的基础函数）。 */
export async function applySessionEvent(
  repository: typeof db,
  sessionId: string,
  event: RecordingSessionEvent
): Promise<RecordingSession> {
  const next = await repository.updateSession(sessionId, (current) =>
    reduceSession(current, event)
  );
  if (!next) throw new Error(`未找到会话 (SESSION_NOT_FOUND:${sessionId})`);
  return next;
}

export function createBackgroundContext(
  deps: BackgroundDeps
): BackgroundContext {
  let isScreenshotOverlayOpen = false;
  return {
    ...deps,
    isScreenshotOverlayOpen: {
      get: () => isScreenshotOverlayOpen,
      set: (value) => {
        isScreenshotOverlayOpen = value;
      },
    },
    applySessionEvent: (sessionId, event) =>
      applySessionEvent(deps.db, sessionId, event),
    issue(code, messageText, source, recoverable = true): CaptureIssue {
      return {
        code,
        message: messageText,
        source,
        recoverable,
        occurredAt: Date.now(),
      };
    },
    async resolveDownloadedFilePath(downloadId, maxWaitMs = 15000) {
      const result = await waitForDownloadCompletion(
        downloadId,
        searchDownload,
        maxWaitMs
      );
      return result.state === "complete" ? result.filename : undefined;
    },
  };
}

async function searchDownload(
  downloadId: number
): Promise<chrome.downloads.DownloadItem | undefined> {
  if (typeof chrome === "undefined" || !chrome.downloads?.search) {
    return undefined;
  }
  return new Promise<chrome.downloads.DownloadItem | undefined>((resolve) => {
    chrome.downloads.search({ id: downloadId }, (items) => {
      if (chrome.runtime?.lastError) resolve(undefined);
      else resolve(items?.[0]);
    });
  });
}
