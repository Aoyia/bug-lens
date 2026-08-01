import assert from "node:assert/strict";
import test from "node:test";
import { CdpEvidenceCollector } from "../src/evidence/cdp-evidence-collector.ts";
import type { RecordingSession } from "../src/shared/protocol.ts";
import type { EvidenceRepository } from "../src/storage/db.ts";

function createMockRepository(): EvidenceRepository {
  const sessions = new Map<string, RecordingSession>();
  const consoleEntries: any[] = [];
  const networkEntries: any[] = [];
  let activeSessionId: string | undefined;

  return {
    async getActiveSession() {
      return activeSessionId ? sessions.get(activeSessionId) ?? null : null;
    },
    async saveConsole(entry) {
      consoleEntries.push(entry);
    },
    async saveConsoleWithinBudget(entry) {
      consoleEntries.push(entry);
      return { stored: true, entry };
    },
    async getConsole(sessionId) {
      return consoleEntries.filter((e) => e.sessionId === sessionId);
    },
    async getNetwork(sessionId) {
      return networkEntries.filter((e) => e.sessionId === sessionId);
    },
    async getNetworkEntry(id) {
      return networkEntries.find((e) => e.id === id) ?? null;
    },
    async saveNetwork(entry) {
      const idx = networkEntries.findIndex((e) => e.id === entry.id);
      if (idx >= 0) networkEntries[idx] = entry;
      else networkEntries.push(entry);
    },
    async saveNetworkWithinBudget(entry) {
      const idx = networkEntries.findIndex((e) => e.id === entry.id);
      if (idx >= 0) networkEntries[idx] = entry;
      else networkEntries.push(entry);
      return { stored: true, entry };
    },
    async updateNetworkEntry(id, updater) {
      const entry = networkEntries.find((e) => e.id === id);
      if (!entry) return null;
      const updated = updater(entry);
      const idx = networkEntries.findIndex((e) => e.id === id);
      networkEntries[idx] = updated;
      return updated;
    },
    async updateNetworkEntryWithinBudget(id, updater) {
      const entry = networkEntries.find((e) => e.id === id);
      if (!entry) return { stored: false };
      const updated = updater(entry);
      const idx = networkEntries.findIndex((e) => e.id === id);
      networkEntries[idx] = updated;
      return { stored: true, entry: updated };
    },
    // Helper to seed active session
    setActiveSession(session: RecordingSession) {
      sessions.set(session.id, session);
      activeSessionId = session.id;
    }
  } as unknown as EvidenceRepository & { setActiveSession: (s: RecordingSession) => void };
}

test("CdpEvidenceCollector attach and detach handles debugger calls", async () => {
  const repository = createMockRepository();
  const writeSessionEvent = async (_id: string, _event: any) => ({}) as RecordingSession;
  const collector = new CdpEvidenceCollector(repository, writeSessionEvent, () => false);

  const attachedCommands: string[] = [];
  let detached = false;

  (globalThis as any).chrome = {
    debugger: {
      attach: async (_target: any, _version: string) => {},
      detach: async (_target: any) => { detached = true; },
      sendCommand: async (_target: any, method: string) => { attachedCommands.push(method); }
    }
  };

  const session: RecordingSession = {
    id: "sess-1",
    schemaVersion: 2,
    extensionVersion: "0.1.0",
    status: "RECORDING",
    target: { tabId: 1, initialUrl: "https://example.test", initialTitle: "Test" },
    options: {
      captureAudio: false,
      captureVideo: true,
      captureScreenshots: true,
      captureConsole: true,
      captureNetwork: true,
      captureNetworkBodies: true,
      privacyMode: "safe",
      mediaTimesliceMs: 1000,
      maxResponseBodyBytes: 1024 * 1024,
      maxSessionBytes: 100 * 1024 * 1024
    },
    timeline: { createdAtEpochMs: Date.now() },
    quality: { overall: "complete", interactionCount: 0, confirmedInteractionCount: 0, primaryScreenshotCount: 0, fallbackScreenshotCount: 0, unavailableScreenshotCount: 0, consoleEntryCount: 0, networkEntryCount: 0, issues: [] },
    nonce: "nonce-1"
  };

  const issue = await collector.attach(1, session);
  assert.equal(issue, undefined);
  assert.deepEqual(attachedCommands, ["Runtime.enable", "Log.enable", "Network.enable"]);

  await collector.detach(1);
  assert.equal(detached, true);
});

test("CdpEvidenceCollector handles Log.entryAdded and Console.messageAdded events", async () => {
  const repository = createMockRepository();
  const session: RecordingSession = {
    id: "sess-1",
    schemaVersion: 2,
    extensionVersion: "0.1.0",
    status: "RECORDING",
    target: { tabId: 1, initialUrl: "https://example.test", initialTitle: "Test" },
    options: {
      captureAudio: false, captureVideo: true, captureScreenshots: true, captureConsole: true, captureNetwork: true, captureNetworkBodies: true, privacyMode: "safe", mediaTimesliceMs: 1000, maxResponseBodyBytes: 1024, maxSessionBytes: 100
    },
    timeline: { createdAtEpochMs: Date.now() },
    quality: { overall: "complete", interactionCount: 0, confirmedInteractionCount: 0, primaryScreenshotCount: 0, fallbackScreenshotCount: 0, unavailableScreenshotCount: 0, consoleEntryCount: 0, networkEntryCount: 0, issues: [] },
    nonce: "nonce-1"
  };
  (repository as any).setActiveSession(session);

  const collector = new CdpEvidenceCollector(repository, async () => session, () => false);
  collector.markAttached(1);

  collector.handleEvent({ tabId: 1 }, "Log.entryAdded", {
    entry: { level: "error", text: "Something went wrong token=secret", timestamp: Date.now(), url: "https://example.test/app.js" }
  });

  const drainErrors = await collector.drain();
  assert.equal(drainErrors.length, 0);

  const consoleLogs = await repository.getConsole("sess-1");
  assert.equal(consoleLogs.length, 1);
  assert.equal(consoleLogs[0].level, "error");
  assert.match(consoleLogs[0].text, /REDACTED/);
});

