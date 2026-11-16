import { zipSync, strToU8 } from "fflate";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runTriageCli } from "../src/triage-cli/cli.ts";
import {
  LazyFileRegistry,
  MAX_TOTAL_UNCOMPRESSED_BYTES,
} from "../src/triage-cli/pack/lazy-file-registry.ts";
import { verifyPackIntegrity } from "../src/triage-cli/pack/manifest.ts";
import {
  clearPackCache,
  openPackFromBytes,
} from "../src/triage-cli/pack/open.ts";
import { LoadedSessionPack } from "../src/triage-cli/pack/session-pack.ts";
import type { SessionDataPayload } from "../src/triage-cli/pack/types.ts";
import {
  computeConsoleSignature,
  queryConsole,
} from "../src/triage-cli/query/console.ts";
import {
  detectBusinessError,
  queryNetwork,
} from "../src/triage-cli/query/network.ts";

test("Phase A: verifyPackIntegrity rejects tampered disk CAS blobs under network/blobs/", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "tampered-blob-test-"));
  try {
    const blobsDir = join(tempRoot, "network", "blobs");
    mkdirSync(blobsDir, { recursive: true });
    const original = strToU8('{"code":0,"msg":"original"}');
    const originalSha = createHash("sha256").update(original).digest("hex");
    const shortHash = originalSha.slice(0, 16);

    // Same byteLength as original, different content -> detects tampered SHA-256 on disk
    const tampered = strToU8('{"code":0,"msg":"tampered"}');
    assert.equal(tampered.byteLength, original.byteLength);
    writeFileSync(join(blobsDir, `${shortHash}.bin`), tampered);

    const registry = new LazyFileRegistry(tempRoot);
    registry.scanDirectory(tempRoot);

    const report = verifyPackIntegrity(
      {
        schemaVersion: 5,
        files: {
          [`network/blobs/${shortHash}.bin`]: {
            byteLength: original.byteLength,
            sha256: originalSha,
          },
        },
      },
      registry,
      new Set()
    );

    assert.equal(report.valid, false);
    assert.deepEqual(report.mismatches, [
      `network/blobs/${shortHash}.bin: sha256 mismatch`,
    ]);
    // Uncached integrity check must not retain the disk blob in memory
    assert.equal(
      registry.getMetadata(`network/blobs/${shortHash}.bin`)?.inMemoryBuffer,
      undefined
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("Phase A: LazyFileRegistry accounts overwrites, deletes, and evicts disk cache above 16MB", () => {
  const registry = new LazyFileRegistry();
  const chunk = new Uint8Array(40 * 1024 * 1024); // 40 MB
  // Overwriting the same key repeatedly should keep total size at 40 MB, not N * 40 MB
  for (let i = 0; i < 20; i++) {
    registry.registerBuffer("same.bin", chunk);
  }
  // Deleting releases quota so subsequent large registrations succeed
  assert.equal(registry.delete("same.bin"), true);
  assert.equal(registry.delete("same.bin"), false);
  for (let i = 0; i < 12; i++) {
    registry.registerBuffer(`f-${i}.bin`, chunk);
    assert.equal(registry.delete(`f-${i}.bin`), true);
  }
  assert.equal(registry.size, 0);

  // Bounded disk cache: reading 10 x 2MB files (~20MB > 16MB cap) evicts earlier entries
  const tempRoot = mkdtempSync(join(tmpdir(), "lru-disk-cache-"));
  try {
    const twoMb = new Uint8Array(2 * 1024 * 1024);
    for (let i = 0; i < 10; i++) {
      twoMb[0] = i;
      writeFileSync(join(tempRoot, `d-${i}.bin`), twoMb);
    }
    const diskReg = new LazyFileRegistry(tempRoot);
    diskReg.scanDirectory(tempRoot);
    for (let i = 0; i < 10; i++) {
      const read = diskReg.readBytes(`d-${i}.bin`);
      assert.equal(read?.[0], i);
    }
    assert.equal(diskReg.getMetadata("d-0.bin")?.inMemoryBuffer, undefined);
    assert.ok(diskReg.getMetadata("d-9.bin")?.inMemoryBuffer);
    assert.ok(MAX_TOTAL_UNCOMPRESSED_BYTES > 0);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("Phase A: CLI parses explicit boolean false/true without positional pollution", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "cli-bool-flag-"));
  const prevWs = process.env.BUG_LENS_CLI_WORKSPACE;
  process.env.BUG_LENS_CLI_WORKSPACE = join(tempRoot, "ws");
  try {
    clearPackCache();
    const payload: SessionDataPayload = {
      session: { id: "bool-test", timeline: { createdAtEpochMs: 1000 } },
      networkEntries: [
        {
          id: "n1",
          url: "https://example.com/api/orders",
          method: "GET",
          status: 200,
          createdAt: 1100,
          response: { bodyHash: "abcd1234abcd1234", byteLength: 10 },
        },
      ],
    };
    const zipPath = join(tempRoot, "pack.zip");
    writeFileSync(
      zipPath,
      zipSync({
        "session-data.json": strToU8(JSON.stringify(payload)),
      })
    );
    runTriageCli(["open_pack", zipPath]);

    // "--bizError false" must NOT leak "false" into urlContains positional
    const outSpaceFalse = JSON.parse(
      runTriageCli(["query_network", "--bizError", "false", "--format", "json"])
    );
    assert.equal(outSpaceFalse.matchedCount, 1);
    assert.equal(outSpaceFalse.items[0].hasBody, true);

    const outEqFalse = JSON.parse(
      runTriageCli(["query_network", "--bizError=false", "--format", "json"])
    );
    assert.equal(outEqFalse.matchedCount, 1);

    // "--unfold false" keeps folded console output without treating "false" as search query
    const consoleOut = runTriageCli(["query_console", "--unfold", "false"]);
    assert.match(consoleOut, /\(folded,/);
  } finally {
    clearPackCache();
    if (prevWs === undefined) delete process.env.BUG_LENS_CLI_WORKSPACE;
    else process.env.BUG_LENS_CLI_WORKSPACE = prevWs;
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("Phase A: detectBusinessError avoids false positives & queryNetwork stays lazy on --status failed", () => {
  // 1. Harmless result strings, positive success=true, and broken JSON errorCode: null
  assert.equal(
    detectBusinessError(JSON.stringify({ code: 0, result: "done" })).isBizError,
    false
  );
  assert.equal(
    detectBusinessError(JSON.stringify({ result: "done" })).isBizError,
    false
  );
  assert.equal(
    detectBusinessError(
      JSON.stringify({ success: true, status: "done", result: "submitted" })
    ).isBizError,
    false
  );
  assert.equal(
    detectBusinessError('{"errorCode": null, "data": [1').isBizError,
    false
  );
  assert.equal(
    detectBusinessError('{"errorCode": "", "data": [1').isBizError,
    false
  );

  // 2. queryNetwork --status failed skips reading 2xx bodies completely
  let bodyReads = 0;
  const pack = {
    getNetworkEntries: () => [
      {
        id: "ok-200",
        status: 200,
        method: "POST",
        type: "xhr",
        url: "https://example.com/api/hidden-biz-err",
        createdAt: 1000,
        response: { bodyHash: "deadbeef12345678", byteLength: 42 },
      },
      {
        id: "err-502",
        status: 502,
        method: "GET",
        type: "xhr",
        url: "https://example.com/api/gateway",
        createdAt: 1200,
      },
    ],
    getNetworkBody: () => {
      bodyReads += 1;
      return JSON.stringify({ success: false, code: 500 });
    },
    toRelativeMs: (t?: number) => t,
    toEpochMs: (t: number) => t,
  } as unknown as LoadedSessionPack;

  const failedRes = queryNetwork(pack, { status: "failed" });
  assert.equal(bodyReads, 0);
  assert.deepEqual(
    failedRes.items.map((r) => r.id),
    ["err-502"]
  );

  const allRes = queryNetwork(pack);
  assert.equal(bodyReads, 0);
  assert.equal(allRes.items.find((r) => r.id === "ok-200")?.hasBody, true);

  const bizRes = queryNetwork(pack, { bizError: true });
  assert.equal(bodyReads, 1);
  assert.deepEqual(
    bizRes.items.map((r) => r.id),
    ["ok-200"]
  );
});

test("Phase A: get_request resolves request.bodyHash from CAS blobs", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "req-cas-test-"));
  const prevWs = process.env.BUG_LENS_CLI_WORKSPACE;
  process.env.BUG_LENS_CLI_WORKSPACE = join(tempRoot, "ws");
  try {
    clearPackCache();
    const reqPayload = JSON.stringify({ action: "createOrder", sku: "SKU-99" });
    const reqSha = createHash("sha256").update(reqPayload).digest("hex");
    const reqShort = reqSha.slice(0, 16);

    const payload: SessionDataPayload = {
      format: "bug-lens-evidence-pack",
      schemaVersion: 5,
      session: { id: "req-cas-session", timeline: { startedAtEpochMs: 1000 } },
      networkEntries: [
        {
          id: "req-cas-1",
          method: "POST",
          url: "https://api.example.com/orders",
          status: 200,
          createdAt: 1200,
          request: {
            bodyHash: reqShort,
            byteLength: reqPayload.length,
          },
          response: {
            mimeType: "application/json",
            body: JSON.stringify({ code: 0 }),
          },
        },
      ],
    };

    const zipPath = join(tempRoot, "req-cas.zip");
    writeFileSync(
      zipPath,
      zipSync({
        "session-data.json": strToU8(JSON.stringify(payload)),
        [`network/blobs/${reqShort}.bin`]: strToU8(reqPayload),
      })
    );

    runTriageCli(["open_pack", zipPath]);
    const textOut = runTriageCli([
      "get_request",
      "req-cas-1",
      "--include",
      "body",
    ]);
    assert.match(textOut, /"action": "createOrder"/);
    assert.match(textOut, /"sku": "SKU-99"/);

    const jsonOut = JSON.parse(
      runTriageCli(["get_request", "req-cas-1", "--format", "json"])
    );
    assert.equal(jsonOut.resolvedRequestBody, reqPayload);
  } finally {
    clearPackCache();
    if (prevWs === undefined) delete process.env.BUG_LENS_CLI_WORKSPACE;
    else process.env.BUG_LENS_CLI_WORKSPACE = prevWs;
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("Phase A: Schema v5 consoleSummary folding, time filters, SHA-256[:12] signature, and malformed network-details.json error", () => {
  const sig = computeConsoleSignature({
    level: "warn",
    location: "app.js:12",
    text: "Tick",
  });
  assert.match(sig, /^[a-f0-9]{12}$/);

  const t0 = 1700000000000;
  const payload: SessionDataPayload = {
    format: "bug-lens-evidence-pack",
    schemaVersion: 5,
    summary: {
      title: "v5 Summary Session",
      url: "https://example.com",
      metrics: {
        consoleSummary: {
          totalOriginalEntries: 251,
          uniqueSignatureCount: 2,
          errorCount: 1,
          warningCount: 250,
        },
      },
    },
    consoleSummary: [
      {
        signature: "aaaaaaaaaaaa",
        level: "warn",
        text: "Repeated warning",
        count: 250,
        firstCreatedAt: t0 + 100,
        lastCreatedAt: t0 + 5000,
        timeRangeMs: [100, 5000],
        location: { url: "vendor.js", lineNumber: 88 },
      },
      {
        signature: "bbbbbbbbbbbb",
        level: "error",
        text: "Crash without timestamp",
        count: 1,
      },
    ],
    networkEntries: [],
    issueScenes: [
      {
        id: "scene-1",
        observedAtEpochMs: t0 + 2000,
        targetSelector: "#submit-btn",
        domContextPath: "issues/scene-1/dom-context.json",
        domStylesPath: "issues/scene-1/dom-styles.json",
        narrative: { actual: "Button stayed disabled" },
      },
    ],
  };

  const pack = openPackFromBytes(
    zipSync({
      "manifest.json": strToU8(
        JSON.stringify({
          format: "bug-lens-evidence-pack",
          schemaVersion: 5,
          packMode: "ai-minimal",
          sessionId: "v5-summary-pack",
          createdAtEpochMs: t0 + 999999,
          files: {},
        })
      ),
      "session-data.json": strToU8(JSON.stringify(payload)),
    })
  ) as LoadedSessionPack;

  assert.equal(pack.t0EpochMs, t0 + 100);
  assert.equal(pack.getConsoleTotalCount(), 251);
  const res = queryConsole(pack);
  assert.equal(res.totalEntries, 251);
  assert.equal(res.matchedCount, 2);
  assert.equal(res.items[0]?.count, 250);
  assert.equal(res.items[0]?.location, "vendor.js:88");

  // Entry missing createdAt is excluded when fromMs filter is specified
  const ranged = queryConsole(pack, { fromMs: 0 });
  assert.equal(ranged.matchedCount, 1);
  assert.equal(ranged.items[0]?.level, "warn");

  const scenes = pack.getIssueScenes();
  assert.equal(scenes[0]?.scene.observedAtEpochMs, t0 + 2000);
  assert.equal(scenes[0]?.domContextPath, "issues/scene-1/dom-context.json");
  assert.equal(scenes[0]?.domStylesPath, "issues/scene-1/dom-styles.json");

  // Malformed network-details.json must throw explicitly instead of returning {}
  const badDetailsPack = openPackFromBytes(
    zipSync({
      "session-data.json": strToU8(JSON.stringify(payload)),
      "network-details.json": strToU8("{ invalid json"),
    })
  ) as LoadedSessionPack;
  assert.throws(
    () => badDetailsPack.getNetworkDetails(),
    /INVALID_JSON_FILE: Failed to parse network-details\.json/
  );
});
