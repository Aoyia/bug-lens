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
import { isEn, t } from "../../shared/i18n";
import { ensureOffscreenDocument } from "../../shared/offscreen";
import { flushStorageBatchQueue } from "../../storage/db";
import type { BackgroundContext } from "./context";

import type { DownloadTimingStats } from "../../domain/download-path-resolver";
import {
  createExportTraceContext,
  getPerformanceOrigin,
  type CdpFinalizeStats,
  type ExportTraceContext,
  type Stage2Metrics,
  type Stage5Metrics,
} from "../../export/export-trace";

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
    silentExport?: boolean,
    traceStartMs?: number,
    traceContext?: ExportTraceContext
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
    silentExport?: boolean,
    traceStartMs?: number,
    traceContext?: ExportTraceContext
  ): Promise<RecordingSession | undefined>;
  stopImpl(
    commandId?: string,
    autoExport?: boolean,
    discard?: boolean,
    silentExport?: boolean,
    traceStartMs?: number,
    traceContext?: ExportTraceContext
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
            entry.screenshot?.status === "captured" &&
            entry.screenshot?.source === "primary"
        ).length,
        fallbackScreenshotCount: included.filter(
          (entry) =>
            entry.screenshot?.status === "captured" &&
            (entry.screenshot?.source === "fallback" ||
              entry.screenshot?.source === "video-frame")
        ).length,
        unavailableScreenshotCount: included.filter(
          (entry) => entry.screenshot?.status === "unavailable"
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
          t("qualityIssueScenePartial"),
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
                mediaResponse?.error ?? t("mediaRecorderFailed"),
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
            t("qualityMediaStreamIdFailed"),
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
        interactionCapture.reset?.();
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
    if (!previous) throw new Error(t("resumeSessionNotFound", sessionId));
    if (
      !previous.quality.issues.some(
        (entry) =>
          entry.code.startsWith("SESSION_") ||
          entry.code === "MEDIA_CONTEXT_LOST"
      )
    ) {
      throw new Error(t("sessionNotContinuable"));
    }
    const tab = (
      await chrome.tabs.query({ active: true, currentWindow: true })
    )[0];
    if (!tab?.id) throw new Error(t("failedToReadTabForResume"));
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
    silentExport = false,
    traceStartMs?: number,
    traceContext?: ExportTraceContext
  ): Promise<RecordingSession | undefined> {
    const tTraceStart = traceStartMs ?? performance.now();
    let initialT0: number | undefined;
    if (typeof traceStartMs === "number" && Number.isFinite(traceStartMs)) {
      if (traceStartMs > 1e11) {
        initialT0 = traceStartMs;
      } else {
        initialT0 = getPerformanceOrigin() + traceStartMs;
      }
    }
    const effectiveTraceContext =
      traceContext ?? createExportTraceContext(initialT0);
    const e2eMetrics: Array<{
      step: string;
      durationMs: number;
      size?: string;
      note?: string;
    }> = [];

    if (["EXPORTED", "FAILED"].includes(session.status)) return session;

    if (session.status === "PREVIEW_READY") {
      if (!silentExport) return session;
      recordingCoordinator.beginStopping(session.id);
      try {
        return await performSilentExport(
          session,
          tTraceStart,
          e2eMetrics,
          effectiveTraceContext
        );
      } finally {
        recordingCoordinator.finishStopping(session.id);
      }
    }

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

    // 并发预热 Offscreen Document 并预加载静态报告资源模版，消除阶段 3 冷启动等待
    let offscreenPreheatPromise: Promise<void> | undefined;
    if (silentExport) {
      offscreenPreheatPromise = (async () => {
        try {
          await ensureOffscreenDocument();
          await chrome.runtime
            .sendMessage(
              message(
                "offscreen/preload-export",
                { sessionId: session.id },
                session.id,
                "offscreen"
              )
            )
            .catch(() => undefined);
        } catch {}
      })();
    }

    // 立即熔断并取消在途未截取的排队任务，防止阻塞收尾
    interactionCapture.abortPending(session.id);

    const tStage2Start = performance.now();
    let cdpFinalizeStats: CdpFinalizeStats = {
      totalRequests: 0,
      successCount: 0,
      failureCount: 0,
      totalBodyBytes: 0,
      avgDurationMs: 0,
      durationMs: 0,
      throughputMBps: 0,
    };
    let mediaStopDurationMs = 0;
    let queueDrainDurationMs = 0;
    let issueSceneFinalizeDurationMs = 0;
    let qualityReconcileDurationMs = 0;

    try {
      await cdpCollector.detach(session.target.tabId);

      const tMediaStart = performance.now();
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
      mediaStopDurationMs = performance.now() - tMediaStart;

      if (mediaResponse?.ok === false)
        cleanupErrors.push(
          t("cleanupMediaStopFailed", [
            mediaResponse.error ?? t("unknownError"),
          ])
        );

      const tDrainStart = performance.now();
      cleanupErrors.push(...(await interactionCapture.drain(1200, session.id)));
      cleanupErrors.push(...(await issueSceneCapture.drain()));
      cleanupErrors.push(...(await cdpCollector.drain()));
      await flushStorageBatchQueue().catch(() => {});
      queueDrainDurationMs = performance.now() - tDrainStart;

      const tCdpStart = performance.now();
      await cdpCollector
        .finalizeNetworkBodies(stopping)
        .then((stats) => {
          if (stats) cdpFinalizeStats = stats;
        })
        .catch((error) =>
          cleanupErrors.push(t("cleanupNetworkFinalizeFailed", [String(error)]))
        );
      if (cdpFinalizeStats.durationMs === 0) {
        cdpFinalizeStats.durationMs = performance.now() - tCdpStart;
      }

      const tIssueStart = performance.now();
      await issueSceneCapture
        .finalizeUnfinished(session.id)
        .catch((error) =>
          cleanupErrors.push(
            t("cleanupIssueSceneFinalizeFailed", [String(error)])
          )
        );
      issueSceneFinalizeDurationMs = performance.now() - tIssueStart;

      const tQualityStart = performance.now();
      await reconcileSessionQuality(session.id).catch((error) =>
        cleanupErrors.push(t("cleanupQualityReconcileFailed", [String(error)]))
      );
      qualityReconcileDurationMs = performance.now() - tQualityStart;
    } finally {
      await cdpCollector.detach(session.target.tabId);
      if (!silentExport) {
        await contentScripts.remove(session.target.tabId);
      }
      streamHealthMonitor.reset(session.target.tabId);
    }
    const stage2DurationMs = performance.now() - tStage2Start;
    const stage2Metrics: Stage2Metrics = {
      mediaStopDurationMs,
      queueDrainDurationMs,
      cdpFinalizeStats,
      issueSceneFinalizeDurationMs,
      qualityReconcileDurationMs,
      totalDurationMs: stage2DurationMs,
    };
    effectiveTraceContext.stage2 = stage2Metrics;

    e2eMetrics.push({
      step: "2. 采集器 Drain 与 CDP 萃取",
      durationMs: stage2DurationMs,
      size: `${cdpFinalizeStats.totalRequests} 个请求`,
      note: `正文拉取成功 ${cdpFinalizeStats.successCount}/${cdpFinalizeStats.totalRequests}, 吞吐 ${cdpFinalizeStats.throughputMBps.toFixed(2)} MB/s`,
    });

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
          sanitizeText(
            cleanupErrors.join(isEn() ? "; " : "；"),
            session.options.privacyMode
          ),
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
        if (offscreenPreheatPromise) {
          await offscreenPreheatPromise.catch(() => undefined);
        }
        return await performSilentExport(
          next,
          tTraceStart,
          e2eMetrics,
          effectiveTraceContext
        );
      }
      return await openPendingPreview(next, autoExport);
    } finally {
      recordingCoordinator.finishStopping(session.id);
    }
  }

  async function performSilentExport(
    session: RecordingSession,
    tTraceStart: number,
    e2eMetrics: Array<{
      step: string;
      durationMs: number;
      size?: string;
      note?: string;
    }>,
    traceContext?: ExportTraceContext
  ): Promise<RecordingSession> {
    let prompt: string | undefined;
    let packResult: SilentExportPackResult | undefined;
    let resolvedPath: string | undefined;
    let caughtError: unknown;
    try {
      await ensureOffscreenDocument();
      packResult = (await chrome.runtime.sendMessage(
        message(
          "offscreen/export-pack",
          { sessionId: session.id, traceContext },
          undefined,
          "offscreen"
        )
      )) as SilentExportPackResult;

      if (packResult?.stage3Metrics) {
        e2eMetrics.push({
          step: "3. 证据数据读取与 AI 报告组装",
          durationMs: packResult.stage3Metrics.totalDurationMs,
          size: `${packResult.stage3Metrics.promptCharCount} 字符`,
          note: `IndexedDB 查询 ${packResult.stage3Metrics.dbQueryDurationMs.toFixed(2)} ms, 模版加载 ${packResult.stage3Metrics.templateLoadDurationMs.toFixed(2)} ms`,
        });
      } else if (packResult?.queryTimeMs !== undefined) {
        e2eMetrics.push({
          step: "3. 证据数据读取与 AI 报告组装",
          durationMs: packResult.queryTimeMs,
          note: "IndexedDB 读取会话/日志/截图索引并生成 Prompt",
        });
      }

      if (packResult?.stage4Metrics) {
        e2eMetrics.push({
          step: "4. 流式 ZIP 封包与哈希管线",
          durationMs: packResult.stage4Metrics.totalDurationMs,
          size: `${(packResult.stage4Metrics.totalCompressedBytes / (1024 * 1024)).toFixed(2)} MB`,
          note: `封包吞吐 ${packResult.stage4Metrics.overallThroughputMBps.toFixed(2)} MB/s, 压缩比 ${(packResult.stage4Metrics.compressionRatio * 100).toFixed(1)}%`,
        });
      } else if (packResult?.packTimeMs !== undefined) {
        e2eMetrics.push({
          step: "4. 流式 ZIP 封包与哈希管线",
          durationMs: packResult.packTimeMs,
          size:
            packResult.totalBytes !== undefined
              ? `${(packResult.totalBytes / (1024 * 1024)).toFixed(2)} MB`
              : undefined,
          note: `${packResult.totalEntries ?? 0} 个条目打包完成`,
        });
      }

      if (packResult?.ok && packResult.blobUrl && packResult.filename) {
        const tDownloadStart = performance.now();
        let downloadId: number | undefined;
        let downloadCallDurationMs = 0;
        try {
          downloadId = await chrome.downloads.download({
            url: packResult.blobUrl,
            filename: packResult.filename,
            saveAs: false,
          });
          downloadCallDurationMs = performance.now() - tDownloadStart;
        } catch (downloadErr) {
          downloadCallDurationMs = performance.now() - tDownloadStart;
          if (traceContext) {
            traceContext.stage5 = {
              downloadCallDurationMs,
              pollWaitDurationMs: 0,
              pollCount: 0,
              avgPollIntervalMs: 0,
              pathResolveDurationMs: 0,
              resolvedFilename: packResult.filename,
              totalDurationMs: downloadCallDurationMs,
            };
          }
          throw downloadErr;
        }

        prompt = packResult.prompt;
        let downloadTimingStats: DownloadTimingStats = {
          pollWaitMs: 0,
          pollCount: 0,
          avgPollIntervalMs: 0,
          pathResolveMs: 0,
          totalDurationMs: downloadCallDurationMs,
        };

        resolvedPath = packResult.filename;
        if (downloadId) {
          const absolutePath = await ctx.resolveDownloadedFilePath(
            downloadId,
            15000,
            (stats) => {
              downloadTimingStats = {
                ...stats,
                downloadCallMs: downloadCallDurationMs,
                totalDurationMs: downloadCallDurationMs + stats.totalDurationMs,
              };
            }
          );
          if (absolutePath) {
            resolvedPath = absolutePath;
            if (prompt) {
              prompt = injectAbsolutePathToPrompt(
                prompt,
                packResult.filename,
                absolutePath
              );
            }
          }
        }

        const stage5Metrics: Stage5Metrics = {
          downloadCallDurationMs,
          pollWaitDurationMs: downloadTimingStats.pollWaitMs,
          pollCount: downloadTimingStats.pollCount,
          avgPollIntervalMs: downloadTimingStats.avgPollIntervalMs,
          pathResolveDurationMs: downloadTimingStats.pathResolveMs,
          resolvedFilename: resolvedPath,
          totalDurationMs: downloadTimingStats.totalDurationMs,
        };

        if (traceContext) {
          traceContext.stage5 = stage5Metrics;
        }

        e2eMetrics.push({
          step: "5. 浏览器下载与本地绝对路径解析",
          durationMs: stage5Metrics.totalDurationMs,
          note: `API 调用 ${downloadCallDurationMs.toFixed(2)} ms, 轮询 ${stage5Metrics.pollCount} 次 (${stage5Metrics.pollWaitDurationMs.toFixed(2)} ms)`,
        });
      }
    } catch (err) {
      caughtError = err;
    }

    if (traceContext && packResult?.stage3Metrics) {
      traceContext.stage3 = packResult.stage3Metrics;
    }
    if (traceContext && packResult?.stage4Metrics) {
      traceContext.stage4 = packResult.stage4Metrics;
    }

    const silentExportResult = resolveSilentExportResult(
      packResult,
      caughtError
    );
    if (packResult?.perfReport) {
      silentExportResult.perfReport = packResult.perfReport;
    }
    silentExportResult.e2eMetrics = e2eMetrics;
    if (traceContext) {
      silentExportResult.traceContext = traceContext;
    }
    if (packResult?.filename) {
      silentExportResult.filename = resolvedPath;
    }

    if (!silentExportResult.ok) {
      const failed = await db.updateSession(session.id, (current) => ({
        ...reduceSession(
          current,
          buildSilentExportFailureEvent(
            silentExportResult.error ?? t("unknownError"),
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
      await contentScripts.remove(session.target.tabId).catch(() => undefined);
    }
    return { ...session, silentPrompt: prompt, silentExportResult };
  }

  /** 幂等停止：同 commandId 已入库则直接复用其关联会话，保证一条停止指令只执行一次。 */
  async function stopSessionImpl(
    commandId?: string,
    autoExport = false,
    discard = false,
    silentExport = false,
    traceStartMs?: number,
    traceContext?: ExportTraceContext
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
      performStopSession(
        session!,
        commandId,
        autoExport,
        discard,
        silentExport,
        traceStartMs,
        traceContext
      )
    );
  }

  /** runLifecycle 串行包装，与启动等生命周期操作互斥。 */
  function stopSession(
    commandId?: string,
    autoExport = false,
    discard = false,
    silentExport = false,
    traceStartMs?: number,
    traceContext?: ExportTraceContext
  ): Promise<RecordingSession | undefined> {
    return recordingCoordinator.runLifecycle(() =>
      stopSessionImpl(
        commandId,
        autoExport,
        discard,
        silentExport,
        traceStartMs,
        traceContext
      )
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
        .catch(async () =>
          chrome.windows
            .create({ url: previewUrl })
            .then(() => true)
            .catch(() => false)
        ));
    if (!opened) {
      await db.clearActive(session.id);
      return session;
    }
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
