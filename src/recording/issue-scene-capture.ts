import {
  buildIssueSequenceContext,
  defaultAnnotation,
  ISSUE_SEQUENCE_WINDOW_MS,
  markIssueSceneResult,
  normalizeAnnotation,
  normalizeExpected,
  withIssueNarrative,
} from "../domain/issue-scene.ts";
import { sanitizeIssueScene, sanitizeText } from "../domain/privacy-policy.ts";
import { getAdmissionRejection } from "../domain/session-admission.ts";
import { db } from "../storage/db.ts";
import { ensureOffscreenDocument } from "../shared/offscreen.ts";
import { t } from "../shared/i18n.ts";
import {
  message,
  type CaptureIssue,
  type ConsoleEntry,
  type IssueScene,
  type IssueSequenceContext,
  type RecordingSession,
  type RuntimeMessage,
} from "../shared/protocol.ts";

type CapturePayload = Extract<
  RuntimeMessage,
  { type: "issue-scene/capture" }
>["payload"];
type CommitPayload = Extract<
  RuntimeMessage,
  { type: "issue-scene/commit" }
>["payload"];
type Sender = chrome.runtime.MessageSender;

function issue(
  code: string,
  messageText: string,
  recoverable = true
): CaptureIssue {
  return {
    code,
    message: messageText,
    source: "issue-scene",
    recoverable,
    occurredAt: Date.now(),
  };
}

function dataUrlBytes(dataUrl: string): {
  bytes: ArrayBuffer;
  mimeType: "image/png";
} {
  const comma = dataUrl.indexOf(",");
  if (comma < 0)
    throw new Error(`ISSUE_SCREENSHOT_INVALID: ${t("issueScreenshotInvalid")}`);
  const encoded = dataUrl.slice(comma + 1);
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return { bytes: bytes.buffer, mimeType: "image/png" };
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

function isPngSignature(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  );
}

function isJpegSofMarker(marker: number): boolean {
  return (
    marker >= 0xc0 &&
    marker <= 0xcf &&
    marker !== 0xc4 &&
    marker !== 0xc8 &&
    marker !== 0xcc
  );
}

/**
 * 零依赖纯字节头解析图片物理像素尺寸（支持 PNG IHDR 与 JPEG SOF0/SOF2 等帧段）。
 * 无法识别或格式损坏时返回 null，由调用方按视口与 DPR 回退估算。
 */
export function readImageDimensions(
  bytes: Uint8Array,
  mimeType?: string
): { width: number; height: number } | null {
  if (!bytes || bytes.length === 0) return null;

  const allowPng = !mimeType || mimeType.toLowerCase().includes("png");
  const allowJpeg =
    !mimeType ||
    mimeType.toLowerCase().includes("jpeg") ||
    mimeType.toLowerCase().includes("jpg");

  // 1. PNG：检查 8 字节魔数及首块 IHDR（偏移 16..23 为 width/height uint32 BE）
  if (
    allowPng &&
    isPngSignature(bytes) &&
    bytes[12] === 0x49 &&
    bytes[13] === 0x48 &&
    bytes[14] === 0x44 &&
    bytes[15] === 0x52
  ) {
    const width = readUint32BE(bytes, 16);
    const height = readUint32BE(bytes, 20);
    if (width > 0 && height > 0) return { width, height };
    return null;
  }

  // 2. JPEG：以 SOI (0xFF 0xD8) 开头，顺序扫描标记段直到命中 SOFn
  if (
    allowJpeg &&
    bytes.length >= 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8
  ) {
    let offset = 2;
    while (offset < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
      if (offset >= bytes.length) break;

      const marker = bytes[offset];
      offset += 1;

      // 无长度字段的独立标记或 SOS（之后为熵编码流）
      if (marker === 0x00 || marker === 0xd9 || marker === 0xda) break;
      if (
        marker === 0x01 ||
        marker === 0xd8 ||
        (marker >= 0xd0 && marker <= 0xd7)
      ) {
        continue;
      }

      if (offset + 2 > bytes.length) break;
      const segmentLength = readUint16BE(bytes, offset);
      if (segmentLength < 2) break;

      if (isJpegSofMarker(marker)) {
        if (segmentLength < 7 || offset + 7 > bytes.length) return null;
        const height = readUint16BE(bytes, offset + 3);
        const width = readUint16BE(bytes, offset + 5);
        if (width > 0 && height > 0) return { width, height };
        return null;
      }

      offset += segmentLength;
    }
  }

  return null;
}

