/** 截图遮罩层的显式交互状态 */
export type OverlayPhase =
  | "idle"
  | "selecting"
  | "resizing-selection"
  | "dragging-selection"
  | "locked"
  | "drawing"
  | "dragging-annotation"
  | "resizing-annotation"
  | "editing-text";

/** 合法转移表：只允许从当前 phase 迁移到列出的目标 phase */
const TRANSITIONS: Record<OverlayPhase, readonly OverlayPhase[]> = {
  // idle：show() 后的初始预选态（全屏预选但未锁定），
  // 老实现允许直接绘制 / 直接拖选区手柄 / 重新拉框
  idle: ["selecting", "locked", "drawing", "resizing-selection"],
  selecting: ["locked"],
  "resizing-selection": ["locked"],
  "dragging-selection": ["locked"],
  locked: [
    "drawing",
    "dragging-annotation",
    "resizing-annotation",
    "editing-text",
    "resizing-selection",
    "dragging-selection",
  ],
  drawing: ["locked", "editing-text"],
  "dragging-annotation": ["locked"],
  "resizing-annotation": ["locked"],
  "editing-text": ["locked"],
};

/**
 * 交互状态机：唯一事实来源。
 * 非法转移会被拒绝（不改变当前 phase）并输出告警，避免系统进入坏状态。
 */
export class OverlayStateMachine {
  private _phase: OverlayPhase = "idle";

  get phase(): OverlayPhase {
    return this._phase;
  }

  can(next: OverlayPhase): boolean {
    return TRANSITIONS[this._phase].includes(next);
  }

  transition(next: OverlayPhase): void {
    if (this.can(next)) {
      this._phase = next;
    } else {
      console.error(`OverlayStateMachine: 非法转移 ${this._phase} -> ${next}`);
    }
  }

  reset(): void {
    this._phase = "idle";
  }
}
