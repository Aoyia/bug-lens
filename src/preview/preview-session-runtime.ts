import { migrateSessionForExport } from "../export/export-manifest";
import type { ConsoleEntry, InteractionRecord, NetworkEntry, RecordingSession } from "../shared/protocol";
import type { db } from "../storage/db";
import { PreviewController } from "./preview-controller";
import type { EvidencePackageSnapshot } from "./evidence-package";
import type { EvidenceReportSnapshot } from "./evidence-report-view";

export type PreviewStorage = Pick<
  typeof db,
  | "getSession"
  | "saveSession"
  | "getInteractions"
  | "getExportSelection"
  | "saveExportSelection"
  | "getConsole"
  | "getNetwork"
  | "getMediaSummary"
  | "getMediaChunks"
  | "saveNetwork"
>;

export type MediaPreviewResult = { source?: string; error?: string };

export class PreviewSessionRuntime {
  private sessionId?: string;
  private session?: RecordingSession;
  private interactions: InteractionRecord[] = [];
  private consoleEntries: ConsoleEntry[] = [];
  private networkEntries: NetworkEntry[] = [];
  private mediaUrl?: string;
  private mediaChunkCount = 0;
  private mediaMimeType = "video/webm";
  private readonly selection = new PreviewController();

  constructor(private readonly storage: PreviewStorage) {}

  get currentSession(): RecordingSession | undefined { return this.session; }
  get mediaChunks(): number { return this.mediaChunkCount; }

  async load(sessionId: string): Promise<void> {
    this.sessionId = sessionId;
    this.session = await this.storage.getSession(sessionId);
    if (!this.session) return;

    const migrated = migrateSessionForExport(this.session);
    if (migrated !== this.session) {
      this.session = migrated;
      await this.storage.saveSession(migrated);
    }
    this.interactions = (await this.storage.getInteractions(sessionId))
      .filter((item) => item.status !== "cancelled")
      .sort((left, right) => left.createdAt - right.createdAt);
    this.selection.loadSelection(await this.storage.getExportSelection(sessionId));
    this.consoleEntries = (await this.storage.getConsole(sessionId)).sort((left, right) => left.createdAt - right.createdAt);
    this.networkEntries = await this.storage.getNetwork(sessionId);
    await this.finalizePendingNetworkBodies();

    const mediaSummary = await this.storage.getMediaSummary(sessionId);
    this.mediaChunkCount = mediaSummary.count;
    this.mediaMimeType = mediaSummary.mimeType || "video/webm";
  }

  async loadMediaPreview(): Promise<MediaPreviewResult> {
    if (!this.sessionId || this.mediaUrl || !this.mediaChunkCount) return {};
    try {
      const chunks = (await this.storage.getMediaChunks(this.sessionId))
        .filter((entry) => entry.chunk instanceof ArrayBuffer && entry.chunk.byteLength > 0);
      if (!chunks.length) throw new Error("媒体分片为空或已损坏");
      this.mediaUrl = URL.createObjectURL(new Blob(chunks.map((entry) => entry.chunk), { type: this.mediaMimeType }));
      return { source: this.mediaUrl };
    } catch (error) {
      return { error: String(error) };
    }
  }

  getReportSnapshot(): EvidenceReportSnapshot | undefined {
    if (!this.session) return undefined;
    return {
      session: this.session,
      interactions: { all: this.interactions, included: this.selection.includedInteractions(this.interactions) },
      consoleEntries: { all: this.consoleEntries, included: this.selection.includedConsoleEntries(this.consoleEntries) },
      networkEntries: { all: this.networkEntries, included: this.selection.includedNetworkEntries(this.networkEntries) },
      hasMedia: Boolean(this.mediaUrl)
    };
  }

  getPackageSnapshot(): EvidencePackageSnapshot | undefined {
    if (!this.session) return undefined;
    return {
      session: this.session,
      interactions: this.selection.includedInteractions(this.interactions),
      consoleEntries: this.selection.includedConsoleEntries(this.consoleEntries),
      networkEntries: this.selection.includedNetworkEntries(this.networkEntries),
      excluded: {
        interaction: this.selection.excludedCount("interaction"),
        console: this.selection.excludedCount("console"),
        network: this.selection.excludedCount("network")
      },
      hasMedia: this.mediaChunkCount > 0
    };
  }

  async excludeInteraction(id: string): Promise<void> {
    this.selection.exclude("interaction", id);
    await this.saveSelection();
  }

  async excludeDiagnostic(kind: "console" | "network", id: string): Promise<void> {
    this.selection.exclude(kind, id);
    await this.saveSelection();
  }

  async restore(kind: "interaction" | "console" | "network"): Promise<void> {
    this.selection.restore(kind);
    await this.saveSelection();
  }

  dispose(): void {
    if (this.mediaUrl) URL.revokeObjectURL(this.mediaUrl);
    this.mediaUrl = undefined;
  }

  private async saveSelection(): Promise<void> {
    if (this.sessionId) await this.storage.saveExportSelection(this.selection.toSelection(this.sessionId));
  }

  private async finalizePendingNetworkBodies(): Promise<void> {
    if (!this.session || !["PREVIEW_READY", "EXPORTED"].includes(this.session.status)) return;
    const staleIds = new Set(this.networkEntries
      .filter((entry) => entry.response?.bodyStatus === "pending")
      .map((entry) => entry.id));
    if (!staleIds.size) return;
    this.networkEntries = this.networkEntries.map((entry) => staleIds.has(entry.id) ? {
      ...entry,
      response: {
        ...entry.response,
        bodyStatus: "unavailable" as const,
        error: "RESPONSE_BODY_INCOMPLETE: 录制已结束，响应正文读取未完成"
      }
    } : entry);
    await Promise.all(this.networkEntries
      .filter((entry) => staleIds.has(entry.id))
      .map((entry) => this.storage.saveNetwork(entry)));
  }
}
