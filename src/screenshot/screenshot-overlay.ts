import type {
  AIScreenshotPayload,
  AnnotationItem,
} from "../domain/screenshot-payload.ts";
import { processScreenshot } from "./screenshot-processor.ts";
import { t } from "../shared/i18n.ts";
import { createOverlayMarkup } from "./overlay-template.ts";
import {
  renderAnnotations as renderAnnotationsOnContext,
  renderSelectionHandles as drawSelectionHandles,
} from "./annotation-renderer.ts";
import { InlineTextEditor, MagnifierRenderer } from "./overlay-widgets.ts";
import { SelectionController } from "./selection-controller.ts";
import { AnnotationController } from "./annotation-controller.ts";
import { OverlayStateMachine } from "./overlay-state.ts";

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

  private currentTool: "select" | "rect" | "arrow" | "privacy" | "text" =
    "select";
  private styleAdjustmentMode = false;

  private viewportImage: HTMLImageElement | null = null;
  private cachedViewportDataUrl = "";

  private onCompleteCallback?: (payload: AIScreenshotPayload) => void;
  private onCancelCallback?: () => void;

  private magnifier: MagnifierRenderer | null = null;
  private textEditor: InlineTextEditor | null = null;

  private readonly selectionController: SelectionController;
  private readonly annotationController: AnnotationController;
  private readonly stateMachine = new OverlayStateMachine();

  constructor() {
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handlePreventScroll = this.handlePreventScroll.bind(this);
    this.handleMouseDown = this.handleMouseDown.bind(this);
    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.handleMouseUp = this.handleMouseUp.bind(this);
    this.handleDoubleClick = this.handleDoubleClick.bind(this);
    this.handleContextMenu = this.handleContextMenu.bind(this);
    this.handleOverlayDblClick = this.handleOverlayDblClick.bind(this);
    this.handleOverlayClick = this.handleOverlayClick.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);

    // 组合根：以依赖注入方式组装两个领域控制器，控制器之间无直接引用
    this.selectionController = new SelectionController({
      getShadowRoot: () => this.shadowRoot,
      getAnnotations: () => this.annotationController.annotations,
      getCurrentTool: () => this.currentTool,
      getPhase: () => this.stateMachine.phase,
      rerender: () => this.renderAnnotationsOnCanvas(),
    });
    this.annotationController = new AnnotationController({
      getSelection: () => this.selectionController.selection,
      getCurrentTool: () => this.currentTool,
      getPhase: () => this.stateMachine.phase,
      spawnInlineTextInput: (x, y, initialText) =>
        this.spawnInlineTextInput(x, y, initialText),
      rerender: () => this.renderAnnotationsOnCanvas(),
    });
  }

  /** 选区是否已锁定（薄壳代理，供测试与外部读取） */
  get isSelectionLocked(): boolean {
    return this.selectionController.isSelectionLocked;
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
    wrapper.innerHTML = createOverlayMarkup();

    this.shadowRoot.appendChild(wrapper);
    document.body.appendChild(this.container);

    // 初始化独立 UI 小组件（放大镜 / 内联文本编辑），通过注入与回调解耦
    this.magnifier = new MagnifierRenderer({
      shadowRoot: this.shadowRoot,
      getViewportImage: () => this.viewportImage,
      shouldHide: () =>
        Boolean(
          this.selectionController.selection &&
          !this.selectionController.isActiveInteraction
        ),
    });
    this.textEditor = new InlineTextEditor({
      wrapper,
      getSelection: () => this.selectionController.selection,
      commitAnnotation: (ann) => {
        this.annotationController.addAnnotation(ann);
        this.renderAnnotationsOnCanvas();
        this.stateMachine.transition("locked");
      },
      cancelAnnotation: (ann) => {
        this.annotationController.addAnnotation(ann);
        this.renderAnnotationsOnCanvas();
        this.stateMachine.transition("locked");
      },
      rerender: () => {
        this.renderAnnotationsOnCanvas();
      },
    });

    // 3. 事件监听绑定与全局滚动拦截
    window.addEventListener("keydown", this.handleKeyDown, true);
    window.addEventListener("keyup", this.handleKeyUp, true);
    // 截图激活期间禁用网页右键菜单，避免误触发网页交互
    window.addEventListener("contextmenu", this.handleContextMenu, true);
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
    // 拦截 click / dblclick 传播，避免截图操作触发网页的点击与双击逻辑
    wrapper.addEventListener("dblclick", this.handleOverlayDblClick);
    wrapper.addEventListener("click", this.handleOverlayClick);

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
        } else if (action === "undo") {
          this.undo();
        } else if (action === "clear") {
          this.annotationController.clear();
        } else if (action === "cancel") {
          this.cancel();
        } else if (action === "confirm") {
          this.confirm(this.cachedViewportDataUrl);
        }
      });
    }

    this.updateCanvasDimensions();

    // 默认直接框选整个视口 (Full Viewport Pre-selection)
    this.selectionController.selection = {
      x: 0,
      y: 0,
      width: window.innerWidth,
      height: window.innerHeight,
    };
    this.selectionController.renderSelectionBox();
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

  private isEditingText(): boolean {
    return !!(
      this.shadowRoot?.activeElement &&
      (this.shadowRoot.activeElement.tagName === "TEXTAREA" ||
        this.shadowRoot.activeElement.tagName === "INPUT" ||
        this.shadowRoot.activeElement.classList.contains("inline-text-input"))
    );
  }

  private handleKeyDown(e: KeyboardEvent): void {
    const isEditingText = this.isEditingText();

    if (e.key === "Escape") {
      // 取消截图，并阻止事件继续传递到网页（避免触发网页快捷键）
      e.preventDefault();
      e.stopPropagation();
      this.cancel();
    } else if (
      (e.key === "z" || e.key === "Z" || e.code === "KeyZ") &&
      (e.metaKey || e.ctrlKey)
    ) {
      if (!isEditingText) {
        e.preventDefault();
        e.stopPropagation();
        this.undo();
      }
    } else if (
      (e.key === "Delete" || e.key === "Backspace") &&
      this.annotationController.selectedAnnotation
    ) {
      if (!isEditingText) {
        e.preventDefault();
        e.stopPropagation();
        this.deleteSelectedAnnotation();
      }
    } else if (!isEditingText) {
      // 截图激活期间吞掉所有其余按键，避免网页全局快捷键被无意触发
      e.preventDefault();
      e.stopPropagation();
    }
  }

  /**
   * 截图激活期间：非编辑场景吞掉 keyup，避免网页监听 keyup 的快捷键（如
   * 编辑器/游戏）被截图操作触发。
   */
  private handleKeyUp(e: KeyboardEvent): void {
    if (this.isEditingText()) return;
    e.preventDefault();
    e.stopPropagation();
  }

  /**
   * 截图激活期间：禁用网页右键菜单，避免误触发网页交互。
   * 在 window capture 阶段拦截，保证 shadow DOM 内外右键都被吞掉。
   */
  private handleContextMenu(e: Event): void {
    e.preventDefault();
    e.stopPropagation();
  }

  /** 截图激活期间：拦截双击事件传播，避免触发网页双击逻辑（输入框内放行以支持选词） */
  private handleOverlayDblClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    if (target && target.closest(".inline-text-input")) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  /** 截图激活期间：拦截非工具栏/输入框区域的 click 传播（工具栏按钮的 click 已自行 stopPropagation） */
  private handleOverlayClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    if (target && target.closest(".inline-text-input")) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  /**
   * 鼠标事件路由：先选区手柄，再批注域，最后 select 工具兜底。
   * 顺序与原实现一致，保证行为等价。
   */
  private handleMouseDown(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    if (target && target.closest(".inline-text-input")) {
      e.stopPropagation();
      return;
    }

    // 1) 选区 8 点手柄 resize（优先于批注命中）
    if (this.selectionController.onMouseDown(e)) {
      this.stateMachine.transition("resizing-selection");
      e.stopPropagation();
      return;
    }
    // 2) 批注域：手柄/删除 → 命中选中/拖拽 → 清空选中 → 绘制启动
    const annIntent = this.annotationController.onMouseDown(e);
    if (annIntent) {
      if (annIntent === "resize") {
        this.stateMachine.transition("resizing-annotation");
      } else if (annIntent === "drag") {
        this.stateMachine.transition("dragging-annotation");
      } else if (annIntent === "draw") {
        this.stateMachine.transition("drawing");
      } else if (annIntent === "text-edit") {
        this.stateMachine.transition("editing-text");
      }
      e.stopPropagation();
      return;
    }
    // 3) select 工具：拉框 or 锁定后平移截图框
    const selIntent = this.selectionController.onSelectOrDrag(e);
    if (selIntent) {
      this.stateMachine.transition(selIntent);
    }
    e.stopPropagation();
  }

  private handleMouseMove(e: MouseEvent): void {
    // 渲染 3x 放大镜
    this.renderMagnifier(e.clientX, e.clientY);

    // 选区域：Resize → 锁定光标 → 平移截图框 → 拉框/吸附
    if (this.selectionController.onMouseMove(e)) {
      e.stopPropagation();
      return;
    }
    // 批注域：手柄缩放 → 拖拽平移 → 绘制临时批注
    if (this.annotationController.onMouseMove(e)) {
      e.stopPropagation();
      return;
    }
    // 无拖拽进行中：按鼠标位置更新 hover 光标（批注手柄/批注体优先）
    this.updateHoverCursor(e.clientX, e.clientY);
    e.stopPropagation();
  }

  /**
   * 更新 hover 光标：批注调整手柄（canvas 绘制，无 DOM 光标）→ 方向光标；
   * 批注体 → move；未命中批注时，select 工具下保持选区拖拽提示，其他工具回落 crosshair。
   */
  private updateHoverCursor(x: number, y: number): void {
    if (!this.shadowRoot) return;
    const box = this.shadowRoot.querySelector<HTMLDivElement>(".selection-box");
    if (!box) return;

    const annCursor = this.annotationController.getHoverCursor(x, y);
    if (annCursor) {
      box.style.cursor = annCursor;
      return;
    }
    // 批注未命中：非 select 工具（绘制态）回落 crosshair；
    // select 工具下已由 selectionController 维护 move/crosshair，不覆盖。
    if (this.currentTool !== "select") {
      box.style.cursor = "crosshair";
    }
  }

  private handleMouseUp(e: MouseEvent): void {
    // 批注域：拖拽复位 → 手柄复位 → 绘制提交/text 输入
    const annUp = this.annotationController.onMouseUp(e);
    if (annUp) {
      this.stateMachine.transition(
        annUp === "spawned-text" ? "editing-text" : "locked"
      );
      e.stopPropagation();
      return;
    }
    // 选区域：Resize 复位 → 平移复位 → 拉框完成并锁定
    if (this.selectionController.onMouseUp(e)) {
      this.stateMachine.transition("locked");
      e.stopPropagation();
      return;
    }
    e.stopPropagation();
  }

  private handleDoubleClick(e: MouseEvent): void {
    const hit = this.annotationController.hitTestAnnotation(
      e.clientX,
      e.clientY
    );
    if (hit && hit.type === "text") {
      e.stopPropagation();
      e.preventDefault();
      this.annotationController.saveUndoState();
      this.annotationController.removeAnnotationById(hit.id);
      this.renderAnnotationsOnCanvas();
      this.spawnInlineTextInput(hit.position.x, hit.position.y, hit.text);
    }
  }

  private renderMagnifier(x: number, y: number): void {
    if (!this.magnifier) return;
    this.magnifier.render(x, y);
  }

  private renderSelectionBox(): void {
    this.selectionController.renderSelectionBox();
  }

  private renderAnnotationsOnCanvas(): void {
    if (!this.shadowRoot) return;
    const canvas =
      this.shadowRoot.querySelector<HTMLCanvasElement>(".canvas-layer");
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    renderAnnotationsOnContext(ctx, {
      selection: this.selectionController.selection,
      annotations: this.annotationController.annotations,
      tempAnnotation: this.annotationController.activeTempAnnotation,
      selectedAnnotation: this.annotationController.selectedAnnotation,
      viewportImage: this.viewportImage,
    });
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
    if (!this.textEditor) return;
    this.textEditor.spawn(x, y, initialText);
  }

  private showToast(
    message: string,
    durationMs = 2800,
    tone: "success" | "error" = "success"
  ): void {
    if (!document.body) return;

    // 与录制导出 Toast（recording-widget）保持一致的视觉：先移除旧 toast 再新建
    const existing = document.querySelector("#__bug_lens_screenshot_toast__");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.id = "__bug_lens_screenshot_toast__";
    toast.style.cssText = `
      position: fixed !important;
      top: 16px !important;
      left: 50% !important;
      transform: translateX(-50%) translateY(-10px) !important;
      z-index: 2147483647 !important;
      background: #ffffff !important;
      -webkit-backdrop-filter: blur(16px) !important;
      backdrop-filter: blur(16px) !important;
      border: 1px solid rgba(0, 0, 0, 0.08) !important;
      color: #1d2129 !important;
      padding: 6px 16px !important;
      border-radius: 6px !important;
      font-size: 13px !important;
      font-weight: 500 !important;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1), 0 1px 3px rgba(0, 0, 0, 0.05) !important;
      display: flex !important;
      align-items: center !important;
      gap: 8px !important;
      pointer-events: none !important;
      transition: opacity 0.2s ease, transform 0.2s ease !important;
      opacity: 0 !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
    `;

    const icon = tone === "error" ? "!" : "✓";
    const iconColor = tone === "error" ? "#d5484c" : "#00b42a";
    toast.innerHTML = `<span style="color:${iconColor};font-size:16px;">${icon}</span> <span>${message}</span>`;
    document.body.appendChild(toast);

    const rAF =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame
        : (fn: FrameRequestCallback) => setTimeout(fn, 0);
    rAF(() => {
      toast.style.opacity = "1";
      toast.style.transform = "translateX(-50%) translateY(0)";
    });

    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateX(-50%) translateY(-10px)";
      setTimeout(() => toast.remove(), 200);
    }, durationMs);
  }

  async confirm(viewportDataUrl: string): Promise<void> {
    const selection = this.selectionController.selection;
    if (!selection) return;

    // 隐藏 Overlay UI 瞬时视角
    if (this.container) {
      this.container.style.display = "none";
    }

    try {
      const { payload, promptInjectedWithPath } = await processScreenshot({
        viewportDataUrl,
        cropBounds: selection,
        annotations: this.annotationController.annotations,
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
    this.annotationController.saveUndoState();
  }

  public undo(): void {
    this.annotationController.undo();
  }

  private deleteSelectedAnnotation(): void {
    this.annotationController.deleteSelectedAnnotation();
  }

  private hitTestAnnotation(x: number, y: number): AnnotationItem | null {
    return this.annotationController.hitTestAnnotation(x, y);
  }

  private renderSelectionHandles(
    ctx: CanvasRenderingContext2D,
    ann: AnnotationItem
  ): void {
    drawSelectionHandles(ctx, ann);
  }

  cancel(): void {
    if (this.onCancelCallback) {
      this.onCancelCallback();
    }
    this.destroy();
  }

  destroy(): void {
    window.removeEventListener("keydown", this.handleKeyDown, true);
    window.removeEventListener("keyup", this.handleKeyUp, true);
    window.removeEventListener("contextmenu", this.handleContextMenu, true);
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
    this.viewportImage = null;
    this.magnifier = null;
    this.textEditor = null;
    this.selectionController.reset();
    this.annotationController.reset();
    this.stateMachine.reset();
  }
}