export class IssueSceneCapture {
  private readonly pending = new Set<Promise<unknown>>();

  private readonly isStopping: (sessionId: string) => boolean;

  constructor(isStopping: (sessionId: string) => boolean) {
    this.isStopping = isStopping;
  }

  /** 采集问题现场：时序切片冻结 → 归一化批注 → 原始截图 → draft；失败降级 partial。 */
  capture(
    payload: CapturePayload,
    sender: Sender
  ): Promise<{ scene: IssueScene; dataUrl?: string }> {
    return this.track(this.captureImpl(payload, sender));
  }

  /** 提交问题描述：合并 narrative/批注后保存，经 offscreen 渲染批注图置 complete；失败降级 partial。 */
  commit(payload: CommitPayload, sender: Sender): Promise<IssueScene> {
    return this.track(this.commitImpl(payload, sender));
  }

  /** 取消问题现场：仅允许删除当前会话的 scene，找不到时静默返回。 */
  cancel(issueSceneId: string, nonce: string, sender: Sender): Promise<void> {
    return this.track(this.cancelImpl(issueSceneId, nonce, sender));
  }

  async drain(): Promise<string[]> {
    const errors: string[] = [];
    for (let round = 0; round < 3 && this.pending.size; round += 1) {
      const results = await Promise.allSettled([...this.pending]);
      for (const result of results)
        if (result.status === "rejected")
          errors.push(t("cleanupIssueSceneWriteFailed", String(result.reason)));
    }
    return errors;
  }

  /** 录制停止时兜底：把仍在 capturing/draft/committed 的场景统一标记为 partial。 */
  async finalizeUnfinished(sessionId: string): Promise<void> {
    const scenes = await db.getIssueScenes(sessionId);
    await Promise.all(
      scenes
        .filter(
          (scene) =>
            scene.status === "capturing" ||
            scene.status === "draft" ||
            scene.status === "committed"
        )
        .map((scene) =>
          db.updateIssueScene(scene.id, (current) =>
            markIssueSceneResult(
              current,
              "partial",
              issue(
                "ISSUE_SCENE_INCOMPLETE",
                "录制结束时问题现场尚未完成，已保留已有信息。"
              )
            )
          )
        )
    );
  }

  private track<T>(task: Promise<T>): Promise<T> {
    this.pending.add(task);
    void task.then(
      () => this.pending.delete(task),
      () => this.pending.delete(task)
    );
    return task;
  }

  /**
   * 会话准入校验：会话存在、非停止中、状态在录制状态集内、消息来自录制目标
   * tab 且 nonce 匹配；任一不满足抛 ISSUE_SESSION_REJECTED 拒绝该请求。
   */
  private async getAcceptedSession(nonce: string, sender: Sender) {
    const session = await db.getActiveSession();
    const rejection = getAdmissionRejection({
      session,
      tabId: sender.tab?.id,
      nonce,
      isStopping: this.isStopping,
    });
    if (rejection || !session) {
      throw new Error(
        `ISSUE_SESSION_REJECTED: ${t("issueSessionRejected")}${
          rejection ? ` (${rejection})` : ""
        }`
      );
    }
    if ((sender.frameId ?? 0) !== 0)
      throw new Error(
        `FRAME_GEOMETRY_UNAVAILABLE: ${t("issueFrameGeometryUnavailable")}`
      );
    return session;
  }

  private async assertTargetTabIsActive(
    session: {
      target: { tabId: number; windowId?: number };
      targets?: Array<{ tabId: number }>;
    },
    targetTabId?: number,
    windowId?: number
  ): Promise<void> {
    const query: chrome.tabs.QueryInfo = { active: true };
    if (typeof windowId === "number") {
      query.windowId = windowId;
    } else if (typeof session.target.windowId === "number") {
      query.windowId = session.target.windowId;
    }
    const tabs = await chrome.tabs.query(query);
    const expectedTabId = targetTabId ?? session.target.tabId;
    const isTargetActive = tabs.some(
      (tab) =>
        tab.id === expectedTabId ||
        tab.id === session.target.tabId ||
        Boolean(session.targets?.some((t) => t.tabId === tab.id))
    );
    if (!isTargetActive)
      throw new Error(`TARGET_TAB_NOT_ACTIVE: ${t("issueTargetTabNotActive")}`);
  }

