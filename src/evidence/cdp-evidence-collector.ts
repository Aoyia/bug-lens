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
import { flushStorageBatchQueue } from "../storage/storage-budget.ts";
import { RECORDING_STATUSES } from "../shared/protocol.ts";
import type {
  CaptureIssue,
  RecordingOptions,
  RecordingSession,
} from "../shared/protocol.ts";
import { t } from "../shared/i18n.ts";
import type { CdpFinalizeStats } from "../export/export-trace.ts";

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

export function getNetworkEnableParams(options?: RecordingOptions): {
  maxTotalBufferSize: number;
  maxResourceBufferSize: number;
  maxPostDataSize: number;
} {
  const isFullCapture = Boolean(options?.captureFullResponseBody);
  return {
    maxTotalBufferSize: isFullCapture ? 200 * 1024 * 1024 : 50 * 1024 * 1024,
    maxResourceBufferSize: isFullCapture ? 100 * 1024 * 1024 : 10 * 1024 * 1024,
    maxPostDataSize: 1024 * 1024,
  };
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

export interface AttachedTargetInfo {
  targetId: string;
  type: string;
  title?: string;
  url: string;
  attached?: boolean;
  canAccessOpener?: boolean;
  openerId?: string;
  browserContextId?: string;
  parentFrameId?: string;
}

export class CdpEvidenceCollector {
  private readonly attachedTabs = new Set<number>();
  private readonly pendingBodyCaptures = new Set<Promise<void>>();
  private readonly eventQueues = new Map<string, Promise<void>>();
  private readonly pendingHandlers = new Set<Promise<void>>();
  private readonly memoryCacheRequests = new Set<string>();
  private readonly childSessions = new Map<string, AttachedTargetInfo>();
  private readonly childSessionTabIds = new Map<string, number>();
  private readonly executionContexts = new Map<
    string,
    { frameId?: string; origin?: string }
  >();
  private readonly requestSessionMap = new Map<string, string>();

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

  private readonly pendingConsoleDeltas = new Map<string, number>();
  private readonly consoleDeltaTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private readonly activeQualityFlush = new Map<string, Promise<void>>();
  private readonly pendingQualityFlushes = new Set<Promise<void>>();

  private readonly reattachTimers = new Map<
    number,
    ReturnType<typeof setTimeout>
  >();
  private readonly reportedStorageLimits = new Set<string>();

  private recordConsoleQualityDelta(sessionId: string, count = 1): void {
    const current = (this.pendingConsoleDeltas.get(sessionId) ?? 0) + count;
    this.pendingConsoleDeltas.set(sessionId, current);

    // If an active flush loop is already running for this session, it will automatically drain new deltas in its next iteration
    if (this.activeQualityFlush.has(sessionId)) {
      return;
    }

    if (current >= 100) {
      void this.flushConsoleQualityDelta(sessionId);
      return;
    }

    if (!this.consoleDeltaTimers.has(sessionId)) {
      const timer = setTimeout(() => {
        this.consoleDeltaTimers.delete(sessionId);
        void this.flushConsoleQualityDelta(sessionId);
      }, 100);
      this.consoleDeltaTimers.set(sessionId, timer);
    }
  }

  async flushConsoleQualityDelta(sessionId?: string): Promise<void> {
    if (!sessionId) {
      const sessionIds = Array.from(
        new Set([
          ...this.pendingConsoleDeltas.keys(),
          ...this.activeQualityFlush.keys(),
          ...this.consoleDeltaTimers.keys(),
        ])
      );
      await Promise.all(
        sessionIds.map((id) => this.flushConsoleQualityDelta(id))
      );
      return;
    }

    while (true) {
      const timer = this.consoleDeltaTimers.get(sessionId);
      if (timer) {
        clearTimeout(timer);
        this.consoleDeltaTimers.delete(sessionId);
      }

      // 1. Wait for any currently active flush on this session to finish
      if (this.activeQualityFlush.has(sessionId)) {
        await this.activeQualityFlush.get(sessionId);
        const postTimer = this.consoleDeltaTimers.get(sessionId);
        if (postTimer) {
          clearTimeout(postTimer);
          this.consoleDeltaTimers.delete(sessionId);
        }
        continue;
      }

      const delta = this.pendingConsoleDeltas.get(sessionId) ?? 0;
      if (delta <= 0) {
        this.pendingConsoleDeltas.delete(sessionId);
        break;
      }

      this.pendingConsoleDeltas.delete(sessionId);

      const task = (async () => {
        try {
          await this.writeSessionEvent(sessionId, {
            type: "quality-delta",
            delta: { consoleEntryCount: delta },
          });
        } catch {
          // Ignored: session may be stopping or completed
        }
      })();

      this.activeQualityFlush.set(sessionId, task);
      this.pendingQualityFlushes.add(task);

      try {
        await task;
      } finally {
        if (this.activeQualityFlush.get(sessionId) === task) {
          this.activeQualityFlush.delete(sessionId);
        }
        this.pendingQualityFlushes.delete(task);
      }
    }
  }

  async flush(): Promise<void> {
    await this.flushConsoleQualityDelta();
  }

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
          .sendCommand(
            { tabId },
            "Network.enable",
            getNetworkEnableParams(session.options)
          )
          .catch(() => undefined);
      }
      await chrome.debugger
        .sendCommand({ tabId }, "Target.setAutoAttach", {
          autoAttach: true,
          waitForDebuggerOnStart: false,
          flatten: true,
        })
        .catch(() => undefined);
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
    await this.flushConsoleQualityDelta();
    for (const timer of this.consoleDeltaTimers.values()) {
      clearTimeout(timer);
    }
    this.consoleDeltaTimers.clear();
    await flushStorageBatchQueue();
    for (const [sessionId, tid] of this.childSessionTabIds.entries()) {
      if (tid === tabId) {
        this.childSessionTabIds.delete(sessionId);
        this.childSessions.delete(sessionId);
      }
    }
    this.executionContexts.clear();
    this.requestSessionMap.clear();
    this.reportedStorageLimits.clear();
    await chrome.debugger.detach({ tabId }).catch(() => undefined);
  }

  handleEvent(
    source: chrome.debugger.DebuggerSession,
    method: string,
    params?: object
  ): void {
    const tabId =
      source.tabId ??
      (source.sessionId
        ? this.childSessionTabIds.get(source.sessionId)
        : undefined);
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
    for (const [sessionId, tid] of this.childSessionTabIds.entries()) {
      if (tid === tabId) {
        this.childSessionTabIds.delete(sessionId);
        this.childSessions.delete(sessionId);
      }
    }
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
    await flushStorageBatchQueue();
    for (let round = 0; round < 3 && this.pendingHandlers.size; round += 1) {
      const results = await Promise.allSettled([...this.pendingHandlers]);
      for (const result of results)
        if (result.status === "rejected")
          errors.push(t("debugEventWritePending", String(result.reason)));
    }
    await this.flushConsoleQualityDelta();
    if (this.pendingQualityFlushes.size) {
      await Promise.allSettled([...this.pendingQualityFlushes]);
    }
    await flushStorageBatchQueue();
    for (let round = 0; round < 3 && this.eventQueues.size; round += 1) {
      const results = await Promise.allSettled([...this.eventQueues.values()]);
      for (const result of results)
        if (result.status === "rejected")
          errors.push(t("networkWritePending", String(result.reason)));
    }
    return errors;
  }

  async finalizeNetworkBodies(
    session: RecordingSession
  ): Promise<CdpFinalizeStats> {
    const startTime = performance.now();
    let successCount = 0;
    let failureCount = 0;
    let totalBodyBytes = 0;
    let totalRequests = 0;

    if (!session.options.captureNetworkBodies) {
      return {
        totalRequests: 0,
        successCount: 0,
        failureCount: 0,
        totalBodyBytes: 0,
        avgDurationMs: 0,
        durationMs: 0,
        throughputMBps: 0,
      };
    }

    try {
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
      totalRequests = pending.length;
      if (totalRequests === 0) {
        const durationMs = performance.now() - startTime;
        return {
          totalRequests: 0,
          successCount: 0,
          failureCount: 0,
          totalBodyBytes: 0,
          avgDurationMs: 0,
          durationMs,
          throughputMBps: 0,
        };
      }

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
            if (requestId) {
              const childSessionId = this.requestSessionMap.get(entry.id);
              await this.captureResponseBody(
                {
                  tabId: session.target.tabId,
                  ...(childSessionId ? { sessionId: childSessionId } : {}),
                },
                session,
                requestId
              ).catch(() => undefined);
            }
          }
        }
      );
      await Promise.allSettled(workers);

      // 消除重复全表扫描：仅针对原始 pending 列表中的条目逐个按 key 结算未决状态并累计指标
      await Promise.all(
        pending.map(async (p) => {
          let entry = await this.repository.getNetworkEntry(p.id);
          if (entry?.response?.bodyStatus === "pending") {
            entry = await this.repository.updateNetworkEntry(
              p.id,
              (current) => ({
                ...current,
                response: {
                  ...current.response,
                  bodyStatus: "unavailable",
                  error: `RESPONSE_BODY_INCOMPLETE: ${t("responseBodyIncomplete")}`,
                },
              })
            );
          }
          if (entry) {
            if (
              entry.response?.bodyStatus === "captured" ||
              entry.response?.truncated ||
              entry.response?.bodyStatus === "redacted"
            ) {
              successCount += 1;
              totalBodyBytes +=
                entry.response?.byteLength ?? entry.response?.body?.length ?? 0;
            } else {
              failureCount += 1;
            }
          } else {
            failureCount += 1;
          }
        })
      );
    } catch {
      // 容错兜底：即使部分数据库或网络查询异常，仍确保计算回传统计数据，不阻塞主流程
      failureCount = Math.max(0, totalRequests - successCount);
    }

    const durationMs = performance.now() - startTime;
    const avgDurationMs = totalRequests > 0 ? durationMs / totalRequests : 0;
    const throughputMBps =
      durationMs > 0 && totalBodyBytes > 0
        ? totalBodyBytes / (1024 * 1024) / (durationMs / 1000)
        : 0;

    return {
      totalRequests,
      successCount,
      failureCount,
      totalBodyBytes,
      avgDurationMs,
      durationMs,
      throughputMBps,
    };
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
    source: chrome.debugger.DebuggerSession,
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

    const childSessionId = source.sessionId ?? this.requestSessionMap.get(id);
    const target: chrome.debugger.DebuggerSession = {
      tabId: source.tabId ?? session.target.tabId,
      ...(childSessionId ? { sessionId: childSessionId } : {}),
    };

    try {
      const command = chrome.debugger.sendCommand(
        target,
        "Network.getResponseBody",
        { requestId }
      ) as Promise<{ body?: string; base64Encoded?: boolean }>;
      const result = await withTimeout(
        command,
        3_000,
        `RESPONSE_BODY_TIMEOUT: ${t("responseBodyTimeout")}`
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
        captureFullResponseBody: session.options.captureFullResponseBody,
      });
      const stored = await this.repository.updateNetworkEntryWithinBudget(
        id,
        (entry) => ({ ...entry, response: { ...entry.response, ...sanitized } })
      );
      if (!stored.stored && !this.reportedStorageLimits.has(session.id)) {
        this.reportedStorageLimits.add(session.id);
        await this.writeSessionEvent(session.id, {
          type: "capture-issue",
          issue: captureIssue(
            "SESSION_STORAGE_LIMIT_REACHED",
            t("networkBodyStorageLimitReached"),
            "storage"
          ),
        });
      }
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
    source: chrome.debugger.DebuggerSession,
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

    if (method === "Target.attachedToTarget") {
      const value = params as {
        sessionId?: string;
        targetInfo?: AttachedTargetInfo;
        waitingForDebugger?: boolean;
      };
      if (value?.sessionId && value.targetInfo) {
        const childSessionId = value.sessionId;
        this.childSessions.set(childSessionId, value.targetInfo);
        this.childSessionTabIds.set(childSessionId, tabId);

        const childTarget: chrome.debugger.DebuggerSession = {
          tabId,
          sessionId: childSessionId,
        };

        const initTasks: Promise<unknown>[] = [];
        if (session.options.captureConsole) {
          initTasks.push(
            chrome.debugger
              .sendCommand(childTarget, "Runtime.enable")
              .catch(() => undefined)
          );
          initTasks.push(
            chrome.debugger
              .sendCommand(childTarget, "Log.enable")
              .catch(() => undefined)
          );
        }
        if (session.options.captureNetwork) {
          initTasks.push(
            chrome.debugger
              .sendCommand(
                childTarget,
                "Network.enable",
                getNetworkEnableParams(session.options)
              )
              .catch(() => undefined)
          );
        }
        initTasks.push(
          chrome.debugger
            .sendCommand(childTarget, "Target.setAutoAttach", {
              autoAttach: true,
              waitForDebuggerOnStart: false,
              flatten: true,
            })
            .catch(() => undefined)
        );
        if (value.waitingForDebugger) {
          initTasks.push(
            chrome.debugger
              .sendCommand(childTarget, "Runtime.runIfWaitingForDebugger")
              .catch(() => undefined)
          );
        }
        await Promise.allSettled(initTasks);
      }
      return;
    }

    if (method === "Target.detachedFromTarget") {
      const value = params as { sessionId?: string; targetId?: string };
      if (value?.sessionId) {
        this.childSessions.delete(value.sessionId);
        this.childSessionTabIds.delete(value.sessionId);
      }
      return;
    }

    if (method === "Runtime.executionContextCreated") {
      const value = params as {
        context?: {
          id: number;
          origin?: string;
          auxData?: { isDefault?: boolean; frameId?: string };
        };
      };
      if (value?.context) {
        const key = `${source.sessionId ?? ""}:${value.context.id}`;
        this.executionContexts.set(key, {
          frameId: value.context.auxData?.frameId,
          origin: value.context.origin,
        });
      }
      return;
    }

    if (method === "Runtime.executionContextDestroyed") {
      const value = params as { executionContextId?: number };
      if (value?.executionContextId != null) {
        const key = `${source.sessionId ?? ""}:${value.executionContextId}`;
        this.executionContexts.delete(key);
      }
      return;
    }

    if (
      session.options.captureConsole &&
      method === "Runtime.consoleAPICalled"
    ) {
      const value = params as {
        type?: string;
        args?: Array<{ value?: unknown; description?: string }>;
        timestamp?: number;
        executionContextId?: number;
        stackTrace?: {
          callFrames?: Array<{
            url?: string;
            lineNumber?: number;
            columnNumber?: number;
          }>;
        };
      };
      const childSessionId = source.sessionId;
      const childTarget = childSessionId
        ? this.childSessions.get(childSessionId)
        : undefined;
      const ctxKey =
        value.executionContextId != null
          ? `${childSessionId ?? ""}:${value.executionContextId}`
          : undefined;
      const ctxInfo = ctxKey ? this.executionContexts.get(ctxKey) : undefined;
      const frameId = ctxInfo?.frameId ?? childTarget?.targetId;
      const topCallFrame = value.stackTrace?.callFrames?.[0];
      const sourceUrl =
        topCallFrame?.url || childTarget?.url || ctxInfo?.origin;

      const stored = await this.repository.saveConsoleWithinBudget(
        sanitizeConsoleEntry(
          {
            id: crypto.randomUUID(),
            sessionId: session.id,
            createdAt:
              value.timestamp != null
                ? value.timestamp > 1e12
                  ? Math.round(value.timestamp)
                  : Math.round(value.timestamp * 1000)
                : Date.now(),
            level: value.type ?? "log",
            text: (value.args ?? [])
              .map((arg) =>
                typeof arg.value === "string"
                  ? arg.value
                  : (arg.description ?? String(arg.value ?? ""))
              )
              .join(" "),
            source: sourceUrl,
            url: sourceUrl,
            frameId,
            executionContextId: value.executionContextId,
            lineNumber: topCallFrame?.lineNumber,
            columnNumber: topCallFrame?.columnNumber,
          },
          session.options.privacyMode
        )
      );
      if (stored.stored) {
        this.recordConsoleQualityDelta(session.id);
      } else if (!this.reportedStorageLimits.has(session.id)) {
        this.reportedStorageLimits.add(session.id);
        await this.writeSessionEvent(session.id, {
          type: "capture-issue",
          issue: captureIssue(
            "SESSION_STORAGE_LIMIT_REACHED",
            t("consoleStorageLimitReached"),
            "storage"
          ),
        });
      }
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
          lineNumber?: number;
          columnNumber?: number;
          executionContextId?: number;
          exception?: { description?: string };
          stackTrace?: {
            callFrames?: Array<{
              url?: string;
              lineNumber?: number;
              columnNumber?: number;
            }>;
          };
        };
      };
      const details = value.exceptionDetails;
      const childSessionId = source.sessionId;
      const childTarget = childSessionId
        ? this.childSessions.get(childSessionId)
        : undefined;
      const ctxKey =
        details?.executionContextId != null
          ? `${childSessionId ?? ""}:${details.executionContextId}`
          : undefined;
      const ctxInfo = ctxKey ? this.executionContexts.get(ctxKey) : undefined;
      const frameId = ctxInfo?.frameId ?? childTarget?.targetId;
      const sourceUrl = details?.url || childTarget?.url || ctxInfo?.origin;

      const stored = await this.repository.saveConsoleWithinBudget(
        sanitizeConsoleEntry(
          {
            id: crypto.randomUUID(),
            sessionId: session.id,
            createdAt:
              value.timestamp != null
                ? value.timestamp > 1e12
                  ? Math.round(value.timestamp)
                  : Math.round(value.timestamp * 1000)
                : Date.now(),
            level: "error",
            text:
              details?.exception?.description ??
              details?.text ??
              t("uncaughtException"),
            source: sourceUrl,
            url: sourceUrl,
            frameId,
            executionContextId: details?.executionContextId,
            lineNumber: details?.lineNumber,
            columnNumber: details?.columnNumber,
          },
          session.options.privacyMode
        )
      );
      if (stored.stored) {
        this.recordConsoleQualityDelta(session.id);
      } else if (!this.reportedStorageLimits.has(session.id)) {
        this.reportedStorageLimits.add(session.id);
        await this.writeSessionEvent(session.id, {
          type: "capture-issue",
          issue: captureIssue(
            "SESSION_STORAGE_LIMIT_REACHED",
            t("consoleStorageLimitReached"),
            "storage"
          ),
        });
      }
      return;
    }

    if (session.options.captureConsole && method === "Log.entryAdded") {
      const value = params as {
        entry?: {
          timestamp?: number;
          level?: string;
          text?: string;
          url?: string;
          lineNumber?: number;
          networkRequestId?: string;
        };
      };
      if (!value.entry) return;
      const childSessionId = source.sessionId;
      const childTarget = childSessionId
        ? this.childSessions.get(childSessionId)
        : undefined;
      const frameId = childTarget?.targetId;
      const sourceUrl = value.entry.url || childTarget?.url;

      const stored = await this.repository.saveConsoleWithinBudget(
        sanitizeConsoleEntry(
          {
            id: crypto.randomUUID(),
            sessionId: session.id,
            createdAt:
              value.entry.timestamp != null
                ? value.entry.timestamp > 1e12
                  ? Math.round(value.entry.timestamp)
                  : Math.round(value.entry.timestamp * 1000)
                : Date.now(),
            level: value.entry.level ?? "info",
            text: value.entry.text ?? "",
            source: sourceUrl,
            url: sourceUrl,
            frameId,
            lineNumber: value.entry.lineNumber,
            networkRequestId: value.entry.networkRequestId,
          },
          session.options.privacyMode
        )
      );
      if (stored.stored) {
        this.recordConsoleQualityDelta(session.id);
      } else if (!this.reportedStorageLimits.has(session.id)) {
        this.reportedStorageLimits.add(session.id);
        await this.writeSessionEvent(session.id, {
          type: "capture-issue",
          issue: captureIssue(
            "SESSION_STORAGE_LIMIT_REACHED",
            t("consoleStorageLimitReached"),
            "storage"
          ),
        });
      }
      return;
    }

    if (
      session.options.captureNetwork &&
      method === "Network.requestServedFromCache"
    ) {
      const reqId = (params as { requestId?: string })?.requestId;
      if (reqId)
        this.memoryCacheRequests.add(
          `${tabId}:${source.sessionId ?? ""}:${reqId}`
        );
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
        frameId?: string;
        documentURL?: string;
      };
      if (!value.request?.url) return;
      const requestId = value.requestId ?? crypto.randomUUID();
      const childSessionId = source.sessionId;
      const childTarget = childSessionId
        ? this.childSessions.get(childSessionId)
        : undefined;
      const frameId = value.frameId ?? childTarget?.targetId;
      const documentUrl = value.documentURL ?? childTarget?.url;

      if (childSessionId) {
        this.requestSessionMap.set(
          `${session.id}:${requestId}`,
          childSessionId
        );
      }

      await this.enqueue(
        `${tabId}:${source.sessionId ?? ""}:${requestId}`,
        async () => {
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
            frameId,
            documentUrl: documentUrl
              ? sanitizeUrl(documentUrl, session.options.privacyMode)
              : undefined,
            initiator: rawInitiator
              ? {
                  type: rawInitiator.type || "other",
                  url: rawInitiator.url
                    ? sanitizeUrl(rawInitiator.url, session.options.privacyMode)
                    : undefined,
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
          if (stored.stored) {
            await this.writeSessionEvent(session.id, {
              type: "quality-delta",
              delta: { networkEntryCount: 1 },
            });
          } else if (!this.reportedStorageLimits.has(session.id)) {
            this.reportedStorageLimits.add(session.id);
            await this.writeSessionEvent(session.id, {
              type: "capture-issue",
              issue: captureIssue(
                "SESSION_STORAGE_LIMIT_REACHED",
                t("networkStorageLimitReached"),
                "storage"
              ),
            });
          }
        }
      );
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
        `${tabId}:${source.sessionId ?? ""}:${requestId}`
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

      await this.enqueue(
        `${tabId}:${source.sessionId ?? ""}:${requestId}`,
        () =>
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
      this.memoryCacheRequests.delete(
        `${tabId}:${source.sessionId ?? ""}:${requestId}`
      );
      this.trackBodyCapture(
        this.enqueue(
          `${tabId}:${source.sessionId ?? ""}:${requestId}`,
          async () => {
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
          }
        )
      );
    } else if (method === "Network.loadingFailed") {
      const value = params as { errorText?: string; timestamp?: number };
      this.memoryCacheRequests.delete(
        `${tabId}:${source.sessionId ?? ""}:${requestId}`
      );
      const safeError = sanitizeText(
        value.errorText ?? t("requestFailed"),
        session.options.privacyMode
      );
      await this.enqueue(
        `${tabId}:${source.sessionId ?? ""}:${requestId}`,
        () =>
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
