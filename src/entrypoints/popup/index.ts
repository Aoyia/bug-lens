import { message, type RecordingOptions, type RecordingSession } from "../../shared/protocol";

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const titleNode = $("#title");
const urlNode = $("#url");
const statusNode = $("#status");
const dotNode = $("#dot");
const timerNode = $("#timer");
const errorNode = $("#error");
const startButton = $("#start") as HTMLButtonElement;
const stopButton = $("#stop") as HTMLButtonElement;
const previewButton = $("#preview") as HTMLButtonElement;
let tab: chrome.tabs.Tab | undefined;
let session: RecordingSession | undefined;
let timer: number | undefined;

function showError(error: unknown): void { errorNode.textContent = String(error); }
function setState(next?: RecordingSession): void {
  session = next;
  const active = Boolean(next && ["PREPARING", "RECORDING", "DEGRADED", "STOPPING"].includes(next.status));
  const ready = Boolean(next && ["PREVIEW_READY", "EXPORTED"].includes(next.status));
  statusNode.textContent = active ? (next!.status === "DEGRADED" ? "录制中（降级）" : "录制中") : ready ? "录制已完成" : "未录制";
  dotNode.classList.toggle("rec", active);
  startButton.hidden = active || ready;
  stopButton.hidden = !active;
  previewButton.hidden = !ready;
  if (ready && next) previewButton.onclick = () => void chrome.runtime.sendMessage(message("session/open-preview", { sessionId: next.id }));
  if (active && next?.timeline.startedAtEpochMs) {
    timer = window.setInterval(() => { timerNode.textContent = formatDuration(Date.now() - (next.timeline.startedAtEpochMs ?? Date.now())); }, 1000);
  } else if (timer) { window.clearInterval(timer); timer = undefined; timerNode.textContent = ""; }
}
function formatDuration(ms: number): string { const seconds = Math.floor(ms / 1000); return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`; }

async function refresh(): Promise<void> {
  tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  titleNode.textContent = tab?.title || "无法读取标签页";
  urlNode.textContent = tab?.url || "";
  const response = await chrome.runtime.sendMessage(message("session/status", {}));
  if (response?.session) setState(response.session);
}

startButton.addEventListener("click", async () => {
  if (!tab?.id) return;
  startButton.disabled = true; errorNode.textContent = "";
  try {
    const fullAccess = await chrome.permissions.request({ origins: ["http://*/*", "https://*/*"] }).catch(() => false);
    if (!fullAccess) showError("未授予全站访问权限：将以有限模式录制当前页面，跨来源导航后的点击可能缺失。");
    const options: RecordingOptions = { captureAudio: ($("#audio") as HTMLInputElement).checked, privacyMode: ($("#privacy") as HTMLSelectElement).value as "safe" | "raw", mediaTimesliceMs: 1000 };
    const response = await chrome.runtime.sendMessage(message("session/start", { tabId: tab.id, options, commandId: crypto.randomUUID() }));
    if (!response?.ok) throw new Error(response?.error || "开始录制失败");
    setState(response.session);
  } catch (error) { showError(error); } finally { startButton.disabled = false; }
});

stopButton.addEventListener("click", async () => {
  stopButton.disabled = true; errorNode.textContent = "";
  try {
    const response = await chrome.runtime.sendMessage(message("session/stop", { commandId: crypto.randomUUID() }));
    if (!response?.ok) throw new Error(response?.error || "结束录制失败");
    setState(response.session);
  } catch (error) { showError(error); } finally { stopButton.disabled = false; }
});

void refresh();
