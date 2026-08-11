import { useState, useRef, useCallback, useEffect } from "preact/hooks";
import { ACTIVE_STATUSES } from "../shared/protocol.ts";
import type { RecordingSession } from "../shared/protocol.ts";

const PREVIEW_STATUSES: readonly string[] = ["PREVIEW_READY", "EXPORTED"];

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export type UseSessionStateOptions = {
  setInterval?: (handler: () => void, timeout?: number) => number;
  clearInterval?: (handle?: number) => void;
  now?: () => number;
};

/**
 * 管理进行中的录制会话状态，包括：
 *  - 会话对象
 *  - 由 setInterval 驱动的实时计时文本（mm:ss）
 *  - 派生布尔值：active / previewReady / controlsLocked
 *
 * 该逻辑从 PopupApp.tsx 中抽取而来，原先这些约 50 行与主组件高度耦合。
 */
export function useSessionState(options?: UseSessionStateOptions) {
  // 定时器/时钟可注入（测试用假定时器），经 ref 取最新值避免每次渲染重建 effect
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [activeSession, setActiveSession] = useState<
    RecordingSession | undefined
  >();
  const [timerText, setTimerText] = useState("");
  const timerRef = useRef<number | undefined>();
  const isMountedRef = useRef(true);

  // 会话是否处于录制中：status 命中 ACTIVE_STATUSES 即视为活跃
  const isActive = useCallback(
    (session?: RecordingSession) =>
      Boolean(session && ACTIVE_STATUSES.includes(session.status)),
    []
  );

  // 预览就绪/已导出：与录制中一致，锁定控件禁止继续编辑
  const isPreviewReady = useCallback(
    (session?: RecordingSession) =>
      Boolean(session && PREVIEW_STATUSES.includes(session.status)),
    []
  );

  const clearTimer = useCallback(() => {
    if (timerRef.current !== undefined) {
      const clearIntervalFn =
        optionsRef.current?.clearInterval ?? window.clearInterval.bind(window);
      clearIntervalFn(timerRef.current);
      timerRef.current = undefined;
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    const setIntervalFn =
      optionsRef.current?.setInterval ?? window.setInterval.bind(window);

    // 活跃会话按 timeline.startedAtEpochMs 计时，每 1s 刷新一次 mm:ss 文本
    if (isActive(activeSession) && activeSession?.timeline.startedAtEpochMs) {
      clearTimer();
      const startedAt = activeSession.timeline.startedAtEpochMs;
      const tick = () => {
        if (isMountedRef.current) {
          const nowFn = optionsRef.current?.now ?? Date.now;
          setTimerText(formatDuration(nowFn() - startedAt));
        }
      };
      tick();
      timerRef.current = setIntervalFn(tick, 1000);
    } else {
      clearTimer();
      setTimerText("");
    }

    return () => {
      isMountedRef.current = false;
      clearTimer();
    };
  }, [activeSession, isActive, clearTimer]);

  const updateSessionState = useCallback(
    (session?: RecordingSession) => {
      clearTimer();
      setActiveSession(session);
    },
    [clearTimer]
  );

  const active = isActive(activeSession);
  const previewReady = isPreviewReady(activeSession);
  const controlsLocked = active || previewReady;

  return {
    activeSession,
    timerText,
    active,
    previewReady,
    controlsLocked,
    updateSessionState,
    isActive,
    isPreviewReady,
  };
}
