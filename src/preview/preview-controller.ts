import type {
  ConsoleEntry,
  CustomTicketNarrative,
  ExportSelection,
  InteractionRecord,
  IssueScene,
  NetworkEntry,
} from "../shared/protocol";
import { UndoManager } from "../shared/undo-manager";

type EvidenceKind = "interaction" | "console" | "network" | "issueScene";

/** 工单草稿定制状态（供 buildTicketBundle 消费） */
export type TicketCuration = {
  excludedScreenshotInteractionIds: Set<string>;
  customStepDescriptions: Record<string, string>;
  customTicketNarrative?: CustomTicketNarrative;
};

type TicketEvidenceKind = "interaction" | "console" | "network";

type SelectionState = {
  excluded: Record<TicketEvidenceKind, string[]>;
  screenshots: string[];
  stepDescriptions: Record<string, string>;
  narrative?: CustomTicketNarrative;
};

const oneLine = (value: string) => value.replace(/[\r\n]+/g, " ").trim();

export class PreviewController {
  private readonly excluded = {
    interaction: new Set<string>(),
    console: new Set<string>(),
    network: new Set<string>(),
    issueScene: new Set<string>(),
  };
  private readonly hiddenScreenshots = new Set<string>();
  private stepDescriptions: Record<string, string> = {};
  private narrative?: CustomTicketNarrative;
  private readonly history = new UndoManager<SelectionState>({ limit: 50 });

  loadSelection(selection?: ExportSelection): void {
    for (const set of Object.values(this.excluded)) set.clear();
    this.hiddenScreenshots.clear();
    this.history.reset();
    for (const id of selection?.excludedInteractionIds ?? [])
      this.excluded.interaction.add(id);
    for (const id of selection?.excludedConsoleEntryIds ?? [])
      this.excluded.console.add(id);
    for (const id of selection?.excludedNetworkEntryIds ?? [])
      this.excluded.network.add(id);
    for (const id of selection?.excludedIssueSceneIds ?? [])
      this.excluded.issueScene.add(id);
    for (const id of selection?.excludedScreenshotInteractionIds ?? [])
      this.hiddenScreenshots.add(id);
    this.stepDescriptions = { ...(selection?.customStepDescriptions ?? {}) };
    this.narrative = selection?.customTicketNarrative
      ? { ...selection.customTicketNarrative }
      : undefined;
  }

  // ---------- 撤回/重做 ----------

  private capture(): SelectionState {
    return {
      excluded: {
        interaction: [...this.excluded.interaction],
        console: [...this.excluded.console],
        network: [...this.excluded.network],
      },
      screenshots: [...this.hiddenScreenshots],
      stepDescriptions: { ...this.stepDescriptions },
      narrative: this.narrative ? { ...this.narrative } : undefined,
    };
  }

  private apply(state: SelectionState): void {
    for (const kind of ["interaction", "console", "network"] as const) {
      this.excluded[kind].clear();
      for (const id of state.excluded[kind]) this.excluded[kind].add(id);
    }
    this.hiddenScreenshots.clear();
    for (const id of state.screenshots) this.hiddenScreenshots.add(id);
    this.stepDescriptions = { ...state.stepDescriptions };
    this.narrative = state.narrative ? { ...state.narrative } : undefined;
  }

  get canUndo(): boolean {
    return this.history.canUndo;
  }
  get canRedo(): boolean {
    return this.history.canRedo;
  }

  undo(): boolean {
    if (!this.history.canUndo) return false;
    this.apply(this.history.undo(this.capture()));
    return true;
  }

  redo(): boolean {
    if (!this.history.canRedo) return false;
    this.apply(this.history.redo(this.capture()));
    return true;
  }

  // ---------- 排除/恢复 ----------

  exclude(kind: EvidenceKind, id: string): void {
    this.excludeMany(kind, [id]);
  }

  /** 一次性排除多个 id，仅产生 1 个撤回点（issueScene 不纳入工单撤回栈，与重置作用域对齐）。 */
  excludeMany(kind: EvidenceKind, ids: string[]): void {
    const fresh = ids.filter((id) => !this.excluded[kind].has(id));
    if (!fresh.length) return;
    if (kind !== "issueScene") this.history.record(this.capture());
    for (const id of fresh) this.excluded[kind].add(id);
  }

  restore(kind: EvidenceKind): void {
    if (!this.excluded[kind].size) return;
    if (kind !== "issueScene") this.history.record(this.capture());
    this.excluded[kind].clear();
  }

  excludeScreenshot(interactionId: string): void {
    this.excludeScreenshots([interactionId]);
  }