test("CdpEvidenceCollector handles Network events flow and finalization", async () => {
  const repository = createMockRepository();
  const session: RecordingSession = {
    id: "sess-net",
    schemaVersion: 2,
    extensionVersion: "0.1.0",
    status: "RECORDING",
    target: { tabId: 2, initialUrl: "https://example.test", initialTitle: "Test" },
    options: {
      captureAudio: false, captureVideo: true, captureScreenshots: true, captureConsole: true, captureNetwork: true, captureNetworkBodies: true, privacyMode: "safe", mediaTimesliceMs: 1000, maxResponseBodyBytes: 1024, maxSessionBytes: 100
    },
    timeline: { createdAtEpochMs: Date.now() },
    quality: { overall: "complete", interactionCount: 0, confirmedInteractionCount: 0, primaryScreenshotCount: 0, fallbackScreenshotCount: 0, unavailableScreenshotCount: 0, consoleEntryCount: 0, networkEntryCount: 0, issues: [] },
    nonce: "nonce-net"
  };
  (repository as any).setActiveSession(session);

  (globalThis as any).chrome = {
    debugger: {
      sendCommand: async (_target: any, method: string) => {
        if (method === "Network.getResponseBody") {
          return { body: JSON.stringify({ token: "my-secret-token" }), base64Encoded: false };
        }
        return {};
      }
    }
  };

  const collector = new CdpEvidenceCollector(repository, async () => session, () => false);
  collector.markAttached(2);

  // 1. Request will be sent
  collector.handleEvent({ tabId: 2 }, "Network.requestWillBeSent", {
    requestId: "req-1",
    request: { url: "https://api.test/v1/data?token=secret", method: "GET", headers: { Authorization: "Bearer 123" } },
    timestamp: 100,
    wallTime: Date.now() / 1000,
    type: "XHR"
  });

  // 2. Response received
  collector.handleEvent({ tabId: 2 }, "Network.responseReceived", {
    requestId: "req-1",
    response: { status: 200, statusText: "OK", headers: { "content-type": "application/json" }, mimeType: "application/json" },
    timestamp: 102
  });

  // 3. Loading finished
  collector.handleEvent({ tabId: 2 }, "Network.loadingFinished", {
    requestId: "req-1",
    timestamp: 105
  });

  await collector.drain();

  const networkLogs = await repository.getNetwork("sess-net");
  assert.equal(networkLogs.length, 1);
  assert.equal(networkLogs[0].url, "https://api.test/v1/data?token=[REDACTED]");

  await collector.finalizeNetworkBodies(session);
  const updatedNetwork = await repository.getNetwork("sess-net");
  assert.equal(updatedNetwork[0].response?.bodyStatus, "captured");
  assert.match(updatedNetwork[0].response?.body ?? "", /REDACTED/);
});

test("CdpEvidenceCollector handles Runtime.consoleAPICalled, Runtime.exceptionThrown and handleDetach", async () => {
  const repository = createMockRepository();
  const session: RecordingSession = {
    id: "sess-console",
    schemaVersion: 2,
    extensionVersion: "0.1.0",
    status: "RECORDING",
    target: { tabId: 3, initialUrl: "https://example.test", initialTitle: "Test" },
    options: {
      captureAudio: false, captureVideo: true, captureScreenshots: true, captureConsole: true, captureNetwork: true, captureNetworkBodies: true, privacyMode: "safe", mediaTimesliceMs: 1000, maxResponseBodyBytes: 1024, maxSessionBytes: 100
    },
    timeline: { createdAtEpochMs: Date.now() },
    quality: { overall: "complete", interactionCount: 0, confirmedInteractionCount: 0, primaryScreenshotCount: 0, fallbackScreenshotCount: 0, unavailableScreenshotCount: 0, consoleEntryCount: 0, networkEntryCount: 0, issues: [] },
    nonce: "nonce-console"
  };
  (repository as any).setActiveSession(session);

  let writtenEvent: any;
  const collector = new CdpEvidenceCollector(repository, async (_id, evt) => { writtenEvent = evt; return session; }, () => false);
  collector.markAttached(3);

  // consoleAPICalled
  collector.handleEvent({ tabId: 3 }, "Runtime.consoleAPICalled", {
    type: "warn",
    args: [{ value: "Warning token=secret" }],
    timestamp: Date.now()
  });

  // exceptionThrown
  collector.handleEvent({ tabId: 3 }, "Runtime.exceptionThrown", {
    timestamp: Date.now(),
    exceptionDetails: { text: "Uncaught ReferenceError", url: "https://example.test/main.js" }
  });

  await collector.drain();

  const logs = await repository.getConsole("sess-console");
  assert.equal(logs.length, 2);
  assert.equal(logs[0].level, "warn");
  assert.match(logs[0].text, /REDACTED/);
  assert.equal(logs[1].level, "error");
  assert.equal(logs[1].text, "Uncaught ReferenceError");

  // handleDetach
  await collector.handleDetach({ tabId: 3 }, "User canceled");
  assert.equal(writtenEvent?.type, "capture-issue");
  assert.equal(writtenEvent?.issue?.code, "DEBUGGER_DETACHED_BY_DEVTOOLS");
});
