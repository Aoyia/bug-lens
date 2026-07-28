import { db } from "../../storage/db";
import type { InteractionRecord, RecordingSession } from "../../shared/protocol";
import { strToU8, zipSync } from "fflate";

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const sessionId = new URLSearchParams(location.search).get("sessionId");
let session: RecordingSession | undefined;
let interactions: InteractionRecord[] = [];
let consoleEntries: Array<{ createdAt: number; level: string; text: string }> = [];
let networkEntries: Array<{ createdAt: number; method: string; url: string; status?: number }> = [];
let mediaUrl: string | undefined;
let mediaChunks: Array<{ sequence: number; mimeType: string; chunk: ArrayBuffer }> = [];
const excludedInteractionIds = new Set<string>();

function includedInteractions(): InteractionRecord[] { return interactions.filter((item) => !excludedInteractionIds.has(item.id)); }

function esc(value: unknown): string { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!)); }
function renderMetrics(): void {
  if (!session) return;
  const q = session.quality;
  const included = includedInteractions();
  const screenshotCount = included.filter((item) => item.screenshot.status === "captured").length;
  $("#metrics").innerHTML = [[included.length, "有效步骤"], [excludedInteractionIds.size, "已删除"], [screenshotCount, "步骤截图"], [q.consoleEntryCount, "Console"], [q.networkEntryCount, "Network"]].map(([value, label]) => `<div class="metric"><strong>${value}</strong><span>${label}</span></div>`).join("");
  const restoreButton = $("#restore") as HTMLButtonElement;
  restoreButton.hidden = excludedInteractionIds.size === 0;
  restoreButton.textContent = `恢复已删除步骤（${excludedInteractionIds.size}）`;
}
function renderInteractions(): void {
  const list = $("#interactions");
  const included = includedInteractions();
  if (!included.length) { list.innerHTML = `<div class="empty">${interactions.length ? "所有交互步骤均已删除，可从右上角恢复。" : "没有捕获到点击"}</div>`; return; }
  list.innerHTML = included.map((item, index) => `<article class="item" data-index="${interactions.indexOf(item)}"><div class="top"><strong>${index + 1}. ${esc(item.element.text || item.element.tagName)}</strong><div class="item-actions"><span class="badge ${item.screenshot.status === "unavailable" ? "partial" : ""}">${item.screenshot.source ?? item.screenshot.status}</span><button class="delete" data-delete="${esc(item.id)}" title="从预览和导出中删除">删除</button></div></div><div class="text">${esc(item.page.url)} · ${new Date(item.createdAt).toLocaleTimeString()}</div></article>`).join("");
  list.querySelectorAll<HTMLElement>("[data-index]").forEach((node) => node.addEventListener("click", () => {
    const item = interactions[Number(node.dataset.index)];
    renderDetail(item);
    const video = $("#video") as HTMLVideoElement;
    if (mediaUrl && session?.timeline.startedAtEpochMs) video.currentTime = Math.max(0, (item.createdAt - session.timeline.startedAtEpochMs) / 1000);
  }));
  list.querySelectorAll<HTMLButtonElement>("[data-delete]").forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    void excludeInteraction(button.dataset.delete!);
  }));
}

async function saveSelection(): Promise<void> {
  if (!sessionId) return;
  await db.saveExportSelection({ sessionId, excludedInteractionIds: [...excludedInteractionIds], updatedAtEpochMs: Date.now() });
}

async function excludeInteraction(interactionId: string): Promise<void> {
  excludedInteractionIds.add(interactionId);
  await saveSelection();
  $("#detail").innerHTML = '<div class="empty">该步骤已删除，可使用“恢复已删除步骤”撤销。</div>';
  renderMetrics();
  renderInteractions();
}