  /**
   * 以"标记当下"为锚点，冻结窗口内已入库的交互与 Console 报错为时序切片。
   * 数据在入库时已按 privacyMode 脱敏，此处仅做紧凑投影（P1 Sequence 维度）。
   */
  private async buildSequenceContext(
    session: RecordingSession,
    anchorEpochMs: number
  ): Promise<IssueSequenceContext | undefined> {
    const [interactions, consoleEntries] = await Promise.all([
      db.getInteractions(session.id),
      session.options.captureConsole
        ? db.getConsole(session.id)
        : Promise.resolve([] as ConsoleEntry[]),
    ]);
    return buildIssueSequenceContext({
      anchorEpochMs,
      windowMs: ISSUE_SEQUENCE_WINDOW_MS,
      interactions,
      consoleEntries,
    });
  }

  private async captureImpl(
    payload: CapturePayload,
    sender: Sender
  ): Promise<{ scene: IssueScene; dataUrl?: string }> {
    const session = await this.getAcceptedSession(payload.nonce, sender);
    const sceneId = crypto.randomUUID();
    // 未带批注时以默认锚点（0,0）归一化，保证 annotation 结构始终合法
    const annotation = normalizeAnnotation(
      payload.annotation ??
        defaultAnnotation({ clientX: 0, clientY: 0 }, payload.page.viewport)
    );
    const base: IssueScene = {
      id: sceneId,
      sessionId: session.id,
      status: "capturing",
      observedAtEpochMs: payload.observedAtEpochMs,
      selectionStartedAtEpochMs: payload.selectionStartedAtEpochMs,
      sequenceContext: await this.buildSequenceContext(
        session,
        payload.selectionStartedAtEpochMs ?? payload.observedAtEpochMs
      ),
      page: payload.page,
      target: payload.target,
      targets: payload.targets,
      annotation,
      narrative: payload.expectedAtMarkTime
        ? {
            actual: "",
            expected: normalizeExpected(payload.expectedAtMarkTime),
          }
        : undefined,
      screenshot: { status: "pending" },
      issues: [],
    };
    const sanitized = sanitizeIssueScene(base, session.options.privacyMode);
    const metadataWrite = await db.saveIssueSceneWithinBudget(sanitized);
    if (!metadataWrite.stored)
      throw new Error(
        `SESSION_STORAGE_LIMIT_REACHED: ${t("issueMetadataNotSaved")}`
      );

    const realWindowId = sender.tab?.windowId ?? session.target.windowId;
    const realTabId = sender.tab?.id ?? session.target.tabId;

    try {
      await this.assertTargetTabIsActive(session, realTabId, realWindowId);
      const capture = chrome.tabs.captureVisibleTab as unknown as (
        windowId: number,
        options: { format: "jpeg"; quality: number }
      ) => Promise<string>;
      const dataUrl = await capture(
        realWindowId ?? chrome.windows.WINDOW_ID_CURRENT,
        { format: "jpeg", quality: 92 }
      );
      await this.assertTargetTabIsActive(session, realTabId, realWindowId);
      const { bytes } = dataUrlBytes(dataUrl);
      const parsedDimensions = readImageDimensions(new Uint8Array(bytes));
      const fallbackScale = Math.max(1, payload.page.devicePixelRatio);
      const assetId = crypto.randomUUID();
      const assetWrite = await db.saveEvidenceAssetWithinBudget({
        id: assetId,
        sessionId: session.id,
        issueSceneId: sceneId,
        kind: "issue-original",
        mimeType: "image/jpeg",
        bytes,
        width:
          parsedDimensions?.width ??
          Math.round(payload.page.viewport.width * fallbackScale),
        height:
          parsedDimensions?.height ??
          Math.round(payload.page.viewport.height * fallbackScale),
        createdAtEpochMs: Date.now(),
      });
      const next = await db.updateIssueScene(sceneId, (current) =>
        assetWrite.stored
          ? {
              ...current,
              status: "draft",
              screenshot: { status: "captured", originalAssetId: assetId },
            }
          : markIssueSceneResult(
              {
                ...current,
                screenshot: {
                  status: "partial",
                  issue: `SESSION_STORAGE_LIMIT_REACHED: ${t(
                    "issueOriginalScreenshotNotSaved"
                  )}`,
                },
              },
              "partial",
              issue(
                "SESSION_STORAGE_LIMIT_REACHED",
                t("issueSceneStorageLimitReached")
              )
            )
      );
      if (!next)
        throw new Error(
          `ISSUE_SCENE_NOT_FOUND: ${t("issueSceneNotFoundAfterCapture")}`
        );
      return { scene: next, dataUrl };
    } catch (error) {
      const next = await db.updateIssueScene(sceneId, (current) =>
        markIssueSceneResult(
          {
            ...current,
            screenshot: {
              status: "unavailable",
              issue: sanitizeText(String(error), session.options.privacyMode),
            },
          },
          "partial",
          issue(
            "ISSUE_SCREENSHOT_UNAVAILABLE",
            sanitizeText(String(error), session.options.privacyMode)
          )
        )
      );
      if (!next) throw error;
      return { scene: next };
    }
  }

