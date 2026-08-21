import {
  message,
  type AnnotationModel,
  type IssueScene,
} from "../../../shared/protocol";
import { t } from "../../../shared/i18n";

type ActiveDrawing = {
  type: "rect" | "arrow";
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
};

export type IssueSceneInit = {
  id: string;
  page: { viewport: { width: number; height: number } };
  annotation: AnnotationModel;
  /** 速记卡确认的期望（capture 阶段已随场景落库），用于编辑器回填 */
  narrative?: IssueScene["narrative"];
};

export type IssueEditorDeps = {
  getSession(): { sessionId: string; nonce: string } | undefined;
  onClose(restoreWidget: boolean): void;
  onReselect(): void;
  onStopAfterCommit(): void;
  isMac: boolean;
};

/**
 * P1 完整性兜底：实际表现为空时的二次确认决策。
 * 首次提交且实际为空 → 需要提示并拦截（返回 true）；已提示过或实际非空 → 允许提交。
 */
export function shouldWarnEmptyActual(
  actual: string,
  alreadyWarned: boolean
): boolean {
  return actual.trim().length === 0 && !alreadyWarned;
}

export type IssueEditorEscapeTarget = "text-overlay" | "form-field" | "editor";

/**
 * Esc 在问题编辑器内的语义分派（与截图层"文本编辑态 Esc 不取消整个覆盖层"的先例一致）：
 * - 文字批注浮层聚焦 → 让位给浮层，Esc 只关闭浮层；
 * - 表单字段（实际/预期/说明）聚焦 → 仅失焦，避免误触 Esc 丢弃已录入内容
 *   （中文输入法用户常以 Esc 撤销组词）；
 * - 其余场景 → 取消整个编辑器，等价顶部 ✕（废弃场景并恢复录制条）。
 */
export function resolveEscapeTarget(
  textOverlayFocused: boolean,
  formFieldFocused: boolean
): IssueEditorEscapeTarget {
  if (textOverlayFocused) return "text-overlay";
  if (formFieldFocused) return "form-field";
  return "editor";
}

/**
 * 判断单行输入框的按键是否应触发「保存并继续」提交：
 * 仅当按下 Enter 且不在输入法组词状态时返回 true。
 * keyCode 229 是部分浏览器在 IME 组合期间上报的兼容值（isComposing 不可靠时兜底），
 * 避免中文输入法确认候选词时误提交。
 */
export function isEnterCommitKey(e: {
  key: string;
  isComposing?: boolean;
  keyCode?: number;
}): boolean {
  if (e.key !== "Enter") return false;
  if (e.isComposing) return false;
  if (e.keyCode === 229) return false;
  return true;
}

/**
 * 问题现场编辑器。
 * 这是一个覆盖全屏的 UI 组件，允许用户在截图上进行圈选、添加批注、
 * 描述问题现象并提交记录。
 */
export class IssueEditor {
  private editorElement: HTMLDivElement | undefined;
  private keydownListener: ((e: KeyboardEvent) => void) | undefined;

  constructor(private readonly deps: IssueEditorDeps) {}

  get isOpen(): boolean {
    return Boolean(this.editorElement);
  }
  get element(): HTMLDivElement | undefined {
    return this.editorElement;
  }

  close(restoreWidget = true): void {
    if (this.keydownListener) {
      window.removeEventListener("keydown", this.keydownListener, true);
      this.keydownListener = undefined;
    }
    this.editorElement?.remove();
    this.editorElement = undefined;
    if (restoreWidget) this.deps.onClose(true);
  }

