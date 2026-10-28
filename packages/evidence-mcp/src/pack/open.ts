import { unzipSync } from "fflate";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve, sep } from "node:path";
import { PackLruCache, type LoadedPack } from "./cache.ts";
import { parseWindowAssignmentJson } from "./js-json.ts";
import { parseManifest, verifyPackIntegrity } from "./manifest.ts";
import { LoadedScreenshotPack } from "./screenshot-pack.ts";
import { LoadedSessionPack } from "./session-pack.ts";
import type { ScreenshotDomContext, SessionDataPayload } from "./types.ts";

export const MAX_SINGLE_FILE_BYTES = 64 * 1024 * 1024; // 64 MB
export const MAX_TOTAL_UNCOMPRESSED_BYTES = 512 * 1024 * 1024; // 512 MB

const MEDIA_PATH_RE = /(?:^|\/)media\/|\.(?:mp4|webm|mkv|mov)$/i;
const WINDOWS_RESERVED_CHARS_RE = /[:*?"<>|]/g;

const defaultCache = new PackLruCache(3);

export function clearPackCache(): void {
  defaultCache.clear();
}

function normalizeArchiveEntryPath(rawName: string): string {
  const forward = rawName.replace(/\\/g, "/").replace(/^\.?\//, "");
  const normalized = posix.normalize(forward);
  if (
    normalized.startsWith("/") ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    /^[a-zA-Z]:/.test(normalized)
  ) {
    throw new Error(
      `UNSAFE_ZIP_ENTRY_PATH: Refusing archive entry with traversal or absolute path: ${rawName}`
    );
  }
  return normalized;
}

function loadZipArchive(zipBytes: Uint8Array): {
  files: Map<string, Uint8Array>;
  skippedMediaFiles: Map<
    string,
    { originalSize: number; compressedSize: number }
  >;
} {
  const skippedMediaFiles = new Map<
    string,
    { originalSize: number; compressedSize: number }
  >();
  let totalDeclaredBytes = 0;

  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(zipBytes, {
      filter(file) {
        const cleanName = normalizeArchiveEntryPath(file.name);
        if (cleanName.endsWith("/")) return false;
        const origSize = file.originalSize ?? 0;
        const compSize = file.size ?? 0;
        if (MEDIA_PATH_RE.test(cleanName)) {
          skippedMediaFiles.set(cleanName, {
            originalSize: origSize,
            compressedSize: compSize,
          });
          return false;
        }
        if (origSize > MAX_SINGLE_FILE_BYTES) {
          throw new Error(
            `ZIP_BOMB_SINGLE_FILE_EXCEEDED: Entry "${cleanName}" uncompressed size (${origSize} bytes) exceeds limit (${MAX_SINGLE_FILE_BYTES} bytes)`
          );
        }
        totalDeclaredBytes += origSize;
        if (totalDeclaredBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) {
          throw new Error(
            `ZIP_BOMB_TOTAL_SIZE_EXCEEDED: Total uncompressed size (${totalDeclaredBytes} bytes) exceeds limit (${MAX_TOTAL_UNCOMPRESSED_BYTES} bytes)`
          );
        }
        return true;
      },
    });
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.startsWith("ZIP_BOMB_") ||
        err.message.startsWith("UNSAFE_ZIP_ENTRY_PATH:"))
    ) {
      throw err;
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`CORRUPT_ZIP_ARCHIVE: Failed to decompress ZIP: ${msg}`);
  }

  const files = new Map<string, Uint8Array>();
  let totalActualBytes = 0;
  for (const [rawName, bytes] of Object.entries(unzipped)) {
    const cleanName = normalizeArchiveEntryPath(rawName);
    if (cleanName.endsWith("/")) continue;
    if (bytes.byteLength > MAX_SINGLE_FILE_BYTES) {
      throw new Error(
        `ZIP_BOMB_SINGLE_FILE_EXCEEDED: Decompressed "${cleanName}" (${bytes.byteLength} bytes) exceeds limit (${MAX_SINGLE_FILE_BYTES} bytes)`
      );
    }
    totalActualBytes += bytes.byteLength;
    if (totalActualBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw new Error(
        `ZIP_BOMB_TOTAL_SIZE_EXCEEDED: Total decompressed size (${totalActualBytes} bytes) exceeds limit (${MAX_TOTAL_UNCOMPRESSED_BYTES} bytes)`
      );
    }
    files.set(cleanName, bytes);
  }

  return { files, skippedMediaFiles };
}

