import { db } from "../../storage/db";
import {
  ACTIVE_STATUSES,
  isEnvelope,
  message,
  RECORDING_STATUSES,
  type CaptureIssue,
  type FrameworkProbeEntry,
  type NetworkEntry,
  type RecordingSession,
  type RuntimeMessage,
} from "../../shared/protocol";
import {
  applySessionEvent as reduceSession,
  type RecordingSessionEvent,
} from "../../domain/recording-session";
import { sanitizeText, sanitizeUrl } from "../../domain/privacy-policy";
import { normalizeRecordingOptions } from "../../domain/storage-policy";
import { waitForDownloadCompletion } from "../../domain/download-path-resolver";
import {
  buildSilentExportFailureEvent,
  injectAbsolutePathToPrompt,
  resolveSilentExportResult,
  type SilentExportPackResult,
} from "../../domain/silent-export";
import { CdpEvidenceCollector } from "../../evidence/cdp-evidence-collector";
import { ContentScriptManager } from "../../recording/content-script-manager";
import { InteractionCapture } from "../../recording/interaction-capture";
import { IssueSceneCapture } from "../../recording/issue-scene-capture";
import { NavigationCapture } from "../../recording/navigation-capture";
import { RecordingCoordinator } from "../../recording/recording-coordinator";
import { StreamHealthMonitor } from "../../recording/stream-health-monitor";

import { setStorageBudgetListener } from "../../storage/storage-budget";
import { validateStorageHealthUpdate } from "../../storage/storage-health-coordinator";
import { ensureOffscreenDocument } from "../../shared/offscreen";
import { runMainWorldFrameworkProbe } from "../../screenshot/main-world-probe";
import { createBackgroundRuntime, type BackgroundDeps } from "./runtime";

const EXTENSION_VERSION = chrome.runtime.getManifest().version;
const STOPPING_IDS_KEY = "bug-lens-stopping-ids";
/** 录制健康状态机：汇总 content/cdp/media/storage 各采集流的健康度，驱动录制挂件状态与降级提示。 */
const streamHealthMonitor = new StreamHealthMonitor();
/** 独立截图 overlay 是否打开（content script 上报）。用于与视频录制互斥。 */
let isScreenshotOverlayOpen = false;

setStorageBudgetListener((sessionId, result) => {
  if (streamHealthMonitor.getSessionId() !== sessionId) return;
  if (!result.stored) {
    streamHealthMonitor.updateStream("storage", "failed");
  } else if (result.limitReached) {
    streamHealthMonitor.updateStream("storage", "disrupted");
  } else {
    streamHealthMonitor.updateStream("storage", "ok");
  }
});
/** 生命周期协调器：保证 start/stop 串行执行，并将停止中的会话 ID 持久化到 session storage 供 SW 重启后恢复。 */
const recordingCoordinator = new RecordingCoordinator({
  save(ids) {
    chrome.storage.session
      .set({ [STOPPING_IDS_KEY]: ids })
      .catch((error) =>
        console.warn(`[Bug Lens] stopping 状态持久化失败：${String(error)}`)
      );
  },
  async load() {
    const result = await chrome.storage.session.get(STOPPING_IDS_KEY);
    const ids = result[STOPPING_IDS_KEY];
    return Array.isArray(ids)
      ? ids.filter((id): id is string => typeof id === "string")
      : [];
  },
});
/** content script 管理器：录制挂件与交互采集脚本的动态注入、导航后恢复与移除。 */
const contentScripts = new ContentScriptManager();
// 浏览器纪元：每次浏览器启动都会因 session storage 清空而生成新值，据此识别跨重启的会话中断。
const BROWSER_EPOCH_KEY = "bug-lens-browser-epoch";
const browserEpochPromise = loadOrCreateBrowserEpoch();

