import type { AnchorRectLike } from "./expected-capture-card";

/**
 * 标记问题流程的阶段：
 * idle →（点「标记问题」）selecting →（框选完成）card →（确认/跳过/超时）idle
 *
 * 顺序是产品契约：先指哪里不对（框选），再说哪儿不对（速记卡）。
 * 卡片锚点因此永远是选区 rect，而不是"最后一次交互元素"。
 */
export type MarkFlowPhase = "idle" | "selecting" | "card";

export type MarkFlowDeps<TSnapshot> = {
  /** 进入框选（overlay.open） */
  openOverlay(anchor?: { x: number; y: number }): void;
  /** 收起框选遮罩（取消时兜底调用，幂等） */
  closeOverlay(): void;
  /** 框选完成后贴着选区弹卡片 */
  openCard(anchorRect: AnchorRectLike, draft: string): void;
  /** 卡片取消时关闭卡片（卡片自身已关，幂等） */
  closeCard(): void;
  /** 卡片落定后继续截图采集（overlay.capture） */
  capture(snapshot: TSnapshot): void;
  /** 整条标记取消：清理 pending 并复位标记按钮 */
  onCancel(): void;
};

/**
 * 标记流程顺序状态机。只负责"谁先谁后 + 取消语义"，不碰 DOM，
 * 便于用 mock 断言调用序列（overlay 先于 card）。
 */
export class MarkFlow<TSnapshot> {
  private phase: MarkFlowPhase = "idle";
  private pendingSnapshot: TSnapshot | undefined;

  constructor(private readonly deps: MarkFlowDeps<TSnapshot>) {}

  get currentPhase(): MarkFlowPhase {
    return this.phase;
  }

  /** 流程进行中（框选或卡片）：用于入口幂等守卫 */
  get isBusy(): boolean {
    return this.phase !== "idle";
  }

  /** 待截图快照：仅 card 阶段存在 */
  get snapshot(): TSnapshot | undefined {
    return this.pendingSnapshot;
  }

  /** 点「标记问题」：直接进入框选，不弹卡片 */
  begin(anchor?: { x: number; y: number }): void {
    if (this.phase !== "idle") return;
    this.phase = "selecting";
    this.pendingSnapshot = undefined;
    this.deps.openOverlay(anchor);
  }

  /**
   * 框选完成：携带选区 rect 打开卡片。
   * 只在 selecting 阶段生效，避免重复完成（回车 + 点击）二次弹卡。
   */
  selectionReady(
    snapshot: TSnapshot,
    anchorRect: AnchorRectLike,
    draft: string
  ): void {
    if (this.phase !== "selecting") return;
    this.phase = "card";
    this.pendingSnapshot = snapshot;
    this.deps.openCard(anchorRect, draft);
  }

  /** 卡片确认/跳过/超时：带快照继续截图，交由 overlay.capture */
  resolveCard(): TSnapshot | undefined {
    if (this.phase !== "card") return undefined;
    const snapshot = this.pendingSnapshot;
    this.phase = "idle";
    this.pendingSnapshot = undefined;
    if (snapshot) this.deps.capture(snapshot);
    return snapshot;
  }

  /**
   * 取消整条标记：
   * - selecting 阶段（ESC / 取消按钮）：关遮罩，不弹卡片；
   * - card 阶段（ESC / 取消）：关卡片，不再截图。
   * 两种都清空 pending，避免残留状态污染下一次标记。
   */
  cancel(): void {
    if (this.phase === "idle") return;
    const phase = this.phase;
    this.phase = "idle";
    this.pendingSnapshot = undefined;
    if (phase === "selecting") this.deps.closeOverlay();
    if (phase === "card") this.deps.closeCard();
    this.deps.onCancel();
  }

  /** 截图完成/失败后复位（幂等），不触发任何 UI 副作用 */
  reset(): void {
    this.phase = "idle";
    this.pendingSnapshot = undefined;
  }
}
