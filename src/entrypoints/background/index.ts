import { db } from "../../storage/db";
import {
  ACTIVE_STATUSES,
  isEnvelope,
  message,
  RECORDING_STATUSES,
  type CaptureIssue,
  type FrameworkProbeEntry,
  type NetworkEntry,
  type RecordingSession,
  type RuntimeMessage,
} from "../../shared/protocol";
import {
  applySessionEvent as reduceSession,
  type RecordingSessionEvent,
} from "../../domain/recording-session";
import { sanitizeText, sanitizeUrl } from "../../domain/privacy-policy";
import { normalizeRecordingOptions } from "../../domain/storage-policy";
import { waitForDownloadCompletion } from "../../domain/download-path-resolver";
import {
  buildSilentExportFailureEvent,
  injectAbsolutePathToPrompt,
  resolveSilentExportResult,
  type SilentExportPackResult,
} from "../../domain/silent-export";
import { CdpEvidenceCollector } from "../../evidence/cdp-evidence-collector";
import { ContentScriptManager } from "../../recording/content-script-manager";
import { InteractionCapture } from "../../recording/interaction-capture";
import { IssueSceneCapture } from "../../recording/issue-scene-capture";
import { NavigationCapture } from "../../recording/navigation-capture";
import { RecordingCoordinator } from "../../recording/recording-coordinator";
import { StreamHealthMonitor } from "../../recording/stream-health-monitor";

import { setStorageBudgetListener } from "../../storage/storage-budget";
import { validateStorageHealthUpdate } from "../../storage/storage-health-coordinator";
import { ensureOffscreenDocument } from "../../shared/offscreen";
import { runMainWorldFrameworkProbe } from "../../screenshot/main-world-probe";

const EXTENSION_VERSION = chrome.runtime.getManifest().version;
const STOPPING_IDS_KEY = "bug-lens-stopping-ids";
/** 录制健康状态机：汇总 content/cdp/media/storage 各采集流的健康度，驱动录制挂件状态与降级提示。 */
const streamHealthMonitor = new StreamHealthMonitor();
/** 独立截图 overlay 是否打开（content script 上报）。用于与视频录制互斥。 */
let isScreenshotOverlayOpen = false;

setStorageBudgetListener((sessionId, result) => {
  if (streamHealthMonitor.getSessionId() !== sessionId) return;
  if (!result.stored) {
    streamHealthMonitor.updateStream("storage", "failed");
  } else if (result.limitReached) {
    streamHealthMonitor.updateStream("storage", "disrupted");
  } else {
    streamHealthMonitor.updateStream("storage", "ok");
  }
});
/** 生命周期协调器：保证 start/stop 串行执行，并将停止中的会话 ID 持久化到 session storage 供 SW 重启后恢复。 */
const recordingCoordinator = new RecordingCoordinator({
  save(ids) {
    chrome.storage.session
      .set({ [STOPPING_IDS_KEY]: ids })
      .catch((error) =>
        console.warn(`[Bug Lens] stopping 状态持久化失败：${String(error)}`)
      );
  },
  async load() {
    const result = await chrome.storage.session.get(STOPPING_IDS_KEY);
    const ids = result[STOPPING_IDS_KEY];
    return Array.isArray(ids)
      ? ids.filter((id): id is string => typeof id === "string")
      : [];
  },
});
/** content script 管理器：录制挂件与交互采集脚本的动态注入、导航后恢复与移除。 */
const contentScripts = new ContentScriptManager();
// 浏览器纪元：每次浏览器启动都会因 session storage 清空而生成新值，据此识别跨重启的会话中断。
const BROWSER_EPOCH_KEY = "bug-lens-browser-epoch";
const browserEpochPromise = loadOrCreateBrowserEpoch();

/** 读取或创建本浏览器启动周期的唯一标识（session storage 重启即清空）。 */
async function loadOrCreateBrowserEpoch(): Promise<string> {
  const stored = await chrome.storage.session.get(BROWSER_EPOCH_KEY);
  const existing = stored[BROWSER_EPOCH_KEY];
  if (typeof existing === "string" && existing) return existing;
  const created = crypto.randomUUID();
  await chrome.storage.session.set({ [BROWSER_EPOCH_KEY]: created });
  return created;
}

/** 会话事件入口：写库后返回最新会话，状态迁移逻辑集中在 recording-session 域 reducer。 */
async function applySessionEvent(
  sessionId: string,
  event: RecordingSessionEvent
): Promise<RecordingSession> {
  const next = await db.updateSession(sessionId, (current) =>
    reduceSession(current, event)
  );
  if (!next) throw new Error(`未找到会话 (SESSION_NOT_FOUND:${sessionId})`);
  return next;
}

const cdpCollector = new CdpEvidenceCollector(
  db,
  applySessionEvent,
  (sessionId) => recordingCoordinator.isStopping(sessionId)
);
const interactionCapture = new InteractionCapture(
  db,
  applySessionEvent,
  (sessionId) => recordingCoordinator.isStopping(sessionId)
);
const navigationCapture = new NavigationCapture(db, interactionCapture);
const issueSceneCapture = new IssueSceneCapture((sessionId) =>
  recordingCoordinator.isStopping(sessionId)
);

