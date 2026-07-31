import { message, type EvidenceSummary, type RecordingOptions, type RecordingSession, type SessionOverview, type StorageOverview } from "../../shared/protocol";
import { applyI18n, t } from "../../shared/i18n";

applyI18n();

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
    { kind: "issueScenes", state: session.quality.issues.some((entry) => entry.source === "issue-scene") ? "partial" : "captured", count: session.quality.issueSceneCount ?? 0, sizeBytes: 0, detail: "" },
    { kind: "console", state: state(session.options.captureConsole, "debugger"), count: session.quality.consoleEntryCount, sizeBytes: 0, detail: "" },
    { kind: "network", state: state(session.options.captureNetwork, "debugger"), count: session.quality.networkEntryCount, sizeBytes: 0, detail: "" },
    { kind: "networkBodies", state: !session.options.captureNetworkBodies ? "disabled" : "pending", count: 0, sizeBytes: 0, detail: "" }
  ];
}

function evidenceLabel(evidence: EvidenceSummary): string {
  const map: Record<string, string> = {
    video: t("video"),
    audio: t("audio"),
    screenshots: t("clickScreenshots"),
    issueScenes: t("issueScenes"),
    console: t("console"),
    network: t("network"),
    networkBodies: t("responseBodies")
  };
  return map[evidence.kind] ?? evidence.kind;
}

function evidenceStateLabel(state: string): string {
  const map: Record<string, string> = {
    captured: t("statusCaptured"),
    partial: t("statusPartial"),
    failed: t("statusFailed"),
    redacted: t("statusRedacted"),
    pending: t("statusPending"),
    disabled: t("statusDisabled")
  };
  return map[state] ?? state;
}

function renderEvidence(items: EvidenceSummary[]): string {
  return items.map((item) => `<span class="chip ${item.state}" title="${escapeHtml(item.detail)}">${evidenceLabel(item)} · ${evidenceStateLabel(item.state)}</span>`).join("");
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
  $("#status").textContent = active
    ? (session?.status === "PREPARING" ? t("recordingStarting") : session?.status === "DEGRADED" ? t("recordingDegraded") : t("recording"))
    : previewReady ? t("recordingCompleted") : t("notRecording");
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
  $("#title").textContent = activeTab?.title || t("failedToReadTab");
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
  return `<article class="session">
    <div class="session-head">
      <div class="session-title" title="${escapeHtml(session.target.initialTitle)}">${escapeHtml(session.target.initialTitle || t("unnamedTab"))}</div>
      <div class="session-head-actions">
        ${isContinuable(session) ? `<button class="btn-continue-sm" data-continue="${session.id}">${t("resume")}</button>` : ""}
        <button class="btn-open-preview" data-open="${session.id}">${t("preview")}</button>
        <button class="btn-delete-icon" data-delete="${session.id}" title="${t("deleteSession")}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </div>
    </div>
    <div class="session-meta"><span class="session-status-tag">${escapeHtml(session.status)}</span> · ${escapeHtml(date)} · ${formatBytes(item.sizeBytes)} · ${escapeHtml(session.target.initialUrl)}</div>
    <div class="evidence">${renderEvidence(item.evidence)}</div>
  </article>`;
}

function escapeHtml(value: unknown): string { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!)); }

function renderStorage(storage: StorageOverview): void {
  $("#storage-used").textContent = t("storageUsed", formatBytes(storage.usedBytes));
  $("#storage-policy").textContent = t("storagePolicy", [String(storage.policy.retentionDays), formatBytes(storage.policy.maxSessionBytes)]);
  $("#storage-count").textContent = t("sessionsCount", String(storage.sessionCount));
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
      <div class="empty-title">${t("noMatchingHistory")}</div>
      <div class="empty-sub">${t("emptyHistorySub")}</div>
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
  if (!options.captureVideo && options.captureAudio) { setError(t("audioNeedsVideo")); return; }
  if (!options.captureNetwork) options.captureNetworkBodies = false;
  if (options.privacyMode === "raw" && !window.confirm(t("rawModeWarning"))) return;
  setError();
  try {
    const hasPermission = await chrome.permissions.contains({ origins: ["http://*/*", "https://*/*"] }).catch(() => false);
    if (!hasPermission) {
      await chrome.storage.local.set({ pendingRecordingRequest: { tabId: activeTab.id, options } });
      await chrome.tabs.create({ url: chrome.runtime.getURL("permission.html") });
      window.close();
      return;
    }
    const response = await chrome.runtime.sendMessage(message("session/start", { tabId: activeTab.id, options, commandId: crypto.randomUUID() }));
    if (!response?.ok) throw new Error(response?.error || t("startFailed"));
    setState(response.session);
  } catch (error) { setError(error); await refreshRecord(); }
});

$("#stop").addEventListener("click", async () => {
  setError();
  try {
    const response = await chrome.runtime.sendMessage(message("session/stop", { commandId: crypto.randomUUID() }));
    if (!response?.ok) throw new Error(response?.error || t("stopFailed"));
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
$("#cleanup").addEventListener("click", async () => {
  if (!window.confirm(t("clearHistoryPrompt"))) return;
  const response = await chrome.runtime.sendMessage(message("storage/clear-all", {}));
  if (!response?.ok) setError(response?.error || t("clearHistoryFailed")); else await refreshHistory();
});
$("#search").addEventListener("input", () => void refreshHistory().catch(setError));
$("#sessions").addEventListener("click", async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
  if (!button) return;
  if (button.dataset.open) { await chrome.runtime.sendMessage(message("session/open-preview", { sessionId: button.dataset.open })); return; }
  if (button.dataset.delete) { if (window.confirm(t("deleteSessionConfirm"))) { const response = await chrome.runtime.sendMessage(message("session/delete", { sessionId: button.dataset.delete })); if (!response?.ok) setError(response?.error || t("deleteFailed")); else await refreshHistory(); } return; }
  if (button.dataset.continue) { const response = await chrome.runtime.sendMessage(message("session/resume", { sessionId: button.dataset.continue, commandId: crypto.randomUUID() })); if (!response?.ok) setError(response?.error || t("resumeFailed")); else { showView("record"); setState(response.session); } }
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
