import type { BudgetWriteResult } from "../storage/storage-budget.ts";
import { message, type Envelope } from "../shared/protocol.ts";

export type StorageStatePayload = {
  sessionId: string;
  usedBytes: number;
  limitReached: boolean;
  stored: boolean;
};

export type OffscreenStorageNotifyDecision = {
  shouldNotify: boolean;
  message?: Envelope<"offscreen/storage-state", StorageStatePayload>;
};

/**
 * 评估一次预算写入是否需要向 UI 广播存储状态：
 * 只在「首次达到限制」（newlyLimitReached，避免重复轰炸）或「写入被拒绝」时通知。
 */
export function evaluateOffscreenStorageWrite(
  sessionId: string,
  result: BudgetWriteResult,
  previousWarningSent: boolean
): OffscreenStorageNotifyDecision {
  // 达到限制且此前未提醒过才算「新达限」；写入被拒是另一类必须立即通知的事件
  const newlyLimitReached = result.limitReached && !previousWarningSent;
  const isRejected = !result.stored;

  if (newlyLimitReached || isRejected) {
    return {
      shouldNotify: true,
      message: message(
        "offscreen/storage-state",
        {
          sessionId,
          usedBytes: result.usedBytes,
          limitReached: result.limitReached,
          stored: result.stored,
        },
        sessionId,
        "background"
      ),
    };
  }

  return { shouldNotify: false };
}

export type StorageHealthValidationParams = {
  senderUrl?: string;
  expectedOffscreenUrl: string;
  incomingSessionId: string;
  currentActiveSessionId?: string;
};

/**
 * 校验存储健康上报是否可信：消息必须来自 offscreen.html（扩展页的
 * sender URL 与预期严格一致），且上报的会话须与当前活动会话匹配。
 */
export function validateStorageHealthUpdate(
  params: StorageHealthValidationParams
): boolean {
  // 拒绝非 offscreen 来源（如网页内容脚本伪装）的消息
  if (!params.senderUrl || params.senderUrl !== params.expectedOffscreenUrl)
    return false;
  if (!params.currentActiveSessionId) return false;
  if (params.incomingSessionId !== params.currentActiveSessionId) return false;
  return true;
}
