import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { db, getSessionStatusSearchTerms } from "../src/storage/db.ts";
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

  // Framework state evidence
  const frameworkWrite = await db.saveFrameworkStateWithinBudget({
    id: "fw-1",
    sessionId,
    capturedAtEpochMs: Date.now(),
    trigger: "start",
    page: { url: "https://example.test", title: "Page" },
    snapshot: {
      rootComponent: {
        framework: "react",
        version: 18,
        componentName: "App",
      },
      parentChain: [],
    },
  });
  assert.equal(frameworkWrite.stored, true);
  const frameworkStates = await db.getFrameworkStates(sessionId);
  assert.equal(frameworkStates.length, 1);
  assert.equal(
    frameworkStates[0].snapshot?.rootComponent?.componentName,
    "App"
  );

  // Clear all history
  const cleared = await db.clearAllHistory();
  assert.equal(Array.isArray(cleared), true);
});

test("getSessionStatusSearchTerms robustness & prototype pollution defense", () => {
  // 1. Valid SessionStatus values
  assert.ok(getSessionStatusSearchTerms("RECORDING").includes("录制中"));
  assert.ok(getSessionStatusSearchTerms("DEGRADED").includes("录制中（降级）"));
  assert.ok(getSessionStatusSearchTerms("DEGRADED").includes("录制中(降级)"));
  assert.ok(
    getSessionStatusSearchTerms("DEGRADED").includes("Recording (degraded)")
  );
  assert.ok(
    getSessionStatusSearchTerms("DEGRADED").includes("Recording(degraded)")
  );
  assert.ok(getSessionStatusSearchTerms("PREVIEW_READY").includes("已完成"));
  assert.ok(getSessionStatusSearchTerms("PREVIEW_READY").includes("已就绪"));
  assert.ok(getSessionStatusSearchTerms("PREVIEW_READY").includes("完成"));
  assert.ok(getSessionStatusSearchTerms("STOPPING").includes("正在结束"));
  assert.ok(getSessionStatusSearchTerms("STOPPING").includes("结束中"));
  assert.ok(getSessionStatusSearchTerms("IDLE").includes("空闲"));
  assert.ok(getSessionStatusSearchTerms("PREPARING").includes("启动中"));
  assert.ok(getSessionStatusSearchTerms("EXPORTING").includes("正在导出"));
  assert.ok(getSessionStatusSearchTerms("FAILED").includes("失败的"));

  // 2. Prototype pollution defense: must not return Object.prototype functions
  assert.deepEqual(getSessionStatusSearchTerms("toString"), ["toString"]);
  assert.deepEqual(getSessionStatusSearchTerms("valueOf"), ["valueOf"]);
  assert.deepEqual(getSessionStatusSearchTerms("constructor"), ["constructor"]);
  assert.deepEqual(getSessionStatusSearchTerms("hasOwnProperty"), [
    "hasOwnProperty",
  ]);
  assert.deepEqual(getSessionStatusSearchTerms("__proto__"), ["__proto__"]);

  // 3. Null, undefined, empty, non-string safety
  assert.deepEqual(getSessionStatusSearchTerms(undefined), []);
  assert.deepEqual(getSessionStatusSearchTerms(null), []);
  assert.deepEqual(getSessionStatusSearchTerms("" as any), []);
  assert.deepEqual(getSessionStatusSearchTerms(123 as any), []);
  assert.deepEqual(getSessionStatusSearchTerms({} as any), []);

  // 4. Unknown custom status fallback
  assert.deepEqual(getSessionStatusSearchTerms("CUSTOM_UNKNOWN_STATUS"), [
    "CUSTOM_UNKNOWN_STATUS",
  ]);
});

