import { zipSync } from "fflate";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseWindowAssignmentJson } from "../src/triage-cli/pack/js-json.ts";
import {
  clearPackCache,
  extractPackToDisk,
  openPack,
  openPackFromBytes,
  sanitizeRelativePathForDisk,
} from "../src/triage-cli/pack/open.ts";
import {
  buildRealScreenshotZipBytes,
  buildRealSessionZipBytes,
} from "./helpers/triage-cli-fixture.ts";

test("parseWindowAssignmentJson safely parses valid wrapper and rejects untrusted code", () => {
  const parsed = parseWindowAssignmentJson<{ ok: boolean }>(
    '  window.__BUG_LENS_DATA__ = {"ok": true};\n'
  );
  assert.deepEqual(parsed, { ok: true });

  assert.throws(
    () =>
      parseWindowAssignmentJson(
        'window.__BUG_LENS_DATA__ = (() => { throw new Error("pwned"); })();'
      ),
    /INVALID_JS_JSON_PAYLOAD/
  );

  assert.throws(
    () => parseWindowAssignmentJson('console.log("evil");'),
    /INVALID_JS_JSON_WRAPPER/
  );
});

test("openPackFromBytes handles session pack, missing network-details.js, unknown schemaVersion, and tampered sha256", () => {
  const normalBytes = buildRealSessionZipBytes();
  const normalPack = openPackFromBytes(normalBytes);
  assert.equal(normalPack.kind, "session");
  assert.equal(normalPack.integrity.valid, true);
  assert.equal(normalPack.integrity.schemaWarning, undefined);

  const noDetailsBytes = buildRealSessionZipBytes({ omitNetworkDetails: true });
  const noDetailsPack = openPackFromBytes(noDetailsBytes);
  assert.equal(noDetailsPack.kind, "session");
  assert.deepEqual(noDetailsPack.getNetworkDetails(), {});

  const futureSchemaBytes = buildRealSessionZipBytes({ schemaVersion: 99 });
  const futurePack = openPackFromBytes(futureSchemaBytes);
  assert.match(
    futurePack.integrity.schemaWarning ?? "",
    /newer than max supported version/
  );

  const tamperedBytes = buildRealSessionZipBytes({ tamperSessionData: true });
  const tamperedPack = openPackFromBytes(tamperedBytes);
  assert.equal(tamperedPack.integrity.valid, false);
  assert.ok(
    tamperedPack.integrity.mismatches.some((m) =>
      m.includes("data/session-data.js")
    )
  );
});

test("openPackFromBytes rejects corrupt ZIP and zip-slip traversal entries", () => {
  assert.throws(
    () => openPackFromBytes(new Uint8Array([1, 2, 3, 4, 5])),
    /CORRUPT_ZIP_ARCHIVE/
  );

  const traversalZip = zipSync({
    "../../etc/passwd": new TextEncoder().encode("root:x:0:0"),
  });
  assert.throws(() => openPackFromBytes(traversalZip), /UNSAFE_ZIP_ENTRY_PATH/);
});

test("openPackFromBytes skips media/* files without loading them into memory", () => {
  const zipWithMedia = zipSync({
    "data/session-data.js": new TextEncoder().encode(
      'window.__BUG_LENS_DATA__ = {"summary":{"title":"Media Test"}};'
    ),
    "media/recording.mp4": new Uint8Array(1024),
  });
  const pack = openPackFromBytes(zipWithMedia);
  assert.equal(pack.kind, "session");
  assert.equal(pack.files.has("media/recording.mp4"), false);
  assert.equal(pack.skippedMediaFiles.has("media/recording.mp4"), true);
});

test("extractPackToDisk exports new packs cleanly and sanitizes Windows-invalid ':' in legacy network body filenames", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "bug-lens-cli-test-"));
  try {
    const newZipBytes = buildRealSessionZipBytes();
    const newPack = openPackFromBytes(newZipBytes);
    const extractedNew = extractPackToDisk(newPack, join(tempRoot, "out-new"));
    assert.equal(extractedNew.renamedPaths.length, 0);
    assert.ok(
      extractedNew.writtenFiles.some(
        (f) => f.endsWith("_20535.366.txt") && !f.includes(":")
      )
    );

    const legacyZipBytes = buildRealSessionZipBytes({
      legacyColonBodyFilename: true,
    });
    const legacyPack = openPackFromBytes(legacyZipBytes);
    const extracted = extractPackToDisk(
      legacyPack,
      join(tempRoot, "out-legacy")
    );

    assert.ok(extracted.renamedPaths.length > 0);
    const colonRename = extracted.renamedPaths.find((r) =>
      r.from.includes(":20535.366.txt")
    );
    assert.ok(colonRename, "Expected colon filename to be renamed");
    assert.equal(colonRename!.to.includes(":"), false);

    const writtenSessionJs = readFileSync(
      join(extracted.destDir, "data/session-data.js"),
      "utf8"
    );
    assert.ok(writtenSessionJs.includes(colonRename!.to));
    assert.equal(writtenSessionJs.includes(colonRename!.from), false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("openPack supports file path with spaces/parentheses (Windows download style) and invalidates cache on overwrite", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "bug-lens-cli-cache-"));
  try {
    clearPackCache();
    const weirdFilePath = join(tempRoot, "web-bug-report-ee2f924f (1).zip");
    writeFileSync(weirdFilePath, buildRealSessionZipBytes());

    const first = openPack(weirdFilePath);
    assert.equal(first.kind, "session");

    const screenshotBytes = await buildRealScreenshotZipBytes();
    writeFileSync(weirdFilePath, screenshotBytes);

    const second = openPack(weirdFilePath);
    assert.equal(second.kind, "screenshot");
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("sanitizeRelativePathForDisk replaces Windows reserved characters", () => {
  const res = sanitizeRelativePathForDisk(
    "network/body-d6135e69:20535.366?.txt."
  );
  assert.equal(res.renamed, true);
  assert.equal(res.sanitized, "network/body-d6135e69_20535.366_.txt_");
});
