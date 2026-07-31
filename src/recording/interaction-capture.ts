import { applyInteractionEvent, type InteractionEvent } from "../domain/interaction-ledger.ts";
import { sanitizeInteractionRecord, sanitizeText } from "../domain/privacy-policy.ts";
import type { EvidenceRepository } from "../storage/db.ts";
import { message, type CaptureIssue, type InteractionRecord, type RecordingSession } from "../shared/protocol.ts";
import type { RecordingSessionEvent } from "../domain/recording-session.ts";

type InteractionRepository = Pick<
  EvidenceRepository,
  "getActiveSession" | "getInteraction" | "saveInteractionWithinBudget" | "saveEvidenceAssetWithinBudget"
>;

type SessionEventWriter = (sessionId: string, event: RecordingSessionEvent) => Promise<RecordingSession>;

function issue(code: string, messageText: string, source: CaptureIssue["source"]): CaptureIssue {
  return { code, message: messageText, source, recoverable: true, occurredAt: Date.now() };
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

  handle(interaction: InteractionRecord, sender: chrome.runtime.MessageSender): Promise<void> {
    return this.track(this.handleInteraction(interaction, sender));
  }

  cancel(interactionId: string, interaction: InteractionRecord | undefined, nonce: string | undefined, sender: chrome.runtime.MessageSender): Promise<void> {
    return this.track(this.cancelInteraction(interactionId, interaction, nonce, sender));
  }

  async drain(): Promise<string[]> {
    const errors: string[] = [];
    for (let round = 0; round < 3; round += 1) {
      const results = await Promise.allSettled([...this.pending]);
      for (const result of results) {
        if (result.status === "rejected") errors.push(`交互写入未完成：${String(result.reason)}`);
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
      () => { if (this.queues.get(key) === current) this.queues.delete(key); },
      () => { if (this.queues.get(key) === current) this.queues.delete(key); }
    );
    return current;
  }

  private persist(
    sessionId: string,
    interactionId: string,
    event: InteractionEvent
  ): Promise<{ previous?: InteractionRecord; next?: InteractionRecord; budgetRejected?: boolean }> {
    return this.enqueue(`${sessionId}:${interactionId}`, async () => {
      const previous = await this.repository.getInteraction(interactionId);
      const next = applyInteractionEvent(previous, event);
      if (next && next !== previous) {
        const stored = await this.repository.saveInteractionWithinBudget(next);
        if (!stored.stored) return { previous, next: previous, budgetRejected: true };
      }
      return { previous, next };
    });
  }

  private isAccepted(session: RecordingSession | undefined, sender: chrome.runtime.MessageSender, nonce: string | undefined): session is RecordingSession {
    return Boolean(
      session
      && !this.isStopping(session.id)
      && ["PREPARING", "RECORDING", "DEGRADED"].includes(session.status)
      && session.target.tabId === sender.tab?.id
      && session.nonce === nonce
    );
  }

  private async handleInteraction(interaction: InteractionRecord, sender: chrome.runtime.MessageSender): Promise<void> {
    const session = await this.repository.getActiveSession();
    if (!this.isAccepted(session, sender, interaction.sessionId)) return;
    const incoming = sanitizeInteractionRecord({
      ...interaction,
      sessionId: session.id,
      screenshot: session.options.captureScreenshots ? interaction.screenshot : { status: "disabled" }
    }, session.options.privacyMode);
    const event: InteractionEvent = incoming.status === "confirmed"
      ? { type: "confirmed", interaction: incoming }
      : { type: "candidate", interaction: incoming };
    const { previous, next, budgetRejected } = await this.persist(session.id, incoming.id, event);
    if (budgetRejected) {
      await this.writeSessionEvent(session.id, { type: "capture-issue", issue: issue("SESSION_STORAGE_LIMIT_REACHED", "已达到会话存储上限，未保存更多交互证据。", "storage") });
      return;
    }
    if (!next) return;
    const interactionDelta = {
      interactionCount: previous ? 0 : 1,
      confirmedInteractionCount: next.status === "confirmed" && previous?.status !== "confirmed" ? 1 : 0
    };
    if (interactionDelta.interactionCount || interactionDelta.confirmedInteractionCount) {
      await this.writeSessionEvent(session.id, { type: "quality-delta", delta: interactionDelta });
    }
    if (session.options.captureScreenshots && !previous) {
      await this.captureScreenshot(session, next, sender);
    }
  }

  private async captureScreenshot(session: RecordingSession, interaction: InteractionRecord, sender: chrome.runtime.MessageSender): Promise<void> {
    try {
      if ((sender.frameId ?? 0) !== 0) throw new Error("FRAME_GEOMETRY_UNAVAILABLE: iframe 坐标暂无法可靠映射到顶层视口");
      await this.assertTargetTabIsActive(session);
      const capture = chrome.tabs.captureVisibleTab as unknown as (windowId: number, options: { format: "png" }) => Promise<string>;
      const dataUrl = await capture(session.target.windowId ?? chrome.windows.WINDOW_ID_CURRENT, { format: "png" });
      await this.assertTargetTabIsActive(session);
      const annotated = await chrome.runtime.sendMessage(message("offscreen/annotate-image", {
        dataUrl,
        clientX: interaction.coordinates.clientX,
        clientY: interaction.coordinates.clientY,
        viewportWidth: interaction.coordinates.viewport.width,
        viewportHeight: interaction.coordinates.viewport.height
      }, session.id));
      if (!annotated?.ok || typeof annotated.dataUrl !== "string") throw new Error(annotated?.error || "截图标记失败");
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
        createdAtEpochMs: Date.now()
      });
      if (!assetResult.stored) {
        await this.writeSessionEvent(session.id, { type: "capture-issue", issue: issue("SESSION_STORAGE_LIMIT_REACHED", "已达到会话存储上限，未保存更多点击截图。", "storage") });
        return;
      }
      const result = await this.persist(session.id, interaction.id, { type: "screenshot-captured", source: "primary", assetId });
      if (result.budgetRejected) {
        await this.writeSessionEvent(session.id, { type: "capture-issue", issue: issue("SESSION_STORAGE_LIMIT_REACHED", "已达到会话存储上限，未保存更多点击截图。", "storage") });
      } else if (result.previous?.status !== "cancelled" && result.previous?.screenshot.status !== "captured") {
        await this.writeSessionEvent(session.id, { type: "quality-delta", delta: { primaryScreenshotCount: 1 } });
      }
    } catch (error) {
      const safeError = sanitizeText(String(error), session.options.privacyMode);
      const result = await this.persist(session.id, interaction.id, { type: "screenshot-unavailable", issue: safeError });
      if (!result.budgetRejected && result.previous?.status !== "cancelled" && result.previous?.screenshot.status !== "unavailable") {
        await this.writeSessionEvent(session.id, { type: "quality-delta", delta: { unavailableScreenshotCount: 1 } });
        await this.writeSessionEvent(session.id, { type: "capture-issue", issue: issue("VISIBLE_TAB_NOT_ACTIVE", safeError, "screenshot") });
      }
    }
  }

  private async cancelInteraction(interactionId: string, interaction: InteractionRecord | undefined, nonce: string | undefined, sender: chrome.runtime.MessageSender): Promise<void> {
    const session = await this.repository.getActiveSession();
    if (!this.isAccepted(session, sender, nonce)) return;
    const cancelled = interaction
      ? sanitizeInteractionRecord({ ...interaction, sessionId: session.id, status: "cancelled" }, session.options.privacyMode)
      : undefined;
    const { previous, next } = await this.persist(session.id, interactionId, { type: "cancelled", interaction: cancelled });
    if (!previous || next?.status !== "cancelled" || previous.status === "cancelled") return;
    const delta: Extract<RecordingSessionEvent, { type: "quality-delta" }> = {
      type: "quality-delta",
      delta: { interactionCount: -1 }
    };
    if (previous.screenshot.status === "captured") {
      if (previous.screenshot.source === "primary") delta.delta.primaryScreenshotCount = -1;
      else delta.delta.fallbackScreenshotCount = -1;
    } else if (previous.screenshot.status === "unavailable") {
      delta.delta.unavailableScreenshotCount = -1;
    }
    await this.writeSessionEvent(session.id, delta);
  }

  private async assertTargetTabIsActive(session: RecordingSession): Promise<void> {
    const query: chrome.tabs.QueryInfo = { active: true };
    if (typeof session.target.windowId === "number") query.windowId = session.target.windowId;
    const activeTabs = await chrome.tabs.query(query);
    if (!activeTabs.some((tab) => tab.id === session.target.tabId)) {
      throw new Error("TARGET_TAB_NOT_ACTIVE: 当前激活标签页不是录制目标，已拒绝保存截图");
    }
  }
}