/** 读取或创建本浏览器启动周期的唯一标识（session storage 重启即清空）。 */
async function loadOrCreateBrowserEpoch(): Promise<string> {
  const stored = await chrome.storage.session.get(BROWSER_EPOCH_KEY);
  const existing = stored[BROWSER_EPOCH_KEY];
  if (typeof existing === "string" && existing) return existing;
  const created = crypto.randomUUID();
  await chrome.storage.session.set({ [BROWSER_EPOCH_KEY]: created });
  return created;
}

/** 会话事件入口：写库后返回最新会话，状态迁移逻辑集中在 recording-session 域 reducer。 */
async function applySessionEvent(
  sessionId: string,
  event: RecordingSessionEvent
): Promise<RecordingSession> {
  const next = await db.updateSession(sessionId, (current) =>
    reduceSession(current, event)
  );
  if (!next) throw new Error(`未找到会话 (SESSION_NOT_FOUND:${sessionId})`);
  return next;
}

const cdpCollector = new CdpEvidenceCollector(
  db,
  applySessionEvent,
  (sessionId) => recordingCoordinator.isStopping(sessionId)
);
const interactionCapture = new InteractionCapture(
  db,
  applySessionEvent,
  (sessionId) => recordingCoordinator.isStopping(sessionId)
);
const navigationCapture = new NavigationCapture(db, interactionCapture);
const issueSceneCapture = new IssueSceneCapture((sessionId) =>
  recordingCoordinator.isStopping(sessionId)
);

const deps: BackgroundDeps = {
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
};

const runtime = createBackgroundRuntime(deps);

// CDP 事件统一转发给 cdpCollector（网络/控制台证据采集）
chrome.debugger.onEvent.addListener((source, method, params) => {
  runtime.handleDebuggerEvent(source, method, params);
});

// 调试器意外断开（导航/关闭等）：非停止流程中标记 cdp 异常并尝试重连恢复
chrome.debugger.onDetach.addListener((source, reason) => {
  void runtime.handleDebuggerDetach(source, reason);
});

// 录制目标标签页被关闭：以系统指令停止对应会话
chrome.tabs.onRemoved.addListener((tabId) => {
  void runtime.handleTabRemoved(tabId);
});

// 标签页导航完成（complete）后重注入采集脚本，恢复录制挂件与 CDP 连接
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  void runtime.handleTabUpdated(tabId, changeInfo);
});

chrome.runtime.onStartup.addListener(() => {
  void runtime.bootstrapPromise;
});

/** 首次安装引导页：GitHub Pages 托管的产品介绍与上手引导（引导已从扩展内迁移至网页）。 */
const ONBOARDING_PAGE_URL = "https://aoyia.github.io/bug-lens/";

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason !== "install") return;
  void (async () => {
    // 自动化测试（Playwright E2E）通过 skipOnboardingGuide 标记跳过，避免打断测试
    const stored = (await chrome.storage.local
      .get("skipOnboardingGuide")
      .catch(() => ({}))) as { skipOnboardingGuide?: boolean };
    if (stored?.skipOnboardingGuide) return;
    await chrome.tabs
      .create({ url: ONBOARDING_PAGE_URL })
      .catch(() => undefined);
  })();
});
// 免维存储：定期清理过期会话（6 小时一次，比 24 小时更及时回收空间）
chrome.alarms.create("bug-lens-storage-cleanup", { periodInMinutes: 6 * 60 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "bug-lens-storage-cleanup")
    void db.cleanupExpiredSessions();
});

// 全局快捷键分发：start-recording → 录屏，take-screenshot → 独立截图
chrome.commands.onCommand.addListener((command) => {
  if (command === "start-recording") {
    void runtime.startRecordingViaShortcut();
  } else if (command === "take-screenshot") {
    void runtime.startScreenshotViaShortcut();
  }
});

// 消息路由中枢：承载 content script / popup / offscreen 的所有消息分发。
chrome.runtime.onMessage.addListener((raw: unknown, sender) => {
  return runtime.handleMessage(raw, sender);
});
