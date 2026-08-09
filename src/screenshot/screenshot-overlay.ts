import type {
  AIScreenshotPayload,
  AnnotationItem,
  RectBounds,
} from "../domain/screenshot-payload.ts";
import { processScreenshot } from "./screenshot-processor.ts";
import { t } from "../shared/i18n.ts";

/**
 * 截图完成后的 toast 文案：根据 ZIP 是否已注入本地绝对路径区分提示。
 */
export function buildScreenshotToastMessage(
  promptInjectedWithPath: boolean
): string {
  return promptInjectedWithPath
    ? t("screenshotToastWithPath")
    : t("screenshotToastWithoutPath");
}

export class ScreenshotOverlay {
  private container: HTMLDivElement | null = null;
  private shadowRoot: ShadowRoot | null = null;
  private isSelecting = false;
  private isDrawingTool = false;

  private selection: RectBounds | null = null;
  private startPoint: { x: number; y: number } | null = null;
  private currentTool: "select" | "rect" | "arrow" | "privacy" | "text" =
    "select";

  private annotations: AnnotationItem[] = [];
  private activeTempAnnotation: AnnotationItem | null = null;

  private isResizing = false;
  private activeHandle: string | null = null;
  private resizeStartPoint: { x: number; y: number } | null = null;
  private initialSelection: RectBounds | null = null;
  private isSelectionLocked = false;
  private styleAdjustmentMode = false;

  private snappedElement: Element | null = null;
  private viewportImage: HTMLImageElement | null = null;
  private cachedViewportDataUrl = "";

  private onCompleteCallback?: (payload: AIScreenshotPayload) => void;
  private onCancelCallback?: () => void;

  private undoStack: AnnotationItem[][] = [];
  private draggedAnnotation: AnnotationItem | null = null;
  private isDraggingAnnotation = false;
  private dragStartPoint: { x: number; y: number } | null = null;
  private selectedAnnotation: AnnotationItem | null = null;
  private activeResizeHandle: string | null = null;
  private isResizingAnnotationHandle = false;

  constructor() {
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handlePreventScroll = this.handlePreventScroll.bind(this);
    this.handleMouseDown = this.handleMouseDown.bind(this);
    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.handleMouseUp = this.handleMouseUp.bind(this);
    this.handleDoubleClick = this.handleDoubleClick.bind(this);
  }

