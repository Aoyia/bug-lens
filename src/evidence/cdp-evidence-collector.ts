import {
  networkDurationMs,
  networkRequestTime,
} from "../domain/evidence-clock.ts";
import {
  deriveCacheEvidence,
  sliceInitiator,
  type CdpInitiator,
} from "../domain/initiator-slicer.ts";
import {
  sanitizeConsoleEntry,
  sanitizeHeaders,
  sanitizeResponseBody,
  sanitizeText,
  sanitizeUrl,
} from "../domain/privacy-policy.ts";
import type { RecordingSessionEvent } from "../domain/recording-session.ts";
import type { EvidenceRepository } from "../storage/db.ts";
import { RECORDING_STATUSES } from "../shared/protocol.ts";
import type { CaptureIssue, RecordingSession } from "../shared/protocol.ts";

type SessionEventWriter = (
  sessionId: string,
  event: RecordingSessionEvent
) => Promise<RecordingSession>;

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  messageText: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(messageText)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

const TEXTUAL_MIME_PATTERNS = [
  /^application\/json/i,
  /^application\/.*xml/i,
  /^application\/javascript/i,
  /^application\/x-javascript/i,
  /^text\//i,
  /^application\/x-www-form-urlencoded/i,
];

export function shouldCaptureResponseBody(
  mimeType?: string,
  url?: string
): boolean {
  if (!mimeType) {
    if (url) {
      const lowerUrl = url.toLowerCase();
      if (
        /\.(png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|mp4|webm|mp3|zip|pdf|gz)$/i.test(
          lowerUrl
        )
      ) {
        return false;
      }
    }
    return true;
  }
  return TEXTUAL_MIME_PATTERNS.some((pattern) => pattern.test(mimeType));
}

function captureIssue(
  code: string,
  message: string,
  source: CaptureIssue["source"] = "debugger"
): CaptureIssue {
  return { code, message, source, recoverable: true, occurredAt: Date.now() };
}

