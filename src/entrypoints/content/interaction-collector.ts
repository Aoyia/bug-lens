import { isEnvelope, message } from "../../shared/protocol";
import {
  initI18nPreference,
  onLanguagePreferenceChange,
  t,
} from "../../shared/i18n";
import { copyTextToClipboard } from "../../preview/clipboard";
import {
  captureFrameworkState,
  isMeaningfulFrameworkState,
} from "../../domain/framework-state-capture";
import { captureEnvironment } from "../../domain/environment-capture";
import { getSilentExportFailure } from "../../domain/silent-export";
import type {
  ExpectedStatement,
  FrameworkStateTrigger,
} from "../../shared/protocol";
import { RecordingWidget } from "./collector/recording-widget";
import { SelectionOverlay } from "./collector/selection-overlay";
import { IssueEditor } from "./collector/issue-editor";
import { ExpectedCaptureCard } from "./collector/expected-capture-card";
import { DomObserver } from "./collector/dom-observer";
import { InactivityMonitor } from "./collector/inactivity-monitor";
import { ScreenshotOverlay } from "../../screenshot/screenshot-overlay";
import { recentErrorsTracker } from "../../screenshot/recent-errors-tracker";
import {
  ensureErrorsTrackerStarted,
  ensureScreenshotOverlayBridge,
} from "./content-bridge";

type ContentSession = {
  sessionId: string;
  nonce: string;
  startedAtEpochMs?: number;
  privacyMode: "safe" | "raw";
  captureFrameworkState?: boolean;
};
type ContentController = {
  refresh: (next: ContentSession | undefined) => void;
};

// 预先异步加载/初始化当前用户的语言偏好
void initI18nPreference();

// window 全局挂载符号：标记已安装/当前会话/控制器入口，
// 供重复注入时幂等复用——检测到已有 CONTROLLER 即跳过重新初始化
declare global {
  interface Window {
    __WEB_BUG_RECORDER_INSTALLED__?: boolean;
    __WEB_BUG_RECORDER_SESSION__?: ContentSession;
    __WEB_BUG_RECORDER_CONTROLLER__?: ContentController;
  }
}

// 启动最近错误监听（幂等）与截图 overlay 消息桥（幂等）：
// executeScript 重复注入会重新求值本脚本、重建模块单例，故委托 content-bridge
// 用 window 标志跨注入去重，避免累积监听器 / 重复包装 console.error，
// 否则多次截图后残留 window 拦截器（刷新/滚动永久失效）。
ensureErrorsTrackerStarted(() => recentErrorsTracker.startListening());

// 截图 overlay 初始为关闭：content script 重新注入（页面刷新等）时刷新 background
// 的互斥标志，避免截图 overlay 异常销毁后残留"截图中"状态卡住录制启动。
void chrome.runtime
  .sendMessage(message("content/screenshot-overlay-state", { open: false }))
  .catch(() => undefined);

// 截图 overlay 消息桥（幂等注册）：重复注入只注册一次监听器，
// overlay 实例由 content-bridge 在 window 上共享持有。
ensureScreenshotOverlayBridge({
  createOverlay: () => new ScreenshotOverlay(),
  onMessage: (fn) => chrome.runtime.onMessage.addListener(fn),
  sendMessage: (msg) => chrome.runtime.sendMessage(msg),
});