  private handlePreventScroll(e: Event): void {
    if (e.type === "keydown") {
      const ke = e as KeyboardEvent;
      const scrollKeys = [
        " ",
        "Space",
        "PageUp",
        "PageDown",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
      ];
      if (scrollKeys.includes(ke.key)) {
        const target = ke.target as HTMLElement;
        if (
          target &&
          (target.tagName === "INPUT" || target.tagName === "TEXTAREA")
        ) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
      }
    } else {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  show(options: {
    viewportDataUrl: string;
    onComplete: (payload: any) => void;
    onCancel?: () => void;
  }): void {
    this.cachedViewportDataUrl = options.viewportDataUrl;
    this.onCompleteCallback = options.onComplete;
    this.onCancelCallback = options.onCancel;

    if (this.container) this.destroy();

    // 预载原图用于 Magnifier 离屏切片
    const img = new Image();
    img.src = options.viewportDataUrl;
    img.onload = () => {
      this.viewportImage = img;
    };

    // 0. 清理已有的旧 Host 节点，防止重复 DOM 叠加产生多重工具栏
    const oldHost = document.getElementById("bug-lens-screenshot-host");
    if (oldHost && oldHost.parentElement) {
      oldHost.parentElement.removeChild(oldHost);
    }
    if (this.container) {
      this.destroy();
    }

    // 1. 创建宿主 Container 与 Shadow DOM
    this.container = document.createElement("div");
    this.container.id = "bug-lens-screenshot-host";
    this.container.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      z-index: 2147483647;
      user-select: none;
      cursor: crosshair;
    `;

    this.shadowRoot = this.container.attachShadow({ mode: "closed" });

    // 2. 注入 UI HTML 与 隔离 CSS
    const wrapper = document.createElement("div");
    wrapper.className = "overlay-wrapper";
    wrapper.innerHTML = `
      <style>
        .overlay-wrapper {
          position: absolute;
          inset: 0;
          background: transparent;
          overflow: hidden;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        .selection-box {
          position: absolute;
          border: 2px solid #007aff;
          cursor: move;
          pointer-events: auto;
        }
        /* 8点 Resize 手柄 */
        .handle {
          position: absolute;
          width: 8px;
          height: 8px;
          background: #ffffff;
          border: 1.5px solid #007aff;
          border-radius: 50%;
          box-sizing: border-box;
          z-index: 12;
        }
        .handle.nw { top: -4px; left: -4px; cursor: nwse-resize; }
        .handle.n  { top: -4px; left: calc(50% - 4px); cursor: ns-resize; }
        .handle.ne { top: -4px; right: -4px; cursor: nesw-resize; }
        .handle.e  { top: calc(50% - 4px); right: -4px; cursor: ew-resize; }
        .handle.se { bottom: -4px; right: -4px; cursor: nwse-resize; }
        .handle.s  { bottom: -4px; left: calc(50% - 4px); cursor: ns-resize; }
        .handle.sw { bottom: -4px; left: -4px; cursor: nesw-resize; }
        .handle.w  { top: calc(50% - 4px); left: -4px; cursor: ew-resize; }

        /* 即时 Toast 提示 */
        .toast-box {
          position: fixed;
          top: 40%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: rgba(15, 23, 42, 0.92);
          color: #38bdf8;
          border: 1px solid #0284c7;
          padding: 12px 24px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          box-shadow: 0 20px 30px rgba(0,0,0,0.5);
          pointer-events: none;
          z-index: 9999;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .snap-box {
          position: absolute;
          border: 2px dashed #10b981;
          background: rgba(16, 185, 129, 0.1);
          pointer-events: none;
          transition: all 0.08s ease;
          z-index: 5;
        }
        .magnifier-box {
          position: absolute;
          width: 130px;
          background: #0f172a;
          border: 2px solid #38bdf8;
          border-radius: 8px;
          box-shadow: 0 10px 25px rgba(0,0,0,0.5);
          pointer-events: none;
          overflow: hidden;
          z-index: 20;
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        .magnifier-canvas {
          width: 130px;
          height: 100px;
          background: #000;
        }
        .magnifier-info {
          width: 100%;
          background: #1e293b;
          color: #f8fafc;
          font-size: 11px;
          padding: 4px 6px;
          box-sizing: border-box;
          text-align: center;
          line-height: 1.4;
          font-family: monospace;
        }
        .size-badge {
          position: absolute;
          top: -26px;
          left: 0;
          background: rgba(35, 35, 35, 0.95);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          color: #ffffff;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          font-size: 11px;
          font-weight: 500;
          padding: 2px 6px;
          border-radius: 3px;
          white-space: nowrap;
          pointer-events: none;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
          transition: all 0.1s ease;
        }
        .toolbar {
          position: absolute;
          display: flex;
          align-items: center;
          gap: 2px;
          background: rgba(35, 35, 35, 0.95);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          padding: 4px 6px;
          border-radius: 6px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
          user-select: none;
          z-index: 10;
        }
        .toolbar .divider {
          width: 1px;
          height: 14px;
          background: rgba(255, 255, 255, 0.12);
          margin: 0 4px;
        }
        .toolbar button {
          background: transparent;
          border: none;
          color: #d8d8d8;
          width: 28px;
          height: 28px;
          border-radius: 4px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.12s ease;
          outline: none;
          padding: 0;
        }
        .toolbar button:hover {
          background: rgba(255, 255, 255, 0.12);
          color: #ffffff;
        }
        .toolbar button.active {
          background: rgba(250, 82, 82, 0.2);
          color: #FA5252;
        }
        .toolbar button.cancel-btn:hover {
          background: rgba(239, 68, 68, 0.25);
          color: #ef4444;
        }
        .toolbar button.confirm-btn {
          background: #07c160;
          color: #ffffff;
          width: 32px;
          height: 28px;
          border-radius: 4px;
          box-shadow: 0 2px 6px rgba(7, 193, 96, 0.3);
        }
        .toolbar button.confirm-btn:hover {
          background: #06ad56;
        }
        .canvas-layer {
          position: absolute;
          inset: 0;
          pointer-events: none;
        }
      </style>
      <canvas class="canvas-layer"></canvas>
      <div class="snap-box" style="display: none;"></div>
      <div class="magnifier-box" style="display: none;">
        <canvas class="magnifier-canvas" width="130" height="100"></canvas>
        <div class="magnifier-info">
          <div class="mag-color">#FFFFFF</div>
          <div class="mag-pos">X: 0, Y: 0</div>
          <div class="mag-tag" style="color: #38bdf8; font-weight: bold;"></div>
        </div>
      </div>
      <div class="selection-box" style="display: none;">
        <div class="size-badge">0 x 0</div>
        <div class="handle nw" data-handle="nw"></div>
        <div class="handle n" data-handle="n"></div>
        <div class="handle ne" data-handle="ne"></div>
        <div class="handle e" data-handle="e"></div>
        <div class="handle se" data-handle="se"></div>
        <div class="handle s" data-handle="s"></div>
        <div class="handle sw" data-handle="sw"></div>
        <div class="handle w" data-handle="w"></div>
        <div class="toolbar">
          <button data-tool="rect" title="${t("shotRect")}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
          </button>
          <button data-tool="arrow" title="${t("shotArrow")}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="5" y1="19" x2="19" y2="5"/><polyline points="12 5 19 5 19 12"/></svg>
          </button>
          <button data-tool="privacy" title="${t("shotPrivacy")}">
            <svg width="15" height="15" viewBox="0 0 1024 1024" fill="currentColor">
              <path d="M7.13007408 512v252.43496297h252.43496295V512H7.13007408z m252.43496295 504.86992592H512v-252.43496295H259.56503703v252.43496295z m757.30488889 0v-252.43496295h-252.43496295v252.43496295h252.43496295zM7.13007408 7.13007408v252.43496295h252.43496295V7.13007408H7.13007408zM512 512v252.43496297h252.43496297V512H512z m0-252.43496297H259.56503703V512H512V259.56503703z m252.43496297-252.43496295H512v252.43496295h252.43496297V7.13007408zM1016.86992592 512V259.56503703h-252.43496295V512h252.43496295z"></path>
            </svg>
          </button>
          <button data-tool="text" title="${t("shotText")}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="4 7 4 4 20 4 20 7"/>
              <line x1="12" y1="4" x2="12" y2="20"/>
              <line x1="9" y1="20" x2="15" y2="20"/>
            </svg>
          </button>
          <button data-tool="style-adjust" title="${t("shotStyleAdjust")}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>
            </svg>
          </button>
          <button data-action="clear" class="clear-btn" title="一键清空标注 (Clear All)">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
          <div class="divider"></div>
          <button data-action="cancel" class="cancel-btn" title="${t("shotCancel")}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
          <button data-action="confirm" class="confirm-btn" title="${t("shotConfirm")}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
          </button>
        </div>
      </div>
    `;

    this.shadowRoot.appendChild(wrapper);
    document.body.appendChild(this.container);

    // 3. 事件监听绑定与全局滚动拦截
    window.addEventListener("keydown", this.handleKeyDown, true);
    window.addEventListener("wheel", this.handlePreventScroll, {
      passive: false,
      capture: true,
    });
    window.addEventListener("touchmove", this.handlePreventScroll, {
      passive: false,
      capture: true,
    });
    window.addEventListener("keydown", this.handlePreventScroll, {
      capture: true,
    });
    wrapper.addEventListener("mousedown", this.handleMouseDown);
    wrapper.addEventListener("mousemove", this.handleMouseMove);
    wrapper.addEventListener("mouseup", this.handleMouseUp);

    // 工具栏事件委托
    const toolbar = wrapper.querySelector(".toolbar");
    if (toolbar) {
      toolbar.addEventListener("click", (e) => {
        const btn = (e.target as HTMLElement).closest("button");
        if (!btn) return;
        e.stopPropagation();

        const tool = btn.dataset.tool;
        const action = btn.dataset.action;

        if (tool === "style-adjust") {
          this.styleAdjustmentMode = !this.styleAdjustmentMode;
          btn.classList.toggle("active", this.styleAdjustmentMode);
        } else if (tool) {
          this.currentTool = tool as any;
          toolbar
            .querySelectorAll<HTMLButtonElement>("button[data-tool]")
            .forEach((b) => {
              if (b.dataset.tool !== "style-adjust") {
                b.classList.remove("active");
              }
            });
          btn.classList.add("active");
        } else if (action === "clear") {
          this.saveUndoState();
          this.annotations = [];
          this.selectedAnnotation = null;
          this.renderAnnotationsOnCanvas();
        } else if (action === "cancel") {
          this.cancel();
        } else if (action === "confirm") {
          this.confirm(this.cachedViewportDataUrl);
        }
      });
    }

    this.updateCanvasDimensions();

    // 默认直接框选整个视口 (Full Viewport Pre-selection)
    this.selection = {
      x: 0,
      y: 0,
      width: window.innerWidth,
      height: window.innerHeight,
    };
    this.renderSelectionBox();
  }

  private updateCanvasDimensions(): void {
    if (!this.shadowRoot) return;
    const canvas =
      this.shadowRoot.querySelector<HTMLCanvasElement>(".canvas-layer");
    if (canvas) {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      this.cancel();
    } else if (e.key === "c" && (e.metaKey || e.ctrlKey) && this.selection) {
      e.preventDefault();
      e.stopPropagation();
      this.confirm(this.cachedViewportDataUrl);
    }
  }

  private handleMouseDown(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    if (target && target.closest(".inline-text-input")) {
      return;
    }

    const handleEl = target.closest<HTMLElement>(".handle");
    if (handleEl && this.selection) {
      this.isResizing = true;
      this.activeHandle = handleEl.dataset.handle || null;
      this.resizeStartPoint = { x: e.clientX, y: e.clientY };
      this.initialSelection = { ...this.selection };
      return;
    }

    // 1. 优先检测是否击中了当前选中批注框的 Resize 控制点
    const handleHit = this.hitTestAnnotationHandle(e.clientX, e.clientY);
    if (handleHit) {
      this.saveUndoState();
      this.isResizingAnnotationHandle = true;
      this.activeResizeHandle = handleHit.handle;
      this.selectedAnnotation = handleHit.ann;
      this.dragStartPoint = { x: e.clientX, y: e.clientY };
      return;
    }

    // 2. 次之检测是否点击了已有批注元素整体（选中并准备平移）
    const hit = this.hitTestAnnotation(e.clientX, e.clientY);
    if (hit) {
      this.selectedAnnotation = hit;
      this.renderAnnotationsOnCanvas();
      if (this.currentTool !== "text") {
        this.saveUndoState();
        this.isDraggingAnnotation = true;
        this.draggedAnnotation = hit;
        this.dragStartPoint = { x: e.clientX, y: e.clientY };
        return;
      }
    } else if (this.selectedAnnotation) {
      this.selectedAnnotation = null;
      this.renderAnnotationsOnCanvas();
    }

    if (this.currentTool === "select") {
      if (!this.isSelectionLocked) {
        this.isSelecting = true;
        this.startPoint = { x: e.clientX, y: e.clientY };
      }
    } else if (this.selection) {
      this.isDrawingTool = true;
      this.startPoint = { x: e.clientX, y: e.clientY };
    }
  }

  private handleMouseMove(e: MouseEvent): void {
    // 渲染 3x 放大镜
    this.renderMagnifier(e.clientX, e.clientY);

    // 8 点 Resize 微调拉伸
    if (
      this.isResizing &&
      this.resizeStartPoint &&
      this.initialSelection &&
      this.activeHandle
    ) {
      const dx = e.clientX - this.resizeStartPoint.x;
      const dy = e.clientY - this.resizeStartPoint.y;
      let { x, y, width, height } = this.initialSelection;

      const handle = this.activeHandle;
      if (handle.includes("n")) {
        const newH = height - dy;
        if (newH > 10) {
          y = y + dy;
          height = newH;
        }
      }
      if (handle.includes("s")) {
        const newH = height + dy;
        if (newH > 10) height = newH;
      }
      if (handle.includes("w")) {
        const newW = width - dx;
        if (newW > 10) {
          x = x + dx;
          width = newW;
        }
      }
      if (handle.includes("e")) {
        const newW = width + dx;
        if (newW > 10) width = newW;
      }

      this.selection = { x, y, width, height };
      this.renderSelectionBox();
      return;
    }

    if (
      this.isResizingAnnotationHandle &&
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
        if (handle === "start") {
          ann.startPoint.x += dx;
          ann.startPoint.y += dy;
        } else if (handle === "end") {
          ann.endPoint.x += dx;
          ann.endPoint.y += dy;
        }
      }

      this.renderAnnotationsOnCanvas();
      return;
    }

    if (this.isSelecting && this.startPoint) {
      const x = Math.min(this.startPoint.x, e.clientX);
      const y = Math.min(this.startPoint.y, e.clientY);
      const width = Math.abs(e.clientX - this.startPoint.x);
      const height = Math.abs(e.clientY - this.startPoint.y);

      this.selection = { x, y, width, height };
      this.renderSelectionBox();
    } else if (!this.selection) {
      // 未拉框状态下进行 DOM 控件智能吸附
      this.renderSnapBox(e.clientX, e.clientY);
    } else if (this.isDrawingTool && this.startPoint && this.selection) {
      // 在拉框选区内绘制批注
      if (this.currentTool === "rect") {
        this.activeTempAnnotation = {
          id: `ann_${Date.now()}`,
          type: "rect",
          bounds: {
            x: Math.min(this.startPoint.x, e.clientX),
            y: Math.min(this.startPoint.y, e.clientY),
            width: Math.abs(e.clientX - this.startPoint.x),
            height: Math.abs(e.clientY - this.startPoint.y),
          },
        };
      } else if (this.currentTool === "arrow") {
        this.activeTempAnnotation = {
          id: `ann_${Date.now()}`,
          type: "arrow",
          startPoint: this.startPoint,
          endPoint: { x: e.clientX, y: e.clientY },
        };
      } else if (this.currentTool === "privacy") {
        this.activeTempAnnotation = {
          id: `ann_${Date.now()}`,
          type: "privacy",
          bounds: {
            x: Math.min(this.startPoint.x, e.clientX),
            y: Math.min(this.startPoint.y, e.clientY),
            width: Math.abs(e.clientX - this.startPoint.x),
            height: Math.abs(e.clientY - this.startPoint.y),
          },
        };
      }
      this.renderAnnotationsOnCanvas();
    }
  }

  private handleMouseUp(e: MouseEvent): void {
    if (this.isResizingAnnotationHandle) {
      this.isResizingAnnotationHandle = false;
      this.activeResizeHandle = null;
      this.dragStartPoint = null;
      return;
    }

    if (this.isResizing) {
      this.isResizing = false;
      this.activeHandle = null;
      this.resizeStartPoint = null;
      this.initialSelection = null;
      return;
    }

    if (this.isSelecting) {
      this.isSelecting = false;
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
      if (this.shadowRoot) {
        const snapBox =
          this.shadowRoot.querySelector<HTMLDivElement>(".snap-box");
        if (snapBox) snapBox.style.display = "none";
      }

      this.isSelectionLocked = true;
      this.renderSelectionBox();
    } else if (this.isDrawingTool) {
      this.isDrawingTool = false;
      if (this.activeTempAnnotation) {
        this.annotations.push(this.activeTempAnnotation);
        this.activeTempAnnotation = null;
      }
      if (this.currentTool === "text") {
        this.spawnInlineTextInput(e.clientX, e.clientY);
      }
      this.renderAnnotationsOnCanvas();
    }
  }

  private renderSnapBox(x: number, y: number): void {
    if (!this.shadowRoot || this.selection) return;
    const snapBox = this.shadowRoot.querySelector<HTMLDivElement>(".snap-box");
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

  private renderMagnifier(x: number, y: number): void {
    if (!this.shadowRoot) return;
    const magBox =
      this.shadowRoot.querySelector<HTMLDivElement>(".magnifier-box");
    const magCanvas =
      this.shadowRoot.querySelector<HTMLCanvasElement>(".magnifier-canvas");
    const magColor =
      this.shadowRoot.querySelector<HTMLDivElement>(".mag-color");
    const magPos = this.shadowRoot.querySelector<HTMLDivElement>(".mag-pos");
    const magTag = this.shadowRoot.querySelector<HTMLDivElement>(".mag-tag");

    if (!magBox || !magCanvas) return;

    // 当选区已经确立，且未在重新拉框/微拉伸手柄时，自动隐藏 Magnifier 放大镜！
    if (this.selection && !this.isSelecting && !this.isResizing) {
      magBox.style.display = "none";
      return;
    }

    magBox.style.display = "flex";

    // 边界自适应翻转避让逻辑
    const magW = 130;
    const magH = 130;
    let posX = x + 15;
    let posY = y + 15;

    if (posX + magW > window.innerWidth) {
      posX = x - magW - 15;
    }
    if (posY + magH > window.innerHeight) {
      posY = y - magH - 15;
    }

    magBox.style.left = `${posX}px`;
    magBox.style.top = `${posY}px`;

    if (magPos) magPos.textContent = `X: ${Math.round(x)}, Y: ${Math.round(y)}`;

    const el = document.elementFromPoint(x, y);
    if (magTag && el) {
      const tag = el.tagName.toLowerCase();
      const idStr = el.id ? `#${el.id}` : "";
      magTag.textContent = `${tag}${idStr}`.slice(0, 18);
    }

    const ctx = magCanvas.getContext("2d");
    if (ctx && this.viewportImage) {
      ctx.imageSmoothingEnabled = false;
      const dpr = window.devicePixelRatio || 1;
      const srcW = 40;
      const srcH = 30;

      ctx.drawImage(
        this.viewportImage,
        (x - srcW / 2) * dpr,
        (y - srcH / 2) * dpr,
        srcW * dpr,
        srcH * dpr,
        0,
        0,
        magCanvas.width,
        magCanvas.height
      );

      // 十字准星 Crosshair
      const cx = magCanvas.width / 2;
      const cy = magCanvas.height / 2;
      ctx.strokeStyle = "#FA5252";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx - 8, cy);
      ctx.lineTo(cx + 8, cy);
      ctx.moveTo(cx, cy - 8);
      ctx.lineTo(cx, cy + 8);
      ctx.stroke();

      try {
        const pixel = ctx.getImageData(cx, cy, 1, 1).data;
        const hex = `#${((1 << 24) + (pixel[0] << 16) + (pixel[1] << 8) + pixel[2]).toString(16).slice(1).toUpperCase()}`;
        if (magColor) magColor.textContent = hex;
      } catch {
        // Fallback
      }
    }
  }

  private renderSelectionBox(): void {
    if (!this.shadowRoot) return;
    const box = this.shadowRoot.querySelector<HTMLDivElement>(".selection-box");
    const badge = this.shadowRoot.querySelector<HTMLDivElement>(".size-badge");
    const toolbar = this.shadowRoot.querySelector<HTMLDivElement>(".toolbar");

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
            // 内嵌：如果上下均挤压（如全屏），直接贴合在选区框内部右下角 (Inside Bottom-Right)
            toolbar.style.top = "auto";
            toolbar.style.bottom = "16px";
            toolbar.style.right = "16px";
          }
        } else {
          // 外挂：常规局部选区显示在选区外侧下方 (Outside Bottom-Right)
          toolbar.style.top = "auto";
          toolbar.style.bottom = "-48px";
          toolbar.style.right = "0px";
        }
      }
    }

