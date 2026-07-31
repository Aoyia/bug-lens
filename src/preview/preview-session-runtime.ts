import fixWebmDuration from "fix-webm-duration";
import { migrateSessionForExport } from "../export/export-manifest";
import type { ConsoleEntry, EvidenceAsset, InteractionRecord, IssueScene, NetworkEntry, RecordingSession } from "../shared/protocol";
import type { db } from "../storage/db";
import { PreviewController } from "./preview-controller";
import type { EvidencePackageSnapshot } from "./evidence-package";
import type { EvidenceReportSnapshot } from "./evidence-report-view";
import type { IssueScenePreview } from "./issue-scene-view";

export type PreviewStorage = Pick<
  typeof db,
  | "getSession"
  | "saveSession"
  | "getInteractions"
  | "getExportSelection"
  | "saveExportSelection"
  | "getConsole"
  | "getNetwork"
  | "getIssueScenes"
  | "getEvidenceAssets"
  | "getEvidenceAssetsForSession"
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
  private issueScenes: IssueScene[] = [];
  private issueAssets: EvidenceAsset[] = [];
  private interactionAssets: EvidenceAsset[] = [];
  private issueScenePreviews: IssueScenePreview[] = [];
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
    const allAssets = (await this.storage.getEvidenceAssetsForSession?.(sessionId)) ?? [];
    this.issueAssets = allAssets.filter((a) => a.kind === "issue-original" || a.kind === "issue-annotated");
    this.interactionAssets = allAssets.filter((a) => a.kind === "interaction-screenshot");

    this.interactions = (await this.storage.getInteractions(sessionId))
      .filter((item) => item.status !== "cancelled")
      .sort((left, right) => left.createdAt - right.createdAt)
      .map((item) => {
        if (item.screenshot.status === "captured") {
          const asset = this.interactionAssets.find((a) => a.id === item.screenshot.assetId || a.interactionId === item.id);
          if (asset) {
            const objectUrl = URL.createObjectURL(new Blob([asset.bytes], { type: asset.mimeType }));
            return { ...item, screenshot: { ...item.screenshot, dataUrl: objectUrl } };
          }
        }
        return item;
      });
    this.selection.loadSelection(await this.storage.getExportSelection(sessionId));
    this.consoleEntries = (await this.storage.getConsole(sessionId)).sort((left, right) => left.createdAt - right.createdAt);
    this.networkEntries = await this.storage.getNetwork(sessionId);
    this.issueScenes = await this.storage.getIssueScenes(sessionId);
    if (!this.issueAssets.length) {
      this.issueAssets = (await Promise.all(this.issueScenes.map((scene) => this.storage.getEvidenceAssets(scene.id)))).flat();
    }
    this.issueScenePreviews = this.issueScenes.map((scene) => {
      const assets = this.issueAssets.filter((asset) => asset.issueSceneId === scene.id);
      const original = assets.find((asset) => asset.kind === "issue-original");
      const annotated = assets.find((asset) => asset.kind === "issue-annotated");
      return { scene, originalSource: original ? URL.createObjectURL(new Blob([original.bytes], { type: original.mimeType })) : undefined, annotatedSource: annotated ? URL.createObjectURL(new Blob([annotated.bytes], { type: annotated.mimeType })) : undefined };
    });
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
      const rawBlob = new Blob(chunks.map((entry) => entry.chunk), { type: this.mediaMimeType });
      const durationMs = this.session?.timeline.durationMs;
      const fixedBlob = this.mediaMimeType.includes("webm") && durationMs && durationMs > 0
        ? await fixWebmDuration(rawBlob, durationMs, { logger: false })
        : rawBlob;
      this.mediaUrl = URL.createObjectURL(fixedBlob);
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
      issueScenes: { all: this.issueScenePreviews, included: this.selection.includedIssueScenes(this.issueScenePreviews) },
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
      issueScenes: this.selection.includedIssueScenes(this.issueScenes),
      issueAssets: this.issueAssets.filter((asset) => asset.issueSceneId && this.selection.includedIssueScenes(this.issueScenes).some((scene) => scene.id === asset.issueSceneId)).map((asset) => ({ sceneId: asset.issueSceneId!, kind: asset.kind as "issue-original" | "issue-annotated", bytes: new Uint8Array(asset.bytes), mimeType: asset.mimeType })),
      interactionAssets: this.interactionAssets.filter((asset) => asset.interactionId && this.selection.includedInteractions(this.interactions).some((item) => item.id === asset.interactionId)).map((asset) => ({ interactionId: asset.interactionId!, bytes: new Uint8Array(asset.bytes), mimeType: asset.mimeType })),
      excluded: {
        interaction: this.selection.excludedCount("interaction"),
        console: this.selection.excludedCount("console"),
        network: this.selection.excludedCount("network"),
        issueScene: this.selection.excludedCount("issueScene")
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

  async excludeIssueScene(id: string): Promise<void> {
    this.selection.exclude("issueScene", id);
    await this.saveSelection();
  }

  async restore(kind: "interaction" | "console" | "network" | "issueScene"): Promise<void> {
    this.selection.restore(kind);
    await this.saveSelection();
  }

  dispose(): void {
    if (this.mediaUrl) URL.revokeObjectURL(this.mediaUrl);
    this.mediaUrl = undefined;
    for (const preview of this.issueScenePreviews) {
      if (preview.originalSource) URL.revokeObjectURL(preview.originalSource);
      if (preview.annotatedSource) URL.revokeObjectURL(preview.annotatedSource);
    }
    this.issueScenePreviews = [];
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
