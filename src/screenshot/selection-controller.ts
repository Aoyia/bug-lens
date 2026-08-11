import type {
  AnnotationItem,
  RectBounds,
} from "../domain/screenshot-payload.ts";
import {
  clampPointToRect,
  computeDraggedPosition,
  computeResizedRect,
  pointInRect,
} from "./overlay-geometry.ts";
import type { OverlayPhase } from "./overlay-state.ts";

/** 选区内部拖拽的防误触阈值（px）：位移不足时视为单击，不移动选区框 */
const DRAG_THRESHOLD_PX = 5;

/** SelectionController 所需的外部依赖（由组合根注入，无双向引用） */
export interface SelectionControllerOptions {
  getShadowRoot: () => ShadowRoot | null;
  /** 选区整体平移时需同步平移已存在的批注（返回数组引用，原地修改） */
  getAnnotations: () => AnnotationItem[];
  getCurrentTool: () => string;
  /** 读取组合根状态机当前 phase */
  getPhase: () => OverlayPhase;
  /** 重新渲染遮罩画布（组合根的 renderAnnotationsOnCanvas） */
  rerender: () => void;
}

/**
 * 选区域控制器：负责截图框的建立（拉框）、8 点 Resize、整体拖拽平移、
 * 锁定、智能吸附与选区 UI 渲染。不持有任何批注数据，也不直接操作 DOM 事件。
 */
export class SelectionController {
  /** 当前截图选区（组合根 confirm / 渲染 / magnifier 隐藏判定均依赖） */
  selection: RectBounds | null = null;
  /** 选区是否已锁定（测试与组合根均直接读取） */
  isSelectionLocked = false;

  /** 是否正在拉框（由状态机 phase 派生，测试读取的字段名保持不变） */
  get isSelecting(): boolean {
    return this.getPhase() === "selecting";
  }

  /** 是否正在拉伸选区手柄（由状态机 phase 派生） */
  get isResizing(): boolean {
    return this.getPhase() === "resizing-selection";
  }

  /** 是否正在整体平移截图框（由状态机 phase 派生） */
  get isDraggingSelectionBox(): boolean {
    return this.getPhase() === "dragging-selection";
  }

  private dragBoxStartPoint: { x: number; y: number } | null = null;
  private activeHandle: string | null = null;
  private resizeStartPoint: { x: number; y: number } | null = null;
  private initialSelection: RectBounds | null = null;
  private startPoint: { x: number; y: number } | null = null;
  private snappedElement: Element | null = null;

  private readonly getShadowRoot: () => ShadowRoot | null;
  private readonly getAnnotations: () => AnnotationItem[];
  private readonly getCurrentTool: () => string;
  private readonly getPhase: () => OverlayPhase;
  private readonly rerender: () => void;

  constructor(options: SelectionControllerOptions) {
    this.getShadowRoot = options.getShadowRoot;
    this.getAnnotations = options.getAnnotations;
    this.getCurrentTool = options.getCurrentTool;
    this.getPhase = options.getPhase;
    this.rerender = options.rerender;
  }

  /** 拉框 / 平移框是否处于活动状态（组合根用于放大镜隐藏判定） */
  get isActiveInteraction(): boolean {
    return this.isSelecting || this.isResizing;
  }

  /** 第 1 步：选区 8 点手柄命中 → 启动 Resize（优先于批注命中，与原逻辑顺序一致） */
  onMouseDown(e: MouseEvent): boolean {
    const target = e.target as HTMLElement;
    const handleEl = target.closest<HTMLElement>(".handle");
    if (handleEl && this.selection) {
      this.activeHandle = handleEl.dataset.handle || null;
      this.resizeStartPoint = { x: e.clientX, y: e.clientY };
      this.initialSelection = { ...this.selection };
      return true;
    }
    return false;
  }

  /** 第 3 步：select 工具下的兜底分支 —— 未命中批注时拉框或平移截图框 */
  onSelectOrDrag(e: MouseEvent): "selecting" | "dragging-selection" | null {
    if (this.getCurrentTool() !== "select") return null;

    // 排除遮罩 UI 元素（工具栏 / 尺寸角标），避免点击工具按钮误移动选区
    const target = e.target as HTMLElement;
    if (target && target.closest(".toolbar, .size-badge")) return null;

    if (!this.isSelectionLocked) {
      this.startPoint = { x: e.clientX, y: e.clientY };
      return "selecting";
    } else if (this.selection) {
      // 命中选区内部或边缘均可整体平移（内部自由拖拽；移动阶段带 5px 防误触阈值）
      if (pointInRect(e.clientX, e.clientY, this.selection)) {
        this.dragBoxStartPoint = { x: e.clientX, y: e.clientY };
        this.initialSelection = { ...this.selection };
        return "dragging-selection";
      }
    }
    return null;
  }