/** 并行读取交互/控制台/网络/问题现场四类证据，重算质量快照写入会话。 */
async function reconcileSessionQuality(sessionId: string): Promise<void> {
  const [interactions, consoleEntries, networkEntries, issueScenes] =
    await Promise.all([
      db.getInteractions(sessionId),
      db.getConsole(sessionId),
      db.getNetwork(sessionId),
      db.getIssueScenes(sessionId),
    ]);
  const included = interactions.filter((entry) => entry.status !== "cancelled");
  await applySessionEvent(sessionId, {
    type: "quality-snapshot",
    counts: {
      interactionCount: included.length,
      confirmedInteractionCount: included.filter(
        (entry) => entry.status === "confirmed"
      ).length,
      primaryScreenshotCount: included.filter(
        (entry) =>
          entry.screenshot.status === "captured" &&
          entry.screenshot.source === "primary"
      ).length,
      fallbackScreenshotCount: included.filter(
        (entry) =>
          entry.screenshot.status === "captured" &&
          entry.screenshot.source === "video-frame"
      ).length,
      unavailableScreenshotCount: included.filter(
        (entry) => entry.screenshot.status === "unavailable"
      ).length,
      issueSceneCount: issueScenes.length,
      partialIssueSceneCount: issueScenes.filter(
        (entry) => entry.status === "partial" || entry.status === "failed"
      ).length,
      consoleEntryCount: consoleEntries.length,
      networkEntryCount: networkEntries.length,
    },
  });
  if (
    issueScenes.some(
      (scene) => scene.status === "partial" || scene.status === "failed"
    )
  ) {
    await applySessionEvent(sessionId, {
      type: "capture-issue",
      issue: issue(
        "ISSUE_SCENE_PARTIAL",
        "至少一个问题现场只完成了部分采集。",
        "issue-scene"
      ),
    });
  }
}

function issue(
  code: string,
  messageText: string,
  source: CaptureIssue["source"],
  recoverable = true
): CaptureIssue {
  return {
    code,
    message: messageText,
    source,
    recoverable,
    occurredAt: Date.now(),
  };
}

/**
 * 启动录制主流程：claimSession 互斥抢占 → 取媒体流 → 拉起 offscreen 文档
 * → 注入 content script → CDP attach → offscreen/start-media → 落 started 事件；
 * 任一步失败则回滚已启动的资源并落 failed 事件。
 */
async function startSessionImpl(
  payload: Extract<RuntimeMessage, { type: "session/start" }>["payload"]
): Promise<RecordingSession> {
  const previousCommand = await db.getCommand(payload.commandId);
  if (previousCommand) {
    if (previousCommand.kind !== "start")
      throw new Error(
        `指令类型冲突 (COMMAND_KIND_CONFLICT:${payload.commandId})`
      );
    const previousSession = await db.getSession(previousCommand.sessionId);
    if (previousSession) return previousSession;
    throw new Error(
      `指令对应会话不存在 (COMMAND_SESSION_MISSING:${payload.commandId})`
    );
  }
  const tab = await chrome.tabs.get(payload.tabId);
  const options = normalizeRecordingOptions(
    payload.options,
    await db.getStoragePolicy()
  );
  const browserEpoch = await browserEpochPromise;
  const session: RecordingSession = {
    id: crypto.randomUUID(),
    schemaVersion: 2,
    extensionVersion: EXTENSION_VERSION,
    status: "PREPARING",
    target: {
      tabId: payload.tabId,
      windowId: tab.windowId,
      initialUrl: sanitizeUrl(tab.url ?? "", options.privacyMode),
      initialTitle: sanitizeText(tab.title ?? "", options.privacyMode, 256),
    },
    options,
    timeline: { createdAtEpochMs: Date.now() },
    quality: {
      overall: "complete",
      interactionCount: 0,
      confirmedInteractionCount: 0,
      primaryScreenshotCount: 0,
      fallbackScreenshotCount: 0,
      unavailableScreenshotCount: 0,
      issueSceneCount: 0,
      partialIssueSceneCount: 0,
      consoleEntryCount: 0,
      networkEntryCount: 0,
      issues: [],
    },
    nonce: crypto.randomUUID(),
    commandIds: { start: payload.commandId },
    browserEpoch,
    resumedFromSessionId: payload.resumedFromSessionId,
    storage: { usedBytes: 0 },
  };
  const claim = await db.claimSession(session);
  if (!claim.claimed) {
    if (claim.session.commandIds?.start === payload.commandId)
      return claim.session;
    throw new Error(
      `已有活动会话在录制中 (SESSION_ALREADY_ACTIVE:${claim.session.id})`
    );
  }

  let mediaStarted = false;
  try {
    const streamId = !options.captureVideo
      ? undefined
      : payload.streamId
        ? payload.streamId
        : await new Promise<string>((resolve, reject) =>
            chrome.tabCapture.getMediaStreamId(
              { targetTabId: payload.tabId },
              (id) =>
                id
                  ? resolve(id)
                  : reject(
                      chrome.runtime.lastError ?? new Error("未返回媒体流 ID")
                    )
            )
          ).catch(() => undefined);
    await ensureOffscreenDocument([
      "USER_MEDIA" as chrome.offscreen.Reason,
      "BLOBS" as chrome.offscreen.Reason,
    ]);
    await contentScripts.activate(payload.tabId);
    const debuggerIssue =
      options.captureConsole || options.captureNetwork
        ? await cdpCollector.attach(payload.tabId, session)
        : undefined;
    const issues: CaptureIssue[] = debuggerIssue ? [debuggerIssue] : [];
    if (streamId) {
      const mediaResponse = await chrome.runtime
        .sendMessage(
          message(
            "offscreen/start-media",
            {
              streamId,
              sessionId: session.id,
              captureAudio: options.captureAudio,
              timesliceMs: options.mediaTimesliceMs,
              videoBitsPerSecond: options.videoBitsPerSecond,
            },
            session.id,
            "offscreen"
          )
        )
        .catch((error) => ({ ok: false, error: String(error) }));
      if (mediaResponse?.ok) mediaStarted = true;
      else
        issues.push(
          issue(
            "MEDIA_RECORDER_FAILED",
            sanitizeText(
              mediaResponse?.error ?? "媒体录制启动失败",
              options.privacyMode
            ),
            "media",
            false
          )
        );
    } else if (options.captureVideo) {
      issues.push(
        issue(
          "MEDIA_STREAM_ID_FAILED",
          "未取得标签页媒体流，已进入降级录制。",
          "media",
          false
        )
      );
    }
    const started = await applySessionEvent(session.id, {
      type: "started",
      atEpochMs: Date.now(),
      issues,
    });
    if (["RECORDING", "DEGRADED"].includes(started.status)) {
      navigationCapture.attach();
      navigationCapture.setCurrentUrl(tab.url ?? "");
      streamHealthMonitor.initialize(payload.tabId, session.id, {
        captureVideo: options.captureVideo && mediaStarted,
        captureConsoleOrNetwork:
          (options.captureConsole || options.captureNetwork) && !debuggerIssue,
      });
      if (debuggerIssue) streamHealthMonitor.updateStream("cdp", "disrupted");
      if (options.captureVideo && !mediaStarted)
        streamHealthMonitor.updateStream("media", "disrupted");
    } else if (mediaStarted) {
      await chrome.runtime
        .sendMessage(
          message(
            "offscreen/stop-media",
            { sessionId: session.id },
            session.id,
            "offscreen"
          )
        )
        .catch(() => undefined);
    }
    return started;
  } catch (error) {
    navigationCapture.detach();
    if (mediaStarted)
      await chrome.runtime
        .sendMessage(
          message(
            "offscreen/stop-media",
            { sessionId: session.id },
            session.id,
            "offscreen"
          )
        )
        .catch(() => undefined);
    const failure = issue(
      "SESSION_START_FAILED",
      sanitizeText(String(error), options.privacyMode),
      "media",
      false
    );
    const failed = await applySessionEvent(session.id, {
      type: "failed",
      issue: failure,
    });
    await db.clearActive(session.id);
    await cdpCollector.detach(payload.tabId);
    await contentScripts.remove(payload.tabId);
    streamHealthMonitor.reset(payload.tabId);
    return failed;
  }
}

