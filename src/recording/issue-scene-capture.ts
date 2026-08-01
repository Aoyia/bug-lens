import { defaultAnnotation, markIssueSceneResult, normalizeAnnotation, withIssueNarrative } from "../domain/issue-scene.ts";
import { sanitizeIssueScene, sanitizeText } from "../domain/privacy-policy.ts";
import { db } from "../storage/db.ts";
import { message, type CaptureIssue, type IssueScene, type RuntimeMessage } from "../shared/protocol.ts";

type CapturePayload = Extract<RuntimeMessage, { type: "issue-scene/capture" }>['payload'];
type CommitPayload = Extract<RuntimeMessage, { type: "issue-scene/commit" }>['payload'];
type Sender = chrome.runtime.MessageSender;

function issue(code: string, messageText: string, recoverable = true): CaptureIssue {
  return { code, message: messageText, source: "issue-scene", recoverable, occurredAt: Date.now() };
}

function dataUrlBytes(dataUrl: string): { bytes: ArrayBuffer; mimeType: "image/png" } {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("ISSUE_SCREENSHOT_INVALID: 截图数据格式无效");
  const encoded = dataUrl.slice(comma + 1);
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return { bytes: bytes.buffer, mimeType: "image/png" };
}

export class IssueSceneCapture {
  private readonly pending = new Set<Promise<unknown>>();

  private readonly isStopping: (sessionId: string) => boolean;

  constructor(isStopping: (sessionId: string) => boolean) {
    this.isStopping = isStopping;
  }

  capture(payload: CapturePayload, sender: Sender): Promise<{ scene: IssueScene; dataUrl?: string }> {
    return this.track(this.captureImpl(payload, sender));
  }

  commit(payload: CommitPayload, sender: Sender): Promise<IssueScene> {
    return this.track(this.commitImpl(payload, sender));
  }

  cancel(issueSceneId: string, nonce: string, sender: Sender): Promise<void> {
    return this.track(this.cancelImpl(issueSceneId, nonce, sender));
  }

  async drain(): Promise<string[]> {
    const errors: string[] = [];
    for (let round = 0; round < 3 && this.pending.size; round += 1) {
      const results = await Promise.allSettled([...this.pending]);
      for (const result of results) if (result.status === "rejected") errors.push(`问题现场写入未完成：${String(result.reason)}`);
    }
    return errors;
  }

  async finalizeUnfinished(sessionId: string): Promise<void> {
    const scenes = await db.getIssueScenes(sessionId);
    await Promise.all(scenes.filter((scene) => scene.status === "capturing" || scene.status === "draft" || scene.status === "committed").map((scene) => db.updateIssueScene(scene.id, (current) => markIssueSceneResult(current, "partial", issue("ISSUE_SCENE_INCOMPLETE", "录制结束时问题现场尚未完成，已保留已有信息。")))));
  }

  private track<T>(task: Promise<T>): Promise<T> {
    this.pending.add(task);
    void task.then(() => this.pending.delete(task), () => this.pending.delete(task));
    return task;
  }

  private async getAcceptedSession(nonce: string, sender: Sender) {
    const session = await db.getActiveSession();
    if (!session || this.isStopping(session.id) || !["PREPARING", "RECORDING", "DEGRADED"].includes(session.status) || session.target.tabId !== sender.tab?.id || session.nonce !== nonce) {
      throw new Error("ISSUE_SESSION_REJECTED: 当前问题现场请求不属于活动录制会话");
    }
    if ((sender.frameId ?? 0) !== 0) throw new Error("FRAME_GEOMETRY_UNAVAILABLE: 第一版问题现场只支持主 Frame");
    return session;
  }

  private async assertTargetTabIsActive(session: { target: { tabId: number; windowId?: number } }): Promise<void> {
    const query: chrome.tabs.QueryInfo = { active: true };
    if (typeof session.target.windowId === "number") query.windowId = session.target.windowId;
    const tabs = await chrome.tabs.query(query);
    if (!tabs.some((tab) => tab.id === session.target.tabId)) throw new Error("TARGET_TAB_NOT_ACTIVE: 当前激活标签页不是录制目标");
  }

