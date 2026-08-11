import {
  isEnvelope,
  RECORDING_STATUSES,
  type FrameworkProbeEntry,
  type RuntimeMessage,
} from "../../shared/protocol";
import { sanitizeText } from "../../domain/privacy-policy";
import { validateStorageHealthUpdate } from "../../storage/storage-health-coordinator";
import { runMainWorldFrameworkProbe } from "../../screenshot/main-world-probe";
import type { BackgroundContext } from "./context";
import type { SessionLifecycle } from "./lifecycle";
import type { ScreenshotService } from "./screenshot";

/** 消息路由服务：承载 content script / popup / offscreen 的所有消息分发。 */
export interface MessageRouter {
  handle(raw: unknown, sender: chrome.runtime.MessageSender): Promise<unknown>;
}

export function createMessageRouter(
  ctx: BackgroundContext,
  services: {
    lifecycle: SessionLifecycle;
    screenshot: ScreenshotService;
    bootstrapPromise: Promise<void>;
  }
): MessageRouter {
  const { db, streamHealthMonitor, interactionCapture, issueSceneCapture } =
    ctx;
  const { lifecycle, screenshot, bootstrapPromise } = services;

  /** 消息路由中枢：承载 content script / popup / offscreen 的所有消息分发。 */
  async function handleMessage(
    raw: unknown,
    sender: chrome.runtime.MessageSender
  ): Promise<unknown> {
    if (!isEnvelope(raw)) return undefined;
    const incoming = raw as RuntimeMessage;
    if (incoming.target && incoming.target !== "background") return undefined;

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
            await ctx.applySessionEvent(activeSession.id, {
              type: "capture-issue",
              issue: ctx.issue(
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
          if (ctx.isScreenshotOverlayOpen.get())
            throw new Error("截图进行中，不能启动视频录制（两者互斥）");
          return {
            ok: true,
            session: await lifecycle.start(incoming.payload),
          };
        // 停止当前录制（commandId 保证幂等）
        case "session/stop":
          return {
            ok: true,
            session: await lifecycle.stop(
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
            session: await lifecycle.continueInterrupted(
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
          ctx.isScreenshotOverlayOpen.set(Boolean(incoming.payload.open));
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
          await ctx.applySessionEvent(result.scene.sessionId, {
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
            void lifecycle.stop(`issue-scene:${scene.id}`);
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
              await screenshot.triggerInTab(activeTab.id, activeTab.windowId);
            }
          } else {
            const tab = await chrome.tabs.get(targetTabId).catch(() => null);
            if (tab?.id && tab.windowId !== undefined) {
              await screenshot.triggerInTab(tab.id, tab.windowId);
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
          const absolutePath = await ctx.resolveDownloadedFilePath(downloadId);
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
  }

  return { handle: handleMessage };
}
