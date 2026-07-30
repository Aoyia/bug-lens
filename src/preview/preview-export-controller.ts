import { buildExportManifest } from "../export/export-manifest";
import { createTemporaryArchive } from "../export/archive-destination";
import { writeEvidenceArchive } from "../export/export-pipeline";
import type { ExportArtifact } from "../shared/protocol";
import type { db } from "../storage/db";
import { buildEvidencePackage, type EvidencePackageSnapshot, type StaticReportAssets } from "./evidence-package";
import { loadStaticReportAssets } from "./static-report-assets";

export type PreviewExportStorage = Pick<typeof db, "getExportArtifact" | "saveExportArtifact" | "iterateMediaChunks">;

export type PreviewExportOptions = {
  root: Document;
  sessionId?: string;
  storage: PreviewExportStorage;
  getSnapshot(): EvidencePackageSnapshot | undefined;
  getMediaChunkCount(): number;
  notify(message: string): void;
  onArtifactChanged(): void;
  loadAssets?: () => Promise<StaticReportAssets>;
};

export class PreviewExportController {
  private artifact?: ExportArtifact;
  private readonly button: HTMLButtonElement;
  private readonly loadAssets: () => Promise<StaticReportAssets>;

  constructor(private readonly options: PreviewExportOptions) {
    this.button = options.root.querySelector<HTMLButtonElement>("#export")!;
    this.loadAssets = options.loadAssets ?? loadStaticReportAssets;
    this.button.addEventListener("click", () => void this.export());
  }

  get currentArtifact(): ExportArtifact | undefined { return this.artifact; }

  async load(): Promise<void> {
    if (!this.options.sessionId) return;
    this.artifact = await this.options.storage.getExportArtifact(this.options.sessionId);
    await this.reconcileDownloadArtifact();
    this.options.onArtifactChanged();
  }

  private async export(): Promise<void> {
    const { sessionId, storage, getSnapshot } = this.options;
    this.button.disabled = true;
    this.button.textContent = "正在准备…";
    let temporaryArchive: Awaited<ReturnType<typeof createTemporaryArchive>> | undefined;
    let blobUrl: string | undefined;
    try {
      const snapshot = getSnapshot();
      if (!snapshot || !sessionId) throw new Error("证据预览尚未加载完成");
      const reportAssets = await this.loadAssets();
      const filename = `web-bug-report-${snapshot.session.id.slice(0, 8)}.zip`;
      temporaryArchive = await createTemporaryArchive(filename);
      await writeEvidenceArchive({
        files: buildEvidencePackage(snapshot, reportAssets),
        sessionId,
        mediaSource: storage,
        sink: temporaryArchive.sink,
        createManifest: (integrity) => ({
          name: "data/manifest.json",
          data: new TextEncoder().encode(JSON.stringify(buildExportManifest(snapshot.session, integrity), null, 2))
        }),
        onProgress: ({ mediaChunksWritten, bytesWritten }) => {
          this.button.textContent = mediaChunksWritten
            ? `正在写入录像 ${mediaChunksWritten}/${this.options.getMediaChunkCount()}`
            : `正在生成 ${Math.max(1, Math.round(bytesWritten / 1024))} KiB`;
        }
      });
      const archiveFile = await temporaryArchive.getFile();
      blobUrl = URL.createObjectURL(archiveFile);
      const downloadId = await chrome.downloads.download({ url: blobUrl, filename, saveAs: true });
      this.artifact = { sessionId, downloadId, state: "in_progress", updatedAtEpochMs: Date.now() };
      await storage.saveExportArtifact(this.artifact);
      this.options.onArtifactChanged();
      this.artifact = await this.waitForDownload(downloadId);
      await storage.saveExportArtifact(this.artifact);
      this.options.onArtifactChanged();
      this.options.notify(this.artifact.state === "complete" ? "ZIP 下载完成，可复制 AI 提示词" : `ZIP ${this.artifact.error || "下载未完成"}`);
    } catch (error) {
      this.options.notify(`导出失败：${String(error)}`);
    } finally {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      await temporaryArchive?.cleanup().catch(() => undefined);
      this.button.disabled = false;
      this.button.textContent = "导出离线报告";
    }
  }

  private searchDownload(downloadId: number): Promise<chrome.downloads.DownloadItem | undefined> {
    return new Promise((resolve, reject) => {
      chrome.downloads.search({ id: downloadId }, (items) => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(items[0]);
      });
    });
  }

  private async waitForDownload(downloadId: number): Promise<ExportArtifact> {
    const sessionId = this.options.sessionId;
    if (!sessionId) throw new Error("缺少会话 ID");
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const item = await this.searchDownload(downloadId);
      if (item?.state === "complete") return { sessionId, downloadId, state: "complete", filename: item.filename, updatedAtEpochMs: Date.now() };
      if (item?.state === "interrupted") return { sessionId, downloadId, state: "interrupted", filename: item.filename, error: item.error || "下载中断", updatedAtEpochMs: Date.now() };
      await new Promise((resolve) => window.setTimeout(resolve, 500));
    }
    return { sessionId, downloadId, state: "interrupted", error: "下载状态查询超时，请在 Chrome 下载列表中确认文件是否完成。", updatedAtEpochMs: Date.now() };
  }

  private async reconcileDownloadArtifact(): Promise<void> {
    if (this.artifact?.state !== "in_progress") return;
    const download = await this.searchDownload(this.artifact.downloadId).catch(() => undefined);
    if (download?.state === "complete") {
      this.artifact = { ...this.artifact, state: "complete", filename: download.filename, updatedAtEpochMs: Date.now() };
    } else if (download?.state === "interrupted") {
      this.artifact = { ...this.artifact, state: "interrupted", filename: download.filename, error: download.error || "下载中断", updatedAtEpochMs: Date.now() };
    } else {
      return;
    }
    await this.options.storage.saveExportArtifact(this.artifact);
  }
}
