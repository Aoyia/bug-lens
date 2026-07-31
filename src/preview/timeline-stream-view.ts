import type { ConsoleEntry, InteractionRecord, NetworkEntry, RecordingSession } from "../shared/protocol";
import { formatElapsedEpochTime } from "../domain/evidence-clock";
import { calculateClipRange } from "../domain/clip-calculator";
import { escapeHtml } from "./rendering";

export type TimelineEventNode =
  | { id: string; timestamp: number; kind: "interaction"; data: InteractionRecord }
  | { id: string; timestamp: number; kind: "console"; data: ConsoleEntry }
  | { id: string; timestamp: number; kind: "network"; data: NetworkEntry };

export type TimelineStreamSnapshot = {
  session?: RecordingSession;
  interactions: InteractionRecord[];
  consoleEntries: ConsoleEntry[];
  networkEntries: NetworkEntry[];
};

export class TimelineStreamView {
  private filterInteractions = true;
  private filterConsole = true;
  private filterNetwork = true;
  private filterErrorOnly = false;
  private selectedId: string | null = null;
  private readonly container: HTMLElement | null;
  private readonly video: HTMLVideoElement | null;
  private lastSnapshot?: TimelineStreamSnapshot;

  constructor(private readonly root: Document) {
    this.container = root.querySelector<HTMLElement>("#timeline-stream-container");
    this.video = root.querySelector<HTMLVideoElement>("#video");

    root.querySelector<HTMLInputElement>("#stream-filter-interactions")?.addEventListener("change", (e) => {
      this.filterInteractions = (e.target as HTMLInputElement).checked;
      this.renderCurrent();
    });
    root.querySelector<HTMLInputElement>("#stream-filter-console")?.addEventListener("change", (e) => {
      this.filterConsole = (e.target as HTMLInputElement).checked;
      this.renderCurrent();
    });
    root.querySelector<HTMLInputElement>("#stream-filter-network")?.addEventListener("change", (e) => {
      this.filterNetwork = (e.target as HTMLInputElement).checked;
      this.renderCurrent();
    });
    root.querySelector<HTMLInputElement>("#stream-filter-error-only")?.addEventListener("change", (e) => {
      this.filterErrorOnly = (e.target as HTMLInputElement).checked;
      this.renderCurrent();
    });
  }

  render(snapshot: TimelineStreamSnapshot): void {
    this.lastSnapshot = snapshot;
    this.renderCurrent();
  }

