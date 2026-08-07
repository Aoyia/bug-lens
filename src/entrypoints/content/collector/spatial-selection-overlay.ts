import {
  SpatialTemporalSnapshotBuilder,
  type SpatialTemporalCutResult,
} from "./spatial-temporal-builder";
import { type BoundingBox } from "./spatial-pruner";
import { t } from "../../../shared/i18n.ts";

export type SpatialSelectionOverlayCallbacks = {
  onComplete(result: SpatialTemporalCutResult, markdown: string): void;
  onCancel(): void;
};

/**
 * 空间-时间因果切片拉框蒙层组件
 * 允许用户在页面上拖拽选择矩形区域并自动完成空间与时间数据的双重抽取
 */
export class SpatialSelectionOverlay {
  private active = false;
  private layer: HTMLDivElement | undefined;
  private startX = 0;
  private startY = 0;
  private isDragging = false;
  private selectionBox: HTMLDivElement | undefined;
  private escapeListener: ((e: KeyboardEvent) => void) | undefined;

  constructor(private readonly callbacks: SpatialSelectionOverlayCallbacks) {}

  public get isActive(): boolean {
    return this.active;
  }

  public open(): void {
    if (this.active) return;
    this.active = true;

    // 创建全屏蒙层
    const layer = document.createElement("div");
    layer.id = "__spatial_selection_overlay__";
    Object.assign(layer.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      cursor: "crosshair",
      background: "rgba(0, 0, 0, 0.2)",
      userSelect: "none",
    });

    // 提示条
    const hint = document.createElement("div");
    hint.textContent = t("dragHint");
    Object.assign(hint.style, {
      position: "fixed",
      top: "20px",
      left: "50%",
      transform: "translateX(-50%)",
      background: "#165dff",
      color: "#ffffff",
      padding: "8px 18px",
      borderRadius: "20px",
      fontSize: "14px",
      fontWeight: "600",
      boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
      pointerEvents: "none",
      zIndex: "10",
    });
    layer.appendChild(hint);

    // 矩形选框
    const boxEl = document.createElement("div");
    Object.assign(boxEl.style, {
      position: "fixed",
      border: "2px dashed #165dff",
      background: "rgba(22, 93, 255, 0.15)",
      display: "none",
      pointerEvents: "none",
      zIndex: "5",
    });
    layer.appendChild(boxEl);
    this.selectionBox = boxEl;

    // 鼠标事件
    layer.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      this.isDragging = true;
      this.startX = e.clientX;
      this.startY = e.clientY;
      Object.assign(boxEl.style, {
        display: "block",
        left: `${this.startX}px`,
        top: `${this.startY}px`,
        width: "0px",
        height: "0px",
      });
    });

    layer.addEventListener("pointermove", (e) => {
      if (!this.isDragging) return;
      const currentX = e.clientX;
      const currentY = e.clientY;
      const left = Math.min(this.startX, currentX);
      const top = Math.min(this.startY, currentY);
      const width = Math.abs(currentX - this.startX);
      const height = Math.abs(currentY - this.startY);

      Object.assign(boxEl.style, {
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
      });
    });

    layer.addEventListener("pointerup", (e) => {
      if (!this.isDragging) return;
      this.isDragging = false;

      const currentX = e.clientX;
      const currentY = e.clientY;
      const left = Math.min(this.startX, currentX);
      const top = Math.min(this.startY, currentY);
      const width = Math.abs(currentX - this.startX);
      const height = Math.abs(currentY - this.startY);

      // 如果选框太小（点击而非拖拽），按默认 200x200 矩形中心生成
      const box: BoundingBox =
        width > 10 && height > 10
          ? { x: left, y: top, width, height }
          : {
              x: Math.max(0, left - 100),
              y: Math.max(0, top - 100),
              width: 200,
              height: 200,
            };

      this.finish(box);
    });

    // Esc 按键
    this.escapeListener = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        this.close();
        this.callbacks.onCancel();
      }
    };
    window.addEventListener("keydown", this.escapeListener, true);

    document.documentElement.appendChild(layer);
    this.layer = layer;
  }

  public close(): void {
    if (!this.active) return;
    this.active = false;
    if (this.escapeListener) {
      window.removeEventListener("keydown", this.escapeListener, true);
    }
    this.layer?.remove();
    this.layer = undefined;
  }

  private finish(box: BoundingBox): void {
    this.close();
    const snapshot = SpatialTemporalSnapshotBuilder.buildSnapshot(box);
    const markdown = SpatialTemporalSnapshotBuilder.formatToMarkdown(snapshot);
    this.callbacks.onComplete(snapshot, markdown);
  }
}
