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

function showError(error: unknown): void {
  errorNode.style.display = "block";
  errorNode.textContent = String(error);
}
function hideError(): void {
  errorNode.style.display = "none";
  errorNode.textContent = "";
}

function setState(next?: RecordingSession): void {
  session = next;
  const active = Boolean(next && ["PREPARING", "RECORDING", "DEGRADED", "STOPPING"].includes(next.status));
  const ready = Boolean(next && ["PREVIEW_READY", "EXPORTED"].includes(next.status));

  statusNode.textContent = active
    ? (next!.status === "PREPARING" ? "正在启动录制…" : next!.status === "DEGRADED" ? "录制中（降级）" : "录制中")
    : ready ? "录制已完成" : "未录制";

  dotNode.classList.toggle("rec", active);
  startButton.hidden = active || ready;
  stopButton.hidden = !active;
  stopButton.disabled = next?.status === "STOPPING";
  previewButton.hidden = !ready;

  if (ready && next) {
    previewButton.onclick = () => void chrome.runtime.sendMessage(message("session/open-preview", { sessionId: next.id }));
  }

  if (active && next?.timeline.startedAtEpochMs) {
    if (timer) window.clearInterval(timer);
    timerNode.textContent = formatDuration(Date.now() - next.timeline.startedAtEpochMs);
    timer = window.setInterval(() => {
      timerNode.textContent = formatDuration(Date.now() - (next.timeline.startedAtEpochMs ?? Date.now()));
    }, 1000);
  } else if (timer) {
    window.clearInterval(timer);
    timer = undefined;
    timerNode.textContent = "";
  }
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

async function refresh(): Promise<void> {
  tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  titleNode.textContent = tab?.title || "无法读取标签页";
  urlNode.textContent = tab?.url || "";
  const response = await chrome.runtime.sendMessage(message("session/status", {}));
  if (response?.session) {
    setState(response.session);
  } else {
    setState(undefined);
  }
}

startButton.addEventListener("click", async () => {
  if (!tab?.id) return;
  hideError();
  // 立即切换 UI 避免重复点击与按钮残留
  startButton.disabled = true;
  startButton.hidden = true;
  stopButton.hidden = false;
  stopButton.disabled = true;
  statusNode.textContent = "正在启动录制…";
  dotNode.classList.add("rec");

  try {
    const hasPermission = await chrome.permissions.contains({ origins: ["http://*/*", "https://*/*"] }).catch(() => false);
    if (!hasPermission) {
      const fullAccess = await chrome.permissions.request({ origins: ["http://*/*", "https://*/*"] }).catch(() => false);
      if (!fullAccess) showError("未授予全站访问权限：将以有限模式录制当前页面。");
    }
    const options: RecordingOptions = {
      captureAudio: ($("#audio") as HTMLInputElement).checked,
      privacyMode: ($("#privacy") as HTMLSelectElement).value as "safe" | "raw",
      mediaTimesliceMs: 1000
    };
    const response = await chrome.runtime.sendMessage(message("session/start", { tabId: tab.id, options, commandId: crypto.randomUUID() }));
    if (!response?.ok) throw new Error(response?.error || "开始录制失败");
    stopButton.disabled = false;
    setState(response.session);
  } catch (error) {
    showError(error);
    startButton.disabled = false;
    startButton.hidden = false;
    stopButton.hidden = true;
    dotNode.classList.remove("rec");
    statusNode.textContent = "未录制";
  }
});

stopButton.addEventListener("click", async () => {
  stopButton.disabled = true;
  statusNode.textContent = "正在结束录制…";
  hideError();
  try {
    const response = await chrome.runtime.sendMessage(message("session/stop", { commandId: crypto.randomUUID() }));
    if (!response?.ok) throw new Error(response?.error || "结束录制失败");
    setState(response.session);
  } catch (error) {
    showError(error);
    stopButton.disabled = false;
  }
});

void refresh();

