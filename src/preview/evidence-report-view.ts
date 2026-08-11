import { h, render } from "preact";
import type {
  ConsoleEntry,
  FrameworkStateEvidence,
  InteractionRecord,
  NetworkEntry,
  RecordingSession,
} from "../shared/protocol";
import { ImageViewer } from "./image-viewer";
import { PreviewPageShell } from "./page-shell";
import type { IssueScenePreview } from "./issue-scene-view";
import { t } from "../shared/i18n.ts";
import { ConsoleTab } from "../components/preview/ConsoleTab";
import { NetworkTab } from "../components/preview/NetworkTab";
import { InteractionsTab } from "../components/preview/InteractionsTab";
import { IssueSceneTab } from "../components/preview/IssueSceneTab";
import { FrameworkStateTab } from "../components/preview/FrameworkStateTab";
import { StreamTab } from "../components/preview/StreamTab";
import { formatElapsedEpochTime } from "../domain/evidence-clock";
import { exportVideoClip } from "./video-clip-exporter";
import { formatEnvironmentSummary } from "../domain/environment-capture";

// 引入网络详情逻辑类型支持
declare global {
  interface Window {
    __BUG_LENS_NETWORK_DETAILS__?: Record<string, any>;
  }
}

type EvidenceCollection<T> = { all: T[]; included: T[] };

export type EvidenceReportSnapshot = {
  session: RecordingSession;
  interactions: EvidenceCollection<InteractionRecord>;
  consoleEntries: EvidenceCollection<ConsoleEntry>;
  networkEntries: EvidenceCollection<NetworkEntry>;
  issueScenes?: EvidenceCollection<IssueScenePreview>;
  frameworkStates?: FrameworkStateEvidence[];
  hasMedia: boolean;
};

type ReadOnlyReportAdapter = {
  mode: "read-only";
  getSnapshot(): EvidenceReportSnapshot | undefined;
};

type EditableReportAdapter = {
  mode: "editable";
  getSnapshot(): EvidenceReportSnapshot | undefined;
  excludeInteraction(interactionId: string): Promise<void>;
  excludeDiagnostic(kind: "console" | "network", id: string): Promise<void>;
  excludeIssueScene?(issueSceneId: string): Promise<void>;
  restore(
    kind: "interaction" | "console" | "network" | "issueScene"
  ): Promise<void>;
};

export type EvidenceReportAdapter =
  ReadOnlyReportAdapter | EditableReportAdapter;

export class EvidenceReportView {
  private readonly shell: PreviewPageShell;
  private readonly imageViewer: ImageViewer;
  private hasInitializedDefaultTab = false;

  // Preact 挂载容器
  private readonly consoleContainer: HTMLElement;
  private readonly networkContainer: HTMLElement;
  private readonly interactionsContainer: HTMLElement;
  private readonly issueScenesContainer: HTMLElement;
  private readonly frameworkStatesContainer: HTMLElement | null;
  private readonly streamContainer: HTMLElement | null;

  constructor(
    private readonly root: Document,
    private readonly adapter: EvidenceReportAdapter
  ) {
    this.shell = new PreviewPageShell(root, () => this.updateRestoreButtons());
    this.imageViewer = new ImageViewer(root, (message) =>
      this.shell.notify(message)
    );

    // 定位挂载目标
    this.consoleContainer =
      root.querySelector<HTMLElement>("#tab-pane-console")!;
    this.networkContainer =
      root.querySelector<HTMLElement>("#tab-pane-network")!;
    this.interactionsContainer =
      root.querySelector<HTMLElement>("#interactions")!;
    this.issueScenesContainer =
      root.querySelector<HTMLElement>("#issue-scenes")!;
    this.frameworkStatesContainer = root.querySelector<HTMLElement>(
      "#tab-pane-framework"
    );
    this.streamContainer = root.querySelector<HTMLElement>("#tab-pane-stream");

    // 恢复按钮绑定（仅 editable 模式）
    if (adapter.mode === "editable") {
      root
        .querySelector<HTMLButtonElement>("#restore")
        ?.addEventListener("click", () => void this.restoreKind("interaction"));
      root
        .querySelector<HTMLButtonElement>("#restore-issues")
        ?.addEventListener("click", () => void this.restoreKind("issueScene"));
      root
        .querySelector<HTMLButtonElement>("#restore-console")
        ?.addEventListener("click", () => void this.restoreKind("console"));
      root
        .querySelector<HTMLButtonElement>("#restore-network")
        ?.addEventListener("click", () => void this.restoreKind("network"));
    }
  }

  notify(message: string): void {
    this.shell.notify(message);
  }