function sanitizeRequestBody(postData: string, mode: "safe" | "raw"): string {
  if (mode === "raw") return postData;
  if (/^[\s]*[\[{]/.test(postData)) {
    const sanitized = sanitizeResponseBody({
      body: postData,
      base64Encoded: false,
      mode,
    });
    if (sanitized.body) return sanitized.body;
  }
  return sanitizeText(postData, mode);
}

export class CdpEvidenceCollector {
  private readonly attachedTabs = new Set<number>();
  private readonly pendingBodyCaptures = new Set<Promise<void>>();
  private readonly eventQueues = new Map<string, Promise<void>>();
  private readonly pendingHandlers = new Set<Promise<void>>();
  private readonly memoryCacheRequests = new Set<string>();

  private readonly repository: EvidenceRepository;
  private readonly writeSessionEvent: SessionEventWriter;
  private readonly isStopping: (sessionId: string) => boolean;

  constructor(
    repository: EvidenceRepository,
    writeSessionEvent: SessionEventWriter,
    isStopping: (sessionId: string) => boolean
  ) {
    this.repository = repository;
    this.writeSessionEvent = writeSessionEvent;
    this.isStopping = isStopping;
  }

  private readonly reattachTimers = new Map<
    number,
    ReturnType<typeof setTimeout>
  >();

  markAttached(tabId: number): void {
    this.cancelReattach(tabId);
    this.attachedTabs.add(tabId);
  }

  async verifyOwnership(tabId: number): Promise<boolean> {
    try {
      await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
        expression: "1",
      });
      this.cancelReattach(tabId);
      this.attachedTabs.add(tabId);
      return true;
    } catch {
      this.attachedTabs.delete(tabId);
      return false;
    }
  }

  async attach(
    tabId: number,
    session: RecordingSession
  ): Promise<CaptureIssue | undefined> {
    try {
      await chrome.debugger.attach({ tabId }, "1.3");
      this.cancelReattach(tabId);
      this.attachedTabs.add(tabId);
      if (session.options.captureConsole) {
        await chrome.debugger.sendCommand({ tabId }, "Runtime.enable");
        await chrome.debugger
          .sendCommand({ tabId }, "Log.enable")
          .catch(() => undefined);
      }
      if (session.options.captureNetwork) {
        await chrome.debugger
          .sendCommand({ tabId }, "Network.enable", {
            maxTotalBufferSize: 50 * 1024 * 1024,
            maxResourceBufferSize: 10 * 1024 * 1024,
            maxPostDataSize: 1024 * 1024,
          })
          .catch(() => undefined);
      }
      return undefined;
    } catch (error) {
      return captureIssue(
        "DEBUGGER_ATTACH_FAILED",
        sanitizeText(String(error), session.options.privacyMode)
      );
    }
  }

  async detach(tabId: number): Promise<void> {
    this.cancelReattach(tabId);
    this.attachedTabs.delete(tabId);
    await chrome.debugger.detach({ tabId }).catch(() => undefined);
  }

  handleEvent(
    source: chrome.debugger.Debuggee,
    method: string,
    params?: object
  ): void {
    const tabId = source.tabId;
    if (typeof tabId !== "number") return;
    const task = this.processEvent(source, tabId, method, params);
    this.pendingHandlers.add(task);
    void task.then(
      () => this.pendingHandlers.delete(task),
      () => this.pendingHandlers.delete(task)
    );
  }

  async handleDetach(
    source: chrome.debugger.Debuggee,
    reason: string,
    onReattachSuccess?: () => void
  ): Promise<void> {
    if (typeof source.tabId !== "number") return;
    const tabId = source.tabId;
    this.attachedTabs.delete(tabId);
    this.cancelReattach(tabId);
    if (reason === "target_closed") return;

    const session = await this.repository.getActiveSession();
    if (
      !session ||
      session.status === "STOPPING" ||
      this.isStopping(session.id) ||
      session.target.tabId !== tabId
    )
      return;
    await this.writeSessionEvent(session.id, {
      type: "capture-issue",
      issue: captureIssue("DEBUGGER_DETACHED_BY_DEVTOOLS", reason),
    });
    this.scheduleReattach(tabId, session, 2000, onReattachSuccess);
  }

  private scheduleReattach(
    tabId: number,
    session: RecordingSession,
    delayMs: number,
    onReattachSuccess?: () => void
  ): void {
    if (this.reattachTimers.has(tabId))
      clearTimeout(this.reattachTimers.get(tabId));
    const timer = setTimeout(async () => {
      this.reattachTimers.delete(tabId);
      const current = await this.repository.getActiveSession();
      if (
        !current ||
        current.id !== session.id ||
        current.status === "STOPPING" ||
        this.isStopping(current.id)
      )
        return;
      const targets = await chrome.debugger.getTargets().catch(() => []);
      const target = targets.find((t) => t.tabId === tabId);
      if (target?.attached && this.attachedTabs.has(tabId)) {
        return;
      }
      if (target?.attached && !this.attachedTabs.has(tabId)) {
        const nextDelay = Math.min(delayMs * 2, 10000);
        this.scheduleReattach(tabId, current, nextDelay, onReattachSuccess);
        return;
      }
      const attachError = await this.attach(tabId, current);
      if (attachError) {
        const nextDelay = Math.min(delayMs * 2, 10000);
        this.scheduleReattach(tabId, current, nextDelay, onReattachSuccess);
      } else {
        onReattachSuccess?.();
      }
    }, delayMs);
    this.reattachTimers.set(tabId, timer);
  }

  cancelReattach(tabId?: number): void {
    if (typeof tabId === "number") {
      const timer = this.reattachTimers.get(tabId);
      if (timer) {
        clearTimeout(timer);
        this.reattachTimers.delete(tabId);
      }
    } else {
      for (const timer of this.reattachTimers.values()) clearTimeout(timer);
      this.reattachTimers.clear();
    }
  }

  async drain(): Promise<string[]> {
    const errors: string[] = [];
    for (let round = 0; round < 3 && this.pendingHandlers.size; round += 1) {
      const results = await Promise.allSettled([...this.pendingHandlers]);
      for (const result of results)
        if (result.status === "rejected")
          errors.push(`调试事件写入未完成：${String(result.reason)}`);
    }
    for (let round = 0; round < 3 && this.eventQueues.size; round += 1) {
      const results = await Promise.allSettled([...this.eventQueues.values()]);
      for (const result of results)
        if (result.status === "rejected")
          errors.push(`Network 写入未完成：${String(result.reason)}`);
    }
    return errors;
  }

  async finalizeNetworkBodies(session: RecordingSession): Promise<void> {
    if (!session.options.captureNetworkBodies) return;
    for (
      let round = 0;
      round < 3 && this.pendingBodyCaptures.size;
      round += 1
    ) {
      await Promise.allSettled([...this.pendingBodyCaptures]);
    }

    const pending = (await this.repository.getNetwork(session.id)).filter(
      (entry) => entry.response?.bodyStatus === "pending"
    );
    let cursor = 0;
    const deadline = Date.now() + 5_000;
    const workers = Array.from(
      { length: Math.min(4, pending.length) },
      async () => {
        while (cursor < pending.length && Date.now() < deadline) {
          const entry = pending[cursor++];
          const requestId = entry.id.startsWith(`${session.id}:`)
            ? entry.id.slice(session.id.length + 1)
            : "";
          if (requestId)
            await this.captureResponseBody(
              { tabId: session.target.tabId },
              session,
              requestId
            );
        }
      }
    );
    await Promise.allSettled(workers);

    const unresolved = (await this.repository.getNetwork(session.id)).filter(
      (entry) => entry.response?.bodyStatus === "pending"
    );
    await Promise.all(
      unresolved.map((entry) =>
        this.repository.updateNetworkEntry(entry.id, (current) => ({
          ...current,
          response: {
            ...current.response,
            bodyStatus: "unavailable",
            error:
              "RESPONSE_BODY_INCOMPLETE: 录制结束前未收到完整响应或浏览器未提供正文",
          },
        }))
      )
    );
  }

  private enqueue(key: string, work: () => Promise<void>): Promise<void> {
    const previous = this.eventQueues.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(work);
    this.eventQueues.set(key, current);
    void current.then(
      () => {
        if (this.eventQueues.get(key) === current) this.eventQueues.delete(key);
      },
      () => {
        if (this.eventQueues.get(key) === current) this.eventQueues.delete(key);
      }
    );
    return current;
  }

  private trackBodyCapture(task: Promise<void>): void {
    this.pendingBodyCaptures.add(task);
    void task.then(
      () => this.pendingBodyCaptures.delete(task),
      () => this.pendingBodyCaptures.delete(task)
    );
  }

  private async captureResponseBody(
    source: chrome.debugger.Debuggee,
    session: RecordingSession,
    requestId: string
  ): Promise<void> {
    const id = `${session.id}:${requestId}`;
    const current = await this.repository.getNetworkEntry(id);
    if (!current) return;
    if (
      current.method === "HEAD" ||
      current.status === 204 ||
      current.status === 304
    ) {
      await this.repository.updateNetworkEntry(id, (entry) => ({
        ...entry,
        response: { ...entry.response, bodyStatus: "not-present" },
      }));
      return;
    }

    const resType = (current.type || "").toLowerCase();
    const mime = (current.response?.mimeType || "").toLowerCase();
    const isStaticResource =
      [
        "script",
        "stylesheet",
        "image",
        "media",
        "font",
        "other",
        "manifest",
      ].includes(resType) ||
      mime.includes("javascript") ||
      mime.includes("css") ||
      mime.startsWith("image/") ||
      mime.startsWith("font/") ||
      mime.startsWith("audio/") ||
      mime.startsWith("video/");

    if (isStaticResource && !session.options.captureStaticBodies) {
      await this.repository.updateNetworkEntry(id, (entry) => ({
        ...entry,
        response: { ...entry.response, bodyStatus: "not-present" },
      }));
      return;
    }

    try {
      const command = chrome.debugger.sendCommand(
        source,
        "Network.getResponseBody",
        { requestId }
      ) as Promise<{ body?: string; base64Encoded?: boolean }>;
      const result = await withTimeout(
        command,
        3_000,
        "RESPONSE_BODY_TIMEOUT: 响应正文读取超过 3 秒"
      );
      const rawBody = result.body ?? "";
      const base64Encoded = Boolean(result.base64Encoded);
      const sanitized = sanitizeResponseBody({
        body: rawBody,
        base64Encoded,
        mimeType: current.response?.mimeType,
        resourceType: current.type,
        mode: session.options.privacyMode,
        maxBytes: session.options.maxResponseBodyBytes,
      });
      const stored = await this.repository.updateNetworkEntryWithinBudget(
        id,
        (entry) => ({ ...entry, response: { ...entry.response, ...sanitized } })
      );
      if (!stored.stored)
        await this.writeSessionEvent(session.id, {
          type: "capture-issue",
          issue: captureIssue(
            "SESSION_STORAGE_LIMIT_REACHED",
            "已达到会话存储上限，未保存更多 Network 正文。",
            "storage"
          ),
        });
    } catch (error) {
      await this.repository.updateNetworkEntry(id, (entry) => ({
        ...entry,
        response: {
          ...entry.response,
          bodyStatus: "unavailable",
          error: sanitizeText(String(error), session.options.privacyMode),
        },
      }));
    }
  }

  private async processEvent(
    source: chrome.debugger.Debuggee,
    tabId: number,
    method: string,
    params?: object
  ): Promise<void> {
    const session = await this.repository.getActiveSession();
    if (
      !session ||
      !RECORDING_STATUSES.includes(session.status) ||
      this.isStopping(session.id) ||
      session.target.tabId !== tabId
    )
      return;

    if (
      session.options.captureConsole &&
      method === "Runtime.consoleAPICalled"
    ) {
      const value = params as {
        type?: string;
        args?: Array<{ value?: unknown; description?: string }>;
        timestamp?: number;
      };
      const stored = await this.repository.saveConsoleWithinBudget(
        sanitizeConsoleEntry(
          {
            id: crypto.randomUUID(),
            sessionId: session.id,
            createdAt:
              value.timestamp != null
                ? Math.round(value.timestamp * 1000)
                : Date.now(),
            level: value.type ?? "log",
            text: (value.args ?? [])
              .map((arg) =>
                typeof arg.value === "string"
                  ? arg.value
                  : (arg.description ?? String(arg.value ?? ""))
              )
              .join(" "),
          },
          session.options.privacyMode
        )
      );
      if (stored.stored)
        await this.writeSessionEvent(session.id, {
          type: "quality-delta",
          delta: { consoleEntryCount: 1 },
        });
      else
        await this.writeSessionEvent(session.id, {
          type: "capture-issue",
          issue: captureIssue(
            "SESSION_STORAGE_LIMIT_REACHED",
            "已达到会话存储上限，未保存更多 Console 日志。",
            "storage"
          ),
        });
      return;
    }

    if (
      session.options.captureConsole &&
      method === "Runtime.exceptionThrown"
    ) {
      const value = params as {
        timestamp?: number;
        exceptionDetails?: {
          text?: string;
          url?: string;
          exception?: { description?: string };
        };
      };
      const details = value.exceptionDetails;
      const stored = await this.repository.saveConsoleWithinBudget(
        sanitizeConsoleEntry(
          {
            id: crypto.randomUUID(),
            sessionId: session.id,
            createdAt:
              value.timestamp != null
                ? Math.round(value.timestamp * 1000)
                : Date.now(),
            level: "error",
            text:
              details?.exception?.description ?? details?.text ?? "未捕获异常",
            source: details?.url,
          },
          session.options.privacyMode
        )
      );
      if (stored.stored)
        await this.writeSessionEvent(session.id, {
          type: "quality-delta",
          delta: { consoleEntryCount: 1 },
        });
      else
        await this.writeSessionEvent(session.id, {
          type: "capture-issue",
          issue: captureIssue(
            "SESSION_STORAGE_LIMIT_REACHED",
            "已达到会话存储上限，未保存更多 Console 日志。",
            "storage"
          ),
        });
      return;
    }

    if (session.options.captureConsole && method === "Log.entryAdded") {
      const value = params as {
        entry?: {
          timestamp?: number;
          level?: string;
          text?: string;
          url?: string;
        };
      };
      if (!value.entry) return;
      const stored = await this.repository.saveConsoleWithinBudget(
        sanitizeConsoleEntry(
          {
            id: crypto.randomUUID(),
            sessionId: session.id,
            createdAt:
              value.entry.timestamp != null
                ? Math.round(value.entry.timestamp * 1000)
                : Date.now(),
            level: value.entry.level ?? "info",
            text: value.entry.text ?? "",
            source: value.entry.url,
          },
          session.options.privacyMode
        )
      );
      if (stored.stored)
        await this.writeSessionEvent(session.id, {
          type: "quality-delta",
          delta: { consoleEntryCount: 1 },
        });
      else
        await this.writeSessionEvent(session.id, {
          type: "capture-issue",
          issue: captureIssue(
            "SESSION_STORAGE_LIMIT_REACHED",
            "已达到会话存储上限，未保存更多 Console 日志。",
            "storage"
          ),
        });
      return;
    }

    if (
      session.options.captureNetwork &&
      method === "Network.requestServedFromCache"
    ) {
      const reqId = (params as { requestId?: string })?.requestId;
      if (reqId) this.memoryCacheRequests.add(`${tabId}:${reqId}`);
      return;
    }

    if (
      session.options.captureNetwork &&
      method === "Network.requestWillBeSent"
    ) {
      const value = params as {
        request?: {
          url?: string;
          method?: string;
          headers?: Record<string, string>;
          postData?: string;
        };
        initiator?: CdpInitiator;
        type?: string;
        timestamp?: number;
        wallTime?: number;
        requestId?: string;
      };
      if (!value.request?.url) return;
      const requestId = value.requestId ?? crypto.randomUUID();
      await this.enqueue(`${tabId}:${requestId}`, async () => {
        const timing = networkRequestTime({
          timestamp: value.timestamp,
          wallTime: value.wallTime,
        });
        const rawInitiator = value.initiator;
        const conciseInitiator = sliceInitiator(
          rawInitiator,
          session.options.privacyMode
        );
        const stored = await this.repository.saveNetworkWithinBudget({
          id: `${session.id}:${requestId}`,
          sessionId: session.id,
          createdAt: timing.createdAtEpochMs,
          startedAtMonotonicMs: timing.startedAtMonotonicMs,
          url: sanitizeUrl(value.request!.url!, session.options.privacyMode),
          method: value.request!.method ?? "GET",
          type: value.type,
          initiator: rawInitiator
            ? {
                type: rawInitiator.type || "other",
                url: rawInitiator.url,
                lineNumber: rawInitiator.lineNumber,
                columnNumber: rawInitiator.columnNumber,
                concise: conciseInitiator,
              }
            : undefined,
          requestHeaders: value.request?.headers
            ? sanitizeHeaders(
                value.request.headers,
                session.options.privacyMode
              )
            : undefined,
          requestBody: value.request?.postData
            ? sanitizeRequestBody(
                value.request.postData,
                session.options.privacyMode
              )
            : undefined,
        });
        if (stored.stored)
          await this.writeSessionEvent(session.id, {
            type: "quality-delta",
            delta: { networkEntryCount: 1 },
          });
        else
          await this.writeSessionEvent(session.id, {
            type: "capture-issue",
            issue: captureIssue(
              "SESSION_STORAGE_LIMIT_REACHED",
              "已达到会话存储上限，未保存更多 Network 记录。",
              "storage"
            ),
          });
      });
      return;
    }

    if (!session.options.captureNetwork) return;

    const requestId = (params as { requestId?: string })?.requestId;
    if (!requestId) return;
    const id = `${session.id}:${requestId}`;
    if (method === "Network.responseReceived") {
      const value = params as {
        response?: {
          status?: number;
          mimeType?: string;
          headers?: Record<string, unknown>;
          protocol?: string;
          fromDiskCache?: boolean;
          fromServiceWorker?: boolean;
          fromPrefetchCache?: boolean;
        };
      };
      const servedFromMemory = this.memoryCacheRequests.has(
        `${tabId}:${requestId}`
      );
      const cacheEvidence = deriveCacheEvidence(
        {
          fromDiskCache: value.response?.fromDiskCache,
          fromServiceWorker: value.response?.fromServiceWorker,
          fromPrefetchCache: value.response?.fromPrefetchCache,
          status: value.response?.status,
          protocol: value.response?.protocol,
        },
        servedFromMemory
      );

      await this.enqueue(`${tabId}:${requestId}`, () =>
        this.repository
          .updateNetworkEntry(id, (current) => ({
            ...current,
            status: value.response?.status,
            response: {
              mimeType: value.response?.mimeType,
              headers: sanitizeHeaders(
                value.response?.headers,
                session.options.privacyMode
              ),
              bodyStatus: "pending",
              cache: cacheEvidence,
            },
          }))
          .then(() => undefined)
      );
    } else if (method === "Network.loadingFinished") {
      const value = params as { timestamp?: number };
      this.memoryCacheRequests.delete(`${tabId}:${requestId}`);
      this.trackBodyCapture(
        this.enqueue(`${tabId}:${requestId}`, async () => {
          await this.repository.updateNetworkEntry(id, (current) => ({
            ...current,
            durationMs: networkDurationMs(
              current.startedAtMonotonicMs,
              value.timestamp
            ),
          }));
          if (session.options.captureNetworkBodies) {
            const entry = (await this.repository.getNetwork(session.id)).find(
              (item) => item.id === id
            );
            if (
              entry &&
              !shouldCaptureResponseBody(entry.response?.mimeType, entry.url)
            ) {
              await this.repository.updateNetworkEntry(id, (current) => ({
                ...current,
                response: { ...current.response, bodyStatus: "not-present" },
              }));
            } else {
              await this.captureResponseBody(source, session, requestId);
            }
          } else {
            await this.repository.updateNetworkEntry(id, (current) => ({
              ...current,
              response: { ...current.response, bodyStatus: "not-present" },
            }));
          }
        })
      );
    } else if (method === "Network.loadingFailed") {
      const value = params as { errorText?: string; timestamp?: number };
      this.memoryCacheRequests.delete(`${tabId}:${requestId}`);
      const safeError = sanitizeText(
        value.errorText ?? "请求失败",
        session.options.privacyMode
      );
      await this.enqueue(`${tabId}:${requestId}`, () =>
        this.repository
          .updateNetworkEntry(id, (current) => ({
            ...current,
            durationMs: networkDurationMs(
              current.startedAtMonotonicMs,
              value.timestamp
            ),
            error: safeError,
            response: {
              ...current.response,
              bodyStatus: "unavailable",
              error: safeError,
            },
          }))
          .then(() => undefined)
      );
    }
  }
}