/** runLifecycle 串行包装，防止与停止等其他生命周期操作并发。 */
function startSession(
  payload: Extract<RuntimeMessage, { type: "session/start" }>["payload"]
): Promise<RecordingSession> {
  return recordingCoordinator.runLifecycle(() => startSessionImpl(payload));
}

/** 续录：仅当会话已带 SESSION_* 或 MEDIA_CONTEXT_LOST 可恢复问题（边界校验）时，以当前激活标签页为目标重新走 startSession。 */
async function continueInterruptedSession(
  sessionId: string,
  commandId: string
): Promise<RecordingSession> {
  const previous = await db.getSession(sessionId);
  if (!previous)
    throw new Error(`未找到中断会话 (SESSION_NOT_FOUND:${sessionId})`);
  if (
    !previous.quality.issues.some(
      (entry) =>
        entry.code.startsWith("SESSION_") || entry.code === "MEDIA_CONTEXT_LOST"
    )
  ) {
    throw new Error("该会话未处于可继续状态");
  }
  const tab = (
    await chrome.tabs.query({ active: true, currentWindow: true })
  )[0];
  if (!tab?.id) throw new Error("无法读取当前标签页，无法继续录制");
  return startSession({
    tabId: tab.id,
    options: previous.options,
    commandId,
    resumedFromSessionId: previous.id,
  });
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

async function resolveDownloadedFilePath(
  downloadId: number,
  maxWaitMs = 15000
): Promise<string | undefined> {
  const result = await waitForDownloadCompletion(
    downloadId,
    searchDownload,
    maxWaitMs
  );
  return result.state === "complete" ? result.filename : undefined;
}

/**
 * 停止主流程：stop-requested（commandId 幂等）→ CDP detach → offscreen 停媒体
 * → 各采集器 drain → network 正文收尾 → 质量重算 → PREVIEW_READY → silentExport 或打开 preview。
 */
async function performStopSession(
  session: RecordingSession,
  commandId?: string,
  autoExport = false,
  discard = false,
  silentExport = false
): Promise<RecordingSession | undefined> {
  if (["PREVIEW_READY", "EXPORTED", "FAILED"].includes(session.status))
    return session;
  const stopping = await applySessionEvent(session.id, {
    type: "stop-requested",
    atEpochMs: Date.now(),
    commandId,
  });
  if (
    commandId &&
    stopping.commandIds?.stop &&
    stopping.commandIds.stop !== commandId
  )
    return stopping;
  recordingCoordinator.beginStopping(session.id);
  navigationCapture.detach();
  streamHealthMonitor.reset(session.target.tabId);
  const cleanupErrors: string[] = [];
  try {
    await cdpCollector.detach(session.target.tabId);

    const mediaResponse = await chrome.runtime
      .sendMessage(
        message(
          "offscreen/stop-media",
          { sessionId: session.id },
          session.id,
          "offscreen"
        )
      )
      .catch((error) => ({ ok: false, error: String(error) }));
    if (mediaResponse?.ok === false)
      cleanupErrors.push(`媒体停止失败：${mediaResponse.error ?? "未知错误"}`);

    cleanupErrors.push(...(await interactionCapture.drain()));
    cleanupErrors.push(...(await issueSceneCapture.drain()));

    cleanupErrors.push(...(await cdpCollector.drain()));
    await cdpCollector
      .finalizeNetworkBodies(stopping)
      .catch((error) =>
        cleanupErrors.push(`Network 正文收尾失败：${String(error)}`)
      );
    await issueSceneCapture
      .finalizeUnfinished(session.id)
      .catch((error) =>
        cleanupErrors.push(`问题现场收尾失败：${String(error)}`)
      );
    await reconcileSessionQuality(session.id).catch((error) =>
      cleanupErrors.push(`质量摘要重算失败：${String(error)}`)
    );
  } finally {
    await cdpCollector.detach(session.target.tabId);
    await contentScripts.remove(session.target.tabId);
    streamHealthMonitor.reset(session.target.tabId);
  }

  if (discard) {
    try {
      await db.deleteSession(session.id);
      await db.clearActive(session.id);
    } finally {
      recordingCoordinator.finishStopping(session.id);
    }
    return undefined;
  }

  const cleanupIssue = cleanupErrors.length
    ? issue(
        "SESSION_STOP_PARTIAL",
        sanitizeText(cleanupErrors.join("；"), session.options.privacyMode),
        "storage"
      )
    : undefined;
  try {
    const next = await db.updateSession(session.id, (current) => ({
      ...reduceSession(current, {
        type: "stop-completed",
        issue: cleanupIssue,
      }),
      previewPending: !silentExport,
    }));
    if (!next) throw new Error(`未找到会话 (SESSION_NOT_FOUND:${session.id})`);
    if (silentExport) {
      let prompt: string | undefined;
      let packResult: SilentExportPackResult | undefined;
      let caughtError: unknown;
      try {
        await ensureOffscreenDocument();
        packResult = (await chrome.runtime.sendMessage(
          message(
            "offscreen/export-pack",
            { sessionId: session.id },
            undefined,
            "offscreen"
          )
        )) as SilentExportPackResult;

        if (packResult?.ok && packResult.blobUrl && packResult.filename) {
          const downloadId = await chrome.downloads.download({
            url: packResult.blobUrl,
            filename: packResult.filename,
            saveAs: false,
          });
          prompt = packResult.prompt;
          if (downloadId && prompt) {
            const absolutePath = await resolveDownloadedFilePath(downloadId);
            if (absolutePath) {
              prompt = injectAbsolutePathToPrompt(
                prompt,
                packResult.filename,
                absolutePath
              );
            }
          }
        }
      } catch (err) {
        caughtError = err;
      }
      const silentExportResult = resolveSilentExportResult(
        packResult,
        caughtError
      );
      if (!silentExportResult.ok) {
        const failed = await db.updateSession(session.id, (current) => ({
          ...reduceSession(
            current,
            buildSilentExportFailureEvent(
              silentExportResult.error ?? "未知错误",
              current.options.privacyMode
            )
          ),
          previewPending: true,
        }));
        if (failed)
          return {
            ...failed,
            silentPrompt: prompt,
            silentExportResult,
          };
      } else {
        await db.clearActive(session.id);
      }
      return { ...next, silentPrompt: prompt, silentExportResult };
    }
    return await openPendingPreview(next, autoExport);
  } finally {
    recordingCoordinator.finishStopping(session.id);
  }
}

/** 幂等停止：同 commandId 已入库则直接复用其关联会话，保证一条停止指令只执行一次。 */
async function stopSessionImpl(
  commandId?: string,
  autoExport = false,
  discard = false,
  silentExport = false
): Promise<RecordingSession | undefined> {
  let session: RecordingSession | undefined;
  if (commandId) {
    const previousCommand = await db.getCommand(commandId);
    if (previousCommand) {
      if (previousCommand.kind !== "stop")
        throw new Error(`指令类型冲突 (COMMAND_KIND_CONFLICT:${commandId})`);
      session = await db.getSession(previousCommand.sessionId);
      if (!session)
        throw new Error(
          `指令对应会话不存在 (COMMAND_SESSION_MISSING:${commandId})`
        );
    }
  }
  if (!session) session = await db.getActiveSession();
  if (!session) return undefined;
  if (commandId && !(await db.getCommand(commandId))) {
    const claimed = await db.claimCommand({
      commandId,
      kind: "stop",
      sessionId: session.id,
      createdAtEpochMs: Date.now(),
    });
    if (!claimed.claimed) {
      if (claimed.command.kind !== "stop")
        throw new Error(`指令类型冲突 (COMMAND_KIND_CONFLICT:${commandId})`);
      session = (await db.getSession(claimed.command.sessionId)) ?? session;
    }
  }
  return recordingCoordinator.runStop(session.id, () =>
    performStopSession(session!, commandId, autoExport, discard, silentExport)
  );
}

/** runLifecycle 串行包装，与启动等生命周期操作互斥。 */
function stopSession(
  commandId?: string,
  autoExport = false,
  discard = false,
  silentExport = false
): Promise<RecordingSession | undefined> {
  return recordingCoordinator.runLifecycle(() =>
    stopSessionImpl(commandId, autoExport, discard, silentExport)
  );
}

/** 打开 preview 页：同一 sessionId 已有标签页则复用不重复开页，成功后清 previewPending。 */
async function openPendingPreview(
  session: RecordingSession,
  autoExport = false
): Promise<RecordingSession> {
  if (!session.previewPending) return session;
  const previewUrl = chrome.runtime.getURL(
    `preview.html?sessionId=${encodeURIComponent(session.id)}${autoExport ? "&autoExport=1" : ""}`
  );
  const existing = await chrome.tabs.query({}).then(
    (tabs) =>
      tabs.some((tab) =>
        Boolean(
          tab.url &&
          tab.url.startsWith(previewUrl.split("?")[0]) &&
          tab.url.includes(`sessionId=${encodeURIComponent(session.id)}`)
        )
      ),
    () => false
  );
  const opened =
    existing ||
    (await chrome.tabs
      .create({ url: previewUrl })
      .then(() => true)
      .catch(() => false));
  if (!opened) return session;
  return (
    (await db.updateSessionAndClearActive(session.id, (current) => ({
      ...current,
      previewPending: false,
    }))) ?? { ...session, previewPending: false }
  );
}

/** 中断恢复：重算质量 → 落 recover 问题 → 清理残留采集资源 → 打开 preview 查看已保留证据。 */
async function recoverInterruptedSession(
  session: RecordingSession,
  code: string,
  messageText: string
): Promise<void> {
  await reconcileSessionQuality(session.id).catch((error) =>
    console.warn(`[Bug Lens] 恢复期质量对账失败：${String(error)}`)
  );
  const recovered = await db.updateSession(session.id, (current) => ({
    ...reduceSession(current, {
      type: "recover",
      atEpochMs: Date.now(),
      issue: issue(code, messageText, "storage"),
    }),
    previewPending: true,
  }));
  if (!recovered) return;
  await cdpCollector.detach(session.target.tabId);
  await contentScripts.remove(session.target.tabId);
  streamHealthMonitor.reset(session.target.tabId);
  await openPendingPreview(recovered);
}

/**
 * SW 启动恢复全流程：恢复 stopping 状态 → 清理过期会话 → 校验浏览器纪元：
 * 纪元不符按重启中断恢复；STOPPING 继续完成停止；PREPARING 按启动中断恢复；
 * 正常活动会话则重注入 content、探测媒体上下文、校验/重连 CDP。
 */
async function bootstrapRuntimeState(): Promise<void> {
  await recordingCoordinator.restoreStoppingIds();
  await db
    .cleanupExpiredSessions()
    .catch((error) =>
      console.warn(`[Bug Lens] 过期会话清理失败：${String(error)}`)
    );
  const browserEpoch = await browserEpochPromise;
  const session = await db.getActiveSession();
  if (!session) return;

  if (!ACTIVE_STATUSES.includes(session.status)) {
    if (session.previewPending) await openPendingPreview(session);
    else await db.clearActive(session.id);
    return;
  }

  if (!session.browserEpoch || session.browserEpoch !== browserEpoch) {
    await recoverInterruptedSession(
      session,
      "SESSION_INTERRUPTED_BY_BROWSER_RESTART",
      "浏览器重启中断了录制，已保留现有证据。"
    );
    return;
  }

  if (session.status === "STOPPING") {
    await stopSession(session.commandIds?.stop);
    return;
  }

  if (session.status === "PREPARING") {
    await recoverInterruptedSession(
      session,
      "SESSION_START_INTERRUPTED",
      "录制启动过程被中断，已保留启动前证据。"
    );
    return;
  }

  const targetExists = await chrome.tabs
    .get(session.target.tabId)
    .then(() => true)
    .catch(() => false);
  if (!targetExists) {
    await stopSession(`system:missing-tab:${session.id}`);
    return;
  }

  await contentScripts.restore(session.target.tabId);

  streamHealthMonitor.initialize(session.target.tabId, session.id, {
    captureVideo: session.options.captureVideo,
    captureConsoleOrNetwork:
      session.options.captureConsole || session.options.captureNetwork,
  });

  const mediaWasExpected =
    session.options.captureVideo &&
    !session.quality.issues.some(
      (entry) =>
        entry.code === "MEDIA_STREAM_ID_FAILED" ||
        entry.code === "MEDIA_RECORDER_FAILED"
    );
  if (mediaWasExpected) {
    const contexts = await (
      chrome.runtime.getContexts as unknown as (
        filter: unknown
      ) => Promise<chrome.runtime.ExtensionContext[]>
    )({ contextTypes: ["OFFSCREEN_DOCUMENT"] }).catch(() => []);
    const mediaStatus = contexts.length
      ? await chrome.runtime
          .sendMessage(
            message(
              "offscreen/status",
              { sessionId: session.id },
              session.id,
              "offscreen"
            )
          )
          .catch(() => undefined)
      : undefined;
    if (!mediaStatus?.active) {
      await applySessionEvent(session.id, {
        type: "capture-issue",
        issue: issue(
          "MEDIA_CONTEXT_LOST",
          "后台恢复后未找到活动的媒体录制上下文。",
          "media",
          false
        ),
      });
      streamHealthMonitor.updateStream("media", "disrupted");
    }
  }

  if (session.options.captureConsole || session.options.captureNetwork) {
    const isOwner = await cdpCollector.verifyOwnership(session.target.tabId);
    if (isOwner) {
      streamHealthMonitor.updateStream("cdp", "ok");
    } else {
      const debuggerIssue = await cdpCollector.attach(
        session.target.tabId,
        session
      );
      if (debuggerIssue) {
        await applySessionEvent(session.id, {
          type: "capture-issue",
          issue: debuggerIssue,
        });
        streamHealthMonitor.updateStream("cdp", "disrupted");
      } else {
        streamHealthMonitor.updateStream("cdp", "ok");
      }
    }
  }

  await streamHealthMonitor.sync();
}

const bootstrapPromise = bootstrapRuntimeState().catch(() => undefined);

async function pauseMediaSession(sessionId: string): Promise<void> {
  const session = await db.getSession(sessionId);
  if (session && session.options.captureVideo) {
    await chrome.runtime
      .sendMessage(
        message("offscreen/pause-media", { sessionId }, sessionId, "offscreen")
      )
      .catch(() => undefined);
  }
}

async function resumeMediaSession(sessionId: string): Promise<void> {
  const session = await db.getSession(sessionId);
  if (session && session.options.captureVideo) {
    await chrome.runtime
      .sendMessage(
        message("offscreen/resume-media", { sessionId }, sessionId, "offscreen")
      )
      .catch(() => undefined);
  }
}

/** 消息路由中枢：承载 content script / popup / offscreen 的所有消息分发。 */
chrome.runtime.onMessage.addListener((raw: unknown, sender) => {
  if (!isEnvelope(raw)) return;
  const incoming = raw as RuntimeMessage;
  if (incoming.target && incoming.target !== "background") return;

  return (async () => {
    try {
      // offscreen 上报存储写入结果：据此更新存储健康流，预算拒写/近限时顺带清理过期会话
      if (incoming.type === "offscreen/storage-state") {
        const active = await db.getActiveSession();
        const valid = validateStorageHealthUpdate({
          senderUrl: sender.url,
          expectedOffscreenUrl: chrome.runtime.getURL("offscreen.html"),
          incomingSessionId: incoming.payload.sessionId,
          currentActiveSessionId: active?.id,
        });
        if (valid) {
          if (!incoming.payload.stored) {
            streamHealthMonitor.updateStream("storage", "failed");
            // 免维存储：写入被预算拒绝时立即回收过期会话，尽量不打断录制
            void db
              .cleanupExpiredSessions()
              .catch((error) =>
                console.warn(
                  `[Bug Lens] 存储拒写后的自动清理失败：${String(error)}`
                )
              );
          } else if (incoming.payload.limitReached) {
            streamHealthMonitor.updateStream("storage", "disrupted");
            void db
              .cleanupExpiredSessions()
              .catch((error) =>
                console.warn(
                  `[Bug Lens] 存储近限后的自动清理失败：${String(error)}`
                )
              );
          } else {
            streamHealthMonitor.updateStream("storage", "ok");
          }
        }
        return { ok: true };
      }
      // offscreen 上报媒体录制状态：错误时落 MEDIA_RECORDER_FAILED 问题并更新媒体健康流
      if (incoming.type === "offscreen/media-state") {
        const activeSession = await db.getActiveSession();
        const validSender =
          sender.url === chrome.runtime.getURL("offscreen.html");
        if (
          activeSession &&
          activeSession.id === incoming.payload.sessionId &&
          validSender
        ) {
          if (incoming.payload.state === "error") {
            const isFatal =
              incoming.payload.error?.includes(
                "SESSION_STORAGE_LIMIT_REACHED"
              ) || incoming.payload.error?.includes("FATAL");
            await applySessionEvent(activeSession.id, {
              type: "capture-issue",
              issue: issue(
                "MEDIA_RECORDER_FAILED",
                sanitizeText(
                  incoming.payload.error ?? "媒体录制失败",
                  activeSession.options.privacyMode
                ),
                "media",
                false
              ),
            });
            streamHealthMonitor.updateStream(
              "media",
              isFatal ? "failed" : "disrupted"
            );
            if (
              incoming.payload.error?.includes("SESSION_STORAGE_LIMIT_REACHED")
            ) {
              streamHealthMonitor.updateStream("storage", "failed");
            }
          }
        }
        return { ok: true };
      }
      await bootstrapPromise;
      switch (incoming.type) {
        // 启动新录制会话
        case "session/start":
          // 截图与视频录制互斥：截图 overlay 打开时拒绝启动录制
          if (isScreenshotOverlayOpen)
            throw new Error("截图进行中，不能启动视频录制（两者互斥）");
          return {
            ok: true,
            session: await startSession(incoming.payload),
          };
        // 停止当前录制（commandId 保证幂等）
        case "session/stop":
          return {
            ok: true,
            session: await stopSession(
              incoming.payload.commandId,
              incoming.payload.autoExport,
              incoming.payload.discard,
              incoming.payload.silentExport
            ),
          };
        // 查询当前活动会话
        case "session/status":
          return { ok: true, session: await db.getActiveSession() };
        // 按查询条件列出历史会话
        case "session/list":
          return {
            ok: true,
            sessions: await db.listSessionOverviews(incoming.payload.query),
          };
        // 删除历史会话（正在录制的活动会话拒绝删除）
        case "session/delete": {
          const active = await db.getActiveSession();
          if (active?.id === incoming.payload.sessionId)
            throw new Error("不能删除正在录制的会话");
          return {
            ok: true,
            deleted: await db.deleteSession(incoming.payload.sessionId),
          };
        }
        // 续录中断会话
        case "session/resume":
          return {
            ok: true,
            session: await continueInterruptedSession(
              incoming.payload.sessionId,
              incoming.payload.commandId
            ),
          };
        // 查询存储概览（用量与预算）
        case "storage/get":
          return { ok: true, storage: await db.getStorageOverview() };
        // 更新存储策略
        case "storage/update":
          return {
            ok: true,
            policy: await db.saveStoragePolicy(incoming.payload.policy),
          };
        // 立即清理过期会话
        case "storage/cleanup":
          return {
            ok: true,
            deletedSessionIds: await db.cleanupExpiredSessions(),
          };
        // 清空全部历史数据
        case "storage/clear-all":
          return {
            ok: true,
            deletedSessionIds: await db.clearAllHistory(),
          };
        // 直接打开指定会话的 preview 页
        case "session/open-preview":
          await chrome.tabs.create({
            url: chrome.runtime.getURL(
              `preview.html?sessionId=${incoming.payload.sessionId}`
            ),
          });
          return { ok: true };
        // content script 握手：校验归属后下发会话上下文（nonce/隐私模式/健康度），并回填环境信息
        case "content/hello": {
          const session = await db.getActiveSession();
          const allowed = Boolean(
            session &&
            RECORDING_STATUSES.includes(session.status) &&
            session.target.tabId === sender.tab?.id
          );
          // 环境信息由页面主帧自动附带，无需用户手动填写
          if (
            allowed &&
            incoming.payload.environment &&
            !session!.target.environment
          ) {
            await db.updateSession(session!.id, (current) => ({
              ...current,
              target: {
                ...current.target,
                environment: incoming.payload.environment,
              },
            }));
          }
          return {
            ok: true,
            active: allowed,
            sessionId: allowed ? session?.id : undefined,
            nonce: allowed ? session?.nonce : undefined,
            startedAtEpochMs: allowed
              ? (session?.timeline.startedAtEpochMs ??
                session?.timeline.createdAtEpochMs)
              : undefined,
            privacyMode: allowed ? session?.options.privacyMode : undefined,
            captureFrameworkState: allowed
              ? session?.options.captureFrameworkState
              : undefined,
            health: allowed ? streamHealthMonitor.getHealth() : undefined,
          };
        }
        // content script 上报截图 overlay 开合状态，用于与视频录制互斥
        case "content/screenshot-overlay-state": {
          isScreenshotOverlayOpen = Boolean(incoming.payload.open);
          return { ok: true };
        }
        // content script 上报框架状态快照（在存储预算内写入）
        case "framework/state": {
          const state = incoming.payload.state;
          const session = await db.getActiveSession();
          const valid =
            session &&
            state.sessionId === session.id &&
            RECORDING_STATUSES.includes(session.status) &&
            session.target.tabId === sender.tab?.id;
          if (!valid) return { ok: true, stored: false };
          const result = await db.saveFrameworkStateWithinBudget(state);
          return { ok: true, stored: result.stored };
        }
        // 交互候选/确认：转交 interactionCapture 落库（含截图采集决策）
        case "interaction/candidate":
        case "interaction/confirmed":
          await interactionCapture.handle(incoming.payload.interaction, sender);
          return { ok: true };
        // 交互取消：撤销候选/已确认记录
        case "interaction/cancelled":
          await interactionCapture.cancel(
            incoming.payload.interactionId,
            incoming.payload.interaction,
            incoming.sessionId,
            sender
          );
          return { ok: true };
        // 候选交互升级为已确认
        case "interaction/upgrade":
          await interactionCapture.upgrade(
            incoming.payload.interactionId,
            incoming.payload.kind
          );
          return { ok: true };
        // 问题现场采集：截图+DOM 快照落库，并累计质量增量
        case "issue-scene/capture": {
          const result = await issueSceneCapture.capture(
            incoming.payload,
            sender
          );
          await applySessionEvent(result.scene.sessionId, {
            type: "quality-delta",
            delta: {
              issueSceneCount: 1,
              partialIssueSceneCount:
                result.scene.status === "partial" ||
                result.scene.status === "failed"
                  ? 1
                  : 0,
            },
          });
          return {
            ok: true,
            scene: result.scene,
            dataUrl: result.dataUrl,
          };
        }
        // 问题现场提交定稿；stopAfterCommit 时自动停止录制
        case "issue-scene/commit": {
          const scene = await issueSceneCapture.commit(
            incoming.payload,
            sender
          );
          if (incoming.payload.stopAfterCommit)
            void stopSession(`issue-scene:${scene.id}`);
          return { ok: true, scene };
        }
        // 取消未提交的问题现场
        case "issue-scene/cancel": {
          await issueSceneCapture.cancel(
            incoming.payload.issueSceneId,
            incoming.payload.nonce,
            sender
          );
          return { ok: true };
        }
        // 触发独立截图：定位目标标签页后走 triggerScreenshotInTab（互斥校验在其中）
        case "screenshot/trigger": {
          const targetTabId = incoming.payload?.tabId || sender.tab?.id;
          if (!targetTabId) {
            const [activeTab] = await chrome.tabs.query({
              active: true,
              currentWindow: true,
            });
            if (activeTab?.id && activeTab.windowId !== undefined) {
              await triggerScreenshotInTab(activeTab.id, activeTab.windowId);
            }
          } else {
            const tab = await chrome.tabs.get(targetTabId).catch(() => null);
            if (tab?.id && tab.windowId !== undefined) {
              await triggerScreenshotInTab(tab.id, tab.windowId);
            }
          }
          return { ok: true };
        }
        case "screenshot/download": {
          // content script 无 chrome.downloads 权限：由 background 触发下载并解析真实绝对路径。
          // 内容脚本直接发送 data URL 字符串，background 无需 createObjectURL（SW 不支持）。
          const { dataUrl, filename } = incoming.payload;
          const downloadId = await chrome.downloads.download({
            url: dataUrl,
            filename,
            saveAs: false,
          });
          const absolutePath = await resolveDownloadedFilePath(downloadId);
          return { ok: true, downloadId, absolutePath };
        }
        case "screenshot/framework-probe": {
          // content script 处于隔离世界，读不到页面框架挂在 DOM 元素上的
          // __vue__/__reactFiber$ 等 expando 属性：由 background 以
          // world: "MAIN" 注入自包含探针到页面主世界读取组件链。
          const { probeIds } = incoming.payload;
          const tabId = sender.tab?.id;
          if (!tabId || !Array.isArray(probeIds) || probeIds.length === 0) {
            return { ok: true, results: {} };
          }
          const injected = await chrome.scripting.executeScript({
            target: { tabId, frameIds: [sender.frameId ?? 0] },
            world: "MAIN",
            func: runMainWorldFrameworkProbe,
            args: [probeIds],
          });
          const results: Record<string, FrameworkProbeEntry | null> = {};
          for (const frame of injected) {
            if (frame.result && typeof frame.result === "object") {
              Object.assign(results, frame.result);
            }
          }
          return { ok: true, results };
        }
        // 查询选中元素的样式来源（经 CDP 读 CSSOM）
        case "screenshot/style-source": {
          const tabId = sender.tab?.id;
          const { selectors } = incoming.payload || {};
          if (!tabId) {
            return { ok: true, sources: [] };
          }
          const { fetchStyleSourceInfoWithCDP } =
            await import("../../screenshot/cdp-style-source.ts");
          const sources = await fetchStyleSourceInfoWithCDP(tabId, selectors);
          return { ok: true, sources };
        }
        default:
          return { ok: false, error: "UNSUPPORTED_MESSAGE" };
      }
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  })();
});

// CDP 事件统一转发给 cdpCollector（网络/控制台证据采集）
chrome.debugger.onEvent.addListener((source, method, params) => {
  cdpCollector.handleEvent(source, method, params);
});

// 调试器意外断开（导航/关闭等）：非停止流程中标记 cdp 异常并尝试重连恢复
chrome.debugger.onDetach.addListener((source, reason) => {
  void bootstrapPromise.then(async () => {
    const session = await db.getActiveSession();
    if (
      session &&
      session.target.tabId === source.tabId &&
      !["STOPPING", "PREVIEW_READY", "EXPORTED", "FAILED"].includes(
        session.status
      ) &&
      !recordingCoordinator.isStopping(session.id)
    ) {
      streamHealthMonitor.updateStream("cdp", "disrupted");
      await cdpCollector.handleDetach(source, reason, () => {
        streamHealthMonitor.updateStream("cdp", "ok");
      });
    }
  });
});

// 录制目标标签页被关闭：以系统指令停止对应会话
chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    await bootstrapPromise;
    const session = await db.getActiveSession();
    if (session?.target.tabId === tabId)
      await stopSession(`system:tab-removed:${session.id}`);
  })();
});

