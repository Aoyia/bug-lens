import assert from "node:assert/strict";
import test from "node:test";

import "fake-indexeddb/auto";

import { db } from "../src/storage/db.ts";
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
  assert.equal(
    (
      await db.saveConsoleWithinBudget({
        id: "budget:1",
        sessionId: "budget",
        createdAt: 1,
        level: "log",
        text: "ok",
      })
    ).stored,
    true
  );
  assert.equal(
    (
      await db.saveConsoleWithinBudget({
        id: "budget:2",
        sessionId: "budget",
        createdAt: 2,
        level: "log",
        text: "x".repeat(1024),
      })
    ).stored,
    false
  );
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