test("db.listSessionOverviews multi-locale session status search", async () => {
  await db.clearAllHistory();

  const now = Date.now();
  const makeTestSession = (
    id: string,
    status: RecordingSession["status"],
    customTitle?: string,
    initialUrl = `https://${id}.example.com`,
    initialTitle = `Page Title for ${id}`,
    offsetMs = 0,
    target?: RecordingSession["target"]
  ): RecordingSession => ({
    id,
    schemaVersion: 2,
    extensionVersion: "0.1.0",
    status,
    customTitle,
    target: target ?? {
      tabId: 1,
      initialUrl,
      initialTitle,
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
    timeline: { createdAtEpochMs: now - offsetMs },
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
    nonce: `nonce-${id}`,
  });

  const sessions: RecordingSession[] = [
    makeTestSession(
      "sess-idle",
      "IDLE",
      undefined,
      "https://idle.test",
      "Idle Page",
      100
    ),
    makeTestSession(
      "sess-prep",
      "PREPARING",
      undefined,
      "https://prep.test",
      "Prep Page",
      200
    ),
    makeTestSession(
      "sess-rec",
      "RECORDING",
      undefined,
      "https://rec.test",
      "Rec Page",
      300
    ),
    makeTestSession(
      "sess-deg",
      "DEGRADED",
      undefined,
      "https://deg.test",
      "Deg Page",
      400
    ),
    makeTestSession(
      "sess-stop",
      "STOPPING",
      undefined,
      "https://stop.test",
      "Stop Page",
      500
    ),
    makeTestSession(
      "sess-ready",
      "PREVIEW_READY",
      undefined,
      "https://ready.test",
      "Ready Page",
      600
    ),
    makeTestSession(
      "sess-exping",
      "EXPORTING",
      undefined,
      "https://exping.test",
      "Exping Page",
      700
    ),
    makeTestSession(
      "sess-exped",
      "EXPORTED",
      undefined,
      "https://exped.test",
      "Exped Page",
      800
    ),
    makeTestSession(
      "sess-fail",
      "FAILED",
      undefined,
      "https://fail.test",
      "Fail Page",
      900
    ),
    makeTestSession(
      "sess-custom",
      "PREVIEW_READY",
      "购物车结算异常崩溃",
      "https://checkout.shop.test/pay",
      "Payment Checkout",
      1000
    ),
    makeTestSession(
      "sess-proto-edge",
      "toString" as any,
      undefined,
      "https://proto.test",
      "Proto Edge Page",
      1100,
      undefined
    ),
  ];

  for (const s of sessions) {
    await db.saveSession(s);
  }

  const findIds = (results: { session: RecordingSession }[]) =>
    results.map((r) => r.session.id);

  // 1. Chinese status labels
  assert.deepEqual(findIds(await db.listSessionOverviews("空闲")), [
    "sess-idle",
  ]);
  assert.deepEqual(findIds(await db.listSessionOverviews("准备中")), [
    "sess-prep",
  ]);
  assert.deepEqual(findIds(await db.listSessionOverviews("启动中")), [
    "sess-prep",
  ]);
  assert.deepEqual(findIds(await db.listSessionOverviews("录制中")), [
    "sess-rec",
    "sess-deg",
  ]);
  assert.deepEqual(findIds(await db.listSessionOverviews("正在录制")), [
    "sess-rec",
  ]);
  assert.deepEqual(findIds(await db.listSessionOverviews("降级")), [
    "sess-deg",
  ]);
  assert.deepEqual(findIds(await db.listSessionOverviews("录制中（降级）")), [
    "sess-deg",
  ]);
  assert.deepEqual(findIds(await db.listSessionOverviews("录制中(降级)")), [
    "sess-deg",
  ]);
  assert.deepEqual(findIds(await db.listSessionOverviews("正在停止")), [
    "sess-stop",
  ]);
  assert.deepEqual(findIds(await db.listSessionOverviews("正在结束")), [
    "sess-stop",
  ]);
  assert.deepEqual(findIds(await db.listSessionOverviews("停止中")), [
    "sess-stop",
  ]);
  assert.deepEqual(findIds(await db.listSessionOverviews("结束中")), [
    "sess-stop",
  ]);
  assert.deepEqual(findIds(await db.listSessionOverviews("已就绪")), [
    "sess-ready",
    "sess-custom",
  ]);
  assert.deepEqual(findIds(await db.listSessionOverviews("已完成")), [
    "sess-ready",
    "sess-custom",
  ]);
  assert.deepEqual(findIds(await db.listSessionOverviews("就绪")), [
    "sess-ready",
    "sess-custom",
  ]);
  assert.deepEqual(findIds(await db.listSessionOverviews("完成")), [
    "sess-ready",
    "sess-custom",
  ]);
  assert.deepEqual(findIds(await db.listSessionOverviews("导出中")), [
    "sess-exping",
  ]);
  assert.deepEqual(findIds(await db.listSessionOverviews("正在导出")), [
    "sess-exping",
  ]);
  assert.deepEqual(findIds(await db.listSessionOverviews("已导出")), [
    "sess-exped",
  ]);
  assert.deepEqual(findIds(await db.listSessionOverviews("失败")), [
    "sess-fail",
  ]);
  assert.deepEqual(findIds(await db.listSessionOverviews("失败的")), [
    "sess-fail",
  ]);

  // 2. English status labels
  assert.deepEqual(findIds(await db.listSessionOverviews("Idle")), [
    "sess-idle",
  ]);
  assert.deepEqual(findIds(await db.listSessionOverviews("Preparing")), [
    "sess-prep",
  ]);
  assert.deepEqual(findIds(await db.listSessionOverviews("Recording")), [
    "sess-rec",
    "sess-deg",
  ]);
  assert.deepEqual(findIds(await db.listSessionOverviews("Degraded")), [
    "sess-deg",
  ]);
  assert.deepEqual(
    findIds(await db.listSessionOverviews("Recording (degraded)")),
    ["sess-deg"]
  );
  assert.deepEqual(
    findIds(await db.listSessionOverviews("Recording(degraded)")),
    ["sess-deg"]
  );
  assert.deepEqual(findIds(await db.listSessionOverviews("Stopping")), [
    "sess-stop",
  ]);
  assert.deepEqual(findIds(await db.listSessionOverviews("Ready")), [
    "sess-ready",
    "sess-custom",
  ]);
  assert.deepEqual(findIds(await db.listSessionOverviews("Exporting")), [
    "sess-exping",
  ]);
  assert.deepEqual(findIds(await db.listSessionOverviews("Exported")), [
    "sess-exped",
  ]);
  assert.deepEqual(findIds(await db.listSessionOverviews("Failed")), [
    "sess-fail",
  ]);

  // 3. Raw SessionStatus enum values
  assert.deepEqual(findIds(await db.listSessionOverviews("IDLE")), [
    "sess-idle",
  ]);
  assert.deepEqual(findIds(await db.listSessionOverviews("PREPARING")), [
    "sess-prep",
  ]);
  assert.deepEqual(findIds(await db.listSessionOverviews("RECORDING")), [
    "sess-rec",
    "sess-deg",
  ]);
  assert.deepEqual(findIds(await db.listSessionOverviews("DEGRADED")), [
    "sess-deg",
  ]);
  assert.deepEqual(findIds(await db.listSessionOverviews("STOPPING")), [
    "sess-stop",
  ]);
  assert.deepEqual(findIds(await db.listSessionOverviews("PREVIEW_READY")), [
    "sess-ready",
    "sess-custom",
  ]);
  assert.deepEqual(findIds(await db.listSessionOverviews("EXPORTING")), [
    "sess-exping",
  ]);
  assert.deepEqual(findIds(await db.listSessionOverviews("EXPORTED")), [
    "sess-exped",
  ]);
  assert.deepEqual(findIds(await db.listSessionOverviews("FAILED")), [
    "sess-fail",
  ]);

  // 4. Case-insensitivity & whitespace trimming
  assert.deepEqual(findIds(await db.listSessionOverviews("  exported  ")), [
    "sess-exped",
  ]);
  assert.deepEqual(findIds(await db.listSessionOverviews("eXpOrTeD")), [
    "sess-exped",
  ]);
  assert.deepEqual(findIds(await db.listSessionOverviews("   ready   ")), [
    "sess-ready",
    "sess-custom",
  ]);
  assert.deepEqual(findIds(await db.listSessionOverviews("   已导出   ")), [
    "sess-exped",
  ]);
  assert.deepEqual(findIds(await db.listSessionOverviews("   录制中   ")), [
    "sess-rec",
    "sess-deg",
  ]);

  // 5. Empty, null, undefined and whitespace-only queries (return all in order)
  const allIds = sessions.map((s) => s.id);
  assert.deepEqual(findIds(await db.listSessionOverviews("")), allIds);
  assert.deepEqual(findIds(await db.listSessionOverviews("   ")), allIds);
  assert.deepEqual(findIds(await db.listSessionOverviews("\t  \n")), allIds);
  assert.deepEqual(findIds(await db.listSessionOverviews(null as any)), allIds);
  assert.deepEqual(
    findIds(await db.listSessionOverviews(undefined as any)),
    allIds
  );

  // 6. Substring matching
  assert.deepEqual(findIds(await db.listSessionOverviews("导")), [
    "sess-exping",
    "sess-exped",
  ]);
  assert.deepEqual(findIds(await db.listSessionOverviews("录制")), [
    "sess-rec",
    "sess-deg",
  ]);
  assert.deepEqual(findIds(await db.listSessionOverviews("Prep")), [
    "sess-prep",
  ]);
  assert.deepEqual(findIds(await db.listSessionOverviews("Fail")), [
    "sess-fail",
  ]);

  // 7. Existing fields matching (customTitle, initialTitle, initialUrl, id)
  assert.deepEqual(findIds(await db.listSessionOverviews("购物车结算")), [
    "sess-custom",
  ]);
  assert.deepEqual(findIds(await db.listSessionOverviews("Payment Checkout")), [
    "sess-custom",
  ]);
  assert.deepEqual(
    findIds(await db.listSessionOverviews("checkout.shop.test")),
    ["sess-custom"]
  );
  assert.deepEqual(findIds(await db.listSessionOverviews("sess-exped")), [
    "sess-exped",
  ]);

  // 8. Edge case: session with prototype-like status name ("toString")
  assert.deepEqual(findIds(await db.listSessionOverviews("toString")), [
    "sess-proto-edge",
  ]);

  // 9. Non-matching query returns empty
  assert.deepEqual(
    findIds(await db.listSessionOverviews("totally-unknown-query-999")),
    []
  );

  // 10. Special characters & regex metacharacters in queries (e.g. ?, *, (, ), [, ], .)
  assert.deepEqual(findIds(await db.listSessionOverviews("(降级)")), [
    "sess-deg",
  ]);
  assert.deepEqual(findIds(await db.listSessionOverviews("（降级）")), [
    "sess-deg",
  ]);
  assert.deepEqual(findIds(await db.listSessionOverviews("(degraded)")), [
    "sess-deg",
  ]);
  assert.deepEqual(findIds(await db.listSessionOverviews("?")), []);
  assert.deepEqual(findIds(await db.listSessionOverviews(".*")), []);
  assert.deepEqual(findIds(await db.listSessionOverviews("[ready]")), []);
  assert.deepEqual(findIds(await db.listSessionOverviews("+")), []);
  assert.deepEqual(findIds(await db.listSessionOverviews("\\")), []);

  // 11. Non-string queries (number, boolean, object) safely return all sessions
  assert.deepEqual(
    findIds(await db.listSessionOverviews(12345 as any)),
    allIds
  );
  assert.deepEqual(findIds(await db.listSessionOverviews(true as any)), allIds);
  assert.deepEqual(findIds(await db.listSessionOverviews({} as any)), allIds);

  // 12. Extremely long query strings
  const longQuery = "a".repeat(10000);
  assert.deepEqual(findIds(await db.listSessionOverviews(longQuery)), []);

  // 13. Lowercase status in session record is case-normalized to status search terms
  const lowercaseStatusSession = makeTestSession(
    "sess-lowercase-rec",
    "recording" as any,
    undefined,
    "https://lower.test",
    "Lower Page",
    1200
  );
  await db.saveSession(lowercaseStatusSession);
  assert.deepEqual(
    (await db.listSessionOverviews("录制中")).some(
      (r) => r.session.id === "sess-lowercase-rec"
    ),
    true
  );

  // 14. Session without target or timeline does not crash listSessionOverviews
  const malformedSession: any = {
    id: "sess-malformed",
    schemaVersion: 2,
    extensionVersion: "0.1.0",
    status: "FAILED",
    nonce: "nonce-malformed",
  };
  await db.saveSession(malformedSession);
  assert.deepEqual(
    (await db.listSessionOverviews("FAILED")).some(
      (r) => r.session.id === "sess-malformed"
    ),
    true
  );
  assert.deepEqual(
    (await db.listSessionOverviews("失败")).some(
      (r) => r.session.id === "sess-malformed"
    ),
    true
  );

  // 16. Kebab-case & snake-case queries matching status aliases
  assert.deepEqual(findIds(await db.listSessionOverviews("preview-ready")), [
    "sess-ready",
    "sess-custom",
  ]);
  assert.deepEqual(
    findIds(await db.listSessionOverviews("recording-degraded")),
    ["sess-deg"]
  );
  assert.deepEqual(
    findIds(await db.listSessionOverviews("recording_degraded")),
    ["sess-deg"]
  );

  // 17. Hyphenated / space-separated status in session record is normalized to status search terms
  const hyphenStatusSession = makeTestSession(
    "sess-hyphen-status",
    "preview-ready" as any,
    undefined,
    "https://hyphen.test",
    "Hyphen Page",
    1300
  );
  await db.saveSession(hyphenStatusSession);
  assert.deepEqual(
    (await db.listSessionOverviews("已完成")).some(
      (r) => r.session.id === "sess-hyphen-status"
    ),
    true
  );
  assert.deepEqual(
    (await db.listSessionOverviews("Ready")).some(
      (r) => r.session.id === "sess-hyphen-status"
    ),
    true
  );

  // 18. Malformed session without id or storage does not crash evidenceFor or measureSessionBytes
  const noIdSession: any = {
    id: "sess-no-storage-or-timeline",
    status: "IDLE",
    nonce: "nonce-nostorage",
  };
  await db.saveSession(noIdSession);
  const noIdOverviews = await db.listSessionOverviews("空闲");
  assert.deepEqual(
    noIdOverviews.some((r) => r.session.id === "sess-no-storage-or-timeline"),
    true
  );

  // 19. Empty database behavior
  await db.clearAllHistory();
  assert.deepEqual(await db.listSessionOverviews(""), []);
  assert.deepEqual(await db.listSessionOverviews("ready"), []);
  assert.deepEqual(await db.listSessionOverviews(null as any), []);
});

test("SESSION_STATUS_SEARCH_TERMS completeness with locales messages.json", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const zhDict = JSON.parse(
    fs.readFileSync(
      path.resolve(process.cwd(), "src/_locales/zh_CN/messages.json"),
      "utf8"
    )
  );
  const enDict = JSON.parse(
    fs.readFileSync(
      path.resolve(process.cwd(), "src/_locales/en/messages.json"),
      "utf8"
    )
  );

  const statusKeyMap: Record<string, string> = {
    IDLE: "sessionStatusIdle",
    PREPARING: "sessionStatusPreparing",
    RECORDING: "sessionStatusRecording",
    DEGRADED: "sessionStatusDegraded",
    STOPPING: "sessionStatusStopping",
    PREVIEW_READY: "sessionStatusPreviewReady",
    EXPORTING: "sessionStatusExporting",
    EXPORTED: "sessionStatusExported",
    FAILED: "sessionStatusFailed",
  };

  for (const [status, key] of Object.entries(statusKeyMap)) {
    const terms = getSessionStatusSearchTerms(status);
    const zhMsg = zhDict[key]?.message;
    const enMsg = enDict[key]?.message;

    assert.ok(zhMsg, `zh_CN messages.json 缺少 ${key}`);
    assert.ok(enMsg, `en messages.json 缺少 ${key}`);

    assert.ok(
      terms.some((t) => t.toLowerCase() === zhMsg.toLowerCase()),
      `SESSION_STATUS_SEARCH_TERMS[${status}] 应包含 zh_CN 文案 "${zhMsg}"`
    );
    assert.ok(
      terms.some((t) => t.toLowerCase() === enMsg.toLowerCase()),
      `SESSION_STATUS_SEARCH_TERMS[${status}] 应包含 en 文案 "${enMsg}"`
    );
  }
});
