import assert from "node:assert/strict";
import test from "node:test";
import {
  CdpEvidenceCollector,
  getNetworkEnableParams,
} from "../src/evidence/cdp-evidence-collector.ts";
import type { RecordingSession } from "../src/shared/protocol.ts";
import type { EvidenceRepository } from "../src/storage/db.ts";

function createMockRepository(): EvidenceRepository {
  const sessions = new Map<string, RecordingSession>();
  const consoleEntries: any[] = [];
  const networkEntries: any[] = [];
  let activeSessionId: string | undefined;

  return {
    async getActiveSession() {
      return activeSessionId ? (sessions.get(activeSessionId) ?? null) : null;
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
    },
  } as unknown as EvidenceRepository & {
    setActiveSession: (s: RecordingSession) => void;
  };
}

test("CdpEvidenceCollector attach and detach handles debugger calls", async () => {
  const repository = createMockRepository();
  const writeSessionEvent = async (_id: string, _event: any) =>
    ({}) as RecordingSession;
  const collector = new CdpEvidenceCollector(
    repository,
    writeSessionEvent,
    () => false
  );

  const attachedCommands: string[] = [];
  let detached = false;

  (globalThis as any).chrome = {
    debugger: {
      attach: async (_target: any, _version: string) => {},
      detach: async (_target: any) => {
        detached = true;
      },
      sendCommand: async (_target: any, method: string) => {
        attachedCommands.push(method);
      },
    },
  };

  const session: RecordingSession = {
    id: "sess-1",
    schemaVersion: 2,
    extensionVersion: "0.1.0",
    status: "RECORDING",
    target: {
      tabId: 1,
      initialUrl: "https://example.test",
      initialTitle: "Test",
    },
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
      maxSessionBytes: 100 * 1024 * 1024,
    },
    timeline: { createdAtEpochMs: Date.now() },
    quality: {
      overall: "complete",
      interactionCount: 0,
      confirmedInteractionCount: 0,
      primaryScreenshotCount: 0,
      fallbackScreenshotCount: 0,
      unavailableScreenshotCount: 0,
      consoleEntryCount: 0,
      networkEntryCount: 0,
      issues: [],
    },
    nonce: "nonce-1",
  };

  const issue = await collector.attach(1, session);
  assert.equal(issue, undefined);
  assert.deepEqual(attachedCommands, [
    "Runtime.enable",
    "Log.enable",
    "Network.enable",
    "Target.setAutoAttach",
  ]);

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
    target: {
      tabId: 1,
      initialUrl: "https://example.test",
      initialTitle: "Test",
    },
    options: {
      captureAudio: false,
      captureVideo: true,
      captureScreenshots: true,
      captureConsole: true,
      captureNetwork: true,
      captureNetworkBodies: true,
      privacyMode: "safe",
      mediaTimesliceMs: 1000,
      maxResponseBodyBytes: 1024,
      maxSessionBytes: 100,
    },
    timeline: { createdAtEpochMs: Date.now() },
    quality: {
      overall: "complete",
      interactionCount: 0,
      confirmedInteractionCount: 0,
      primaryScreenshotCount: 0,
      fallbackScreenshotCount: 0,
      unavailableScreenshotCount: 0,
      consoleEntryCount: 0,
      networkEntryCount: 0,
      issues: [],
    },
    nonce: "nonce-1",
  };
  (repository as any).setActiveSession(session);

  const collector = new CdpEvidenceCollector(
    repository,
    async () => session,
    () => false
  );
  collector.markAttached(1);

  collector.handleEvent({ tabId: 1 }, "Log.entryAdded", {
    entry: {
      level: "error",
      text: "Something went wrong token=secret",
      timestamp: Date.now(),
      url: "https://example.test/app.js",
    },
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
    target: {
      tabId: 2,
      initialUrl: "https://example.test",
      initialTitle: "Test",
    },
    options: {
      captureAudio: false,
      captureVideo: true,
      captureScreenshots: true,
      captureConsole: true,
      captureNetwork: true,
      captureNetworkBodies: true,
      privacyMode: "safe",
      mediaTimesliceMs: 1000,
      maxResponseBodyBytes: 1024,
      maxSessionBytes: 100,
    },
    timeline: { createdAtEpochMs: Date.now() },
    quality: {
      overall: "complete",
      interactionCount: 0,
      confirmedInteractionCount: 0,
      primaryScreenshotCount: 0,
      fallbackScreenshotCount: 0,
      unavailableScreenshotCount: 0,
      consoleEntryCount: 0,
      networkEntryCount: 0,
      issues: [],
    },
    nonce: "nonce-net",
  };
  (repository as any).setActiveSession(session);

  (globalThis as any).chrome = {
    debugger: {
      sendCommand: async (_target: any, method: string) => {
        if (method === "Network.getResponseBody") {
          return {
            body: JSON.stringify({ token: "my-secret-token" }),
            base64Encoded: false,
          };
        }
        return {};
      },
    },
  };

  const collector = new CdpEvidenceCollector(
    repository,
    async () => session,
    () => false
  );
  collector.markAttached(2);

  // 1. Request will be sent
  collector.handleEvent({ tabId: 2 }, "Network.requestWillBeSent", {
    requestId: "req-1",
    request: {
      url: "https://api.test/v1/data?token=secret",
      method: "GET",
      headers: { Authorization: "Bearer 123" },
    },
    timestamp: 100,
    wallTime: Date.now() / 1000,
    type: "XHR",
  });

  // 2. Response received
  collector.handleEvent({ tabId: 2 }, "Network.responseReceived", {
    requestId: "req-1",
    response: {
      status: 200,
      statusText: "OK",
      headers: { "content-type": "application/json" },
      mimeType: "application/json",
    },
    timestamp: 102,
  });

  // 3. Loading finished
  collector.handleEvent({ tabId: 2 }, "Network.loadingFinished", {
    requestId: "req-1",
    timestamp: 105,
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
    target: {
      tabId: 3,
      initialUrl: "https://example.test",
      initialTitle: "Test",
    },
    options: {
      captureAudio: false,
      captureVideo: true,
      captureScreenshots: true,
      captureConsole: true,
      captureNetwork: true,
      captureNetworkBodies: true,
      privacyMode: "safe",
      mediaTimesliceMs: 1000,
      maxResponseBodyBytes: 1024,
      maxSessionBytes: 100,
    },
    timeline: { createdAtEpochMs: Date.now() },
    quality: {
      overall: "complete",
      interactionCount: 0,
      confirmedInteractionCount: 0,
      primaryScreenshotCount: 0,
      fallbackScreenshotCount: 0,
      unavailableScreenshotCount: 0,
      consoleEntryCount: 0,
      networkEntryCount: 0,
      issues: [],
    },
    nonce: "nonce-console",
  };
  (repository as any).setActiveSession(session);

  (globalThis as any).chrome = {
    debugger: {
      attach: async (_target: any, _version: string) => {},
      detach: async (_target: any) => {},
      sendCommand: async () => {},
      getTargets: async () => [],
    },
  };

  let writtenEvent: any;
  const collector = new CdpEvidenceCollector(
    repository,
    async (_id, evt) => {
      writtenEvent = evt;
      return session;
    },
    () => false
  );
  collector.markAttached(3);

  // consoleAPICalled
  collector.handleEvent({ tabId: 3 }, "Runtime.consoleAPICalled", {
    type: "warn",
    args: [{ value: "Warning token=secret" }],
    timestamp: Date.now(),
  });

  // exceptionThrown
  collector.handleEvent({ tabId: 3 }, "Runtime.exceptionThrown", {
    timestamp: Date.now(),
    exceptionDetails: {
      text: "Uncaught ReferenceError",
      url: "https://example.test/main.js",
    },
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
  collector.cancelReattach(3);
});

test("CdpEvidenceCollector verifyOwnership and target_closed handleDetach", async () => {
  const repository = createMockRepository();
  const session: RecordingSession = {
    id: "sess-verify",
    schemaVersion: 2,
    extensionVersion: "0.1.0",
    status: "RECORDING",
    target: {
      tabId: 4,
      initialUrl: "https://example.test",
      initialTitle: "Test",
    },
    options: {
      captureAudio: false,
      captureVideo: true,
      captureScreenshots: true,
      captureConsole: true,
      captureNetwork: true,
      captureNetworkBodies: true,
      privacyMode: "safe",
      mediaTimesliceMs: 1000,
      maxResponseBodyBytes: 1024,
      maxSessionBytes: 100,
    },
    timeline: { createdAtEpochMs: Date.now() },
    quality: {
      overall: "complete",
      interactionCount: 0,
      confirmedInteractionCount: 0,
      primaryScreenshotCount: 0,
      fallbackScreenshotCount: 0,
      unavailableScreenshotCount: 0,
      consoleEntryCount: 0,
      networkEntryCount: 0,
      issues: [],
    },
    nonce: "nonce-verify",
  };
  (repository as any).setActiveSession(session);

  let shouldFailSendCommand = false;
  (globalThis as any).chrome = {
    debugger: {
      sendCommand: async (_target: any, method: string) => {
        if (shouldFailSendCommand) throw new Error("Not owned");
      },
    },
  };

  let writtenEvent: any = undefined;
  const collector = new CdpEvidenceCollector(
    repository,
    async (_id, evt) => {
      writtenEvent = evt;
      return session;
    },
    () => false
  );

  const owned = await collector.verifyOwnership(4);
  assert.equal(owned, true);

  shouldFailSendCommand = true;
  const notOwned = await collector.verifyOwnership(4);
  assert.equal(notOwned, false);

  // handleDetach with target_closed should not write capture-issue or schedule reattach
  await collector.handleDetach({ tabId: 4 }, "target_closed");
  assert.equal(writtenEvent, undefined);
});

test("CdpEvidenceCollector R3 - Target.setAutoAttach parameter verification on attach", async () => {
  const repository = createMockRepository();
  const collector = new CdpEvidenceCollector(
    repository,
    async () => ({}) as RecordingSession,
    () => false
  );

  const sentCommands: Array<{ target: any; method: string; params?: any }> = [];

  (globalThis as any).chrome = {
    debugger: {
      attach: async () => {},
      detach: async () => {},
      sendCommand: async (target: any, method: string, params?: any) => {
        sentCommands.push({ target, method, params });
      },
    },
  };

  const session: RecordingSession = {
    id: "sess-autoattach",
    schemaVersion: 2,
    extensionVersion: "0.1.0",
    status: "RECORDING",
    target: {
      tabId: 10,
      initialUrl: "https://example.test",
      initialTitle: "Test",
    },
    options: {
      captureAudio: false,
      captureVideo: true,
      captureScreenshots: true,
      captureConsole: true,
      captureNetwork: true,
      captureNetworkBodies: true,
      privacyMode: "safe",
      mediaTimesliceMs: 1000,
      maxResponseBodyBytes: 1024,
      maxSessionBytes: 100,
    },
    timeline: { createdAtEpochMs: Date.now() },
    quality: {
      overall: "complete",
      interactionCount: 0,
      confirmedInteractionCount: 0,
      primaryScreenshotCount: 0,
      fallbackScreenshotCount: 0,
      unavailableScreenshotCount: 0,
      consoleEntryCount: 0,
      networkEntryCount: 0,
      issues: [],
    },
    nonce: "nonce-autoattach",
  };

  await collector.attach(10, session);

  const autoAttachCmd = sentCommands.find(
    (c) => c.method === "Target.setAutoAttach"
  );
  assert.ok(autoAttachCmd, "Target.setAutoAttach must be sent on attach");
  assert.deepEqual(autoAttachCmd.target, { tabId: 10 });
  assert.deepEqual(autoAttachCmd.params, {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true,
  });

  await collector.detach(10);
});

test("CdpEvidenceCollector R3 - handles Target.attachedToTarget and initializes child sessions", async () => {
  const repository = createMockRepository();
  const session: RecordingSession = {
    id: "sess-oopif",
    schemaVersion: 2,
    extensionVersion: "0.1.0",
    status: "RECORDING",
    target: {
      tabId: 20,
      initialUrl: "https://parent.test",
      initialTitle: "Parent",
    },
    options: {
      captureAudio: false,
      captureVideo: true,
      captureScreenshots: true,
      captureConsole: true,
      captureNetwork: true,
      captureNetworkBodies: true,
      privacyMode: "safe",
      mediaTimesliceMs: 1000,
      maxResponseBodyBytes: 1024,
      maxSessionBytes: 100,
    },
    timeline: { createdAtEpochMs: Date.now() },
    quality: {
      overall: "complete",
      interactionCount: 0,
      confirmedInteractionCount: 0,
      primaryScreenshotCount: 0,
      fallbackScreenshotCount: 0,
      unavailableScreenshotCount: 0,
      consoleEntryCount: 0,
      networkEntryCount: 0,
      issues: [],
    },
    nonce: "nonce-oopif",
  };
  (repository as any).setActiveSession(session);

  const sentCommands: Array<{ target: any; method: string; params?: any }> = [];
  (globalThis as any).chrome = {
    debugger: {
      sendCommand: async (target: any, method: string, params?: any) => {
        sentCommands.push({ target, method, params });
        if (method === "Network.getResponseBody") {
          return { body: "child frame response body", base64Encoded: false };
        }
        return {};
      },
    },
  };

  const collector = new CdpEvidenceCollector(
    repository,
    async () => session,
    () => false
  );
  collector.markAttached(20);

  // 1. Simulate Target.attachedToTarget for an OOPIF iframe
  collector.handleEvent({ tabId: 20 }, "Target.attachedToTarget", {
    sessionId: "child-session-99",
    targetInfo: {
      targetId: "frame-target-99",
      type: "iframe",
      url: "https://iframe.cross-origin.test/login",
      title: "Cross-Origin Frame",
    },
    waitingForDebugger: true,
  });

  await collector.drain();

  // Verify that commands were dispatched to the child session
  const childCommands = sentCommands.filter(
    (c) => c.target.sessionId === "child-session-99" && c.target.tabId === 20
  );
  assert.ok(
    childCommands.length >= 4,
    "Must initialize child session with CDP domains"
  );
  const childMethods = childCommands.map((c) => c.method);
  assert.ok(
    childMethods.includes("Runtime.enable"),
    "Runtime.enable must be sent to child session"
  );
  assert.ok(
    childMethods.includes("Log.enable"),
    "Log.enable must be sent to child session"
  );
  assert.ok(
    childMethods.includes("Network.enable"),
    "Network.enable must be sent to child session"
  );
  assert.ok(
    childMethods.includes("Target.setAutoAttach"),
    "Target.setAutoAttach must be sent recursively"
  );
  assert.ok(
    childMethods.includes("Runtime.runIfWaitingForDebugger"),
    "Runtime.runIfWaitingForDebugger if waiting"
  );

  // 2. Child frame network request capture
  collector.handleEvent(
    { tabId: 20, sessionId: "child-session-99" },
    "Network.requestWillBeSent",
    {
      requestId: "req-child-1",
      request: {
        url: "https://api.cross-origin.test/auth",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        postData: '{"user":"test"}',
      },
      timestamp: 200,
      wallTime: Date.now() / 1000,
      type: "Fetch",
      frameId: "custom-frame-id-1",
      documentURL: "https://iframe.cross-origin.test/login",
    }
  );

  collector.handleEvent(
    { tabId: 20, sessionId: "child-session-99" },
    "Network.responseReceived",
    {
      requestId: "req-child-1",
      response: {
        status: 200,
        mimeType: "application/json",
      },
      timestamp: 201,
    }
  );

  collector.handleEvent(
    { tabId: 20, sessionId: "child-session-99" },
    "Network.loadingFinished",
    {
      requestId: "req-child-1",
      timestamp: 202,
    }
  );

  await collector.drain();

  const netEntries = await repository.getNetwork("sess-oopif");
  assert.equal(netEntries.length, 1);
  assert.equal(netEntries[0].id, "sess-oopif:req-child-1");
  assert.equal(netEntries[0].frameId, "custom-frame-id-1");
  assert.equal(
    netEntries[0].documentUrl,
    "https://iframe.cross-origin.test/login"
  );
  assert.equal(netEntries[0].response?.bodyStatus, "captured");
  assert.equal(netEntries[0].response?.body, "child frame response body");

  // Verify that Network.getResponseBody was routed to the child session
  const getBodyCmd = sentCommands.find(
    (c) => c.method === "Network.getResponseBody"
  );
  assert.ok(getBodyCmd, "Network.getResponseBody must be called");
  assert.equal(
    getBodyCmd.target.sessionId,
    "child-session-99",
    "Must route to child sessionId"
  );
  assert.equal(getBodyCmd.target.tabId, 20);

  // 3. Child frame console & executionContext capture
  collector.handleEvent(
    { tabId: 20, sessionId: "child-session-99" },
    "Runtime.executionContextCreated",
    {
      context: {
        id: 101,
        origin: "https://iframe.cross-origin.test",
        auxData: { frameId: "context-frame-abc" },
      },
    }
  );

  collector.handleEvent(
    { tabId: 20, sessionId: "child-session-99" },
    "Runtime.consoleAPICalled",
    {
      type: "warn",
      args: [{ value: "Warning from child frame" }],
      timestamp: Date.now(),
      executionContextId: 101,
    }
  );

  collector.handleEvent(
    { tabId: 20, sessionId: "child-session-99" },
    "Runtime.exceptionThrown",
    {
      timestamp: Date.now(),
      exceptionDetails: {
        text: "Error in child frame",
        url: "https://iframe.cross-origin.test/bundle.js",
        executionContextId: 101,
      },
    }
  );

  collector.handleEvent(
    { tabId: 20, sessionId: "child-session-99" },
    "Log.entryAdded",
    {
      entry: {
        level: "error",
        text: "Log error from child frame",
        url: "https://iframe.cross-origin.test/login",
      },
    }
  );

  await collector.drain();

  const consoleEntries = await repository.getConsole("sess-oopif");
  assert.equal(consoleEntries.length, 3);
  // consoleAPICalled
  assert.equal(consoleEntries[0].level, "warn");
  assert.equal(consoleEntries[0].text, "Warning from child frame");
  assert.equal(consoleEntries[0].frameId, "context-frame-abc");
  // exceptionThrown
  assert.equal(consoleEntries[1].level, "error");
  assert.equal(consoleEntries[1].text, "Error in child frame");
  assert.equal(consoleEntries[1].frameId, "context-frame-abc");
  // Log.entryAdded
  assert.equal(consoleEntries[2].level, "error");
  assert.equal(consoleEntries[2].text, "Log error from child frame");
  assert.equal(consoleEntries[2].frameId, "frame-target-99");

  // 4. Test finalizeNetworkBodies routing for pending child session requests
  sentCommands.length = 0;
  // Insert a pending network request for the child session
  collector.handleEvent(
    { tabId: 20, sessionId: "child-session-99" },
    "Network.requestWillBeSent",
    {
      requestId: "req-pending-child",
      request: {
        url: "https://api.cross-origin.test/data",
        method: "GET",
      },
      timestamp: 300,
      wallTime: Date.now() / 1000,
      type: "XHR",
    }
  );
  collector.handleEvent(
    { tabId: 20, sessionId: "child-session-99" },
    "Network.responseReceived",
    {
      requestId: "req-pending-child",
      response: { status: 200, mimeType: "application/json" },
      timestamp: 301,
    }
  );
  await collector.drain();

  // Finalize network bodies
  await collector.finalizeNetworkBodies(session);
  const finalizeBodyCmd = sentCommands.find(
    (c) =>
      c.method === "Network.getResponseBody" &&
      c.params?.requestId === "req-pending-child"
  );
  assert.ok(finalizeBodyCmd, "finalizeNetworkBodies must fetch body");
  assert.equal(
    finalizeBodyCmd.target.sessionId,
    "child-session-99",
    "finalizeNetworkBodies must fetch with child sessionId"
  );

  // 5. Test Target.detachedFromTarget cleans up child session
  collector.handleEvent({ tabId: 20 }, "Target.detachedFromTarget", {
    sessionId: "child-session-99",
  });
  await collector.drain();
});

test("CdpEvidenceCollector batches console quality-delta events in memory and flushes on threshold, timer, or drain", async () => {
  const repository = createMockRepository();
  const session: RecordingSession = {
    id: "sess-agg",
    schemaVersion: 2,
    extensionVersion: "0.1.0",
    status: "RECORDING",
    target: {
      tabId: 40,
      initialUrl: "https://example.test",
      initialTitle: "Test",
    },
    options: {
      captureAudio: false,
      captureVideo: true,
      captureScreenshots: true,
      captureConsole: true,
      captureNetwork: false,
      captureNetworkBodies: false,
      privacyMode: "safe",
      mediaTimesliceMs: 1000,
      maxResponseBodyBytes: 1024,
      maxSessionBytes: 100 * 1024 * 1024,
    },
    timeline: { createdAtEpochMs: Date.now() },
    quality: {
      overall: "complete",
      interactionCount: 0,
      confirmedInteractionCount: 0,
      primaryScreenshotCount: 0,
      fallbackScreenshotCount: 0,
      unavailableScreenshotCount: 0,
      consoleEntryCount: 0,
      networkEntryCount: 0,
      issues: [],
    },
    nonce: "nonce-agg",
  };
  (repository as any).setActiveSession(session);

  const deltasWritten: number[] = [];
  const collector = new CdpEvidenceCollector(
    repository,
    async (_id, event: any) => {
      if (event.type === "quality-delta" && event.delta.consoleEntryCount) {
        deltasWritten.push(event.delta.consoleEntryCount);
      }
      return session;
    },
    () => false
  );
  collector.markAttached(40);

  // 1. Send 10 logs: should NOT immediately write 10 individual quality-delta events
  for (let i = 0; i < 10; i++) {
    collector.handleEvent({ tabId: 40 }, "Runtime.consoleAPICalled", {
      type: "log",
      args: [{ value: `Log #${i}` }],
      timestamp: Date.now(),
    });
  }

  // Wait a small microtask tick - no immediate flush expected before timer or threshold
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(
    deltasWritten.length,
    0,
    "Deltas should be aggregated in memory, not flushed immediately"
  );

  // Wait for the 100ms debounce timer to fire
  await new Promise((r) => setTimeout(r, 130));
  assert.equal(
    deltasWritten.length,
    1,
    "Timer should flush aggregated deltas once"
  );
  assert.equal(
    deltasWritten[0],
    10,
    "Flushed delta must equal the 10 aggregated console logs"
  );

  // 2. Send 100 logs in rapid burst: should immediately flush once reaching 100
  for (let i = 0; i < 100; i++) {
    collector.handleEvent({ tabId: 40 }, "Log.entryAdded", {
      entry: {
        level: "info",
        text: `Burst log #${i}`,
        timestamp: Date.now(),
      },
    });
  }
  // Allow microtasks to run
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(
    deltasWritten.length,
    2,
    "Threshold >= 100 should trigger immediate flush"
  );
  assert.equal(
    deltasWritten[1],
    100,
    "Second flush must contain exactly 100 entries"
  );

  // 3. Send 5 logs and call drain(): drain must flush in-flight remaining deltas
  for (let i = 0; i < 5; i++) {
    collector.handleEvent({ tabId: 40 }, "Runtime.consoleAPICalled", {
      type: "log",
      args: [{ value: `Drain log #${i}` }],
      timestamp: Date.now(),
    });
  }
  await collector.drain();
  assert.equal(deltasWritten.length, 3, "drain() must settle pending deltas");
  assert.equal(deltasWritten[2], 5, "Third flush must contain 5 entries");
});

test("CdpEvidenceCollector quality-delta flushes serialize and coalesce during in-flight writeSessionEvent", async () => {
  const repository = createMockRepository();
  const session: RecordingSession = {
    id: "sess-coalesce",
    schemaVersion: 2,
    extensionVersion: "0.1.0",
    status: "RECORDING",
    target: {
      tabId: 50,
      initialUrl: "https://example.test",
      initialTitle: "Test",
    },
    options: {
      captureAudio: false,
      captureVideo: false,
      captureScreenshots: false,
      captureConsole: true,
      captureNetwork: false,
      captureNetworkBodies: false,
      privacyMode: "safe",
      mediaTimesliceMs: 1000,
      maxResponseBodyBytes: 1024,
      maxSessionBytes: 100_000,
    },
    timeline: { createdAtEpochMs: Date.now() },
    quality: {
      overall: "complete",
      interactionCount: 0,
      confirmedInteractionCount: 0,
      primaryScreenshotCount: 0,
      fallbackScreenshotCount: 0,
      unavailableScreenshotCount: 0,
      consoleEntryCount: 0,
      networkEntryCount: 0,
      issues: [],
    },
    nonce: "nonce-coalesce",
  };
  (repository as any).setActiveSession(session);

  const deltasWritten: number[] = [];
  let inFlightWrites = 0;
  let maxConcurrentWrites = 0;

  const collector = new CdpEvidenceCollector(
    repository,
    async (_id, event: any) => {
      if (event.type === "quality-delta" && event.delta.consoleEntryCount) {
        inFlightWrites++;
        maxConcurrentWrites = Math.max(maxConcurrentWrites, inFlightWrites);
        // Simulate async IndexedDB write latency
        await new Promise((r) => setTimeout(r, 40));
        deltasWritten.push(event.delta.consoleEntryCount);
        inFlightWrites--;
      }
      return session;
    },
    () => false
  );
  collector.markAttached(50);

  // Send 100 logs to trigger first flush
  for (let i = 0; i < 100; i++) {
    collector.handleEvent({ tabId: 50 }, "Runtime.consoleAPICalled", {
      type: "log",
      args: [{ value: `Log #${i}` }],
      timestamp: Date.now(),
    });
  }

  // While first flush is in flight, pour 250 more logs in rapid bursts
  for (let i = 100; i < 350; i++) {
    collector.handleEvent({ tabId: 50 }, "Runtime.consoleAPICalled", {
      type: "log",
      args: [{ value: `Burst log #${i}` }],
      timestamp: Date.now(),
    });
  }

  await collector.drain();

  // Flushes must be strictly serialized: max concurrency exactly 1
  assert.equal(
    maxConcurrentWrites,
    1,
    "Quality delta writes must be serialized per session"
  );
  // Total sum of all deltas must exactly match 350 logs
  const totalDeltas = deltasWritten.reduce((acc, d) => acc + d, 0);
  assert.equal(
    totalDeltas,
    350,
    "Total aggregated deltas must equal total console entries"
  );
  // The in-flight burst of 250 logs should have coalesced into a single delta of 250
  assert.deepEqual(
    deltasWritten,
    [100, 250],
    "Burst while in-flight must coalesce into a single second write"
  );
});

test("CdpEvidenceCollector deduplicates SESSION_STORAGE_LIMIT_REACHED for network requests and response bodies", async () => {
  const repository = createMockRepository();
  const session: RecordingSession = {
    id: "sess-net-limit",
    schemaVersion: 2,
    extensionVersion: "0.1.0",
    status: "RECORDING",
    target: {
      tabId: 60,
      initialUrl: "https://example.test",
      initialTitle: "Test",
    },
    options: {
      captureAudio: false,
      captureVideo: false,
      captureScreenshots: false,
      captureConsole: false,
      captureNetwork: true,
      captureNetworkBodies: true,
      privacyMode: "safe",
      mediaTimesliceMs: 1000,
      maxResponseBodyBytes: 1024,
      maxSessionBytes: 1024,
    },
    timeline: { createdAtEpochMs: Date.now() },
    quality: {
      overall: "complete",
      interactionCount: 0,
      confirmedInteractionCount: 0,
      primaryScreenshotCount: 0,
      fallbackScreenshotCount: 0,
      unavailableScreenshotCount: 0,
      consoleEntryCount: 0,
      networkEntryCount: 0,
      issues: [],
    },
    nonce: "nonce-net-limit",
  };
  (repository as any).setActiveSession(session);

  // Mock repository to reject writes due to storage limit
  repository.saveNetworkWithinBudget = async () => ({
    stored: false,
    usedBytes: 1024,
    limitReached: true,
  });

  const capturedIssues: string[] = [];
  const collector = new CdpEvidenceCollector(
    repository,
    async (_id, event: any) => {
      if (event.type === "capture-issue") {
        capturedIssues.push(event.issue.code);
      }
      return session;
    },
    () => false
  );
  collector.markAttached(60);

  // Send 10 network requests that are rejected by budget
  for (let i = 0; i < 10; i++) {
    collector.handleEvent({ tabId: 60 }, "Network.requestWillBeSent", {
      requestId: `req-${i}`,
      request: { url: `https://example.test/api/${i}`, method: "GET" },
      wallTime: Date.now() / 1000,
    });
  }

  await collector.drain();

  // Exactly 1 limit reached issue should be recorded, not 10!
  assert.equal(
    capturedIssues.filter((code) => code === "SESSION_STORAGE_LIMIT_REACHED")
      .length,
    1,
    "Storage limit reached must be deduplicated across multiple network requests"
  );
});

test("CdpEvidenceCollector completely drains late-arriving logs during in-flight flush without leaving unflushed deltas or timers", async () => {
  const repository = createMockRepository();
  const session: RecordingSession = {
    id: "sess-late-burst",
    schemaVersion: 2,
    extensionVersion: "0.1.0",
    status: "RECORDING",
    target: {
      tabId: 70,
      initialUrl: "https://example.test",
      initialTitle: "Test",
    },
    options: {
      captureAudio: false,
      captureVideo: false,
      captureScreenshots: false,
      captureConsole: true,
      captureNetwork: false,
      captureNetworkBodies: false,
      privacyMode: "safe",
      mediaTimesliceMs: 1000,
      maxResponseBodyBytes: 1024,
      maxSessionBytes: 50_000,
    },
    timeline: { createdAtEpochMs: Date.now() },
    quality: {
      overall: "complete",
      interactionCount: 0,
      confirmedInteractionCount: 0,
      primaryScreenshotCount: 0,
      fallbackScreenshotCount: 0,
      unavailableScreenshotCount: 0,
      consoleEntryCount: 0,
      networkEntryCount: 0,
      issues: [],
    },
    nonce: "nonce-late-burst",
  };
  (repository as any).setActiveSession(session);

  const deltasWritten: number[] = [];
  let writeResolve: (() => void) | undefined;

  const collector = new CdpEvidenceCollector(
    repository,
    async (_id, event: any) => {
      if (event.type === "quality-delta" && event.delta.consoleEntryCount) {
        deltasWritten.push(event.delta.consoleEntryCount);
        if (writeResolve) {
          writeResolve();
          writeResolve = undefined;
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      return session;
    },
    () => false
  );
  collector.markAttached(70);

  // 1. Send 100 logs to trigger initial in-flight flush
  for (let i = 0; i < 100; i++) {
    collector.handleEvent({ tabId: 70 }, "Runtime.consoleAPICalled", {
      type: "log",
      args: [{ value: `Log #${i}` }],
      timestamp: Date.now(),
    });
  }

  // 2. While first flush is in-flight, send 10 more logs (fewer than 100 threshold)
  for (let i = 100; i < 110; i++) {
    collector.handleEvent({ tabId: 70 }, "Runtime.consoleAPICalled", {
      type: "log",
      args: [{ value: `Late burst log #${i}` }],
      timestamp: Date.now(),
    });
  }

  // 3. Drain must wait for and flush ALL 110 logs completely, without leaving 10 logs hanging in debounce timer
  await collector.drain();

  const totalDeltas = deltasWritten.reduce((acc, d) => acc + d, 0);
  assert.equal(
    totalDeltas,
    110,
    "All 110 logs including late burst must be completely drained"
  );
  assert.deepEqual(
    deltasWritten,
    [100, 10],
    "Should flush first 100 then drain the remaining 10 in second write"
  );
});

test("getNetworkEnableParams dynamically scales buffers based on captureFullResponseBody", () => {
  const defaultParams = getNetworkEnableParams({
    captureAudio: false,
    captureVideo: true,
    captureScreenshots: true,
    captureConsole: true,
    captureNetwork: true,
    captureNetworkBodies: true,
    privacyMode: "safe",
    mediaTimesliceMs: 1000,
    maxResponseBodyBytes: 2 * 1024 * 1024,
    maxSessionBytes: 512 * 1024 * 1024,
    captureFullResponseBody: false,
  });
  assert.equal(defaultParams.maxTotalBufferSize, 50 * 1024 * 1024);
  assert.equal(defaultParams.maxResourceBufferSize, 10 * 1024 * 1024);
  assert.equal(defaultParams.maxPostDataSize, 1024 * 1024);

  const fullParams = getNetworkEnableParams({
    captureAudio: false,
    captureVideo: true,
    captureScreenshots: true,
    captureConsole: true,
    captureNetwork: true,
    captureNetworkBodies: true,
    privacyMode: "safe",
    mediaTimesliceMs: 1000,
    maxResponseBodyBytes: 2 * 1024 * 1024,
    maxSessionBytes: 512 * 1024 * 1024,
    captureFullResponseBody: true,
  });
  assert.equal(fullParams.maxTotalBufferSize, 200 * 1024 * 1024);
  assert.equal(fullParams.maxResourceBufferSize, 100 * 1024 * 1024);
  assert.equal(fullParams.maxPostDataSize, 1024 * 1024);
});

test("CdpEvidenceCollector sends expanded CDP Network.enable buffers when captureFullResponseBody is true", async () => {
  const repository = createMockRepository();
  const sentCommands: { method: string; params: any }[] = [];
  (globalThis as any).chrome = {
    debugger: {
      attach: async () => {},
      detach: async () => {},
      sendCommand: async (_target: any, method: string, params: any) => {
        sentCommands.push({ method, params });
        return {};
      },
    },
  };

  const session: RecordingSession = {
    id: "sess-full-buffer",
    schemaVersion: 2,
    extensionVersion: "0.1.0",
    status: "RECORDING",
    target: {
      tabId: 88,
      initialUrl: "https://example.test",
      initialTitle: "Buffer Test",
    },
    options: {
      captureAudio: false,
      captureVideo: true,
      captureScreenshots: true,
      captureConsole: true,
      captureNetwork: true,
      captureNetworkBodies: true,
      captureFullResponseBody: true,
      privacyMode: "safe",
      mediaTimesliceMs: 1000,
      maxResponseBodyBytes: 2 * 1024 * 1024,
      maxSessionBytes: 512 * 1024 * 1024,
    },
    timeline: { createdAtEpochMs: Date.now() },
    quality: {
      overall: "complete",
      primaryScreenshotCount: 0,
      consoleEntryCount: 0,
      networkEntryCount: 0,
      issues: [],
    },
    nonce: "nonce-fb",
  };

  const collector = new CdpEvidenceCollector(
    repository,
    async () => session,
    () => false
  );
  await collector.attach(88, session);

  const networkEnableCmd = sentCommands.find(
    (c) => c.method === "Network.enable"
  );
  assert.ok(networkEnableCmd, "Network.enable command must be sent");
  assert.equal(networkEnableCmd.params.maxTotalBufferSize, 200 * 1024 * 1024);
  assert.equal(
    networkEnableCmd.params.maxResourceBufferSize,
    100 * 1024 * 1024
  );
});

test("CdpEvidenceCollector recovers gracefully when Network.getResponseBody fails or times out (aborted/slow stream)", async () => {
  const repository = createMockRepository();
  (globalThis as any).chrome = {
    debugger: {
      attach: async () => {},
      detach: async () => {},
      sendCommand: async (_target: any, method: string) => {
        if (method === "Network.getResponseBody") {
          throw new Error(
            "No resource with given identifier found (stream aborted)"
          );
        }
        return {};
      },
    },
  };

  const session: RecordingSession = {
    id: "sess-stream-abort",
    schemaVersion: 2,
    extensionVersion: "0.1.0",
    status: "RECORDING",
    target: {
      tabId: 99,
      initialUrl: "https://stream.test",
      initialTitle: "Stream Abort Test",
    },
    options: {
      captureAudio: false,
      captureVideo: true,
      captureScreenshots: true,
      captureConsole: true,
      captureNetwork: true,
      captureNetworkBodies: true,
      captureFullResponseBody: true,
      privacyMode: "safe",
      mediaTimesliceMs: 1000,
      maxResponseBodyBytes: 2 * 1024 * 1024,
      maxSessionBytes: 512 * 1024 * 1024,
    },
    timeline: { createdAtEpochMs: Date.now() },
    quality: {
      overall: "complete",
      primaryScreenshotCount: 0,
      consoleEntryCount: 0,
      networkEntryCount: 0,
      issues: [],
    },
    nonce: "nonce-stream-abort",
  };
  (repository as any).setActiveSession(session);

  const collector = new CdpEvidenceCollector(
    repository,
    async () => session,
    () => false
  );
  collector.markAttached(99);

  // 1. Request
  collector.handleEvent({ tabId: 99 }, "Network.requestWillBeSent", {
    requestId: "req-aborted-1",
    request: {
      url: "https://stream.test/api/chunked-aborted",
      method: "GET",
      headers: {},
    },
    timestamp: 200,
    wallTime: Date.now() / 1000,
    type: "XHR",
  });

  // 2. Response received
  collector.handleEvent({ tabId: 99 }, "Network.responseReceived", {
    requestId: "req-aborted-1",
    response: {
      status: 200,
      statusText: "OK",
      headers: { "content-type": "application/json" },
      mimeType: "application/json",
    },
    timestamp: 201,
  });

  // 3. Loading finished, triggering fetchResponseBody which throws
  collector.handleEvent({ tabId: 99 }, "Network.loadingFinished", {
    requestId: "req-aborted-1",
    timestamp: 205,
  });

  await collector.drain();
  await collector.finalizeNetworkBodies(session);

  const entries = await repository.getNetwork("sess-stream-abort");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].response?.bodyStatus, "unavailable");
  assert.ok(
    entries[0].response?.error?.includes("stream aborted"),
    "Error message must record stream abort details"
  );
});

test("CdpEvidenceCollector handles Network.loadingFailed by marking entry unavailable", async () => {
  const repository = createMockRepository();
  const session: RecordingSession = {
    id: "sess-net-failed",
    schemaVersion: 2,
    extensionVersion: "0.1.0",
    status: "RECORDING",
    target: {
      tabId: 101,
      initialUrl: "https://fail.test",
      initialTitle: "Fail Test",
    },
    options: {
      captureAudio: false,
      captureVideo: true,
      captureScreenshots: true,
      captureConsole: true,
      captureNetwork: true,
      captureNetworkBodies: true,
      captureFullResponseBody: true,
      privacyMode: "safe",
      mediaTimesliceMs: 1000,
      maxResponseBodyBytes: 2 * 1024 * 1024,
      maxSessionBytes: 512 * 1024 * 1024,
    },
    timeline: { createdAtEpochMs: Date.now() },
    quality: {
      overall: "complete",
      primaryScreenshotCount: 0,
      consoleEntryCount: 0,
      networkEntryCount: 0,
      issues: [],
    },
    nonce: "nonce-net-fail",
  };
  (repository as any).setActiveSession(session);

  const collector = new CdpEvidenceCollector(
    repository,
    async () => session,
    () => false
  );
  collector.markAttached(101);

  collector.handleEvent({ tabId: 101 }, "Network.requestWillBeSent", {
    requestId: "req-failed-1",
    request: {
      url: "https://fail.test/api/reset",
      method: "GET",
      headers: {},
    },
    timestamp: 300,
    wallTime: Date.now() / 1000,
    type: "XHR",
  });

  collector.handleEvent({ tabId: 101 }, "Network.loadingFailed", {
    requestId: "req-failed-1",
    errorText: "net::ERR_CONNECTION_RESET",
    canceled: false,
    timestamp: 302,
  });

  await collector.drain();

  const entries = await repository.getNetwork("sess-net-failed");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].response?.bodyStatus, "unavailable");
  assert.equal(entries[0].response?.error, "net::ERR_CONNECTION_RESET");
});
