import { db } from "../../storage/db";
import {
  ACTIVE_STATUSES,
  isEnvelope,
  message,
  RECORDING_STATUSES,
  type CaptureIssue,
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

const EXTENSION_VERSION = "0.4.0";
const STOPPING_IDS_KEY = "bug-lens-stopping-ids";
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
const contentScripts = new ContentScriptManager();
const BROWSER_EPOCH_KEY = "bug-lens-browser-epoch";
const browserEpochPromise = loadOrCreateBrowserEpoch();

async function loadOrCreateBrowserEpoch(): Promise<string> {
  const stored = await chrome.storage.session.get(BROWSER_EPOCH_KEY);
  const existing = stored[BROWSER_EPOCH_KEY];
  if (typeof existing === "string" && existing) return existing;
  const created = crypto.randomUUID();
  await chrome.storage.session.set({ [BROWSER_EPOCH_KEY]: created });
  return created;
}

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

function startSession(
  payload: Extract<RuntimeMessage, { type: "session/start" }>["payload"]
): Promise<RecordingSession> {
  return recordingCoordinator.runLifecycle(() => startSessionImpl(payload));
}

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

chrome.runtime.onMessage.addListener((raw: unknown, sender) => {
  if (!isEnvelope(raw)) return;
  const incoming = raw as RuntimeMessage;
  if (incoming.target && incoming.target !== "background") return;

  return (async () => {
    try {
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
        case "session/start":
          // 截图与视频录制互斥：截图 overlay 打开时拒绝启动录制
          if (isScreenshotOverlayOpen)
            throw new Error("截图进行中，不能启动视频录制（两者互斥）");
          return {
            ok: true,
            session: await startSession(incoming.payload),
          };
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
        case "session/status":
          return { ok: true, session: await db.getActiveSession() };
        case "session/list":
          return {
            ok: true,
            sessions: await db.listSessionOverviews(incoming.payload.query),
          };
        case "session/delete": {
          const active = await db.getActiveSession();
          if (active?.id === incoming.payload.sessionId)
            throw new Error("不能删除正在录制的会话");
          return {
            ok: true,
            deleted: await db.deleteSession(incoming.payload.sessionId),
          };
        }
        case "session/resume":
          return {
            ok: true,
            session: await continueInterruptedSession(
              incoming.payload.sessionId,
              incoming.payload.commandId
            ),
          };
        case "storage/get":
          return { ok: true, storage: await db.getStorageOverview() };
        case "storage/update":
          return {
            ok: true,
            policy: await db.saveStoragePolicy(incoming.payload.policy),
          };
        case "storage/cleanup":
          return {
            ok: true,
            deletedSessionIds: await db.cleanupExpiredSessions(),
          };
        case "storage/clear-all":
          return {
            ok: true,
            deletedSessionIds: await db.clearAllHistory(),
          };
        case "session/open-preview":
          await chrome.tabs.create({
            url: chrome.runtime.getURL(
              `preview.html?sessionId=${incoming.payload.sessionId}`
            ),
          });
          return { ok: true };
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
        case "content/screenshot-overlay-state": {
          isScreenshotOverlayOpen = Boolean(incoming.payload.open);
          return { ok: true };
        }
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
        case "interaction/candidate":
        case "interaction/confirmed":
          await interactionCapture.handle(incoming.payload.interaction, sender);
          return { ok: true };
        case "interaction/cancelled":
          await interactionCapture.cancel(
            incoming.payload.interactionId,
            incoming.payload.interaction,
            incoming.sessionId,
            sender
          );
          return { ok: true };
        case "interaction/upgrade":
          await interactionCapture.upgrade(
            incoming.payload.interactionId,
            incoming.payload.kind
          );
          return { ok: true };
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
        case "issue-scene/commit": {
          const scene = await issueSceneCapture.commit(
            incoming.payload,
            sender
          );
          if (incoming.payload.stopAfterCommit)
            void stopSession(`issue-scene:${scene.id}`);
          return { ok: true, scene };
        }
        case "issue-scene/cancel": {
          await issueSceneCapture.cancel(
            incoming.payload.issueSceneId,
            incoming.payload.nonce,
            sender
          );
          return { ok: true };
        }
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
        default:
          return { ok: false, error: "UNSUPPORTED_MESSAGE" };
      }
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  })();
});

chrome.debugger.onEvent.addListener((source, method, params) => {
  cdpCollector.handleEvent(source, method, params);
});

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

chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    await bootstrapPromise;
    const session = await db.getActiveSession();
    if (session?.target.tabId === tabId)
      await stopSession(`system:tab-removed:${session.id}`);
  })();
});

/**
 * A page navigation replaces the document (and therefore its content-script
 * instance), but it must not end a tab capture session. Re-inject the current
 * document's content script after the navigation settles so the recording
 * widget and interaction collectors can handshake with the existing session.
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

  // Chrome may detach the debugger while replacing the page target. Reattach
  // only when it is no longer attached; an already-attached target is left
  // alone to avoid the "Already attached" error.
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

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // `complete` gives the new document a stable body for the widget. The
  // dynamic registration still runs at document_start for early collection.
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

chrome.commands.onCommand.addListener((command) => {
  if (command === "start-recording") {
    void startRecordingViaShortcut();
  } else if (command === "take-screenshot") {
    void startScreenshotViaShortcut();
  }
});
