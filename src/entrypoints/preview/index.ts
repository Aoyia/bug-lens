import { db } from "../../storage/db";
import type { ConsoleEntry, ExportArtifact, InteractionRecord, NetworkEntry, RecordingSession } from "../../shared/protocol";
import { createTemporaryArchive } from "../../export/archive-destination";
import { writeEvidenceArchive } from "../../export/export-pipeline";
import { buildExportManifest, migrateSessionForExport } from "../../export/export-manifest";
import { copyTextToClipboard } from "../../preview/clipboard";
import { buildAiPrompt, buildEvidencePackage, type EvidencePackageSnapshot } from "../../preview/evidence-package";
import { EvidenceReportView } from "../../preview/evidence-report-view";
import { PreviewController } from "../../preview/preview-controller";
import { loadStaticReportAssets } from "../../preview/static-report-assets";

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const sessionId = new URLSearchParams(location.search).get("sessionId");
const previewController = new PreviewController();

let session: RecordingSession | undefined;
let interactions: InteractionRecord[] = [];
let consoleEntries: ConsoleEntry[] = [];
let networkEntries: NetworkEntry[] = [];
let mediaUrl: string | undefined;
let mediaChunkCount = 0;
let mediaMimeType = "video/webm";
let exportArtifact: ExportArtifact | undefined;

const reportView = new EvidenceReportView(document, {
  mode: "editable",
  getSnapshot: () => session ? {
    session,
    interactions: { all: interactions, included: includedInteractions() },
    consoleEntries: { all: consoleEntries, included: includedConsoleEntries() },
    networkEntries: { all: networkEntries, included: includedNetworkEntries() },
    hasMedia: Boolean(mediaUrl)
  } : undefined,
  excludeInteraction: async (interactionId) => {
    previewController.exclude("interaction", interactionId);
    await saveSelection();
  },
  excludeDiagnostic: async (kind, id) => {
    previewController.exclude(kind, id);
    await saveSelection();
  },
  restore: async (kind) => {
    previewController.restore(kind);
    await saveSelection();
  }
});

function includedInteractions(): InteractionRecord[] {
  return previewController.includedInteractions(interactions);
}

function includedConsoleEntries(): ConsoleEntry[] {
  return previewController.includedConsoleEntries(consoleEntries);
}

function includedNetworkEntries(): NetworkEntry[] {
  return previewController.includedNetworkEntries(networkEntries);
}

function currentPackageSnapshot(): EvidencePackageSnapshot | undefined {
  if (!session) return undefined;
  return {
    session,
    interactions: includedInteractions(),
    consoleEntries: includedConsoleEntries(),
    networkEntries: includedNetworkEntries(),
    excluded: {
      interaction: previewController.excludedCount("interaction"),
      console: previewController.excludedCount("console"),
      network: previewController.excludedCount("network")
    },
    hasMedia: mediaChunkCount > 0
  };
}

function currentAiPrompt(zipPath?: string): string {
  const snapshot = currentPackageSnapshot();
  return snapshot ? buildAiPrompt(snapshot, zipPath) : "请先等待证据预览加载完成。";
}

function renderAiHandoff(): void {
  const path = exportArtifact?.filename;
  const complete = exportArtifact?.state === "complete" && Boolean(path);
  $("#ai-status").textContent = complete
    ? "下载完成"
    : exportArtifact?.state === "complete"
      ? "下载完成（路径不可用）"
      : exportArtifact?.state === "in_progress"
        ? "正在下载"
        : exportArtifact?.state === "interrupted"
          ? "下载中断"
          : "等待导出";
  $("#ai-path").textContent = complete
    ? path!
    : exportArtifact?.state === "complete"
      ? "Chrome 未返回绝对路径；可从下载列表定位文件。"
      : exportArtifact?.error || "请先点击“导出离线报告”，完成下载后获取绝对路径。";
  $("#ai-prompt").textContent = currentAiPrompt(path);
  ($("#copy-ai-path") as HTMLButtonElement).hidden = !complete;
  ($("#show-ai-file") as HTMLButtonElement).hidden = !complete;
}

