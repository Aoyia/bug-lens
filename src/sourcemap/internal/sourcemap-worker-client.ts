import {
  type ResolveBatchRequest,
  type ResolveBatchResponse,
  type BatchItem,
  processBatchResolution,
} from "./sourcemap.worker.js";
import type { SourceMappedLocation } from "../../shared/protocol.js";

export class SourceMapWorkerClient {
  private worker: Worker | null = null;
  private pendingRequests = new Map<
    string,
    {
      resolve: (res: Record<string, SourceMappedLocation>) => void;
      reject: (err: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  constructor() {
    // If running in browser environment with Worker support
    if (typeof Worker !== "undefined") {
      try {
        const workerUrl = new URL("./sourcemap.worker.js", import.meta.url);
        this.worker = new Worker(workerUrl, { type: "module" });
        this.worker.onmessage = this.handleMessage.bind(this);
      } catch {
        this.worker = null;
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

    const requestId = `sm_req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const request: ResolveBatchRequest = {
      type: "RESOLVE_BATCH_REQUEST",
      requestId,
      items,
      snippetLinesBefore: options.snippetLinesBefore ?? 5,
      snippetLinesAfter: options.snippetLinesAfter ?? 5,
      timeoutMs: options.timeoutMs ?? 5000,
    };

    // If Worker is not available (e.g. Node.js test environment or MV3 restricted context), run in-process directly
    if (!this.worker) {
      const response = await processBatchResolution(request);
      return response.results;
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

      this.pendingRequests.set(requestId, { resolve, reject, timer });
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

  public terminate() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}
