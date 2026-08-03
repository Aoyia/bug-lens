import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { db } from "../src/storage/db.ts";
import type { RecordingSession } from "../src/shared/protocol.ts";

test("db storage policy and commands management", async () => {
  await db.saveStoragePolicy({
    retentionDays: 14,
    maxSessionBytes: 200 * 1024 * 1024,
    maxResponseBodyBytes: 2 * 1024 * 1024,
    compression: "balanced",
  });
  const updatedPolicy = await db.getStoragePolicy();
  assert.equal(updatedPolicy.retentionDays, 14);

  const overview = await db.getStorageOverview();
  assert.equal(overview.policy.retentionDays, 14);

  const claimedCmd = await db.claimCommand({
    commandId: "cmd-1",
    kind: "start",
    sessionId: "sess-1",
    createdAtEpochMs: Date.now(),
  });
  assert.equal(claimedCmd.claimed, true);
  const cmd = await db.getCommand("cmd-1");
  assert.equal(cmd?.sessionId, "sess-1");

  const cleaned = await db.cleanupExpiredSessions();
  assert.equal(Array.isArray(cleaned), true);
});

test("db session claim, active clear and update session flow", async () => {
  const session: RecordingSession = {
    id: "sess-db-1",
    schemaVersion: 2,
    extensionVersion: "0.1.0",
    status: "RECORDING",
    target: {
      tabId: 10,
      initialUrl: "https://example.test",
      initialTitle: "DB Test",
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
    nonce: "nonce-db-1",
  };

  const claimed = await db.claimSession(session);
  assert.equal(claimed.claimed, true);

  const active = await db.getActiveSession();
  assert.equal(active?.id, "sess-db-1");

  await db.updateSession("sess-db-1", (curr) => ({
    ...curr,
    status: "PREVIEW_READY",
  }));
  const updated = await db.getSession("sess-db-1");
  assert.equal(updated?.status, "PREVIEW_READY");

  await db.clearActive("sess-db-1");
  const activeAfterClear = await db.getActiveSession();
  assert.equal(activeAfterClear, undefined);
});

test("db interaction, console, network and media chunks CRUD and budget tests", async () => {
  const sessionId = "sess-crud-1";
  const session: RecordingSession = {
    id: sessionId,
    schemaVersion: 2,
    extensionVersion: "0.1.0",
    status: "RECORDING",
    target: {
      tabId: 11,
      initialUrl: "https://example.test",
      initialTitle: "CRUD Test",
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
    nonce: "nonce-crud-1",
  };
  await db.saveSession(session);

  // Interaction
  await db.saveInteraction({
    id: "int-1",
    sessionId,
    kind: "click",
    status: "confirmed",
    createdAt: Date.now(),
    page: { url: "https://example.test", title: "Page", frameId: 0 },
    input: { pointerType: "mouse", button: 0, isTrusted: true },
    coordinates: {
      clientX: 0,
      clientY: 0,
      pageX: 0,
      pageY: 0,
      scrollX: 0,
      scrollY: 0,
      devicePixelRatio: 1,
      viewport: { width: 100, height: 100 },
    },
    element: {
      tagName: "button",
      classNames: [],
      attributes: {},
      locators: [],
    },
    screenshot: { status: "disabled" },
  });
  const interactions = await db.getInteractions(sessionId);
  assert.equal(interactions.length, 1);
  const singleInt = await db.getInteraction("int-1");
  assert.equal(singleInt?.id, "int-1");

  // Console
  const consoleWrite = await db.saveConsoleWithinBudget({
    id: "con-1",
    sessionId,
    createdAt: Date.now(),
    level: "info",
    text: "Console test",
  });
  assert.equal(consoleWrite.stored, true);
  const logs = await db.getConsole(sessionId);
  assert.equal(logs.length, 1);

  // Network
  const netWrite = await db.saveNetworkWithinBudget({
    id: `${sessionId}:req-1`,
    sessionId,
    createdAt: Date.now(),
    url: "https://api.test",
    method: "GET",
    headers: {},
  });
  assert.equal(netWrite.stored, true);

  await db.updateNetworkEntryWithinBudget(`${sessionId}:req-1`, (curr) => ({
    ...curr,
    status: 200,
  }));
  const netEntry = await db.getNetworkEntry(`${sessionId}:req-1`);
  assert.equal(netEntry?.status, 200);

  // Media chunk
  const chunkRes = await db.saveMediaChunkWithinBudget({
    id: "chunk-1",
    sessionId,
    sequence: 0,
    recordedAt: Date.now(),
    mimeType: "video/webm",
    chunk: new Uint8Array([1, 2, 3]).buffer,
  });
  assert.equal(chunkRes.stored, true);

  const summary = await db.getMediaSummary(sessionId);
  assert.equal(summary.count, 1);

  const mediaChunks = await db.getMediaChunks(sessionId);
  assert.equal(mediaChunks.length, 1);

  // Clear all history
  const cleared = await db.clearAllHistory();
  assert.equal(Array.isArray(cleared), true);
});
