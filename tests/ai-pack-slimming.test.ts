import assert from "node:assert/strict";
import test from "node:test";
import {
  buildIssueSceneDomFilesV5,
  computeConsoleSignatureV5,
  foldConsoleEntries,
  processNetworkForSchemaV5,
  pruneInitiatorTopFrame,
  slimFrameworkStatesForV5,
  truncateDataUrl,
} from "../src/export/ai-pack-slimming.ts";
import type {
  FrameworkStateEvidence,
  IssueScene,
  NetworkEntry,
} from "../src/shared/protocol.ts";

test("truncateDataUrl truncates oversized base64 data URLs with MIME and SHA-256 prefix", () => {
  const shortUrl = "data:image/png;base64,iVBORw0KGgo=";
  assert.equal(truncateDataUrl(shortUrl), shortUrl);

  const bigBase64 = "A".repeat(400);
  const bigDataUrl = `data:image/jpeg;base64,${bigBase64}`;
  const truncated = truncateDataUrl(bigDataUrl);
  assert.match(
    truncated,
    new RegExp(
      `^data:image/jpeg;base64,\\[TRUNCATED:size=${bigDataUrl.length},hash=[a-f0-9]{8}\\]$`
    )
  );
});

test("foldConsoleEntries normalizes timestamps/UUIDs/durations with 12-char SHA-256 signature and samples timestamps", () => {
  const base = 1793071570000;
  const entries = [
    {
      id: "c1",
      createdAt: base + 100,
      level: "log",
      text: "poll 1793071570100 cost 12.5ms req 550e8400-e29b-41d4-a716-446655440000",
      source: "consoleAPI",
      url: "https://example.com/app.js",
      lineNumber: 10,
      columnNumber: 2,
      sourceMappedLocation: {
        resolved: false as const,
        failureReason: "FETCH_FAILED" as const,
      },
    },
    {
      id: "c2",
      createdAt: base + 200,
      level: "log",
      text: "poll 1793071570200 cost 99ms req 123e4567-e89b-12d3-a456-426614174000",
      source: "consoleAPI",
    },
    {
      id: "c3",
      createdAt: base + 500,
      level: "error",
      text: "TypeError: boom",
      source: "runtime",
      sourceMappedLocation: {
        resolved: true as const,
        originalFile: "src/app.ts",
        originalLine: 42,
        originalColumn: 8,
        originalFunctionName: "handleClick",
      },
    },
  ];

  const { consoleSummary, metrics } = foldConsoleEntries(entries, base);
  assert.equal(metrics.totalOriginalEntries, 3);
  assert.equal(metrics.uniqueSignatureCount, 2);
  assert.equal(metrics.errorCount, 1);
  assert.equal(metrics.warningCount, 0);

  const poll = consoleSummary[0]!;
  assert.equal(poll.signature, computeConsoleSignatureV5(entries[0]!));
  assert.equal(poll.signature.length, 12);
  assert.equal(poll.count, 2);
  assert.deepEqual(poll.timeRangeMs, [100, 200]);
  assert.equal(poll.sourceMappedLocation, undefined);

  const err = consoleSummary[1]!;
  assert.deepEqual(err.sourceMappedLocation, {
    originalFile: "src/app.ts",
    originalLine: 42,
    originalColumn: 8,
    originalFunctionName: "handleClick",
  });
});

test("pruneInitiatorTopFrame strips deep call stacks and unresolved SourceMap failures", () => {
  const prunedFailed = pruneInitiatorTopFrame({
    type: "script",
    stackTrace: [
      {
        functionName: "doFetch",
        url: "https://example.com/main.js",
        lineNumber: 12,
        columnNumber: 4,
        sourceMappedLocation: {
          resolved: false,
          failureReason: "FETCH_FAILED",
        },
      },
      {
        functionName: "vendorWrap",
        url: "https://example.com/vendor.js",
        lineNumber: 999,
        columnNumber: 1,
      },
    ],
    concise: {
      type: "script",
      topFrame: {
        functionName: "doFetch",
        url: "https://example.com/main.js",
        lineNumber: 12,
        columnNumber: 4,
        sourceMappedLocation: {
          resolved: false,
          failureReason: "FETCH_FAILED",
        },
      },
      stack: [
        { url: "a.js", lineNumber: 1 },
        { url: "b.js", lineNumber: 2 },
      ],
    },
  });

  assert.deepEqual(prunedFailed, {
    type: "script",
    functionName: "doFetch",
    url: "https://example.com/main.js",
    lineNumber: 12,
    columnNumber: 4,
  });
  assert.equal("sourceMappedLocation" in prunedFailed!, false);
});

