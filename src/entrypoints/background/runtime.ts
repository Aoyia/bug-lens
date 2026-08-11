import { createBackgroundContext, type BackgroundDeps } from "./context";
import { createSessionLifecycle } from "./lifecycle";
import { createBootstrapService } from "./bootstrap";
import { createScreenshotService } from "./screenshot";
import { createMessageRouter } from "./message-router";
import { createEventHandlers } from "./events";

export type { BackgroundDeps } from "./context";

export type BackgroundRuntime = ReturnType<typeof createBackgroundRuntime>;

/**
 * 创建 background 编排运行时（依赖注入，便于单元测试）。
 *
 * 组合根：装配上下文与各领域服务（lifecycle / bootstrap / screenshot /
 * message-router / events），对外返回与拆分前完全一致的方法集合；
 * index.ts 仅负责真实依赖装配与 chrome 事件注册。
 */
export function createBackgroundRuntime(deps: BackgroundDeps) {
  const ctx = createBackgroundContext(deps);
  const lifecycle = createSessionLifecycle(ctx);
  const bootstrap = createBootstrapService(ctx, lifecycle);
  const screenshot = createScreenshotService(
    ctx,
    lifecycle,
    () => bootstrap.promise
  );
  const router = createMessageRouter(ctx, {
    lifecycle,
    screenshot,
    bootstrapPromise: bootstrap.promise,
  });
  const eventHandlers = createEventHandlers(ctx, { lifecycle, bootstrap });

  return {
    startSession: lifecycle.start,
    stopSession: lifecycle.stop,
    continueInterruptedSession: lifecycle.continueInterrupted,
    performStopSession: lifecycle.performStop,
    stopSessionImpl: lifecycle.stopImpl,
    openPendingPreview: lifecycle.openPendingPreview,
    recoverInterruptedSession: bootstrap.recover,
    reconcileSessionQuality: lifecycle.reconcileSessionQuality,
    bootstrapRuntimeState: bootstrap.run,
    bootstrapPromise: bootstrap.promise,
    pauseMediaSession: lifecycle.pauseMedia,
    resumeMediaSession: lifecycle.resumeMedia,
    restoreSessionAfterNavigation: bootstrap.restoreAfterNavigation,
    startRecordingViaShortcut: screenshot.startRecordingViaShortcut,
    triggerScreenshotInTab: screenshot.triggerInTab,
    startScreenshotViaShortcut: screenshot.startScreenshotViaShortcut,
    handleMessage: router.handle,
    handleDebuggerEvent: eventHandlers.handleDebuggerEvent,
    handleDebuggerDetach: eventHandlers.handleDebuggerDetach,
    handleTabRemoved: eventHandlers.handleTabRemoved,
    handleTabUpdated: eventHandlers.handleTabUpdated,
    cleanupExpiredSessions: () => deps.db.cleanupExpiredSessions(),
  };
}
