export interface TemporalLogItem {
  timestamp: number;
  type: "console" | "network";
  level?: "error" | "warn" | "info";
  message: string;
  status?: number;
  url?: string;
}

export interface TemporalTraceResult {
  timeWindowMs: number;
  logs: TemporalLogItem[];
}

/**
 * 时间追溯与日志网络联动采集器
 * 以截图时刻为基准点，搜集前 windowMs (默认5000ms) 发生的关键 Error/Network 响应
 */
export class TemporalTracer {
  private static logBuffer: TemporalLogItem[] = [];
  private static maxBufferLength = 200;
  private static isInitialized = false;

  /**
   * 初始化挂钩 (Hook console.error & window.fetch / XHR)
   */
  public static init(): void {
    if (this.isInitialized) return;
    this.isInitialized = true;

    // 监听 Console Error
    const originalConsoleError = console.error;
    console.error = (...args: any[]) => {
      try {
        const msg = args
          .map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a)))
          .join(" ");
        this.addLog({
          timestamp: Date.now(),
          type: "console",
          level: "error",
          message: msg,
        });
      } catch {
        // ignore
      }
      originalConsoleError.apply(console, args);
    };

    // 监听 window.addEventListener('error')
    window.addEventListener("error", (event) => {
      this.addLog({
        timestamp: Date.now(),
        type: "console",
        level: "error",
        message: event.message || "Unhandled Error",
      });
    });
  }

  public static addLog(item: TemporalLogItem): void {
    this.logBuffer.push(item);
    if (this.logBuffer.length > this.maxBufferLength) {
      this.logBuffer.shift();
    }
  }

  /**
   * 收集以 targetTime 为基准前 windowMs 毫秒内的关键日志
   */
  public static traceRecentContext(
    targetTime: number = Date.now(),
    windowMs: number = 5000
  ): TemporalTraceResult {
    const startTime = targetTime - windowMs;
    const recentLogs = this.logBuffer.filter(
      (item) => item.timestamp >= startTime && item.timestamp <= targetTime
    );

    return {
      timeWindowMs: windowMs,
      logs: recentLogs,
    };
  }

  /**
   * 清空缓冲区（用于测试）
   */
  public static reset(): void {
    this.logBuffer = [];
  }
}
