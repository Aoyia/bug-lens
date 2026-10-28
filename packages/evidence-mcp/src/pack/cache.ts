import type { LoadedScreenshotPack } from "./screenshot-pack.ts";
import type { LoadedSessionPack } from "./session-pack.ts";

export type LoadedPack = LoadedSessionPack | LoadedScreenshotPack;

export class PackLruCache {
  private readonly maxEntries: number;
  private readonly map = new Map<
    string,
    { fingerprint: string; pack: LoadedPack }
  >();

  constructor(maxEntries = 3) {
    this.maxEntries = maxEntries;
  }

  get(realPath: string, fingerprint: string): LoadedPack | undefined {
    const entry = this.map.get(realPath);
    if (!entry) return undefined;
    if (entry.fingerprint !== fingerprint) {
      this.map.delete(realPath);
      return undefined;
    }
    // 刷新 LRU 顺序
    this.map.delete(realPath);
    this.map.set(realPath, entry);
    return entry.pack;
  }

  set(realPath: string, fingerprint: string, pack: LoadedPack): void {
    if (this.map.has(realPath)) {
      this.map.delete(realPath);
    } else if (this.map.size >= this.maxEntries) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey);
      }
    }
    this.map.set(realPath, { fingerprint, pack });
  }

  clear(): void {
    this.map.clear();
  }
}
