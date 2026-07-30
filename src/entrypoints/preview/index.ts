import { db } from "../../storage/db";
import { buildAiPrompt } from "../../preview/evidence-package";
import { EvidenceReportView } from "../../preview/evidence-report-view";
import { PreviewAiHandoff } from "../../preview/preview-ai-handoff";
import { PreviewExportController } from "../../preview/preview-export-controller";
import { PreviewSessionRuntime } from "../../preview/preview-session-runtime";
import { applyI18n } from "../../shared/i18n";

applyI18n();

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const sessionId = new URLSearchParams(location.search).get("sessionId") || undefined;
const runtime = new PreviewSessionRuntime(db);

const reportView = new EvidenceReportView(document, {
  mode: "editable",
  getSnapshot: () => runtime.getReportSnapshot(),
  excludeInteraction: (id) => runtime.excludeInteraction(id),
  excludeDiagnostic: (kind, id) => runtime.excludeDiagnostic(kind, id),
  restore: (kind) => runtime.restore(kind)
});

let exportController!: PreviewExportController;
const aiHandoff = new PreviewAiHandoff({
  root: document,
  getArtifact: () => exportController?.currentArtifact,
  getPrompt: (zipPath) => {
    const snapshot = runtime.getPackageSnapshot();
    return snapshot ? buildAiPrompt(snapshot, zipPath) : "请先等待证据预览加载完成。";
  },
  notify: (message) => reportView.notify(message)
});

exportController = new PreviewExportController({
  root: document,
  sessionId,
  storage: db,
  getSnapshot: () => runtime.getPackageSnapshot(),
  getMediaChunkCount: () => runtime.mediaChunks,
  notify: (message) => reportView.notify(message),
  onArtifactChanged: () => aiHandoff.render()
});

async function loadMediaPreview(): Promise<void> {
  const result = await runtime.loadMediaPreview();
  const video = $("#video") as HTMLVideoElement;
  const empty = $("#video-empty");
  if (result.source) {
    video.src = result.source;
    video.hidden = false;
    empty.hidden = true;
    video.addEventListener("error", () => {
      video.hidden = true;
      empty.hidden = false;
      empty.textContent = "录像文件无法解码。若它来自修复前的录制，请重新录制一小段。";
    }, { once: true });
    return;
  }
  empty.hidden = false;
  empty.textContent = result.error
    ? `录像加载失败：${result.error}`
    : runtime.mediaChunks
      ? "录像文件无法读取；交互和调试证据仍可查看。"
      : "没有可播放的媒体分片；交互和调试证据仍可查看。";
}

async function load(): Promise<void> {
  if (!sessionId) {
    $("#meta").textContent = "缺少会话 ID";
    return;
  }
  await runtime.load(sessionId);
  if (!runtime.currentSession) {
    $("#meta").textContent = "找不到会话";
    return;
  }
  await exportController.load();
  if (runtime.mediaChunks) {
    $("#video-empty").textContent = `正在加载录像（${runtime.mediaChunks} 个分片）…`;
    await loadMediaPreview();
  } else {
    await loadMediaPreview();
  }
  window.addEventListener("beforeunload", () => runtime.dispose(), { once: true });
  aiHandoff.render();
  reportView.render();
}

void load().catch((error) => {
  $("#meta").textContent = `预览加载失败：${String(error)}`;
  reportView.notify(`预览加载失败：${String(error)}`);
});
