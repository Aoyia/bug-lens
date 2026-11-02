import fixWebmDuration from "fix-webm-duration";
import { migrateSessionForExport } from "../export/export-manifest";
import type {
  ConsoleEntry,
  EvidenceAsset,
  FrameworkStateEvidence,
  InteractionRecord,
  IssueScene,
  NetworkEntry,
  RecordingSession,
} from "../shared/protocol";
import { t } from "../shared/i18n";
import type { db } from "../storage/db";
import { normalizeExpected } from "../domain/issue-scene";
import { SourceMapCoordinator } from "../sourcemap/index";
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
  | "getFrameworkStates"
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
  private frameworkStates: FrameworkStateEvidence[] = [];
  private issueAssets: EvidenceAsset[] = [];
  private interactionAssets: EvidenceAsset[] = [];
  private issueScenePreviews: IssueScenePreview[] = [];
  private mediaUrl?: string;
  private mediaChunkCount = 0;
  private mediaMimeType = "video/webm";
  private readonly selection = new PreviewController();
  public lastIdbReadDurationMs = 0;
  public lastSourceMapDurationMs = 0;

  constructor(private readonly storage: PreviewStorage) {}

  get currentSession(): RecordingSession | undefined {
    return this.session;
  }
  get mediaChunks(): number {
    return this.mediaChunkCount;
  }

  async load(
    sessionId: string,
    options?: { forExport?: boolean }
  ): Promise<void> {
    this.sessionId = sessionId;
    const forExport = Boolean(options?.forExport);

    // 并行读取所有 IDB 基础数据，大幅降低总 I/O 等待耗时
    const tIdb0 =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    const [
      rawSession,
      allAssetsRaw,
      rawInteractions,
      exportSelection,
      rawConsole,
      networkEntries,
      rawIssueScenes,
      frameworkStates,
      mediaSummary,
    ] = await Promise.all([
      this.storage.getSession(sessionId),
      this.storage.getEvidenceAssetsForSession?.(sessionId) ??
        Promise.resolve([]),
      this.storage.getInteractions(sessionId),
      this.storage.getExportSelection(sessionId),
      this.storage.getConsole(sessionId),
      this.storage.getNetwork(sessionId),
      this.storage.getIssueScenes(sessionId),
      this.storage.getFrameworkStates(sessionId),
      this.storage.getMediaSummary(sessionId),
    ]);
    this.lastIdbReadDurationMs =
      (typeof performance !== "undefined" ? performance.now() : Date.now()) -
      tIdb0;

    if (!rawSession) return;

    let session = rawSession;
    const migrated = migrateSessionForExport(session);
    if (migrated !== session) {
      session = migrated;
      await this.storage.saveSession(migrated);
    }
    this.session = session;

    const allAssets = allAssetsRaw ?? [];
    this.issueAssets = allAssets.filter(
      (a) => a.kind === "issue-original" || a.kind === "issue-annotated"
    );
    this.interactionAssets = allAssets.filter(
      (a) => a.kind === "interaction-screenshot"
    );

    this.interactions = rawInteractions
      .filter((item) => item.status !== "cancelled")
      .sort((left, right) => left.createdAt - right.createdAt)
      .map((item) => {
        const isPending = item.screenshot?.status === "pending";
        const normalizedItem: InteractionRecord = isPending
          ? {
              ...item,
              screenshot: {
                ...item.screenshot,
                status: "unavailable",
                issue: item.screenshot?.issue ?? t("screenshotUnavailable"),
              },
            }
          : item;
        // 导出场景无需为截图生成用于 UI 渲染的 Blob URL，避免多余内存分配与泄露
        if (!forExport && normalizedItem.screenshot?.status === "captured") {
          const asset = this.interactionAssets.find(
            (a) =>
              a.id === normalizedItem.screenshot?.assetId ||
              a.interactionId === normalizedItem.id
          );
          if (asset) {
            const objectUrl = URL.createObjectURL(
              new Blob([asset.bytes], { type: asset.mimeType })
            );
            return {
              ...normalizedItem,
              screenshot: { ...normalizedItem.screenshot, dataUrl: objectUrl },
            };
          }
        }
        return normalizedItem;
      });

    this.selection.loadSelection(exportSelection);
    const sortedConsole = rawConsole.sort(
      (left, right) => left.createdAt - right.createdAt
    );

    // 🌟 在 Preview 加载数据时，基于异常与时空交互聚焦准入策略（方案一）丰富调用链
    const tSm0 =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    try {
      const coordinator = new SourceMapCoordinator();
      const enriched = await coordinator.enrichEntries(
        sortedConsole,
        networkEntries,
        {
          interactions: this.interactions,
          issueScenes: rawIssueScenes,
        }
      );
      this.consoleEntries = enriched.consoleEntries;
      this.networkEntries = enriched.networkEntries;
    } catch {
      this.consoleEntries = sortedConsole;
      this.networkEntries = networkEntries;
    } finally {
      this.lastSourceMapDurationMs =
        (typeof performance !== "undefined" ? performance.now() : Date.now()) -
        tSm0;
    }

    this.issueScenes = rawIssueScenes.map((scene) =>
      scene.narrative
        ? {
            ...scene,
            narrative: {
              ...scene.narrative,
              // 兼容旧版 string 形态的期望陈述，避免预览/导出时静默丢失
              expected: normalizeExpected(scene.narrative.expected),
            },
          }
        : scene
    );
    this.frameworkStates = frameworkStates;

    if (!this.issueAssets.length) {
      this.issueAssets = (
        await Promise.all(
          this.issueScenes.map((scene) =>
            this.storage.getEvidenceAssets(scene.id)
          )
        )
      ).flat();
    }

    this.issueScenePreviews = forExport
      ? []
      : this.issueScenes.map((scene) => {
          const assets = this.issueAssets.filter(
            (asset) => asset.issueSceneId === scene.id
          );
          const original = assets.find(
            (asset) => asset.kind === "issue-original"
          );
          const annotated = assets.find(
            (asset) => asset.kind === "issue-annotated"
          );
          return {
            scene,
            originalSource: original
              ? URL.createObjectURL(
                  new Blob([original.bytes], { type: original.mimeType })
                )
              : undefined,
            annotatedSource: annotated
              ? URL.createObjectURL(
                  new Blob([annotated.bytes], { type: annotated.mimeType })
                )
              : undefined,
          };
        });

    await this.finalizePendingNetworkBodies();

    this.mediaChunkCount = mediaSummary.count;
    this.mediaMimeType = mediaSummary.mimeType || "video/webm";
  }

  async loadMediaPreview(): Promise<MediaPreviewResult> {
    if (!this.sessionId || this.mediaUrl) return {};
    try {
      const chunks = (await this.storage.getMediaChunks(this.sessionId)).filter(
        (entry) =>
          entry.chunk instanceof ArrayBuffer && entry.chunk.byteLength > 0
      );
      if (!chunks.length) {
        if (!this.mediaChunkCount) return {};
        throw new Error(t("mediaChunksEmptyOrCorrupt"));
      }
      this.mediaChunkCount = chunks.length;
      const mimeType = chunks[0].mimeType || this.mediaMimeType || "video/webm";
      this.mediaMimeType = mimeType;

      const rawBlob = new Blob(
        chunks.map((entry) => entry.chunk),
        { type: mimeType }
      );

      // 计算真实媒体切片的时间跨度，防止将跨 Tab 后的过长会话总时长写入 WebM 头部引发解码越界或卡死
      const firstRecordedAt = chunks[0].recordedAt;
      const lastRecordedAt = chunks[chunks.length - 1].recordedAt;
      const recordedSpanMs =
        lastRecordedAt >= firstRecordedAt
          ? lastRecordedAt - firstRecordedAt
          : 0;
      const estimatedDurationMs = Math.max(
        recordedSpanMs + 1000,
        chunks.length * 500
      );
      const sessionDurationMs = this.session?.timeline.durationMs;
      const effectiveDurationMs =
        sessionDurationMs && sessionDurationMs > 0
          ? Math.min(sessionDurationMs, estimatedDurationMs)
          : estimatedDurationMs;

      let finalBlob = rawBlob;
      if (mimeType.includes("webm") && effectiveDurationMs > 0) {
        try {
          finalBlob = await fixWebmDuration(rawBlob, effectiveDurationMs, {
            logger: false,
          });
        } catch (fixErr) {
          console.warn(
            "[Bug Lens Preview] fixWebmDuration 降级使用 rawBlob:",
            fixErr
          );
          finalBlob = rawBlob;
        }
      }

      this.mediaUrl = URL.createObjectURL(finalBlob);
      return { source: this.mediaUrl };
    } catch (error) {
      return { error: String(error) };
    }
  }

  getReportSnapshot(): EvidenceReportSnapshot | undefined {
    if (!this.session) return undefined;
    return {
      session: this.session,
      interactions: {
        all: this.interactions,
        included: this.selection.includedInteractions(this.interactions),
      },
      consoleEntries: {
        all: this.consoleEntries,
        included: this.selection.includedConsoleEntries(this.consoleEntries),
      },
      networkEntries: {
        all: this.networkEntries,
        included: this.selection.includedNetworkEntries(this.networkEntries),
      },
      issueScenes: {
        all: this.issueScenePreviews,
        included: this.selection.includedIssueScenes(this.issueScenePreviews),
      },
      frameworkStates: this.frameworkStates,
      hasMedia: Boolean(this.mediaUrl),
    };
  }

  getPackageSnapshot(): EvidencePackageSnapshot | undefined {
    if (!this.session) return undefined;
    return {
      session: this.session,
      interactions: this.selection.includedInteractions(this.interactions),
      consoleEntries: this.selection.includedConsoleEntries(
        this.consoleEntries
      ),
      networkEntries: this.selection.includedNetworkEntries(
        this.networkEntries
      ),
      issueScenes: this.selection.includedIssueScenes(this.issueScenes),
      frameworkStates: this.frameworkStates,
      issueAssets: this.issueAssets
        .filter(
          (asset) =>
            asset.issueSceneId &&
            this.selection
              .includedIssueScenes(this.issueScenes)
              .some((scene) => scene.id === asset.issueSceneId)
        )
        .map((asset) => ({
          sceneId: asset.issueSceneId!,
          kind: asset.kind as "issue-original" | "issue-annotated",
          bytes: new Uint8Array(asset.bytes),
          mimeType: asset.mimeType,
        })),
      interactionAssets: this.interactionAssets
        .filter(
          (asset) =>
            asset.interactionId &&
            this.selection
              .includedInteractions(this.interactions)
              .some((item) => item.id === asset.interactionId)
        )
        .map((asset) => ({
          interactionId: asset.interactionId!,
          bytes: new Uint8Array(asset.bytes),
          mimeType: asset.mimeType,
        })),
      excluded: {
        interaction: this.selection.excludedCount("interaction"),
        console: this.selection.excludedCount("console"),
        network: this.selection.excludedCount("network"),
        issueScene: this.selection.excludedCount("issueScene"),
      },
      hasMedia: this.mediaChunkCount > 0,
    };
  }

  async excludeInteraction(id: string): Promise<void> {
    this.selection.exclude("interaction", id);
    await this.saveSelection();
  }

  async excludeDiagnostic(
    kind: "console" | "network",
    id: string
  ): Promise<void> {
    this.selection.exclude(kind, id);
    await this.saveSelection();
  }

  async excludeIssueScene(id: string): Promise<void> {
    this.selection.exclude("issueScene", id);
    await this.saveSelection();
  }

  async renameSession(title: string): Promise<void> {
    if (!this.session) return;
    const sanitized = title.trim();
    this.session = {
      ...this.session,
      customTitle: sanitized || undefined,
    };
    await this.storage.saveSession(this.session);
  }

  async restore(
    kind: "interaction" | "console" | "network" | "issueScene"
  ): Promise<void> {
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
    if (this.sessionId)
      await this.storage.saveExportSelection(
        this.selection.toSelection(this.sessionId)
      );
  }

  private async finalizePendingNetworkBodies(): Promise<void> {
    if (
      !this.session ||
      !["PREVIEW_READY", "EXPORTED"].includes(this.session.status)
    )
      return;
    const staleIds = new Set(
      this.networkEntries
        .filter((entry) => entry.response?.bodyStatus === "pending")
        .map((entry) => entry.id)
    );
    if (!staleIds.size) return;
    this.networkEntries = this.networkEntries.map((entry) =>
      staleIds.has(entry.id)
        ? {
            ...entry,
            response: {
              ...entry.response,
              bodyStatus: "unavailable" as const,
              error: `RESPONSE_BODY_INCOMPLETE: ${t("responseBodyIncomplete")}`,
            },
          }
        : entry
    );
    await Promise.all(
      this.networkEntries
        .filter((entry) => staleIds.has(entry.id))
        .map((entry) => this.storage.saveNetwork(entry))
    );
  }
}
