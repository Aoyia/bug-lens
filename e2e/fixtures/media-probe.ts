import type { BrowserContext, Page, Worker } from "@playwright/test";
import type { RecordingSession } from "../../src/shared/protocol.ts";

type CapturedTab = {
  tabId: number;
  status: "pending" | "active" | "stopped" | "error";
};

export type MediaSnapshot = {
  session?: RecordingSession;
  capture?: CapturedTab;
  offscreenActive: boolean;
};

export type EvidenceItemWithTimestamp = {
  createdAt?: number;
  createdAtEpochMs?: number;
  timestamp?: number;
  occurredAt?: number;
};

export type EvidenceAssetSummary = {
  id: string;
  kind: string;
  mimeType: string;
  byteLength: number;
  width?: number;
  height?: number;
  sessionId?: string;
  issueSceneId?: string;
  interactionId?: string;
};

export type InteractionRecordSummary = EvidenceItemWithTimestamp & {
  id: string;
  kind: string;
  status: string;
  element: { id?: string; tagName?: string; text?: string };
  metadata?: {
    key?: string;
    code?: string;
    altKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
  };
  screenshot: { status: string; source?: string; assetId?: string };
};

export type PersistedEvidence = {
  session?: RecordingSession;
  mediaChunks: Array<{
    sequence: number;
    mimeType: string;
    byteLength: number;
  }>;
  interactionCount: number;
  consoleCount: number;
  networkCount: number;
  interactions: InteractionRecordSummary[];
  consoleEntries: EvidenceItemWithTimestamp[];
  networkEntries: EvidenceItemWithTimestamp[];
  evidenceAssets: EvidenceAssetSummary[];
};

