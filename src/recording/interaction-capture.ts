import { DevProfiler } from "../shared/dev-profiler.ts";
import {
  applyInteractionEvent,
  type InteractionEvent,
} from "../domain/interaction-ledger.ts";
import {
  sanitizeInteractionRecord,
  sanitizeText,
} from "../domain/privacy-policy.ts";
import {
  flushStorageBatchQueue,
  type EvidenceRepository,
} from "../storage/db.ts";
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
> & {
  saveInteraction?: (record: InteractionRecord) => Promise<void>;
  getInteractions?: (sessionId: string) => Promise<InteractionRecord[]>;
};

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

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  messageText: string,
  signal?: AbortSignal
): Promise<T> {
  if (signal?.aborted) {
    return Promise.reject(new Error("CAPTURE_ABORTED"));
  }
  return new Promise<T>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => {
      if (timer) clearTimeout(timer);
      reject(new Error("CAPTURE_ABORTED"));
    };
    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }
    timer = setTimeout(() => {
      if (signal) signal.removeEventListener("abort", onAbort);
      reject(new Error(messageText));
    }, timeoutMs);

    promise.then(
      (value) => {
        if (timer) clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        if (timer) clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

export class InteractionCapture {
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly pending = new Set<Promise<void>>();
  private readonly repository: InteractionRepository;
  private readonly writeSessionEvent: SessionEventWriter;
  private readonly isStopping: (sessionId: string) => boolean;
  private readonly channelTimeoutMs: number;
  private aborted = false;
  private abortedSessionId?: string;
  private abortController = new AbortController();
  private readonly sessionInteractions = new Map<string, Set<string>>();
  private cdpBreakerOpen = false;

  constructor(
    repository: InteractionRepository,
    writeSessionEvent: SessionEventWriter,
    isStopping: (sessionId: string) => boolean,
    channelTimeoutMs = 1000
  ) {
    this.repository = repository;
    this.writeSessionEvent = writeSessionEvent;
    this.isStopping = isStopping;
    this.channelTimeoutMs = channelTimeoutMs;
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

  reset(): void {
    this.aborted = false;
    this.abortedSessionId = undefined;
    this.abortController = new AbortController();
    this.captureQueue = Promise.resolve();
    this.cdpBreakerOpen = false;
    this.latestTopViewport = undefined;
    this.lastCaptureTime = 0;
    this.lastCapturedFrame = null;
    this.pending.clear();
    this.sessionInteractions.clear();
  }

  /** 停止时调用：立即熔断取消在途未截取的队列，并在超时保护下等待当前执行完成 */
  abortPending(sessionId?: string): void {
    this.aborted = true;
    if (sessionId) {
      this.abortedSessionId = sessionId;
    }
    this.abortController.abort();
  }

  /** 收敛会话中仍处于 pending 状态的交互截图为 unavailable 终态 */
  async finalizePending(sessionId: string): Promise<void> {
    await flushStorageBatchQueue().catch(() => {});
    let records: InteractionRecord[] = [];
    if (this.repository.getInteractions) {
      records = await this.repository.getInteractions(sessionId);
    }
    const ids = this.sessionInteractions.get(sessionId);
    if (ids) {
      const existingIds = new Set(records.map((r) => r.id));
      const missingIds = Array.from(ids).filter((id) => !existingIds.has(id));
      if (missingIds.length > 0) {
        const fetched = await Promise.all(
          missingIds.map((id) => this.repository.getInteraction(id))
        );
        for (const f of fetched) {
          if (f) records.push(f);
        }
      }
    }

    const pending = records.filter((i) => i.screenshot?.status === "pending");
    if (!pending.length) return;

    await Promise.all(
      pending.map(async (item) => {
        await this.enqueue(`${sessionId}:${item.id}`, async () => {
          const current = await this.repository.getInteraction(item.id);
          if (current && current.screenshot?.status === "pending") {
            const next: InteractionRecord = {
              ...current,
              screenshot: {
                status: "unavailable",
                issue: t("screenshotUnavailable"),
              },
            };
            const res = await this.repository.saveInteractionWithinBudget(next);
            if (!res.stored && this.repository.saveInteraction) {
              await this.repository.saveInteraction(next);
            }
          }
        });
      })
    );
    await flushStorageBatchQueue().catch(() => {});
  }

  async drain(timeoutMs = 1200, sessionId?: string): Promise<string[]> {
    const errors: string[] = [];
    await flushStorageBatchQueue().catch(() => {});
    if (this.pending.size) {
      // 1. 给予优雅排空窗口：短超时（单测 <=500ms）设为 150ms 保证挂起时快速熔断；正常停止（>=1000ms）给予充裕窗口排空真实在途交互
      const gracePeriodMs =
        timeoutMs <= 500 ? 150 : Math.max(0, timeoutMs - 250);
      let graceTimer: any;
      const gracePromise = new Promise<void>((resolve) => {
        graceTimer = setTimeout(resolve, gracePeriodMs);
      });
      const inFlightPromise = Promise.allSettled(Array.from(this.pending));

      await Promise.race([inFlightPromise, gracePromise]);
      if (graceTimer) clearTimeout(graceTimer);

      // 2. 优雅期结束后，若仍有排队未完成的任务（例如卡死/挂起），立即触发 abort 熔断中断在途阻塞
      this.abortPending(sessionId);

      // 3. 在剩余的超时窗口内等待熔断清理完成
      const remainingTimeoutMs = Math.max(0, timeoutMs - gracePeriodMs);
      let hardTimer: any;
      const hardTimeoutPromise = new Promise<void>((resolve) => {
        hardTimer = setTimeout(resolve, remainingTimeoutMs);
      });
      const drainPromise = inFlightPromise.then((results) => {
        for (const res of results) {
          if (
            res.status === "rejected" &&
            res.reason?.message !== "CAPTURE_ABORTED"
          ) {
            errors.push(
              t("cleanupInteractionWriteFailed", [String(res.reason)])
            );
          }
        }
      });

      await Promise.race([drainPromise, hardTimeoutPromise]);
      if (hardTimer) clearTimeout(hardTimer);
      this.pending.clear();
    } else {
      this.abortPending(sessionId);
    }

    try {
      const targetSessionIds = new Set<string>();
      if (sessionId) targetSessionIds.add(sessionId);
      if (this.abortedSessionId) targetSessionIds.add(this.abortedSessionId);
      const activeSession = await this.repository
        .getActiveSession()
        .catch(() => undefined);
      if (activeSession?.id) targetSessionIds.add(activeSession.id);
      for (const sid of this.sessionInteractions.keys()) {
        targetSessionIds.add(sid);
      }

      for (const sid of targetSessionIds) {
        await this.finalizePending(sid);
        this.sessionInteractions.delete(sid);
      }
    } catch (err) {
      errors.push(String(err));
    }
    await flushStorageBatchQueue().catch(() => {});

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
        if (!stored.stored) {
          if (
            event.type === "screenshot-unavailable" &&
            this.repository.saveInteraction
          ) {
            await this.repository.saveInteraction(next);
            return { previous, next };
          }
          return { previous, next: previous, budgetRejected: true };
        }
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
    const isTargetTab =
      session &&
      (session.target.tabId === sender.tab?.id ||
        Boolean(session.targets?.some((t) => t.tabId === sender.tab?.id)));
    return Boolean(
      session &&
      !this.isStopping(session.id) &&
      RECORDING_STATUSES.includes(session.status) &&
      isTargetTab &&
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

    if (this.aborted && !this.isStopping(session.id)) {
      this.reset();
    }

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
    let interactionSet = this.sessionInteractions.get(session.id);
    if (!interactionSet) {
      interactionSet = new Set<string>();
      this.sessionInteractions.set(session.id, interactionSet);
    }
    interactionSet.add(incoming.id);

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
    if (
      session.options.captureScreenshots &&
      !previous &&
      !this.aborted
    ) {
      await this.captureScreenshot(session, next, sender);
    } else if (
      session.options.captureScreenshots &&
      !previous &&
      this.aborted
    ) {
      await this.persist(session.id, next.id, {
        type: "screenshot-unavailable",
        issue: t("screenshotUnavailable"),
      });
    }
  }

  private lastCaptureTime = 0;
  private captureQueue = Promise.resolve();
  private lastCapturedFrame: {
    tabId: number;
    dataUrl: string;
    capturedAt: number;
  } | null = null;

  /**
   * 优先通过 CDP Page.captureScreenshot 获取视口高保真原始帧（无 2次/秒 配额限制，耗时仅 30-50ms）
   * 优雅降级兼容 chrome.tabs.captureVisibleTab 并具备高频点击底图复用保护
   */
  private async executeCaptureScreenshot(
    session: RecordingSession,
    targetTabId?: number,
    targetWindowId?: number
  ): Promise<string> {
    const task = this.captureQueue.then(async () => {
      if (this.aborted) {
        throw new Error("CAPTURE_ABORTED");
      }

      const elapsed = Date.now() - this.lastCaptureTime;
      // 轻量防抖 40ms（支持高达 25fps 密集点击截屏）
      if (elapsed < 40) {
        await new Promise((resolve) => setTimeout(resolve, 40 - elapsed));
      }
      if (this.aborted) {
        throw new Error("CAPTURE_ABORTED");
      }

      this.lastCaptureTime = Date.now();
      // 使用发生交互的真实 Tab ID（副 Tab 操作时指向副 Tab，而非主 Tab）
      const tabId = targetTabId ?? session.target.tabId;

      // 1. 优先尝试 CDP Page.captureScreenshot（若熔断器未开启）
      if (
        !this.cdpBreakerOpen &&
        typeof chrome !== "undefined" &&
        chrome.debugger &&
        tabId
      ) {
        try {
          const cdpTask = Promise.resolve().then(
            () =>
              chrome.debugger.sendCommand({ tabId }, "Page.captureScreenshot", {
                format: "jpeg",
                quality: 92,
                fromSurface: true,
                captureBeyondViewport: false,
              }) as Promise<{ data?: string }>
          );
          const res = await withTimeout(
            cdpTask,
            this.channelTimeoutMs,
            "CDP_CAPTURE_TIMEOUT",
            this.abortController.signal
          );
          if (res?.data) {
            const dataUrl = `data:image/jpeg;base64,${res.data}`;
            this.lastCapturedFrame = {
              tabId,
              dataUrl,
              capturedAt: Date.now(),
            };
            return dataUrl;
          }
        } catch (err: any) {
          if (this.aborted || err?.message === "CAPTURE_ABORTED") {
            throw err;
          }
          if (err?.message === "CDP_CAPTURE_TIMEOUT") {
            this.cdpBreakerOpen = true;
          }
          // CDP 未附着、超时或断开时降级走 captureVisibleTab
        }
      }

      if (this.aborted) {
        throw new Error("CAPTURE_ABORTED");
      }

      // 2. 降级走 chrome.tabs.captureVisibleTab（截取当前活跃窗口的活动 Tab 画面）
      if (
        typeof chrome !== "undefined" &&
        chrome.tabs &&
        typeof chrome.tabs.captureVisibleTab === "function"
      ) {
        const winId =
          targetWindowId && targetWindowId > 0
            ? targetWindowId
            : undefined;
        const tabTask = new Promise<string>((resolve, reject) => {
          let resolved = false;
          const done = (err: any, dataUrl?: string) => {
            if (resolved) return;
            resolved = true;
            if (err) reject(err);
            else if (dataUrl) resolve(dataUrl);
            else reject(new Error("CAPTURE_VISIBLE_TAB_EMPTY"));
          };

          const cb = (dataUrl?: string) => {
            const lastErr =
              typeof chrome !== "undefined"
                ? chrome.runtime?.lastError
                : undefined;
            if (lastErr) {
              done(new Error(lastErr.message || String(lastErr)));
            } else {
              done(undefined, dataUrl);
            }
          };

          try {
            const callRes =
              typeof winId === "number"
                ? (chrome.tabs.captureVisibleTab as any)(
                    winId,
                    { format: "jpeg", quality: 92 },
                    cb
                  )
                : (chrome.tabs.captureVisibleTab as any)(
                    { format: "jpeg", quality: 92 },
                    cb
                  );

            if (callRes && typeof callRes.then === "function") {
              callRes.then(
                (res: string) => done(undefined, res),
                (err: any) => done(err)
              );
            }
          } catch (syncErr) {
            done(syncErr);
          }
        });
        try {
          const res = await withTimeout(
            tabTask,
            this.channelTimeoutMs,
            "CAPTURE_VISIBLE_TAB_TIMEOUT",
            this.abortController.signal
          );
          if (res) {
            this.lastCapturedFrame = {
              tabId,
              dataUrl: res,
              capturedAt: Date.now(),
            };
            return res;
          }
        } catch (err: any) {
          // 核心优化：高频/密集点击配额突破保护
          // Chrome 原生 API 限制 MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND（每秒最多 2 次）；
          // 当触发该配额或短时间内调用失败时，优雅复用最近 3000ms 内同一 Tab 的高保真底图并完成后续红圈绘制
          const errMsg = String(err?.message ?? err);
          const isQuota =
            errMsg.includes("MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND") ||
            errMsg.includes("QUOTA_EXCEEDED") ||
            errMsg.includes("quota") ||
            errMsg.includes("rate limit") ||
            errMsg.includes("invocation rate");
          const hasRecentFrame =
            this.lastCapturedFrame &&
            this.lastCapturedFrame.tabId === tabId &&
            Date.now() - this.lastCapturedFrame.capturedAt < 3000;
          if (hasRecentFrame && (isQuota || errMsg.includes("TIMEOUT"))) {
            return this.lastCapturedFrame!.dataUrl;
          }
          throw err;
        }
      }

      // 3. 兜底保护：若所有通道均未成，只要有近期同 Tab 的底图帧，直接作为兜底底图输出
      if (
        this.lastCapturedFrame &&
        this.lastCapturedFrame.tabId === tabId &&
        Date.now() - this.lastCapturedFrame.capturedAt < 3000
      ) {
        return this.lastCapturedFrame.dataUrl;
      }

      throw new Error("NO_SCREENSHOT_CHANNEL_AVAILABLE");
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
    if (this.aborted) {
      await this.persist(session.id, interaction.id, {
        type: "screenshot-unavailable",
        issue: t("screenshotUnavailable"),
      });
      return;
    }
    const endStepTimer = DevProfiler.time(`交互截图生成 #${interaction.id}`);
    try {
      await this.assertTargetTabIsActive(session, sender.tab?.id);
      const capStartTime = performance.now();
      const realTabId = sender.tab?.id ?? session.target.tabId;
      const realWindowId = sender.tab?.windowId ?? session.target.windowId;
      const rawDataUrl = await this.executeCaptureScreenshot(
        session,
        realTabId,
        realWindowId
      );
      if (this.aborted) {
        throw new Error("CAPTURE_ABORTED");
      }
      const capDuration = performance.now() - capStartTime;
      const markStartTime = performance.now();
      if (this.aborted) {
        throw new Error("CAPTURE_ABORTED");
      }

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
        const annotateTask = Promise.resolve().then(() =>
          chrome.runtime.sendMessage(
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
          )
        ) as Promise<{ ok?: boolean; dataUrl?: string; error?: string }>;
        const annotated = await withTimeout(
          annotateTask,
          1500,
          "ANNOTATION_TIMEOUT",
          this.abortController.signal
        );

        if (annotated?.ok && typeof annotated.dataUrl === "string") {
          finalDataUrl = annotated.dataUrl;
        } else {
          source = "fallback";
        }
      } catch (annotateErr: any) {
        if (this.aborted || annotateErr?.message === "CAPTURE_ABORTED") {
          throw annotateErr;
        }
        source = "fallback";
      }

      if (this.aborted) {
        throw new Error("CAPTURE_ABORTED");
      }
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
        await this.persist(session.id, interaction.id, {
          type: "screenshot-unavailable",
          issue: t("screenshotStorageLimitReached"),
        });
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
      const isAborted = raw.includes("CAPTURE_ABORTED");
      const isTimeout =
        raw.includes("CDP_CAPTURE_TIMEOUT") ||
        raw.includes("CAPTURE_VISIBLE_TAB_TIMEOUT");
      const userMessage = isFrameGeometry
        ? t("iframeCaptureUnsupported")
        : isAborted
          ? t("screenshotUnavailable")
          : safeError;
      const issueCode = isFrameGeometry
        ? "IFRAME_CAPTURE_UNSUPPORTED"
        : isAborted
          ? "SCREENSHOT_ABORTED"
          : isTimeout
            ? "SCREENSHOT_TIMEOUT"
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
        // 用户主动停止会话导致的截图熔断，不应记为质量问题
        if (!this.isStopping(session.id)) {
          await this.writeSessionEvent(session.id, {
            type: "capture-issue",
            issue: issue(issueCode, userMessage, "screenshot"),
          });
        }
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

    let interactionSet = this.sessionInteractions.get(session.id);
    if (!interactionSet) {
      interactionSet = new Set<string>();
      this.sessionInteractions.set(session.id, interactionSet);
    }
    interactionSet.add(interactionId);

    const { previous, next } = await this.enqueue(
      `${session.id}:${interactionId}`,
      async () => {
        const previous = await this.repository.getInteraction(interactionId);
        let next = applyInteractionEvent(previous, {
          type: "cancelled",
          interaction: cancelled,
        });
        if (next && next.screenshot?.status === "pending") {
          next = {
            ...next,
            screenshot: {
              status: "unavailable",
              issue: t("screenshotUnavailable"),
            },
          };
        }
        if (next && next !== previous) {
          const stored =
            await this.repository.saveInteractionWithinBudget(next);
          if (!stored.stored) {
            if (this.repository.saveInteraction) {
              await this.repository.saveInteraction(next);
              return { previous, next };
            }
            return { previous, next: previous, budgetRejected: true };
          }
        }
        return { previous, next };
      }
    );
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
    session: RecordingSession,
    targetTabId?: number
  ): Promise<void> {
    const activeTabs = await chrome.tabs.query({ active: true });
    const checkTabId = targetTabId ?? session.target.tabId;
    const isTargetActive = activeTabs.some(
      (tab) =>
        tab.id === checkTabId ||
        tab.id === session.target.tabId ||
        Boolean(session.targets?.some((t) => t.tabId === tab.id))
    );
    if (!isTargetActive) {
      throw new Error(
        `TARGET_TAB_NOT_ACTIVE: ${t("targetTabNotActiveForScreenshot")}`
      );
    }
  }
}