/** 页面导航后恢复采集：重注入 content script 并校验/重连 CDP（导航不结束录制）。 */
/**
 * 页面导航会替换文档（及其中的 content script 实例），但不应当结束 tab capture 录制会话。
 * 导航稳定后重新注入当前文档的 content script，
 * 使录制挂件与交互采集器能与既有会话重新握手。
 */
async function restoreSessionAfterNavigation(tabId: number): Promise<void> {
  const session = await db.getActiveSession();
  if (
    !session ||
    !RECORDING_STATUSES.includes(session.status) ||
    session.target.tabId !== tabId
  )
    return;

  streamHealthMonitor.updateStream("content", "reconnecting");
  await contentScripts.restore(tabId);
  streamHealthMonitor.updateStream("content", "ok");

  // Chrome 在替换页面 target 时可能分离调试器。仅当目标已不再附着时才重新 attach；
  // 已附着的 target 保持原样，避免触发 "Already attached" 错误。
  if (session.options.captureConsole || session.options.captureNetwork) {
    const isOwner = await cdpCollector.verifyOwnership(tabId);
    if (isOwner) {
      streamHealthMonitor.updateStream("cdp", "ok");
    } else {
      const debuggerIssue = await cdpCollector.attach(tabId, session);
      if (debuggerIssue) {
        await applySessionEvent(session.id, {
          type: "capture-issue",
          issue: debuggerIssue,
        });
        streamHealthMonitor.updateStream("cdp", "disrupted");
      } else {
        streamHealthMonitor.updateStream("cdp", "ok");
      }
    }
  }

  await streamHealthMonitor.sync();
}

