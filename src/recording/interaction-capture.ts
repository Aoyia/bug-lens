import { DevProfiler } from "../shared/dev-profiler.ts";
import {
  applyInteractionEvent,
  type InteractionEvent,
} from "../domain/interaction-ledger.ts";
import {
  sanitizeInteractionRecord,
  sanitizeText,
} from "../domain/privacy-policy.ts";
import type { EvidenceRepository } from "../storage/db.ts";
import { t } from "../shared/i18n.ts";
import {
  message,
  RECORDING_STATUSES,
  type CaptureIssue,
  type InteractionRecord,
  type RecordingSession,
} from "../shared/protocol.ts";
import type { RecordingSessionEvent } from "../domain/recording-session.ts";

type InteractionRepository = Pick<
  EvidenceRepository,
  | "getActiveSession"
  | "getInteraction"
  | "saveInteractionWithinBudget"
  | "saveEvidenceAssetWithinBudget"
>;

type SessionEventWriter = (
  sessionId: string,
  event: RecordingSessionEvent
) => Promise<RecordingSession>;

function issue(
  code: string,
  messageText: string,
  source: CaptureIssue["source"]
): CaptureIssue {
  return {
    code,
    message: messageText,
    source,
    recoverable: true,
    occurredAt: Date.now(),
  };
}

