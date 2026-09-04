import assert from "node:assert/strict";
import test from "node:test";

import "fake-indexeddb/auto";

import {
  closeEvidenceDatabase,
  db,
  flushStorageBatchQueue,
} from "../src/storage/db.ts";
import {
  setStorageBudgetListener,
  type BudgetWriteResult,
} from "../src/storage/storage-budget.ts";
import type { RecordingSession } from "../src/shared/protocol.ts";

function prepareVersion4Media(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("web-bug-recorder", 4);
    request.onupgradeneeded = () => {
      const database = request.result;
      const store = database.createObjectStore("mediaChunks", {
        keyPath: "id",
      });
      store.createIndex("sessionId", "sessionId");
      for (const sequence of [2, 0, 1]) {
        store.put({
          id: `session:${sequence}`,
          sessionId: "session",
          sequence,
          recordedAt: sequence,
          mimeType: "video/webm",
          chunk: new Uint8Array([sequence]).buffer,
        });
      }
    };
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

test("v4 media upgrades to the composite index and iterates in sequence batches", async () => {
  await prepareVersion4Media();
  const summary = await db.getMediaSummary("session");
  assert.deepEqual(summary, { count: 3, mimeType: "video/webm" });
  const sequences: number[] = [];
  const visited = await db.iterateMediaChunks(
    "session",
    (chunk) => {
      sequences.push(chunk.sequence);
    },
    1
  );
  assert.equal(visited, 3);
  assert.deepEqual(sequences, [0, 1, 2]);

  await db.saveNetwork({
    id: "session:request",
    sessionId: "session",
    createdAt: 1,
    url: "https://example.test",
    method: "GET",
  });
  await db.updateNetworkEntry("session:request", (entry) => ({
    ...entry,
    status: 204,
  }));
  assert.equal((await db.getNetworkEntry("session:request"))?.status, 204);
});

test("session history reports bounded storage and deletion cascades evidence", async () => {
  const session: RecordingSession = {
    id: "budget",
    schemaVersion: 2,
    extensionVersion: "0.2.0",
    status: "PREVIEW_READY",
    target: {
      tabId: 1,
      initialUrl: "https://example.test/path",
      initialTitle: "Budget session",
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
      maxSessionBytes: 256,
      maxResponseBodyBytes: 16 * 1024,
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
    nonce: "nonce",
    storage: { usedBytes: 0 },
  };
  await db.saveSession(session);
  const p1 = db.saveConsoleWithinBudget({
    id: "budget:1",
    sessionId: "budget",
    createdAt: 1,
    level: "log",
    text: "ok",
  });
  const p2 = db.saveConsoleWithinBudget({
    id: "budget:2",
    sessionId: "budget",
    createdAt: 2,
    level: "log",
    text: "x".repeat(1024),
  });
  await flushStorageBatchQueue();
  assert.equal((await p1).stored, true);
  assert.equal((await p2).stored, false);
  const [overview] = await db.listSessionOverviews("budget");
  assert.equal(overview.session.id, "budget");
  assert.equal(
    overview.evidence.find((entry) => entry.kind === "console")?.state,
    "captured"
  );
  assert.equal(await db.deleteSession("budget"), true);
  assert.equal(await db.getSession("budget"), undefined);
  assert.deepEqual(await db.getConsole("budget"), []);
});

test("executeBatchPut chunks entries into MAX_BATCH_SIZE (100) and writes back session accurately", async () => {
  const sessionId = "budget-chunk-test";
  const session: RecordingSession = {
    id: sessionId,
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
      captureNetworkBodies: false,
      privacyMode: "safe",
      mediaTimesliceMs: 1000,
      maxResponseBodyBytes: 1024,
      maxSessionBytes: 10 * 1024 * 1024,
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
    nonce: "nonce-chunk",
    storage: { usedBytes: 0 },
  };
  await db.saveSession(session);

  // Write 250 console entries to exceed 2 full chunks of 100
  const promises: Promise<any>[] = [];
  for (let i = 0; i < 250; i++) {
    promises.push(
      db.saveConsoleWithinBudget({
        id: `chunk-log:${i}`,
        sessionId,
        createdAt: i,
        level: "info",
        text: `Log number ${i}`,
      })
    );
  }

  await flushStorageBatchQueue();
  const results = await Promise.all(promises);
  assert.equal(results.length, 250);
  assert.ok(results.every((r) => r.stored === true));

  const storedLogs = await db.getConsole(sessionId);
  assert.equal(storedLogs.length, 250);

  const updatedSession = await db.getSession(sessionId);
  assert.ok((updatedSession?.storage?.usedBytes ?? 0) > 0);
  assert.equal(updatedSession?.storage?.limitReached, false);

  await db.deleteSession(sessionId);
});

test("executeBatchPut accurately triggers limitReached: true and notifies budgetListener under 1KB quota", async () => {
  const sessionId = "low-quota-test";
  const session: RecordingSession = {
    id: sessionId,
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
      captureNetworkBodies: false,
      privacyMode: "safe",
      mediaTimesliceMs: 1000,
      maxResponseBodyBytes: 1024,
      maxSessionBytes: 1024, // 1KB quota
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
    nonce: "nonce-low-quota",
    storage: { usedBytes: 0 },
  };
  await db.saveSession(session);

  const listenerNotifications: Array<{
    sessionId: string;
    result: BudgetWriteResult;
  }> = [];
  setStorageBudgetListener((sid, result) => {
    listenerNotifications.push({ sessionId: sid, result });
  });

  try {
    // Each log is ~150-200 bytes, so 15 logs will easily exceed 1024 bytes
    const promises: Promise<BudgetWriteResult>[] = [];
    for (let i = 0; i < 15; i++) {
      promises.push(
        db.saveConsoleWithinBudget({
          id: `low-quota-log:${i}`,
          sessionId,
          createdAt: i,
          level: "info",
          text: `Sample log message with content padding to consume bytes #${i}`,
        })
      );
    }

    await flushStorageBatchQueue();
    const results = await Promise.all(promises);
    assert.equal(results.length, 15);

    // Initial logs should be stored, but later logs must be rejected with stored === false and limitReached === true
    const storedCount = results.filter((r) => r.stored === true).length;
    const rejectedCount = results.filter((r) => r.stored === false).length;
    assert.ok(storedCount > 0, "Initial entries within 1KB should be stored");
    assert.ok(rejectedCount > 0, "Entries exceeding 1KB must be rejected");

    // All rejected results must have limitReached === true
    const rejectedResults = results.filter((r) => !r.stored);
    assert.ok(rejectedResults.every((r) => r.limitReached === true));

    // Global budget listener must have received all 15 events
    assert.equal(listenerNotifications.length, 15);
    assert.ok(
      listenerNotifications.some((n) => n.result.limitReached === true)
    );

    // DB session must be updated to limitReached === true
    const updatedSession = await db.getSession(sessionId);
    assert.equal(updatedSession?.storage?.limitReached, true);
    assert.ok((updatedSession?.storage?.usedBytes ?? 0) <= 1024);
  } finally {
    setStorageBudgetListener(undefined);
    await db.deleteSession(sessionId);
  }
});

test("executeBatchPut handles non-existent or empty session IDs without hanging", async () => {
  // Non-existent session
  const res1Promise = db.saveConsoleWithinBudget({
    id: "non-existent-log-1",
    sessionId: "sess-does-not-exist",
    createdAt: Date.now(),
    level: "log",
    text: "Should not hang",
  });
  // Empty session ID
  const res2Promise = db.saveConsoleWithinBudget({
    id: "empty-sess-log-2",
    sessionId: "",
    createdAt: Date.now(),
    level: "log",
    text: "Should also not hang",
  });

  await flushStorageBatchQueue();
  const [r1, r2] = await Promise.all([res1Promise, res2Promise]);

  assert.equal(
    r1.stored,
    false,
    "Non-existent session must return stored: false"
  );
  assert.equal(r2.stored, false, "Empty sessionId must return stored: false");
});

test("executeBatchPut accurately updates network entries and tracks byte deltas", async () => {
  const sessionId = "net-update-test";
  const session: RecordingSession = {
    id: sessionId,
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
      captureVideo: false,
      captureScreenshots: false,
      captureConsole: false,
      captureNetwork: true,
      captureNetworkBodies: true,
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
    nonce: "nonce-net-update",
    storage: { usedBytes: 0 },
  };
  await db.saveSession(session);

  try {
    const netId = `${sessionId}:req-1`;
    // 1. Save initial network entry without body
    const initialRes = await db.saveNetworkWithinBudget({
      id: netId,
      sessionId,
      createdAt: Date.now(),
      startedAtMonotonicMs: 100,
      url: "https://example.test/api/data",
      method: "GET",
    });
    await flushStorageBatchQueue();
    assert.equal(initialRes.stored, true);

    const afterInitial = await db.getSession(sessionId);
    const initialBytes = afterInitial?.storage?.usedBytes ?? 0;
    assert.ok(initialBytes > 0);

    // 2. Update network entry with response body
    const updateRes = await db.updateNetworkEntryWithinBudget(
      netId,
      (current) => ({
        ...current,
        response: {
          status: 200,
          body: JSON.stringify({
            message: "Hello world payload data",
            items: [1, 2, 3],
          }),
        },
      })
    );
    await flushStorageBatchQueue();
    assert.equal(updateRes.stored, true);

    const afterUpdate = await db.getSession(sessionId);
    const updatedBytes = afterUpdate?.storage?.usedBytes ?? 0;
    assert.ok(
      updatedBytes > initialBytes,
      "Used bytes must grow by the delta of the newly attached response body"
    );
  } finally {
    await db.deleteSession(sessionId);
  }
});

test("executeBatchPut recovers seamlessly after closeEvidenceDatabase and database reconnects", async () => {
  const sessionId = "reconnect-test";
  const session: RecordingSession = {
    id: sessionId,
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
    nonce: "nonce-reconnect",
    storage: { usedBytes: 0 },
  };
  await db.saveSession(session);

  try {
    // 1. Initial write
    const res1 = await db.saveConsoleWithinBudget({
      id: "reconnect-log-1",
      sessionId,
      createdAt: Date.now(),
      level: "info",
      text: "Pre-disconnect log",
    });
    await flushStorageBatchQueue();
    assert.equal(res1.stored, true);

    // 2. Simulate database connection close / reset
    closeEvidenceDatabase();

    // 3. Subsequent write should automatically re-open the database and succeed
    const res2 = await db.saveConsoleWithinBudget({
      id: "reconnect-log-2",
      sessionId,
      createdAt: Date.now(),
      level: "info",
      text: "Post-reconnect log",
    });
    await flushStorageBatchQueue();
    assert.equal(res2.stored, true);

    const logs = await db.getConsole(sessionId);
    assert.equal(
      logs.length,
      2,
      "Both logs before and after connection reset must be safely stored"
    );
  } finally {
    await db.deleteSession(sessionId);
  }
});