  private async commitImpl(
    payload: CommitPayload,
    sender: Sender
  ): Promise<IssueScene> {
    const session = await this.getAcceptedSession(payload.nonce, sender);
    const current = await db.getIssueScene(payload.issueSceneId);
    if (!current || current.sessionId !== session.id)
      throw new Error(`ISSUE_SCENE_NOT_FOUND: ${t("issueSceneNotFound")}`);
    const committed = sanitizeIssueScene(
      withIssueNarrative(current, payload.narrative, payload.annotation),
      session.options.privacyMode
    );
    const saved = await db.saveIssueSceneWithinBudget(committed);
    if (!saved.stored)
      throw new Error(
        `SESSION_STORAGE_LIMIT_REACHED: ${t("issueNarrativeNotSaved")}`
      );
    if (!committed.screenshot.originalAssetId)
      return db.updateIssueScene(committed.id, (scene) =>
        markIssueSceneResult(
          scene,
          "partial",
          issue(
            "ISSUE_SCREENSHOT_UNAVAILABLE",
            t("issueSceneSavedWithoutScreenshot")
          )
        )
      ) as Promise<IssueScene>;
    try {
      await ensureOffscreenDocument();
      const result = await chrome.runtime.sendMessage(
        message(
          "offscreen/render-issue-image",
          {
            sessionId: session.id,
            issueSceneId: committed.id,
            originalAssetId: committed.screenshot.originalAssetId,
            annotatedAssetId: crypto.randomUUID(),
            annotation: committed.annotation,
            devicePixelRatio: committed.page.devicePixelRatio,
          },
          session.id,
          "offscreen"
        )
      );
      const next = await db.updateIssueScene(committed.id, (scene) =>
        result?.ok
          ? {
              ...scene,
              status: "complete",
              screenshot: {
                ...scene.screenshot,
                annotatedAssetId: result.annotatedAssetId,
              },
            }
          : markIssueSceneResult(
              scene,
              "partial",
              issue(
                "ISSUE_ANNOTATION_FAILED",
                String(result?.error ?? t("annotationImageGenerationFailed"))
              )
            )
      );
      if (!next)
        throw new Error(
          `ISSUE_SCENE_NOT_FOUND: ${t("issueSceneNotFoundAfterAnnotation")}`
        );
      return next;
    } catch (error) {
      const next = await db.updateIssueScene(committed.id, (scene) =>
        markIssueSceneResult(
          scene,
          "partial",
          issue(
            "ISSUE_ANNOTATION_FAILED",
            sanitizeText(String(error), session.options.privacyMode)
          )
        )
      );
      if (!next) throw error;
      return next;
    }
  }

  private async cancelImpl(
    issueSceneId: string,
    nonce: string,
    sender: Sender
  ): Promise<void> {
    const session = await this.getAcceptedSession(nonce, sender);
    const scene = await db.getIssueScene(issueSceneId);
    if (!scene || scene.sessionId !== session.id) return;
    await db.deleteIssueScene(scene.id);
  }
}
