import type {
  ResolveBatchRequest,
  ResolveBatchResponse,
  BatchItem,
} from "./sourcemap.worker.js";
import type { SourceMappedLocation } from "../../shared/protocol.js";

export type InProcessResolver = (
  request: ResolveBatchRequest
) => Promise<ResolveBatchResponse>;

let registeredInProcessResolver: InProcessResolver | null = null;

export function registerInProcessResolver(resolver: InProcessResolver): void {
  registeredInProcessResolver = resolver;
}

export class SourceMapWorkerClient {
  private worker: Worker | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingRequests = new Map<
    string,
    {
      request: ResolveBatchRequest;
      resolve: (res: Record<string, SourceMappedLocation>) => void;
      reject: (err: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  constructor() {
    this.ensureWorker();
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private ensureWorker(): Worker | null {
    if (this.worker) return this.worker;
    if (
      typeof Worker !== "undefined" &&
      typeof document !== "undefined" &&
      typeof chrome !== "undefined" &&
      typeof chrome.runtime?.getURL === "function"
    ) {
      try {
        const workerUrl = chrome.runtime.getURL("sourcemap.worker.js");
        this.worker = new Worker(workerUrl);
        this.worker.onmessage = this.handleMessage.bind(this);
        this.worker.onerror = () => {
          this.fallbackAllPendingToInProcess();
        };
      } catch {
        this.worker = null;
      }
    }
    return this.worker;
  }

  private fallbackAllPendingToInProcess(): void {
    if (this.worker) {
      try {
        this.worker.terminate();
      } catch {
        // Ignore terminate error
      }
      this.worker = null;
    }
    const entries = Array.from(this.pendingRequests.entries());
    this.pendingRequests.clear();
    for (const [, pending] of entries) {
      clearTimeout(pending.timer);
      if (registeredInProcessResolver) {
        void registeredInProcessResolver(pending.request)
          .then((res) => pending.resolve(res.results))
          .catch((err) => pending.reject(err));
      } else {
        const fallbackResults: Record<string, SourceMappedLocation> = {};
        for (const item of pending.request.items) {
          fallbackResults[item.id] = {
            resolved: false,
            failureReason: "FETCH_FAILED",
          };
        }
        pending.resolve(fallbackResults);
      }
    }
  }

  public async resolveBatch(
    items: BatchItem[],
    options: {
      snippetLinesBefore?: number;
      snippetLinesAfter?: number;
      timeoutMs?: number;
    } = {}
  ): Promise<Record<string, SourceMappedLocation>> {
    if (items.length === 0) return {};

    this.clearIdleTimer();
    const worker = this.ensureWorker();

    const requestId = `sm_req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const request: ResolveBatchRequest = {
      type: "RESOLVE_BATCH_REQUEST",
      requestId,
      items,
      snippetLinesBefore: options.snippetLinesBefore ?? 5,
      snippetLinesAfter: options.snippetLinesAfter ?? 5,
      timeoutMs: options.timeoutMs ?? 5000,
    };

    // If Worker is not available (e.g. Node.js test environment or MV3 restricted context), run in-process directly if registered
    if (!worker) {
      if (registeredInProcessResolver) {
        const response = await registeredInProcessResolver(request);
        return response.results;
      }
      const fallbackResults: Record<string, SourceMappedLocation> = {};
      for (const item of items) {
        fallbackResults[item.id] = {
          resolved: false,
          failureReason: "FETCH_FAILED",
        };
      }
      return fallbackResults;
    }

    return new Promise((resolve, reject) => {
      const timeoutMs = options.timeoutMs ?? 8000;
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        // On timeout, return fallback entries instead of completely throwing
        const fallbackResults: Record<string, SourceMappedLocation> = {};
        for (const item of items) {
          fallbackResults[item.id] = {
            resolved: false,
            failureReason: "TIMEOUT",
          };
        }
        resolve(fallbackResults);
      }, timeoutMs);

      this.pendingRequests.set(requestId, {
        request,
        resolve,
        reject,
        timer,
      });
      this.worker!.postMessage(request);
    });
  }

  private handleMessage(e: MessageEvent<ResolveBatchResponse>) {
    if (!e.data || e.data.type !== "RESOLVE_BATCH_RESPONSE") return;
    const { requestId, results } = e.data;
    const pending = this.pendingRequests.get(requestId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingRequests.delete(requestId);
      pending.resolve(results);
    }
  }

  public scheduleIdleTerminate(idleMs = 5 * 60_000): void {
    this.clearIdleTimer();
    if (!this.worker) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.pendingRequests.size === 0) {
        this.terminate();
      }
    }, idleMs);
    (this.idleTimer as { unref?: () => void }).unref?.();
  }

  public terminate() {
    this.clearIdleTimer();
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}
