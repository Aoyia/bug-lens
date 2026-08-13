import type {
  RecentConsoleError,
  RecentFailedNetworkRequest,
} from "../domain/screenshot-payload.ts";

const ERROR_TIME_WINDOW_MS = 5000;

// 防重复包装的专属元数据标记锁
const PATCHED_FLAG = Symbol("__BUG_LENS_PATCHED__");
const ORIGINAL_FN = Symbol("__BUG_LENS_ORIGINAL__");

export type Disposer = () => void;

class RecentErrorsTracker {
  private readonly consoleErrors: RecentConsoleError[] = [];
  private readonly failedRequests: RecentFailedNetworkRequest[] = [];
  private isListening = false;

  // 维护所有激活中的清理回调列表
  private disposers: Disposer[] = [];

  /**
   * 启动错误与网络跟踪监听器
   */
  startListening(): void {
    if (this.isListening || typeof window === "undefined") return;
    this.isListening = true;

    // 1. 安全注册 window 全局错误事件
    this.registerGlobalErrorListeners();

    // 2. 安全 Patch console.error
    this.patchConsoleError();
  }

  /**
   * 停止监听并恢复所有被篡改的全局原生 API 与事件监听器
   */
  stopListening(): void {
    if (!this.isListening) return;

    // 执行所有注册的清理句柄
    while (this.disposers.length > 0) {
      const dispose = this.disposers.pop();
      try {
        dispose?.();
      } catch (err) {
        // 确保单个销毁过程报错不中断整体还原流程
        console.warn("[BugLens] Error during interceptor cleanup:", err);
      }
    }

    this.isListening = false;
  }

  /**
   * 清空已采集的错误与缓存数据
   */
  clear(): void {
    this.consoleErrors.length = 0;
    this.failedRequests.length = 0;
  }

  /**
   * 销毁实例：停止监听并清理缓存
   */
  destroy(): void {
    this.stopListening();
    this.clear();
  }

  private registerGlobalErrorListeners(): void {
    const errorHandler = (event: ErrorEvent) => {
      this.addConsoleError(
        event.message || "Uncaught Error",
        event.error?.stack
      );
    };

    const rejectionHandler = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const msg =
        typeof reason === "string"
          ? reason
          : reason?.message || "Unhandled Promise Rejection";
      this.addConsoleError(msg, reason?.stack);
    };

    window.addEventListener("error", errorHandler);
    window.addEventListener("unhandledrejection", rejectionHandler);

    this.disposers.push(() => {
      window.removeEventListener("error", errorHandler);
      window.removeEventListener("unhandledrejection", rejectionHandler);
    });
  }

  private patchConsoleError(): void {
    const targetConsole = console as any;
    const originalMethod = targetConsole.error;

    if (!originalMethod || typeof originalMethod !== "function") return;

    // 检查是否已被包装，防止嵌套二次 Patch
    if (originalMethod[PATCHED_FLAG]) {
      return;
    }

    const wrappedConsoleError = (...args: any[]) => {
      // 1. 保障原生行为优先执行 (Fail-Safe)
      try {
        originalMethod.apply(console, args);
      } catch (e) {
        // 防止第三方改写 console 导致 apply 异常
      }

      // 2. 安全捕获异常日志
      try {
        const msg = args
          .map((a) => {
            if (a instanceof Error)
              return a.message + (a.stack ? `\n${a.stack}` : "");
            if (typeof a === "object" && a !== null) {
              try {
                return JSON.stringify(a);
              } catch {
                return "[Circular Object]";
              }
            }
            return String(a);
          })
          .join(" ");
        this.addConsoleError(msg);
      } catch (err) {
        // 内部分析失败绝对不能打断宿主代码
      }
    };

    wrappedConsoleError[PATCHED_FLAG] = true;
    wrappedConsoleError[ORIGINAL_FN] = originalMethod;

    targetConsole.error = wrappedConsoleError;

    this.disposers.push(() => {
      if (targetConsole.error === wrappedConsoleError) {
        targetConsole.error = originalMethod;
      }
    });
  }

  addConsoleError(message: string, stack?: string): void {
    const now = Date.now();
    this.consoleErrors.push({ message, stack, timestamp: now });
    this.cleanupOldEntries(now);
  }

  addFailedNetworkRequest(
    req: Omit<RecentFailedNetworkRequest, "timestamp">
  ): void {
    const now = Date.now();
    this.failedRequests.push({ ...req, timestamp: now });
    this.cleanupOldEntries(now);
  }

  getRecentConsoleErrors(
    windowMs: number = ERROR_TIME_WINDOW_MS
  ): RecentConsoleError[] {
    const cutoff = Date.now() - windowMs;
    return this.consoleErrors.filter((e) => e.timestamp >= cutoff);
  }

  getRecentFailedRequests(
    windowMs: number = ERROR_TIME_WINDOW_MS
  ): RecentFailedNetworkRequest[] {
    const cutoff = Date.now() - windowMs;
    return this.failedRequests.filter((r) => r.timestamp >= cutoff);
  }

  private cleanupOldEntries(now: number): void {
    const cutoff = now - ERROR_TIME_WINDOW_MS * 2;
    while (
      this.consoleErrors.length > 0 &&
      this.consoleErrors[0].timestamp < cutoff
    ) {
      this.consoleErrors.shift();
    }
    while (
      this.failedRequests.length > 0 &&
      this.failedRequests[0].timestamp < cutoff
    ) {
      this.failedRequests.shift();
    }
  }
}

export const recentErrorsTracker = new RecentErrorsTracker();
