import { unzipSync } from "fflate";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, posix, resolve, sep } from "node:path";
import { PackLruCache, type LoadedPack } from "./cache.ts";
import { buildIndexMarkdown } from "./index-writer.ts";
import { parseWindowAssignmentJson } from "./js-json.ts";
import { parseManifest, verifyPackIntegrity } from "./manifest.ts";
import { LoadedScreenshotPack } from "./screenshot-pack.ts";
import { LoadedSessionPack } from "./session-pack.ts";
import type {
  CascadeIndex,
  ScreenshotDomContext,
  ScreenshotEnvironment,
  SessionDataPayload,
} from "./types.ts";

export const MAX_SINGLE_FILE_BYTES = 64 * 1024 * 1024; // 64 MB
export const MAX_TOTAL_UNCOMPRESSED_BYTES = 512 * 1024 * 1024; // 512 MB
export const MAX_MEDIA_FILE_BYTES = 1024 * 1024 * 1024; // 1 GB（录屏单独限额，不计入总量）
export const MAX_WORKSPACE_PACKS = 10; // 工作区默认保留最近访问的 10 个解压包目录

/** 解压工作区内由 CLI 生成的派生文件（不属于原始证据包，加载时排除）。 */
export const EXTRACT_STAMP_FILE = ".bug-lens-extract.json";
export const INDEX_FILE = "INDEX.md";
export const DERIVED_JSON_FILES: ReadonlyArray<{
  source: string;
  target: string;
}> = [
  { source: "data/session-data.js", target: "data/session-data.json" },
  { source: "data/network-details.js", target: "data/network-details.json" },
];
const WORKSPACE_ARTIFACTS = new Set<string>([
  EXTRACT_STAMP_FILE,
  INDEX_FILE,
  ...DERIVED_JSON_FILES.map((d) => d.target),
]);
const EXTRACT_STAMP_VERSION = 1;

const MEDIA_PATH_RE = /(?:^|\/)media\/|\.(?:mp4|webm|mkv|mov)$/i;
const WINDOWS_RESERVED_CHARS_RE = /[:*?"<>|]/g;

const defaultCache = new PackLruCache(3);

type SkippedMediaMap = Map<
  string,
  { originalSize: number; compressedSize: number }
>;

interface ExtractStamp {
  version: number;
  source: string;
  sourceMtimeMs: number;
  sourceSize: number;
  renamedPaths: Array<{ from: string; to: string }>;
  extractedAt: string;
  lastAccessedAt?: number;
}

export function getTriageWorkspaceDir(): string {
  const custom =
    process.env.BUG_LENS_WORKSPACE_DIR || process.env.BUG_LENS_CLI_WORKSPACE;
  return custom ? resolve(custom) : join(tmpdir(), "bug-lens-workspace");
}

/** ZIP 对应的解压目录：`<workspace>/<zip文件名>-<源路径哈希6位>`，同名不同位置的包互不覆盖。 */
export function getWorkspaceDirForZip(zipRealPath: string): string {
  const base = basename(zipRealPath).replace(/\.zip$/i, "");
  const safe =
    base
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/^[_.]+|_+$/g, "")
      .slice(0, 80) || "pack";
  const hash = createHash("sha1").update(zipRealPath).digest("hex").slice(0, 6);
  return join(getTriageWorkspaceDir(), `${safe}-${hash}`);
}

/** 若证据包加载自解压目录，返回该目录；内存加载（openPackFromBytes）返回 undefined。 */
export function getPackWorkspaceDir(pack: LoadedPack): string | undefined {
  try {
    return statSync(pack.packPath).isDirectory() ? pack.packPath : undefined;
  } catch {
    return undefined;
  }
}

function getCurrentPackStateFile(): string {
  return join(getTriageWorkspaceDir(), ".current-pack");
}

function saveLastPackPathToDisk(packPath: string): void {
  try {
    const stateFile = getCurrentPackStateFile();
    mkdirSync(dirname(stateFile), { recursive: true });
    writeFileSync(stateFile, packPath, "utf8");
  } catch {
    // ignore disk state write errors
  }
}

function loadLastPackPathFromDisk(): string | undefined {
  try {
    const stateFile = getCurrentPackStateFile();
    if (existsSync(stateFile)) {
      const p = readFileSync(stateFile, "utf8").trim();
      if (p.length > 0) return p;
    }
  } catch {
    // ignore disk state read errors
  }
  return undefined;
}

