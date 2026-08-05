import type {
  RecentConsoleError,
  RecentFailedNetworkRequest,
} from "../domain/screenshot-payload.ts";

const ERROR_TIME_WINDOW_MS = 5000;

class RecentErrorsTracker {
  private readonly consoleErrors: RecentConsoleError[] = [];
  private readonly failedRequests: RecentFailedNetworkRequest[] = [];
  private isListening = false;

  startListening(): void {
    if (this.isListening || typeof window === "undefined") return;
    this.isListening = true;

    // 监听 window.onerror 与 unhandledrejection
    window.addEventListener("error", (event) => {
      this.addConsoleError(
        event.message || "Uncaught Error",
        event.error?.stack
      );
    });

    window.addEventListener("unhandledrejection", (event) => {
      const reason = event.reason;
      const msg =
        typeof reason === "string"
          ? reason
          : reason?.message || "Unhandled Promise Rejection";
      this.addConsoleError(msg, reason?.stack);
    });

    // 拦截 console.error
    const originalConsoleError = console.error;
    console.error = (...args: any[]) => {
      originalConsoleError.apply(console, args);
      const msg = args
        .map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a)))
        .join(" ");
      this.addConsoleError(msg);
    };
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
