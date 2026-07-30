import { db } from "../../storage/db";
import { isEnvelope, message, type CaptureIssue, type NetworkEntry, type RecordingSession, type RuntimeMessage } from "../../shared/protocol";
import { applySessionEvent as reduceSession, type RecordingSessionEvent } from "../../domain/recording-session";
import { sanitizeText, sanitizeUrl } from "../../domain/privacy-policy";
import { normalizeRecordingOptions } from "../../domain/storage-policy";
import { CdpEvidenceCollector } from "../../evidence/cdp-evidence-collector";
import { ContentScriptManager } from "../../recording/content-script-manager";
import { InteractionCapture } from "../../recording/interaction-capture";
import { RecordingCoordinator } from "../../recording/recording-coordinator";

const EXTENSION_VERSION = "0.1.0";
const recordingCoordinator = new RecordingCoordinator();
const contentScripts = new ContentScriptManager();
const BROWSER_EPOCH_KEY = "bug-lens-browser-epoch";
const browserEpochPromise = loadOrCreateBrowserEpoch();

async function loadOrCreateBrowserEpoch(): Promise<string> {
  const stored = await chrome.storage.session.get(BROWSER_EPOCH_KEY);
  const existing = stored[BROWSER_EPOCH_KEY];
  if (typeof existing === "string" && existing) return existing;
  const created = crypto.randomUUID();
  await chrome.storage.session.set({ [BROWSER_EPOCH_KEY]: created });
  return created;
}

async function applySessionEvent(sessionId: string, event: RecordingSessionEvent): Promise<RecordingSession> {
  const next = await db.updateSession(sessionId, (current) => reduceSession(current, event));
  if (!next) throw new Error(`未找到会话 (SESSION_NOT_FOUND:${sessionId})`);
  return next;
}

const cdpCollector = new CdpEvidenceCollector(db, applySessionEvent, (sessionId) => recordingCoordinator.isStopping(sessionId));
const interactionCapture = new InteractionCapture(db, applySessionEvent, (sessionId) => recordingCoordinator.isStopping(sessionId));

