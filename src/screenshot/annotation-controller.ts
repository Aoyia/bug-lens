import type {
  AnnotationItem,
  RectBounds,
} from "../domain/screenshot-payload.ts";
import { clampPointToRect } from "./overlay-geometry.ts";
import {
  hitTestAnnotation as hitTestAnnotationInList,
  hitTestAnnotationHandle as hitTestAnnotationHandleOf,
} from "./annotation-renderer.ts";
import type { OverlayPhase } from "./overlay-state.ts";
import { UndoManager } from "./undo-manager.ts";

/** AnnotationController 所需的外部依赖（由组合根注入，无双向引用） */
export interface AnnotationControllerOptions {
  getSelection: () => RectBounds | null;
  getCurrentTool: () => string;
  /** 读取组合根状态机当前 phase */
  getPhase: () => OverlayPhase;
  /** 文本批注的浮动输入（组合根的 spawnInlineTextInput） */
  spawnInlineTextInput: (x: number, y: number, initialText?: string) => void;
  /** 重新渲染遮罩画布（组合根的 renderAnnotationsOnCanvas） */
  rerender: () => void;
}

/**
 * 批注域控制器：负责批注的绘制（rect/arrow/privacy/text）、命中选中、
 * 拖拽平移、Resize 手柄、删除、撤销与文本批注的二次编辑。
 * 不持有选区数据，也不直接操作 DOM 事件。
 */
export class AnnotationController {
  /** 已确认的批注列表（组合根渲染 / confirm 均依赖） */
  annotations: AnnotationItem[] = [];
  /** 正在绘制中的临时批注（组合根渲染读取） */
  activeTempAnnotation: AnnotationItem | null = null;
  /** 当前选中的批注（组合根渲染读取） */
  selectedAnnotation: AnnotationItem | null = null;

  private startPoint: { x: number; y: number } | null = null;

  private draggedAnnotation: AnnotationItem | null = null;
  private dragStartPoint: { x: number; y: number } | null = null;
  private activeResizeHandle: string | null = null;

  private readonly undoManager = new UndoManager();

  private readonly getSelection: () => RectBounds | null;
  private readonly getCurrentTool: () => string;
  private readonly getPhase: () => OverlayPhase;
  private readonly spawnInlineTextInput: (
    x: number,
    y: number,
    initialText?: string
  ) => void;
  private readonly rerender: () => void;

  constructor(options: AnnotationControllerOptions) {
    this.getSelection = options.getSelection;
    this.getCurrentTool = options.getCurrentTool;
    this.getPhase = options.getPhase;
    this.spawnInlineTextInput = options.spawnInlineTextInput;
    this.rerender = options.rerender;
  }

  /** 第 2 步：批注命中（手柄/删除按钮 → 整体 → 清空选中 → 绘制启动）；返回意图供组合根驱动转移 */
  onMouseDown(
    e: MouseEvent
  ): "delete" | "resize" | "drag" | "draw" | "text-edit" | null {
    // 1. 优先检测是否击中了当前选中批注框的 Resize 控制点或删除按钮
    const handleHit = this.hitTestAnnotationHandle(e.clientX, e.clientY);
    if (handleHit) {
      if (handleHit.handle === "delete") {
        this.deleteSelectedAnnotation();
        return "delete";
      }
      this.saveUndoState();
      this.activeResizeHandle = handleHit.handle;
      this.selectedAnnotation = handleHit.ann;
      this.dragStartPoint = { x: e.clientX, y: e.clientY };
      return "resize";
    }

    // 2. 次之检测是否点击了已有批注元素整体（选中并准备平移）
    const hit = this.hitTestAnnotation(e.clientX, e.clientY);
    if (hit) {
      // 无论当前处于什么工具模式，只要再次点击/双击已选中的文本批注，均可触发二次编辑
      if (hit.type === "text" && this.selectedAnnotation?.id === hit.id) {
        const pos = hit.position;
        this.spawnInlineTextInput(pos.x, pos.y, hit.text);
        // 移除原有的文本批注，准备替代
        this.annotations = this.annotations.filter((a) => a.id !== hit.id);
        this.selectedAnnotation = null;
        this.rerender();
        return "text-edit";
      }

      this.selectedAnnotation = hit;
      this.rerender();
      this.saveUndoState();
      this.draggedAnnotation = hit;
      this.dragStartPoint = { x: e.clientX, y: e.clientY };
      return "drag";
    } else if (this.selectedAnnotation) {
      this.selectedAnnotation = null;
      this.rerender();
    }

    // 3. 非 select 工具且已拉框：允许点击拖拽已选中批注；未选中批注才触发画图
    if (this.getCurrentTool() !== "select") {
      const selection = this.getSelection();
      if (selection) {
        this.startPoint = clampPointToRect(
          { x: e.clientX, y: e.clientY },
          selection
        );
        return "draw";
      }
    }

    return null;
  }

