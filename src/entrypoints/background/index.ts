import { db } from "../../storage/db";
import { isEnvelope, message, type CaptureIssue, type InteractionRecord, type NetworkEntry, type RecordingSession, type RuntimeMessage } from "../../shared/protocol";

const EXTENSION_VERSION = "0.1.0";
let registeredContentScript = false;
const debuggerTabs = new Set<number>();
const pendingBodyCaptures = new Set<Promise<void>>();
const networkEventQueues = new Map<string, Promise<void>>();

function normalizeHeaders(headers: Record<string, unknown> | undefined, privacyMode: RecordingSession["options"]["privacyMode"]): Record<string, string> | undefined {
  if (!headers) return undefined;
  const sensitiveHeader = /^(authorization|proxy-authorization|cookie|set-cookie)$/i;
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, privacyMode === "safe" && sensitiveHeader.test(key) ? `[REDACTED:${key}]` : String(value)]));
}

function redactResponseText(body: string, mimeType: string | undefined, privacyMode: RecordingSession["options"]["privacyMode"]): string {
  if (privacyMode === "raw") return body;
  const sensitiveKey = /^(password|passwd|token|accessToken|refreshToken|authorization|secret|cookie|set-cookie|cardNumber)$/i;
  if (mimeType?.includes("json") || /^[\s]*[\[{]/.test(body)) {
    try {
      const redactValue = (value: unknown, depth = 0): unknown => {
        if (depth > 30) return "[REDACTED:depth-limit]";
        if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1));
        if (value && typeof value === "object") {
          const result: Record<string, unknown> = {};
          for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
            if (["__proto__", "prototype", "constructor"].includes(key)) continue;
            result[key] = sensitiveKey.test(key) ? `[REDACTED:${key}]` : redactValue(child, depth + 1);
          }
          return result;
        }
        return value;
      };
      return JSON.stringify(redactValue(JSON.parse(body)));
    } catch { /* Fall through to text redaction. */ }
  }
  return body
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED:jwt]");
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, messageText: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(messageText)), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

async function captureResponseBody(source: chrome.debugger.Debuggee, session: RecordingSession, requestId: string): Promise<void> {
  const id = `${session.id}:${requestId}`;
  const current = (await db.getNetwork(session.id)).find((entry) => entry.id === id);
  if (!current) return;
  if (current.method === "HEAD" || current.status === 204 || current.status === 304) {
    await db.saveNetwork({ ...current, response: { ...current.response, bodyStatus: "not-present" } });
    return;
  }
  try {
    const command = chrome.debugger.sendCommand(source, "Network.getResponseBody", { requestId }) as Promise<{ body?: string; base64Encoded?: boolean }>;
    const result = await withTimeout(command, 3_000, "RESPONSE_BODY_TIMEOUT: 响应正文读取超过 3 秒");
    const rawBody = result.body ?? "";
    const base64Encoded = Boolean(result.base64Encoded);
    const body = base64Encoded ? rawBody : redactResponseText(rawBody, current.response?.mimeType, session.options.privacyMode);
    const byteLength = base64Encoded
      ? Math.max(0, Math.floor(rawBody.length * 3 / 4) - (rawBody.endsWith("==") ? 2 : rawBody.endsWith("=") ? 1 : 0))
      : new TextEncoder().encode(body).byteLength;
    await db.saveNetwork({ ...current, response: { ...current.response, bodyStatus: "captured", body, base64Encoded, byteLength } });
  } catch (error) {
    await db.saveNetwork({ ...current, response: { ...current.response, bodyStatus: "unavailable", error: String(error) } });
  }
}

async function finalizeNetworkBodies(session: RecordingSession): Promise<void> {
  for (let round = 0; round < 3 && pendingBodyCaptures.size; round += 1) {
    await Promise.allSettled([...pendingBodyCaptures]);
  }

  const pending = (await db.getNetwork(session.id)).filter((entry) => entry.response?.bodyStatus === "pending");
  let cursor = 0;
  const deadline = Date.now() + 5_000;
  const workers = Array.from({ length: Math.min(4, pending.length) }, async () => {
    while (cursor < pending.length && Date.now() < deadline) {
      const entry = pending[cursor++];
      const requestId = entry.id.startsWith(`${session.id}:`) ? entry.id.slice(session.id.length + 1) : "";
      if (requestId) await captureResponseBody({ tabId: session.target.tabId }, session, requestId);
    }
  });
  await Promise.allSettled(workers);

  const unresolved = (await db.getNetwork(session.id)).filter((entry) => entry.response?.bodyStatus === "pending");
  await Promise.all(unresolved.map((entry) => db.saveNetwork({
    ...entry,
    response: {
      ...entry.response,
      bodyStatus: "unavailable",
      error: "RESPONSE_BODY_INCOMPLETE: 录制结束前未收到完整响应或浏览器未提供正文"
    }
  })));
}