// 标签页导航完成（complete）后重注入采集脚本，恢复录制挂件与 CDP 连接
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // `complete` 为新文档提供稳定的 body 供录制挂件使用；
  // 动态注册仍会在 document_start 运行，以便尽早开始采集。
  if (changeInfo.status !== "complete") return;
  void bootstrapPromise
    .then(() =>
      recordingCoordinator.runLifecycle(() =>
        restoreSessionAfterNavigation(tabId)
      )
    )
    .catch(() => undefined);
});

chrome.runtime.onStartup.addListener(() => {
  void bootstrapPromise;
});

/** 首次安装引导页：GitHub Pages 托管的产品介绍与上手引导（引导已从扩展内迁移至网页）。 */
const ONBOARDING_PAGE_URL = "https://aoyia.github.io/bug-lens/";

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason !== "install") return;
  void (async () => {
    // 自动化测试（Playwright E2E）通过 skipOnboardingGuide 标记跳过，避免打断测试
    const stored = (await chrome.storage.local
      .get("skipOnboardingGuide")
      .catch(() => ({}))) as { skipOnboardingGuide?: boolean };
    if (stored?.skipOnboardingGuide) return;
    await chrome.tabs
      .create({ url: ONBOARDING_PAGE_URL })
      .catch(() => undefined);
  })();
});
// 免维存储：定期清理过期会话（6 小时一次，比 24 小时更及时回收空间）
chrome.alarms.create("bug-lens-storage-cleanup", { periodInMinutes: 6 * 60 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "bug-lens-storage-cleanup")
    void db.cleanupExpiredSessions();
});

