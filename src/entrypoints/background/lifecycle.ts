import {
  message,
  type CaptureIssue,
  type RecordingSession,
  type RuntimeMessage,
} from "../../shared/protocol";
import { applySessionEvent as reduceSession } from "../../domain/recording-session";
import { sanitizeText, sanitizeUrl } from "../../domain/privacy-policy";
import { normalizeRecordingOptions } from "../../domain/storage-policy";
import {
  buildSilentExportFailureEvent,
  injectAbsolutePathToPrompt,
  resolveSilentExportResult,
  type SilentExportPackResult,
} from "../../domain/silent-export";
import { ensureOffscreenDocument } from "../../shared/offscreen";
import type { BackgroundContext } from "./context";

export type StartSessionPayload = Extract<
  RuntimeMessage,
  { type: "session/start" }
>["payload"];

/** 会话生命周期服务：启动/停止/续录/预览打开/质量对账/媒体控制。 */
export interface SessionLifecycle {
  start(payload: StartSessionPayload): Promise<RecordingSession>;
  stop(
    commandId?: string,
    autoExport?: boolean,
    discard?: boolean,
    silentExport?: boolean
  ): Promise<RecordingSession | undefined>;
  continueInterrupted(
    sessionId: string,
    commandId: string
  ): Promise<RecordingSession>;
  openPendingPreview(
    session: RecordingSession,
    autoExport?: boolean
  ): Promise<RecordingSession>;
  reconcileSessionQuality(sessionId: string): Promise<void>;
  performStop(
    session: RecordingSession,
    commandId?: string,
    autoExport?: boolean,
    discard?: boolean,
    silentExport?: boolean
  ): Promise<RecordingSession | undefined>;
  stopImpl(
    commandId?: string,
    autoExport?: boolean,
    discard?: boolean,
    silentExport?: boolean
  ): Promise<RecordingSession | undefined>;
  pauseMedia(sessionId: string): Promise<void>;
  resumeMedia(sessionId: string): Promise<void>;
}

export function createSessionLifecycle(
  ctx: BackgroundContext
): SessionLifecycle {
  const {
    db,
    extensionVersion: EXTENSION_VERSION,
    browserEpochPromise,
    streamHealthMonitor,
    recordingCoordinator,
    contentScripts,
    cdpCollector,
    interactionCapture,
    issueSceneCapture,
    navigationCapture,
  } = ctx;

  /** 并行读取交互/控制台/网络/问题现场四类证据，重算质量快照写入会话。 */
  async function reconcileSessionQuality(sessionId: string): Promise<void> {
    const [interactions, consoleEntries, networkEntries, issueScenes] =
      await Promise.all([
        db.getInteractions(sessionId),
        db.getConsole(sessionId),
        db.getNetwork(sessionId),
        db.getIssueScenes(sessionId),
      ]);
    const included = interactions.filter(
      (entry) => entry.status !== "cancelled"
    );
    await ctx.applySessionEvent(sessionId, {
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
      await ctx.applySessionEvent(sessionId, {
        type: "capture-issue",
        issue: ctx.issue(
          "ISSUE_SCENE_PARTIAL",
          "至少一个问题现场只完成了部分采集。",
          "issue-scene"
        ),
      });
    }
  }

  /**
   * 启动录制主流程：claimSession 互斥抢占 → 取媒体流 → 拉起 offscreen 文档
   * → 注入 content script → CDP attach → offscreen/start-media → 落 started 事件；
   * 任一步失败则回滚已启动的资源并落 failed 事件。
   */
  async function startSessionImpl(
    payload: StartSessionPayload
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
            ctx.issue(
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
          ctx.issue(
            "MEDIA_STREAM_ID_FAILED",
            "未取得标签页媒体流，已进入降级录制。",
            "media",
            false
          )
        );
      }
      const started = await ctx.applySessionEvent(session.id, {
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
            (options.captureConsole || options.captureNetwork) &&
            !debuggerIssue,
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
      const failure = ctx.issue(
        "SESSION_START_FAILED",
        sanitizeText(String(error), options.privacyMode),
        "media",
        false
      );
      const failed = await ctx.applySessionEvent(session.id, {
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
    payload: StartSessionPayload
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
          entry.code.startsWith("SESSION_") ||
          entry.code === "MEDIA_CONTEXT_LOST"
      )
    ) {
      throw new Error(`该会话未处于可继续状态`);
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
    const stopping = await ctx.applySessionEvent(session.id, {
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
        cleanupErrors.push(
          `媒体停止失败：${mediaResponse.error ?? "未知错误"}`
        );

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
      ? ctx.issue(
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
      if (!next)
        throw new Error(`未找到会话 (SESSION_NOT_FOUND:${session.id})`);
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
              const absolutePath =
                await ctx.resolveDownloadedFilePath(downloadId);
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

  async function pauseMediaSession(sessionId: string): Promise<void> {
    const session = await db.getSession(sessionId);
    if (session && session.options.captureVideo) {
      await chrome.runtime
        .sendMessage(
          message(
            "offscreen/pause-media",
            { sessionId },
            sessionId,
            "offscreen"
          )
        )
        .catch(() => undefined);
    }
  }

  async function resumeMediaSession(sessionId: string): Promise<void> {
    const session = await db.getSession(sessionId);
    if (session && session.options.captureVideo) {
      await chrome.runtime
        .sendMessage(
          message(
            "offscreen/resume-media",
            { sessionId },
            sessionId,
            "offscreen"
          )
        )
        .catch(() => undefined);
    }
  }

  return {
    start: startSession,
    stop: stopSession,
    continueInterrupted: continueInterruptedSession,
    openPendingPreview,
    reconcileSessionQuality,
    performStop: performStopSession,
    stopImpl: stopSessionImpl,
    pauseMedia: pauseMediaSession,
    resumeMedia: resumeMediaSession,
  };
}
