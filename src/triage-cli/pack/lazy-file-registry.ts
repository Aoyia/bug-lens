import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { PackFileEntryMeta, PackFileMap } from "./types.ts";

export const MAX_SINGLE_FILE_BYTES = 64 * 1024 * 1024; // 64 MB
export const MAX_TOTAL_UNCOMPRESSED_BYTES = 512 * 1024 * 1024; // 512 MB
export const MAX_MEDIA_FILE_BYTES = 1024 * 1024 * 1024; // 1 GB（录屏单独限额，不计入总量）
export const MEDIA_PATH_RE = /(?:^|\/)media\/|\.(?:mp4|webm|mkv|mov)$/i;

const MAX_SINGLE_CACHED_DISK_BYTES = 2 * 1024 * 1024; // 2 MB
const MAX_TOTAL_CACHED_DISK_BYTES = 16 * 1024 * 1024; // 16 MB

export interface FileMetadata {
  relPath: string;
  byteLength: number;
  diskAbsolutePath?: string;
  inMemoryBuffer?: Uint8Array;
}

export function normalizeRegistryPath(relPath: string): string {
  return relPath.replace(/\\/g, "/").replace(/^\.?\//, "");
}

export function listPackFileEntries(files: PackFileMap): PackFileEntryMeta[] {
  if ("listEntries" in files && typeof files.listEntries === "function") {
    return files.listEntries();
  }
  const items: PackFileEntryMeta[] = [];
  for (const [path, bytes] of files.entries()) {
    items.push({ path, byteLength: bytes.byteLength });
  }
  return items;
}

/**
 * 证据包按需文件索引：扫描目录只登记字节元信息，读取时才按需加载，并将磁盘读缓存控制在固定内存上限内。
 */
export class LazyFileRegistry {
  private readonly fileIndex = new Map<string, FileMetadata>();
  private readonly textDecoder = new TextDecoder("utf-8");
  private totalScannedBytes = 0;
  private cachedDiskBytes = 0;
  private readonly diskCacheOrder: string[] = [];

  public readonly skippedMediaFiles = new Map<
    string,
    { originalSize: number; compressedSize: number }
  >();

  constructor(public readonly rootDir?: string) {}

  private evictCachedDiskBuffer(normalized: string): void {
    const meta = this.fileIndex.get(normalized);
    if (!meta?.diskAbsolutePath || !meta.inMemoryBuffer) return;
    this.cachedDiskBytes = Math.max(
      0,
      this.cachedDiskBytes - meta.inMemoryBuffer.byteLength
    );
    meta.inMemoryBuffer = undefined;
    const idx = this.diskCacheOrder.indexOf(normalized);
    if (idx !== -1) this.diskCacheOrder.splice(idx, 1);
  }

  private cacheDiskBuffer(
    normalized: string,
    meta: FileMetadata,
    buf: Uint8Array
  ): void {
    if (buf.byteLength > MAX_SINGLE_CACHED_DISK_BYTES) return;
    while (
      this.diskCacheOrder.length > 0 &&
      this.cachedDiskBytes + buf.byteLength > MAX_TOTAL_CACHED_DISK_BYTES
    ) {
      const oldest = this.diskCacheOrder.shift();
      if (oldest) this.evictCachedDiskBuffer(oldest);
    }
    meta.inMemoryBuffer = buf;
    this.cachedDiskBytes += buf.byteLength;
    this.diskCacheOrder.push(normalized);
  }

  private checkSizeQuota(
    relPath: string,
    nextBytes: number,
    prevBytes: number
  ): number {
    if (nextBytes > MAX_SINGLE_FILE_BYTES) {
      throw new Error(
        `ZIP_BOMB_SINGLE_FILE_EXCEEDED: File "${relPath}" (${nextBytes} bytes) exceeds limit`
      );
    }
    const candidateTotal = this.totalScannedBytes - prevBytes + nextBytes;
    if (candidateTotal > MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw new Error(
        `ZIP_BOMB_TOTAL_SIZE_EXCEEDED: Total size (${candidateTotal} bytes) exceeds limit`
      );
    }
    return candidateTotal;
  }

  public registerDiskFile(
    relPath: string,
    diskAbsolutePath: string,
    byteLength: number
  ): void {
    const normalized = normalizeRegistryPath(relPath);
    const prev = this.fileIndex.get(normalized);
    const nextTotal = this.checkSizeQuota(
      normalized,
      byteLength,
      prev?.byteLength ?? 0
    );
    this.evictCachedDiskBuffer(normalized);
    this.totalScannedBytes = nextTotal;
    this.fileIndex.set(normalized, {
      relPath: normalized,
      byteLength,
      diskAbsolutePath,
    });
  }

  public registerBuffer(relPath: string, buffer: Uint8Array): void {
    const normalized = normalizeRegistryPath(relPath);
    const prev = this.fileIndex.get(normalized);
    const nextTotal = this.checkSizeQuota(
      normalized,
      buffer.byteLength,
      prev?.byteLength ?? 0
    );
    this.evictCachedDiskBuffer(normalized);
    this.totalScannedBytes = nextTotal;
    this.fileIndex.set(normalized, {
      relPath: normalized,
      byteLength: buffer.byteLength,
      inMemoryBuffer: buffer,
    });
  }

  public scanDirectory(rootDir: string, ignorePatterns?: Set<string>): void {
    const walk = (currentDir: string, relPrefix: string) => {
      for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
        const relPath = normalizeRegistryPath(
          relPrefix ? `${relPrefix}/${entry.name}` : entry.name
        );
        const fullPath = join(currentDir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath, relPath);
        } else if (entry.isFile()) {
          if (ignorePatterns?.has(relPath)) continue;
          const st = statSync(fullPath);
          if (MEDIA_PATH_RE.test(relPath)) {
            this.skippedMediaFiles.set(relPath, {
              originalSize: st.size,
              compressedSize: st.size,
            });
            continue;
          }
          this.registerDiskFile(relPath, fullPath, st.size);
        }
      }
    };

    walk(rootDir, "");
  }

  public getMetadata(relPath: string): FileMetadata | undefined {
    return this.fileIndex.get(normalizeRegistryPath(relPath));
  }

  public has(relPath: string): boolean {
    return this.fileIndex.has(normalizeRegistryPath(relPath));
  }

  public get(relPath: string): Uint8Array | undefined {
    return this.readBytes(relPath);
  }

  public delete(relPath: string): boolean {
    const normalized = normalizeRegistryPath(relPath);
    const existing = this.fileIndex.get(normalized);
    if (!existing) return false;
    this.evictCachedDiskBuffer(normalized);
    this.totalScannedBytes = Math.max(
      0,
      this.totalScannedBytes - existing.byteLength
    );
    return this.fileIndex.delete(normalized);
  }

  public clear(): void {
    this.fileIndex.clear();
    this.skippedMediaFiles.clear();
    this.totalScannedBytes = 0;
    this.cachedDiskBytes = 0;
    this.diskCacheOrder.length = 0;
  }

  public get size(): number {
    return this.fileIndex.size;
  }

  public keys(): IterableIterator<string> {
    return this.fileIndex.keys();
  }

  public *values(): IterableIterator<Uint8Array> {
    for (const key of this.fileIndex.keys()) {
      const b = this.readBytes(key);
      if (b) yield b;
    }
  }

  public *entries(): IterableIterator<[string, Uint8Array]> {
    for (const key of this.fileIndex.keys()) {
      const b = this.readBytes(key);
      if (b) yield [key, b];
    }
  }

  public *[Symbol.iterator](): IterableIterator<[string, Uint8Array]> {
    yield* this.entries();
  }

  public readBytesUncached(relPath: string): Uint8Array | undefined {
    const meta = this.fileIndex.get(normalizeRegistryPath(relPath));
    if (!meta) return undefined;
    if (meta.inMemoryBuffer) return meta.inMemoryBuffer;
    if (meta.diskAbsolutePath && existsSync(meta.diskAbsolutePath)) {
      return new Uint8Array(readFileSync(meta.diskAbsolutePath));
    }
    return undefined;
  }

  public readBytes(relPath: string): Uint8Array | undefined {
    const normalized = normalizeRegistryPath(relPath);
    const meta = this.fileIndex.get(normalized);
    if (!meta) return undefined;
    if (meta.inMemoryBuffer) {
      if (meta.diskAbsolutePath) {
        const idx = this.diskCacheOrder.indexOf(normalized);
        if (idx !== -1) {
          this.diskCacheOrder.splice(idx, 1);
          this.diskCacheOrder.push(normalized);
        }
      }
      return meta.inMemoryBuffer;
    }
    if (meta.diskAbsolutePath && existsSync(meta.diskAbsolutePath)) {
      const buf = new Uint8Array(readFileSync(meta.diskAbsolutePath));
      this.cacheDiskBuffer(normalized, meta, buf);
      return buf;
    }
    return undefined;
  }

  public readText(relPath: string): string | undefined {
    const bytes = this.readBytes(relPath);
    return bytes ? this.textDecoder.decode(bytes) : undefined;
  }

  public listEntries(): PackFileEntryMeta[] {
    return Array.from(this.fileIndex.values()).map((m) => ({
      path: m.relPath,
      byteLength: m.byteLength,
    }));
  }

  public static fromMap(map: Map<string, Uint8Array>): LazyFileRegistry {
    const registry = new LazyFileRegistry();
    for (const [k, v] of map.entries()) {
      registry.registerBuffer(k, v);
    }
    return registry;
  }
}
