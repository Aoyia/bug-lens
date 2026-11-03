import { buildExportManifest } from "../export/export-manifest.ts";
import { createTemporaryArchive } from "../export/archive-destination.ts";
import { writeEvidenceArchive } from "../export/export-pipeline.ts";
import { t } from "../shared/i18n.ts";
import type { ExportArtifact } from "../shared/protocol.ts";
import type { db } from "../storage/db.ts";
import {
  buildEvidencePackage,
  type EvidencePackageSnapshot,
  type StaticReportAssets,
} from "./evidence-package.ts";
import { loadStaticReportAssets } from "./static-report-assets.ts";

function isUserCanceled(error?: unknown): boolean {
  if (!error) return false;
  const str = String(error).toUpperCase();
  return (
    str.includes("USER_CANCELED") ||
    str.includes("USER CANCELLED") ||
    str.includes("USER CANCELED")
  );
}

export type PreviewExportStorage = Pick<
  typeof db,
  "getExportArtifact" | "saveExportArtifact" | "iterateMediaChunks"
>;

export type PreviewExportOptions = {
  root: Document;
  sessionId?: string;
  storage: PreviewExportStorage;
  getSnapshot(): EvidencePackageSnapshot | undefined;
  getMediaChunkCount(): number;
  notify(message: string): void;
  onArtifactChanged(): void;
  beforeExport?: () => Promise<unknown>;
  onExportStart?: (mode: "ai" | "ticket") => Promise<boolean>;
  onExportComplete?: (mode: "ai" | "ticket") => Promise<boolean>;
  loadAssets?: () => Promise<StaticReportAssets>;
  createArchive?: typeof createTemporaryArchive;
  writeArchive?: typeof writeEvidenceArchive;
};

export class PreviewExportController {
  private artifact?: ExportArtifact;
  private readonly button: HTMLButtonElement;
  private readonly ticketButton: HTMLButtonElement | null;
  private readonly loadAssets: () => Promise<StaticReportAssets>;
  private readonly options: PreviewExportOptions;

  constructor(options: PreviewExportOptions) {
    this.options = options;
    this.button = options.root.querySelector<HTMLButtonElement>("#export")!;
    this.ticketButton =
      options.root.querySelector<HTMLButtonElement>("#create-ticket-btn");
    this.loadAssets = options.loadAssets ?? loadStaticReportAssets;
    this.button?.addEventListener("click", () => void this.export("ai"));
    this.ticketButton?.addEventListener(
      "click",
      () => void this.export("ticket")
    );
  }

  get currentArtifact(): ExportArtifact | undefined {
    return this.artifact;
  }

  private setProgress(
    percent: number,
    done = false,
    mode: "ai" | "ticket" = "ai"
  ): void {
    const barId =
      mode === "ticket" ? "#ticket-progress-bar" : "#export-progress-bar";
    const fillId =
      mode === "ticket" ? "#ticket-progress-fill" : "#export-progress-fill";
    const bar =
      this.options.root.querySelector<HTMLElement>(barId) ??
      this.options.root.querySelector<HTMLElement>("#export-progress-bar");
    const fill =
      this.options.root.querySelector<HTMLElement>(fillId) ??
      this.options.root.querySelector<HTMLElement>("#export-progress-fill");

    if (!bar || !fill) return;
    bar.hidden = false;
    if (done) {
      fill.style.width = "100%";
      fill.classList.add("done");
      setTimeout(() => {
        bar.hidden = true;
        fill.classList.remove("done");
        fill.style.width = "0%";
      }, 2000);
    } else {
      fill.classList.remove("done");
      fill.style.width = `${Math.min(99, Math.max(2, percent))}%`;
    }
  }

  async load(): Promise<void> {
    if (!this.options.sessionId) return;
    this.artifact = await this.options.storage.getExportArtifact(
      this.options.sessionId
    );
    await this.reconcileDownloadArtifact();
    this.options.onArtifactChanged();
  }