function loadDirectoryArchive(rootDir: string): {
  files: Map<string, Uint8Array>;
  skippedMediaFiles: Map<
    string,
    { originalSize: number; compressedSize: number }
  >;
} {
  const files = new Map<string, Uint8Array>();
  const skippedMediaFiles = new Map<
    string,
    { originalSize: number; compressedSize: number }
  >();
  let totalBytes = 0;

  function walk(currentDir: string, relPrefix: string) {
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, relPath);
      } else if (entry.isFile()) {
        const st = statSync(fullPath);
        if (MEDIA_PATH_RE.test(relPath)) {
          skippedMediaFiles.set(relPath, {
            originalSize: st.size,
            compressedSize: st.size,
          });
          continue;
        }
        if (st.size > MAX_SINGLE_FILE_BYTES) {
          throw new Error(
            `ZIP_BOMB_SINGLE_FILE_EXCEEDED: File "${relPath}" (${st.size} bytes) exceeds limit`
          );
        }
        totalBytes += st.size;
        if (totalBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) {
          throw new Error(
            `ZIP_BOMB_TOTAL_SIZE_EXCEEDED: Total size (${totalBytes} bytes) exceeds limit`
          );
        }
        files.set(relPath, new Uint8Array(readFileSync(fullPath)));
      }
    }
  }

  walk(rootDir, "");
  return { files, skippedMediaFiles };
}

export function openPackFromBytes(
  zipBytes: Uint8Array,
  virtualPath = "<memory>.zip"
): LoadedPack {
  const { files, skippedMediaFiles } = loadZipArchive(zipBytes);
  return instantiatePack(virtualPath, files, skippedMediaFiles);
}

export function openPack(
  packPath: string,
  cache: PackLruCache = defaultCache
): LoadedPack {
  if (!packPath || typeof packPath !== "string") {
    throw new Error("INVALID_PACK_PATH: pack path must be a non-empty string");
  }
  const resolved = resolve(packPath);
  let realPath: string;
  let st: ReturnType<typeof statSync>;
  try {
    realPath = realpathSync(resolved);
    st = statSync(realPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`PACK_NOT_FOUND: Cannot access "${packPath}": ${msg}`);
  }

  const fingerprint = `${st.isDirectory() ? "dir" : "file"}:${st.mtimeMs}:${st.size}`;
  const cached = cache.get(realPath, fingerprint);
  if (cached) return cached;

  const { files, skippedMediaFiles } = st.isDirectory()
    ? loadDirectoryArchive(realPath)
    : loadZipArchive(new Uint8Array(readFileSync(realPath)));

  const loaded = instantiatePack(realPath, files, skippedMediaFiles);
  cache.set(realPath, fingerprint, loaded);
  return loaded;
}

function instantiatePack(
  packPath: string,
  files: Map<string, Uint8Array>,
  skippedMediaFiles: Map<
    string,
    { originalSize: number; compressedSize: number }
  >
): LoadedPack {
  const decoder = new TextDecoder();
  const manifest = parseManifest(files.get("manifest.json"));
  const skippedSet = new Set(skippedMediaFiles.keys());
  const integrity = verifyPackIntegrity(manifest, files, skippedSet);

  const sessionDataBytes = files.get("data/session-data.js");
  if (sessionDataBytes) {
    const rawText = decoder.decode(sessionDataBytes);
    const data = parseWindowAssignmentJson<SessionDataPayload>(
      rawText,
      "data/session-data.js"
    );
    return new LoadedSessionPack({
      packPath,
      manifest,
      integrity,
      data,
      files,
      skippedMediaFiles,
    });
  }

  const hasScreenshotFiles =
    files.has("dom-context.json") ||
    files.has("screenshot.jpg") ||
    files.has("screenshot.png") ||
    files.has("ai-prompt.md");

  if (hasScreenshotFiles) {
    const parseJsonOpt = <T>(name: string): T | undefined => {
      const b = files.get(name);
      if (!b) return undefined;
      try {
        return JSON.parse(decoder.decode(b)) as T;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`INVALID_JSON_FILE: Failed to parse ${name}: ${msg}`);
      }
    };

    const domContext = parseJsonOpt<ScreenshotDomContext>("dom-context.json");
    const environment =
      parseJsonOpt<Record<string, unknown>>("environment.json");
    const cascade = parseJsonOpt<Record<string, unknown>>("cascade.json");
    const aiPromptBytes = files.get("ai-prompt.md");
    const aiPrompt = aiPromptBytes ? decoder.decode(aiPromptBytes) : undefined;

    return new LoadedScreenshotPack({
      packPath,
      manifest,
      integrity,
      domContext,
      environment,
      cascade,
      aiPrompt,
      files,
      skippedMediaFiles,
    });
  }

  const sampleFiles = Array.from(files.keys()).slice(0, 10).join(", ");
  throw new Error(
    `UNRECOGNIZED_BUG_LENS_PACK: Archive does not contain "data/session-data.js" or "dom-context.json". Found files: [${sampleFiles}]`
  );
}

