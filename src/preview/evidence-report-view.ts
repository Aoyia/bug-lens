import type { ConsoleEntry, InteractionRecord, NetworkEntry, RecordingSession } from "../shared/protocol";
import { DiagnosticsView } from "./diagnostics-view";
import { ImageViewer } from "./image-viewer";
import { InteractionListView } from "./interaction-list-view";
import { PreviewPageShell } from "./page-shell";
import { IssueSceneView, type IssueScenePreview } from "./issue-scene-view";

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

const emptyDiagnostics = {
  session: undefined,
  consoleEntries: [],
  includedConsoleEntries: [],
  networkEntries: [],
  includedNetworkEntries: []
};

export class EvidenceReportView {
  private readonly shell: PreviewPageShell;
  private readonly imageViewer: ImageViewer;
  private readonly interactionList: InteractionListView;
  private readonly diagnostics: DiagnosticsView;
  private readonly issueScenes: IssueSceneView;

  constructor(private readonly root: Document, private readonly adapter: EvidenceReportAdapter) {
    this.shell = new PreviewPageShell(root, () => this.updateRestoreButtons());
    this.imageViewer = new ImageViewer(root, (message) => this.shell.notify(message));
    this.interactionList = new InteractionListView(root, {
      openImage: (interactionId) => this.openImage(interactionId),
      ...(adapter.mode === "editable" ? { exclude: (interactionId: string) => void this.excludeInteraction(interactionId) } : {})
    });
    this.diagnostics = new DiagnosticsView({
      getSnapshot: () => {
        const snapshot = adapter.getSnapshot();
        if (!snapshot) return emptyDiagnostics;
        return {
          session: snapshot.session,
          consoleEntries: snapshot.consoleEntries.all,
          includedConsoleEntries: snapshot.consoleEntries.included,
          networkEntries: snapshot.networkEntries.all,
          includedNetworkEntries: snapshot.networkEntries.included
        };
      },
      notify: (message) => this.shell.notify(message),
      ...(adapter.mode === "editable" ? {
        exclude: (kind: "console" | "network", id: string) => adapter.excludeDiagnostic(kind, id),
        restore: (kind: "console" | "network") => adapter.restore(kind),
        selectionChanged: () => this.renderSummary()
      } : {})
    }, root);
    this.issueScenes = new IssueSceneView(root, {
      exclude: async (id) => {
        if (adapter.mode !== "editable") return;
        await adapter.excludeIssueScene?.(id);
        this.render();
      },
      notify: (message) => this.shell.notify(message)
    });

    if (adapter.mode === "editable") {
      root.querySelector<HTMLButtonElement>("#restore")?.addEventListener("click", () => void this.restoreInteractions());
      root.querySelector<HTMLButtonElement>("#restore-issues")?.addEventListener("click", () => void this.restoreIssueScenes());
    }
  }

  notify(message: string): void {
    this.shell.notify(message);
  }

  render(): void {
    const snapshot = this.adapter.getSnapshot();
    if (!snapshot) return;
    this.root.querySelector<HTMLElement>("#title")!.textContent = snapshot.session.target.initialTitle || "录制预览";
    this.root.querySelector<HTMLElement>("#meta")!.textContent = `${snapshot.session.target.initialUrl} · ${snapshot.session.timeline.durationMs ? `${Math.round(snapshot.session.timeline.durationMs / 1000)} 秒` : "时长未知"}`;
    this.renderSummary();
    this.interactionList.render({
      all: snapshot.interactions.all,
      included: snapshot.interactions.included,
      hasMedia: snapshot.hasMedia,
      startedAtEpochMs: snapshot.session.timeline.startedAtEpochMs
    });
    this.issueScenes.render(snapshot.issueScenes ?? { all: [], included: [] }, snapshot.session.timeline.startedAtEpochMs, this.adapter.mode === "editable");
    this.diagnostics.render();
  }

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
      { key: "issues", value: snapshot.issueScenes?.included.length ?? 0, label: "问题现场" }
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
      issueScene: (snapshot.issueScenes?.all.length ?? 0) - (snapshot.issueScenes?.included.length ?? 0)
    };
    return kind ? counts[kind] : counts.interaction + counts.console + counts.network + counts.issueScene;
  }

  private updateRestoreButtons(): void {
    if (this.adapter.mode !== "editable") return;
    const buttons = [
      { selector: "#restore", kind: "interaction" as const, tab: "steps", label: "步骤" },
      { selector: "#restore-console", kind: "console" as const, tab: "console", label: "日志" },
      { selector: "#restore-network", kind: "network" as const, tab: "network", label: "请求" },
      { selector: "#restore-issues", kind: "issueScene" as const, tab: "issues", label: "问题现场" }
    ];
    for (const item of buttons) {
      const button = this.root.querySelector<HTMLButtonElement>(item.selector);
      if (!button) continue;
      const count = this.excludedCount(item.kind);
      button.hidden = count === 0 || this.shell.activeTab !== item.tab;
      button.textContent = `恢复${item.label}（${count}）`;
    }
  }

  private openImage(interactionId: string): void {
    const interactions = this.adapter.getSnapshot()?.interactions.included ?? [];
    this.imageViewer.open(interactions, interactionId);
  }

  private async excludeInteraction(interactionId: string): Promise<void> {
    if (this.adapter.mode !== "editable") return;
    await this.adapter.excludeInteraction(interactionId);
    this.render();
  }

  private async restoreInteractions(): Promise<void> {
    if (this.adapter.mode !== "editable") return;
    await this.adapter.restore("interaction");
    this.render();
  }

  private async restoreIssueScenes(): Promise<void> {
    if (this.adapter.mode !== "editable") return;
    await this.adapter.restore("issueScene");
    this.render();
  }
}