  /** mousemove：批注手柄缩放 → 批注拖拽平移 → 绘制临时批注；返回是否已消费事件 */
  onMouseMove(e: MouseEvent): boolean {
    if (
      this.getPhase() === "resizing-annotation" &&
      this.selectedAnnotation &&
      this.dragStartPoint &&
      this.activeResizeHandle
    ) {
      const dx = e.clientX - this.dragStartPoint.x;
      const dy = e.clientY - this.dragStartPoint.y;
      this.dragStartPoint = { x: e.clientX, y: e.clientY };

      const ann = this.selectedAnnotation;
      const handle = this.activeResizeHandle;

      if (ann.type === "rect" || ann.type === "privacy") {
        let { x, y, width, height } = ann.bounds;
        if (handle === "nw") {
          x += dx;
          width -= dx;
          y += dy;
          height -= dy;
        } else if (handle === "ne") {
          width += dx;
          y += dy;
          height -= dy;
        } else if (handle === "se") {
          width += dx;
          height += dy;
        } else if (handle === "sw") {
          x += dx;
          width -= dx;
          height += dy;
        }
        if (width > 10 && height > 10) {
          ann.bounds = { x, y, width, height };
        }
      } else if (ann.type === "arrow") {
        const selection = this.getSelection();
        const clampTo = (p: { x: number; y: number }) =>
          selection ? clampPointToRect(p, selection) : p;
        if (handle === "start") {
          ann.startPoint = clampTo({
            x: ann.startPoint.x + dx,
            y: ann.startPoint.y + dy,
          });
        } else if (handle === "end") {
          ann.endPoint = clampTo({
            x: ann.endPoint.x + dx,
            y: ann.endPoint.y + dy,
          });
        }
      }

      this.rerender();
      return true;
    }

    // 拖拽平移已选中的批注
    if (
      this.getPhase() === "dragging-annotation" &&
      this.draggedAnnotation &&
      this.dragStartPoint
    ) {
      const dx = e.clientX - this.dragStartPoint.x;
      const dy = e.clientY - this.dragStartPoint.y;
      this.dragStartPoint = { x: e.clientX, y: e.clientY };

      const ann = this.draggedAnnotation;
      if (ann.type === "rect" || ann.type === "privacy") {
        ann.bounds.x += dx;
        ann.bounds.y += dy;
      } else if (ann.type === "text") {
        ann.position.x += dx;
        ann.position.y += dy;
      } else if (ann.type === "arrow") {
        ann.startPoint.x += dx;
        ann.startPoint.y += dy;
        ann.endPoint.x += dx;
        ann.endPoint.y += dy;
      }

      this.rerender();
      return true;
    }

    // 在拉框选区内绘制批注（临时标注）
    if (this.getPhase() === "drawing" && this.startPoint) {
      const selection = this.getSelection();
      if (selection) {
        const currentPoint = clampPointToRect(
          { x: e.clientX, y: e.clientY },
          selection
        );

        if (this.getCurrentTool() === "rect") {
          this.activeTempAnnotation = {
            id: `ann_${Date.now()}`,
            type: "rect",
            bounds: {
              x: Math.min(this.startPoint.x, currentPoint.x),
              y: Math.min(this.startPoint.y, currentPoint.y),
              width: Math.abs(currentPoint.x - this.startPoint.x),
              height: Math.abs(currentPoint.y - this.startPoint.y),
            },
          };
        } else if (this.getCurrentTool() === "arrow") {
          this.activeTempAnnotation = {
            id: `ann_${Date.now()}`,
            type: "arrow",
            startPoint: this.startPoint,
            endPoint: currentPoint,
          };
        } else if (this.getCurrentTool() === "privacy") {
          this.activeTempAnnotation = {
            id: `ann_${Date.now()}`,
            type: "privacy",
            bounds: {
              x: Math.min(this.startPoint.x, currentPoint.x),
              y: Math.min(this.startPoint.y, currentPoint.y),
              width: Math.abs(currentPoint.x - this.startPoint.x),
              height: Math.abs(currentPoint.y - this.startPoint.y),
            },
          };
        }
        this.rerender();
      }
      return true;
    }

    return false;
  }