export function sanitizeRelativePathForDisk(relPath: string): {
  sanitized: string;
  renamed: boolean;
} {
  const clean = normalizeArchiveEntryPath(relPath);
  const parts = clean.split("/").map((segment) => {
    const replaced = segment.replace(WINDOWS_RESERVED_CHARS_RE, "_");
    // Windows 禁止文件名以空格或点结尾
    return replaced.replace(/[. ]+$/, "_");
  });
  const sanitized = parts.join("/");
  return { sanitized, renamed: sanitized !== clean };
}

export interface ExtractPackResult {
  destDir: string;
  writtenFiles: string[];
  renamedPaths: Array<{ from: string; to: string }>;
  reproduceSpecPath?: string;
  reportHtmlPath?: string;
  screenshotPath?: string;
}

export function extractPackToDisk(
  pack: LoadedPack,
  customDestDir?: string
): ExtractPackResult {
  const defaultSubdir =
    pack.kind === "session"
      ? pack.sessionId.slice(0, 8) || "session"
      : "screenshot";
  const destRoot = resolve(
    customDestDir ?? join(tmpdir(), "bug-lens-workspace", defaultSubdir)
  );
  mkdirSync(destRoot, { recursive: true });

  const renamedPaths: Array<{ from: string; to: string }> = [];
  const renameMap = new Map<string, string>();

  for (const relPath of pack.files.keys()) {
    const { sanitized, renamed } = sanitizeRelativePathForDisk(relPath);
    if (renamed) {
      renamedPaths.push({ from: relPath, to: sanitized });
      renameMap.set(relPath, sanitized);
    }
  }

  const writtenFiles: string[] = [];
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  for (const [relPath, rawBytes] of pack.files.entries()) {
    const safeRel = renameMap.get(relPath) ?? relPath;
    const targetFullPath = resolve(destRoot, ...safeRel.split("/"));
    const rootWithSep = destRoot.endsWith(sep) ? destRoot : destRoot + sep;
    if (
      targetFullPath !== destRoot &&
      !targetFullPath.startsWith(rootWithSep)
    ) {
      throw new Error(
        `UNSAFE_ZIP_ENTRY_PATH: Target path escapes destination root: ${relPath}`
      );
    }
    mkdirSync(dirname(targetFullPath), { recursive: true });

    let bytesToWrite = rawBytes;
    if (relPath === "data/session-data.js" && renameMap.size > 0) {
      let text = decoder.decode(rawBytes);
      for (const [origPath, newPath] of renameMap.entries()) {
        text = text.split(origPath).join(newPath);
      }
      bytesToWrite = encoder.encode(text);
    }

    writeFileSync(targetFullPath, bytesToWrite);
    writtenFiles.push(safeRel);
  }

  const reproduceSpecPath = pack.files.has("reproduce.spec.ts")
    ? resolve(destRoot, "reproduce.spec.ts")
    : undefined;
  const reportHtmlPath = pack.files.has("report.html")
    ? resolve(destRoot, "report.html")
    : undefined;
  const screenshotRel =
    pack.kind === "screenshot" ? pack.getScreenshotImagePath() : undefined;
  const screenshotPath = screenshotRel
    ? resolve(destRoot, screenshotRel)
    : undefined;

  return {
    destDir: destRoot,
    writtenFiles: writtenFiles.sort(),
    renamedPaths,
    reproduceSpecPath,
    reportHtmlPath,
    screenshotPath,
  };
}
