import { message, type AnnotationModel } from "../../../shared/protocol";
import { t } from "../../../shared/i18n";

type ActiveDrawing = { type: "rect" | "arrow"; startX: number; startY: number; currentX: number; currentY: number };

export type IssueSceneInit = {
  id: string;
  page: { viewport: { width: number; height: number } };
  annotation: AnnotationModel;
};

export type IssueEditorDeps = {
  getSession(): { sessionId: string; nonce: string } | undefined;
  onClose(restoreWidget: boolean): void;
  onReselect(): void;
  onStopAfterCommit(): void;
  isMac: boolean;
};

export class IssueEditor {
  private editorElement: HTMLDivElement | undefined;
  private keydownListener: ((e: KeyboardEvent) => void) | undefined;

  constructor(private readonly deps: IssueEditorDeps) {}

  get isOpen(): boolean { return Boolean(this.editorElement); }
  get element(): HTMLDivElement | undefined { return this.editorElement; }

  close(restoreWidget = true): void {
    if (this.keydownListener) {
      window.removeEventListener("keydown", this.keydownListener, true);
      this.keydownListener = undefined;
    }
    this.editorElement?.remove();
    this.editorElement = undefined;
    if (restoreWidget) this.deps.onClose(true);
  }

  open(scene: IssueSceneInit, dataUrl?: string): void {
    const session = this.deps.getSession();
    if (!session) return;
    const shortcutKeyText = this.deps.isMac ? "Option+S" : "Alt+S";

    const root = document.createElement("div");
    root.id = "__wbr_issue_editor__";
    root.className = "__wbr_issue_editor_modal__";
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
    <div style="position:absolute;top:18px;left:50%;transform:translateX(-50%);z-index:30;background:rgba(255,255,255,0.96);backdrop-filter:blur(16px);border:1px solid #e5e6eb;border-radius:4px;box-shadow:0 4px 16px rgba(0,0,0,0.12);padding:4px 8px;display:flex;align-items:center;gap:8px">
      <div style="display:flex;align-items:center;gap:3px">
        <button data-issue-tool="none" class="__wbr_issue_action __wbr_tool_btn" style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:26px;background:#165dff;color:#ffffff;border:1px solid #165dff;border-radius:3px;cursor:pointer;padding:0;flex-shrink:0" title="浏览模式 (查看)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
        <button data-issue-tool="rect" class="__wbr_issue_action __wbr_tool_btn" style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:26px;background:#ffffff;color:#1d2129;border:1px solid #e5e6eb;border-radius:3px;cursor:pointer;padding:0;flex-shrink:0" title="绘制矩形框">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
        </button>
        <button data-issue-tool="arrow" class="__wbr_issue_action __wbr_tool_btn" style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:26px;background:#ffffff;color:#1d2129;border:1px solid #e5e6eb;border-radius:3px;cursor:pointer;padding:0;flex-shrink:0" title="绘制箭头">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="19" x2="19" y2="5"/><polyline points="12 5 19 5 19 12"/></svg>
        </button>
        <button data-issue-tool="text" class="__wbr_issue_action __wbr_tool_btn" style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:26px;background:#ffffff;color:#1d2129;border:1px solid #e5e6eb;border-radius:3px;cursor:pointer;padding:0;flex-shrink:0" title="添加文字批注">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="12" y1="4" x2="12" y2="20"/><line x1="9" y1="20" x2="15" y2="20"/></svg>
        </button>
      </div>
      <div style="height:12px;width:1px;background:#e5e6eb"></div>
      <div style="display:flex;align-items:center;gap:3px">
        <button data-issue-tool-undo class="__wbr_issue_action" style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:26px;background:#ffffff;color:#1d2129;border:1px solid #e5e6eb;border-radius:3px;cursor:pointer;padding:0;flex-shrink:0" title="${t("undo")}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/></svg>
        </button>
        <button data-issue-tool-redo class="__wbr_issue_action" style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:26px;background:#ffffff;color:#1d2129;border:1px solid #e5e6eb;border-radius:3px;cursor:pointer;padding:0;flex-shrink:0" title="${t("redo")}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14l5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5v0A5.5 5.5 0 0 0 9.5 20H13"/></svg>
        </button>
      </div>
      <div style="height:12px;width:1px;background:#e5e6eb"></div>
      <div style="display:flex;align-items:center;gap:3px">
        <button data-issue-reselect class="__wbr_issue_action" style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:26px;background:#ffffff;color:#1d2129;border:1px solid #e5e6eb;border-radius:3px;cursor:pointer;padding:0;flex-shrink:0" title="重新选择元素">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
        </button>
        <button data-issue-cancel class="__wbr_issue_action" style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:26px;background:#ffffff;color:#5f6b7c;border:1px solid #e5e6eb;border-radius:3px;cursor:pointer;padding:0;flex-shrink:0;font-size:13px" title="取消关闭">✕</button>
      </div>
    </div>
    <div style="width:100vw;height:100vh;display:flex;align-items:center;justify-content:center;padding:52px 12px 24px;box-sizing:border-box;overflow:hidden;position:relative">
      <div data-issue-canvas style="position:relative;display:inline-block;max-width:100%;max-height:100%;border-radius:2px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.15);background:#06080c">
        <img data-issue-image alt="问题现场原图" style="display:block;max-width:calc(100vw - 24px);max-height:calc(100vh - 80px);object-fit:contain" draggable="false">
        <svg data-issue-svg viewBox="0 0 1000 1000" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;touch-action:none"></svg>
      </div>
    </div>
    <div data-issue-control-card style="position:fixed;z-index:30;width:min(calc(100vw - 32px),640px);background:rgba(255,255,255,0.96);backdrop-filter:blur(20px);border:1px solid #e5e6eb;border-radius:2px;box-shadow:0 8px 30px rgba(0,0,0,0.18);padding:10px 12px;display:flex;flex-direction:column;gap:8px;transition:top 0.15s ease-out, left 0.15s ease-out">
      <div data-issue-details-box style="display:none;flex-direction:column;gap:8px;padding-bottom:6px;border-bottom:1px solid #e5e6eb">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <label style="display:flex;flex-direction:column;gap:4px;font-size:11px;font-weight:500;color:#5f6b7c">
            预期表现
            <textarea data-issue-expected rows="2" placeholder="例如：应显示成功提示" style="width:100%;box-sizing:border-box;padding:6px 8px;font-size:12px;font-family:inherit;resize:none;outline:none;border-radius:2px"></textarea>
          </label>
          <label style="display:flex;flex-direction:column;gap:4px;font-size:11px;font-weight:500;color:#5f6b7c">
            截图短标签 (可选)
            <input data-issue-label maxlength="80" placeholder="例如：登陆页表单" style="width:100%;box-sizing:border-box;padding:6px 8px;font-size:12px;font-family:inherit;outline:none;border-radius:2px">
          </label>
        </div>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:11px;font-weight:500;color:#5f6b7c">
          补充说明
          <textarea data-issue-note rows="2" placeholder="补充上下文" style="width:100%;box-sizing:border-box;padding:6px 8px;font-size:12px;font-family:inherit;resize:none;outline:none;border-radius:2px"></textarea>
        </label>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <div data-issue-drag-handle style="display:flex;align-items:center;justify-content:center;cursor:grab;padding:0 2px;color:#8c97a8;user-select:none;touch-action:none" title="按住拖拽拖动面板">
          <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor"><circle cx="3" cy="3" r="1.5"/><circle cx="7" cy="3" r="1.5"/><circle cx="3" cy="8" r="1.5"/><circle cx="7" cy="8" r="1.5"/><circle cx="3" cy="13" r="1.5"/><circle cx="7" cy="13" r="1.5"/></svg>
        </div>
        <input data-issue-actual placeholder="描述问题实际表现 (例如：点击无反应)" style="flex:1;height:34px;box-sizing:border-box;padding:0 10px;font-size:12px;font-family:inherit;outline:none;border-radius:2px">
        <button data-issue-toggle-more class="__wbr_issue_action" style="display:inline-flex;align-items:center;gap:3px;background:transparent;color:#5f6b7c;border:1px solid #e5e6eb;border-radius:2px;height:34px;padding:0 8px;font-size:12px;font-weight:500;cursor:pointer;white-space:nowrap">详细 ▾</button>
        <button data-issue-save class="__wbr_issue_action" style="display:inline-flex;align-items:center;gap:4px;background:#ffffff;color:#1d2129;border:1px solid #e5e6eb;border-radius:2px;height:34px;padding:0 10px;font-size:12px;font-weight:500;cursor:pointer;white-space:nowrap">保存并继续</button>
        <button data-issue-save-stop class="__wbr_issue_action" style="display:inline-flex;align-items:center;gap:4px;background:#ef233c;color:#ffffff;border:none;border-radius:2px;height:34px;padding:0 14px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap">保存并结束</button>
      </div>
      <div data-issue-error style="color:#b42318;font-size:12px;padding:6px 10px;border-radius:2px;background:#fde3df;border:1px solid #f99f95;display:none"></div>
    </div>`;
    document.documentElement.appendChild(root);
    this.editorElement = root;
    const image = root.querySelector<HTMLImageElement>("[data-issue-image]")!;
    if (dataUrl) image.src = dataUrl;
    const svg = root.querySelector<SVGSVGElement>("[data-issue-svg]")!;
    const annotation: AnnotationModel = { ...scene.annotation, point: { ...scene.annotation.point }, targetBox: scene.annotation.targetBox ? { ...scene.annotation.targetBox } : undefined };
    this.renderAnnotation(svg, annotation);

    // ─── Control Card Positioning & Drag ───
    const controlCard = root.querySelector<HTMLElement>("[data-issue-control-card]")!;
    let userMovedCard = false;
    let cardDragging = false;
    let cardStartX = 0; let cardStartY = 0; let cardInitialLeft = 0; let cardInitialTop = 0;

    const dragHandle = root.querySelector<HTMLElement>("[data-issue-drag-handle]");
    dragHandle?.addEventListener("pointerdown", (event) => {
      cardDragging = true; userMovedCard = true;
      dragHandle.setPointerCapture(event.pointerId);
      dragHandle.style.cursor = "grabbing"; controlCard.style.transition = "none";
      cardStartX = event.clientX; cardStartY = event.clientY;
      cardInitialLeft = controlCard.offsetLeft; cardInitialTop = controlCard.offsetTop;
      event.preventDefault();
    });
    dragHandle?.addEventListener("pointermove", (event) => {
      if (!cardDragging) return;
      const dx = event.clientX - cardStartX; const dy = event.clientY - cardStartY;
      const newLeft = Math.max(8, Math.min(window.innerWidth - controlCard.offsetWidth - 8, cardInitialLeft + dx));
      const newTop = Math.max(8, Math.min(window.innerHeight - controlCard.offsetHeight - 8, cardInitialTop + dy));
      controlCard.style.left = `${newLeft}px`; controlCard.style.top = `${newTop}px`;
    });
    dragHandle?.addEventListener("pointerup", () => {
      if (!cardDragging) return;
      cardDragging = false; dragHandle.style.cursor = "grab";
      controlCard.style.transition = "top 0.15s ease-out, left 0.15s ease-out";
    });

    const positionControlCard = () => {
      if (!controlCard || !svg || userMovedCard) return;
      const rect = svg.getBoundingClientRect();
      const box = annotation.targetBox;
      const targetX = box ? box.xRatio + box.widthRatio / 2 : annotation.point.xRatio;
      const targetYBottom = box ? box.yRatio + box.heightRatio : annotation.point.yRatio;
      const targetYTop = box ? box.yRatio : annotation.point.yRatio;
      const targetPxX = rect.left + targetX * rect.width;
      const targetPxYBottom = rect.top + targetYBottom * rect.height;
      const targetPxYTop = rect.top + targetYTop * rect.height;
      const cardWidth = controlCard.offsetWidth || 560; const cardHeight = controlCard.offsetHeight || 60;
      let left = targetPxX - cardWidth / 2;
      left = Math.max(16, Math.min(window.innerWidth - cardWidth - 16, left));
      let top = targetPxYBottom + 14;
      if (top + cardHeight > window.innerHeight - 16) { top = targetPxYTop - cardHeight - 14; }
      top = Math.max(64, Math.min(window.innerHeight - cardHeight - 16, top));
      Object.assign(controlCard.style, { left: `${left}px`, top: `${top}px` });
    };
    image.addEventListener("load", positionControlCard);
    window.addEventListener("resize", positionControlCard);
    requestAnimationFrame(positionControlCard);

    const actualInput = root.querySelector<HTMLInputElement>("[data-issue-actual]");
    setTimeout(() => actualInput?.focus(), 50);

    // ─── Drawing Tools ───
    annotation.userAnnotations = annotation.userAnnotations || [];
    let activeTool: "none" | "rect" | "arrow" | "text" = "none";
    let isDrawingUserAnnotation = false;
    let drawStartXRatio = 0; let drawStartYRatio = 0;

    const toolButtons = root.querySelectorAll<HTMLButtonElement>("[data-issue-tool]");
    toolButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const tool = btn.getAttribute("data-issue-tool") as "none" | "rect" | "arrow" | "text";
        activeTool = tool;
        toolButtons.forEach((b) => {
          const isCurrent = b === btn;
          b.style.background = isCurrent ? "#165dff" : "#ffffff";
          b.style.color = isCurrent ? "#ffffff" : "#1d2129";
          b.style.borderColor = isCurrent ? "#165dff" : "#e5e6eb";
        });
        svg.style.cursor = activeTool === "none" ? "default" : "crosshair";
      });
    });

    // ─── Undo/Redo ───
    const redoStack: any[] = [];
    const undoBtn = root.querySelector<HTMLButtonElement>("[data-issue-tool-undo]");
    const redoBtn = root.querySelector<HTMLButtonElement>("[data-issue-tool-redo]");
    const updateUndoRedoStatus = () => {
      const hasUndo = Boolean(annotation.userAnnotations?.length);
      const hasRedo = Boolean(redoStack.length);
      if (undoBtn) { undoBtn.disabled = !hasUndo; undoBtn.style.color = hasUndo ? "#1d2129" : "#c0c6d0"; undoBtn.style.background = hasUndo ? "#ffffff" : "#f7f8fa"; undoBtn.style.cursor = hasUndo ? "pointer" : "not-allowed"; undoBtn.style.opacity = "1"; }
      if (redoBtn) { redoBtn.disabled = !hasRedo; redoBtn.style.color = hasRedo ? "#1d2129" : "#c0c6d0"; redoBtn.style.background = hasRedo ? "#ffffff" : "#f7f8fa"; redoBtn.style.cursor = hasRedo ? "pointer" : "not-allowed"; redoBtn.style.opacity = "1"; }
    };
    updateUndoRedoStatus();
    const handleUndo = () => { if (annotation.userAnnotations?.length) { const popped = annotation.userAnnotations.pop(); if (popped) redoStack.push(popped); this.renderAnnotation(svg, annotation); updateUndoRedoStatus(); } };
    const handleRedo = () => { if (redoStack.length) { const item = redoStack.pop(); if (item) { annotation.userAnnotations!.push(item); this.renderAnnotation(svg, annotation); updateUndoRedoStatus(); } } };
    undoBtn?.addEventListener("click", handleUndo);
    redoBtn?.addEventListener("click", handleRedo);

    const undoShortcutText = this.deps.isMac ? "⌘Z" : "Ctrl+Z";
    const redoShortcutText = this.deps.isMac ? "⇧⌘Z" : "Ctrl+Shift+Z";
    if (undoBtn) undoBtn.title = `${t("undo")} (${undoShortcutText})`;
    if (redoBtn) redoBtn.title = `${t("redo")} (${redoShortcutText})`;

    this.keydownListener = (e: KeyboardEvent) => {
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;
      if (!isCmdOrCtrl) return;
      const activeEl = document.activeElement;
      const isTyping = activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA");
      const isZ = e.key === "z" || e.key === "Z"; const isY = e.key === "y" || e.key === "Y";
      if (isZ && e.shiftKey) { if (!isTyping) { e.preventDefault(); handleRedo(); } }
      else if (isZ && !e.shiftKey) { if (!isTyping) { e.preventDefault(); handleUndo(); } }
      else if (isY && !e.shiftKey) { if (!isTyping) { e.preventDefault(); handleRedo(); } }
    };
    window.addEventListener("keydown", this.keydownListener, true);

    // ─── SVG Drawing ───
    let textInputOverlay: HTMLInputElement | undefined;
    const removeTextInputOverlay = () => { if (textInputOverlay) { textInputOverlay.remove(); textInputOverlay = undefined; } };
    let targetHandleDragging = false;

    svg.addEventListener("pointerdown", (event) => {
      const isHandle = Boolean((event.target as Element).closest("[data-issue-handle]"));
      if (activeTool === "none" && isHandle) { targetHandleDragging = true; svg.setPointerCapture(event.pointerId); event.preventDefault(); return; }
      if (activeTool === "rect" || activeTool === "arrow") {
        removeTextInputOverlay();
        const rect = svg.getBoundingClientRect();
        drawStartXRatio = Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)));
        drawStartYRatio = Math.min(1, Math.max(0, (event.clientY - rect.top) / Math.max(1, rect.height)));
        isDrawingUserAnnotation = true; svg.setPointerCapture(event.pointerId); event.preventDefault();
      } else if (activeTool === "text") {
        removeTextInputOverlay();
        const rect = svg.getBoundingClientRect();
        const clickXRatio = Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)));
        const clickYRatio = Math.min(1, Math.max(0, (event.clientY - rect.top) / Math.max(1, rect.height)));
        const input = document.createElement("input"); input.type = "text"; input.placeholder = "输入批注文字...";
        Object.assign(input.style, { position: "absolute", left: `${event.clientX - root.getBoundingClientRect().left}px`, top: `${event.clientY - root.getBoundingClientRect().top - 14}px`, zIndex: "40", background: "rgba(255, 255, 255, 0.95)", color: "#165dff", border: "1px solid #165dff", borderRadius: "2px", padding: "2px 6px", fontSize: "13px", fontWeight: "600", outline: "none", boxShadow: "0 2px 8px rgba(0,0,0,0.15)", minWidth: "100px" });
        root.appendChild(input); textInputOverlay = input; setTimeout(() => input.focus(), 10);
        const submitText = () => { const val = input.value.trim(); if (val) { annotation.userAnnotations!.push({ type: "text", color: "#165dff", xRatio: clickXRatio, yRatio: clickYRatio, text: val }); redoStack.length = 0; this.renderAnnotation(svg, annotation); updateUndoRedoStatus(); } removeTextInputOverlay(); };
        input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submitText(); } else if (e.key === "Escape") { removeTextInputOverlay(); } });
        input.addEventListener("blur", () => { submitText(); });
      }
    });

    svg.addEventListener("pointermove", (event) => {
      const rect = svg.getBoundingClientRect();
      if (targetHandleDragging && activeTool === "none") {
        annotation.point = { xRatio: Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width))), yRatio: Math.min(1, Math.max(0, (event.clientY - rect.top) / Math.max(1, rect.height))) };
        this.renderAnnotation(svg, annotation); positionControlCard(); return;
      }
      if (isDrawingUserAnnotation) {
        const curXRatio = Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)));
        const curYRatio = Math.min(1, Math.max(0, (event.clientY - rect.top) / Math.max(1, rect.height)));
        this.renderAnnotation(svg, annotation, { type: activeTool as "rect" | "arrow", startX: drawStartXRatio * 1000, startY: drawStartYRatio * 1000, currentX: curXRatio * 1000, currentY: curYRatio * 1000 });
      }
    });

    svg.addEventListener("pointerup", (event) => {
      if (targetHandleDragging) { targetHandleDragging = false; }
      if (isDrawingUserAnnotation) {
        isDrawingUserAnnotation = false;
        const rect = svg.getBoundingClientRect();
        const endXRatio = Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)));
        const endYRatio = Math.min(1, Math.max(0, (event.clientY - rect.top) / Math.max(1, rect.height)));
        const dx = Math.abs(endXRatio - drawStartXRatio); const dy = Math.abs(endYRatio - drawStartYRatio);
        if (dx > 0.005 || dy > 0.005) {
          if (activeTool === "rect") { annotation.userAnnotations!.push({ type: "rect", color: "#165dff", xRatio: Math.min(drawStartXRatio, endXRatio), yRatio: Math.min(drawStartYRatio, endYRatio), widthRatio: Math.abs(endXRatio - drawStartXRatio), heightRatio: Math.abs(endYRatio - drawStartYRatio) }); }
          else if (activeTool === "arrow") { annotation.userAnnotations!.push({ type: "arrow", color: "#165dff", startXRatio: drawStartXRatio, startYRatio: drawStartYRatio, endXRatio, endYRatio }); }
          redoStack.length = 0; updateUndoRedoStatus();
        }
        this.renderAnnotation(svg, annotation);
      }
    });

    // ─── Details Toggle & Form ───
    const detailsBox = root.querySelector<HTMLElement>("[data-issue-details-box]")!;
    const toggleBtn = root.querySelector<HTMLElement>("[data-issue-toggle-more]");
    toggleBtn?.addEventListener("click", () => { const isHidden = detailsBox.style.display === "none"; detailsBox.style.display = isHidden ? "flex" : "none"; toggleBtn.textContent = isHidden ? "收起 ▴" : "详细 ▾"; requestAnimationFrame(positionControlCard); });
    const error = root.querySelector<HTMLElement>("[data-issue-error]")!;
    const setError = (msg: string) => { if (msg) { error.textContent = msg; error.style.display = "block"; } else { error.textContent = ""; error.style.display = "none"; } };
    const cancel = () => { window.removeEventListener("resize", positionControlCard); void chrome.runtime.sendMessage(message("issue-scene/cancel", { issueSceneId: scene.id, nonce: session.nonce }, session.sessionId)); this.close(); };
    root.querySelector("[data-issue-cancel]")?.addEventListener("click", cancel);
    root.querySelector("[data-issue-reselect]")?.addEventListener("click", () => { cancel(); this.deps.onReselect(); });
    const commit = (stopAfterCommit: boolean) => {
      const actual = root.querySelector<HTMLInputElement>("[data-issue-actual]")!.value;
      const expected = root.querySelector<HTMLTextAreaElement>("[data-issue-expected]")!.value;
      const note = root.querySelector<HTMLTextAreaElement>("[data-issue-note]")!.value;
      const label = root.querySelector<HTMLInputElement>("[data-issue-label]")!.value;
      root.querySelectorAll<HTMLButtonElement>("button").forEach((button) => { button.disabled = true; });
      void chrome.runtime.sendMessage(message("issue-scene/commit", { issueSceneId: scene.id, nonce: session.nonce, narrative: { actual, expected, note }, annotation: { ...annotation, label: label.trim() || undefined }, stopAfterCommit }, session.sessionId)).then((response) => {
        if (!response?.ok) { setError(`保存失败：${response?.error ?? "未知错误"}`); root.querySelectorAll<HTMLButtonElement>("button").forEach((button) => { button.disabled = false; }); return; }
        window.removeEventListener("resize", positionControlCard);
        this.close(!stopAfterCommit);
        if (stopAfterCommit) this.deps.onStopAfterCommit();
      }).catch((failure) => { setError(`保存失败：${String(failure)}`); root.querySelectorAll<HTMLButtonElement>("button").forEach((button) => { button.disabled = false; }); });
    };
    root.querySelector("[data-issue-save]")?.addEventListener("click", () => commit(false));
    root.querySelector("[data-issue-save-stop]")?.addEventListener("click", () => commit(true));
  }

  // ─── SVG Rendering ───

  private renderAnnotation(svg: SVGSVGElement, annotation: AnnotationModel, activeDrawing?: ActiveDrawing): void {
    const boxes = annotation.targetBoxes?.length ? annotation.targetBoxes : (annotation.targetBox ? [annotation.targetBox] : []);
    let boxMarkup = boxes.map((box) => `<rect data-issue-handle="true" x="${box.xRatio * 1000}" y="${box.yRatio * 1000}" width="${box.widthRatio * 1000}" height="${box.heightRatio * 1000}" rx="2" ry="2" fill="none" stroke="#ef233c" stroke-width="3" vector-effect="non-scaling-stroke" style="cursor:move"></rect>`).join("");
    const defs = `<defs><marker id="user-arrow-head" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#165dff"/></marker></defs>`;
    const rect = svg.getBoundingClientRect();
    const scaleX = rect.width > 0 ? 1000 / rect.width : 1;
    const scaleY = rect.height > 0 ? 1000 / rect.height : 1;
    let userMarkup = "";
    if (annotation.userAnnotations?.length) {
      for (const item of annotation.userAnnotations) {
        const color = item.color || "#165dff";
        if (item.type === "rect") { userMarkup += `<rect x="${item.xRatio * 1000}" y="${item.yRatio * 1000}" width="${item.widthRatio * 1000}" height="${item.heightRatio * 1000}" rx="2" ry="2" fill="none" stroke="${color}" stroke-width="3" vector-effect="non-scaling-stroke"></rect>`; }
        else if (item.type === "arrow") { userMarkup += `<line x1="${item.startXRatio * 1000}" y1="${item.startYRatio * 1000}" x2="${item.endXRatio * 1000}" y2="${item.endYRatio * 1000}" stroke="${color}" stroke-width="3" vector-effect="non-scaling-stroke" marker-end="url(#user-arrow-head)"></line>`; }
        else if (item.type === "text" && item.text) { const textEsc = item.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); userMarkup += `<g transform="translate(${item.xRatio * 1000}, ${item.yRatio * 1000}) scale(${scaleX}, ${scaleY})"><text x="0" y="0" fill="${color}" font-size="16" font-weight="700" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif">${textEsc}</text></g>`; }
      }
    }
    let activeMarkup = "";
    if (activeDrawing) {
      const { startX: sx, startY: sy, currentX: cx, currentY: cy } = activeDrawing;
      if (activeDrawing.type === "rect") { activeMarkup = `<rect x="${Math.min(sx, cx)}" y="${Math.min(sy, cy)}" width="${Math.abs(cx - sx)}" height="${Math.abs(cy - sy)}" rx="2" ry="2" fill="none" stroke="#165dff" stroke-width="3" stroke-dasharray="4,4" vector-effect="non-scaling-stroke"></rect>`; }
      else if (activeDrawing.type === "arrow") { activeMarkup = `<line x1="${sx}" y1="${sy}" x2="${cx}" y2="${cy}" stroke="#165dff" stroke-width="3" stroke-dasharray="4,4" vector-effect="non-scaling-stroke" marker-end="url(#user-arrow-head)"></line>`; }
    }
    svg.innerHTML = defs + boxMarkup + userMarkup + activeMarkup;
  }
}
