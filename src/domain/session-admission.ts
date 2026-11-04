import {
  RECORDING_STATUSES,
  type RecordingSession,
} from "../shared/protocol.ts";

export type AdmissionRejection =
  | "NO_SESSION"
  | "STOPPING"
  | "NOT_RECORDING"
  | "TAB_NOT_TRACKED"
  | "NONCE_MISMATCH";

export type TrackedSessionLike = {
  target?: { tabId?: number };
  targets?: Array<{ tabId: number }>;
};

export type ExtraTrackedTabs =
  ReadonlySet<number> | ((tabId: number) => boolean);

/**
 * 校验指定标签页是否属于会话的目标或纳管集合。
 */
export function isTrackedTab(
  session: TrackedSessionLike | undefined,
  tabId: number | undefined,
  extraTracked?: ExtraTrackedTabs
): boolean {
  if (typeof tabId !== "number") {
    return false;
  }
  if (session?.target?.tabId === tabId) {
    return true;
  }
  if (session?.targets?.some((t) => t.tabId === tabId)) {
    return true;
  }
  if (extraTracked) {
    if (typeof extraTracked === "function") {
      return Boolean(extraTracked(tabId));
    }
    return extraTracked.has(tabId);
  }
  return false;
}

/**
 * 校验消息来源是否具备录制会话准入资格。
 * 顺序：会话存在 -> 非停止中 -> 录制状态中 -> 目标标签页匹配 -> nonce 匹配。
 * 通过返回 undefined，未通过返回具体拒绝原因。
 */
export function getAdmissionRejection(input: {
  session: RecordingSession | undefined;
  tabId: number | undefined;
  nonce: string | undefined;
  isStopping: (sessionId: string) => boolean;
  extraTracked?: ExtraTrackedTabs;
}): AdmissionRejection | undefined {
  const { session, tabId, nonce, isStopping, extraTracked } = input;
  if (!session) {
    return "NO_SESSION";
  }
  if (isStopping(session.id)) {
    return "STOPPING";
  }
  if (!RECORDING_STATUSES.includes(session.status)) {
    return "NOT_RECORDING";
  }
  if (!isTrackedTab(session, tabId, extraTracked)) {
    return "TAB_NOT_TRACKED";
  }
  if (session.nonce !== nonce) {
    return "NONCE_MISMATCH";
  }
  return undefined;
}
