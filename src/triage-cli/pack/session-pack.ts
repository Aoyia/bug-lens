import { parseWindowAssignmentJson } from "./js-json.ts";
import {
  listPackFileEntries,
  normalizeRegistryPath,
} from "./lazy-file-registry.ts";
import type {
  ConsoleEntry,
  ExportManifest,
  FrameworkStateEntry,
  IntegrityReport,
  InteractionEntry,
  IssueSceneEnvelope,
  IssueSceneObject,
  NetworkDetailEntry,
  NetworkEntry,
  PackFileMap,
  SessionDataPayload,
} from "./types.ts";

export interface NormalizedIssueScene {
  id: string;
  index: number;
  scene: IssueSceneObject;
  originalSource?: string;
  annotatedSource?: string;
  domContextPath?: string;
  domStylesPath?: string;
  targetSelector?: string;
}

function parseConsoleSummaryLocation(
  location?:
    string | { url?: string; lineNumber?: number; columnNumber?: number }
): { url?: string; lineNumber?: number; columnNumber?: number } {
  if (!location) return {};
  if (typeof location === "object") {
    return {
      url: location.url,
      lineNumber: location.lineNumber,
      columnNumber: location.columnNumber,
    };
  }
  const match = /^(.*):(\d+)(?::(\d+))?$/.exec(location);
  if (match) {
    return {
      url: match[1],
      lineNumber: Number(match[2]),
      columnNumber: match[3] ? Number(match[3]) : undefined,
    };
  }
  return { url: location };
}

export class LoadedSessionPack {
  readonly kind = "session" as const;
  readonly packPath: string;
  readonly manifest?: ExportManifest;
  readonly integrity: IntegrityReport;
  readonly data: SessionDataPayload;
  readonly t0EpochMs: number;
  readonly files: PackFileMap;
  readonly skippedMediaFiles: Map<
    string,
    { originalSize: number; compressedSize: number }
  >;

  private networkDetailsCache?: Record<string, NetworkDetailEntry>;
  private consoleEntriesCache?: ConsoleEntry[];
  private textDecoder = new TextDecoder();

  constructor(params: {
    packPath: string;
    manifest?: ExportManifest;
    integrity: IntegrityReport;
    data: SessionDataPayload;
    files: PackFileMap;
    skippedMediaFiles: Map<
      string,
      { originalSize: number; compressedSize: number }
    >;
  }) {
    this.packPath = params.packPath;
    this.manifest = params.manifest;
    this.integrity = params.integrity;
    this.data = params.data;
    this.files = params.files;
    this.skippedMediaFiles = params.skippedMediaFiles;

    const timeline = params.data.session?.timeline;
    const firstInteractionTime = params.data.interactions?.[0]?.createdAt;
    this.t0EpochMs =
      timeline?.startedAtEpochMs ??
      timeline?.createdAtEpochMs ??
      firstInteractionTime ??
      params.data.networkEntries?.[0]?.createdAt ??
      params.data.consoleEntries?.[0]?.createdAt ??
      params.data.consoleLogs?.[0]?.createdAt ??
      params.data.consoleSummary?.[0]?.firstCreatedAt ??
      params.manifest?.createdAtEpochMs ??
      0;
  }

  get sessionId(): string {
    return (
      this.data.session?.id ??
      this.manifest?.sessionId ??
      this.data.interactions?.[0]?.sessionId ??
      "unknown"
    );
  }

  toRelativeMs(epochMs?: number): number | undefined {
    if (typeof epochMs !== "number" || !Number.isFinite(epochMs)) {
      return undefined;
    }
    if (this.t0EpochMs <= 0) return epochMs;
    return epochMs - this.t0EpochMs;
  }

  toEpochMs(relativeMs: number): number {
    return this.t0EpochMs + relativeMs;
  }

  getConsoleEntries(): ConsoleEntry[] {
    if (this.data.consoleEntries) return this.data.consoleEntries;
    if (this.data.consoleLogs) return this.data.consoleLogs;
    if (this.consoleEntriesCache) return this.consoleEntriesCache;
    const summary = this.data.consoleSummary;
    if (!summary || summary.length === 0) return [];
    this.consoleEntriesCache = summary.map((item, idx) => {
      const loc = parseConsoleSummaryLocation(item.location);
      return {
        id: item.signature
          ? `summary-${item.signature}-${idx}`
          : `summary-${idx}`,
        level: item.level,
        text: item.text,
        source: item.source,
        createdAt:
          item.firstCreatedAt ?? item.lastCreatedAt ?? item.timestamps?.[0],
        url: loc.url,
        lineNumber: loc.lineNumber,
        columnNumber: loc.columnNumber,
        sourceMappedLocation: item.sourceMappedLocation,
        repeatCount: item.count,
        lastCreatedAt: item.lastCreatedAt,
        timeRangeMs: item.timeRangeMs,
        summarySignature: item.signature,
        summaryTimestamps: item.timestamps,
      };
    });
    return this.consoleEntriesCache;
  }

  getConsoleTotalCount(): number {
    const metricTotal =
      this.data.summary?.metrics?.consoleSummary?.totalOriginalEntries;
    if (typeof metricTotal === "number" && Number.isFinite(metricTotal)) {
      return metricTotal;
    }
    const entries = this.getConsoleEntries();
    return entries.reduce(
      (sum, entry) => sum + Math.max(1, entry.repeatCount ?? 1),
      0
    );
  }

  getInteractions(): InteractionEntry[] {
    return this.data.interactions ?? [];
  }

  getNetworkEntries(): NetworkEntry[] {
    return this.data.networkEntries ?? [];
  }

  getFrameworkStates(): FrameworkStateEntry[] {
    return this.data.frameworkStates ?? [];
  }

