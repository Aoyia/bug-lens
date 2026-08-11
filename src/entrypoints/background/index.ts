import { db } from "../../storage/db";
import { setStorageBudgetListener } from "../../storage/storage-budget";
import { StreamHealthMonitor } from "../../recording/stream-health-monitor";
import { RecordingCoordinator } from "../../recording/recording-coordinator";
import { ContentScriptManager } from "../../recording/content-script-manager";
import { CdpEvidenceCollector } from "../../evidence/cdp-evidence-collector";
import { InteractionCapture } from "../../recording/interaction-capture";
import { NavigationCapture } from "../../recording/navigation-capture";
import { IssueSceneCapture } from "../../recording/issue-scene-capture";
import { createBackgroundRuntime, type BackgroundDeps } from "./runtime";
import { registerBackgroundEvents } from "./events";
import { applySessionEvent } from "./context";

const EXTENSION_VERSION = chrome.runtime.getManifest().version;
const STOPPING_IDS_KEY = "bug-lens-stopping-ids";
/** 录制健康状态机：汇总 content/cdp/media/storage 各采集流的健康度，驱动录制挂件状态与降级提示。 */
const streamHealthMonitor = new StreamHealthMonitor();

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

const cdpCollector = new CdpEvidenceCollector(
  db,
  (sessionId, event) => applySessionEvent(db, sessionId, event),
  (sessionId) => recordingCoordinator.isStopping(sessionId)
);
const interactionCapture = new InteractionCapture(
  db,
  (sessionId, event) => applySessionEvent(db, sessionId, event),
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

// chrome 事件注册（debugger / tabs / startup / installed / alarms / commands / onMessage）
registerBackgroundEvents(runtime);