  /** 一次性隐藏多条底层交互对应的截图（用于合并步骤整组隐藏），仅产生 1 个撤回点。 */
  excludeScreenshots(interactionIds: string[]): void {
    const fresh = interactionIds.filter(
      (id) => id && !this.hiddenScreenshots.has(id)
    );
    if (!fresh.length) return;
    this.history.record(this.capture());
    for (const id of fresh) this.hiddenScreenshots.add(id);
  }

  isScreenshotExcluded(interactionId: string): boolean {
    return this.hiddenScreenshots.has(interactionId);
  }

  /** 传入 undefined 或空白表示还原机器推导的默认文案。 */
  setStepDescription(interactionId: string, desc: string | undefined): void {
    const next = desc === undefined ? "" : oneLine(desc);
    const current = this.stepDescriptions[interactionId] ?? "";
    if (next === current) return;
    this.history.record(this.capture());
    if (next) this.stepDescriptions[interactionId] = next;
    else delete this.stepDescriptions[interactionId];
  }

  /**
   * patch 中值为 undefined 的键表示还原默认；
   * 若提供 defaults，与默认文本一致时自动清除覆写（无默认 expected 时删空不留脏状态）。
   */
  setTicketNarrative(
    patch: CustomTicketNarrative,
    defaults?: { actual?: string; expected?: string }
  ): void {
    const next: CustomTicketNarrative = { ...(this.narrative ?? {}) };
    for (const key of ["actual", "expected"] as const) {
      if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
      const raw = patch[key];
      if (raw === undefined) {
        delete next[key];
        continue;
      }
      const value = oneLine(raw);
      const defaultVal = defaults?.[key];
      if (defaultVal !== undefined && value === oneLine(defaultVal)) {
        delete next[key];
      } else if (key === "actual" && !value) {
        delete next.actual;
      } else {
        next[key] = value;
      }
    }
    const normalized = Object.keys(next).length ? next : undefined;
    if (JSON.stringify(normalized) === JSON.stringify(this.narrative)) return;
    this.history.record(this.capture());
    this.narrative = normalized;
  }

  /** 重置工单草稿：恢复被删步骤/报错/接口/截图并还原全部改写（不含问题现场）。 */
  resetTicketCuration(): void {
    if (!this.hasAnyCuration()) return;
    this.history.record(this.capture());
    this.excluded.interaction.clear();
    this.excluded.console.clear();
    this.excluded.network.clear();
    this.hiddenScreenshots.clear();
    this.stepDescriptions = {};
    this.narrative = undefined;
  }

  hasAnyCuration(): boolean {
    return (
      this.excluded.interaction.size > 0 ||
      this.excluded.console.size > 0 ||
      this.excluded.network.size > 0 ||
      this.hiddenScreenshots.size > 0 ||
      Object.keys(this.stepDescriptions).length > 0 ||
      this.narrative !== undefined
    );
  }

  ticketCuration(): TicketCuration {
    return {
      excludedScreenshotInteractionIds: new Set(this.hiddenScreenshots),
      customStepDescriptions: { ...this.stepDescriptions },
      customTicketNarrative: this.narrative ? { ...this.narrative } : undefined,
    };
  }

  excludedCount(kind: EvidenceKind): number {
    return this.excluded[kind].size;
  }
  totalExcluded(): number {
    return (
      this.excluded.interaction.size +
      this.excluded.console.size +
      this.excluded.network.size +
      this.excluded.issueScene.size
    );
  }

  includedInteractions(items: InteractionRecord[]): InteractionRecord[] {
    return items.filter((item) => !this.excluded.interaction.has(item.id));
  }

  includedConsoleEntries(items: ConsoleEntry[]): ConsoleEntry[] {
    return items.filter((item) => !this.excluded.console.has(item.id));
  }

  includedNetworkEntries(items: NetworkEntry[]): NetworkEntry[] {
    return items.filter((item) => !this.excluded.network.has(item.id));
  }

  includedIssueScenes<T extends IssueScene | { scene: IssueScene }>(
    items: T[]
  ): T[] {
    return items.filter(
      (item) =>
        !this.excluded.issueScene.has("scene" in item ? item.scene.id : item.id)
    );
  }

  toSelection(sessionId: string): ExportSelection {
    return {
      sessionId,
      excludedInteractionIds: [...this.excluded.interaction],
      excludedConsoleEntryIds: [...this.excluded.console],
      excludedNetworkEntryIds: [...this.excluded.network],
      excludedIssueSceneIds: [...this.excluded.issueScene],
      ...(this.hiddenScreenshots.size
        ? { excludedScreenshotInteractionIds: [...this.hiddenScreenshots] }
        : {}),
      ...(Object.keys(this.stepDescriptions).length
        ? { customStepDescriptions: { ...this.stepDescriptions } }
        : {}),
      ...(this.narrative
        ? { customTicketNarrative: { ...this.narrative } }
        : {}),
      updatedAtEpochMs: Date.now(),
    };
  }
}
