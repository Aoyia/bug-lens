import { message, type EvidenceSummary, type RecordingOptions, type RecordingSession, type SessionOverview, type StorageOverview } from "../../shared/protocol";

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const scopeIds = ["video", "audio", "screenshots", "console", "network", "bodies"] as const;
type ScopeId = typeof scopeIds[number];
let activeSession: RecordingSession | undefined;
let activeTab: chrome.tabs.Tab | undefined;
let timer: number | undefined;
let currentView: "record" | "history" = "record";

function setError(error?: unknown): void {
  const node = $("#error");
  node.hidden = !error;
  node.textContent = error ? String(error) : "";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MiB`;
}

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function isActive(session?: RecordingSession): boolean {
  return Boolean(session && ["PREPARING", "RECORDING", "DEGRADED", "STOPPING"].includes(session.status));
}

function activeEvidence(session?: RecordingSession): EvidenceSummary[] {
  if (!session) return [];
  const issue = (source: string) => session.quality.issues.some((entry) => entry.source === source);
  const state = (enabled: boolean, source: string) => !enabled ? "disabled" : issue(source) ? "partial" : "captured";
  return [
    { kind: "video", state: state(session.options.captureVideo, "media"), count: 0, sizeBytes: 0, detail: "" },
    { kind: "screenshots", state: state(session.options.captureScreenshots, "screenshot"), count: session.quality.primaryScreenshotCount, sizeBytes: 0, detail: "" },
    { kind: "console", state: state(session.options.captureConsole, "debugger"), count: session.quality.consoleEntryCount, sizeBytes: 0, detail: "" },
    { kind: "network", state: state(session.options.captureNetwork, "debugger"), count: session.quality.networkEntryCount, sizeBytes: 0, detail: "" },
    { kind: "networkBodies", state: !session.options.captureNetworkBodies ? "disabled" : "pending", count: 0, sizeBytes: 0, detail: "" }
  ];
}

function evidenceLabel(evidence: EvidenceSummary): string {
  return ({ video: "录像", audio: "音频", screenshots: "截图", console: "Console", network: "Network", networkBodies: "正文" })[evidence.kind];
}

function renderEvidence(items: EvidenceSummary[]): string {
  return items.map((item) => `<span class="chip ${item.state}" title="${escapeHtml(item.detail)}">${evidenceLabel(item)} · ${item.state === "captured" ? "成功" : item.state === "partial" ? "部分" : item.state === "failed" ? "失败" : item.state === "redacted" ? "已脱敏" : item.state === "pending" ? "处理中" : "未采集"}</span>`).join("");
}

function readOptions(): RecordingOptions {
  return {
    captureVideo: ($("#video") as HTMLInputElement).checked,
    captureAudio: ($("#audio") as HTMLInputElement).checked,
    captureScreenshots: ($("#screenshots") as HTMLInputElement).checked,
    captureConsole: ($("#console") as HTMLInputElement).checked,
    captureNetwork: ($("#network") as HTMLInputElement).checked,
    captureNetworkBodies: ($("#bodies") as HTMLInputElement).checked,
    privacyMode: ($("#privacy") as HTMLSelectElement).value as "safe" | "raw",
    mediaTimesliceMs: 1_000,
    maxSessionBytes: 512 * 1024 * 1024,
    maxResponseBodyBytes: 2 * 1024 * 1024
  };
}

function setControlsLocked(locked: boolean): void {
  for (const id of scopeIds) ($(`#${id}`) as HTMLInputElement).disabled = locked;
  ($("#privacy") as HTMLSelectElement).disabled = locked;
}