async function reconcileSessionQuality(sessionId: string): Promise<void> {
  const [interactions, consoleEntries, networkEntries] = await Promise.all([
    db.getInteractions(sessionId),
    db.getConsole(sessionId),
    db.getNetwork(sessionId)
  ]);
  const included = interactions.filter((entry) => entry.status !== "cancelled");
  await applySessionEvent(sessionId, {
    type: "quality-snapshot",
    counts: {
      interactionCount: included.length,
      confirmedInteractionCount: included.filter((entry) => entry.status === "confirmed").length,
      primaryScreenshotCount: included.filter((entry) => entry.screenshot.status === "captured" && entry.screenshot.source === "primary").length,
      fallbackScreenshotCount: included.filter((entry) => entry.screenshot.status === "captured" && entry.screenshot.source === "video-frame").length,
      unavailableScreenshotCount: included.filter((entry) => entry.screenshot.status === "unavailable").length,
      consoleEntryCount: consoleEntries.length,
      networkEntryCount: networkEntries.length
    }
  });
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

async function startSessionImpl(payload: Extract<RuntimeMessage, { type: "session/start" }>["payload"]): Promise<RecordingSession> {
  const previousCommand = await db.getCommand(payload.commandId);
  if (previousCommand) {
    if (previousCommand.kind !== "start") throw new Error(`指令类型冲突 (COMMAND_KIND_CONFLICT:${payload.commandId})`);
    const previousSession = await db.getSession(previousCommand.sessionId);
    if (previousSession) return previousSession;
    throw new Error(`指令对应会话不存在 (COMMAND_SESSION_MISSING:${payload.commandId})`);
  }
  const tab = await chrome.tabs.get(payload.tabId);
  const options = normalizeRecordingOptions(payload.options, await db.getStoragePolicy());
  const browserEpoch = await browserEpochPromise;
  const session: RecordingSession = {
    id: crypto.randomUUID(),
    schemaVersion: 2,
    extensionVersion: EXTENSION_VERSION,
    status: "PREPARING",
    target: {
      tabId: payload.tabId,
      windowId: tab.windowId,
      initialUrl: sanitizeUrl(tab.url ?? "", options.privacyMode),
      initialTitle: sanitizeText(tab.title ?? "", options.privacyMode, 256)
    },
    options,
    timeline: { createdAtEpochMs: Date.now() },
    quality: { overall: "complete", interactionCount: 0, confirmedInteractionCount: 0, primaryScreenshotCount: 0, fallbackScreenshotCount: 0, unavailableScreenshotCount: 0, consoleEntryCount: 0, networkEntryCount: 0, issues: [] },
    nonce: crypto.randomUUID(),
    commandIds: { start: payload.commandId },
    browserEpoch,
    resumedFromSessionId: payload.resumedFromSessionId,
    storage: { usedBytes: 0 }
  };
  const claim = await db.claimSession(session);
  if (!claim.claimed) {
    if (claim.session.commandIds?.start === payload.commandId) return claim.session;
    throw new Error(`已有活动会话在录制中 (SESSION_ALREADY_ACTIVE:${claim.session.id})`);
  }

  let mediaStarted = false;
  try {
    const streamId = !options.captureVideo ? undefined : payload.streamId
      ? payload.streamId
      : await new Promise<string>((resolve, reject) => chrome.tabCapture.getMediaStreamId({ targetTabId: payload.tabId }, (id) => id ? resolve(id) : reject(chrome.runtime.lastError ?? new Error("未返回媒体流 ID")))).catch(() => undefined);
    await ensureOffscreen();
    await contentScripts.activate(payload.tabId);
    const debuggerIssue = options.captureConsole || options.captureNetwork ? await cdpCollector.attach(payload.tabId, session) : undefined;
    const issues: CaptureIssue[] = debuggerIssue ? [debuggerIssue] : [];
    if (streamId) {
      const mediaResponse = await chrome.runtime.sendMessage(message("offscreen/start-media", { streamId, sessionId: session.id, captureAudio: options.captureAudio, timesliceMs: options.mediaTimesliceMs }, session.id)).catch((error) => ({ ok: false, error: String(error) }));
      if (mediaResponse?.ok) mediaStarted = true;
      else issues.push(issue("MEDIA_RECORDER_FAILED", sanitizeText(mediaResponse?.error ?? "媒体录制启动失败", options.privacyMode), "media", false));
    } else if (options.captureVideo) {
      issues.push(issue("MEDIA_STREAM_ID_FAILED", "未取得标签页媒体流，已进入降级录制。", "media", false));
    }
    const started = await applySessionEvent(session.id, { type: "started", atEpochMs: Date.now(), issues });
    if (["RECORDING", "DEGRADED"].includes(started.status)) {
      await chrome.action.setBadgeText({ tabId: payload.tabId, text: "REC" }).catch(() => undefined);
      await chrome.action.setBadgeBackgroundColor({ tabId: payload.tabId, color: "#d92d20" }).catch(() => undefined);
      await chrome.action.setIcon({ tabId: payload.tabId, path: "icons/icon_recording.png" }).catch(() => undefined);
    } else if (mediaStarted) {
      await chrome.runtime.sendMessage(message("offscreen/stop-media", { sessionId: session.id }, session.id)).catch(() => undefined);
    }
    return started;
  } catch (error) {
    if (mediaStarted) await chrome.runtime.sendMessage(message("offscreen/stop-media", { sessionId: session.id }, session.id)).catch(() => undefined);
    const failure = issue("SESSION_START_FAILED", sanitizeText(String(error), options.privacyMode), "media", false);
    const failed = await applySessionEvent(session.id, { type: "failed", issue: failure });
    await db.clearActive(session.id);
    await cdpCollector.detach(payload.tabId);
    await contentScripts.remove(payload.tabId);
    await chrome.action.setBadgeText({ tabId: payload.tabId, text: "" }).catch(() => undefined);
    return failed;
  }
}

function startSession(payload: Extract<RuntimeMessage, { type: "session/start" }>["payload"]): Promise<RecordingSession> {
  return recordingCoordinator.runLifecycle(() => startSessionImpl(payload));
}

async function continueInterruptedSession(sessionId: string, commandId: string): Promise<RecordingSession> {
  const previous = await db.getSession(sessionId);
  if (!previous) throw new Error(`未找到中断会话 (SESSION_NOT_FOUND:${sessionId})`);
  if (!previous.quality.issues.some((entry) => entry.code.startsWith("SESSION_") || entry.code === "MEDIA_CONTEXT_LOST")) {
    throw new Error("该会话未处于可继续状态");
  }
  const tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!tab?.id) throw new Error("无法读取当前标签页，无法继续录制");
  return startSession({ tabId: tab.id, options: previous.options, commandId, resumedFromSessionId: previous.id });
}