function trackBodyCapture(task: Promise<void>): void {
  pendingBodyCaptures.add(task);
  void task.then(
    () => pendingBodyCaptures.delete(task),
    () => pendingBodyCaptures.delete(task)
  );
}

function enqueueNetworkTask(key: string, work: () => Promise<void>): Promise<void> {
  const previous = networkEventQueues.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(work);
  networkEventQueues.set(key, current);
  void current.then(
    () => { if (networkEventQueues.get(key) === current) networkEventQueues.delete(key); },
    () => { if (networkEventQueues.get(key) === current) networkEventQueues.delete(key); }
  );
  return current;
}

function issue(code: string, messageText: string, source: CaptureIssue["source"], recoverable = true): CaptureIssue {
  return { code, message: messageText, source, recoverable, occurredAt: Date.now() };
}

async function ensureOffscreen(): Promise<void> {
  const contexts = await (chrome.runtime.getContexts as unknown as (filter: unknown) => Promise<chrome.runtime.ExtensionContext[]> )({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (contexts.length) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["USER_MEDIA", "BLOBS"],
    justification: "Record the selected tab and persist media chunks locally."
  });
}

async function injectContent(tabId: number): Promise<void> {
  if (!registeredContentScript) {
    try {
      await chrome.scripting.registerContentScripts([{
        id: "web-bug-recorder-content",
        js: ["content.js"],
        matches: ["http://*/*", "https://*/*"],
        allFrames: true,
        runAt: "document_start",
        persistAcrossSessions: false
      }]);
    } catch (error) {
      // It may already be registered after a service worker restart.
      if (!String(error).includes("already exists")) registeredContentScript = false;
    }
    if (!registeredContentScript) {
      const registrations = await chrome.scripting.getRegisteredContentScripts({ ids: ["web-bug-recorder-content"] }).catch(() => []);
      registeredContentScript = registrations.length > 0;
    }
  }
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] }).catch(() => undefined);
}

async function removeContentScript(): Promise<void> {
  if (!registeredContentScript) return;
  await chrome.scripting.unregisterContentScripts({ ids: ["web-bug-recorder-content"] }).catch(() => undefined);
  registeredContentScript = false;
}

async function attachDebugger(tabId: number, session: RecordingSession): Promise<CaptureIssue | undefined> {
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    debuggerTabs.add(tabId);
    await chrome.debugger.sendCommand({ tabId }, "Runtime.enable");
    await chrome.debugger.sendCommand({ tabId }, "Network.enable", { maxTotalBufferSize: 50 * 1024 * 1024, maxResourceBufferSize: 10 * 1024 * 1024, maxPostDataSize: 1024 * 1024 }).catch(() => undefined);
    await chrome.debugger.sendCommand({ tabId }, "Log.enable").catch(() => undefined);
    return undefined;
  } catch (error) {
    return issue("DEBUGGER_ATTACH_FAILED", String(error), "debugger");
  }
}

async function detachDebugger(tabId: number): Promise<void> {
  if (!debuggerTabs.has(tabId)) return;
  debuggerTabs.delete(tabId);
  await chrome.debugger.detach({ tabId }).catch(() => undefined);
}

async function updateSession(session: RecordingSession, patch: Partial<RecordingSession>): Promise<RecordingSession> {
  const next = { ...session, ...patch, quality: { ...session.quality, ...(patch.quality ?? {}) } };
  await db.saveSession(next);
  return next;
}