  /** mousemove：Resize → 锁定光标 → 整体平移 → 拉框/吸附；返回是否已消费事件 */
  onMouseMove(e: MouseEvent): boolean {
    // 8 点 Resize 微调拉伸
    if (
      this.isResizing &&
      this.resizeStartPoint &&
      this.initialSelection &&
      this.activeHandle
    ) {
      const dx = e.clientX - this.resizeStartPoint.x;
      const dy = e.clientY - this.resizeStartPoint.y;

      this.selection = computeResizedRect(
        this.activeHandle,
        this.initialSelection,
        dx,
        dy
      );
      this.renderSelectionBox();
      return true;
    }

    // 锁定后悬停提示：选区内部与边缘均可拖拽平移，统一显示 move 光标
    if (
      this.getCurrentTool() === "select" &&
      this.isSelectionLocked &&
      this.selection
    ) {
      const shadowRoot = this.getShadowRoot();
      if (shadowRoot) {
        const box = shadowRoot.querySelector<HTMLDivElement>(".selection-box");
        if (box) {
          box.style.cursor = pointInRect(e.clientX, e.clientY, this.selection)
            ? "move"
            : "crosshair";
        }
      }
    }

    // 整体平移拖拽截图框（批注同步平移；位移 < 5px 视为单击防误触）
    if (
      this.isDraggingSelectionBox &&
      this.dragBoxStartPoint &&
      this.initialSelection
    ) {
      const dx = e.clientX - this.dragBoxStartPoint.x;
      const dy = e.clientY - this.dragBoxStartPoint.y;

      // 防误触阈值：按下后位移不足 5px 不移动选区框（纯单击框纹丝不动）
      if (
        Math.abs(dx) < DRAG_THRESHOLD_PX &&
        Math.abs(dy) < DRAG_THRESHOLD_PX
      ) {
        return true;
      }

      const newPos = computeDraggedPosition(this.initialSelection, dx, dy);
      const newX = newPos.x;
      const newY = newPos.y;

      if (this.selection) {
        const frameDx = newX - this.selection.x;
        const frameDy = newY - this.selection.y;

        if (frameDx !== 0 || frameDy !== 0) {
          this.selection = {
            x: newX,
            y: newY,
            width: this.initialSelection.width,
            height: this.initialSelection.height,
          };

          // 同步平移已有的批注内容
          for (const ann of this.getAnnotations()) {
            if (ann.type === "rect" || ann.type === "privacy") {
              ann.bounds.x += frameDx;
              ann.bounds.y += frameDy;
            } else if (ann.type === "text") {
              ann.position.x += frameDx;
              ann.position.y += frameDy;
            } else if (ann.type === "arrow") {
              ann.startPoint.x += frameDx;
              ann.startPoint.y += frameDy;
              ann.endPoint.x += frameDx;
              ann.endPoint.y += frameDy;
            }
          }

          this.renderSelectionBox();
          this.rerender();
        }
      }
      return true;
    }

    // 拉框建立选区；未拉框前显示 DOM 智能吸附框
    if (this.isSelecting && this.startPoint) {
      const x = Math.min(this.startPoint.x, e.clientX);
      const y = Math.min(this.startPoint.y, e.clientY);
      const width = Math.abs(e.clientX - this.startPoint.x);
      const height = Math.abs(e.clientY - this.startPoint.y);

      this.selection = { x, y, width, height };
      this.renderSelectionBox();
    } else if (!this.selection) {
      this.renderSnapBox(e.clientX, e.clientY);
    }

    return false;
  }

