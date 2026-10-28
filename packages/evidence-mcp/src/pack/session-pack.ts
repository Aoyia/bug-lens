import { parseWindowAssignmentJson } from "./js-json.ts";
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
  SessionDataPayload,
} from "./types.ts";

export interface NormalizedIssueScene {
  id: string;
  index: number;
  scene: IssueSceneObject;
  originalSource?: string;
  annotatedSource?: string;
}

export class LoadedSessionPack {
  readonly kind = "session" as const;
  readonly packPath: string;
  readonly manifest?: ExportManifest;
  readonly integrity: IntegrityReport;
  readonly data: SessionDataPayload;
  readonly t0EpochMs: number;
  readonly files: Map<string, Uint8Array>;
  readonly skippedMediaFiles: Map<
    string,
    { originalSize: number; compressedSize: number }
  >;

  private networkDetailsCache?: Record<string, NetworkDetailEntry>;
  private textDecoder = new TextDecoder();

  constructor(params: {
    packPath: string;
    manifest?: ExportManifest;
    integrity: IntegrityReport;
    data: SessionDataPayload;
    files: Map<string, Uint8Array>;
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
    return this.data.consoleEntries ?? this.data.consoleLogs ?? [];
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
    } catch {
      this.networkDetailsCache = {};
    }
    return this.networkDetailsCache;
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
    const safeFileId = entry.id.replace(/[^a-zA-Z0-9._-]/g, "_");
    return (
      this.getTextFile(`network/body-${safeFileId}.txt`) ??
      this.getTextFile(`network/body-${entry.id}.txt`)
    );
  }

  getTextFile(filePath: string): string | undefined {
    const normalized = filePath.replace(/^\.?\//, "");
    const bytes = this.files.get(normalized);
    if (!bytes) return undefined;
    return this.textDecoder.decode(bytes);
  }

  getBinaryFile(filePath: string): Uint8Array | undefined {
    const normalized = filePath.replace(/^\.?\//, "");
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
    }> = [];
    for (const [path, bytes] of this.files.entries()) {
      list.push({ path, byteLength: bytes.byteLength });
    }
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