  /**
   * 打开问题现场编辑器并渲染对应的截图和控制面板。
   *
   * @param scene 当前要编辑的问题场景数据（包含初始标注点等）
   * @param dataUrl 截图的 Base64 URL（如果有的话）
   */
  open(scene: IssueSceneInit, dataUrl?: string): void {
    const session = this.deps.getSession();
    if (!session) return;
    const shortcutKeyText = this.deps.isMac ? "Option+S" : "Alt+S";

    const root = document.createElement("div");
    root.id = "__wbr_issue_editor__";
    root.className = "__wbr_issue_editor_modal__";
    Object.assign(root.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      background: "rgba(10, 13, 18, 0.88)",
      color: "#1d2129",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif`,
    });
    root.innerHTML = `<style>
      #__wbr_issue_editor__ textarea,
      #__wbr_issue_editor__ input {
        background: #f7f8fa !important;
        border: 1px solid #e5e6eb !important;
        color: #1d2129 !important;
        border-radius: 2px !important;
        transition: all 0.15s ease !important;
      }
      #__wbr_issue_editor__ textarea::placeholder,
      #__wbr_issue_editor__ input::placeholder {
        color: #8c97a8 !important;
      }
      #__wbr_issue_editor__ textarea:focus,
      #__wbr_issue_editor__ input:focus {
        border-color: #165dff !important;
        background: #ffffff !important;
        box-shadow: 0 0 0 2px rgba(22, 93, 255, 0.15) !important;
      }
      #__wbr_issue_editor__ .__wbr_issue_action {
        transition: all 0.15s ease !important;
        border-radius: 2px !important;
      }
      #__wbr_issue_editor__ .__wbr_issue_action:hover:not(:disabled) {
        opacity: 0.9;
        transform: translateY(-1px);
      }
      #__wbr_issue_editor__ .__wbr_issue_action:active:not(:disabled) {
        transform: translateY(0);
      }
      #__wbr_issue_editor__ .__wbr_issue_action:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    </style>
    <div style="position:absolute;top:14px;left:50%;transform:translateX(-50%);z-index:30;background:rgba(255,255,255,0.72);backdrop-filter:blur(14px);border:1px solid rgba(229,230,235,0.9);border-radius:4px;box-shadow:0 2px 10px rgba(0,0,0,0.08);padding:3px 6px;display:flex;align-items:center;gap:6px">
      <div style="display:flex;align-items:center;gap:2px">
        <button data-issue-tool="none" class="__wbr_issue_action __wbr_tool_btn" style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:22px;background:#165dff;color:#ffffff;border:1px solid #165dff;border-radius:3px;cursor:pointer;padding:0;flex-shrink:0" title="${t("issueToolBrowse")}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
        <button data-issue-tool="rect" class="__wbr_issue_action __wbr_tool_btn" style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:22px;background:transparent;color:#5f6b7c;border:1px solid transparent;border-radius:3px;cursor:pointer;padding:0;flex-shrink:0" title="${t("issueToolRect")}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
        </button>
        <button data-issue-tool="arrow" class="__wbr_issue_action __wbr_tool_btn" style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:22px;background:transparent;color:#5f6b7c;border:1px solid transparent;border-radius:3px;cursor:pointer;padding:0;flex-shrink:0" title="${t("issueToolArrow")}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="19" x2="19" y2="5"/><polyline points="12 5 19 5 19 12"/></svg>
        </button>
        <button data-issue-tool="text" class="__wbr_issue_action __wbr_tool_btn" style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:22px;background:transparent;color:#5f6b7c;border:1px solid transparent;border-radius:3px;cursor:pointer;padding:0;flex-shrink:0" title="${t("issueToolText")}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="12" y1="4" x2="12" y2="20"/><line x1="9" y1="20" x2="15" y2="20"/></svg>
        </button>
      </div>
      <div style="height:12px;width:1px;background:rgba(229,230,235,0.8)"></div>
      <div style="display:flex;align-items:center;gap:2px">
        <button data-issue-tool-undo class="__wbr_issue_action" style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:22px;background:transparent;color:#1d2129;border:1px solid transparent;border-radius:3px;cursor:pointer;padding:0;flex-shrink:0" title="${t("undo")}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/></svg>
        </button>
        <button data-issue-tool-redo class="__wbr_issue_action" style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:22px;background:transparent;color:#1d2129;border:1px solid transparent;border-radius:3px;cursor:pointer;padding:0;flex-shrink:0" title="${t("redo")}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14l5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5v0A5.5 5.5 0 0 0 9.5 20H13"/></svg>
        </button>
      </div>
      <div style="height:12px;width:1px;background:rgba(229,230,235,0.8)"></div>
      <div style="display:flex;align-items:center;gap:2px">
        <button data-issue-reselect class="__wbr_issue_action" style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:22px;background:transparent;color:#5f6b7c;border:1px solid transparent;border-radius:3px;cursor:pointer;padding:0;flex-shrink:0" title="${t("issueReselect")}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
        </button>
        <button data-issue-cancel class="__wbr_issue_action" style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:22px;background:transparent;color:#5f6b7c;border:1px solid transparent;border-radius:3px;cursor:pointer;padding:0;flex-shrink:0;font-size:12px" title="${t("issueCancelClose")}">✕</button>
      </div>
    </div>
    <div style="width:100vw;height:100vh;display:flex;align-items:center;justify-content:center;padding:52px 12px 24px;box-sizing:border-box;overflow:hidden;position:relative">
      <div data-issue-canvas style="position:relative;display:inline-block;max-width:100%;max-height:100%;border-radius:2px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.15);background:#06080c">
        <img data-issue-image alt="${t("issueOriginalImageAlt")}" style="display:block;max-width:calc(100vw - 24px);max-height:calc(100vh - 80px);object-fit:contain" draggable="false">
        <svg data-issue-svg viewBox="0 0 1000 1000" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;touch-action:none"></svg>
      </div>
    </div>
    <div data-issue-control-card style="position:fixed;z-index:30;width:min(calc(100vw - 32px),640px);background:rgba(255,255,255,0.96);backdrop-filter:blur(20px);border:1px solid #e5e6eb;border-radius:2px;box-shadow:0 8px 30px rgba(0,0,0,0.18);padding:10px 12px;display:flex;flex-direction:column;gap:8px;transition:top 0.15s ease-out, left 0.15s ease-out">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <input data-issue-actual placeholder="${t("issueActualPlaceholder")}" style="width:100%;box-sizing:border-box;height:34px;padding:0 10px;font-size:12px;font-family:inherit;outline:none;border-radius:2px">
        <input data-issue-expected placeholder="${t("issueExpectedPlaceholder")}" style="width:100%;box-sizing:border-box;height:34px;padding:0 10px;font-size:12px;font-family:inherit;outline:none;border-radius:2px">
      </div>
      <label style="display:flex;flex-direction:column;gap:4px;font-size:11px;font-weight:500;color:#5f6b7c">
        ${t("issueNoteLabel")}
        <textarea data-issue-note rows="2" placeholder="${t("issueNotePlaceholder")}" style="width:100%;box-sizing:border-box;padding:6px 8px;font-size:12px;font-family:inherit;resize:none;outline:none;border-radius:2px"></textarea>
      </label>
      <div style="display:flex;align-items:center;gap:8px">
        <div data-issue-drag-handle style="display:flex;align-items:center;justify-content:center;cursor:grab;padding:0 2px;color:#8c97a8;user-select:none;touch-action:none" title="${t("issueDragHandleTitle")}">
          <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor"><circle cx="3" cy="3" r="1.5"/><circle cx="7" cy="3" r="1.5"/><circle cx="3" cy="8" r="1.5"/><circle cx="7" cy="8" r="1.5"/><circle cx="3" cy="13" r="1.5"/><circle cx="7" cy="13" r="1.5"/></svg>
        </div>
        <div style="flex:1"></div>
        <button data-issue-save class="__wbr_issue_action" style="display:inline-flex;align-items:center;gap:4px;background:#165dff;color:#ffffff;border:1px solid #165dff;border-radius:2px;height:32px;padding:0 14px;font-size:12px;font-weight:500;cursor:pointer;white-space:nowrap">${t("issueSaveContinue")}</button>
        <button data-issue-save-stop class="__wbr_issue_action" style="display:inline-flex;align-items:center;gap:4px;background:#f2f3f5;color:#4e5969;border:1px solid #e5e6eb;border-radius:2px;height:32px;padding:0 12px;font-size:12px;font-weight:500;cursor:pointer;white-space:nowrap" title="${t("issueSaveStopTitle")}">${t("issueSaveStop")}</button>
      </div>
      <div data-issue-error style="color:#b42318;font-size:12px;padding:6px 10px;border-radius:2px;background:#fde3df;border:1px solid #f99f95;display:none"></div>
    </div>`;
    document.documentElement.appendChild(root);
    this.editorElement = root;
    const image = root.querySelector<HTMLImageElement>("[data-issue-image]")!;
    if (dataUrl) image.src = dataUrl;
    const svg = root.querySelector<SVGSVGElement>("[data-issue-svg]")!;
    const annotation: AnnotationModel = {
      ...scene.annotation,
      point: { ...scene.annotation.point },
      targetBox: scene.annotation.targetBox
        ? { ...scene.annotation.targetBox }
        : undefined,
    };
    this.renderAnnotation(svg, annotation);

    // ─── Control Card Positioning & Drag ───
    const controlCard = root.querySelector<HTMLElement>(
      "[data-issue-control-card]"
    )!;
    let userMovedCard = false;
    let cardDragging = false;
    let cardStartX = 0;
    let cardStartY = 0;
    let cardInitialLeft = 0;
    let cardInitialTop = 0;

    const dragHandle = root.querySelector<HTMLElement>(
      "[data-issue-drag-handle]"
    );
    dragHandle?.addEventListener("pointerdown", (event) => {
      cardDragging = true;
      userMovedCard = true;
      dragHandle.setPointerCapture(event.pointerId);
      dragHandle.style.cursor = "grabbing";
      controlCard.style.transition = "none";
      cardStartX = event.clientX;
      cardStartY = event.clientY;
      cardInitialLeft = controlCard.offsetLeft;
      cardInitialTop = controlCard.offsetTop;
      event.preventDefault();
    });
    dragHandle?.addEventListener("pointermove", (event) => {
      if (!cardDragging) return;
      const dx = event.clientX - cardStartX;
      const dy = event.clientY - cardStartY;
      const newLeft = Math.max(
        8,
        Math.min(
          window.innerWidth - controlCard.offsetWidth - 8,
          cardInitialLeft + dx
        )
      );
      const newTop = Math.max(
        8,
        Math.min(
          window.innerHeight - controlCard.offsetHeight - 8,
          cardInitialTop + dy
        )
      );
      controlCard.style.left = `${newLeft}px`;
      controlCard.style.top = `${newTop}px`;
    });
    dragHandle?.addEventListener("pointerup", () => {
      if (!cardDragging) return;
      cardDragging = false;
      dragHandle.style.cursor = "grab";
      controlCard.style.transition = "top 0.15s ease-out, left 0.15s ease-out";
    });

    const positionControlCard = () => {
      if (!controlCard || !svg || userMovedCard) return;
      const rect = svg.getBoundingClientRect();
      const box = annotation.targetBox;
      const targetX = box
        ? box.xRatio + box.widthRatio / 2
        : annotation.point.xRatio;
      const targetYBottom = box
        ? box.yRatio + box.heightRatio
        : annotation.point.yRatio;
      const targetYTop = box ? box.yRatio : annotation.point.yRatio;
      const targetPxX = rect.left + targetX * rect.width;
      const targetPxYBottom = rect.top + targetYBottom * rect.height;
      const targetPxYTop = rect.top + targetYTop * rect.height;
      const cardWidth = controlCard.offsetWidth || 560;
      const cardHeight = controlCard.offsetHeight || 60;
      let left = targetPxX - cardWidth / 2;
      left = Math.max(16, Math.min(window.innerWidth - cardWidth - 16, left));
      let top = targetPxYBottom + 14;
      if (top + cardHeight > window.innerHeight - 16) {
        top = targetPxYTop - cardHeight - 14;
      }
      top = Math.max(64, Math.min(window.innerHeight - cardHeight - 16, top));
      Object.assign(controlCard.style, { left: `${left}px`, top: `${top}px` });
    };
    image.addEventListener("load", positionControlCard);
    window.addEventListener("resize", positionControlCard);
    requestAnimationFrame(positionControlCard);

    const actualInput = root.querySelector<HTMLInputElement>(
      "[data-issue-actual]"
    );
    // A2 前置回填：速记卡确认的期望已在 capture 阶段落库，打开编辑器时
    // 回填到输入框，用户只需确认或微调。
    const expectedInput = root.querySelector<HTMLInputElement>(
      "[data-issue-expected]"
    );
    const backfillExpected = scene.narrative?.expected?.text?.trim();
    if (expectedInput && backfillExpected) {
      expectedInput.value = backfillExpected;
    }
    setTimeout(() => actualInput?.focus(), 50);

    // ─── Drawing Tools ───
    annotation.userAnnotations = annotation.userAnnotations || [];
    let activeTool: "none" | "rect" | "arrow" | "text" = "none";
    let isDrawingUserAnnotation = false;
    let drawStartXRatio = 0;
    let drawStartYRatio = 0;

    const toolButtons =
      root.querySelectorAll<HTMLButtonElement>("[data-issue-tool]");
    toolButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const tool = btn.getAttribute("data-issue-tool") as
          "none" | "rect" | "arrow" | "text";
        activeTool = tool;
        toolButtons.forEach((b) => {
          const isCurrent = b === btn;
          b.style.background = isCurrent ? "#165dff" : "transparent";
          b.style.color = isCurrent ? "#ffffff" : "#5f6b7c";
          b.style.borderColor = isCurrent ? "#165dff" : "transparent";
        });
        svg.style.cursor = activeTool === "none" ? "default" : "crosshair";
      });
    });

    // ─── Undo/Redo ───
    const redoStack: any[] = [];
    const undoBtn = root.querySelector<HTMLButtonElement>(
      "[data-issue-tool-undo]"
    );
    const redoBtn = root.querySelector<HTMLButtonElement>(
      "[data-issue-tool-redo]"
    );
    const updateUndoRedoStatus = () => {
      const hasUndo = Boolean(annotation.userAnnotations?.length);
      const hasRedo = Boolean(redoStack.length);
      if (undoBtn) {
        undoBtn.disabled = !hasUndo;
        undoBtn.style.color = hasUndo ? "#1d2129" : "#c0c6d0";
        undoBtn.style.background = "transparent";
        undoBtn.style.cursor = hasUndo ? "pointer" : "not-allowed";
        undoBtn.style.opacity = "1";
      }
      if (redoBtn) {
        redoBtn.disabled = !hasRedo;
        redoBtn.style.color = hasRedo ? "#1d2129" : "#c0c6d0";
        redoBtn.style.background = "transparent";
        redoBtn.style.cursor = hasRedo ? "pointer" : "not-allowed";
        redoBtn.style.opacity = "1";
      }
    };
    updateUndoRedoStatus();
    const handleUndo = () => {
      if (annotation.userAnnotations?.length) {
        const popped = annotation.userAnnotations.pop();
        if (popped) redoStack.push(popped);
        this.renderAnnotation(svg, annotation);
        updateUndoRedoStatus();
      }
    };
    const handleRedo = () => {
      if (redoStack.length) {
        const item = redoStack.pop();
        if (item) {
          annotation.userAnnotations!.push(item);
          this.renderAnnotation(svg, annotation);
          updateUndoRedoStatus();
        }
      }
    };
    undoBtn?.addEventListener("click", handleUndo);
    redoBtn?.addEventListener("click", handleRedo);

    const undoShortcutText = this.deps.isMac ? "⌘Z" : "Ctrl+Z";
    const redoShortcutText = this.deps.isMac ? "⇧⌘Z" : "Ctrl+Shift+Z";
    if (undoBtn) undoBtn.title = `${t("undo")} (${undoShortcutText})`;
    if (redoBtn) redoBtn.title = `${t("redo")} (${redoShortcutText})`;

    this.keydownListener = (e: KeyboardEvent) => {
      // 模态一致性（第一性原理）：全应用覆盖层均支持 Esc 取消当前层，本编辑器是
      // 唯一缺失项；且未拦截的 Esc 会穿透到页面，触发网页自身的 Esc 快捷键，
      // 在扩展全屏编辑器之下悄悄改变被遮挡页面的状态。
      if (e.key === "Escape") {
        const activeEl = document.activeElement;
        const target = resolveEscapeTarget(
          activeEl === textInputOverlay,
          activeEl === actualInput ||
            activeEl === expectedInput ||
            (activeEl?.tagName === "TEXTAREA" && root.contains(activeEl))
        );
        e.preventDefault();
        e.stopPropagation();
        if (target === "text-overlay") {
          removeTextInputOverlay();
        } else if (target === "form-field") {
          (activeEl as HTMLElement).blur();
        } else {
          cancel();
        }
        return;
      }
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;
      if (!isCmdOrCtrl) return;
      const activeEl = document.activeElement;
      const isTyping =
        activeEl &&
        (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA");
      const isZ = e.key === "z" || e.key === "Z";
      const isY = e.key === "y" || e.key === "Y";
      if (isZ && e.shiftKey) {
        if (!isTyping) {
          e.preventDefault();
          handleRedo();
        }
      } else if (isZ && !e.shiftKey) {
        if (!isTyping) {
          e.preventDefault();
          handleUndo();
        }
      } else if (isY && !e.shiftKey) {
        if (!isTyping) {
          e.preventDefault();
          handleRedo();
        }
      }
    };
    window.addEventListener("keydown", this.keydownListener, true);

    // ─── SVG Drawing ───
    let textInputOverlay: HTMLInputElement | undefined;
    const removeTextInputOverlay = () => {
      if (textInputOverlay) {
        textInputOverlay.remove();
        textInputOverlay = undefined;
      }
    };
    let targetHandleDragging = false;

    svg.addEventListener("pointerdown", (event) => {
      const isHandle = Boolean(
        (event.target as Element).closest("[data-issue-handle]")
      );
      if (activeTool === "none" && isHandle) {
        targetHandleDragging = true;
        svg.setPointerCapture(event.pointerId);
        event.preventDefault();
        return;
      }
      if (activeTool === "rect" || activeTool === "arrow") {
        removeTextInputOverlay();
        const rect = svg.getBoundingClientRect();
        drawStartXRatio = Math.min(
          1,
          Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width))
        );
        drawStartYRatio = Math.min(
          1,
          Math.max(0, (event.clientY - rect.top) / Math.max(1, rect.height))
        );
        isDrawingUserAnnotation = true;
        svg.setPointerCapture(event.pointerId);
        event.preventDefault();
      } else if (activeTool === "text") {
        removeTextInputOverlay();
        const rect = svg.getBoundingClientRect();
        const clickXRatio = Math.min(
          1,
          Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width))
        );
        const clickYRatio = Math.min(
          1,
          Math.max(0, (event.clientY - rect.top) / Math.max(1, rect.height))
        );
        const input = document.createElement("input");
        input.type = "text";
        input.placeholder = t("issueTextAnnotationPlaceholder");
        Object.assign(input.style, {
          position: "absolute",
          left: `${event.clientX - root.getBoundingClientRect().left}px`,
          top: `${event.clientY - root.getBoundingClientRect().top - 14}px`,
          zIndex: "40",
          background: "rgba(255, 255, 255, 0.95)",
          color: "#165dff",
          border: "1px solid #165dff",
          borderRadius: "2px",
          padding: "2px 6px",
          fontSize: "13px",
          fontWeight: "600",
          outline: "none",
          boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
          minWidth: "100px",
        });
        root.appendChild(input);
        textInputOverlay = input;
        setTimeout(() => input.focus(), 10);
        const submitText = () => {
          const val = input.value.trim();
          if (val) {
            annotation.userAnnotations!.push({
              type: "text",
              color: "#165dff",
              xRatio: clickXRatio,
              yRatio: clickYRatio,
              text: val,
            });
            redoStack.length = 0;
            this.renderAnnotation(svg, annotation);
            updateUndoRedoStatus();
          }
          removeTextInputOverlay();
        };
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submitText();
          } else if (e.key === "Escape") {
            removeTextInputOverlay();
          }
        });
        input.addEventListener("blur", () => {
          submitText();
        });
      }
    });

    svg.addEventListener("pointermove", (event) => {
      const rect = svg.getBoundingClientRect();
      if (targetHandleDragging && activeTool === "none") {
        annotation.point = {
          xRatio: Math.min(
            1,
            Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width))
          ),
          yRatio: Math.min(
            1,
            Math.max(0, (event.clientY - rect.top) / Math.max(1, rect.height))
          ),
        };
        this.renderAnnotation(svg, annotation);
        positionControlCard();
        return;
      }
      if (isDrawingUserAnnotation) {
        const curXRatio = Math.min(
          1,
          Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width))
        );
        const curYRatio = Math.min(
          1,
          Math.max(0, (event.clientY - rect.top) / Math.max(1, rect.height))
        );
        this.renderAnnotation(svg, annotation, {
          type: activeTool as "rect" | "arrow",
          startX: drawStartXRatio * 1000,
          startY: drawStartYRatio * 1000,
          currentX: curXRatio * 1000,
          currentY: curYRatio * 1000,
        });
      }
    });

    svg.addEventListener("pointerup", (event) => {
      if (targetHandleDragging) {
        targetHandleDragging = false;
      }
      if (isDrawingUserAnnotation) {
        isDrawingUserAnnotation = false;
        const rect = svg.getBoundingClientRect();
        const endXRatio = Math.min(
          1,
          Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width))
        );
        const endYRatio = Math.min(
          1,
          Math.max(0, (event.clientY - rect.top) / Math.max(1, rect.height))
        );
        const dx = Math.abs(endXRatio - drawStartXRatio);
        const dy = Math.abs(endYRatio - drawStartYRatio);
        if (dx > 0.005 || dy > 0.005) {
          if (activeTool === "rect") {
            annotation.userAnnotations!.push({
              type: "rect",
              color: "#165dff",
              xRatio: Math.min(drawStartXRatio, endXRatio),
              yRatio: Math.min(drawStartYRatio, endYRatio),
              widthRatio: Math.abs(endXRatio - drawStartXRatio),
              heightRatio: Math.abs(endYRatio - drawStartYRatio),
            });
          } else if (activeTool === "arrow") {
            annotation.userAnnotations!.push({
              type: "arrow",
              color: "#165dff",
              startXRatio: drawStartXRatio,
              startYRatio: drawStartYRatio,
              endXRatio,
              endYRatio,
            });
          }
          redoStack.length = 0;
          updateUndoRedoStatus();
        }
        this.renderAnnotation(svg, annotation);
      }
    });

    // ─── Form & Commit ───
    const error = root.querySelector<HTMLElement>("[data-issue-error]")!;
    const setError = (msg: string) => {
      error.textContent = msg || "";
      error.style.display = msg ? "block" : "none";
      error.style.color = "#b42318";
      error.style.background = "#fde3df";
      error.style.borderColor = "#f99f95";
    };
    const setWarning = (msg: string) => {
      error.textContent = msg;
      error.style.display = "block";
      error.style.color = "#9a6700";
      error.style.background = "#fff7e6";
      error.style.borderColor = "#ffd591";
    };
    const cancel = () => {
      window.removeEventListener("resize", positionControlCard);
      void chrome.runtime.sendMessage(
        message(
          "issue-scene/cancel",
          { issueSceneId: scene.id, nonce: session.nonce },
          session.sessionId
        )
      );
      this.close();
    };
    root
      .querySelector("[data-issue-cancel]")
      ?.addEventListener("click", cancel);
    root
      .querySelector("[data-issue-reselect]")
      ?.addEventListener("click", () => {
        cancel();
        this.deps.onReselect();
      });
    // P1 完整性兜底：实际表现为空时首次点击提示并聚焦，再次点击确认按空记录保存。
    let emptyActualWarned = false;
    const commit = (stopAfterCommit: boolean) => {
      const actual = (actualInput?.value ?? "").trim();
      if (shouldWarnEmptyActual(actual, emptyActualWarned)) {
        emptyActualWarned = true;
        setWarning(t("issueEmptyActualWarning"));
        actualInput?.focus();
        return;
      }
      const expectedText = root.querySelector<HTMLInputElement>(
        "[data-issue-expected]"
      )!.value;
      const note =
        root.querySelector<HTMLTextAreaElement>("[data-issue-note]")!.value;
      root.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
        button.disabled = true;
      });
      void chrome.runtime
        .sendMessage(
          message(
            "issue-scene/commit",
            {
              issueSceneId: scene.id,
              nonce: session.nonce,
              narrative: {
                actual,
                // A3 结构化提交：编辑器中的期望视为用户显式表达（explicit）
                expected: expectedText.trim()
                  ? { text: expectedText.trim(), confidence: "explicit" }
                  : undefined,
                note,
              },
              annotation,
              stopAfterCommit,
            },
            session.sessionId
          )
        )
        .then((response) => {
          if (!response?.ok) {
            setError(
              t("issueSaveFailed", response?.error ?? t("unknownError"))
            );
            root
              .querySelectorAll<HTMLButtonElement>("button")
              .forEach((button) => {
                button.disabled = false;
              });
            return;
          }
          window.removeEventListener("resize", positionControlCard);
          this.close(!stopAfterCommit);
          if (stopAfterCommit) this.deps.onStopAfterCommit();
        })
        .catch((failure) => {
          setError(t("issueSaveFailed", String(failure)));
          root
            .querySelectorAll<HTMLButtonElement>("button")
            .forEach((button) => {
              button.disabled = false;
            });
        });
    };
    root
      .querySelector("[data-issue-save]")
      ?.addEventListener("click", () => commit(false));
    root
      .querySelector("[data-issue-save-stop]")
      ?.addEventListener("click", () => commit(true));

    // 键盘一致性（与截图 overlay 的 Enter 确认快捷键保持同一交互语言）：
    // 单行输入框内按 Enter 直接触发主操作「保存并继续」，省去打字后
    // 移鼠标瞄准按钮的往返；提交进行中（按钮已禁用）忽略连按，防止重复提交。
    const saveBtnEl =
      root.querySelector<HTMLButtonElement>("[data-issue-save]");
    const onSingleLineEnter = (e: KeyboardEvent) => {
      if (!isEnterCommitKey(e)) return;
      e.preventDefault();
      if (saveBtnEl?.disabled) return;
      commit(false);
    };
    actualInput?.addEventListener("keydown", onSingleLineEnter);
    expectedInput?.addEventListener("keydown", onSingleLineEnter);
  }

  // ─── SVG Rendering ───

  private renderAnnotation(
    svg: SVGSVGElement,
    annotation: AnnotationModel,
    activeDrawing?: ActiveDrawing
  ): void {
    const boxes = annotation.targetBoxes?.length
      ? annotation.targetBoxes
      : annotation.targetBox
        ? [annotation.targetBox]
        : [];
    let boxMarkup = boxes
      .map(
        (box) =>
          `<rect data-issue-handle="true" x="${box.xRatio * 1000}" y="${box.yRatio * 1000}" width="${box.widthRatio * 1000}" height="${box.heightRatio * 1000}" rx="2" ry="2" fill="none" stroke="#ef233c" stroke-width="3" vector-effect="non-scaling-stroke" style="cursor:move"></rect>`
      )
      .join("");
    const defs = `<defs><marker id="user-arrow-head" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#165dff"/></marker></defs>`;
    const rect = svg.getBoundingClientRect();
    const scaleX = rect.width > 0 ? 1000 / rect.width : 1;
    const scaleY = rect.height > 0 ? 1000 / rect.height : 1;
    let userMarkup = "";
    if (annotation.userAnnotations?.length) {
      for (const item of annotation.userAnnotations) {
        const color = item.color || "#165dff";
        if (item.type === "rect") {
          userMarkup += `<rect x="${item.xRatio * 1000}" y="${item.yRatio * 1000}" width="${item.widthRatio * 1000}" height="${item.heightRatio * 1000}" rx="2" ry="2" fill="none" stroke="${color}" stroke-width="3" vector-effect="non-scaling-stroke"></rect>`;
        } else if (item.type === "arrow") {
          userMarkup += `<line x1="${item.startXRatio * 1000}" y1="${item.startYRatio * 1000}" x2="${item.endXRatio * 1000}" y2="${item.endYRatio * 1000}" stroke="${color}" stroke-width="3" vector-effect="non-scaling-stroke" marker-end="url(#user-arrow-head)"></line>`;
        } else if (item.type === "text" && item.text) {
          const textEsc = item.text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
          userMarkup += `<g transform="translate(${item.xRatio * 1000}, ${item.yRatio * 1000}) scale(${scaleX}, ${scaleY})"><text x="0" y="0" fill="${color}" font-size="16" font-weight="700" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif">${textEsc}</text></g>`;
        }
      }
    }
    let activeMarkup = "";
    if (activeDrawing) {
      const {
        startX: sx,
        startY: sy,
        currentX: cx,
        currentY: cy,
      } = activeDrawing;
      if (activeDrawing.type === "rect") {
        activeMarkup = `<rect x="${Math.min(sx, cx)}" y="${Math.min(sy, cy)}" width="${Math.abs(cx - sx)}" height="${Math.abs(cy - sy)}" rx="2" ry="2" fill="none" stroke="#165dff" stroke-width="3" stroke-dasharray="4,4" vector-effect="non-scaling-stroke"></rect>`;
      } else if (activeDrawing.type === "arrow") {
        activeMarkup = `<line x1="${sx}" y1="${sy}" x2="${cx}" y2="${cy}" stroke="#165dff" stroke-width="3" stroke-dasharray="4,4" vector-effect="non-scaling-stroke" marker-end="url(#user-arrow-head)"></line>`;
      }
    }
    svg.innerHTML = defs + boxMarkup + userMarkup + activeMarkup;
  }
}
