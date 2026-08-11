import type {
  ConsoleEntry,
  FrameworkStateEvidence,
  InteractionRecord,
  NetworkEntry,
  RecordingSession,
} from "../../shared/protocol";
import type { IssueScenePreview } from "../../preview/issue-scene-view";
import { EvidenceReportView } from "../../preview/evidence-report-view";
import { applyI18n, getLocale, t } from "../../shared/i18n";
import "../../shared/components/truncated-text";

type StaticReportData = {
  protocolVersion: 3;
  session: RecordingSession;
  interactions: InteractionRecord[];
  consoleEntries: ConsoleEntry[];
  networkEntries: NetworkEntry[];
  issueScenes: IssueScenePreview[];
  frameworkStates?: FrameworkStateEvidence[];
  hasMedia: boolean;
};

declare global {
  interface Window {
    __WEB_BUG_REPORT_DATA__?: StaticReportData;
    __BUG_LENS_DATA__?: StaticReportData;
  }
}

// 自动翻译离线 HTML DOM 节点
applyI18n();

if (typeof window !== "undefined") {
  document.documentElement.lang = getLocale();
}

function loadReportData(): StaticReportData | undefined {
  if (typeof window !== "undefined") {
    if (window.__BUG_LENS_DATA__) {
      return window.__BUG_LENS_DATA__;
    }
    if (window.__WEB_BUG_REPORT_DATA__) {
      return window.__WEB_BUG_REPORT_DATA__;
    }
  }
  const scriptEl = document.getElementById("__BUG_LENS_DATA__");
  if (scriptEl && scriptEl.textContent) {
    try {
      return JSON.parse(scriptEl.textContent) as StaticReportData;
    } catch {
      // 忽略解析失败
    }
  }
  return undefined;
}

const data = loadReportData();
const meta = document.querySelector<HTMLElement>("#meta")!;

if (!data || data.protocolVersion !== 3) {
  meta.textContent =
    t("reportDataMissing", undefined) ||
    "报告数据缺失或版本不兼容，请确认 ZIP 已完整解压。";
  meta.classList.add("report-error");
} else {
  const view = new EvidenceReportView(document, {
    mode: "read-only",
    getSnapshot: () => ({
      session: data.session,
      interactions: { all: data.interactions, included: data.interactions },
      consoleEntries: {
        all: data.consoleEntries,
        included: data.consoleEntries,
      },
      networkEntries: {
        all: data.networkEntries,
        included: data.networkEntries,
      },
      issueScenes: {
        all: data.issueScenes ?? [],
        included: data.issueScenes ?? [],
      },
      frameworkStates: data.frameworkStates ?? [],
      hasMedia: data.hasMedia,
    }),
  });

  const quality = document.querySelector<HTMLElement>("#quality-status")!;
  quality.textContent =
    data.session.quality.overall === "complete"
      ? t("qualityComplete") !== "qualityComplete"
        ? t("qualityComplete")
        : "证据完整"
      : data.session.quality.overall === "partial"
        ? t("qualityPartial") !== "qualityPartial"
          ? t("qualityPartial")
          : "证据部分缺失"
        : t("qualityFailed") !== "qualityFailed"
          ? t("qualityFailed")
          : "证据采集失败";
  quality.dataset.quality = data.session.quality.overall;

  const video = document.querySelector<HTMLVideoElement>("#video")!;
  const videoEmpty = document.querySelector<HTMLElement>("#video-empty")!;
  if (data.hasMedia) {
    video.src = "media/recording.webm";
    video.hidden = false;
    videoEmpty.hidden = true;
    video.addEventListener(
      "error",
      () => {
        video.hidden = true;
        videoEmpty.hidden = false;
        videoEmpty.textContent =
          t("videoDecodeFailed") !== "videoDecodeFailed"
            ? t("videoDecodeFailed")
            : "录像文件无法读取，请确认 media/recording.webm 已完整解压。";
      },
      { once: true }
    );
  } else {
    videoEmpty.textContent =
      t("noVideoPlayback") !== "noVideoPlayback"
        ? t("noVideoPlayback")
        : "本报告没有可播放的录像；交互和调试证据仍可查看。";
  }

  const suffix =
    t("offlineReportTitle") !== "offlineReportTitle"
      ? t("offlineReportTitle")
      : "离线报告";
  document.title = `${data.session.target.initialTitle || "Bug Lens"} - ${suffix}`;
  view.render();
}