  render(): void {
    const snapshot = this.adapter.getSnapshot();
    if (!snapshot) return;

    if (!this.hasInitializedDefaultTab) {
      const issueCount = snapshot.issueScenes?.included.length ?? 0;
      const stepCount = snapshot.interactions.included.length;
      const consoleCount = snapshot.consoleEntries.included.length;
      const networkCount = snapshot.networkEntries.included.length;

      let defaultTab: "issues" | "steps" | "console" | "network" = "issues";
      if (issueCount > 0) {
        defaultTab = "issues";
      } else if (stepCount > 0) {
        defaultTab = "steps";
      } else if (consoleCount > 0) {
        defaultTab = "console";
      } else if (networkCount > 0) {
        defaultTab = "network";
      } else {
        defaultTab = "issues";
      }

      this.shell.selectTab(defaultTab);
      this.hasInitializedDefaultTab = true;
    }

    // 标题与元信息
    const titleText =
      snapshot.session.target.initialTitle || t("recordingPreviewFallback");
    const metaText = `${snapshot.session.target.initialUrl} · ${
      snapshot.session.timeline.durationMs
        ? t("previewDuration", [
            String(Math.round(snapshot.session.timeline.durationMs / 1000)),
          ])
        : t("unknownDuration")
    }`;
    const titleEl = this.root.querySelector<HTMLElement>("#title");
    if (titleEl) {
      titleEl.textContent = titleText;
      titleEl.setAttribute("title", titleText);
    }
    const metaEl = this.root.querySelector<HTMLElement>("#meta");
    if (metaEl) {
      metaEl.textContent = metaText;
      metaEl.setAttribute("title", metaText);
    }
    // 运行环境信息（系统/浏览器/分辨率）由录制握手时自动附带
    const environmentEl = this.root.querySelector<HTMLElement>(
      "#environment-summary"
    );
    if (environmentEl) {
      const environmentText = formatEnvironmentSummary(
        snapshot.session.target.environment
      );
      environmentEl.hidden = !environmentText;
      environmentEl.textContent = environmentText;
      if (environmentText) environmentEl.setAttribute("title", environmentText);
    }

    this.renderSummary();

    const editable = this.adapter.mode === "editable";
    const seekVideo = (timestampMs: number) => {
      const originEpochMs =
        snapshot.session.timeline.startedAtEpochMs ??
        snapshot.session.timeline.createdAtEpochMs;
      if (originEpochMs != null) {
        const video = this.root.querySelector<HTMLVideoElement>("#video");
        if (video)
          video.currentTime = Math.max(0, (timestampMs - originEpochMs) / 1000);
      }
    };

    // Console 标签页
    render(
      h(ConsoleTab, {
        snapshot: {
          session: snapshot.session,
          all: snapshot.consoleEntries.all,
          included: snapshot.consoleEntries.included,
        },
        editable,
        onExclude: editable
          ? async (id: string) => {
              if (this.adapter.mode !== "editable") return;
              await this.adapter.excludeDiagnostic("console", id);
              this.render();
            }
          : undefined,
        onSelectionChanged: () => this.renderSummary(),
        onSeekVideo: seekVideo,
      }),
      this.consoleContainer
    );

    // Network 标签页
    render(
      h(NetworkTab, {
        snapshot: {
          session: snapshot.session,
          all: snapshot.networkEntries.all,
          included: snapshot.networkEntries.included,
        },
        editable,
        onExclude: editable
          ? async (id: string) => {
              if (this.adapter.mode !== "editable") return;
              await this.adapter.excludeDiagnostic("network", id);
              this.render();
            }
          : undefined,
        onSelectionChanged: () => this.renderSummary(),
        onSeekVideo: seekVideo,
        onNotify: (message: string) => this.shell.notify(message),
      }),
      this.networkContainer
    );

    // Interactions 标签页
    render(
      h(InteractionsTab, {
        snapshot: {
          all: snapshot.interactions.all,
          included: snapshot.interactions.included,
          hasMedia: snapshot.hasMedia,
          startedAtEpochMs: snapshot.session.timeline.startedAtEpochMs,
        },
        editable,
        onExclude: editable
          ? (id: string) => {
              if (this.adapter.mode !== "editable") return;
              void this.adapter
                .excludeInteraction(id)
                .then(() => this.render());
            }
          : undefined,
        onOpenImage: (interactionId: string) => {
          const interactions = snapshot.interactions.included;
          this.imageViewer.open(interactions, interactionId);
        },
        onSeekVideo: seekVideo,
        onNotify: (message: string) => this.shell.notify(message),
      }),
      this.interactionsContainer
    );

    // 问题现场标签页
    const issueScenes = snapshot.issueScenes ?? { all: [], included: [] };
    render(
      h(IssueSceneTab, {
        collection: issueScenes,
        startedAtEpochMs: snapshot.session.timeline.startedAtEpochMs,
        editable,
        onExclude: editable
          ? async (id: string) => {
              if (this.adapter.mode !== "editable") return;
              await this.adapter.excludeIssueScene?.(id);
              this.render();
            }
          : undefined,
        onSeekVideo: seekVideo,
        onOpenImage: (sceneId, mode) => {
          this.imageViewer.openScenes(issueScenes.included, sceneId, mode);
        },
        onNotify: (message: string) => this.shell.notify(message),
      }),
      this.issueScenesContainer
    );

    // 框架状态标签页
    if (this.frameworkStatesContainer) {
      render(
        h(FrameworkStateTab, {
          states: snapshot.frameworkStates ?? [],
          startedAtEpochMs: snapshot.session.timeline.startedAtEpochMs,
        }),
        this.frameworkStatesContainer
      );
    }

    // 时间线流标签页（离线报告中不存在）
    if (this.streamContainer) {
      render(
        h(StreamTab, {
          snapshot: {
            session: snapshot.session,
            interactions: snapshot.interactions.included,
            consoleEntries: snapshot.consoleEntries.included,
            networkEntries: snapshot.networkEntries.included,
          },
          onSeekVideo: seekVideo,
          onExportClip: (timestamp: number) => {
            seekVideo(timestamp);
            const originEpochMs =
              snapshot.session.timeline.startedAtEpochMs ??
              snapshot.session.timeline.createdAtEpochMs;
            const timeStr =
              originEpochMs != null
                ? formatElapsedEpochTime(timestamp, originEpochMs)
                : "00-00";

            const video = this.root.querySelector<HTMLVideoElement>("#video");
            if (!video || video.hidden || !video.src) {
              this.shell.notify(t("clipExportNoVideo"));
              return;
            }

            const relSec =
              originEpochMs != null ? (timestamp - originEpochMs) / 1000 : 0;
            const startSec = Math.max(0, relSec - 2.5);
            const endSec = Math.min(video.duration || 0, relSec + 2.5);
            const safeName = `clip-${(timeStr || "00-00").replace(/:/g, "-")}.mp4`;

            void exportVideoClip(video, startSec, endSec, safeName, (msg) =>
              this.shell.notify(msg)
            );
          },
        }),
        this.streamContainer
      );
    }
  }