async function startSession(payload: Extract<RuntimeMessage, { type: "session/start" }>["payload"]): Promise<RecordingSession> {
  const streamIdPromise = payload.streamId
    ? Promise.resolve(payload.streamId)
    : new Promise<string>((resolve, reject) => chrome.tabCapture.getMediaStreamId({ targetTabId: payload.tabId }, (id) => id ? resolve(id) : reject(chrome.runtime.lastError ?? new Error("未返回媒体流 ID"))));
  const tab = await chrome.tabs.get(payload.tabId);
  const session: RecordingSession = {
    id: crypto.randomUUID(),
    schemaVersion: 1,
    extensionVersion: EXTENSION_VERSION,
    status: "PREPARING",
    target: { tabId: payload.tabId, windowId: tab.windowId, initialUrl: tab.url ?? "", initialTitle: tab.title ?? "" },
    options: payload.options,
    timeline: { createdAtEpochMs: Date.now() },
    quality: { overall: "complete", interactionCount: 0, confirmedInteractionCount: 0, primaryScreenshotCount: 0, fallbackScreenshotCount: 0, unavailableScreenshotCount: 0, consoleEntryCount: 0, networkEntryCount: 0, issues: [] },
    nonce: crypto.randomUUID()
  };
  const claim = await db.claimSession(session);
  if (!claim.claimed) return claim.session;

  try {
    const streamId = await streamIdPromise.catch(() => undefined);
    await ensureOffscreen();
    await injectContent(payload.tabId);
    const debuggerIssue = await attachDebugger(payload.tabId, session);
    if (debuggerIssue) session.quality.issues.push(debuggerIssue);
    if (streamId) {
      await chrome.runtime.sendMessage(message("offscreen/start-media", { streamId, sessionId: session.id, captureAudio: payload.options.captureAudio, timesliceMs: payload.options.mediaTimesliceMs }, session.id));
    } else {
      session.quality.issues.push(issue("MEDIA_STREAM_ID_FAILED", "未取得标签页媒体流，已进入降级录制。", "media", false));
    }
    const started = await updateSession(session, { status: debuggerIssue || !streamId ? "DEGRADED" : "RECORDING", timeline: { ...session.timeline, startedAtEpochMs: Date.now() } });
    await chrome.action.setBadgeText({ tabId: payload.tabId, text: "REC" });
    await chrome.action.setBadgeBackgroundColor({ tabId: payload.tabId, color: "#d92d20" });
    return started;
  } catch (error) {
    const failed = await updateSession(session, { status: "FAILED", error: issue("SESSION_START_FAILED", String(error), "media", false), quality: { ...session.quality, overall: "failed" } });
    await db.clearActive(session.id);
    await detachDebugger(payload.tabId);
    return failed;
  }
}

async function stopSession(): Promise<RecordingSession | undefined> {
  const session = await db.getActiveSession();
  if (!session) return undefined;
  if (["STOPPING", "PREVIEW_READY", "EXPORTED"].includes(session.status)) return session;
  const stopping = await updateSession(session, { status: "STOPPING", timeline: { ...session.timeline, stoppedAtEpochMs: Date.now() } });
  await chrome.runtime.sendMessage(message("offscreen/stop-media", { sessionId: session.id }, session.id)).catch(() => undefined);
  await finalizeNetworkBodies(stopping);
  await detachDebugger(session.target.tabId);
  await removeContentScript();
  await chrome.action.setBadgeText({ tabId: session.target.tabId, text: "" });
  const stoppedAt = stopping.timeline.stoppedAtEpochMs ?? Date.now();
  const next = await updateSession(stopping, { status: "PREVIEW_READY", timeline: { ...stopping.timeline, durationMs: (stoppedAt - (stopping.timeline.startedAtEpochMs ?? stopping.timeline.createdAtEpochMs)) } });
  await db.clearActive(session.id);
  await chrome.tabs.create({ url: chrome.runtime.getURL(`preview.html?sessionId=${encodeURIComponent(session.id)}`) });
  return next;
}

