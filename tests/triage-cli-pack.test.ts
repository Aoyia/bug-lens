import { zipSync } from "fflate";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseWindowAssignmentJson } from "../src/triage-cli/pack/js-json.ts";
import {
  clearPackCache,
  extractPackToDisk,
  getPackWorkspaceDir,
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
    clearPackCache();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("openPackFromBytes rejects unrecognized archives and corrupted JSON files", () => {
  const emptyZip = zipSync({
    "random.txt": new TextEncoder().encode("hello world"),
  });
  assert.throws(
    () => openPackFromBytes(emptyZip),
    /UNRECOGNIZED_BUG_LENS_PACK/
  );

  const corruptedJsonZip = zipSync({
    "dom-context.json": new TextEncoder().encode("{ corrupt json"),
  });
  assert.throws(
    () => openPackFromBytes(corruptedJsonZip),
    /INVALID_JSON_FILE: Failed to parse dom-context\.json/
  );
});

test("openPack loads extracted directory archives directly from disk", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "bug-lens-cli-dir-"));
  try {
    clearPackCache();
    const sessionZipBytes = buildRealSessionZipBytes();
    const memPack = openPackFromBytes(sessionZipBytes);
    const extracted = extractPackToDisk(
      memPack,
      join(tempRoot, "extracted-session")
    );

    const dirPack = openPack(extracted.destDir);
    assert.equal(dirPack.kind, "session");
    if (dirPack.kind === "session" && memPack.kind === "session") {
      assert.equal(dirPack.sessionId, memPack.sessionId);
    }
    assert.ok(dirPack.getInteractions().length >= 1);
  } finally {
    clearPackCache();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("openPackFromBytes detects declared zip bomb single file size limits", () => {
  const zipBytes = zipSync({
    "data/huge.txt": new Uint8Array(10),
  });
  // 修改 Central Directory Header (0x50, 0x4b, 0x01, 0x02) 中的 uncompressed size (offset +24)
  for (let i = 0; i < zipBytes.length - 4; i++) {
    if (
      zipBytes[i] === 0x50 &&
      zipBytes[i + 1] === 0x4b &&
      zipBytes[i + 2] === 0x01 &&
      zipBytes[i + 3] === 0x02
    ) {
      const view = new DataView(
        zipBytes.buffer,
        zipBytes.byteOffset,
        zipBytes.byteLength
      );
      view.setUint32(i + 24, 70 * 1024 * 1024, true); // 70MB (超过 64MB 限制)
      break;
    }
  }

  assert.throws(
    () => openPackFromBytes(zipBytes),
    /ZIP_BOMB_SINGLE_FILE_EXCEEDED/
  );
});

test("sanitizeRelativePathForDisk replaces Windows reserved characters", () => {
  const res = sanitizeRelativePathForDisk(
    "network/body-d6135e69:20535.366?.txt."
  );
  assert.equal(res.renamed, true);
  assert.equal(res.sanitized, "network/body-d6135e69_20535.366_.txt_");
});

test("openPack extracts ZIP to workspace with media, derived JSON, and INDEX.md, and skips re-extraction on stamp hit", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "bug-lens-cli-extract-"));
  const prevWs = process.env.BUG_LENS_CLI_WORKSPACE;
  process.env.BUG_LENS_CLI_WORKSPACE = join(tempRoot, "ws");
  try {
    clearPackCache();
    const sessionZipPath = join(tempRoot, "web-bug-report-d6135e69.zip");
    writeFileSync(
      sessionZipPath,
      buildRealSessionZipBytes({ includeMedia: true })
    );

    const loaded = openPack(sessionZipPath);
    const wsDir = getPackWorkspaceDir(loaded);
    assert.ok(wsDir, "Expected openPack to load from extracted workspace dir");

    // 1. 录屏文件落盘，且仍在 skippedMediaFiles 中登记
    const mediaPath = join(wsDir!, "media/recording.webm");
    assert.equal(existsSync(mediaPath), true);
    assert.equal(loaded.skippedMediaFiles.has("media/recording.webm"), true);

    // 2. 派生 JSON 与原始 JS 包装内容一致
    const derivedSession = JSON.parse(
      readFileSync(join(wsDir!, "data/session-data.json"), "utf8")
    );
    const rawSession = parseWindowAssignmentJson(
      readFileSync(join(wsDir!, "data/session-data.js"), "utf8")
    );
    assert.deepEqual(derivedSession, rawSession);
    assert.equal(existsSync(join(wsDir!, "data/network-details.json")), true);

    // 3. INDEX.md 包含 schema 与请求映射
    const indexMd = readFileSync(join(wsDir!, "INDEX.md"), "utf8");
    assert.match(indexMd, /# Bug Lens Evidence Workspace Index/);
    assert.match(indexMd, /session-data\.json Schema/);
    assert.match(indexMd, /Request → Body Map/);
    assert.match(indexMd, /media\/recording\.webm/);

    // 4. 幂等校验：固定文件时间后清除内存缓存再 openPack，不应重写文件
    const indexFile = join(wsDir!, "INDEX.md");
    const fixedTime = new Date(2025, 0, 1, 0, 0, 0);
    utimesSync(indexFile, fixedTime, fixedTime);
    clearPackCache();
    openPack(sessionZipPath);
    assert.equal(statSync(indexFile).mtimeMs, fixedTime.getTime());

    // 5. 两个不同名的截图包解压到各自独立的子目录，互不覆盖
    const ss1 = join(tempRoot, "bug-lens-screenshot-1.zip");
    const ss2 = join(tempRoot, "bug-lens-screenshot-2.zip");
    const ssBytes = await buildRealScreenshotZipBytes();
    writeFileSync(ss1, ssBytes);
    writeFileSync(ss2, ssBytes);
    const p1 = openPack(ss1);
    const p2 = openPack(ss2);
    assert.notEqual(getPackWorkspaceDir(p1), getPackWorkspaceDir(p2));

    // 6. 目录模式：若手动解压目录缺失派生 JSON 与 INDEX.md，openPack(dir) 自动补齐
    rmSync(join(wsDir!, "data/session-data.json"), { force: true });
    rmSync(join(wsDir!, "INDEX.md"), { force: true });
    clearPackCache();
    openPack(wsDir!);
    assert.equal(existsSync(join(wsDir!, "data/session-data.json")), true);
    assert.equal(existsSync(join(wsDir!, "INDEX.md")), true);

    // 7. 工作区短包名寻址：无需传完整路径，直接用短 ID 切回已解压工作区包
    const byShortId = openPack("d6135e69");
    assert.equal(
      realpathSync(getPackWorkspaceDir(byShortId)!),
      realpathSync(wsDir!)
    );
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

test("openPack enforces workspace LRU limit (MAX_WORKSPACE_PACKS) while preserving unmanaged directories", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "bug-lens-cli-lru-"));
  const wsRoot = join(tempRoot, "ws");
  const prevWs = process.env.BUG_LENS_CLI_WORKSPACE;
  const prevMax = process.env.BUG_LENS_MAX_PACKS;
  process.env.BUG_LENS_CLI_WORKSPACE = wsRoot;
  process.env.BUG_LENS_MAX_PACKS = "3";

  try {
    clearPackCache();
    // 在工作区下创建一个无 .bug-lens-extract.json 的手动目录，验证绝不会被误删
    const unmanagedDir = join(wsRoot, "manual-user-notes");
    mkdirSync(unmanagedDir, { recursive: true });
    writeFileSync(join(unmanagedDir, "keep.txt"), "keep", "utf8");

    const zipBytes = buildRealSessionZipBytes();
    const paths = ["pack-a", "pack-b", "pack-c", "pack-d"].map((name) => {
      const p = join(tempRoot, `${name}.zip`);
      writeFileSync(p, zipBytes);
      return p;
    });

    const dirA = getPackWorkspaceDir(openPack(paths[0]))!;
    await new Promise((r) => setTimeout(r, 15));
    const dirB = getPackWorkspaceDir(openPack(paths[1]))!;
    await new Promise((r) => setTimeout(r, 15));
    const dirC = getPackWorkspaceDir(openPack(paths[2]))!;
    await new Promise((r) => setTimeout(r, 15));

    // 重新访问 pack-a（刷新其 lastAccessedAt），此时最久未访问的应变为 pack-b
    clearPackCache();
    openPack(paths[0]);
    await new Promise((r) => setTimeout(r, 15));

    // 打开第 4 个包 pack-d，触发 K=3 的 LRU 清理
    const dirD = getPackWorkspaceDir(openPack(paths[3]))!;

    assert.equal(
      existsSync(dirA),
      true,
      "Recently touched pack-a should be kept"
    );
    assert.equal(
      existsSync(dirB),
      false,
      "Least recently used pack-b should be evicted"
    );
    assert.equal(existsSync(dirC), true, "pack-c should be kept");
    assert.equal(existsSync(dirD), true, "Newly opened pack-d should be kept");
    assert.equal(
      existsSync(join(unmanagedDir, "keep.txt")),
      true,
      "Unmanaged directory without .bug-lens-extract.json must never be deleted"
    );
  } finally {
    clearPackCache();
    if (prevWs === undefined) {
      delete process.env.BUG_LENS_CLI_WORKSPACE;
    } else {
      process.env.BUG_LENS_CLI_WORKSPACE = prevWs;
    }
    if (prevMax === undefined) {
      delete process.env.BUG_LENS_MAX_PACKS;
    } else {
      process.env.BUG_LENS_MAX_PACKS = prevMax;
    }
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