$("#restore").addEventListener("click", async () => {
  excludedInteractionIds.clear();
  await saveSelection();
  renderMetrics();
  renderInteractions();
});
function renderDetail(item: InteractionRecord): void {
  const locatorText = item.element.locators.map((locator) => `${locator.kind}: ${locator.expression} (唯一匹配 ${locator.matchCount}, 稳定性 ${Math.round(locator.stabilityScore * 100)}%)`).join("\n");
  $("#detail").innerHTML = `<div><strong>${esc(item.element.tagName)}</strong> ${item.element.id ? `#${esc(item.element.id)}` : ""}</div><p class="muted">${esc(item.element.text || "无可见文本")} · ${esc(item.page.url)}</p><div class="code">${esc(locatorText || "无定位器")}</div>${item.screenshot.dataUrl ? `<img class="shot" src="${item.screenshot.dataUrl}" alt="点击截图">` : ""}`;
}
function renderLogs(): void {
  $("#console").innerHTML = consoleEntries.length ? consoleEntries.slice(-200).reverse().map((entry) => `<div class="item"><div class="top"><strong>${esc(entry.level)}</strong><span class="muted">${new Date(entry.createdAt).toLocaleTimeString()}</span></div><div class="text">${esc(entry.text)}</div></div>`).join("") : '<div class="empty">没有 Console 记录</div>';
  $("#network").innerHTML = networkEntries.length ? networkEntries.slice(-200).reverse().map((entry) => `<div class="item"><div class="top"><strong>${esc(entry.method)} ${entry.status ?? ""}</strong><span class="muted">${new Date(entry.createdAt).toLocaleTimeString()}</span></div><div class="text">${esc(entry.url)}</div></div>`).join("") : '<div class="empty">没有 Network 记录</div>';
}
function buildReportHtml(hasMedia: boolean): string {
  const video = hasMedia ? '<section class="card"><h2>标签页录像</h2><video controls src="media/recording.webm"></video></section>' : "";
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Web Bug Recorder 报告</title><link rel="stylesheet" href="assets/report.css"></head><body><main id="app"><h1>Web Bug Recorder 报告</h1>${video}</main><script src="assets/report.js"></script><script src="assets/report-data.js"></script></body></html>`;
}

function buildReportData(): string {
  const payload = { protocolVersion: 1, session, interactions: includedInteractions(), consoleEntries, networkEntries };
  const safe = JSON.stringify(payload).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  return `window.__WEB_BUG_REPORT_DATA__ = Object.freeze(${safe});`;
}

function buildReportScript(): string {
  return [
    'window.addEventListener("DOMContentLoaded", function () {',
    '  "use strict";',
    '  var data = window.__WEB_BUG_REPORT_DATA__;',
    '  var app = document.getElementById("app");',
    '  function el(tag, text, className) { var node = document.createElement(tag); if (text !== undefined) node.textContent = String(text); if (className) node.className = className; return node; }',
    '  if (!data || data.protocolVersion !== 1) { app.appendChild(el("p", "报告数据缺失或版本不兼容。", "error")); return; }',
    '  var meta = el("p", data.session.target.initialUrl + " · " + Math.round((data.session.timeline.durationMs || 0) / 1000) + " 秒", "muted"); app.insertBefore(meta, app.children[1] || null);',
    '  var quality = el("section", undefined, "card"); quality.appendChild(el("h2", "质量摘要")); quality.appendChild(el("pre", JSON.stringify(data.session.quality, null, 2))); app.appendChild(quality);',
    '  var steps = el("section", undefined, "card"); steps.appendChild(el("h2", "交互步骤（" + data.interactions.length + "）"));',
    '  data.interactions.forEach(function (item, index) { var article = el("article", undefined, "step"); article.appendChild(el("h3", (index + 1) + ". " + (item.element.text || item.element.tagName))); article.appendChild(el("p", item.page.url, "muted")); article.appendChild(el("pre", JSON.stringify(item.element, null, 2))); if (item.screenshot && item.screenshot.dataUrl) { var image = el("img"); image.src = item.screenshot.dataUrl; image.alt = "点击截图"; article.appendChild(image); } steps.appendChild(article); }); app.appendChild(steps);',
    '  var logs = el("section", undefined, "card"); logs.appendChild(el("h2", "Console（" + data.consoleEntries.length + "）")); data.consoleEntries.forEach(function (entry) { logs.appendChild(el("pre", "[" + entry.level + "] " + entry.text)); }); app.appendChild(logs);',
    '  var network = el("section", undefined, "card"); network.appendChild(el("h2", "Network（" + data.networkEntries.length + "）")); data.networkEntries.forEach(function (entry) { network.appendChild(el("pre", entry.method + " " + (entry.status || "") + " " + entry.url)); }); app.appendChild(network);',
    '});'
  ].join("\n");
}

function buildReportCss(): string {
  return 'body{font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:1000px;margin:30px auto;padding:0 20px;color:#182230;background:#f7f8fa}.card,.step{background:#fff;border:1px solid #e4e7ec;border-radius:12px;padding:16px;margin:14px 0}.step{background:#fbfcfe}.muted{color:#667085;word-break:break-all}.error{color:#b42318}pre{white-space:pre-wrap;word-break:break-word;background:#f2f4f7;padding:12px;border-radius:8px;max-height:420px;overflow:auto}img,video{display:block;width:100%;max-height:560px;object-fit:contain;background:#101828;border-radius:8px}';
}
$("#export").addEventListener("click", async () => {
  const button = $("#export") as HTMLButtonElement;
  button.disabled = true;
  button.textContent = "正在生成…";
  const files: Record<string, Uint8Array> = {
    "report.html": strToU8(buildReportHtml(mediaChunks.length > 0)),
    "assets/report.js": strToU8(buildReportScript()),
    "assets/report.css": strToU8(buildReportCss()),
    "assets/report-data.js": strToU8(buildReportData()),
    "data/session.json": strToU8(JSON.stringify({ session, interactions: includedInteractions(), consoleEntries, networkEntries }, null, 2))
  };
  if (mediaChunks.length) {
    const total = mediaChunks.reduce((sum, entry) => sum + entry.chunk.byteLength, 0);
    const media = new Uint8Array(total);
    let offset = 0;
    for (const entry of mediaChunks) { media.set(new Uint8Array(entry.chunk), offset); offset += entry.chunk.byteLength; }
    files["media/recording.webm"] = media;
  }
  const archive = zipSync(files, { level: 0 });
  const blobUrl = URL.createObjectURL(new Blob([archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength)], { type: "application/zip" }));
  await chrome.downloads.download({ url: blobUrl, filename: `web-bug-report-${session?.id.slice(0, 8) ?? "session"}.zip`, saveAs: true });
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  button.disabled = false;
  button.textContent = "导出离线报告";
});

async function load(): Promise<void> {
  if (!sessionId) { $("#meta").textContent = "缺少会话 ID"; return; }
  session = await db.getSession(sessionId);
  if (!session) { $("#meta").textContent = "找不到会话"; return; }
  interactions = (await db.getInteractions(sessionId)).filter((item) => item.status !== "cancelled").sort((a, b) => a.createdAt - b.createdAt);
  const selection = await db.getExportSelection(sessionId);
  for (const id of selection?.excludedInteractionIds ?? []) excludedInteractionIds.add(id);
  consoleEntries = (await db.getConsole(sessionId)).sort((a, b) => a.createdAt - b.createdAt);
  networkEntries = (await db.getNetwork(sessionId)).sort((a, b) => a.createdAt - b.createdAt);
  const storedMediaChunks = (await db.getMediaChunks(sessionId)).sort((a, b) => a.sequence - b.sequence);
  mediaChunks = storedMediaChunks.filter((entry) => entry.chunk instanceof ArrayBuffer && entry.chunk.byteLength > 0);
  if (mediaChunks.length) {
    const mimeType = mediaChunks[0].mimeType || "video/webm";
    mediaUrl = URL.createObjectURL(new Blob(mediaChunks.map((entry) => entry.chunk), { type: mimeType }));
    const video = $("#video") as HTMLVideoElement;
    video.src = mediaUrl;
    video.hidden = false;
    $("#video-empty").hidden = true;
    video.addEventListener("error", () => {
      $("#video-empty").hidden = false;
      $("#video-empty").textContent = "录像文件无法解码。若它来自修复前的录制，请重新录制一小段。";
    }, { once: true });
    window.addEventListener("beforeunload", () => { if (mediaUrl) URL.revokeObjectURL(mediaUrl); }, { once: true });
  } else {
    $("#video-empty").textContent = storedMediaChunks.length ? "该会话的媒体分片已损坏（旧版消息序列化问题），请更新扩展后重新录制。" : "没有可播放的媒体分片；交互和调试证据仍可查看。";
  }
  $("#title").textContent = session.target.initialTitle || "录制预览";
  $("#meta").textContent = `${session.target.initialUrl} · ${session.timeline.durationMs ? Math.round(session.timeline.durationMs / 1000) + " 秒" : "时长未知"}`;
  renderMetrics(); renderInteractions(); renderLogs();
}
void load();
