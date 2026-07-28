import { db } from "../../storage/db";
import { isEnvelope, message, type CaptureIssue, type InteractionRecord, type NetworkEntry, type RecordingSession, type RuntimeMessage } from "../../shared/protocol";

const EXTENSION_VERSION = "0.1.0";
let registeredContentScript = false;
const debuggerTabs = new Set<number>();

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
          sendResponse({ ok: true, active: allowed, sessionId: allowed ? session?.id : undefined, nonce: allowed ? session?.nonce : undefined });
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
      await db.saveNetwork({ id: `${session.id}:${p.requestId ?? crypto.randomUUID()}`, sessionId: session.id, createdAt: (p.timestamp ?? 0) * 1000 || Date.now(), url: p.request.url, method: p.request.method ?? "GET", type: p.type });
      session.quality.networkEntryCount += 1;
      await db.saveSession(session);
    } else if (method === "Network.responseReceived") {
      const p = params as { requestId?: string; response?: { status?: number; url?: string } };
      const id = `${session.id}:${p.requestId ?? ""}`;
      const current = (await db.getNetwork(session.id)).find((entry) => entry.id === id);
      if (current) await db.saveNetwork({ ...current, status: p.response?.status });
    } else if (method === "Network.loadingFailed") {
      const p = params as { requestId?: string; errorText?: string };
      const id = `${session.id}:${p.requestId ?? ""}`;
      const current = (await db.getNetwork(session.id)).find((entry) => entry.id === id);
      if (current) await db.saveNetwork({ ...current, error: p.errorText ?? "请求失败" });
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