// 幂等重入：页面已存在本脚本安装的控制器（重复注入/多帧）时复用旧实例，
// 仅重新握手同步会话，避免重复挂载 UI 与监听器
const existingController = window.__WEB_BUG_RECORDER_CONTROLLER__;
if (existingController) {
  void chrome.runtime
    .sendMessage(
      message("content/hello", {
        url: location.href,
        title: document.title,
        environment: captureEnvironment(),
      })
    )
    .then((response) => {
      existingController.refresh(
        response?.active && response.sessionId && response.nonce
          ? {
              sessionId: response.sessionId,
              nonce: response.nonce,
              startedAtEpochMs: response.startedAtEpochMs,
              privacyMode: response.privacyMode === "raw" ? "raw" : "safe",
              captureFrameworkState: Boolean(response.captureFrameworkState),
            }
          : undefined
      );
    })
    .catch(() => undefined);
} else {
  window.__WEB_BUG_RECORDER_INSTALLED__ = true;
  let session: ContentSession | undefined;
  let cachedStartedAtEpochMs: number | undefined;
  /** 速记卡确认的期望，随 issue-scene/capture 透传，编辑器打开后清空。 */
  let pendingExpected: ExpectedStatement | undefined;

  const isMac =
    typeof navigator !== "undefined" &&
    Boolean(
      /(Mac|iPhone|iPod|iPad)/i.test(navigator.platform || navigator.userAgent)
    );

  // ─── Module Instances ───
  // 各子模块以回调注入互相解耦（互不持有对方引用），由本协调器编排流程

  // 录制控制条：展示录制态，提供停止/标记问题/暂停操作
  const widget: RecordingWidget = new RecordingWidget({
    async onStop() {
      widget.setSavingState(true);
      try {
        const res = await chrome.runtime.sendMessage(
          message("session/stop", {
            commandId: crypto.randomUUID(),
            // 结束即导出：直出证据包下载，不打开预览页（业务契约，勿改）
            silentExport: true,
          })
        );
        const exportFailure = getSilentExportFailure(res, t("stopFailed"));
        if (exportFailure) {
          // 停止失败：会话仍存活，恢复挂件交互以便用户重试
          widget.setSavingState(false);
          widget.showToast(t("exportFailed", exportFailure), 5_500, "error");
          return;
        }
        const prompt = res?.session?.silentPrompt;
        if (prompt) {
          try {
            await copyTextToClipboard(prompt);
          } catch {
            // 忽略
          }
        }
        widget.showToast(t("exportSuccessCopied"));
      } catch (error) {
        // 通道异常：会话大概率仍存活，恢复挂件交互以便用户重试
        widget.setSavingState(false);
        widget.showToast(t("exportFailed", String(error)), 5_500, "error");
      }
    },
    onMarkIssue(anchor) {
      beginIssueSelection(anchor);
    },
    isPaused() {
      return monitor.isIdlePaused;
    },
    getStartedAtEpochMs() {
      return session?.startedAtEpochMs || cachedStartedAtEpochMs || Date.now();
    },
    isIdlePaused(): boolean {
      return monitor.isIdlePaused;
    },
    getPausedDurationMs(): number {
      return monitor.getPausedDurationMs();
    },
    getSessionId(): string | undefined {
      return session?.sessionId;
    },
  });

  // 监听语言偏好变更并实时更新挂件文案
  onLanguagePreferenceChange(() => {
    widget.updateLanguage();
  });

  // 问题编辑器：编辑已捕获的场景快照，与选区流程分离
  const editor = new IssueEditor({
    getSession: () => session,
    onClose(restoreWidget) {
      widget.setIssueSelecting(false);
      if (restoreWidget && session) widget.mount();
    },
    onReselect() {
      beginIssueSelection();
    },
    onStopAfterCommit() {
      widget.setIssueSelecting(false);
      widget.unmount();
    },
    isMac,
  });

  // 元素选择遮罩：在页面上框选问题区域，确认后进入编辑器
  const overlay: SelectionOverlay = new SelectionOverlay({
    getSession: () => session,
    getPendingExpected: () => pendingExpected,
    onCaptureComplete(scene, dataUrl) {
      pendingExpected = undefined;
      widget.unmount();
      editor.open(scene, dataUrl);
    },
    onCancel() {
      // 取消元素选择：挂件在选择期间始终处于挂载态，mount() 为空转；
      // 必须复位「标记问题」按钮，否则会停留在禁用「选择中…」状态，
      // 鼠标无法再次发起标记流程（只能依赖 Alt+S 快捷键）。
      widget.setIssueSelecting(false);
    },
    // 采集失败反馈：复用导出失败的 error 音色 Toast 模式（非阻塞、不冻结页面），
    // 挂件此刻仍挂载，toast 与「标记问题」按钮复位同时呈现，用户可立即重试
    onError: (message) => widget.showToast(message, 5_500, "error"),
    getEditorElement: () => editor.element,
    shortcutKeyText: widget.shortcutKeyText,
  });

  // DOM 观察器：监听页面交互，触发框架状态采集与问题入口
  const observer = new DomObserver({
    getSession: () => session,
    isIssueActive: () => overlay.isActive || editor.isOpen,
    beginIssueSelection,
    removeIssueUi,
    onEvidenceTick: () => captureFrameworkTick("interaction"),
  });

  // 期望速记卡：选区前置步骤，先记录"预期应该发生什么"
  const expectedCard = new ExpectedCaptureCard({
    onSubmit(expected) {
      pendingExpected = expected;
      proceedToIssueSelection();
    },
    onSkip() {
      pendingExpected = undefined;
      proceedToIssueSelection();
    },
    onCancel() {
      // 取消整条标记流程：速记卡阶段 widget 始终挂载且未进入选择态，
      // 防御性复位「标记问题」按钮即可，不进入元素选择。
      widget.setIssueSelecting(false);
    },
  });

  // 空闲监测：页面长时间无交互时暂停录制（联动 offscreen 媒体暂停/恢复）
  const monitor: InactivityMonitor = new InactivityMonitor({
    onPause() {
      widget.updatePauseState(true);
      if (session)
        void chrome.runtime.sendMessage(
          message(
            "offscreen/pause-media",
            { sessionId: session.sessionId },
            session.sessionId,
            "offscreen"
          )
        );
    },
    onResume() {
      widget.updatePauseState(false);
      if (session)
        void chrome.runtime.sendMessage(
          message(
            "offscreen/resume-media",
            { sessionId: session.sessionId },
            session.sessionId,
            "offscreen"
          )
        );
    },
    isBlocked: (): boolean => overlay.isActive || editor.isOpen,
  });

  // ─── Coordination ───

  let lastFrameworkTickAt = 0;
  const FRAMEWORK_TICK_MIN_INTERVAL_MS = 3_000;

  // 框架状态采集节流：普通触发 3s 内只上报一次，start 触发不受限；
  // 且仅会话开启 captureFrameworkState 时才采集（性能/隐私开关）
  function captureFrameworkTick(trigger: FrameworkStateTrigger): void {
    if (!session?.sessionId) return;
    if (!session.captureFrameworkState) return;
    const now = Date.now();
    if (
      trigger !== "start" &&
      now - lastFrameworkTickAt < FRAMEWORK_TICK_MIN_INTERVAL_MS
    )
      return;
    lastFrameworkTickAt = now;
    const state = captureFrameworkState({
      sessionId: session.sessionId,
      trigger,
      privacyMode: session.privacyMode,
    });
    if (!isMeaningfulFrameworkState(state)) return;
    void chrome.runtime
      .sendMessage(
        message("framework/state", { state }, session.sessionId, "background")
      )
      .catch(() => undefined);
  }

  function beginIssueSelection(anchor?: { x: number; y: number }): void {
    if (overlay.isActive || editor.isOpen || expectedCard.isOpen) return;
    // 先弹出期望速记卡：在记忆峰值捕获"预期应该发生什么"（P2），
    // 确认/跳过后再进入元素选择，全程不阻断主流程。
    // 卡片就近锚定鼠标位置；快捷键触发时无锚点，回退顶部居中。
    expectedCard.open(anchor);
  }

  // 速记卡确认/跳过后进入元素选择，并采集当前框架状态作为问题上下文
  function proceedToIssueSelection(): void {
    if (overlay.isActive || editor.isOpen) return;
    widget.setIssueSelecting(true);
    overlay.open();
    captureFrameworkTick("issue-scene");
  }

  function removeIssueUi(): void {
    overlay.close();
    editor.close(false);
    expectedCard.close();
    widget.setIssueSelecting(false);
  }

  // 会话激活：挂载 widget、启动空闲监测、上报 start 框架态；
  // 会话销毁：卸载 UI、停止监测，并清理 pending 状态
  function refreshSession(
    next: ContentSession | undefined,
    health?: import("../../shared/protocol").RecordingHealthInfo
  ): void {
    observer.clearPending();
    if (!next) removeIssueUi();
    // 记录进入本函数前的会话状态：用于区分"真正开始新会话"与"同一会话内重挂载"
    const hadSession = Boolean(session);
    if (next) {
      if (next.startedAtEpochMs) {
        cachedStartedAtEpochMs = next.startedAtEpochMs;
      } else if (!cachedStartedAtEpochMs) {
        cachedStartedAtEpochMs = Date.now();
      }
    } else {
      cachedStartedAtEpochMs = undefined;
    }
    session = next;
    // 同步到 window 挂载符号，供调试与重复注入时读取
    window.__WEB_BUG_RECORDER_SESSION__ = next;
    if (next) {
      // 挂件会基于 sessionId 判定是否恢复已保存的拖拽位置；若换了新会话则自动使用默认位置
      widget.mount();
      if (health) widget.updateHealth(health);
      monitor.start();
      captureFrameworkTick("start");
    } else {
      widget.unmount();
      monitor.stop();
    }
  }

  // ─── Bootstrap ───

  observer.attach();

  window.__WEB_BUG_RECORDER_CONTROLLER__ = { refresh: refreshSession };
  chrome.runtime.onMessage.addListener((raw: unknown) => {
    if (!isEnvelope(raw)) return;
    if (raw.target && raw.target !== "content") return;
    if (raw.type === "content/reset") refreshSession(undefined);
    if (raw.type === "content/health-update" && raw.payload?.health) {
      if (session && raw.sessionId === session.sessionId) {
        widget.updateHealth(raw.payload.health);
      }
    }
  });
  chrome.runtime
    .sendMessage(
      // 与 background 握手：上报页面环境，换取当前激活会话并恢复 UI
      message("content/hello", {
        url: location.href,
        title: document.title,
        environment: captureEnvironment(),
      })
    )
    .then((response) => {
      refreshSession(
        response?.active && response.sessionId && response.nonce
          ? {
              sessionId: response.sessionId,
              nonce: response.nonce,
              startedAtEpochMs: response.startedAtEpochMs,
              privacyMode: response.privacyMode === "raw" ? "raw" : "safe",
              captureFrameworkState: Boolean(response.captureFrameworkState),
            }
          : undefined,
        response?.health
      );
    })
    .catch(() => undefined);
}