async function copyText(value: string, successMessage: string): Promise<void> {
  try {
    await copyTextToClipboard(value, document);
    reportView.notify(successMessage);
  } catch (error) {
    reportView.notify(`复制失败：${String(error)}`);
  }
}

function searchDownload(downloadId: number): Promise<chrome.downloads.DownloadItem | undefined> {
  return new Promise((resolve, reject) => {
    chrome.downloads.search({ id: downloadId }, (items) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(items[0]);
    });
  });
}

async function waitForDownload(downloadId: number): Promise<ExportArtifact> {
  if (!sessionId) throw new Error("缺少会话 ID");
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const item = await searchDownload(downloadId);
    if (item?.state === "complete") return { sessionId, downloadId, state: "complete", filename: item.filename, updatedAtEpochMs: Date.now() };
    if (item?.state === "interrupted") return { sessionId, downloadId, state: "interrupted", filename: item.filename, error: item.error || "下载中断", updatedAtEpochMs: Date.now() };
    await new Promise((resolve) => window.setTimeout(resolve, 500));
  }
  return { sessionId, downloadId, state: "interrupted", error: "下载状态查询超时，请在 Chrome 下载列表中确认文件是否完成。", updatedAtEpochMs: Date.now() };
}

async function saveSelection(): Promise<void> {
  if (sessionId) await db.saveExportSelection(previewController.toSelection(sessionId));
}

$("#copy-ai-prompt").addEventListener("click", () => void copyText(currentAiPrompt(exportArtifact?.filename), "AI 提示词已复制"));
$("#copy-ai-path").addEventListener("click", () => {
  if (exportArtifact?.filename) void copyText(exportArtifact.filename, "ZIP 绝对路径已复制");
});
$("#show-ai-file").addEventListener("click", () => {
  if (exportArtifact) chrome.downloads.show(exportArtifact.downloadId);
});

$("#export").addEventListener("click", async () => {
  const button = $("#export") as HTMLButtonElement;
  button.disabled = true;
  button.textContent = "正在准备…";
  let temporaryArchive: Awaited<ReturnType<typeof createTemporaryArchive>> | undefined;
  let blobUrl: string | undefined;
  try {
    const snapshot = currentPackageSnapshot();
    if (!snapshot || !sessionId) throw new Error("证据预览尚未加载完成");
    const reportAssets = await loadStaticReportAssets();
    const filename = `web-bug-report-${snapshot.session.id.slice(0, 8)}.zip`;
    temporaryArchive = await createTemporaryArchive(filename);
    await writeEvidenceArchive({
      files: buildEvidencePackage(snapshot, reportAssets),
      sessionId,
      mediaSource: db,
      sink: temporaryArchive.sink,
      createManifest: (integrity) => ({
        name: "data/manifest.json",
        data: new TextEncoder().encode(JSON.stringify(buildExportManifest(snapshot.session, integrity), null, 2))
      }),
      onProgress: ({ mediaChunksWritten, bytesWritten }) => {
        button.textContent = mediaChunksWritten
          ? `正在写入录像 ${mediaChunksWritten}/${mediaChunkCount}`
          : `正在生成 ${Math.max(1, Math.round(bytesWritten / 1024))} KiB`;
      }
    });
    const archiveFile = await temporaryArchive.getFile();
    blobUrl = URL.createObjectURL(archiveFile);
    const downloadId = await chrome.downloads.download({ url: blobUrl, filename, saveAs: true });
    exportArtifact = { sessionId, downloadId, state: "in_progress", updatedAtEpochMs: Date.now() };
    await db.saveExportArtifact(exportArtifact);
    renderAiHandoff();
    exportArtifact = await waitForDownload(downloadId);
    await db.saveExportArtifact(exportArtifact);
    renderAiHandoff();
    reportView.notify(exportArtifact.state === "complete" ? "ZIP 下载完成，可复制 AI 提示词" : `ZIP ${exportArtifact.error || "下载未完成"}`);
  } catch (error) {
    reportView.notify(`导出失败：${String(error)}`);
  } finally {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    await temporaryArchive?.cleanup().catch(() => undefined);
    button.disabled = false;
    button.textContent = "导出离线报告";
  }
});