async function poll<T>(
  read: () => Promise<T>,
  accept: (value: T) => boolean,
  timeoutMs: number,
  label: string
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last!: T;
  while (Date.now() < deadline) {
    last = await read();
    if (accept(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${label}: ${JSON.stringify(last)}`);
}

export class MediaProbe {
  private serviceWorker: Worker;
  private readonly context: BrowserContext;

  constructor(context: BrowserContext, serviceWorker: Worker) {
    this.context = context;
    this.serviceWorker = serviceWorker;
  }

  async evaluateWorker<T, A>(
    pageFunction: (arg: A) => T | Promise<T>,
    arg: A
  ): Promise<T> {
    const evaluate = (worker: Worker) =>
      (
        worker.evaluate as unknown as (
          fn: (value: A) => T | Promise<T>,
          value: A
        ) => Promise<T>
      )(pageFunction, arg);
    try {
      return await evaluate(this.serviceWorker);
    } catch (firstError) {
      const replacement =
        this.context
          .serviceWorkers()
          .find(
            (worker) =>
              worker.url().startsWith("chrome-extension://") &&
              worker !== this.serviceWorker
          ) ??
        (await this.context
          .waitForEvent("serviceworker", {
            predicate: (worker) =>
              worker.url().startsWith("chrome-extension://"),
            timeout: 2_000,
          })
          .catch(() => undefined));
      if (!replacement || replacement === this.serviceWorker) throw firstError;
      this.serviceWorker = replacement;
      return evaluate(this.serviceWorker);
    }
  }

  async activeSession(): Promise<RecordingSession | undefined> {
    return this.evaluateWorker(async () => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("web-bug-recorder");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const active = await new Promise<{ sessionId?: string } | undefined>(
          (resolve, reject) => {
            const request = database
              .transaction("control")
              .objectStore("control")
              .get("active-session");
            request.onsuccess = () =>
              resolve(request.result as { sessionId?: string } | undefined);
            request.onerror = () => reject(request.error);
          }
        );
        if (!active?.sessionId) return undefined;
        return await new Promise<RecordingSession | undefined>(
          (resolve, reject) => {
            const request = database
              .transaction("sessions")
              .objectStore("sessions")
              .get(active.sessionId!);
            request.onsuccess = () =>
              resolve(request.result as RecordingSession | undefined);
            request.onerror = () => reject(request.error);
          }
        );
      } finally {
        database.close();
      }
    }, undefined);
  }

  async getSession(sessionId: string): Promise<RecordingSession | undefined> {
    return this.evaluateWorker(async (id) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("web-bug-recorder");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise<RecordingSession | undefined>(
          (resolve, reject) => {
            const request = database
              .transaction("sessions")
              .objectStore("sessions")
              .get(id);
            request.onsuccess = () =>
              resolve(request.result as RecordingSession | undefined);
            request.onerror = () => reject(request.error);
          }
        );
      } finally {
        database.close();
      }
    }, sessionId);
  }

  async waitForSessionStatus(
    sessionId: string,
    expectedStatus: string,
    timeoutMs = 10_000
  ): Promise<RecordingSession> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const session = await this.getSession(sessionId);
      if (session?.status === expectedStatus) {
        return session;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(
      `Session ${sessionId} status did not reach ${expectedStatus} within ${timeoutMs}ms`
    );
  }

  async sessionCount(): Promise<number> {
    return this.evaluateWorker(async () => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("web-bug-recorder");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise<number>((resolve, reject) => {
          const request = database
            .transaction("sessions")
            .objectStore("sessions")
            .count();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      } finally {
        database.close();
      }
    }, undefined);
  }

  async mediaChunkCount(sessionId: string): Promise<number> {
    return this.evaluateWorker(async (id) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("web-bug-recorder");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise<number>((resolve, reject) => {
          const request = database
            .transaction("mediaChunks")
            .objectStore("mediaChunks")
            .index("sessionId")
            .count(id);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      } finally {
        database.close();
      }
    }, sessionId);
  }

  async exportArtifact(
    sessionId: string
  ): Promise<
    import("../../src/shared/protocol.ts").ExportArtifact | undefined
  > {
    return this.evaluateWorker(async (id) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("web-bug-recorder");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise<
          import("../../src/shared/protocol.ts").ExportArtifact | undefined
        >((resolve, reject) => {
          const request = database
            .transaction("exportArtifacts")
            .objectStore("exportArtifacts")
            .get(id);
          request.onsuccess = () => resolve(request.result as any);
          request.onerror = () => reject(request.error);
        });
      } finally {
        database.close();
      }
    }, sessionId);
  }

  async waitForMediaChunkCountGreaterThan(
    sessionId: string,
    baseline: number,
    timeoutMs = 5_000
  ): Promise<number> {
    return poll(
      () => this.mediaChunkCount(sessionId),
      (count) => count > baseline,
      timeoutMs,
      `MEDIA_CHUNK_COUNT_TIMEOUT: sessionId=${sessionId} baseline=${baseline}`
    );
  }

  /**
   * 查询最近一次静默导出下载。Playwright 会把扩展后台（Service Worker）
   * 发起的下载重定向到 test-results 下的 .playwright-artifacts 目录（UUID
   * 文件名、去掉扩展名），因此匹配条件需兼容 .zip 后缀与 artifacts 重定向
   * 路径两种形态。
   */
  async latestExportDownload(): Promise<
    { filename: string; state: string; totalBytes?: number } | undefined
  > {
    return this.evaluateWorker(async () => {
      const items = await chrome.downloads.search({
        limit: 10,
        orderBy: ["-startTime"],
      });
      const completed = items.filter(
        (item) =>
          item.state === "complete" &&
          (item.totalBytes ?? 0) > 0 &&
          (item.filename?.toLowerCase().endsWith(".zip") ||
            item.filename?.includes(".playwright-artifacts"))
      );
      const zip = completed.find((item) =>
        item.filename?.toLowerCase().endsWith(".zip")
      );
      const pick = zip ?? completed[0];
      return pick
        ? {
            filename: pick.filename ?? "",
            state: pick.state ?? "",
            totalBytes: pick.totalBytes,
          }
        : undefined;
    }, undefined);
  }

  /**
   * 原始下载列表（诊断用）：返回最近 10 条 chrome.downloads 记录。
   */
  async rawDownloads(): Promise<
    Array<{
      filename?: string;
      state?: string;
      error?: string;
      totalBytes?: number;
    }>
  > {
    return this.evaluateWorker(async () => {
      const items = await chrome.downloads.search({
        limit: 10,
        orderBy: ["-startTime"],
      });
      return items.map((item) => ({
        filename: item.filename,
        state: item.state,
        error: item.error,
        totalBytes: item.totalBytes,
      }));
    }, undefined);
  }

  /** 轮询直到静默导出证据包下载完成（默认 15s）。 */
  async waitForExportDownload(
    timeoutMs = 15_000
  ): Promise<{ filename: string; state: string; totalBytes?: number }> {
    const deadline = Date.now() + timeoutMs;
    let last:
      { filename: string; state: string; totalBytes?: number } | undefined;
    while (Date.now() < deadline) {
      last = await this.latestExportDownload();
      if (last && last.state === "complete") return last;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(
      `SILENT_EXPORT_DOWNLOAD_TIMEOUT: ${JSON.stringify(last)}; all=${JSON.stringify(await this.rawDownloads())}`
    );
  }

  async getBadgeText(tabId: number): Promise<string> {
    return this.evaluateWorker(async (targetId) => {
      return chrome.action.getBadgeText({ tabId: targetId });
    }, tabId);
  }

  async isOffscreenRecording(sessionId: string): Promise<boolean> {
    return this.evaluateWorker(async (id) => {
      const contexts = await (
        chrome.runtime.getContexts as unknown as (
          filter: unknown
        ) => Promise<chrome.runtime.ExtensionContext[]>
      )({ contextTypes: ["OFFSCREEN_DOCUMENT"] }).catch(() => []);
      if (!contexts.length) return false;
      const response = await chrome.runtime.sendMessage({
        protocolVersion: 3,
        messageId: crypto.randomUUID(),
        type: "offscreen/status",
        sessionId: id,
        payload: { sessionId: id },
        sentAt: Date.now(),
      });
      if (!response?.ok)
        throw new Error(
          `OFFSCREEN_STATUS_FAILED: ${response?.error ?? "Recorder 状态查询失败"}`
        );
      return Boolean(response.active);
    }, sessionId);
  }

  async isOverlayRemoved(targetPage: Page): Promise<boolean> {
    if (targetPage.isClosed()) return true;
    return targetPage.evaluate(() => {
      return (
        !document.querySelector("#__wbr_stop_btn__") &&
        !document.querySelector("#__wbr_overlay_container__")
      );
    });
  }

  async snapshot(
    sessionId: string,
    targetTabId: number
  ): Promise<MediaSnapshot> {
    const [session, captures, offscreen] = await Promise.all([
      this.activeSession(),
      this.evaluateWorker(
        async () => chrome.tabCapture.getCapturedTabs(),
        undefined
      ) as Promise<CapturedTab[]>,
      this.evaluateWorker(
        async () => chrome.offscreen.hasDocument(),
        undefined
      ),
    ]);
    return {
      session,
      capture: captures.find((entry) => entry.tabId === targetTabId),
      offscreenActive: offscreen,
    };
  }

  async waitForSession(
    targetTabId: number,
    timeoutMs = 5_000
  ): Promise<RecordingSession> {
    const session = await poll(
      () => this.activeSession(),
      (value) =>
        Boolean(
          value &&
          value.target.tabId === targetTabId &&
          value.status !== "PREPARING"
        ),
      timeoutMs,
      "SESSION_START_TIMEOUT"
    );
    if (!session) throw new Error("SESSION_START_TIMEOUT: 未找到活动会话");
    return session;
  }

  async waitForActive(
    sessionId: string,
    targetTabId: number,
    timeoutMs = 5_000
  ): Promise<MediaSnapshot> {
    return poll(
      async () => {
        const current = await this.snapshot(sessionId, targetTabId);
        const mediaIssue = current.session?.quality.issues.find((entry) =>
          ["MEDIA_STREAM_ID_FAILED", "MEDIA_RECORDER_FAILED"].includes(
            entry.code
          )
        );
        if (mediaIssue)
          throw new Error(`${mediaIssue.code}: ${mediaIssue.message}`);
        return current;
      },
      (value) =>
        value.session?.id === sessionId &&
        value.capture?.status === "active" &&
        value.offscreenActive,
      timeoutMs,
      "TAB_CAPTURE_NOT_ACTIVE"
    );
  }

  async waitForStopped(
    sessionId: string,
    targetTabId: number,
    timeoutMs = 10_000
  ): Promise<MediaSnapshot> {
    return poll(
      () => this.snapshot(sessionId, targetTabId),
      (value) =>
        value.capture?.status !== "active" &&
        value.capture?.status !== "pending" &&
        !value.offscreenActive,
      timeoutMs,
      "MEDIA_STOP_TIMEOUT"
    );
  }

  async persistedEvidence(
    sessionIdOrPage: Page | string,
    maybeSessionId?: string
  ): Promise<PersistedEvidence> {
    const idParam =
      typeof sessionIdOrPage === "string" ? sessionIdOrPage : maybeSessionId!;
    return this.evaluateWorker(async (id) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("web-bug-recorder");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const getSession = new Promise<RecordingSession | undefined>(
        (resolve, reject) => {
          const request = database
            .transaction("sessions")
            .objectStore("sessions")
            .get(id);
          request.onsuccess = () =>
            resolve(request.result as RecordingSession | undefined);
          request.onerror = () => reject(request.error);
        }
      );
      const getAll = <T>(storeName: string): Promise<T[]> =>
        new Promise((resolve, reject) => {
          const request = database
            .transaction(storeName)
            .objectStore(storeName)
            .index("sessionId")
            .getAll(id);
          request.onsuccess = () => resolve((request.result ?? []) as T[]);
          request.onerror = () => reject(request.error);
        });
      const [
        session,
        chunks,
        interactions,
        consoleEntries,
        networkEntries,
        assets,
      ] = await Promise.all([
        getSession,
        getAll<{ sequence: number; mimeType: string; chunk: ArrayBuffer }>(
          "mediaChunks"
        ),
        getAll<InteractionRecordSummary>("interactions"),
        getAll<EvidenceItemWithTimestamp>("consoleEntries"),
        getAll<EvidenceItemWithTimestamp>("networkEntries"),
        getAll<{
          id: string;
          kind: string;
          mimeType: string;
          bytes: ArrayBuffer;
          width?: number;
          height?: number;
          sessionId?: string;
          issueSceneId?: string;
          interactionId?: string;
        }>("evidenceAssets"),
      ]);
      database.close();
      return {
        session,
        mediaChunks: chunks
          .map((entry) => ({
            sequence: entry.sequence,
            mimeType: entry.mimeType,
            byteLength: entry.chunk?.byteLength ?? 0,
          }))
          .sort((left, right) => left.sequence - right.sequence),
        interactionCount: interactions.length,
        consoleCount: consoleEntries.length,
        networkCount: networkEntries.length,
        interactions,
        consoleEntries,
        networkEntries,
        evidenceAssets: assets.map((asset) => ({
          id: asset.id,
          kind: asset.kind,
          mimeType: asset.mimeType,
          byteLength: asset.bytes?.byteLength ?? 0,
          width: asset.width,
          height: asset.height,
          sessionId: asset.sessionId,
          issueSceneId: asset.issueSceneId,
          interactionId: asset.interactionId,
        })),
      };
    }, idParam);
  }

  async persistedFullEvidence(sessionId: string): Promise<{
    session?: RecordingSession;
    mediaChunks: Array<{
      sequence: number;
      mimeType: string;
      byteLength: number;
    }>;
    interactions: import("../../src/shared/protocol.ts").InteractionRecord[];
    consoleEntries: import("../../src/shared/protocol.ts").ConsoleEntry[];
    networkEntries: import("../../src/shared/protocol.ts").NetworkEntry[];
    issueScenes: import("../../src/shared/protocol.ts").IssueScene[];
    evidenceAssets: EvidenceAssetSummary[];
  }> {
    return this.evaluateWorker(async (id) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("web-bug-recorder");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const getSession = new Promise<RecordingSession | undefined>(
          (resolve, reject) => {
            const request = database
              .transaction("sessions")
              .objectStore("sessions")
              .get(id);
            request.onsuccess = () =>
              resolve(request.result as RecordingSession | undefined);
            request.onerror = () => reject(request.error);
          }
        );
        const getAll = <T>(storeName: string): Promise<T[]> =>
          new Promise((resolve, reject) => {
            const request = database
              .transaction(storeName)
              .objectStore(storeName)
              .index("sessionId")
              .getAll(id);
            request.onsuccess = () => resolve((request.result ?? []) as T[]);
            request.onerror = () => reject(request.error);
          });
        const [
          session,
          chunks,
          interactions,
          consoleEntries,
          networkEntries,
          assets,
          issueScenes,
        ] = await Promise.all([
          getSession,
          getAll<{ sequence: number; mimeType: string; chunk: ArrayBuffer }>(
            "mediaChunks"
          ),
          getAll<import("../../src/shared/protocol.ts").InteractionRecord>(
            "interactions"
          ),
          getAll<import("../../src/shared/protocol.ts").ConsoleEntry>(
            "consoleEntries"
          ),
          getAll<import("../../src/shared/protocol.ts").NetworkEntry>(
            "networkEntries"
          ),
          getAll<{
            id: string;
            kind: string;
            mimeType: string;
            bytes: ArrayBuffer;
            width?: number;
            height?: number;
            sessionId?: string;
            issueSceneId?: string;
            interactionId?: string;
          }>("evidenceAssets"),
          getAll<import("../../src/shared/protocol.ts").IssueScene>(
            "issueScenes"
          ),
        ]);
        return {
          session,
          mediaChunks: chunks
            .map((entry) => ({
              sequence: entry.sequence,
              mimeType: entry.mimeType,
              byteLength: entry.chunk?.byteLength ?? 0,
            }))
            .sort((left, right) => left.sequence - right.sequence),
          interactions,
          consoleEntries,
          networkEntries,
          issueScenes,
          evidenceAssets: assets.map((asset) => ({
            id: asset.id,
            kind: asset.kind,
            mimeType: asset.mimeType,
            byteLength: asset.bytes?.byteLength ?? 0,
            width: asset.width,
            height: asset.height,
            sessionId: asset.sessionId,
            issueSceneId: asset.issueSceneId,
            interactionId: asset.interactionId,
          })),
        };
      } finally {
        database.close();
      }
    }, sessionId);
  }

  async waitForEvidenceCounts(
    sessionId: string,
    minCounts: {
      networkCount?: number;
      interactionCount?: number;
      consoleCount?: number;
      issueSceneCount?: number;
    },
    timeoutMs = 5_000
  ): Promise<void> {
    await poll(
      async () => {
        const full = await this.persistedFullEvidence(sessionId);
        const netOk =
          minCounts.networkCount == null ||
          full.networkEntries.length >= minCounts.networkCount;
        const intOk =
          minCounts.interactionCount == null ||
          full.interactions.length >= minCounts.interactionCount;
        const conOk =
          minCounts.consoleCount == null ||
          full.consoleEntries.length >= minCounts.consoleCount;
        const sceneOk =
          minCounts.issueSceneCount == null ||
          (full.issueScenes?.length ?? 0) >= minCounts.issueSceneCount;
        return netOk && intOk && conOk && sceneOk;
      },
      Boolean,
      timeoutMs,
      `EVIDENCE_COUNTS_TIMEOUT: sessionId=${sessionId}`
    );
  }

  async getEvidenceAssetBytes(
    assetId: string
  ): Promise<
    { mimeType: string; bytes: ArrayBuffer; byteLength: number } | undefined
  > {
    const raw = await this.evaluateWorker(async (id) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("web-bug-recorder");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const asset = await new Promise<
          { mimeType: string; bytes: ArrayBuffer } | undefined
        >((resolve, reject) => {
          const request = database
            .transaction("evidenceAssets")
            .objectStore("evidenceAssets")
            .get(id);
          request.onsuccess = () =>
            resolve(
              request.result as
                { mimeType: string; bytes: ArrayBuffer } | undefined
            );
          request.onerror = () => reject(request.error);
        });
        if (!asset || !asset.bytes) return undefined;
        return {
          mimeType: asset.mimeType,
          byteLength: asset.bytes.byteLength ?? 0,
          byteArray: Array.from(new Uint8Array(asset.bytes)),
        };
      } finally {
        database.close();
      }
    }, assetId);
    if (!raw) return undefined;
    const uint8 = Uint8Array.from(raw.byteArray);
    return {
      mimeType: raw.mimeType,
      bytes: uint8.buffer,
      byteLength: raw.byteLength,
    };
  }
}