const LAST_OPTIONS_KEY = "last-recording-options";

/**
 * 全局快捷键（start-recording，默认 Alt+R / Option+R）：
 * 直接对当前激活标签页启动录制，无需打开 Popup。
 * 选项复用上次在 Popup 中选择的配置（未配置时用安全默认值）。
 * 成功与否不弹系统通知：录制启动后页面内会自动出现录制挂件，
 * 这本身就是最直观的启动反馈；不满足启动条件时静默跳过。
 */
async function startRecordingViaShortcut(): Promise<void> {
  await bootstrapPromise;
  // 截图与视频录制互斥：截图 overlay 打开时拒绝启动录制
  if (isScreenshotOverlayOpen) {
    console.warn("[Bug Lens] 截图进行中，拒绝启动视频录制（两者互斥）");
    return;
  }
  const active = await db.getActiveSession();
  if (active && ACTIVE_STATUSES.includes(active.status)) {
    return;
  }
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) {
    return;
  }
  const stored = (await chrome.storage.local.get(LAST_OPTIONS_KEY)) as {
    [LAST_OPTIONS_KEY]?: unknown;
  };
  const options = normalizeRecordingOptions(
    stored[LAST_OPTIONS_KEY] as
      Parameters<typeof normalizeRecordingOptions>[0] | undefined,
    await db.getStoragePolicy()
  );
  try {
    await startSession({
      tabId: tab.id,
      options,
      commandId: crypto.randomUUID(),
    });
  } catch (error) {
    console.warn(`[Bug Lens] 全局快捷键启动录制失败：${String(error)}`);
  }
}