  // ---------- 摘要与恢复 ----------

  private renderSummary(): void {
    const snapshot = this.adapter.getSnapshot();
    if (!snapshot) return;
    const included = snapshot.interactions.included;
    const metrics = [
      { key: "steps", value: included.length, label: t("metricSteps") },
      ...(this.adapter.mode === "editable"
        ? [
            {
              key: "deleted",
              value: this.excludedCount(),
              label: t("metricDeleted"),
            },
          ]
        : []),
      {
        key: "screenshots",
        value: included.filter((item) => item.screenshot.status === "captured")
          .length,
        label: t("metricScreenshots"),
      },
      {
        key: "console",
        value: snapshot.consoleEntries.included.length,
        label: "Console",
      },
      {
        key: "network",
        value: snapshot.networkEntries.included.length,
        label: "Network",
      },
      {
        key: "issues",
        value: snapshot.issueScenes?.included.length ?? 0,
        label: t("issueScenes"),
      },
    ];
    this.root.querySelector<HTMLElement>("#metrics")!.innerHTML = metrics
      .map(
        (item) =>
          `<div class="metric metric-${item.key}"><strong>${item.value}</strong><span>${item.label}</span></div>`
      )
      .join("");
    this.updateRestoreButtons();
  }

  private excludedCount(
    kind?: "interaction" | "console" | "network" | "issueScene"
  ): number {
    const snapshot = this.adapter.getSnapshot();
    if (!snapshot) return 0;
    const counts = {
      interaction:
        snapshot.interactions.all.length -
        snapshot.interactions.included.length,
      console:
        snapshot.consoleEntries.all.length -
        snapshot.consoleEntries.included.length,
      network:
        snapshot.networkEntries.all.length -
        snapshot.networkEntries.included.length,
      issueScene:
        (snapshot.issueScenes?.all.length ?? 0) -
        (snapshot.issueScenes?.included.length ?? 0),
    };
    return kind
      ? counts[kind]
      : counts.interaction +
          counts.console +
          counts.network +
          counts.issueScene;
  }

  private updateRestoreButtons(): void {
    if (this.adapter.mode !== "editable") return;
    const buttons = [
      {
        selector: "#restore",
        kind: "interaction" as const,
        tab: "steps",
        label: t("restoreLabelSteps"),
      },
      {
        selector: "#restore-console",
        kind: "console" as const,
        tab: "console",
        label: t("restoreLabelLogs"),
      },
      {
        selector: "#restore-network",
        kind: "network" as const,
        tab: "network",
        label: t("restoreLabelRequests"),
      },
      {
        selector: "#restore-issues",
        kind: "issueScene" as const,
        tab: "issues",
        label: t("issueScenes"),
      },
    ];
    for (const item of buttons) {
      const button = this.root.querySelector<HTMLButtonElement>(item.selector);
      if (!button) continue;
      const count = this.excludedCount(item.kind);
      button.hidden = count === 0 || this.shell.activeTab !== item.tab;
      button.textContent = t("restoreWithCount", [item.label, String(count)]);
    }
  }

  private async restoreKind(
    kind: "interaction" | "console" | "network" | "issueScene"
  ): Promise<void> {
    if (this.adapter.mode !== "editable") return;
    await this.adapter.restore(kind);
    this.render();
  }
}
