import {
  ACTIVE_STATUSES,
  RECORDING_STATUSES,
  message,
  type RecordingSession,
} from "../../shared/protocol";
import { applySessionEvent as reduceSession } from "../../domain/recording-session";
import { t } from "../../shared/i18n";
import type { BackgroundContext } from "./context";
import type { SessionLifecycle } from "./lifecycle";

/** SW 启动/导航恢复服务：浏览器重启中断恢复、活动会话恢复、导航后重连。 */
export interface BootstrapService {
  run(): Promise<void>;
  /** SW 冷启动时执行一次完整恢复（handleMessage 等入口等待其完成）。 */
  promise: Promise<void>;
  restoreAfterNavigation(tabId: number): Promise<void>;
  /** 中断恢复：重算质量 → 落 recover 问题 → 清理残留采集资源 → 打开 preview。 */
  recover(
    session: RecordingSession,
    code: string,
    messageText: string
  ): Promise<void>;
}

export function createBootstrapService(
  ctx: BackgroundContext,
  lifecycle: SessionLifecycle
): BootstrapService {
  const {
    db,
    browserEpochPromise,
    streamHealthMonitor,
    recordingCoordinator,
    contentScripts,
    cdpCollector,
  } = ctx;

  /** 中断恢复：重算质量 → 落 recover 问题 → 清理残留采集资源 → 打开 preview 查看已保留证据。 */
  async function recoverInterruptedSession(
    session: RecordingSession,
    code: string,
    messageText: string
  ): Promise<void> {
    await lifecycle
      .reconcileSessionQuality(session.id)
      .catch((error) =>
        console.warn(`[Bug Lens] 恢复期质量对账失败：${String(error)}`)
      );
    const recovered = await db.updateSession(session.id, (current) => ({
      ...reduceSession(current, {
        type: "recover",
        atEpochMs: Date.now(),
        issue: ctx.issue(code, messageText, "storage"),
      }),
      previewPending: true,
    }));
    if (!recovered) return;
    await cdpCollector.detach(session.target.tabId);
    await contentScripts.remove(session.target.tabId);
    streamHealthMonitor.reset(session.target.tabId);
    await lifecycle.openPendingPreview(recovered);
  }

  /**
   * SW 启动恢复全流程：恢复 stopping 状态 → 清理过期会话 → 校验浏览器纪元：
   * 纪元不符按重启中断恢复；STOPPING 继续完成停止；PREPARING 按启动中断恢复；
   * 正常活动会话则重注入 content、探测媒体上下文、校验/重连 CDP。
   */
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
      if (session.previewPending) await lifecycle.openPendingPreview(session);
      else await db.clearActive(session.id);
      return;
    }

    if (!session.browserEpoch || session.browserEpoch !== browserEpoch) {
      await recoverInterruptedSession(
        session,
        "SESSION_INTERRUPTED_BY_BROWSER_RESTART",
        t("issueBrowserRestartInterrupted")
      );
      return;
    }

    if (session.status === "STOPPING") {
      await lifecycle.stop(session.commandIds?.stop);
      return;
    }

    if (session.status === "PREPARING") {
      await recoverInterruptedSession(
        session,
        "SESSION_START_INTERRUPTED",
        t("issueStartInterrupted")
      );
      return;
    }

    const targetExists = await chrome.tabs
      .get(session.target.tabId)
      .then(() => true)
      .catch(() => false);
    if (!targetExists) {
      await lifecycle.stop(`system:missing-tab:${session.id}`);
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
        await ctx.applySessionEvent(session.id, {
          type: "capture-issue",
          issue: ctx.issue(
            "MEDIA_CONTEXT_LOST",
            t("issueMediaContextLost"),
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
          await ctx.applySessionEvent(session.id, {
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

  /**
   * 页面导航会替换文档（及其中的 content script 实例），但不应当结束 tab capture 录制会话。
   * 导航稳定后重新注入当前文档的 content script，
   * 使录制挂件与交互采集器能与既有会话重新握手。
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

    // Chrome 在替换页面 target 时可能分离调试器。仅当目标已不再附着时才重新 attach；
    // 已附着的 target 保持原样，避免触发 "Already attached" 错误。
    if (session.options.captureConsole || session.options.captureNetwork) {
      const isOwner = await cdpCollector.verifyOwnership(tabId);
      if (isOwner) {
        streamHealthMonitor.updateStream("cdp", "ok");
      } else {
        const debuggerIssue = await cdpCollector.attach(tabId, session);
        if (debuggerIssue) {
          await ctx.applySessionEvent(session.id, {
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

  return {
    run: bootstrapRuntimeState,
    promise: bootstrapPromise,
    restoreAfterNavigation: restoreSessionAfterNavigation,
    recover: recoverInterruptedSession,
  };
}
