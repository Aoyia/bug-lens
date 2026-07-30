import type { ConsoleEntry, ExportSelection, InteractionRecord, IssueScene, NetworkEntry } from "../shared/protocol";

type EvidenceKind = "interaction" | "console" | "network" | "issueScene";

export class PreviewController {
  private readonly excluded = {
    interaction: new Set<string>(),
    console: new Set<string>(),
    network: new Set<string>(),
    issueScene: new Set<string>()
  };

  loadSelection(selection?: ExportSelection): void {
    this.restore("interaction");
    this.restore("console");
    this.restore("network");
    this.restore("issueScene");
    for (const id of selection?.excludedInteractionIds ?? []) this.excluded.interaction.add(id);
    for (const id of selection?.excludedConsoleEntryIds ?? []) this.excluded.console.add(id);
    for (const id of selection?.excludedNetworkEntryIds ?? []) this.excluded.network.add(id);
    for (const id of selection?.excludedIssueSceneIds ?? []) this.excluded.issueScene.add(id);
  }

  exclude(kind: EvidenceKind, id: string): void { this.excluded[kind].add(id); }
  restore(kind: EvidenceKind): void { this.excluded[kind].clear(); }
  excludedCount(kind: EvidenceKind): number { return this.excluded[kind].size; }
  totalExcluded(): number { return this.excluded.interaction.size + this.excluded.console.size + this.excluded.network.size + this.excluded.issueScene.size; }

  includedInteractions(items: InteractionRecord[]): InteractionRecord[] {
    return items.filter((item) => !this.excluded.interaction.has(item.id));
  }

  includedConsoleEntries(items: ConsoleEntry[]): ConsoleEntry[] {
    return items.filter((item) => !this.excluded.console.has(item.id));
  }

  includedNetworkEntries(items: NetworkEntry[]): NetworkEntry[] {
    return items.filter((item) => !this.excluded.network.has(item.id));
  }

  includedIssueScenes<T extends IssueScene | { scene: IssueScene }>(items: T[]): T[] {
    return items.filter((item) => !this.excluded.issueScene.has("scene" in item ? item.scene.id : item.id));
  }

  toSelection(sessionId: string): ExportSelection {
    return {
      sessionId,
      excludedInteractionIds: [...this.excluded.interaction],
      excludedConsoleEntryIds: [...this.excluded.console],
      excludedNetworkEntryIds: [...this.excluded.network],
      excludedIssueSceneIds: [...this.excluded.issueScene],
      updatedAtEpochMs: Date.now()
    };
  }
}
