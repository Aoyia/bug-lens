import { zipSync } from "fflate";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runTriageCli } from "../src/triage-cli/cli.ts";
import {
  LazyFileRegistry,
  MAX_SINGLE_FILE_BYTES,
  MAX_TOTAL_UNCOMPRESSED_BYTES,
} from "../src/triage-cli/pack/lazy-file-registry.ts";
import {
  clearPackCache,
  openPack,
  openPackFromBytes,
} from "../src/triage-cli/pack/open.ts";
import { LoadedSessionPack } from "../src/triage-cli/pack/session-pack.ts";
import type { SessionDataPayload } from "../src/triage-cli/pack/types.ts";
import {
  computeConsoleSignature,
  formatConsoleItem,
  normalizeConsoleTemplate,
  queryConsole,
} from "../src/triage-cli/query/console.ts";

test("LazyFileRegistry: zero-IO scanning, on-demand read, memory caching, and zero-IO has/listEntries", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "lazy-registry-test-"));
  try {
    writeFileSync(
      join(tempRoot, "root.json"),
      JSON.stringify({ hello: "world" }),
      "utf8"
    );
    mkdirSync(join(tempRoot, "media"), { recursive: true });
    writeFileSync(
      join(tempRoot, "media", "recording.mp4"),
      new Uint8Array(2048)
    );
    mkdirSync(join(tempRoot, "network", "blobs"), { recursive: true });
    const blobContent = new TextEncoder().encode("response payload");
    writeFileSync(join(tempRoot, "network", "blobs", "blob1.bin"), blobContent);

    const registry = new LazyFileRegistry(tempRoot);
    registry.scanDirectory(tempRoot);

    // 1. Media files are skipped from main index and recorded in skippedMediaFiles
    assert.equal(registry.has("media/recording.mp4"), false);
    assert.equal(registry.skippedMediaFiles.has("media/recording.mp4"), true);
    assert.equal(
      registry.skippedMediaFiles.get("media/recording.mp4")?.originalSize,
      2048
    );

    // 2. Zero-IO has, size, and keys
    assert.equal(registry.size, 2);
    assert.equal(registry.has("root.json"), true);
    assert.equal(registry.has("network/blobs/blob1.bin"), true);
    assert.equal(registry.has("nonexistent.txt"), false);

    const entries = registry.listEntries();
    assert.equal(entries.length, 2);
    const blobEntry = entries.find((e) => e.path === "network/blobs/blob1.bin");
    assert.ok(blobEntry);
    assert.equal(blobEntry!.byteLength, blobContent.byteLength);

    // 3. Metadata before read: inMemoryBuffer is undefined
    const metaBefore = registry.getMetadata("network/blobs/blob1.bin");
    assert.ok(metaBefore);
    assert.equal(metaBefore!.inMemoryBuffer, undefined);

    // 4. On-demand readBytes and caching
    const read1 = registry.readBytes("network/blobs/blob1.bin");
    assert.ok(read1);
    assert.deepEqual(read1, blobContent);

    // After read, inMemoryBuffer is cached
    const metaAfter = registry.getMetadata("network/blobs/blob1.bin");
    assert.ok(metaAfter?.inMemoryBuffer);
    assert.equal(metaAfter?.inMemoryBuffer, read1);

    // readText decodes correctly
    assert.equal(
      registry.readText("network/blobs/blob1.bin"),
      "response payload"
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("LazyFileRegistry: zip bomb defense on single file and cumulative total size", () => {
  const registry = new LazyFileRegistry();

  // 1. Single file limit defense
  assert.throws(() => {
    registry.registerBuffer(
      "huge.bin",
      new Uint8Array(MAX_SINGLE_FILE_BYTES + 1)
    );
  }, /ZIP_BOMB_SINGLE_FILE_EXCEEDED/);

  // 2. Total size limit defense
  const smallChunk = new Uint8Array(60 * 1024 * 1024); // 60MB
  for (let i = 0; i < 8; i++) {
    registry.registerBuffer(`chunk-${i}.bin`, smallChunk);
  }
  // 8 * 60MB = 480MB, now next chunk would push it to 540MB > 512MB
  assert.throws(() => {
    registry.registerBuffer("overflow.bin", smallChunk);
  }, /ZIP_BOMB_TOTAL_SIZE_EXCEEDED/);
});

test("Schema v5 Pure JSON Pack: root session-data.json, network-details.json, and CAS blobs", () => {
  const payload: SessionDataPayload = {
    summary: {
      title: "Schema v5 Test",
      url: "https://example.com/v5",
    },
    session: {
      id: "v5-session-uuid-1234",
      schemaVersion: 5,
      timeline: { createdAtEpochMs: 1700000000000 },
    },
    networkEntries: [
      {
        id: "req-1",
        url: "https://api.example.com/items",
        method: "GET",
        status: 200,
        createdAt: 1700000000100,
        response: {
          mimeType: "application/json",
          bodyHash: "4a7d1ed414474e40", // 16-hex CAS hash
        },
      },
      {
        id: "req-2",
        url: "https://api.example.com/cached-items",
        method: "GET",
        status: 200,
        createdAt: 1700000000200,
        response: {
          mimeType: "application/json",
          bodyHash: "4a7d1ed414474e40", // Shared CAS hash (deduplicated)
        },
      },
    ],
  };

  const networkDetails = {
    "req-1": {
      responseHeaders: { "content-type": "application/json" },
      bodyBlob: {
        path: "network/blobs/4a7d1ed414474e40.bin",
        hash: "4a7d1ed414474e40",
      },
    },
  };

  const sharedBlobContent = JSON.stringify({ items: [1, 2, 3], status: "ok" });
  const blobHashFull = createHash("sha256")
    .update(sharedBlobContent)
    .digest("hex");

  const manifest = {
    format: "bug-lens-evidence-pack",
    schemaVersion: 5,
    packMode: "ai-minimal",
    sessionId: "v5-session-uuid-1234",
    createdAtEpochMs: 1700000000000,
    files: {
      "session-data.json": {
        byteLength: new TextEncoder().encode(JSON.stringify(payload))
          .byteLength,
        sha256: createHash("sha256")
          .update(JSON.stringify(payload))
          .digest("hex"),
      },
      "network-details.json": {
        byteLength: new TextEncoder().encode(JSON.stringify(networkDetails))
          .byteLength,
        sha256: createHash("sha256")
          .update(JSON.stringify(networkDetails))
          .digest("hex"),
      },
      "network/blobs/4a7d1ed414474e40.bin": {
        byteLength: new TextEncoder().encode(sharedBlobContent).byteLength,
        sha256: blobHashFull,
      },
    },
  };

  const zipBytes = zipSync({
    "manifest.json": new TextEncoder().encode(JSON.stringify(manifest)),
    "session-data.json": new TextEncoder().encode(JSON.stringify(payload)),
    "network-details.json": new TextEncoder().encode(
      JSON.stringify(networkDetails)
    ),
    "network/blobs/4a7d1ed414474e40.bin": new TextEncoder().encode(
      sharedBlobContent
    ),
  });

  const pack = openPackFromBytes(zipBytes) as LoadedSessionPack;
  assert.equal(pack.kind, "session");
  assert.equal(pack.sessionId, "v5-session-uuid-1234");
  assert.equal(pack.integrity.valid, true);

  // Network details parsed directly from network-details.json
  const details = pack.getNetworkDetails();
  assert.ok(details["req-1"]);
  assert.equal(
    details["req-1"].responseHeaders?.["content-type"],
    "application/json"
  );

  // CAS body resolved from network/blobs/<sha256:16>.bin for both requests
  const body1 = pack.getNetworkBody(pack.data.networkEntries![0]!);
  const body2 = pack.getNetworkBody(pack.data.networkEntries![1]!);
  assert.equal(body1, sharedBlobContent);
  assert.equal(body2, sharedBlobContent);
});

test("Schema v5 Pure JSON Pack: rejects corrupted session-data.json", () => {
  const zipBytes = zipSync({
    "session-data.json": new TextEncoder().encode("{ corrupt json"),
  });
  assert.throws(
    () => openPackFromBytes(zipBytes),
    /INVALID_JSON_FILE: Failed to parse session-data\.json/
  );
});

test("Console Log Folding: template normalization and signature hash calculation", () => {
  const raw1 =
    "Failed to load resource: 3f2504e0-4f89-11d3-9a0c-0305e82c3301 at 1713400123456 in 45.2ms, ptr 0x7ffee4a10";
  const raw2 =
    "Failed to load resource: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee at 1713400999999 in 12ms, ptr 0x0012ab";

  const norm1 = normalizeConsoleTemplate(raw1);
  const norm2 = normalizeConsoleTemplate(raw2);

  assert.equal(
    norm1,
    "Failed to load resource: [UUID] at [TIMESTAMP] in [DURATION], ptr [HEX]"
  );
  assert.equal(
    norm2,
    "Failed to load resource: [UUID] at [TIMESTAMP] in [DURATION], ptr [HEX]"
  );

  const sig1 = computeConsoleSignature({
    level: "warn",
    location: "app.js:42",
    text: raw1,
  });
  const sig2 = computeConsoleSignature({
    level: "warning", // should normalize to "warn"
    location: "app.js:42",
    text: raw2,
  });
  assert.equal(sig1, sig2);

  // Different location produces different signature
  const sigDiffLoc = computeConsoleSignature({
    level: "warn",
    location: "other.js:10",
    text: raw1,
  });
  assert.notEqual(sig1, sigDiffLoc);

  // Different level produces different signature
  const sigDiffLevel = computeConsoleSignature({
    level: "error",
    location: "app.js:42",
    text: raw1,
  });
  assert.notEqual(sig1, sigDiffLevel);
});

test("Console Log Folding: queryConsole folding, --unfold, --minCount, and multi-line formatting", () => {
  const consoleEntries: any[] = [];
  const t0 = 1700000000000;

  // 100 repeated ResizeObserver warnings
  for (let i = 0; i < 100; i++) {
    consoleEntries.push({
      id: `warn-${i}`,
      level: "warn",
      text: `ResizeObserver loop completed with undelivered notifications. at 1700000000${String(i).padStart(3, "0")} in ${10 + (i % 5)}ms`,
      createdAt: t0 + 100 + i * 50,
      url: "vendors.js",
      lineNumber: 1042,
    });
  }

  // 1 single critical error
  consoleEntries.push({
    id: "err-1",
    level: "error",
    text: "Uncaught TypeError: Cannot read properties of undefined (reading 'permissions')",
    createdAt: t0 + 3400,
    sourceMappedLocation: {
      resolved: true,
      originalFile: "src/views/Editor.vue",
      originalLine: 341,
      originalColumn: 12,
      originalFunctionName: "handleSubmit",
    },
    stack:
      "at handleSubmit (src/views/Editor.vue:341:12)\nat HTMLButtonElement.dispatch (vendors.js:8910:22)",
  });

  const sessionPayload: SessionDataPayload = {
    session: {
      id: "folding-test-session",
      timeline: { createdAtEpochMs: t0 },
    },
    consoleEntries,
  };

  const pack = openPackFromBytes(
    zipSync({
      "session-data.json": new TextEncoder().encode(
        JSON.stringify(sessionPayload)
      ),
    })
  ) as LoadedSessionPack;

  // 1. Default folding: 101 raw entries folded into 2 items
  const folded = queryConsole(pack);
  assert.equal(folded.totalEntries, 101);
  assert.equal(folded.matchedCount, 2);
  assert.equal(folded.folded, true);

  const warnItem = folded.items.find((item) => item.level === "warn");
  assert.ok(warnItem);
  assert.equal(warnItem!.count, 100);
  assert.equal(warnItem!.firstRelativeMs, 100);
  assert.equal(warnItem!.lastRelativeMs, 100 + 99 * 50);

  const errItem = folded.items.find((item) => item.level === "error");
  assert.ok(errItem);
  assert.equal(errItem!.count, 1);
  assert.equal(errItem!.firstRelativeMs, 3400);

  // 2. formatConsoleItem verification
  const warnFormatted = formatConsoleItem(warnItem!);
  assert.match(warnFormatted, /\[WARN\] \[x100 times \| \+100ms\.\.\+5050ms\]/);
  assert.match(warnFormatted, /vendors\.js:1042/);

  const errFormatted = formatConsoleItem(errItem!);
  assert.match(errFormatted, /\[ERROR\] \[x1 time \| \+3400ms\]/);
  assert.match(
    errFormatted,
    /sourceMapped: src\/views\/Editor\.vue:341:12 \(handleSubmit\)/
  );
  assert.match(errFormatted, /stack: at handleSubmit/);

  // 3. --unfold: expands all entries linearly
  const unfolded = queryConsole(pack, { unfold: true, limit: 200 });
  assert.equal(unfolded.matchedCount, 101);
  assert.equal(unfolded.folded, false);
  assert.equal(unfolded.items.length, 101);
  assert.equal(unfolded.items[0]!.count, 1);
  assert.equal(unfolded.items[100]!.count, 1);

  // 4. --minCount: filters entries below threshold
  const minFiltered = queryConsole(pack, { minCount: 10 });
  assert.equal(minFiltered.matchedCount, 1);
  assert.equal(minFiltered.items[0]!.level, "warn");
  assert.equal(minFiltered.items[0]!.count, 100);

  // 5. --unfold combined with --minCount: unfolds all entries matching signatures with count >= minCount
  const unfoldMin = queryConsole(pack, {
    unfold: true,
    minCount: 10,
    limit: 200,
  });
  assert.equal(unfoldMin.matchedCount, 100);
  assert.equal(unfoldMin.folded, false);
  assert.equal(unfoldMin.items.length, 100);
  assert.equal(
    unfoldMin.items.every((it) => it.level === "warn"),
    true
  );
});

test("CLI query_console: supports --unfold, --minCount, and --format json flags", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "cli-folding-test-"));
  const prevWs = process.env.BUG_LENS_CLI_WORKSPACE;
  process.env.BUG_LENS_CLI_WORKSPACE = join(tempRoot, "ws");
  try {
    clearPackCache();
    const t0 = 1700000000000;
    const consoleEntries = [
      {
        id: "w1",
        level: "warn",
        text: "Polling tick at 1700000000100 in 10ms",
        createdAt: t0 + 100,
        url: "poll.js:10",
      },
      {
        id: "w2",
        level: "warn",
        text: "Polling tick at 1700000000200 in 11ms",
        createdAt: t0 + 200,
        url: "poll.js:10",
      },
      {
        id: "w3",
        level: "warn",
        text: "Polling tick at 1700000000300 in 9ms",
        createdAt: t0 + 300,
        url: "poll.js:10",
      },
      {
        id: "e1",
        level: "error",
        text: "Unique failure",
        createdAt: t0 + 400,
        url: "fail.js:99",
      },
    ];

    const zipPath = join(tempRoot, "folding-pack.zip");
    writeFileSync(
      zipPath,
      zipSync({
        "session-data.json": new TextEncoder().encode(
          JSON.stringify({
            session: {
              id: "cli-fold-sess",
              timeline: { createdAtEpochMs: t0 },
            },
            consoleEntries,
          })
        ),
      })
    );

    runTriageCli(["open_pack", zipPath]);

    // 1. Default folded output
    const defaultOut = runTriageCli(["query_console"]);
    assert.match(defaultOut, /# Console Logs \(folded, matched 2 of 4 total/);
    assert.match(defaultOut, /\[x3 times \| \+100ms\.\.\+300ms\]/);
    assert.match(defaultOut, /\[x1 time \| \+400ms\]/);

    // 2. Unfolded output
    const unfoldOut = runTriageCli(["query_console", "--unfold"]);
    assert.match(unfoldOut, /# Console Logs \(unfolded, matched 4 of 4 total/);

    // 3. minCount filter
    const minCountOut = runTriageCli(["query_console", "--minCount", "2"]);
    assert.match(minCountOut, /matched 1 of 4 total/);
    assert.match(minCountOut, /\[x3 times/);
    assert.equal(minCountOut.includes("Unique failure"), false);

    // 4. --unfold combined with --minCount: unfolds matching entries of signatures with count >= 2
    const unfoldMinCountOut = runTriageCli([
      "query_console",
      "--unfold",
      "--minCount",
      "2",
    ]);
    assert.match(
      unfoldMinCountOut,
      /# Console Logs \(unfolded, matched 3 of 4 total/
    );
    assert.equal(unfoldMinCountOut.includes("Polling tick at"), true);
    assert.equal(unfoldMinCountOut.includes("Unique failure"), false);

    // 5. JSON format output
    const jsonOut = runTriageCli(["query_console", "--format", "json"]);
    const parsed = JSON.parse(jsonOut);
    assert.equal(parsed.folded, true);
    assert.equal(parsed.matchedCount, 2);
    assert.equal(parsed.items[0].count, 3);
    assert.ok(Array.isArray(parsed.items[0].timeRangeMs));
    assert.ok(typeof parsed.items[0].signature === "string");
  } finally {
    clearPackCache();
    if (prevWs === undefined) {
      delete process.env.BUG_LENS_CLI_WORKSPACE;
    } else {
      process.env.BUG_LENS_CLI_WORKSPACE = prevWs;
    }
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