  private async captureImpl(payload: CapturePayload, sender: Sender): Promise<{ scene: IssueScene; dataUrl?: string }> {
    const session = await this.getAcceptedSession(payload.nonce, sender);
    const sceneId = crypto.randomUUID();
    const annotation = normalizeAnnotation(payload.annotation ?? defaultAnnotation({ clientX: 0, clientY: 0 }, payload.page.viewport));
    const base: IssueScene = {
      id: sceneId,
      sessionId: session.id,
      status: "capturing",
      observedAtEpochMs: payload.observedAtEpochMs,
      selectionStartedAtEpochMs: payload.selectionStartedAtEpochMs,
      page: payload.page,
      target: payload.target,
      targets: payload.targets,
      annotation,
      screenshot: { status: "pending" },
      issues: []
    };
    const sanitized = sanitizeIssueScene(base, session.options.privacyMode);
    const metadataWrite = await db.saveIssueSceneWithinBudget(sanitized);
    if (!metadataWrite.stored) throw new Error("SESSION_STORAGE_LIMIT_REACHED: 无法保存问题现场元数据");

    try {
      await this.assertTargetTabIsActive(session);
      const capture = chrome.tabs.captureVisibleTab as unknown as (windowId: number, options: { format: "png" }) => Promise<string>;
      const dataUrl = await capture(session.target.windowId ?? chrome.windows.WINDOW_ID_CURRENT, { format: "png" });
      await this.assertTargetTabIsActive(session);
      const { bytes } = dataUrlBytes(dataUrl);
      const assetId = crypto.randomUUID();
      const assetWrite = await db.saveEvidenceAssetWithinBudget({
        id: assetId,
        sessionId: session.id,
        issueSceneId: sceneId,
        kind: "issue-original",
        mimeType: "image/png",
        bytes,
        width: Math.round(payload.page.viewport.width * Math.max(1, payload.page.devicePixelRatio)),
        height: Math.round(payload.page.viewport.height * Math.max(1, payload.page.devicePixelRatio)),
        createdAtEpochMs: Date.now()
      });
      const next = await db.updateIssueScene(sceneId, (current) => assetWrite.stored
        ? { ...current, status: "draft", screenshot: { status: "captured", originalAssetId: assetId } }
        : markIssueSceneResult({ ...current, screenshot: { status: "partial", issue: "SESSION_STORAGE_LIMIT_REACHED: 原始截图未保存" } }, "partial", issue("SESSION_STORAGE_LIMIT_REACHED", "已达到单会话存储上限，原始问题截图未保存。")));
      if (!next) throw new Error("ISSUE_SCENE_NOT_FOUND: 截图完成后找不到问题现场");
      return { scene: next, dataUrl };
    } catch (error) {
      const next = await db.updateIssueScene(sceneId, (current) => markIssueSceneResult({ ...current, screenshot: { status: "unavailable", issue: sanitizeText(String(error), session.options.privacyMode) } }, "partial", issue("ISSUE_SCREENSHOT_UNAVAILABLE", sanitizeText(String(error), session.options.privacyMode))));
      if (!next) throw error;
      return { scene: next };
    }
  }

  private async commitImpl(payload: CommitPayload, sender: Sender): Promise<IssueScene> {
    const session = await this.getAcceptedSession(payload.nonce, sender);
    const current = await db.getIssueScene(payload.issueSceneId);
    if (!current || current.sessionId !== session.id) throw new Error("ISSUE_SCENE_NOT_FOUND: 找不到问题现场");
    const committed = sanitizeIssueScene(withIssueNarrative(current, payload.narrative, payload.annotation), session.options.privacyMode);
    const saved = await db.saveIssueSceneWithinBudget(committed);
    if (!saved.stored) throw new Error("SESSION_STORAGE_LIMIT_REACHED: 无法保存问题描述");
    if (!committed.screenshot.originalAssetId) return db.updateIssueScene(committed.id, (scene) => markIssueSceneResult(scene, "partial", issue("ISSUE_SCREENSHOT_UNAVAILABLE", "没有原始截图，已保存 DOM 和问题描述。"))) as Promise<IssueScene>;
    try {
      await ensureOffscreenDocument();
      const result = await chrome.runtime.sendMessage(message("offscreen/render-issue-image", {
        sessionId: session.id,
        issueSceneId: committed.id,
        originalAssetId: committed.screenshot.originalAssetId,
        annotatedAssetId: crypto.randomUUID(),
        annotation: committed.annotation,
        devicePixelRatio: committed.page.devicePixelRatio
      }, session.id));
      const next = await db.updateIssueScene(committed.id, (scene) => result?.ok
        ? { ...scene, status: "complete", screenshot: { ...scene.screenshot, annotatedAssetId: result.annotatedAssetId } }
        : markIssueSceneResult(scene, "partial", issue("ISSUE_ANNOTATION_FAILED", String(result?.error ?? "批注图片生成失败"))));
      if (!next) throw new Error("ISSUE_SCENE_NOT_FOUND: 批注完成后找不到问题现场");
      return next;
    } catch (error) {
      const next = await db.updateIssueScene(committed.id, (scene) => markIssueSceneResult(scene, "partial", issue("ISSUE_ANNOTATION_FAILED", sanitizeText(String(error), session.options.privacyMode))));
      if (!next) throw error;
      return next;
    }
  }

  private async cancelImpl(issueSceneId: string, nonce: string, sender: Sender): Promise<void> {
    const session = await this.getAcceptedSession(nonce, sender);
    const scene = await db.getIssueScene(issueSceneId);
    if (!scene || scene.sessionId !== session.id) return;
    await db.deleteIssueScene(scene.id);
  }
}

async function ensureOffscreenDocument(): Promise<void> {
  const contexts = await (chrome.runtime.getContexts as unknown as (filter: unknown) => Promise<chrome.runtime.ExtensionContext[]> )({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (!contexts.length) await chrome.offscreen.createDocument({ url: "offscreen.html", reasons: ["BLOBS"], justification: "Render and persist issue scene screenshots locally." });
}