  async export(
    mode: "ai" | "ticket" = "ai",
    exportOptions?: { skipClipboard?: boolean }
  ): Promise<void> {
    const { sessionId, storage, getSnapshot } = this.options;
    const createArchive = this.options.createArchive ?? createTemporaryArchive;
    const writeArchive = this.options.writeArchive ?? writeEvidenceArchive;
    const activeBtn = mode === "ticket" ? this.ticketButton : this.button;

    // 在用户点击手势和 Document 焦点处于最高特权时刻，立即写入工单剪贴板数据
    let earlyCopied = false;
    if (mode === "ticket" && !exportOptions?.skipClipboard) {
      earlyCopied = (await this.options.onExportStart?.("ticket")) ?? false;
    }

    this.button.disabled = true;
    if (this.ticketButton) this.ticketButton.disabled = true;
    if (activeBtn) activeBtn.textContent = t("exportPreparing");
    this.setProgress(2, false, mode);
    let temporaryArchive:
      Awaited<ReturnType<typeof createTemporaryArchive>> | undefined;
    let blobUrl: string | undefined;
    try {
      if (this.options.beforeExport) {
        await this.options.beforeExport();
      }
      const snapshot = getSnapshot();
      if (!snapshot || !sessionId) throw new Error(t("loading"));
      const reportAssets = await this.loadAssets();
      const filename = `web-bug-report-${snapshot.session.id.slice(0, 8)}.zip`;
      temporaryArchive = await createArchive(filename);
      const totalChunks = this.options.getMediaChunkCount();
      await writeArchive({
        files: buildEvidencePackage(snapshot, reportAssets),
        sessionId,
        mediaSource: storage,
        sink: temporaryArchive.sink,
        createManifest: (integrity) => ({
          name: "manifest.json",
          data: new TextEncoder().encode(
            JSON.stringify(
              buildExportManifest(snapshot.session, integrity),
              null,
              2
            )
          ),
        }),
        onProgress: ({ mediaChunksWritten, bytesWritten }) => {
          if (mediaChunksWritten && totalChunks > 0) {
            const pct = 5 + (mediaChunksWritten / totalChunks) * 90;
            this.setProgress(pct, false, mode);
            if (activeBtn) {
              activeBtn.textContent = t("exportWritingVideo", [
                String(mediaChunksWritten),
                String(totalChunks),
              ]);
            }
          } else {
            this.setProgress(30, false, mode);
            if (activeBtn) {
              activeBtn.textContent = t(
                "exportGenerating",
                String(Math.max(1, Math.round(bytesWritten / 1024)))
              );
            }
          }
        },
      });
      const archiveFile = await temporaryArchive.getFile();
      blobUrl = URL.createObjectURL(archiveFile);
      this.setProgress(97, false, mode);
      const downloadId = await chrome.downloads.download({
        url: blobUrl,
        filename,
        saveAs: true,
      });
      this.artifact = {
        sessionId,
        downloadId,
        state: "in_progress",
        updatedAtEpochMs: Date.now(),
      };
      await storage.saveExportArtifact(this.artifact);
      this.options.onArtifactChanged();
      this.artifact = await this.waitForDownload(downloadId);
      await storage.saveExportArtifact(this.artifact);
      this.options.onArtifactChanged();
      if (this.artifact.state === "complete") {
        this.setProgress(100, true, mode);
        let autoCopied = earlyCopied || Boolean(exportOptions?.skipClipboard);
        if (!autoCopied) {
          autoCopied = (await this.options.onExportComplete?.(mode)) ?? false;
        }
        const successMsg =
          mode === "ticket"
            ? autoCopied
              ? t("exportSuccessTicketCopied")
              : t("exportSuccessCanCopy")
            : autoCopied
              ? t("exportSuccessCopied")
              : t("exportSuccessCanCopy");
        this.options.notify(successMsg);
      } else {
        this.setProgress(0, false, mode);
        if (isUserCanceled(this.artifact.error)) {
          this.options.notify(t("exportCanceled"));
        } else {
          this.options.notify(
            t("exportFailed", this.artifact.error || t("exportInterrupted"))
          );
        }
      }
    } catch (error) {
      this.setProgress(0, false, mode);
      if (isUserCanceled(error)) {
        this.options.notify(t("exportCanceled"));
      } else {
        this.options.notify(t("exportFailed", String(error)));
      }
    } finally {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      await temporaryArchive?.cleanup().catch(() => undefined);
      this.button.disabled = false;
      this.button.textContent = t("exportReport");
      if (this.ticketButton) {
        this.ticketButton.disabled = false;
        this.ticketButton.textContent = t("createTicket");
      }
    }
  }

  private searchDownload(
    downloadId: number
  ): Promise<chrome.downloads.DownloadItem | undefined> {
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
    if (!sessionId) throw new Error("Missing session ID");
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const item = await this.searchDownload(downloadId);
      if (item?.state === "complete")
        return {
          sessionId,
          downloadId,
          state: "complete",
          filename: item.filename,
          updatedAtEpochMs: Date.now(),
        };
      if (item?.state === "interrupted")
        return {
          sessionId,
          downloadId,
          state: "interrupted",
          filename: item.filename,
          error: item.error || "Download interrupted",
          updatedAtEpochMs: Date.now(),
        };
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return {
      sessionId,
      downloadId,
      state: "interrupted",
      error: t("exportInterrupted"),
      updatedAtEpochMs: Date.now(),
    };
  }

  private async reconcileDownloadArtifact(): Promise<void> {
    if (this.artifact?.state !== "in_progress") return;
    const download = await this.searchDownload(this.artifact.downloadId).catch(
      () => undefined
    );
    if (download?.state === "complete") {
      this.artifact = {
        ...this.artifact,
        state: "complete",
        filename: download.filename,
        updatedAtEpochMs: Date.now(),
      };
    } else if (download?.state === "interrupted") {
      this.artifact = {
        ...this.artifact,
        state: "interrupted",
        filename: download.filename,
        error: download.error || "Download interrupted",
        updatedAtEpochMs: Date.now(),
      };
    } else {
      return;
    }
    await this.options.storage.saveExportArtifact(this.artifact);
  }
}
