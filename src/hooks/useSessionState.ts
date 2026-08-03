import { useState, useRef, useCallback, useEffect } from "preact/hooks";
import type { RecordingSession } from "../shared/protocol.ts";

const ACTIVE_STATUSES: readonly string[] = [
  "PREPARING",
  "RECORDING",
  "DEGRADED",
  "STOPPING",
];
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
 * Manages the active recording session state, including:
 *  - session object
 *  - live timer text (mm:ss) driven by setInterval
 *  - derived booleans: active / previewReady / controlsLocked
 *
 * Extracted from PopupApp.tsx where these ~50 lines were tightly coupled.
 */
export function useSessionState(options?: UseSessionStateOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [activeSession, setActiveSession] = useState<
    RecordingSession | undefined
  >();
  const [timerText, setTimerText] = useState("");
  const timerRef = useRef<number | undefined>();
  const isMountedRef = useRef(true);

  const isActive = useCallback(
    (session?: RecordingSession) =>
      Boolean(session && ACTIVE_STATUSES.includes(session.status)),
    []
  );

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