test("processNetworkForSchemaV5 deduplicates identical responses via CAS, splits >2KB requestBody, and skips binary blobs", () => {
  const duplicatedJson = JSON.stringify({ messages: "same-i18n".repeat(400) });
  const largeReqBody = "k=".concat("x".repeat(3000));
  const entries: NetworkEntry[] = [
    {
      id: "r1",
      sessionId: "s1",
      createdAt: 1050,
      url: "https://example.com/api/i18n",
      method: "GET",
      type: "XHR",
      status: 200,
      statusText: "OK",
      response: {
        mimeType: "application/json",
        bodyStatus: "captured",
        body: duplicatedJson,
        byteLength: duplicatedJson.length,
        fromDiskCache: true,
      },
    },
    {
      id: "r2",
      sessionId: "s1",
      createdAt: 1100,
      url: "https://example.com/api/i18n?retry=1",
      method: "POST",
      type: "XHR",
      status: 500,
      statusText: "Internal Error",
      requestBody: largeReqBody,
      response: {
        mimeType: "application/json",
        bodyStatus: "captured",
        body: duplicatedJson,
        byteLength: duplicatedJson.length,
      },
    },
    {
      id: "r3",
      sessionId: "s1",
      createdAt: 1150,
      url: "https://example.com/logo.png",
      method: "GET",
      type: "Image",
      status: 200,
      statusText: "OK",
      response: {
        mimeType: "image/png",
        bodyStatus: "redacted",
        redactionReason: "binary-body",
        byteLength: 4096,
      },
    },
  ];

  const out = processNetworkForSchemaV5(entries, 1000);
  // r1 & r2 response bodies share 1 blob + r2 large request body uses 1 blob => 2 blobs total
  assert.equal(out.blobFiles.length, 2);
  assert.equal(out.casStats.totalBlobCount, 2);
  assert.equal(out.casStats.deduplicatedBytesSaved, duplicatedJson.length);
  assert.equal(out.metrics.casDeduplicatedCount, 1);
  assert.equal(out.metrics.failedRequests, 1);

  const e1 = out.networkEntries[0] as any;
  const e2 = out.networkEntries[1] as any;
  const e3 = out.networkEntries[2] as any;
  assert.equal(e1.response.fromCache, true);
  assert.equal(e1.response.bodyHash, e2.response.bodyHash);
  assert.ok(e2.request.bodyHash);
  assert.equal(e2.request.body, undefined);
  assert.equal(e3.response.isBinary, true);
  assert.equal(e3.response.bodyHash, undefined);
  assert.ok(out.networkDetails["r2"]?.requestBodyBlob);
});

test("slimFrameworkStatesForV5 emits baseline once and incremental webStorageDiff afterward", () => {
  const states: FrameworkStateEvidence[] = [
    {
      id: "f1",
      sessionId: "s1",
      capturedAtEpochMs: 100,
      trigger: "start",
      page: { url: "https://example.com", title: "Home" },
      webStorage: {
        localStorage: { theme: "light", token: "abc" },
        sessionStorage: { step: "1" },
        redactedValues: false,
      },
    },
    {
      id: "f2",
      sessionId: "s1",
      capturedAtEpochMs: 200,
      trigger: "interaction",
      page: { url: "https://example.com", title: "Home" },
      webStorage: {
        localStorage: { theme: "dark", token: "abc" },
        sessionStorage: {},
        redactedValues: false,
      },
    },
    {
      id: "f3",
      sessionId: "s1",
      capturedAtEpochMs: 300,
      trigger: "issue-scene",
      page: { url: "https://example.com", title: "Home" },
      webStorage: {
        localStorage: { theme: "dark", token: "abc" },
        sessionStorage: {},
        redactedValues: false,
      },
    },
  ];

  const slimmed = slimFrameworkStatesForV5(states) as Array<
    Record<string, any>
  >;
  assert.ok(slimmed[0]!.webStorage);
  assert.equal(slimmed[0]!.webStorageDiff, undefined);

  assert.equal(slimmed[1]!.webStorage, undefined);
  assert.deepEqual(slimmed[1]!.webStorageDiff, {
    localStorageChanged: { theme: "dark" },
    sessionStorageChanged: { step: null },
  });

  // 没有任何变更时不输出冗余 webStorageDiff
  assert.equal(slimmed[2]!.webStorage, undefined);
  assert.equal(slimmed[2]!.webStorageDiff, undefined);
});

test("buildIssueSceneDomFilesV5 emits dom-context.json and dom-styles.json", () => {
  const scene: IssueScene = {
    id: "scene-1",
    sessionId: "s1",
    status: "complete",
    observedAtEpochMs: 1000,
    page: {
      url: "https://example.com",
      title: "T",
      frameId: 0,
      viewport: { width: 800, height: 600 },
      scrollX: 0,
      scrollY: 0,
      devicePixelRatio: 1,
    },
    target: {
      capturedAtEpochMs: 1000,
      element: {
        tagName: "button",
        id: "submit",
        classNames: ["primary"],
        attributes: {},
        boundingBox: { x: 10, y: 20, width: 80, height: 32 },
        locators: [],
      },
      ancestors: [{ tagName: "form", classNames: ["login"] }],
      state: { disabled: false },
      computedStyle: { display: "flex", color: "rgb(255, 0, 0)" },
    },
    annotation: {
      type: "arrow-box",
      color: "#ef233c",
      point: { xRatio: 0.5, yRatio: 0.5 },
    },
    screenshot: { status: "captured" },
    issues: [],
  };

  const files = buildIssueSceneDomFilesV5(scene);
  assert.deepEqual(
    files.map((f) => f.name),
    ["issues/scene-1/dom-context.json", "issues/scene-1/dom-styles.json"]
  );
  const styles = JSON.parse(new TextDecoder().decode(files[1]!.data));
  assert.equal(styles.computedLayoutStyles.display, "flex");
  assert.equal(styles.computedLayoutStyles.color, "rgb(255, 0, 0)");
});
