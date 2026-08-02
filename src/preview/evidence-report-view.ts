import { h, render } from "preact";
import type { ConsoleEntry, InteractionRecord, NetworkEntry, RecordingSession } from "../shared/protocol";
import { ImageViewer } from "./image-viewer";
import { PreviewPageShell } from "./page-shell";
import type { IssueScenePreview } from "./issue-scene-view";
import { ConsoleTab } from "../components/preview/ConsoleTab";
import { NetworkTab } from "../components/preview/NetworkTab";
import { InteractionsTab } from "../components/preview/InteractionsTab";
import { IssueSceneTab } from "../components/preview/IssueSceneTab";
import { StreamTab } from "../components/preview/StreamTab";

type EvidenceCollection<T> = { all: T[]; included: T[] };

export type EvidenceReportSnapshot = {
  session: RecordingSession;
  interactions: EvidenceCollection<InteractionRecord>;
  consoleEntries: EvidenceCollection<ConsoleEntry>;
  networkEntries: EvidenceCollection<NetworkEntry>;
  issueScenes?: EvidenceCollection<IssueScenePreview>;
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
  restore(kind: "interaction" | "console" | "network" | "issueScene"): Promise<void>;
};

export type EvidenceReportAdapter = ReadOnlyReportAdapter | EditableReportAdapter;

export class EvidenceReportView {
  private readonly shell: PreviewPageShell;
  private readonly imageViewer: ImageViewer;
  private hasInitializedDefaultTab = false;

  // Preact mount containers
  private readonly consoleContainer: HTMLElement;
  private readonly networkContainer: HTMLElement;
  private readonly interactionsContainer: HTMLElement;
  private readonly issueScenesContainer: HTMLElement;
  private readonly streamContainer: HTMLElement | null;

  constructor(private readonly root: Document, private readonly adapter: EvidenceReportAdapter) {
    this.shell = new PreviewPageShell(root, () => this.updateRestoreButtons());
    this.imageViewer = new ImageViewer(root, (message) => this.shell.notify(message));

    // Locate mount targets
    this.consoleContainer = root.querySelector<HTMLElement>("#tab-pane-console")!;
    this.networkContainer = root.querySelector<HTMLElement>("#tab-pane-network")!;
    this.interactionsContainer = root.querySelector<HTMLElement>("#interactions")!;
    this.issueScenesContainer = root.querySelector<HTMLElement>("#issue-scenes")!;
    this.streamContainer = root.querySelector<HTMLElement>("#tab-pane-stream");

    // Restore button wiring (editable mode only)
    if (adapter.mode === "editable") {
      root.querySelector<HTMLButtonElement>("#restore")?.addEventListener("click", () => void this.restoreKind("interaction"));
      root.querySelector<HTMLButtonElement>("#restore-issues")?.addEventListener("click", () => void this.restoreKind("issueScene"));
      root.querySelector<HTMLButtonElement>("#restore-console")?.addEventListener("click", () => void this.restoreKind("console"));
      root.querySelector<HTMLButtonElement>("#restore-network")?.addEventListener("click", () => void this.restoreKind("network"));
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

    // Title & meta
    const titleText = snapshot.session.target.initialTitle || "录制预览";
    const metaText = `${snapshot.session.target.initialUrl} · ${snapshot.session.timeline.durationMs ? `${Math.round(snapshot.session.timeline.durationMs / 1000)} 秒` : "时长未知"}`;
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

    this.renderSummary();

    const editable = this.adapter.mode === "editable";
    const seekVideo = (timestampMs: number) => {
      const originEpochMs = snapshot.session.timeline.startedAtEpochMs ?? snapshot.session.timeline.createdAtEpochMs;
      if (originEpochMs != null) {
        const video = this.root.querySelector<HTMLVideoElement>("#video");
        if (video) video.currentTime = Math.max(0, (timestampMs - originEpochMs) / 1000);
      }
    };

    // Console tab
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

    // Network tab
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

    // Interactions tab
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
              void this.adapter.excludeInteraction(id).then(() => this.render());
            }
          : undefined,
        onOpenImage: (interactionId: string) => {
          const interactions = snapshot.interactions.included;
          this.imageViewer.open(interactions, interactionId);
        },
        onSeekVideo: seekVideo,
      }),
      this.interactionsContainer
    );

    // Issue scenes tab
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
        onNotify: (message: string) => this.shell.notify(message),
      }),
      this.issueScenesContainer
    );

    // Timeline stream tab (not present in offline report)
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
          onExportClip: (_timestamp: number) => {
            // clip export is handled by the video player in index.ts
          },
        }),
        this.streamContainer
      );
    }
  }

  // ---------- summary & restore ----------

  private renderSummary(): void {
    const snapshot = this.adapter.getSnapshot();
    if (!snapshot) return;
    const included = snapshot.interactions.included;
    const metrics = [
      { key: "steps", value: included.length, label: "有效步骤" },
      ...(this.adapter.mode === "editable" ? [{ key: "deleted", value: this.excludedCount(), label: "已删除" }] : []),
      { key: "screenshots", value: included.filter((item) => item.screenshot.status === "captured").length, label: "步骤截图" },
      { key: "console", value: snapshot.consoleEntries.included.length, label: "Console" },
      { key: "network", value: snapshot.networkEntries.included.length, label: "Network" },
      { key: "issues", value: snapshot.issueScenes?.included.length ?? 0, label: "问题现场" },
    ];
    this.root.querySelector<HTMLElement>("#metrics")!.innerHTML = metrics
      .map((item) => `<div class="metric metric-${item.key}"><strong>${item.value}</strong><span>${item.label}</span></div>`)
      .join("");
    this.updateRestoreButtons();
  }

  private excludedCount(kind?: "interaction" | "console" | "network" | "issueScene"): number {
    const snapshot = this.adapter.getSnapshot();
    if (!snapshot) return 0;
    const counts = {
      interaction: snapshot.interactions.all.length - snapshot.interactions.included.length,
      console: snapshot.consoleEntries.all.length - snapshot.consoleEntries.included.length,
      network: snapshot.networkEntries.all.length - snapshot.networkEntries.included.length,
      issueScene: (snapshot.issueScenes?.all.length ?? 0) - (snapshot.issueScenes?.included.length ?? 0),
    };
    return kind ? counts[kind] : counts.interaction + counts.console + counts.network + counts.issueScene;
  }

  private updateRestoreButtons(): void {
    if (this.adapter.mode !== "editable") return;
    const buttons = [
      { selector: "#restore", kind: "interaction" as const, tab: "steps", label: "步骤" },
      { selector: "#restore-console", kind: "console" as const, tab: "console", label: "日志" },
      { selector: "#restore-network", kind: "network" as const, tab: "network", label: "请求" },
      { selector: "#restore-issues", kind: "issueScene" as const, tab: "issues", label: "问题现场" },
    ];
    for (const item of buttons) {
      const button = this.root.querySelector<HTMLButtonElement>(item.selector);
      if (!button) continue;
      const count = this.excludedCount(item.kind);
      button.hidden = count === 0 || this.shell.activeTab !== item.tab;
      button.textContent = `恢复${item.label}（${count}）`;
    }
  }

  private async restoreKind(kind: "interaction" | "console" | "network" | "issueScene"): Promise<void> {
    if (this.adapter.mode !== "editable") return;
    await this.adapter.restore(kind);
    this.render();
  }
}
