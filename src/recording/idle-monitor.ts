import type { CaptureIssue } from "../shared/protocol";

export type IdleState = "active" | "idle" | "locked";

export interface IdleGapInfo {
  startIndex: number;
  endIndex: number;
  gapMs: number;
  formattedGap: string;
}

export const MAX_IDLE_GAP_THRESHOLD_MS = 5 * 60 * 1000; // 5分钟长休眠阈值

/**
 * 计算交互列表中由于系统休眠/切后台产生的长空闲间隔（> 5 分钟）
 */
export function detectIdleGaps(
  timestamps: number[],
  thresholdMs: number = MAX_IDLE_GAP_THRESHOLD_MS
): IdleGapInfo[] {
  const gaps: IdleGapInfo[] = [];
  if (timestamps.length < 2) return gaps;

  for (let i = 1; i < timestamps.length; i++) {
    const gap = timestamps[i] - timestamps[i - 1];
    if (gap >= thresholdMs) {
      const gapMin = (gap / 60000).toFixed(1);
      gaps.push({
        startIndex: i - 1,
        endIndex: i,
        gapMs: gap,
        formattedGap: `${gapMin} min`,
      });
    }
  }

  return gaps;
}

export class IdleMonitor {
  private activeSessionId: string | undefined;
  private lastActiveTimestamp: number = Date.now();
  private onIdleStateChangedListener?: (newState: IdleState) => void;

  public startMonitoring(
    sessionId: string,
    onSystemResume?: (issue: CaptureIssue) => void
  ): void {
    this.activeSessionId = sessionId;
    this.lastActiveTimestamp = Date.now();

    if (typeof chrome !== "undefined" && chrome.idle?.onStateChanged) {
      this.onIdleStateChangedListener = (newState: IdleState) => {
        if (newState === "active" && this.activeSessionId) {
          const now = Date.now();
          const elapsed = now - this.lastActiveTimestamp;
          if (elapsed >= MAX_IDLE_GAP_THRESHOLD_MS) {
            onSystemResume?.({
              code: "SYSTEM_SUSPENDED_RESUMED",
              message: `System resumed from sleep (${(elapsed / 60000).toFixed(1)} min idle gap detected)`,
              source: "interaction",
              recoverable: true,
              occurredAt: now,
            });
          }
          this.lastActiveTimestamp = now;
        } else if (newState === "idle" || newState === "locked") {
          this.lastActiveTimestamp = Date.now();
        }
      };

      try {
        chrome.idle.onStateChanged.addListener(this.onIdleStateChangedListener);
        chrome.idle.setDetectionInterval(60); // 60s 感知
      } catch {
        // 环境不支持时静默降级
      }
    }
  }

  public stopMonitoring(): void {
    if (
      typeof chrome !== "undefined" &&
      chrome.idle?.onStateChanged &&
      this.onIdleStateChangedListener
    ) {
      try {
        chrome.idle.onStateChanged.removeListener(
          this.onIdleStateChangedListener
        );
      } catch {
        // ignore
      }
    }
    this.activeSessionId = undefined;
  }
}