async function performStopSession(session: RecordingSession, commandId?: string): Promise<RecordingSession | undefined> {
  if (["PREVIEW_READY", "EXPORTED", "FAILED"].includes(session.status)) return session;
  const stopping = await applySessionEvent(session.id, { type: "stop-requested", atEpochMs: Date.now(), commandId });
  if (commandId && stopping.commandIds?.stop && stopping.commandIds.stop !== commandId) return stopping;
  recordingCoordinator.beginStopping(session.id);
  const cleanupErrors: string[] = [];
  try {
    await cdpCollector.detach(session.target.tabId);
    await contentScripts.remove(session.target.tabId);

    const mediaResponse = await chrome.runtime.sendMessage(message("offscreen/stop-media", { sessionId: session.id }, session.id)).catch((error) => ({ ok: false, error: String(error) }));
    if (mediaResponse?.ok === false) cleanupErrors.push(`媒体停止失败：${mediaResponse.error ?? "未知错误"}`);

    cleanupErrors.push(...await interactionCapture.drain());

    cleanupErrors.push(...await cdpCollector.drain());
    await cdpCollector.finalizeNetworkBodies(stopping).catch((error) => cleanupErrors.push(`Network 正文收尾失败：${String(error)}`));
    await reconcileSessionQuality(session.id).catch((error) => cleanupErrors.push(`质量摘要重算失败：${String(error)}`));
  } finally {
    await cdpCollector.detach(session.target.tabId);
    await contentScripts.remove(session.target.tabId);
    await chrome.action.setBadgeText({ tabId: session.target.tabId, text: "" }).catch(() => undefined);
    await chrome.action.setIcon({ tabId: session.target.tabId, path: "icons/icon_idle.png" }).catch(() => undefined);
  }

  const cleanupIssue = cleanupErrors.length
    ? issue("SESSION_STOP_PARTIAL", sanitizeText(cleanupErrors.join("；"), session.options.privacyMode), "storage")
    : undefined;
  try {
    const next = await db.updateSession(session.id, (current) => ({
      ...reduceSession(current, { type: "stop-completed", issue: cleanupIssue }),
      previewPending: true
    }));
    if (!next) throw new Error(`未找到会话 (SESSION_NOT_FOUND:${session.id})`);
    return await openPendingPreview(next);
  } finally {
    recordingCoordinator.finishStopping(session.id);
  }
}

async function stopSessionImpl(commandId?: string): Promise<RecordingSession | undefined> {
  let session: RecordingSession | undefined;
  if (commandId) {
    const previousCommand = await db.getCommand(commandId);
    if (previousCommand) {
      if (previousCommand.kind !== "stop") throw new Error(`指令类型冲突 (COMMAND_KIND_CONFLICT:${commandId})`);
      session = await db.getSession(previousCommand.sessionId);
      if (!session) throw new Error(`指令对应会话不存在 (COMMAND_SESSION_MISSING:${commandId})`);
    }
  }
  if (!session) session = await db.getActiveSession();
  if (!session) return undefined;
  if (commandId && !(await db.getCommand(commandId))) {
    const claimed = await db.claimCommand({ commandId, kind: "stop", sessionId: session.id, createdAtEpochMs: Date.now() });
    if (!claimed.claimed) {
      if (claimed.command.kind !== "stop") throw new Error(`指令类型冲突 (COMMAND_KIND_CONFLICT:${commandId})`);
      session = await db.getSession(claimed.command.sessionId) ?? session;
    }
  }
  return recordingCoordinator.runStop(session.id, () => performStopSession(session!, commandId));
}

function stopSession(commandId?: string): Promise<RecordingSession | undefined> {
  return recordingCoordinator.runLifecycle(() => stopSessionImpl(commandId));
}

async function openPendingPreview(session: RecordingSession): Promise<RecordingSession> {
  if (!session.previewPending) return session;
  const previewUrl = chrome.runtime.getURL(`preview.html?sessionId=${encodeURIComponent(session.id)}`);
  const existing = await chrome.tabs.query({}).then(
    (tabs) => tabs.some((tab) => tab.url === previewUrl),
    () => false
  );
  const opened = existing || await chrome.tabs.create({ url: previewUrl }).then(() => true).catch(() => false);
  if (!opened) return session;
  return await db.updateSessionAndClearActive(session.id, (current) => ({ ...current, previewPending: false }))
    ?? { ...session, previewPending: false };
}

