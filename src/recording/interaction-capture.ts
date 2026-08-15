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

  /** 停止时调用：最多轮询 3 轮等待所有在途交互写入完成，返回失败明细。 */
  async drain(): Promise<string[]> {
    const errors: string[] = [];
    for (let round = 0; round < 3; round += 1) {
      const results = await Promise.allSettled([...this.pending]);
      for (const result of results) {
        if (result.status === "rejected")
          errors.push(`交互写入未完成：${String(result.reason)}`);
      }
      if (!this.pending.size) break;
    }
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

  private async handleInteraction(
    interaction: InteractionRecord,
    sender: chrome.runtime.MessageSender
  ): Promise<void> {
    const session = await this.repository.getActiveSession();
    if (!this.isAccepted(session, sender, interaction.sessionId)) return;
    // 脱敏后落库：强制绑定当前会话 id 并按隐私模式过滤，同时按会话选项
    // 关闭截图存储（captureScreenshots 未开启时置 disabled）
    const incoming = sanitizeInteractionRecord(
      {
        ...interaction,
        sessionId: session.id,
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
    if (session.options.captureScreenshots && !previous) {
      await this.captureScreenshot(session, next, sender);
    }
  }

  private lastCaptureTime = 0;
  private captureQueue = Promise.resolve();

  /**
   * 全局串行 + 相邻间隔 510ms 节流的截屏执行器：规避 chrome 对
   * captureVisibleTab 的每分钟调用次数配额限制。
   */
  private async executeCaptureVisibleTab(windowId: number): Promise<string> {
    const task = this.captureQueue.then(async () => {
      const elapsed = Date.now() - this.lastCaptureTime;
      if (elapsed < 510) {
        await new Promise((resolve) => setTimeout(resolve, 510 - elapsed));
      }
      this.lastCaptureTime = Date.now();
      const capture = chrome.tabs.captureVisibleTab as unknown as (
        wId: number,
        options: { format: "png" }
      ) => Promise<string>;
      return capture(windowId, { format: "png" });
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
    try {
      if ((sender.frameId ?? 0) !== 0)
        throw new Error(
          `FRAME_GEOMETRY_UNAVAILABLE: ${t("iframeCaptureUnsupported")}`
        );
      await this.assertTargetTabIsActive(session);
      const dataUrl = await this.executeCaptureVisibleTab(
        session.target.windowId ?? chrome.windows.WINDOW_ID_CURRENT
      );
      await this.assertTargetTabIsActive(session);
      const annotated = await chrome.runtime.sendMessage(
        message(
          "offscreen/annotate-image",
          {
            dataUrl,
            clientX: interaction.coordinates.clientX,
            clientY: interaction.coordinates.clientY,
            viewportWidth: interaction.coordinates.viewport.width,
            viewportHeight: interaction.coordinates.viewport.height,
          },
          session.id,
          "offscreen"
        )
      );
      if (!annotated?.ok || typeof annotated.dataUrl !== "string")
        throw new Error(annotated?.error || t("screenshotMarkFailed"));
      const assetId = `asset-interaction-${interaction.id}`;
      const bytes = dataUrlToArrayBuffer(annotated.dataUrl);
      const assetResult = await this.repository.saveEvidenceAssetWithinBudget({
        id: assetId,
        sessionId: session.id,
        interactionId: interaction.id,
        kind: "interaction-screenshot",
        mimeType: "image/png",
        bytes,
        width: interaction.coordinates.viewport.width,
        height: interaction.coordinates.viewport.height,
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
        source: "primary",
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
          delta: { primaryScreenshotCount: 1 },
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