async function loadMediaPreview(): Promise<void> {
  if (!sessionId || mediaUrl || !mediaChunkCount) return;
  try {
    const chunks = (await db.getMediaChunks(sessionId)).filter((entry) => entry.chunk instanceof ArrayBuffer && entry.chunk.byteLength > 0);
    if (!chunks.length) throw new Error("媒体分片为空或已损坏");
    mediaUrl = URL.createObjectURL(new Blob(chunks.map((entry) => entry.chunk), { type: mediaMimeType }));
    const video = $("#video") as HTMLVideoElement;
    video.src = mediaUrl;
    video.hidden = false;
    $("#video-empty").hidden = true;
    video.addEventListener("error", () => {
      $("#video-empty").hidden = false;
      $("#video-empty").textContent = "录像文件无法解码。若它来自修复前的录制，请重新录制一小段。";
    }, { once: true });
  } catch (error) {
    $("#video-empty").hidden = false;
    $("#video-empty").textContent = `录像加载失败：${String(error)}`;
  }
}

async function reconcileDownloadArtifact(): Promise<void> {
  if (exportArtifact?.state !== "in_progress") return;
  const download = await searchDownload(exportArtifact.downloadId).catch(() => undefined);
  if (download?.state === "complete") {
    exportArtifact = { ...exportArtifact, state: "complete", filename: download.filename, updatedAtEpochMs: Date.now() };
  } else if (download?.state === "interrupted") {
    exportArtifact = { ...exportArtifact, state: "interrupted", filename: download.filename, error: download.error || "下载中断", updatedAtEpochMs: Date.now() };
  } else {
    return;
  }
  await db.saveExportArtifact(exportArtifact);
}

async function finalizePendingNetworkBodies(): Promise<void> {
  if (!session || !["PREVIEW_READY", "EXPORTED"].includes(session.status)) return;
  const staleIds = new Set(networkEntries.filter((entry) => entry.response?.bodyStatus === "pending").map((entry) => entry.id));
  if (!staleIds.size) return;
  networkEntries = networkEntries.map((entry) => staleIds.has(entry.id) ? {
    ...entry,
    response: { ...entry.response, bodyStatus: "unavailable" as const, error: "RESPONSE_BODY_INCOMPLETE: 录制已结束，响应正文读取未完成" }
  } : entry);
  await Promise.all(networkEntries.filter((entry) => staleIds.has(entry.id)).map((entry) => db.saveNetwork(entry)));
}

async function load(): Promise<void> {
  if (!sessionId) {
    $("#meta").textContent = "缺少会话 ID";
    return;
  }
  session = await db.getSession(sessionId);
  if (!session) {
    $("#meta").textContent = "找不到会话";
    return;
  }
  const migrated = migrateSessionForExport(session);
  if (migrated !== session) {
    session = migrated;
    await db.saveSession(session);
  }
  exportArtifact = await db.getExportArtifact(sessionId);
  await reconcileDownloadArtifact();
  interactions = (await db.getInteractions(sessionId)).filter((item) => item.status !== "cancelled").sort((a, b) => a.createdAt - b.createdAt);
  previewController.loadSelection(await db.getExportSelection(sessionId));
  consoleEntries = (await db.getConsole(sessionId)).sort((a, b) => a.createdAt - b.createdAt);
  networkEntries = (await db.getNetwork(sessionId)).sort((a, b) => a.createdAt - b.createdAt);
  await finalizePendingNetworkBodies();

  const mediaSummary = await db.getMediaSummary(sessionId);
  mediaChunkCount = mediaSummary.count;
  mediaMimeType = mediaSummary.mimeType || "video/webm";
  if (mediaChunkCount) {
    $("#video-empty").textContent = `正在加载录像（${mediaChunkCount} 个分片）…`;
    await loadMediaPreview();
  } else {
    $("#video-empty").textContent = "没有可播放的媒体分片；交互和调试证据仍可查看。";
  }

  window.addEventListener("beforeunload", () => {
    if (mediaUrl) URL.revokeObjectURL(mediaUrl);
  }, { once: true });
  renderAiHandoff();
  reportView.render();
}

void load();
