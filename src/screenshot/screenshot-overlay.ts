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
  private styleAdjustmentMode = true;

  private viewportImage: HTMLImageElement | null = null;
  private cachedViewportDataUrl = "";

  private onCompleteCallback?: (payload: AIScreenshotPayload) => void;
  private onCancelCallback?: () => void;

  private magnifier: MagnifierRenderer | null = null;
  private textEditor: InlineTextEditor | null = null;

  /** 确认导出防重入守卫：Enter 连按或双击确认按钮时只进入一次 processScreenshot */
  private isConfirming = false;
  private disablePruning = false;

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
      // 输入框关闭且未产出有效批注（空文本 / 清空原文）：必须恢复状态机，
      // 否则停留在 editing-text 将阻塞后续所有批注工具（editing-text 仅允许转移到 locked）
      onClose: () => {
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
    // 双击文本批注进入二次编辑（单击仅选中/拖拽）
    wrapper.addEventListener("dblclick", this.handleDoubleClick);
    wrapper.addEventListener("click", this.handleOverlayClick);

    // 工具栏事件委托
    const toolbar = wrapper.querySelector(".toolbar");
    if (toolbar) {
      const styleBtn = toolbar.querySelector<HTMLButtonElement>(
        'button[data-tool="style-adjust"]'
      );
      if (styleBtn) {
        styleBtn.classList.toggle("active", this.styleAdjustmentMode);
      }
      const pruningBtn = toolbar.querySelector<HTMLButtonElement>(
        'button[data-tool="pruning-toggle"]'
      );
      if (pruningBtn) {
        pruningBtn.classList.toggle("active", this.disablePruning);
      }
      toolbar.addEventListener("click", (e) => {
        const btn = (e.target as HTMLElement).closest("button");
        if (!btn) return;
        e.stopPropagation();

        const tool = btn.dataset.tool;
        const action = btn.dataset.action;

        if (tool === "style-adjust") {
          this.styleAdjustmentMode = !this.styleAdjustmentMode;
          btn.classList.toggle("active", this.styleAdjustmentMode);
        } else if (tool === "pruning-toggle") {
          this.disablePruning = !this.disablePruning;
          btn.classList.toggle("active", this.disablePruning);
        } else if (tool) {
          this.setTool(tool);
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

  /**
   * 切换当前工具并同步工具栏高亮（按钮点击与 V 快捷键共用同一入口）。
   * style-adjust 是独立开关模式，不参与工具互斥高亮。
   */
  private setTool(tool: string): void {
    // 切换工具时主动结束文本编辑（若输入框开着）：防御性兜底，
    // 确保不残留 editing-text 状态阻塞后续绘制
    this.textEditor?.cancelEdit();
    this.currentTool = tool as any;
    if (!this.shadowRoot) return;
    const toolbar = this.shadowRoot.querySelector<HTMLDivElement>(".toolbar");
    if (!toolbar) return;
    toolbar
      .querySelectorAll<HTMLButtonElement>("button[data-tool]")
      .forEach((b) => {
        if (
          b.dataset.tool !== "style-adjust" &&
          b.dataset.tool !== "pruning-toggle"
        ) {
          b.classList.toggle("active", b.dataset.tool === tool);
        }
      });
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
      // 编辑文本时 Esc 优先取消文本输入（还原原文 / 关闭空输入并恢复状态机），
      // 而非取消整个截图；非编辑态维持原契约：取消截图。
      e.preventDefault();
      e.stopPropagation();
      if (this.isEditingText()) {
        this.textEditor?.cancelEdit();
      } else {
        // 取消截图前注册一次性 capture 监听，吞掉本次 Escape 按键自身的 keyup：
        // destroy() 会移除 handleKeyUp，若不处理，该 keyup 将冒泡泄漏到页面。
        window.addEventListener(
          "keyup",
          (ke: KeyboardEvent) => {
            if (ke.key === "Escape") {
              ke.preventDefault();
              ke.stopPropagation();
            }
          },
          { capture: true, once: true }
        );
        this.cancel();
      }
    } else if (e.key === "Enter" && !isEditingText) {
      // 兑现 shotConfirm 文案承诺：非编辑态按 Enter 直接确认导出，
      // 省去"离开现场→找鼠标→瞄准确认按钮"的摩擦（第一性原理 P1/P2）。
      e.preventDefault();
      e.stopPropagation();
      void this.confirm(this.cachedViewportDataUrl);
    } else if ((e.key === "v" || e.key === "V") && !isEditingText) {
      // V 快捷键回到"选择/移动"工具：批注后仍可拖拽整体平移选区，
      // 兑现 SelectionController 已支持、但工具栏缺失入口的能力。
      e.preventDefault();
      e.stopPropagation();
      this.setTool("select");
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
      (e.key === "Delete" ||
        e.key === "Backspace" ||
        e.code === "Backspace" ||
        e.code === "Delete") &&
      this.annotationController.selectedAnnotation
    ) {
      if (!isEditingText) {
        e.preventDefault();
        e.stopPropagation();
        this.deleteSelectedAnnotation();
      }
    } else if (!isEditingText) {
      // 允许 Cmd / Ctrl 组合快捷键（如 Cmd+R 刷新页面、Cmd+W 关闭标签等）及 F1-F12 功能键穿透给浏览器
      if (
        e.metaKey ||
        e.ctrlKey ||
        (e.key && e.key.length >= 2 && e.key.startsWith("F") && !isNaN(Number(e.key.slice(1))))
      ) {
        return;
      }
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
    if (this.isEditingText() || e.metaKey || e.ctrlKey) return;
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
    // 点击工具栏 / 尺寸角标等 overlay UI 元素：不启动任何绘制 / 拖拽意图。
    // 否则非 select 工具下点击工具按钮会被当成"开始绘制"（返回 draw 意图），
    // 轻则误入 drawing 状态，重则（text 工具）在按钮位置误弹文本输入框。
    if (target && target.closest(".toolbar, .size-badge")) {
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

  /**
   * 双击文本批注进入二次编辑（唯一入口：单击已选中的文本批注仅选中/拖拽，
   * 不再直接进入编辑，避免误操作）。
   */
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
      this.spawnInlineTextInput(
        hit.position.x,
        hit.position.y,
        hit.text,
        hit.color
      );
      this.stateMachine.transition("editing-text");
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
    initialText?: string,
    color?: string
  ): void {
    if (!this.shadowRoot) return;
    const wrapper =
      this.shadowRoot.querySelector<HTMLDivElement>(".overlay-wrapper");
    if (!wrapper) return;
    if (!this.textEditor) return;
    this.textEditor.spawn(x, y, initialText, color);
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
    toast.setAttribute("data-wbr-ignore", "true");
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
    if (this.isConfirming) return;
    this.isConfirming = true;

    // 确认后立即解绑全局事件监听，确保在后台异步 processScreenshot 导出期间（可长达数秒）
    // 用户对页面的键盘控制权（如 Cmd+R 刷新页面）已完全恢复。
    this.removeEventListeners();

    const selection = this.selectionController.selection;
    if (!selection) {
      this.isConfirming = false;
      return;
    }

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
        disablePruning: this.disablePruning,
      });

      this.showToast(buildScreenshotToastMessage(promptInjectedWithPath));

      if (this.onCompleteCallback) {
        this.onCompleteCallback(payload);
      }
    } catch (err) {
      console.error("Bug Lens: Screenshot process failed", err);
    } finally {
      this.isConfirming = false;
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
    this.removeEventListeners();
    if (this.onCancelCallback) {
      this.onCancelCallback();
    }
    this.destroy();
  }

  private removeEventListeners(): void {
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
  }

  destroy(): void {
    this.removeEventListeners();
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