    // 重新触发 Mask 画布渲染与选区 clearRect 擦除镂空
    this.renderAnnotationsOnCanvas();
  }

  private renderAnnotationsOnCanvas(): void {
    if (!this.shadowRoot) return;
    const canvas =
      this.shadowRoot.querySelector<HTMLCanvasElement>(".canvas-layer");
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 1. 绘制全屏 45% 暗黑色遮罩 Mask
    ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 2. 动态擦除（镂空）选区内部，使其 100% 透出真实的原始鲜艳颜色！
    if (this.selection) {
      ctx.clearRect(
        this.selection.x,
        this.selection.y,
        this.selection.width,
        this.selection.height
      );
    }

    // 3. 绘制用户标注图层
    const list = [...this.annotations];
    if (this.activeTempAnnotation) list.push(this.activeTempAnnotation);

    for (const ann of list) {
      ctx.save();
      ctx.strokeStyle = ann.color || "#FA5252";
      ctx.fillStyle = ann.color || "#FA5252";
      ctx.lineWidth = 2.5;

      if (ann.type === "rect") {
        const lw = 2;
        const rx = Math.floor(ann.bounds.x);
        const ry = Math.floor(ann.bounds.y);
        const rw = Math.round(ann.bounds.width);
        const rh = Math.round(ann.bounds.height);

        const rOuter = Math.min(6, Math.min(rw, rh) / 2);
        const rInner = Math.max(0, rOuter - lw);

        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.fillStyle = ann.color || "#FA5252";

        ctx.beginPath();
        if (ctx.roundRect && rw > 2 * lw && rh > 2 * lw) {
          ctx.roundRect(rx, ry, rw, rh, rOuter);
          ctx.roundRect(rx + lw, ry + lw, rw - 2 * lw, rh - 2 * lw, rInner);
        } else {
          ctx.rect(rx, ry, rw, rh);
          if (rw > 2 * lw && rh > 2 * lw) {
            ctx.rect(rx + lw, ry + lw, rw - 2 * lw, rh - 2 * lw);
          }
        }
        ctx.fill("evenodd");
        ctx.restore();
      } else if (ann.type === "arrow") {
        const sx = ann.startPoint.x;
        const sy = ann.startPoint.y;
        const ex = ann.endPoint.x;
        const ey = ann.endPoint.y;

        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.stroke();

        const angle = Math.atan2(ey - sy, ex - sx);
        const headLen = 14;
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(
          ex - headLen * Math.cos(angle - Math.PI / 6),
          ey - headLen * Math.sin(angle - Math.PI / 6)
        );
        ctx.lineTo(
          ex - headLen * Math.cos(angle + Math.PI / 6),
          ey - headLen * Math.sin(angle + Math.PI / 6)
        );
        ctx.closePath();
        ctx.fill();
      } else if (ann.type === "privacy") {
        const x = Math.round(ann.bounds.x);
        const y = Math.round(ann.bounds.y);
        const w = Math.round(ann.bounds.width);
        const h = Math.round(ann.bounds.height);
        const dpr = window.devicePixelRatio || 1;

        if (w > 0 && h > 0 && this.viewportImage) {
          const tileSize = 8;
          const sampleW = Math.max(1, Math.floor(w / tileSize));
          const sampleH = Math.max(1, Math.floor(h / tileSize));

          const offCanvas = document.createElement("canvas");
          offCanvas.width = sampleW;
          offCanvas.height = sampleH;
          const offCtx = offCanvas.getContext("2d");
          if (offCtx) {
            offCtx.imageSmoothingEnabled = false;
            offCtx.drawImage(
              this.viewportImage,
              x * dpr,
              y * dpr,
              w * dpr,
              h * dpr,
              0,
              0,
              sampleW,
              sampleH
            );

            ctx.save();
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(offCanvas, 0, 0, sampleW, sampleH, x, y, w, h);
            ctx.restore();
          }
        } else if (w > 0 && h > 0) {
          ctx.fillStyle = "rgba(100, 116, 139, 0.7)";
          ctx.fillRect(x, y, w, h);
        }
      } else if (ann.type === "text") {
        const px = ann.position.x;
        const py = ann.position.y;
        const text = ann.text;

        ctx.font =
          'bold 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

        const boundsRight = this.selection
          ? this.selection.x + this.selection.width
          : window.innerWidth;
        const maxTextWidth = Math.max(
          100,
          Math.min(300, boundsRight - px - 24)
        );

        // 按换行符与 maxTextWidth 自动拆分多行
        const lines: string[] = [];
        const paragraphs = text.split("\n");
        for (const p of paragraphs) {
          if (!p) {
            lines.push("");
            continue;
          }
          let cur = "";
          for (const ch of p) {
            const test = cur + ch;
            if (ctx.measureText(test).width > maxTextWidth && cur !== "") {
              lines.push(cur);
              cur = ch;
            } else {
              cur = test;
            }
          }
          if (cur) lines.push(cur);
        }

        const paddingX = 10;
        const paddingY = 6;
        const lineHeight = 18;
        let maxW = 0;
        for (const l of lines) {
          const w = ctx.measureText(l).width;
          if (w > maxW) maxW = w;
        }

        const bgWidth = maxW + paddingX * 2;
        const bgHeight = paddingY * 2 + lines.length * lineHeight;

        ctx.fillStyle = "rgba(15, 23, 42, 0.92)";
        ctx.strokeStyle = "#0284c7";
        ctx.lineWidth = 1;

        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(px, py, bgWidth, bgHeight, 6);
        } else {
          ctx.rect(px, py, bgWidth, bgHeight);
        }
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = "#f8fafc";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        for (let i = 0; i < lines.length; i++) {
          ctx.fillText(
            lines[i],
            px + paddingX,
            py + paddingY + i * lineHeight + 1
          );
        }
      }
      ctx.restore();
    }

    if (this.selectedAnnotation) {
      this.renderSelectionHandles(ctx, this.selectedAnnotation);
    }
  }

  private spawnInlineTextInput(
    x: number,
    y: number,
    initialText?: string
  ): void {
    if (!this.shadowRoot) return;
    const wrapper =
      this.shadowRoot.querySelector<HTMLDivElement>(".overlay-wrapper");
    if (!wrapper) return;

    const existing = wrapper.querySelector(".inline-text-input");
    if (existing) existing.remove();

    // 边界 Clamp 矫正：防止靠边缘产生抖动与超出选区/屏幕
    const boundsRight = this.selection
      ? this.selection.x + this.selection.width
      : window.innerWidth;
    const boundsBottom = this.selection
      ? this.selection.y + this.selection.height
      : window.innerHeight;

    const availableWidth = Math.max(120, boundsRight - x - 10);
    const availableHeight = Math.max(40, boundsBottom - y - 10);
    const maxWidth = Math.min(320, availableWidth);

    // 如果非常靠近右边界，智能往左靠齐
    let renderX = x;
    if (boundsRight - x < 130 && x - 200 >= (this.selection?.x || 0)) {
      renderX = Math.max(this.selection?.x || 0, x - 180);
    }

    const input = document.createElement("textarea");
    input.rows = 1;
    input.className = "inline-text-input";
    input.placeholder = t("shotTextPlaceholder");
    input.style.cssText = `
      position: absolute;
      left: ${renderX}px;
      top: ${y}px;
      max-width: ${maxWidth}px;
      max-height: ${availableHeight}px;
      min-width: 120px;
      background: transparent;
      color: #ff3b30;
      border: 1.5px dashed #007aff;
      border-radius: 4px;
      padding: 4px 6px;
      font-size: 14px;
      font-weight: 700;
      line-height: 1.4;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.7);
      outline: none;
      z-index: 100;
      resize: none;
      overflow: hidden;
      white-space: pre-wrap;
      word-break: break-word;
      box-sizing: border-box;
    `;

    // 监听输入自动调整高度
    const autoResize = () => {
      input.style.height = "auto";
      input.style.height = `${Math.min(input.scrollHeight, availableHeight)}px`;
    };
    input.addEventListener("input", autoResize);

    let isHandled = false;
    const commitText = () => {
      if (isHandled) return;
      isHandled = true;
      const text = input.value.trim();
      if (text) {
        this.annotations.push({
          id: `ann_${Date.now()}`,
          type: "text",
          position: { x: renderX, y },
          text,
        });
        this.renderAnnotationsOnCanvas();
      } else if (initialText) {
        // 如果原本有字但清空确认了，则重新绘制 Canvas 清除原文字
        this.renderAnnotationsOnCanvas();
      }
      input.remove();
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (isHandled) return;
        isHandled = true;
        if (initialText) {
          // 按 Escape 取消时，还原原本的文字批注
          this.annotations.push({
            id: `ann_${Date.now()}`,
            type: "text",
            position: { x: renderX, y },
            text: initialText,
          });
          this.renderAnnotationsOnCanvas();
        }
        input.remove();
      }
    });

    input.addEventListener("blur", () => {
      commitText();
    });

    wrapper.appendChild(input);
    setTimeout(() => {
      input.focus();
      if (input.value) {
        input.setSelectionRange(input.value.length, input.value.length);
      }
      autoResize();
    }, 20);
  }

  private showToast(msg: string): void {
    if (!document.body) return;
    const toast = document.createElement("div");
    toast.className = "bug-lens-toast-box";
    toast.style.cssText = `
      position: fixed;
      top: 30%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: #0f172a;
      color: #38bdf8;
      border: 1px solid #0284c7;
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      box-shadow: 0 20px 30px rgba(0,0,0,0.5);
      pointer-events: none;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 8px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    `;
    toast.innerHTML = `✓ ${msg}`;
    document.body.appendChild(toast);
    setTimeout(() => {
      if (toast.parentElement) toast.parentElement.removeChild(toast);
    }, 1800);
  }

  async confirm(viewportDataUrl: string): Promise<void> {
    if (!this.selection) return;

    // 隐藏 Overlay UI 瞬时视角
    if (this.container) {
      this.container.style.display = "none";
    }

    try {
      const { payload, promptInjectedWithPath } = await processScreenshot({
        viewportDataUrl,
        cropBounds: this.selection,
        annotations: this.annotations,
        styleAdjustmentMode: this.styleAdjustmentMode,
      });

      this.showToast(buildScreenshotToastMessage(promptInjectedWithPath));

      if (this.onCompleteCallback) {
        this.onCompleteCallback(payload);
      }
    } catch (err) {
      console.error("Bug Lens: Screenshot process failed", err);
    } finally {
      this.destroy();
    }
  }

  private saveUndoState(): void {
    this.undoStack.push(JSON.parse(JSON.stringify(this.annotations)));
    if (this.undoStack.length > 30) {
      this.undoStack.shift();
    }
  }

  public undo(): void {
    if (this.annotations.length > 0) {
      this.saveUndoState();
      this.annotations.pop();
      this.renderAnnotationsOnCanvas();
    } else if (this.undoStack.length > 0) {
      const prev = this.undoStack.pop();
      if (prev) {
        this.annotations = prev;
        this.renderAnnotationsOnCanvas();
      }
    }
  }

  private handleDoubleClick(e: MouseEvent): void {
    const hit = this.hitTestAnnotation(e.clientX, e.clientY);
    if (hit && hit.type === "text") {
      e.stopPropagation();
      e.preventDefault();
      this.saveUndoState();
      this.annotations = this.annotations.filter((a) => a.id !== hit.id);
      this.renderAnnotationsOnCanvas();
      this.spawnInlineTextInput(hit.position.x, hit.position.y, hit.text);
    }
  }

  private renderSelectionHandles(
    ctx: CanvasRenderingContext2D,
    ann: AnnotationItem
  ): void {
    const handleRadius = 4;
    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#007aff";
    ctx.lineWidth = 1.5;

    const drawPoint = (hx: number, hy: number) => {
      ctx.beginPath();
      ctx.arc(hx, hy, handleRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    };

    if (ann.type === "rect" || ann.type === "privacy") {
      const { x, y, width, height } = ann.bounds;
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = "rgba(0, 122, 255, 0.85)";
      ctx.strokeRect(x - 2, y - 2, width + 4, height + 4);
      ctx.setLineDash([]);
      ctx.strokeStyle = "#007aff";

      drawPoint(x, y);
      drawPoint(x + width, y);
      drawPoint(x + width, y + height);
      drawPoint(x, y + height);
    } else if (ann.type === "arrow") {
      ctx.strokeStyle = "#007aff";
      drawPoint(ann.startPoint.x, ann.startPoint.y);
      drawPoint(ann.endPoint.x, ann.endPoint.y);
    }
    ctx.restore();
  }

  private hitTestAnnotationHandle(
    x: number,
    y: number
  ): { ann: AnnotationItem; handle: string } | null {
    if (!this.selectedAnnotation) return null;
    const ann = this.selectedAnnotation;
    const radius = 8;

    if (ann.type === "rect" || ann.type === "privacy") {
      const { x: bx, y: by, width: bw, height: bh } = ann.bounds;
      const handles = [
        { name: "nw", x: bx, y: by },
        { name: "ne", x: bx + bw, y: by },
        { name: "se", x: bx + bw, y: by + bh },
        { name: "sw", x: bx, y: by + bh },
      ];
      for (const h of handles) {
        if (Math.hypot(x - h.x, y - h.y) <= radius) {
          return { ann, handle: h.name };
        }
      }
    } else if (ann.type === "arrow") {
      if (Math.hypot(x - ann.startPoint.x, y - ann.startPoint.y) <= radius) {
        return { ann, handle: "start" };
      }
      if (Math.hypot(x - ann.endPoint.x, y - ann.endPoint.y) <= radius) {
        return { ann, handle: "end" };
      }
    }
    return null;
  }

  private hitTestAnnotation(x: number, y: number): AnnotationItem | null {
    for (let i = this.annotations.length - 1; i >= 0; i--) {
      const ann = this.annotations[i];
      if (ann.type === "rect" || ann.type === "privacy") {
        const b = ann.bounds;
        if (
          x >= b.x - 5 &&
          x <= b.x + b.width + 5 &&
          y >= b.y - 5 &&
          y <= b.y + b.height + 5
        ) {
          return ann;
        }
      } else if (ann.type === "text") {
        const px = ann.position.x;
        const py = ann.position.y;
        const lines = ann.text.split("\n");
        let maxW = 80;
        for (const line of lines) {
          if (line.length * 12 > maxW) maxW = line.length * 12;
        }
        const bgW = Math.min(320, maxW + 20);
        const bgH = lines.length * 20 + 12;
        if (
          x >= px - 4 &&
          x <= px + bgW + 4 &&
          y >= py - 4 &&
          y <= py + bgH + 4
        ) {
          return ann;
        }
      } else if (ann.type === "arrow") {
        const dist = pointToSegmentDistance(
          { x, y },
          ann.startPoint,
          ann.endPoint
        );
        if (dist <= 10) {
          return ann;
        }
      }
    }
    return null;
  }

  cancel(): void {
    if (this.onCancelCallback) {
      this.onCancelCallback();
    }
    this.destroy();
  }

  destroy(): void {
    window.removeEventListener("keydown", this.handleKeyDown, true);
    window.removeEventListener("wheel", this.handlePreventScroll, {
      capture: true,
    } as any);
    window.removeEventListener("touchmove", this.handlePreventScroll, {
      capture: true,
    } as any);
    window.removeEventListener("keydown", this.handlePreventScroll, {
      capture: true,
    } as any);
    if (this.container && this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
    this.container = null;
    this.shadowRoot = null;
    this.selection = null;
    this.viewportImage = null;
    this.isSelectionLocked = false;
    this.annotations = [];
  }
}

function pointToSegmentDistance(
  p: { x: number; y: number },
  v: { x: number; y: number },
  w: { x: number; y: number }
): number {
  const l2 = (w.x - v.x) ** 2 + (w.y - v.y) ** 2;
  if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y);
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(
    p.x - (v.x + t * (w.x - v.x)),
    p.y - (v.y + t * (w.y - v.y))
  );
}