  private renderCurrent(): void {
    if (!this.lastSnapshot || !this.container) return;
    const snapshot = this.lastSnapshot;
    const nodes: TimelineEventNode[] = [];

    if (this.filterInteractions) {
      for (const item of snapshot.interactions) {
        nodes.push({ id: `step-${item.id}`, timestamp: item.createdAt, kind: "interaction", data: item });
      }
    }
    if (this.filterConsole) {
      for (const item of snapshot.consoleEntries) {
        const level = (item.level || "log").toLowerCase();
        if (this.filterErrorOnly && level !== "error" && level !== "warn" && level !== "warning") continue;
        nodes.push({ id: `console-${item.id}`, timestamp: item.createdAt, kind: "console", data: item });
      }
    }
    if (this.filterNetwork) {
      for (const item of snapshot.networkEntries) {
        const status = item.status ?? 0;
        const isError = status >= 400 || Boolean(item.error);
        if (this.filterErrorOnly && !isError) continue;
        nodes.push({ id: `network-${item.id}`, timestamp: item.createdAt, kind: "network", data: item });
      }
    }

    nodes.sort((a, b) => a.timestamp - b.timestamp);

    if (!nodes.length) {
      this.container.innerHTML = `<div class="empty">没有匹配的全景事件记录</div>`;
      return;
    }

    const originEpochMs = snapshot.session?.timeline.startedAtEpochMs ?? snapshot.session?.timeline.createdAtEpochMs;

    this.container.innerHTML = nodes.map((node) => {
      const relTime = originEpochMs != null ? formatElapsedEpochTime(node.timestamp, originEpochMs) : new Date(node.timestamp).toLocaleTimeString();
      let badgeHtml = "";
      let contentHtml = "";

      if (node.kind === "interaction") {
        badgeHtml = `<span class="stream-node-badge kind-interaction"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:2px"><path d="M3 3l7 18 3-7 7-3L3 3z"></path></svg> 交互</span>`;
        contentHtml = `${escapeHtml(node.data.element.text || node.data.element.tagName)} <span class="stream-node-meta">${escapeHtml(node.data.page.url)}</span>`;
      } else if (node.kind === "console") {
        const level = (node.data.level || "log").toLowerCase();
        const badgeClass = level === "error" ? "kind-console-error" : level === "warn" || level === "warning" ? "kind-console-warn" : "kind-console-log";
        badgeHtml = `<span class="stream-node-badge ${badgeClass}"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:2px"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg> Console.${level}</span>`;
        contentHtml = escapeHtml(node.data.text || "");
      } else if (node.kind === "network") {
        const status = node.data.status ?? 0;
        const isError = status >= 400 || Boolean(node.data.error);
        const badgeClass = isError ? "kind-network-error" : "kind-network-success";
        badgeHtml = `<span class="stream-node-badge ${badgeClass}"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:2px"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg> Network ${status || (node.data.error ? "FAIL" : "...")}</span>`;
        contentHtml = `<strong>${escapeHtml((node.data.method || "GET").toUpperCase())}</strong> ${escapeHtml(node.data.url)}`;
      }

      return `
        <div class="stream-node ${node.id === this.selectedId ? "active" : ""}" data-node-id="${escapeHtml(node.id)}" data-timestamp="${node.timestamp}">
          <span class="stream-node-time">${escapeHtml(relTime)}</span>
          ${badgeHtml}
          <div class="stream-node-content">${contentHtml}</div>
          <button class="stream-clip-btn" data-clip-timestamp="${node.timestamp}" title="导出前后 5 秒 1080p 原画视频片段">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>
            <span>剪辑 5s</span>
          </button>
        </div>
      `;
    }).join("");

    this.container.querySelectorAll<HTMLElement>("[data-node-id]").forEach((row) => {
      row.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).closest(".stream-clip-btn")) return;
        this.selectedId = row.dataset.nodeId || null;
        this.container?.querySelectorAll(".stream-node").forEach((n) => n.classList.remove("active"));
        row.classList.add("active");
        const timestamp = Number(row.dataset.timestamp);
        if (Number.isFinite(timestamp) && originEpochMs != null && this.video) {
          this.video.currentTime = Math.max(0, (timestamp - originEpochMs) / 1000);
        }
      });
    });

    this.container.querySelectorAll<HTMLButtonElement>(".stream-clip-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const timestamp = Number(btn.dataset.clipTimestamp);
        if (Number.isFinite(timestamp)) {
          this.exportClip(timestamp, btn);
        }
      });
    });
  }

  private exportClip(timestamp: number, button: HTMLButtonElement): void {
    if (!this.video || !this.lastSnapshot) return;
    const originEpochMs = this.lastSnapshot.session?.timeline.startedAtEpochMs ?? this.lastSnapshot.session?.timeline.createdAtEpochMs;
    if (originEpochMs == null) return;

    const duration = this.video.duration;
    if (!duration || !Number.isFinite(duration)) return;

    const { startTime, endTime } = calculateClipRange(timestamp, originEpochMs, duration, 2.5);
    const origHtml = button.innerHTML;
    button.disabled = true;
    button.textContent = "导出中…";

    const canvas = document.createElement("canvas");
    canvas.width = this.video.videoWidth || 1280;
    canvas.height = this.video.videoHeight || 720;
    const ctx = canvas.getContext("2d");

    let stream: MediaStream;
    try {
      stream = (canvas as any).captureStream ? (canvas as any).captureStream(30) : (this.video as any).captureStream();
    } catch {
      button.disabled = false;
      button.innerHTML = origHtml;
      return;
    }

    const { mimeType, extension } = getPreferredVideoType();
    let mediaRecorder: MediaRecorder;
    try {
      mediaRecorder = new MediaRecorder(stream, { mimeType });
    } catch {
      try {
        mediaRecorder = new MediaRecorder(stream);
      } catch {
        button.disabled = false;
        button.innerHTML = origHtml;
        return;
      }
    }

    const chunks: Blob[] = [];
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `buglens_clip_${Math.round(startTime)}s-${Math.round(endTime)}s.${extension}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      button.disabled = false;
      button.innerHTML = origHtml;
    };

    this.video.currentTime = startTime;

    let animId: number;
    const drawFrame = () => {
      if (ctx && this.video) ctx.drawImage(this.video, 0, 0, canvas.width, canvas.height);
      if (this.video && this.video.currentTime < endTime && !this.video.paused) {
        animId = requestAnimationFrame(drawFrame);
      } else {
        cancelAnimationFrame(animId);
        if (mediaRecorder.state === "recording") mediaRecorder.stop();
        this.video?.pause();
      }
    };

    mediaRecorder.start();
    this.video.play().then(() => {
      drawFrame();
    }).catch(() => {
      if (mediaRecorder.state === "recording") mediaRecorder.stop();
      button.disabled = false;
      button.innerHTML = origHtml;
    });
  }
}

function getPreferredVideoType(): { mimeType: string; extension: string } {
  const candidates = [
    { mimeType: "video/mp4;codecs=avc1.42E01E,mp4a.40.2", extension: "mp4" },
    { mimeType: "video/mp4", extension: "mp4" },
    { mimeType: "video/webm;codecs=vp9", extension: "webm" },
    { mimeType: "video/webm", extension: "webm" }
  ];

  for (const item of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(item.mimeType)) {
      return item;
    }
  }
  return { mimeType: "video/mp4", extension: "mp4" };
}
