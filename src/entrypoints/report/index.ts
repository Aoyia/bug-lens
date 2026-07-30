import type { ConsoleEntry, InteractionRecord, NetworkEntry, RecordingSession } from "../../shared/protocol";
import { EvidenceReportView } from "../../preview/evidence-report-view";

type StaticReportData = {
  protocolVersion: 2;
  session: RecordingSession;
  interactions: InteractionRecord[];
  consoleEntries: ConsoleEntry[];
  networkEntries: NetworkEntry[];
  hasMedia: boolean;
};

declare global {
  interface Window {
    __WEB_BUG_REPORT_DATA__?: StaticReportData;
  }
}

const data = window.__WEB_BUG_REPORT_DATA__;
const meta = document.querySelector<HTMLElement>("#meta")!;

if (!data || data.protocolVersion !== 2) {
  meta.textContent = "报告数据缺失或版本不兼容，请确认 ZIP 已完整解压。";
  meta.classList.add("report-error");
} else {
  const view = new EvidenceReportView(document, {
    mode: "read-only",
    getSnapshot: () => ({
      session: data.session,
      interactions: { all: data.interactions, included: data.interactions },
      consoleEntries: { all: data.consoleEntries, included: data.consoleEntries },
      networkEntries: { all: data.networkEntries, included: data.networkEntries },
      hasMedia: data.hasMedia
    })
  });

  const quality = document.querySelector<HTMLElement>("#quality-status")!;
  quality.textContent = data.session.quality.overall === "complete" ? "证据完整" : data.session.quality.overall === "partial" ? "证据部分缺失" : "证据采集失败";
  quality.dataset.quality = data.session.quality.overall;

  const video = document.querySelector<HTMLVideoElement>("#video")!;
  const videoEmpty = document.querySelector<HTMLElement>("#video-empty")!;
  if (data.hasMedia) {
    video.src = "media/recording.webm";
    video.hidden = false;
    videoEmpty.hidden = true;
    video.addEventListener("error", () => {
      video.hidden = true;
      videoEmpty.hidden = false;
      videoEmpty.textContent = "录像文件无法读取，请确认 media/recording.webm 已完整解压。";
    }, { once: true });
  } else {
    videoEmpty.textContent = "本报告没有可播放的录像；交互和调试证据仍可查看。";
  }

  document.title = `${data.session.target.initialTitle || "Bug Lens"} - 离线报告`;
  view.render();
}