function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  const base64 = dataUrl.split(",")[1] ?? "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export class InteractionCapture {
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly pending = new Set<Promise<void>>();
  private readonly repository: InteractionRepository;
  private readonly writeSessionEvent: SessionEventWriter;
  private readonly isStopping: (sessionId: string) => boolean;
  private aborted = false;

  constructor(
    repository: InteractionRepository,
    writeSessionEvent: SessionEventWriter,
    isStopping: (sessionId: string) => boolean
  ) {
    this.repository = repository;
    this.writeSessionEvent = writeSessionEvent;
    this.isStopping = isStopping;
  }

  handle(
    interaction: InteractionRecord,
    sender: chrome.runtime.MessageSender
  ): Promise<void> {
    return this.track(this.handleInteraction(interaction, sender));
  }

  cancel(
    interactionId: string,
    interaction: InteractionRecord | undefined,
    nonce: string | undefined,
    sender: chrome.runtime.MessageSender
  ): Promise<void> {
    return this.track(
      this.cancelInteraction(interactionId, interaction, nonce, sender)
    );
  }

  async upgrade(
    interactionId: string,
    kind: InteractionRecord["kind"]
  ): Promise<void> {
    const session = await this.repository.getActiveSession();
    if (!session) return;
    const previous = await this.repository.getInteraction(interactionId);
    if (!previous || previous.sessionId !== session.id) return;
    if (previous.kind === kind) return;
    await this.repository.saveInteractionWithinBudget({
      ...previous,
      kind,
    });
  }

  /** 停止时调用：立即熔断取消在途未截取的队列，并在超时保护下等待当前执行完成 */
  abortPending(): void {
    this.aborted = true;
  }

  async drain(timeoutMs = 1200): Promise<string[]> {
    this.abortPending();
    const errors: string[] = [];
    if (!this.pending.size) return errors;

    const timeoutPromise = new Promise<void>((resolve) =>
      setTimeout(resolve, timeoutMs)
    );
    const drainPromise = Promise.allSettled(Array.from(this.pending)).then(
      (results) => {
        for (const res of results) {
          if (
            res.status === "rejected" &&
            res.reason?.message !== "CAPTURE_ABORTED"
          ) {
            errors.push(String(res.reason));
          }
        }
      }
    );

    await Promise.race([drainPromise, timeoutPromise]);
    this.pending.clear();
    return errors;
  }

  private track(task: Promise<void>): Promise<void> {
    this.pending.add(task);
    void task.then(
      () => this.pending.delete(task),
      () => this.pending.delete(task)
    );
    return task;
  }

  private enqueue<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(work);
    this.queues.set(key, current);
    void current.then(
      () => {
        if (this.queues.get(key) === current) this.queues.delete(key);
      },
      () => {
        if (this.queues.get(key) === current) this.queues.delete(key);
      }
    );
    return current;
  }

  /**
   * 以 sessionId:interactionId 为 key 的串行队列执行 applyInteractionEvent：
   * 同一交互的并发事件（候选→确认、截图落库等）按到达顺序合并，避免读-改-写竞争。
   */
  private persist(
    sessionId: string,
    interactionId: string,
    event: InteractionEvent
  ): Promise<{
    previous?: InteractionRecord;
    next?: InteractionRecord;
    budgetRejected?: boolean;
  }> {
    return this.enqueue(`${sessionId}:${interactionId}`, async () => {
      const previous = await this.repository.getInteraction(interactionId);
      const next = applyInteractionEvent(previous, event);
      if (next && next !== previous) {
        const stored = await this.repository.saveInteractionWithinBudget(next);
        if (!stored.stored)
          return { previous, next: previous, budgetRejected: true };
      }
      return { previous, next };
    });
  }

  /**
   * 准入校验链：会话存在、非停止中、状态在录制状态集内，且消息来自录制目标
   * tab、nonce 与会话匹配（防串会话 / 伪造请求）。
   */
  private isAccepted(
    session: RecordingSession | undefined,
    sender: chrome.runtime.MessageSender,
    nonce: string | undefined
  ): session is RecordingSession {
    return Boolean(
      session &&
      !this.isStopping(session.id) &&
      RECORDING_STATUSES.includes(session.status) &&
      session.target.tabId === sender.tab?.id &&
      session.nonce === nonce
    );
  }

  private latestTopViewport?: { width: number; height: number };

  /**
   * 多级权威顶层视口决议策略：
   * 1. 来自主帧 (frameId === 0) 的最新交互视口；
   * 2. 之前已确立的最新主帧视口缓存（抵消子 frame 局部退化尺寸）；
   * 3. 会话启动时主帧上报的权威环境快照 (session.target.environment)；
   * 4. 自身已成功解析的视口；
   * 5. 桌面标准基线兜底 (1280x720)。
   */
  private resolveTopViewport(
    session: RecordingSession,
    interaction: InteractionRecord,
    frameId: number
  ): { width: number; height: number } {
    const incomingVp = interaction.coordinates?.viewport;
    const hasIncomingVp = Boolean(
      incomingVp && incomingVp.width > 0 && incomingVp.height > 0
    );

    // 1. 若交互来自主帧，其视口为最新权威顶层视口
    if (frameId === 0 && hasIncomingVp) {
      this.latestTopViewport = {
        width: incomingVp.width,
        height: incomingVp.height,
      };
      return this.latestTopViewport;
    }

    // 2. 若已有之前由主帧交互确立的最新顶层视口
    if (
      this.latestTopViewport &&
      this.latestTopViewport.width > 0 &&
      this.latestTopViewport.height > 0
    ) {
      if (frameId !== 0) {
        return this.latestTopViewport;
      }
    }

    // 3. 检查会话录制启动时主帧上报的权威环境快照中的视口
    const env = session.target.environment;
    if (env && env.viewportWidth > 0 && env.viewportHeight > 0) {
      const envViewport = {
        width: env.viewportWidth,
        height: env.viewportHeight,
      };
      this.latestTopViewport = envViewport;
      return envViewport;
    }

    // 4. 若子 frame 自身已成功解析到有效视口
    if (hasIncomingVp) {
      return {
        width: incomingVp.width,
        height: incomingVp.height,
      };
    }

    // 5. 最终安全兜底
    return { width: 1280, height: 720 };
  }

  private async handleInteraction(
    interaction: InteractionRecord,
    sender: chrome.runtime.MessageSender
  ): Promise<void> {
    const session = await this.repository.getActiveSession();
    if (!this.isAccepted(session, sender, interaction.sessionId)) return;
    const authoritativeFrameId =
      typeof sender.frameId === "number"
        ? sender.frameId
        : interaction.page.frameId >= 0
          ? interaction.page.frameId
          : 0;

    const effectiveViewport = this.resolveTopViewport(
      session,
      interaction,
      authoritativeFrameId
    );

    // 脱敏后落库：强制绑定当前会话 id 并按隐私模式过滤，同时按会话选项
    // 关闭截图存储（captureScreenshots 未开启时置 disabled）
    const incoming = sanitizeInteractionRecord(
      {
        ...interaction,
        sessionId: session.id,
        page: {
          ...interaction.page,
          frameId: authoritativeFrameId,
        },
        coordinates: {
          ...interaction.coordinates,
          viewport: effectiveViewport,
        },
        screenshot: session.options.captureScreenshots
          ? interaction.screenshot
          : { status: "disabled" },
      },
      session.options.privacyMode
    );
    const event: InteractionEvent =
      incoming.status === "confirmed"
        ? { type: "confirmed", interaction: incoming }
        : { type: "candidate", interaction: incoming };
    const { previous, next, budgetRejected } = await this.persist(
      session.id,
      incoming.id,
      event
    );
    if (budgetRejected) {
      await this.writeSessionEvent(session.id, {
        type: "capture-issue",
        issue: issue(
          "SESSION_STORAGE_LIMIT_REACHED",
          t("interactionStorageLimitReached"),
          "storage"
        ),
      });
      return;
    }
    if (!next) return;
    const interactionDelta = {
      interactionCount: previous ? 0 : 1,
      confirmedInteractionCount:
        next.status === "confirmed" && previous?.status !== "confirmed" ? 1 : 0,
    };
    // 仅在计数有净变化时推送 quality-delta（新增交互 / 首次确认），供质量统计
    if (
      interactionDelta.interactionCount ||
      interactionDelta.confirmedInteractionCount
    ) {
      await this.writeSessionEvent(session.id, {
        type: "quality-delta",
        delta: interactionDelta,
      });
    }
    if (session.options.captureScreenshots && !previous && !this.aborted) {
      await this.captureScreenshot(session, next, sender);
    }
  }

  private lastCaptureTime = 0;
  private captureQueue = Promise.resolve();

  /**
   * 优先通过 CDP Page.captureScreenshot 获取视口高保真原始帧（无 2次/秒 配额限制，耗时仅 30-50ms）
   * 优雅降级兼容 chrome.tabs.captureVisibleTab
   */
  private async executeCaptureScreenshot(
    session: RecordingSession
  ): Promise<string> {
    const task = this.captureQueue.then(async () => {
      if (this.aborted) throw new Error("CAPTURE_ABORTED");

      const elapsed = Date.now() - this.lastCaptureTime;
      // 轻量防抖 40ms（支持高达 25fps 密集点击截屏）
      if (elapsed < 40) {
        await new Promise((resolve) => setTimeout(resolve, 40 - elapsed));
      }
      if (this.aborted) throw new Error("CAPTURE_ABORTED");

      this.lastCaptureTime = Date.now();
      const tabId = session.target.tabId;

      // 1. 优先尝试 CDP Page.captureScreenshot
      if (typeof chrome !== "undefined" && chrome.debugger && tabId) {
        try {
          const res = (await chrome.debugger.sendCommand(
            { tabId },
            "Page.captureScreenshot",
            {
              format: "jpeg",
              quality: 92,
              fromSurface: true,
              captureBeyondViewport: false,
            }
          )) as { data?: string };
          if (res?.data) {
            return `data:image/jpeg;base64,${res.data}`;
          }
        } catch {
          // CDP 断开或不支持时降级走 captureVisibleTab
        }
      }

      // 2. 降级走 chrome.tabs.captureVisibleTab
      const capture = chrome.tabs.captureVisibleTab as unknown as (
        wId: number,
        options: { format: "jpeg"; quality: number }
      ) => Promise<string>;
      return capture(
        session.target.windowId ?? chrome.windows?.WINDOW_ID_CURRENT ?? -2,
        { format: "jpeg", quality: 92 }
      );
    });

    this.captureQueue = task.then(
      () => undefined,
      () => undefined
    );
    return task;
  }

  private async captureScreenshot(
    session: RecordingSession,
    interaction: InteractionRecord,
    sender: chrome.runtime.MessageSender
  ): Promise<void> {
    if (this.aborted) return;
    const endStepTimer = DevProfiler.time(`交互截图生成 #${interaction.id}`);
    try {
      await this.assertTargetTabIsActive(session);
      const capStartTime = performance.now();
      const rawDataUrl = await this.executeCaptureScreenshot(session);
      if (this.aborted) return;
      const capDuration = performance.now() - capStartTime;
      await this.assertTargetTabIsActive(session);
      const markStartTime = performance.now();
      if (this.aborted) return;

      let finalDataUrl = rawDataUrl;
      let source: "primary" | "fallback" = "primary";

      const vp =
        interaction.coordinates?.viewport?.width > 0 &&
        interaction.coordinates?.viewport?.height > 0
          ? interaction.coordinates.viewport
          : this.resolveTopViewport(
              session,
              interaction,
              interaction.page.frameId
            );

      try {
        const annotateTask = chrome.runtime.sendMessage(
          message(
            "offscreen/annotate-image",
            {
              dataUrl: rawDataUrl,
              clientX: interaction.coordinates.clientX,
              clientY: interaction.coordinates.clientY,
              viewportWidth: vp.width,
              viewportHeight: vp.height,
            },
            session.id,
            "offscreen"
          )
        );
        const timeoutTask = new Promise<{ ok: false; error: string }>(
          (resolve) =>
            setTimeout(
              () => resolve({ ok: false, error: "ANNOTATION_TIMEOUT" }),
              3000
            )
        );
        const annotated = (await Promise.race([annotateTask, timeoutTask])) as
          | { ok: true; dataUrl: string }
          | { ok: false; error?: string }
          | undefined;

        if (annotated?.ok && typeof annotated.dataUrl === "string") {
          finalDataUrl = annotated.dataUrl;
        } else {
          source = "fallback";
        }
      } catch {
        source = "fallback";
      }

      if (this.aborted) return;
      const markDuration = performance.now() - markStartTime;
      const assetId = `asset-interaction-${interaction.id}`;
      const bytes = dataUrlToArrayBuffer(finalDataUrl);
      endStepTimer({
        视口截屏: `${capDuration.toFixed(1)} ms`,
        Offscreen标注与压缩: `${markDuration.toFixed(1)} ms`,
        单图大小: `${(bytes.byteLength / 1024).toFixed(1)} KB`,
        来源: source,
      });
      const assetResult = await this.repository.saveEvidenceAssetWithinBudget({
        id: assetId,
        sessionId: session.id,
        interactionId: interaction.id,
        kind: "interaction-screenshot",
        mimeType: "image/jpeg",
        bytes,
        width: vp.width,
        height: vp.height,
        createdAtEpochMs: Date.now(),
      });
      if (!assetResult.stored) {
        await this.writeSessionEvent(session.id, {
          type: "capture-issue",
          issue: issue(
            "SESSION_STORAGE_LIMIT_REACHED",
            t("screenshotStorageLimitReached"),
            "storage"
          ),
        });
        return;
      }
      const result = await this.persist(session.id, interaction.id, {
        type: "screenshot-captured",
        source,
        assetId,
      });
      if (result.budgetRejected) {
        await this.writeSessionEvent(session.id, {
          type: "capture-issue",
          issue: issue(
            "SESSION_STORAGE_LIMIT_REACHED",
            t("screenshotStorageLimitReached"),
            "storage"
          ),
        });
      } else if (
        result.previous?.status !== "cancelled" &&
        result.previous?.screenshot.status !== "captured"
      ) {
        await this.writeSessionEvent(session.id, {
          type: "quality-delta",
          delta:
            source === "primary"
              ? { primaryScreenshotCount: 1 }
              : { fallbackScreenshotCount: 1 },
        });
      }
    } catch (error) {
      const raw = String(error);
      const safeError = sanitizeText(raw, session.options.privacyMode);
      // iframe 截图暂不支持：将开发者错误映射为面向用户的纯文案，避免展示内部前缀
      const isFrameGeometry = raw.includes("FRAME_GEOMETRY_UNAVAILABLE");
      const userMessage = isFrameGeometry
        ? t("iframeCaptureUnsupported")
        : safeError;
      const issueCode = isFrameGeometry
        ? "IFRAME_CAPTURE_UNSUPPORTED"
        : safeError.includes("MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND")
          ? "SCREENSHOT_QUOTA_EXCEEDED"
          : safeError.includes("TARGET_TAB_NOT_ACTIVE")
            ? "VISIBLE_TAB_NOT_ACTIVE"
            : "SCREENSHOT_CAPTURE_FAILED";
      const result = await this.persist(session.id, interaction.id, {
        type: "screenshot-unavailable",
        issue: userMessage,
      });
      if (
        !result.budgetRejected &&
        result.previous?.status !== "cancelled" &&
        result.previous?.screenshot.status !== "unavailable"
      ) {
        await this.writeSessionEvent(session.id, {
          type: "quality-delta",
          delta: { unavailableScreenshotCount: 1 },
        });
        await this.writeSessionEvent(session.id, {
          type: "capture-issue",
          issue: issue(issueCode, userMessage, "screenshot"),
        });
      }
    }
  }

  private async cancelInteraction(
    interactionId: string,
    interaction: InteractionRecord | undefined,
    nonce: string | undefined,
    sender: chrome.runtime.MessageSender
  ): Promise<void> {
    const session = await this.repository.getActiveSession();
    if (!this.isAccepted(session, sender, nonce)) return;
    const cancelled = interaction
      ? sanitizeInteractionRecord(
          { ...interaction, sessionId: session.id, status: "cancelled" },
          session.options.privacyMode
        )
      : undefined;
    const { previous, next } = await this.persist(session.id, interactionId, {
      type: "cancelled",
      interaction: cancelled,
    });
    if (
      !previous ||
      next?.status !== "cancelled" ||
      previous.status === "cancelled"
    )
      return;
    const delta: Extract<RecordingSessionEvent, { type: "quality-delta" }> = {
      type: "quality-delta",
      delta: { interactionCount: -1 },
    };
    if (previous.screenshot.status === "captured") {
      if (previous.screenshot.source === "primary")
        delta.delta.primaryScreenshotCount = -1;
      else delta.delta.fallbackScreenshotCount = -1;
    } else if (previous.screenshot.status === "unavailable") {
      delta.delta.unavailableScreenshotCount = -1;
    }
    await this.writeSessionEvent(session.id, delta);
  }

  /** 断言录制目标 tab 当前处于激活态（captureVisibleTab 只能截取活动 tab）。 */
  private async assertTargetTabIsActive(
    session: RecordingSession
  ): Promise<void> {
    const query: chrome.tabs.QueryInfo = { active: true };
    if (typeof session.target.windowId === "number")
      query.windowId = session.target.windowId;
    const activeTabs = await chrome.tabs.query(query);
    if (!activeTabs.some((tab) => tab.id === session.target.tabId)) {
      throw new Error(
        `TARGET_TAB_NOT_ACTIVE: ${t("targetTabNotActiveForScreenshot")}`
      );
    }
  }
}