async function recoverInterruptedSession(session: RecordingSession, code: string, messageText: string): Promise<void> {
  await reconcileSessionQuality(session.id).catch(() => undefined);
  const recovered = await db.updateSession(session.id, (current) => ({
    ...reduceSession(current, {
      type: "recover",
      atEpochMs: Date.now(),
      issue: issue(code, messageText, "storage")
    }),
    previewPending: true
  }));
  if (!recovered) return;
  await cdpCollector.detach(session.target.tabId);
  await contentScripts.remove(session.target.tabId);
  await chrome.action.setBadgeText({ tabId: session.target.tabId, text: "" }).catch(() => undefined);
  await chrome.action.setIcon({ tabId: session.target.tabId, path: "icons/icon_idle.png" }).catch(() => undefined);
  await openPendingPreview(recovered);
}

async function bootstrapRuntimeState(): Promise<void> {
  await db.cleanupExpiredSessions().catch(() => undefined);
  const browserEpoch = await browserEpochPromise;
  const session = await db.getActiveSession();
  if (!session) return;

  if (!["PREPARING", "RECORDING", "DEGRADED", "STOPPING"].includes(session.status)) {
    if (session.previewPending) await openPendingPreview(session);
    else await db.clearActive(session.id);
    return;
  }

  if (!session.browserEpoch || session.browserEpoch !== browserEpoch) {
    await recoverInterruptedSession(session, "SESSION_INTERRUPTED_BY_BROWSER_RESTART", "浏览器重启中断了录制，已保留现有证据。");
    return;
  }

  if (session.status === "STOPPING") {
    await stopSession(session.commandIds?.stop);
    return;
  }

  if (session.status === "PREPARING") {
    await recoverInterruptedSession(session, "SESSION_START_INTERRUPTED", "录制启动过程被中断，已保留启动前证据。");
    return;
  }

  const targetExists = await chrome.tabs.get(session.target.tabId).then(() => true).catch(() => false);
  if (!targetExists) {
    await stopSession(`system:missing-tab:${session.id}`);
    return;
  }

  await contentScripts.restore(session.target.tabId);

  const mediaWasExpected = session.options.captureVideo && !session.quality.issues.some((entry) => entry.code === "MEDIA_STREAM_ID_FAILED" || entry.code === "MEDIA_RECORDER_FAILED");
  if (mediaWasExpected) {
    const contexts = await (chrome.runtime.getContexts as unknown as (filter: unknown) => Promise<chrome.runtime.ExtensionContext[]>)({ contextTypes: ["OFFSCREEN_DOCUMENT"] }).catch(() => []);
    const mediaStatus = contexts.length
      ? await chrome.runtime.sendMessage(message("offscreen/status", { sessionId: session.id }, session.id)).catch(() => undefined)
      : undefined;
    if (!mediaStatus?.active) {
      await applySessionEvent(session.id, { type: "capture-issue", issue: issue("MEDIA_CONTEXT_LOST", "后台恢复后未找到活动的媒体录制上下文。", "media", false) });
    }
  }

  if (session.options.captureConsole || session.options.captureNetwork) {
    const targets = await chrome.debugger.getTargets().catch(() => []);
    if (targets.some((target) => target.tabId === session.target.tabId && target.attached)) {
      cdpCollector.markAttached(session.target.tabId);
    } else {
      const debuggerIssue = await cdpCollector.attach(session.target.tabId, session);
      if (debuggerIssue) await applySessionEvent(session.id, { type: "capture-issue", issue: debuggerIssue });
    }
  }

  await chrome.action.setBadgeText({ tabId: session.target.tabId, text: "REC" }).catch(() => undefined);
  await chrome.action.setBadgeBackgroundColor({ tabId: session.target.tabId, color: "#d92d20" }).catch(() => undefined);
  await chrome.action.setIcon({ tabId: session.target.tabId, path: "icons/icon_recording.png" }).catch(() => undefined);
}

const bootstrapPromise = bootstrapRuntimeState().catch(() => undefined);

chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
  if (!isEnvelope(raw)) return;
  const incoming = raw as RuntimeMessage;
  if (incoming.type === "offscreen/start-media" || incoming.type === "offscreen/stop-media" || incoming.type === "offscreen/status" || incoming.type === "offscreen/annotate-image") return;
  void (async () => {
    try {
      if (incoming.type === "offscreen/media-state") {
        const session = await db.getSession(incoming.payload.sessionId);
        if (session && incoming.payload.state === "error" && sender.url === chrome.runtime.getURL("offscreen.html")) {
          await applySessionEvent(session.id, { type: "capture-issue", issue: issue("MEDIA_RECORDER_FAILED", sanitizeText(incoming.payload.error ?? "媒体录制失败", session.options.privacyMode), "media", false) });
        }
        sendResponse({ ok: true });
        return;
      }
      await bootstrapPromise;
      switch (incoming.type) {
        case "session/start": sendResponse({ ok: true, session: await startSession(incoming.payload) }); return;
        case "session/stop": sendResponse({ ok: true, session: await stopSession(incoming.payload.commandId) }); return;
        case "session/status": sendResponse({ ok: true, session: await db.getActiveSession() }); return;
        case "session/list": sendResponse({ ok: true, sessions: await db.listSessionOverviews(incoming.payload.query) }); return;
        case "session/delete": {
          const active = await db.getActiveSession();
          if (active?.id === incoming.payload.sessionId) throw new Error("不能删除正在录制的会话");
          sendResponse({ ok: true, deleted: await db.deleteSession(incoming.payload.sessionId) });
          return;
        }
        case "session/resume": sendResponse({ ok: true, session: await continueInterruptedSession(incoming.payload.sessionId, incoming.payload.commandId) }); return;
        case "storage/get": sendResponse({ ok: true, storage: await db.getStorageOverview() }); return;
        case "storage/update": sendResponse({ ok: true, policy: await db.saveStoragePolicy(incoming.payload.policy) }); return;
        case "storage/cleanup": sendResponse({ ok: true, deletedSessionIds: await db.cleanupExpiredSessions() }); return;
        case "session/open-preview": await chrome.tabs.create({ url: chrome.runtime.getURL(`preview.html?sessionId=${incoming.payload.sessionId}`) }); sendResponse({ ok: true }); return;
        case "content/hello": {
          const session = await db.getActiveSession();
          const allowed = Boolean(session && ["PREPARING", "RECORDING", "DEGRADED"].includes(session.status) && session.target.tabId === sender.tab?.id);
          sendResponse({ ok: true, active: allowed, sessionId: allowed ? session?.id : undefined, nonce: allowed ? session?.nonce : undefined, startedAtEpochMs: allowed ? session?.timeline.startedAtEpochMs : undefined, privacyMode: allowed ? session?.options.privacyMode : undefined });
          return;
        }
        case "interaction/candidate":
        case "interaction/confirmed": await interactionCapture.handle(incoming.payload.interaction, sender); sendResponse({ ok: true }); return;
        case "interaction/cancelled": await interactionCapture.cancel(incoming.payload.interactionId, incoming.payload.interaction, incoming.sessionId, sender); sendResponse({ ok: true }); return;
        case "offscreen/media-chunk": {
          const result = await db.saveMediaChunkWithinBudget({ id: `${incoming.payload.sessionId}:${incoming.payload.sequence}`, ...incoming.payload });
          sendResponse({ ok: result.stored, error: result.stored ? undefined : "SESSION_STORAGE_LIMIT_REACHED" });
          return;
        }
        default: sendResponse({ ok: false, error: "UNSUPPORTED_MESSAGE" });
      }
    } catch (error) { sendResponse({ ok: false, error: String(error) }); }
  })();
  return true;
});

chrome.debugger.onEvent.addListener((source, method, params) => {
  cdpCollector.handleEvent(source, method, params);
});

chrome.debugger.onDetach.addListener((source, reason) => {
  void bootstrapPromise.then(() => cdpCollector.handleDetach(source, reason));
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => { await bootstrapPromise; const session = await db.getActiveSession(); if (session?.target.tabId === tabId) await stopSession(`system:tab-removed:${session.id}`); })();
});

chrome.runtime.onStartup.addListener(() => { void bootstrapPromise; });
chrome.alarms.create("bug-lens-storage-cleanup", { periodInMinutes: 24 * 60 });
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === "bug-lens-storage-cleanup") void db.cleanupExpiredSessions(); });