/** 独立截图入口（popup/快捷键/消息共用）：录制互斥 → 注入 content script → captureVisibleTab → 唤起页面 overlay。 */
export async function triggerScreenshotInTab(
  tabId: number,
  windowId: number
): Promise<void> {
  await bootstrapPromise;
  // 截图与视频录制互斥：录制进行中拒绝触发独立截图
  const active = await db.getActiveSession();
  if (active && ACTIVE_STATUSES.includes(active.status)) {
    console.warn("[Bug Lens] 录制进行中，拒绝触发独立截图（两者互斥）");
    return;
  }
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || !tab.url || !/^https?:/.test(tab.url)) {
    console.warn("[Bug Lens] 截图功能仅支持 http/https 普通网页");
    return;
  }

  // 1. 确保 Content Script 在触发截图前被注入并激活
  await contentScripts.activate(tabId).catch((err) => {
    console.warn(`[Bug Lens] 动态注入 Content Script 失败: ${String(err)}`);
  });

  // 2. 截取视口图像
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
    format: "png",
  });

  // 3. 唤起页面的 Screenshot Overlay
  await chrome.tabs.sendMessage(tabId, {
    type: "TRIGGER_SCREENSHOT_OVERLAY",
    viewportDataUrl: dataUrl,
  });
}

/** 截图快捷键入口：对当前激活标签页触发独立截图。 */
async function startScreenshotViaShortcut(): Promise<void> {
  await bootstrapPromise;
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (!tab?.id || tab.windowId === undefined) return;
  try {
    await triggerScreenshotInTab(tab.id, tab.windowId);
  } catch (error) {
    console.warn(`[Bug Lens] 快捷键触发截图失败：${String(error)}`);
  }
}

// 全局快捷键分发：start-recording → 录屏，take-screenshot → 独立截图
chrome.commands.onCommand.addListener((command) => {
  if (command === "start-recording") {
    void startRecordingViaShortcut();
  } else if (command === "take-screenshot") {
    void startScreenshotViaShortcut();
  }
});
