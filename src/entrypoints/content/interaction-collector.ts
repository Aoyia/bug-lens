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
import { ScreenshotOverlay } from "../../screenshot";
import { recentErrorsTracker } from "../../screenshot";
import { DevProfiler } from "../../shared/dev-profiler";
import {
  buildExportPipelineDashboard,
  createExportTraceContext,
  getEpochTimestampMs,
  type Stage6Metrics,
} from "../../export/export-trace";
import {
  ensureErrorsTrackerStarted,
  ensureScreenshotOverlayBridge,
} from "./content-bridge";
import { IframeActivityReporter } from "./collector/iframe-activity-reporter";
import { initFrameGeometryBridge } from "./collector/frame-geometry";

type ContentSession = {
  sessionId: string;
  nonce: string;
  startedAtEpochMs?: number;
  privacyMode: "safe" | "raw";
  captureFrameworkState?: boolean;
  frameId?: number;
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

const isTopFrame = typeof window !== "undefined" && window.top === window;

// 启动几何通信桥（跨域 postMessage 视口与偏移传递）
initFrameGeometryBridge();

// 启动最近错误监听（幂等）与截图 overlay 消息桥（幂等）：
// executeScript 重复注入会重新求值本脚本、重建模块单例，故委托 content-bridge
// 用 window 标志跨注入去重，避免累积监听器 / 重复包装 console.error，
// 否则多次截图后残留 window 拦截器（刷新/滚动永久失效）。
ensureErrorsTrackerStarted(() => recentErrorsTracker.startListening());

// 初始化宿主网页控制台与扩展 DevProfiler 的通信桥梁
DevProfiler.initPageBridge();

if (isTopFrame) {
  // 截图 overlay 初始为关闭：仅在顶层窗口报告与挂载
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
}

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
              frameId: response.frameId ?? (isTopFrame ? 0 : -1),
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
  let mountedWidget: RecordingWidget | undefined;
  let editor: IssueEditor | undefined;
  let overlay: SelectionOverlay | undefined;
  let expectedCard: ExpectedCaptureCard | undefined;
  let monitor: InactivityMonitor | undefined;
  let iframeReporter: IframeActivityReporter | undefined;

  if (isTopFrame) {
    const widget: RecordingWidget = new RecordingWidget({
      async onStop(clickInfo) {
        const t0EpochMs = clickInfo?.clickEpochMs ?? getEpochTimestampMs();
        const t0Perf = clickInfo?.clickTimestamp ?? performance.now();
        const clickResponseDurationMs = Math.max(0, performance.now() - t0Perf);
        const tFreezeStart = performance.now();
        widget.setSavingState(true);
        monitor?.stop();
        const uiFreezeDurationMs = performance.now() - tFreezeStart;

        const traceContext = createExportTraceContext(t0EpochMs);
        const tSendEpochMs = getEpochTimestampMs();
        traceContext.stage1 = {
          clickEpochMs: t0EpochMs,
          clickResponseDurationMs,
          uiFreezeDurationMs,
          sendEpochMs: tSendEpochMs,
          totalDurationMs: clickResponseDurationMs + uiFreezeDurationMs,
        };

        try {
          const res = await chrome.runtime.sendMessage(
            message("session/stop", {
              commandId: crypto.randomUUID(),
              // 结束即导出：直出证据包下载，不打开预览页（业务契约，勿改）
              silentExport: true,
              traceStartMs: t0Perf,
              traceContext,
            })
          );
          const exportFailure = getSilentExportFailure(res, t("stopFailed"));
          if (exportFailure) {
            // 停止失败：会话仍存活，恢复挂件交互以便用户重试
            widget.setSavingState(false);
            widget.showToast(t("exportFailed", exportFailure), 5_500, "error");
            monitor?.start();

            if (DevProfiler.isEnabled()) {
              try {
                const failureTrace =
                  res?.session?.silentExportResult?.traceContext ??
                  traceContext;
                const failureDashboard = buildExportPipelineDashboard(
                  failureTrace,
                  getEpochTimestampMs(),
                  {
                    导出状态: "失败 (Failed)",
                    失败原因: exportFailure,
                    "会话 ID": session?.sessionId ?? "-",
                  }
                );
                DevProfiler.printExportDashboard(failureDashboard);
              } catch {
                // 忽略调试输出异常
              }
            }
            return;
          }

          const clipboardStart = performance.now();
          const prompt = res?.session?.silentPrompt;
          if (prompt) {
            try {
              await copyTextToClipboard(prompt);
            } catch {
              // 忽略
            }
          }
          const clipboardWriteDurationMs = performance.now() - clipboardStart;

          const toastStart = performance.now();
          try {
            widget.showToast(t("exportSuccessCopied"));
          } catch {
            // 忽略 Toast 展示异常
          }
          const toastDurationMs = performance.now() - toastStart;

          // 导出完成并弹出 Toast 后，平滑卸载悬浮条并清理会话
          const teardownStart = performance.now();
          try {
            await widget.closeSmoothly();
          } catch {
            try {
              widget.unmount();
            } catch {
              // 忽略卸载异常
            }
          }
          refreshSession(undefined);
          const teardownDurationMs = performance.now() - teardownStart;

          const stage6Metrics: Stage6Metrics = {
            clipboardWriteDurationMs,
            toastDurationMs,
            teardownDurationMs,
            toastAndTeardownDurationMs: toastDurationMs + teardownDurationMs,
            totalDurationMs:
              clipboardWriteDurationMs + toastDurationMs + teardownDurationMs,
          };

          const returnedTrace =
            res?.session?.silentExportResult?.traceContext ?? traceContext;
          returnedTrace.stage6 = stage6Metrics;

          // 输出全流程结构化大盘（时间账本闭环 + 算法/IO看板 + 瀑布流）
          try {
            const dashboard = buildExportPipelineDashboard(
              returnedTrace,
              getEpochTimestampMs(),
              {
                导出文件: res?.session?.silentExportResult?.filename ?? "-",
                "会话 ID": session?.sessionId ?? "-",
              }
            );
            DevProfiler.printExportDashboard(dashboard);

            const serverMetrics =
              res?.session?.silentExportResult?.e2eMetrics ?? [];
            if (serverMetrics.length > 0) {
              const allE2EMetrics = [
                {
                  step: "1. 触发与 IPC 分发",
                  durationMs: returnedTrace.stage1?.totalDurationMs ?? 0,
                  note:
                    returnedTrace.stage1?.clickResponseDurationMs !== undefined
                      ? `点击响应 ${returnedTrace.stage1.clickResponseDurationMs.toFixed(2)} ms, UI 冻结 ${(returnedTrace.stage1.uiFreezeDurationMs ?? 0).toFixed(2)} ms, IPC ${(returnedTrace.stage1.ipcDispatchDurationMs ?? 0).toFixed(2)} ms`
                      : `UI 冻结 ${(returnedTrace.stage1?.uiFreezeDurationMs ?? 0).toFixed(2)} ms, IPC ${(returnedTrace.stage1?.ipcDispatchDurationMs ?? 0).toFixed(2)} ms`,
                },
                ...serverMetrics,
                {
                  step: "6. 终端反馈（剪贴板与挂件卸载）",
                  durationMs: stage6Metrics.totalDurationMs,
                  size: prompt ? `${prompt.length} 字符` : "-",
                  note: "AI Prompt 注入剪贴板、呈现 Toast 并平滑卸载挂件",
                },
              ];
              const totalE2EMs = dashboard.totalWallClockMs;
              DevProfiler.printSummaryTable(
                "端到端（E2E）导出耗时全链路大盘",
                allE2EMetrics,
                {
                  端到端总感知耗时: `${totalE2EMs.toFixed(2)} ms`,
                  导出文件: res?.session?.silentExportResult?.filename ?? "-",
                }
              );
            }

            const perfReport = res?.session?.silentExportResult?.perfReport;
            if (perfReport) {
              DevProfiler.printReport(perfReport);
            }
          } catch (profError) {
            // eslint-disable-next-line no-console
            console.error("性能监控看板构建失败:", profError);
          }
        } catch (error) {
          // 通道异常：会话大概率仍存活，恢复挂件交互以便用户重试
          widget.setSavingState(false);
          widget.showToast(t("exportFailed", String(error)), 5_500, "error");
          monitor?.start();
        }
      },
      onMarkIssue(anchor) {
        beginIssueSelection(anchor);
      },
      isPaused() {
        return monitor?.isIdlePaused ?? false;
      },
      getStartedAtEpochMs() {
        return (
          session?.startedAtEpochMs || cachedStartedAtEpochMs || Date.now()
        );
      },
      isIdlePaused(): boolean {
        return monitor?.isIdlePaused ?? false;
      },
      getPausedDurationMs(): number {
        return monitor?.getPausedDurationMs() ?? 0;
      },
      getSessionId(): string | undefined {
        return session?.sessionId;
      },
    });
    mountedWidget = widget;

    // 监听语言偏好变更并实时更新挂件文案
    onLanguagePreferenceChange(() => {
      widget.updateLanguage();
    });

    // 问题编辑器：编辑已捕获的场景快照，与选区流程分离
    editor = new IssueEditor({
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
    overlay = new SelectionOverlay({
      getSession: () => session,
      getPendingExpected: () => pendingExpected,
      onCaptureComplete(scene, dataUrl) {
        pendingExpected = undefined;
        widget.unmount();
        editor?.open(scene, dataUrl);
      },
      onCancel() {
        widget.setIssueSelecting(false);
      },
      onError: (message) => widget.showToast(message, 5_500, "error"),
      getEditorElement: () => editor?.element,
      shortcutKeyText: widget.shortcutKeyText,
    });

    // 期望速记卡：选区前置步骤，先记录"预期应该发生什么"
    expectedCard = new ExpectedCaptureCard({
      onSubmit(expected) {
        pendingExpected = expected;
        proceedToIssueSelection();
      },
      onSkip() {
        pendingExpected = undefined;
        proceedToIssueSelection();
      },
      onCancel() {
        widget.setIssueSelecting(false);
      },
    });

    // 空闲监测：仅在顶层窗口运行，页面长时间无交互时暂停录制
    monitor = new InactivityMonitor({
      onPause() {
        widget?.updatePauseState(true);
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
        widget?.updatePauseState(false);
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
      isBlocked: (): boolean =>
        (overlay?.isActive ||
          editor?.isOpen ||
          mountedWidget?.isSaving ||
          mountedWidget?.isClosing) ??
        false,
    });
  } else {
    // 子 iframe：仅启用活跃事件上报器，向 background 发送心跳通知主帧重置空闲倒计时
    iframeReporter = new IframeActivityReporter();
  }

  // DOM 观察器：在所有窗口（包含子 iframe）监听页面交互并采集坐标
  const observer = new DomObserver({
    getSession: () => session,
    isIssueActive: () => (overlay?.isActive || editor?.isOpen) ?? false,
    beginIssueSelection,
    removeIssueUi,
    onEvidenceTick: () => captureFrameworkTick("interaction"),
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
    if (!isTopFrame) return;
    if (mountedWidget?.isSaving || mountedWidget?.isClosing) return;
    if (overlay?.isActive || editor?.isOpen || expectedCard?.isOpen) return;
    expectedCard?.open(anchor);
  }

  // 速记卡确认/跳过后进入元素选择，并采集当前框架状态作为问题上下文
  function proceedToIssueSelection(): void {
    if (!isTopFrame) return;
    if (mountedWidget?.isSaving || mountedWidget?.isClosing) return;
    if (overlay?.isActive || editor?.isOpen) return;
    mountedWidget?.setIssueSelecting(true);
    overlay?.open();
    captureFrameworkTick("issue-scene");
  }

  function removeIssueUi(): void {
    if (isTopFrame) {
      overlay?.close();
      editor?.close(false);
      expectedCard?.close();
      mountedWidget?.setIssueSelecting(false);
    }
  }

  // 会话激活：挂载 widget、启动空闲监测/子帧上报、上报 start 框架态；
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
      if (isTopFrame) {
        mountedWidget?.mount();
        if (health && mountedWidget) mountedWidget.updateHealth(health);
        monitor?.start();
        captureFrameworkTick("start");
      } else {
        iframeReporter?.start();
        captureFrameworkTick("start");
      }
    } else {
      if (isTopFrame) {
        mountedWidget?.unmount();
        monitor?.stop();
      } else {
        iframeReporter?.stop();
      }
    }
  }

  // ─── Bootstrap ───

  observer.attach();

  window.__WEB_BUG_RECORDER_CONTROLLER__ = { refresh: refreshSession };
  chrome.runtime.onMessage.addListener((raw: unknown) => {
    if (!isEnvelope(raw)) return;
    if (raw.target && raw.target !== "content") return;
    if (raw.type === "content/reset") {
      if (mountedWidget?.isSaving || mountedWidget?.isClosing) {
        // 静默导出中，由 onStop 负责生命周期与平滑关闭，忽略外部提前到达的 reset
        return;
      }
      refreshSession(undefined);
    }
    if (raw.type === "content/health-update" && raw.payload?.health) {
      if (session && raw.sessionId === session.sessionId && mountedWidget) {
        mountedWidget.updateHealth(raw.payload.health);
      }
    }
    if (raw.type === "content/activity-ping" && isTopFrame) {
      monitor?.recordActivity();
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
              frameId: response.frameId ?? (isTopFrame ? 0 : -1),
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