export function clearPackCache(): void {
  defaultCache.clear();
  try {
    rmSync(getCurrentPackStateFile(), { force: true });
  } catch {
    // ignore
  }
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

/**
 * 解压 ZIP 字节流。`includeMedia=false` 时跳过录屏（仅登记尺寸），用于纯内存加载；
 * `includeMedia=true` 时录屏按 MAX_MEDIA_FILE_BYTES 单独限额，用于落盘解压。
 */
function unzipArchive(
  zipBytes: Uint8Array,
  includeMedia: boolean
): {
  files: Map<string, Uint8Array>;
  media: Map<string, Uint8Array>;
  skippedMediaFiles: SkippedMediaMap;
} {
  const skippedMediaFiles: SkippedMediaMap = new Map();
  const mediaNames = new Set<string>();
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
          if (!includeMedia) {
            skippedMediaFiles.set(cleanName, {
              originalSize: origSize,
              compressedSize: compSize,
            });
            return false;
          }
          if (origSize > MAX_MEDIA_FILE_BYTES) {
            throw new Error(
              `ZIP_BOMB_SINGLE_FILE_EXCEEDED: Media entry "${cleanName}" uncompressed size (${origSize} bytes) exceeds limit (${MAX_MEDIA_FILE_BYTES} bytes)`
            );
          }
          mediaNames.add(cleanName);
          return true;
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
  const media = new Map<string, Uint8Array>();
  let totalActualBytes = 0;
  for (const [rawName, bytes] of Object.entries(unzipped)) {
    const cleanName = normalizeArchiveEntryPath(rawName);
    if (cleanName.endsWith("/")) continue;
    if (mediaNames.has(cleanName)) {
      if (bytes.byteLength > MAX_MEDIA_FILE_BYTES) {
        throw new Error(
          `ZIP_BOMB_SINGLE_FILE_EXCEEDED: Decompressed media "${cleanName}" (${bytes.byteLength} bytes) exceeds limit (${MAX_MEDIA_FILE_BYTES} bytes)`
        );
      }
      media.set(cleanName, bytes);
      continue;
    }
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

  return { files, media, skippedMediaFiles };
}

function loadDirectoryArchive(rootDir: string): {
  files: Map<string, Uint8Array>;
  skippedMediaFiles: SkippedMediaMap;
} {
  const files = new Map<string, Uint8Array>();
  const skippedMediaFiles: SkippedMediaMap = new Map();
  let totalBytes = 0;

  function walk(currentDir: string, relPrefix: string) {
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, relPath);
      } else if (entry.isFile()) {
        if (WORKSPACE_ARTIFACTS.has(relPath)) continue;
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

function readExtractStamp(dir: string): ExtractStamp | undefined {
  try {
    const raw = readFileSync(join(dir, EXTRACT_STAMP_FILE), "utf8");
    const parsed = JSON.parse(raw) as ExtractStamp;
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function touchExtractStamp(dir: string): void {
  const stamp = readExtractStamp(dir);
  if (!stamp) return;
  try {
    stamp.lastAccessedAt = Date.now();
    writeFileSync(
      join(dir, EXTRACT_STAMP_FILE),
      JSON.stringify(stamp, null, 2),
      "utf8"
    );
  } catch {
    // 忽略只读或并发写异常
  }
}

function getMaxWorkspacePacks(): number {
  const raw = process.env.BUG_LENS_MAX_PACKS;
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= 1) return parsed;
  }
  return MAX_WORKSPACE_PACKS;
}

/**
 * 仅在工作区内部按 LRU 保留最近 N 个受管解压目录（含合法 .bug-lens-extract.json），
 * 非 CLI 创建的普通目录一律跳过，当前活跃目录强制保留。
 */
function pruneWorkspaceDirs(workspaceRoot: string, activeDir: string): void {
  try {
    if (!existsSync(workspaceRoot)) return;
    const maxPacks = getMaxWorkspacePacks();
    const canon = (p: string): string => {
      try {
        return realpathSync(p);
      } catch {
        return resolve(p);
      }
    };
    const activeResolved = canon(activeDir);
    const managed: Array<{ dir: string; lastAccessedAt: number }> = [];

    for (const entry of readdirSync(workspaceRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const fullDir = canon(resolve(workspaceRoot, entry.name));
      const stamp = readExtractStamp(fullDir);
      if (!stamp || typeof stamp.source !== "string") continue;
      const lastAccessedAt =
        typeof stamp.lastAccessedAt === "number" &&
        Number.isFinite(stamp.lastAccessedAt)
          ? stamp.lastAccessedAt
          : (() => {
              try {
                return statSync(join(fullDir, EXTRACT_STAMP_FILE)).mtimeMs;
              } catch {
                return 0;
              }
            })();
      managed.push({ dir: fullDir, lastAccessedAt });
    }

    if (managed.length <= maxPacks) return;

    managed.sort((a, b) => {
      if (a.dir === activeResolved) return -1;
      if (b.dir === activeResolved) return 1;
      return b.lastAccessedAt - a.lastAccessedAt;
    });

    for (const item of managed.slice(maxPacks)) {
      if (item.dir === activeResolved) continue;
      try {
        rmSync(item.dir, { recursive: true, force: true });
      } catch {
        // 忽略单个目录清理异常
      }
    }
  } catch {
    // 忽略工作区清理异常
  }
}

/**
 * 当传入短包名或子目录名（不含路径分隔符）且当前目录不存在同名文件时，
 * 在工作区受管解压目录中按名称匹配最近访问的目录。
 */
function resolveWorkspacePackShortcut(rawInput: string): string | undefined {
  if (rawInput.includes("/") || rawInput.includes("\\")) return undefined;
  const needle = rawInput
    .replace(/\.zip$/i, "")
    .trim()
    .toLowerCase();
  if (!needle) return undefined;
  const workspaceRoot = getTriageWorkspaceDir();
  if (!existsSync(workspaceRoot)) return undefined;

  let bestDir: string | undefined;
  let bestScore = -1;
  let bestTime = -1;

  try {
    for (const entry of readdirSync(workspaceRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const fullDir = resolve(workspaceRoot, entry.name);
      const stamp = readExtractStamp(fullDir);
      if (!stamp || typeof stamp.source !== "string") continue;
      const lowerName = entry.name.toLowerCase();
      const score =
        lowerName === needle ? 2 : lowerName.includes(needle) ? 1 : 0;
      if (score === 0) continue;
      const time = stamp.lastAccessedAt ?? 0;
      if (score > bestScore || (score === bestScore && time > bestTime)) {
        bestDir = fullDir;
        bestScore = score;
        bestTime = time;
      }
    }
  } catch {
    return undefined;
  }
  return bestDir;
}

function loadPackFromDirectory(dir: string): LoadedPack {
  const { files, skippedMediaFiles } = loadDirectoryArchive(dir);
  // 落盘时为兼容 Windows 改名的文件与随之改写的 session-data.js 不参与完整性校验
  const integritySkip = new Set<string>();
  const renamed = readExtractStamp(dir)?.renamedPaths ?? [];
  if (renamed.length > 0) {
    integritySkip.add("data/session-data.js");
    for (const r of renamed) integritySkip.add(r.from);
  }
  return instantiatePack(dir, files, skippedMediaFiles, integritySkip);
}

/**
 * 将 ZIP 幂等解压到工作区目录：源文件路径、mtime、size 与戳记一致时直接复用，
 * 否则清空目录后全量解压（含录屏），并生成派生 JSON 与 INDEX.md。
 */
function ensureExtracted(
  zipRealPath: string,
  st: { mtimeMs: number; size: number },
  destDir: string
): LoadedPack {
  const stamp = readExtractStamp(destDir);
  if (
    stamp &&
    stamp.version === EXTRACT_STAMP_VERSION &&
    stamp.source === zipRealPath &&
    stamp.sourceMtimeMs === st.mtimeMs &&
    stamp.sourceSize === st.size
  ) {
    touchExtractStamp(destDir);
    pruneWorkspaceDirs(getTriageWorkspaceDir(), destDir);
    return loadPackFromDirectory(destDir);
  }

  const { files, media } = unzipArchive(
    new Uint8Array(readFileSync(zipRealPath)),
    true
  );
  // 先在内存中识别包类型，非法包不落盘
  instantiatePack(zipRealPath, files, new Map());

  rmSync(destDir, { recursive: true, force: true });
  const allFiles = new Map<string, Uint8Array>([...files, ...media]);
  const { renamedPaths } = writeArchiveFiles(allFiles, destDir);
  writeDerivedJsonFiles(destDir);

  const now = Date.now();
  const newStamp: ExtractStamp = {
    version: EXTRACT_STAMP_VERSION,
    source: zipRealPath,
    sourceMtimeMs: st.mtimeMs,
    sourceSize: st.size,
    renamedPaths,
    extractedAt: new Date(now).toISOString(),
    lastAccessedAt: now,
  };
  writeFileSync(
    join(destDir, EXTRACT_STAMP_FILE),
    JSON.stringify(newStamp, null, 2),
    "utf8"
  );

  const loaded = loadPackFromDirectory(destDir);
  writeFileSync(
    join(destDir, INDEX_FILE),
    buildIndexMarkdown(loaded, destDir, zipRealPath),
    "utf8"
  );
  pruneWorkspaceDirs(getTriageWorkspaceDir(), destDir);
  return loaded;
}

/** 纯内存加载（不落盘），仅供单元测试与程序化调用；CLI 统一走 openPack 解压模式。 */
export function openPackFromBytes(
  zipBytes: Uint8Array,
  virtualPath = "<memory>.zip"
): LoadedPack {
  const { files, skippedMediaFiles } = unzipArchive(zipBytes, false);
  return instantiatePack(virtualPath, files, skippedMediaFiles);
}

/**
 * 打开证据包：ZIP 先幂等解压到 `<workspace>/<packName>-<hash>/` 再从目录加载；
 * 目录（已解压的工作区或手动解压目录）直接加载。当前包记录为解压目录。
 */
export function openPack(
  packPath?: string,
  cache: PackLruCache = defaultCache
): LoadedPack {
  const effectivePath =
    packPath && typeof packPath === "string" && packPath.trim().length > 0
      ? packPath.trim()
      : (cache.getLastPath() ?? loadLastPackPathFromDisk());
  if (!effectivePath) {
    throw new Error(
      'INVALID_PACK_PATH: pack path is required when no pack has been opened yet. Pass the "pack" argument or call open_pack first.'
    );
  }
  let resolved = resolve(effectivePath);
  if (!existsSync(resolved)) {
    const shortcut = resolveWorkspacePackShortcut(effectivePath);
    if (shortcut) resolved = shortcut;
  }
  let realPath: string;
  let st: ReturnType<typeof statSync>;
  try {
    realPath = realpathSync(resolved);
    st = statSync(realPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`PACK_NOT_FOUND: Cannot access "${effectivePath}": ${msg}`);
  }

  if (st.isDirectory()) {
    const stamp = readExtractStamp(realPath);
    const stampKey = stamp
      ? `${stamp.sourceMtimeMs}:${stamp.sourceSize}:${stamp.extractedAt}`
      : "0";
    const fingerprint = `dir:${st.mtimeMs}:${stampKey}`;
    const cached = cache.get(realPath, fingerprint);
    if (cached) {
      touchExtractStamp(realPath);
      saveLastPackPathToDisk(realPath);
      return cached;
    }
    try {
      writeDerivedJsonFiles(realPath, true);
    } catch {
      // 只读目录或权限受限时忽略派生文件写入
    }
    const loaded = loadPackFromDirectory(realPath);
    try {
      const indexPath = join(realPath, INDEX_FILE);
      if (!existsSync(indexPath)) {
        const sourcePath = stamp?.source ?? realPath;
        writeFileSync(
          indexPath,
          buildIndexMarkdown(loaded, realPath, sourcePath),
          "utf8"
        );
      }
    } catch {
      // 只读目录或权限受限时忽略 INDEX.md 写入
    }
    touchExtractStamp(realPath);
    cache.set(realPath, fingerprint, loaded);
    saveLastPackPathToDisk(realPath);
    return loaded;
  }

  const destDir = getWorkspaceDirForZip(realPath);
  const fingerprint = `zip:${st.mtimeMs}:${st.size}`;
  const cached = cache.get(destDir, fingerprint);
  if (cached) {
    touchExtractStamp(destDir);
    saveLastPackPathToDisk(destDir);
    return cached;
  }
  const loaded = ensureExtracted(realPath, st, destDir);
  cache.set(destDir, fingerprint, loaded);
  saveLastPackPathToDisk(destDir);
  return loaded;
}

function instantiatePack(
  packPath: string,
  files: Map<string, Uint8Array>,
  skippedMediaFiles: SkippedMediaMap,
  integritySkip?: Set<string>
): LoadedPack {
  const decoder = new TextDecoder();
  const manifest = parseManifest(files.get("manifest.json"));
  const skippedSet = new Set([
    ...skippedMediaFiles.keys(),
    ...(integritySkip ?? []),
  ]);
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
    const environment = parseJsonOpt<ScreenshotEnvironment>("environment.json");
    const cascade = parseJsonOpt<CascadeIndex>("cascade.json");
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

/** 将归档文件安全写入目录：Windows 保留字符改名，并同步改写 session-data.js 中的引用。 */
function writeArchiveFiles(
  files: Map<string, Uint8Array>,
  destRoot: string
): {
  writtenFiles: string[];
  renamedPaths: Array<{ from: string; to: string }>;
} {
  mkdirSync(destRoot, { recursive: true });
  const renamedPaths: Array<{ from: string; to: string }> = [];
  const renameMap = new Map<string, string>();

  for (const relPath of files.keys()) {
    const { sanitized, renamed } = sanitizeRelativePathForDisk(relPath);
    if (renamed) {
      renamedPaths.push({ from: relPath, to: sanitized });
      renameMap.set(relPath, sanitized);
    }
  }

  const writtenFiles: string[] = [];
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const rootWithSep = destRoot.endsWith(sep) ? destRoot : destRoot + sep;

  for (const [relPath, rawBytes] of files.entries()) {
    const safeRel = renameMap.get(relPath) ?? relPath;
    const targetFullPath = resolve(destRoot, ...safeRel.split("/"));
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

  return { writtenFiles: writtenFiles.sort(), renamedPaths };
}

/** 剥离 `window.__BUG_LENS_*__ = ` 包装，生成可直接 jq / JSON.parse 的格式化 JSON。 */
function writeDerivedJsonFiles(
  destRoot: string,
  onlyIfMissing = false
): string[] {
  const written: string[] = [];
  for (const { source, target } of DERIVED_JSON_FILES) {
    const sourcePath = join(destRoot, ...source.split("/"));
    const targetPath = join(destRoot, ...target.split("/"));
    if (!existsSync(sourcePath)) continue;
    if (onlyIfMissing && existsSync(targetPath)) {
      written.push(target);
      continue;
    }
    try {
      const parsed = parseWindowAssignmentJson(
        readFileSync(sourcePath, "utf8"),
        source
      );
      writeFileSync(targetPath, JSON.stringify(parsed, null, 2), "utf8");
      written.push(target);
    } catch {
      // 原始文件格式异常时不生成派生文件，INDEX.md 中会体现缺失
    }
  }
  return written;
}

export interface ExtractPackResult {
  destDir: string;
  writtenFiles: string[];
  renamedPaths: Array<{ from: string; to: string }>;
  reproduceSpecPath?: string;
  reportHtmlPath?: string;
  screenshotPath?: string;
}

function buildExtractResult(
  pack: LoadedPack,
  destRoot: string,
  writtenFiles: string[],
  renamedPaths: Array<{ from: string; to: string }>
): ExtractPackResult {
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
    writtenFiles,
    renamedPaths,
    reproduceSpecPath,
    reportHtmlPath,
    screenshotPath,
  };
}

/** 描述已解压的工作区（不重复写盘）。 */
export function describeWorkspace(
  pack: LoadedPack,
  workspaceDir: string
): ExtractPackResult {
  const renamedPaths = readExtractStamp(workspaceDir)?.renamedPaths ?? [];
  const writtenFiles = pack
    .listFiles()
    .map((f) => f.path)
    .sort();
  return buildExtractResult(pack, workspaceDir, writtenFiles, renamedPaths);
}

/** 将证据包复制到指定目录（含录屏与派生 JSON）。 */
export function extractPackToDisk(
  pack: LoadedPack,
  customDestDir?: string
): ExtractPackResult {
  const defaultSubdir =
    pack.kind === "session"
      ? pack.sessionId.slice(0, 8) || "session"
      : "screenshot";
  const destRoot = resolve(
    customDestDir ?? join(getTriageWorkspaceDir(), defaultSubdir)
  );
  const { writtenFiles, renamedPaths } = writeArchiveFiles(
    pack.files,
    destRoot
  );

  const sourceDir = getPackWorkspaceDir(pack);
  if (sourceDir) {
    for (const mediaRel of pack.skippedMediaFiles.keys()) {
      const from = join(sourceDir, ...mediaRel.split("/"));
      const to = join(destRoot, ...mediaRel.split("/"));
      if (existsSync(from) && resolve(from) !== resolve(to)) {
        mkdirSync(dirname(to), { recursive: true });
        copyFileSync(from, to);
        writtenFiles.push(mediaRel);
      }
    }
  }
  writeDerivedJsonFiles(destRoot);
  try {
    writeFileSync(
      join(destRoot, INDEX_FILE),
      buildIndexMarkdown(pack, destRoot, pack.packPath),
      "utf8"
    );
  } catch {
    // 忽略索引写入异常
  }

  return buildExtractResult(pack, destRoot, writtenFiles.sort(), renamedPaths);
}