function setState(session?: RecordingSession): void {
  activeSession = session;
  const active = isActive(session);
  const previewReady = Boolean(session && ["PREVIEW_READY", "EXPORTED"].includes(session.status));
  $("#status").textContent = active ? (session?.status === "PREPARING" ? "正在启动录制…" : session?.status === "DEGRADED" ? "录制中（部分证据不可用）" : "录制中") : previewReady ? "录制完成" : "未录制";
  $("#dot").classList.toggle("rec", active);
  ($("#start") as HTMLButtonElement).hidden = active || previewReady;
  ($("#stop") as HTMLButtonElement).hidden = !active;
  ($("#stop") as HTMLButtonElement).disabled = session?.status === "STOPPING";
  ($("#preview") as HTMLButtonElement).hidden = !previewReady;
  setControlsLocked(active || previewReady);
  $("#evidence").innerHTML = renderEvidence(activeEvidence(session));
  if (timer) window.clearInterval(timer);
  timer = undefined;
  if (active && session?.timeline.startedAtEpochMs) {
    const update = () => { $("#timer").textContent = formatDuration(Date.now() - session!.timeline.startedAtEpochMs!); };
    update();
    timer = window.setInterval(update, 1_000);
  } else $("#timer").textContent = "";
}

async function refreshRecord(): Promise<void> {
  activeTab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  $("#title").textContent = activeTab?.title || "无法读取标签页";
  $("#url").textContent = activeTab?.url || "";
  const response = await chrome.runtime.sendMessage(message("session/status", {}));
  setState(response?.session);
}

function isContinuable(session: RecordingSession): boolean {
  return session.quality.issues.some((entry) => entry.code.startsWith("SESSION_") || entry.code === "MEDIA_CONTEXT_LOST");
}

function sessionHtml(item: SessionOverview): string {
  const { session } = item;
  const date = new Date(session.timeline.createdAtEpochMs).toLocaleString();
  return `<article class="session"><div class="session-head"><div class="session-title" title="${escapeHtml(session.target.initialTitle)}">${escapeHtml(session.target.initialTitle || "未命名标签页")}</div><span class="session-time">${escapeHtml(session.status)}</span></div><div class="session-meta">${escapeHtml(date)} · ${formatBytes(item.sizeBytes)} · ${escapeHtml(session.target.initialUrl)}</div><div class="evidence">${renderEvidence(item.evidence)}</div><div class="session-actions"><button data-open="${session.id}">重新打开预览</button>${isContinuable(session) ? `<button data-continue="${session.id}">恢复中断会话</button>` : ""}<button class="delete" data-delete="${session.id}">删除</button></div></article>`;
}

function escapeHtml(value: unknown): string { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!)); }

function renderStorage(storage: StorageOverview): void {
  $("#storage-used").textContent = `${formatBytes(storage.usedBytes)} 已使用`;
  $("#storage-policy").textContent = `自动清理 ${storage.policy.retentionDays} 天前会话 · 单会话 ${formatBytes(storage.policy.maxSessionBytes)}`;
  $("#storage-count").textContent = `${storage.sessionCount} 个会话`;
}

async function refreshHistory(): Promise<void> {
  const query = ($("#search") as HTMLInputElement).value;
  const [sessionsResponse, storageResponse] = await Promise.all([
    chrome.runtime.sendMessage(message("session/list", { query })),
    chrome.runtime.sendMessage(message("storage/get", {}))
  ]);
  const sessions = (sessionsResponse?.sessions ?? []) as SessionOverview[];
  const emptyHtml = `
    <div class="empty-state">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
      <div class="empty-title">暂无匹配的诊断记录</div>
      <div class="empty-sub">已完成录制的报告将存放在这里</div>
    </div>
  `;
  $("#sessions").innerHTML = sessions.length ? sessions.map(sessionHtml).join("") : emptyHtml;
  if (storageResponse?.storage) renderStorage(storageResponse.storage as StorageOverview);
}

function showView(next: "record" | "history"): void {
  currentView = next;
  $("#record-view").hidden = next !== "record";
  $("#history-view").hidden = next !== "history";
  const mainHeader = $("#main-header");
  const historyHeader = $("#history-header");
  if (mainHeader && historyHeader) {
    mainHeader.hidden = next === "history";
    historyHeader.hidden = next !== "history";
  }
  document.querySelectorAll<HTMLButtonElement>(".tab").forEach((button) => button.classList.toggle("active", button.dataset.view === next));
  if (next === "history") void refreshHistory().catch(setError);
}