async function handleInteraction(interaction: InteractionRecord, sender: chrome.runtime.MessageSender): Promise<void> {
  const session = await db.getActiveSession();
  if (!session || session.target.tabId !== sender.tab?.id || session.nonce !== interaction.sessionId) return;
  const existing = await db.getInteractions(session.id);
  const previous = existing.find((item) => item.id === interaction.id);
  const candidate = { ...interaction, sessionId: session.id, screenshot: interaction.status === "confirmed" && previous ? previous.screenshot : interaction.screenshot };
  await db.saveInteraction(candidate);
  if (!previous) session.quality.interactionCount += 1;
  if (candidate.status === "confirmed" && previous?.status !== "confirmed") session.quality.confirmedInteractionCount += 1;
  await db.saveSession(session);
  if (candidate.status === "candidate") {
    try {
      const capture = chrome.tabs.captureVisibleTab as unknown as (windowId: number, options: { format: "png" }) => Promise<string>;
      if ((sender.frameId ?? 0) !== 0) throw new Error("FRAME_GEOMETRY_UNAVAILABLE: iframe 坐标暂无法可靠映射到顶层视口");
      const dataUrl = await capture(session.target.windowId ?? chrome.windows.WINDOW_ID_CURRENT, { format: "png" });
      const annotated = await chrome.runtime.sendMessage(message("offscreen/annotate-image", { dataUrl, clientX: candidate.coordinates.clientX, clientY: candidate.coordinates.clientY, viewportWidth: candidate.coordinates.viewport.width, viewportHeight: candidate.coordinates.viewport.height }, session.id));
      if (!annotated?.ok || typeof annotated.dataUrl !== "string") throw new Error(annotated?.error || "截图标记失败");
      const confirmed = { ...candidate, screenshot: { status: "captured" as const, source: "primary" as const, dataUrl: annotated.dataUrl } };
      await db.saveInteraction(confirmed);
      session.quality.primaryScreenshotCount += 1;
      await db.saveSession(session);
    } catch (error) {
      const unavailable = { ...candidate, screenshot: { status: "unavailable" as const, issue: String(error) } };
      await db.saveInteraction(unavailable);
      session.quality.unavailableScreenshotCount += 1;
      session.quality.issues.push(issue("VISIBLE_TAB_NOT_ACTIVE", String(error), "screenshot"));
      session.quality.overall = "partial";
      await db.saveSession(session);
    }
  }
}

chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
  if (!isEnvelope(raw)) return;
  const incoming = raw as RuntimeMessage;
  if (incoming.type === "offscreen/start-media" || incoming.type === "offscreen/stop-media" || incoming.type === "offscreen/annotate-image") return;
  void (async () => {
    try {
      switch (incoming.type) {
        case "session/start": sendResponse({ ok: true, session: await startSession(incoming.payload) }); return;
        case "session/stop": sendResponse({ ok: true, session: await stopSession() }); return;
        case "session/status": sendResponse({ ok: true, session: await db.getActiveSession() }); return;
        case "session/open-preview": await chrome.tabs.create({ url: chrome.runtime.getURL(`preview.html?sessionId=${incoming.payload.sessionId}`) }); sendResponse({ ok: true }); return;
        case "content/hello": {
          const session = await db.getActiveSession();
          const allowed = Boolean(session && session.target.tabId === sender.tab?.id);
          sendResponse({ ok: true, active: allowed, sessionId: allowed ? session?.id : undefined, nonce: allowed ? session?.nonce : undefined, startedAtEpochMs: allowed ? session?.timeline.startedAtEpochMs : undefined });
          return;
        }
        case "interaction/candidate":
        case "interaction/confirmed": await handleInteraction(incoming.payload.interaction, sender); sendResponse({ ok: true }); return;
        case "interaction/cancelled": sendResponse({ ok: true }); return;
        case "offscreen/media-chunk": await db.saveMediaChunk({ id: `${incoming.payload.sessionId}:${incoming.payload.sequence}`, ...incoming.payload }); sendResponse({ ok: true }); return;
        case "offscreen/media-state": {
          const session = await db.getSession(incoming.payload.sessionId);
          if (session && incoming.payload.state === "error") await updateSession(session, { status: "DEGRADED", quality: { ...session.quality, overall: "partial", issues: [...session.quality.issues, issue("MEDIA_RECORDER_FAILED", incoming.payload.error ?? "媒体录制失败", "media", false)] } });
          sendResponse({ ok: true }); return;
        }
        default: sendResponse({ ok: false, error: "UNSUPPORTED_MESSAGE" });
      }
    } catch (error) { sendResponse({ ok: false, error: String(error) }); }
  })();
  return true;
});

chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId;
  if (typeof tabId !== "number") return;
  void (async () => {
    const session = await db.getActiveSession();
    if (!session || session.target.tabId !== tabId) return;
    if (method === "Runtime.consoleAPICalled") {
      const p = params as { type?: string; args?: Array<{ value?: unknown; description?: string }>; timestamp?: number };
      await db.saveConsole({ id: crypto.randomUUID(), sessionId: session.id, createdAt: p.timestamp ?? Date.now(), level: p.type ?? "log", text: (p.args ?? []).map((arg) => typeof arg.value === "string" ? arg.value : arg.description ?? String(arg.value ?? "")).join(" ") });
      session.quality.consoleEntryCount += 1;
      await db.saveSession(session);
    } else if (method === "Runtime.exceptionThrown") {
      const p = params as { timestamp?: number; exceptionDetails?: { text?: string; url?: string; exception?: { description?: string }; lineNumber?: number; columnNumber?: number } };
      const details = p.exceptionDetails;
      await db.saveConsole({ id: crypto.randomUUID(), sessionId: session.id, createdAt: p.timestamp ?? Date.now(), level: "error", text: details?.exception?.description ?? details?.text ?? "未捕获异常", source: details?.url });
      session.quality.consoleEntryCount += 1;
      await db.saveSession(session);
    } else if (method === "Log.entryAdded") {
      const p = params as { entry?: { timestamp?: number; level?: string; text?: string; url?: string } };
      if (!p.entry) return;
      await db.saveConsole({ id: crypto.randomUUID(), sessionId: session.id, createdAt: p.entry.timestamp ?? Date.now(), level: p.entry.level ?? "info", text: p.entry.text ?? "", source: p.entry.url });
      session.quality.consoleEntryCount += 1;
      await db.saveSession(session);
    } else if (method === "Network.requestWillBeSent") {
      const p = params as { request?: { url?: string; method?: string }; type?: string; timestamp?: number; requestId?: string };
      if (!p.request?.url) return;
      const requestId = p.requestId ?? crypto.randomUUID();
      await enqueueNetworkTask(`${tabId}:${requestId}`, async () => {
        await db.saveNetwork({ id: `${session.id}:${requestId}`, sessionId: session.id, createdAt: (p.timestamp ?? 0) * 1000 || Date.now(), url: p.request!.url!, method: p.request!.method ?? "GET", type: p.type });
        session.quality.networkEntryCount += 1;
        await db.saveSession(session);
      });
    } else if (method === "Network.responseReceived") {
      const p = params as { requestId?: string; response?: { status?: number; url?: string; mimeType?: string; headers?: Record<string, unknown> } };
      if (!p.requestId) return;
      const id = `${session.id}:${p.requestId ?? ""}`;
      await enqueueNetworkTask(`${tabId}:${p.requestId}`, async () => {
        const current = (await db.getNetwork(session.id)).find((entry) => entry.id === id);
        if (current) await db.saveNetwork({ ...current, status: p.response?.status, response: { mimeType: p.response?.mimeType, headers: normalizeHeaders(p.response?.headers, session.options.privacyMode), bodyStatus: "pending" } });
      });
    } else if (method === "Network.loadingFinished") {
      const p = params as { requestId?: string };
      if (p.requestId) trackBodyCapture(enqueueNetworkTask(`${tabId}:${p.requestId}`, () => captureResponseBody(source, session, p.requestId!)));
    } else if (method === "Network.loadingFailed") {
      const p = params as { requestId?: string; errorText?: string };
      if (!p.requestId) return;
      const id = `${session.id}:${p.requestId ?? ""}`;
      await enqueueNetworkTask(`${tabId}:${p.requestId}`, async () => {
        const current = (await db.getNetwork(session.id)).find((entry) => entry.id === id);
        if (current) await db.saveNetwork({ ...current, error: p.errorText ?? "请求失败", response: { ...current.response, bodyStatus: "unavailable", error: p.errorText ?? "请求失败" } });
      });
    }
  })();
});

chrome.debugger.onDetach.addListener((source, reason) => {
  if (typeof source.tabId !== "number" || reason === "target_closed") return;
  void (async () => {
    const session = await db.getActiveSession();
    if (!session || session.target.tabId !== source.tabId) return;
    await updateSession(session, { status: session.status === "RECORDING" ? "DEGRADED" : session.status, quality: { ...session.quality, overall: "partial", issues: [...session.quality.issues, issue("DEBUGGER_DETACHED_BY_DEVTOOLS", reason, "debugger")] } });
  })();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => { const session = await db.getActiveSession(); if (session?.target.tabId === tabId) await stopSession(); })();
});

chrome.runtime.onStartup.addListener(() => { void db.getActiveSession(); });