  /** mouseup：批注拖拽复位 → 手柄复位 → 绘制提交/text 输入唤起；返回意图供组合根驱动转移 */
  onMouseUp(
    e: MouseEvent
  ): "resize" | "drag" | "committed" | "spawned-text" | null {
    if (this.getPhase() === "dragging-annotation") {
      this.draggedAnnotation = null;
      this.dragStartPoint = null;
      return "drag";
    }

    if (this.getPhase() === "resizing-annotation") {
      this.activeResizeHandle = null;
      this.dragStartPoint = null;
      return "resize";
    }

    if (this.getPhase() === "drawing") {
      if (this.activeTempAnnotation) {
        this.saveUndoState();
        this.annotations.push(this.activeTempAnnotation);
        this.activeTempAnnotation = null;
      }
      const isText = this.getCurrentTool() === "text";
      if (isText) {
        const selection = this.getSelection();
        const textPos = selection
          ? clampPointToRect({ x: e.clientX, y: e.clientY }, selection)
          : { x: e.clientX, y: e.clientY };
        this.spawnInlineTextInput(textPos.x, textPos.y);
      }
      this.rerender();
      return isText ? "spawned-text" : "committed";
    }

    return null;
  }

  /** 追加一个已确认的批注（文本编辑器提交等场景） */
  addAnnotation(ann: AnnotationItem): void {
    this.annotations.push(ann);
  }

  /** 按 id 移除批注（不记录撤销，供文本二次编辑的临时移除使用） */
  removeAnnotationById(id: string): void {
    this.annotations = this.annotations.filter((a) => a.id !== id);
  }

  /** 删除当前选中批注（含撤销快照） */
  deleteSelectedAnnotation(): void {
    if (!this.selectedAnnotation) return;
    this.saveUndoState();
    const targetId = this.selectedAnnotation.id;
    this.annotations = this.annotations.filter((a) => a.id !== targetId);
    this.selectedAnnotation = null;
    this.rerender();
  }

  /** 保存撤销快照（深拷贝，上限 30 份）——委托给 UndoManager */
  saveUndoState(): void {
    this.undoManager.record(this.annotations);
  }

  /** 撤销：语义与旧实现完全一致（pop 优先 + 快照回退） */
  undo(): void {
    this.annotations = this.undoManager.undo(this.annotations);
    this.rerender();
  }

  /** 一键清空所有批注（工具栏 clear） */
  clear(): void {
    this.saveUndoState();
    this.annotations = [];
    this.selectedAnnotation = null;
    this.rerender();
  }

  /** 命中检测（供组合根双击编辑与鼠标路由使用） */
  hitTestAnnotation(x: number, y: number): AnnotationItem | null {
    return hitTestAnnotationInList(this.annotations, x, y);
  }

  private hitTestAnnotationHandle(
    x: number,
    y: number
  ): { ann: AnnotationItem; handle: string } | null {
    if (!this.selectedAnnotation) return null;
    return hitTestAnnotationHandleOf(this.selectedAnnotation, x, y);
  }

  /** 销毁/取消时复位全部批注域状态 */
  reset(): void {
    this.annotations = [];
    this.activeTempAnnotation = null;
    this.selectedAnnotation = null;
    this.startPoint = null;
    this.draggedAnnotation = null;
    this.dragStartPoint = null;
    this.activeResizeHandle = null;
    this.undoManager.reset();
  }
}