$("#start").addEventListener("click", async () => {
  if (!activeTab?.id) return;
  const options = readOptions();
  if (!options.captureVideo && options.captureAudio) { setError("音频依附于录像；请先开启录像。"); return; }
  if (!options.captureNetwork) options.captureNetworkBodies = false;
  if (options.privacyMode === "raw" && !window.confirm("原始模式会保留未脱敏的页面和调试数据。仅在获准且会人工检查的场景使用。")) return;
  setError();
  try {
    const hasPermission = await chrome.permissions.contains({ origins: ["http://*/*", "https://*/*"] }).catch(() => false);
    if (!hasPermission && !(await chrome.permissions.request({ origins: ["http://*/*", "https://*/*"] }).catch(() => false))) setError("未授予全站访问权限：页面交互采集可能受限。");
    const response = await chrome.runtime.sendMessage(message("session/start", { tabId: activeTab.id, options, commandId: crypto.randomUUID() }));
    if (!response?.ok) throw new Error(response?.error || "开始录制失败");
    setState(response.session);
  } catch (error) { setError(error); await refreshRecord(); }
});

$("#stop").addEventListener("click", async () => {
  setError();
  try {
    const response = await chrome.runtime.sendMessage(message("session/stop", { commandId: crypto.randomUUID() }));
    if (!response?.ok) throw new Error(response?.error || "结束录制失败");
    setState(response.session);
  } catch (error) { setError(error); }
});

$("#preview").addEventListener("click", () => { if (activeSession) void chrome.runtime.sendMessage(message("session/open-preview", { sessionId: activeSession.id })); });
document.querySelectorAll<HTMLButtonElement>(".tab").forEach((button) => button.addEventListener("click", () => {
  const targetView = button.dataset.view === "history" ? (currentView === "history" ? "record" : "history") : "record";
  showView(targetView);
}));
$("#video").addEventListener("change", () => { const video = ($("#video") as HTMLInputElement).checked; ($("#audio") as HTMLInputElement).disabled = !video; if (!video) ($("#audio") as HTMLInputElement).checked = false; });
$("#network").addEventListener("change", () => { const network = ($("#network") as HTMLInputElement).checked; ($("#bodies") as HTMLInputElement).disabled = !network; if (!network) ($("#bodies") as HTMLInputElement).checked = false; });
$("#refresh-history").addEventListener("click", () => void refreshHistory().catch(setError));
$("#cleanup").addEventListener("click", async () => { const response = await chrome.runtime.sendMessage(message("storage/cleanup", {})); if (!response?.ok) setError(response?.error || "清理失败"); else await refreshHistory(); });
$("#search").addEventListener("input", () => void refreshHistory().catch(setError));
$("#sessions").addEventListener("click", async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
  if (!button) return;
  if (button.dataset.open) { await chrome.runtime.sendMessage(message("session/open-preview", { sessionId: button.dataset.open })); return; }
  if (button.dataset.delete) { if (window.confirm("删除会话及其全部本地证据？此操作不可恢复。")) { const response = await chrome.runtime.sendMessage(message("session/delete", { sessionId: button.dataset.delete })); if (!response?.ok) setError(response?.error || "删除失败"); else await refreshHistory(); } return; }
  if (button.dataset.continue) { const response = await chrome.runtime.sendMessage(message("session/resume", { sessionId: button.dataset.continue, commandId: crypto.randomUUID() })); if (!response?.ok) setError(response?.error || "继续录制失败"); else { showView("record"); setState(response.session); } }
});

$("#toggle-options")?.addEventListener("click", () => {
  const panel = $("#advanced-options");
  const btn = $("#toggle-options");
  if (!panel || !btn) return;
  const isHidden = panel.hidden;
  panel.hidden = !isHidden;
  btn.classList.toggle("open", isHidden);
});

void refreshRecord().catch(setError);