  getIssueScenes(): NormalizedIssueScene[] {
    const rawList: IssueSceneEnvelope[] = this.data.issueScenes ?? [];
    return rawList.map((item, index) => {
      const scene: IssueSceneObject = item.scene ?? {
        id: item.id,
        observedAtEpochMs: item.observedAtEpochMs,
        narrative: item.narrative,
        sequenceContext: item.sequenceContext,
        target: item.target,
        targets: item.targets,
      };
      const id = scene.id ?? item.id ?? `scene-${index + 1}`;
      const originalSource =
        item.originalSource ?? this.findSceneImagePath(id, "original");
      const annotatedSource =
        item.annotatedSource ?? this.findSceneImagePath(id, "annotated");
      return {
        id,
        index,
        scene,
        originalSource,
        annotatedSource,
        domContextPath: item.domContextPath,
        domStylesPath: item.domStylesPath,
        targetSelector: item.targetSelector,
      };
    });
  }

  private findSceneImagePath(
    sceneId: string,
    variant: "original" | "annotated"
  ): string | undefined {
    for (const ext of ["jpg", "png", "jpeg", "webp"]) {
      const candidate = `issues/${sceneId}/screenshot-${variant}.${ext}`;
      if (this.files.has(candidate)) return candidate;
    }
    return undefined;
  }

  getNetworkDetails(): Record<string, NetworkDetailEntry> {
    if (this.networkDetailsCache) return this.networkDetailsCache;

    const pureJsonCandidate = this.files.has("network-details.json")
      ? "network-details.json"
      : !this.files.has("data/network-details.js") &&
          this.files.has("data/network-details.json")
        ? "data/network-details.json"
        : undefined;

    if (pureJsonCandidate) {
      const pureJsonBytes = this.files.get(pureJsonCandidate);
      if (pureJsonBytes) {
        try {
          this.networkDetailsCache = JSON.parse(
            this.textDecoder.decode(pureJsonBytes)
          ) as Record<string, NetworkDetailEntry>;
          return this.networkDetailsCache;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new Error(
            `INVALID_JSON_FILE: Failed to parse ${pureJsonCandidate}: ${msg}`
          );
        }
      }
    }

    const raw = this.files.get("data/network-details.js");
    if (!raw) {
      this.networkDetailsCache = {};
      return this.networkDetailsCache;
    }
    try {
      const text = this.textDecoder.decode(raw);
      this.networkDetailsCache = parseWindowAssignmentJson<
        Record<string, NetworkDetailEntry>
      >(text, "data/network-details.js");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `INVALID_JSON_FILE: Failed to parse data/network-details.js: ${msg}`
      );
    }
    return this.networkDetailsCache;
  }

  /** 根据 CAS 哈希（支持 sha256: 前缀）或显式路径按需读取网络正文。 */
  resolveBlobTextByHash(
    hash?: string,
    explicitPath?: string
  ): string | undefined {
    if (explicitPath) {
      const byPath = this.getTextFile(explicitPath);
      if (byPath !== undefined) return byPath;
    }
    if (!hash) return undefined;
    const cleanHash = hash.replace(/^sha256:/i, "").trim();
    if (!cleanHash) return undefined;
    const shortHash = cleanHash.slice(0, 16);
    return (
      this.getTextFile(`network/blobs/${shortHash}.bin`) ??
      this.getTextFile(`network/blobs/${cleanHash}.bin`)
    );
  }

  getNetworkRequestBody(
    entry: NetworkEntry,
    details?: NetworkDetailEntry
  ): string | undefined {
    return this.resolveBlobTextByHash(
      entry.request?.bodyHash ?? details?.requestBodyBlob?.hash,
      details?.requestBodyBlob?.path
    );
  }

  getNetworkBody(entry: NetworkEntry): string | undefined {
    if (typeof entry.response?.body === "string") {
      return entry.response.body;
    }
    const bodyPath = entry.response?.bodyPath;
    if (bodyPath) {
      const text = this.getTextFile(bodyPath);
      if (text !== undefined) return text;
    }

    const fromEntryHash = this.resolveBlobTextByHash(entry.response?.bodyHash);
    if (fromEntryHash !== undefined) return fromEntryHash;

    const details = this.getNetworkDetails();
    const detailBlob = details[entry.id]?.bodyBlob;
    const fromDetailBlob = this.resolveBlobTextByHash(
      detailBlob?.hash,
      detailBlob?.path
    );
    if (fromDetailBlob !== undefined) return fromDetailBlob;

    const safeFileId = entry.id.replace(/[^a-zA-Z0-9._-]/g, "_");
    return (
      this.getTextFile(`network/body-${safeFileId}.txt`) ??
      this.getTextFile(`network/body-${entry.id}.txt`)
    );
  }

  getTextFile(filePath: string): string | undefined {
    const normalized = normalizeRegistryPath(filePath);
    const bytes = this.files.get(normalized);
    if (!bytes) return undefined;
    return this.textDecoder.decode(bytes);
  }

  getBinaryFile(filePath: string): Uint8Array | undefined {
    const normalized = normalizeRegistryPath(filePath);
    return this.files.get(normalized);
  }

  listFiles(): Array<{
    path: string;
    byteLength: number;
    skippedMedia?: boolean;
  }> {
    const list: Array<{
      path: string;
      byteLength: number;
      skippedMedia?: boolean;
    }> = listPackFileEntries(this.files).map((item) => ({
      path: item.path,
      byteLength: item.byteLength,
    }));
    for (const [path, info] of this.skippedMediaFiles.entries()) {
      list.push({
        path,
        byteLength: info.originalSize,
        skippedMedia: true,
      });
    }
    return list.sort((a, b) => a.path.localeCompare(b.path));
  }
}
