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

export function evaluateOffscreenStorageWrite(
  sessionId: string,
  result: BudgetWriteResult,
  previousWarningSent: boolean
): OffscreenStorageNotifyDecision {
  const newlyLimitReached = result.limitReached && !previousWarningSent;
  const isRejected = !result.stored;

  if (newlyLimitReached || isRejected) {
    return {
      shouldNotify: true,
      message: message("offscreen/storage-state", {
        sessionId,
        usedBytes: result.usedBytes,
        limitReached: result.limitReached,
        stored: result.stored
      }, sessionId)
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

export function validateStorageHealthUpdate(params: StorageHealthValidationParams): boolean {
  if (!params.senderUrl || params.senderUrl !== params.expectedOffscreenUrl) return false;
  if (!params.currentActiveSessionId) return false;
  if (params.incomingSessionId !== params.currentActiveSessionId) return false;
  return true;
}