  /** mouseup：Resize 复位 → 平移复位 → 拉框完成并锁定选区；返回是否已消费事件 */
  onMouseUp(e: MouseEvent): boolean {
    if (this.isResizing) {
      this.activeHandle = null;
      this.resizeStartPoint = null;
      this.initialSelection = null;
      return true;
    }

    if (this.isDraggingSelectionBox) {
      this.dragBoxStartPoint = null;
      this.initialSelection = null;
      return true;
    }

    if (this.isSelecting) {
      const isClickOnly =
        this.startPoint &&
        Math.abs(e.clientX - this.startPoint.x) < 5 &&
        Math.abs(e.clientY - this.startPoint.y) < 5;

      // 如果是单击且命中智能吸附元素，一键全选该 DOM 元素！
      if (isClickOnly && this.snappedElement) {
        const rect = this.snappedElement.getBoundingClientRect();
        this.selection = {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      } else if (
        this.selection &&
        (this.selection.width < 10 || this.selection.height < 10)
      ) {
        this.selection = {
          x: 0,
          y: 0,
          width: window.innerWidth,
          height: window.innerHeight,
        };
      }

      // 隐藏智能吸附框
      const shadowRoot = this.getShadowRoot();
      if (shadowRoot) {
        const snapBox = shadowRoot.querySelector<HTMLDivElement>(".snap-box");
        if (snapBox) snapBox.style.display = "none";
      }

      this.isSelectionLocked = true;
      this.renderSelectionBox();
      return true;
    }

    return false;
  }

  /** 渲染选区框（位置/尺寸/尺寸角标/工具栏自适应定位），随后重绘遮罩画布 */
  renderSelectionBox(): void {
    const shadowRoot = this.getShadowRoot();
    if (!shadowRoot) return;
    const box = shadowRoot.querySelector<HTMLDivElement>(".selection-box");
    const badge = shadowRoot.querySelector<HTMLDivElement>(".size-badge");
    const toolbar = shadowRoot.querySelector<HTMLDivElement>(".toolbar");

    if (box && this.selection) {
      box.style.display = "block";
      box.style.left = `${this.selection.x}px`;
      box.style.top = `${this.selection.y}px`;
      box.style.width = `${this.selection.width}px`;
      box.style.height = `${this.selection.height}px`;

      if (badge) {
        badge.textContent = `${Math.round(this.selection.width)} x ${Math.round(this.selection.height)}`;
        if (this.selection.y < 30) {
          badge.style.top = "6px";
          badge.style.left = "6px";
        } else {
          badge.style.top = "-28px";
          badge.style.left = "0px";
        }
      }

      // 工具栏框内/框外自适应定位逻辑
      if (toolbar) {
        const bottomSpace =
          window.innerHeight - (this.selection.y + this.selection.height);
        const topSpace = this.selection.y;

        // 当选区底部空间不足 60px 时（如默认全屏框选）
        if (bottomSpace < 60) {
          if (topSpace >= 60) {
            // 外挂：如果顶部空间充足，显示在选区外侧上方
            toolbar.style.top = "-48px";
            toolbar.style.bottom = "auto";
            toolbar.style.right = "0px";
          } else {
            // 内嵌：如果上下均挤压（如全屏），直接贴合在选区框内部右下角
            toolbar.style.top = "auto";
            toolbar.style.bottom = "16px";
            toolbar.style.right = "16px";
          }
        } else {
          // 外挂：常规局部选区显示在选区外侧下方
          toolbar.style.top = "auto";
          toolbar.style.bottom = "-48px";
          toolbar.style.right = "0px";
        }
      }
    }

    // 重新触发 Mask 画布渲染与选区 clearRect 擦除镂空
    this.rerender();
  }

  /** 未拉框状态下的 DOM 控件智能吸附框 */
  renderSnapBox(x: number, y: number): void {
    const shadowRoot = this.getShadowRoot();
    if (!shadowRoot || this.selection) return;
    const snapBox = shadowRoot.querySelector<HTMLDivElement>(".snap-box");
    if (!snapBox) return;

    // 隐藏宿主自己的 DOM
    const el = document.elementFromPoint(x, y);
    if (
      !el ||
      el === document.body ||
      el === document.documentElement ||
      el.closest("#bug-lens-screenshot-host")
    ) {
      snapBox.style.display = "none";
      this.snappedElement = null;
      return;
    }

    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      this.snappedElement = el;
      snapBox.style.display = "block";
      snapBox.style.left = `${rect.left}px`;
      snapBox.style.top = `${rect.top}px`;
      snapBox.style.width = `${rect.width}px`;
      snapBox.style.height = `${rect.height}px`;
    } else {
      snapBox.style.display = "none";
      this.snappedElement = null;
    }
  }

  /** 将点限制在当前选区范围内 */
  clampPointToSelection(p: { x: number; y: number }): {
    x: number;
    y: number;
  } {
    if (!this.selection) return p;
    return clampPointToRect(p, this.selection);
  }

  /** 销毁/取消时复位全部选区域状态 */
  reset(): void {
    this.selection = null;
    this.isSelectionLocked = false;
    this.dragBoxStartPoint = null;
    this.activeHandle = null;
    this.resizeStartPoint = null;
    this.initialSelection = null;
    this.startPoint = null;
    this.snappedElement = null;
  }
}
