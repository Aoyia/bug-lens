import {
  message,
  type AnnotationModel,
  type ExpectedStatement,
  type TargetDomSnapshot,
} from "../../../shared/protocol";
import { defaultAnnotation } from "../../../domain/issue-scene";
import {
  buildDomSnapshot,
  pageElementAtPoint,
  isWidgetElement,
} from "./dom-snapshot";
import { t } from "../../../shared/i18n";
import {
  lockViewportScroll,
  type ScrollLockController,
} from "../../../shared/dom/scroll-lock";
import {
  isMobileEmulationViewport,
  syncMobileEmulationAttribute,
  observeMobileEmulationMode,
} from "../../../shared/ui/mobile-emulation-mode";

export type SelectedTargetItem = {
  element: Element;
  target: TargetDomSnapshot;
  box: {
    xRatio: number;
    yRatio: number;
    widthRatio: number;
    heightRatio: number;
  };
  overlayBox: HTMLElement;
};

export type SelectionOverlayDeps = {
  getSession():
    | {
        sessionId: string;
        nonce: string;
        privacyMode: "safe" | "strict" | "raw";
      }
    | undefined;
  /** 速记卡确认的期望（按下"标记问题"瞬间捕获），随 capture 消息透传 */
  getPendingExpected?(): ExpectedStatement | undefined;
  onCaptureComplete(
    scene: {
      id: string;
      page: { viewport: { width: number; height: number } };
      annotation: AnnotationModel;
    },
    dataUrl: string | undefined
  ): void;
  onCancel(): void;
  /** 采集失败的非阻塞反馈出口（toast 等）；不得回退到阻塞页面的原生对话框 */
  onError(message: string): void;
  getEditorElement(): HTMLElement | undefined;
  shortcutKeyText: string;
};

export class SelectionOverlay {
  private _isActive = false;
  private startedAtEpochMs: number | undefined;
  private layer: HTMLDivElement | undefined;
  private escapeListener: ((event: KeyboardEvent) => void) | undefined;

  // 滚动锁定与模式观察控制器
  private scrollLockController: ScrollLockController | undefined;
  private unobserveMode: (() => void) | undefined;
  private unobserveScroll: (() => void) | undefined;

  private isMobileMode = false;
  private isDockedTop = false;
  private currentSelectionMode: "pick" | "scroll" = "pick";

  constructor(private readonly deps: SelectionOverlayDeps) {}

  get isActive(): boolean {
    return this._isActive;
  }
  get element(): HTMLDivElement | undefined {
    return this.layer;
  }
  get isMobile(): boolean {
    return this.isMobileMode;
  }
  get dockedTop(): boolean {
    return this.isDockedTop;
  }
  get selectionMode(): "pick" | "scroll" {
    return this.currentSelectionMode;
  }

  open(): void {
    if (!this.deps.getSession() || this._isActive) return;
    this._isActive = true;
    this.startedAtEpochMs = Date.now();
    this.isMobileMode = isMobileEmulationViewport(
      typeof window !== "undefined" ? window : undefined
    );
    this.isDockedTop = false;
    this.currentSelectionMode = "pick";

    this.lockScroll();

    const layer = document.createElement("div");
    layer.id = "__wbr_issue_selection__";
    Object.assign(layer.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483646",
      cursor: "crosshair",
      background: "transparent",
      touchAction: "none",
      overflow: "hidden",
    });
    syncMobileEmulationAttribute(layer, this.isMobileMode);

    const shadow = layer.attachShadow({ mode: "open" });

    const outline = document.createElement("div");
    Object.assign(outline.style, {
      position: "fixed",
      pointerEvents: "none",
      border: "2.5px dashed #ef233c",
      borderRadius: "2px",
      background: "transparent",
      display: "none",
      zIndex: "1",
    });

    const boxesContainer = document.createElement("div");
    Object.assign(boxesContainer.style, {
      position: "fixed",
      inset: "0",
      pointerEvents: "none",
      zIndex: "2",
    });

    const hint = document.createElement("div");
    hint.className = "wbr-selection-hint";
    Object.assign(hint.style, {
      position: "fixed",
      left: "50%",
      transform: "translateX(-50%)",
      background: "rgba(29,33,41,.94)",
      border: "1px solid rgba(255,255,255,.2)",
      boxShadow: "0 8px 28px rgba(0,0,0,.28)",
      color: "#fff",
      font: "600 13px/1.35 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      boxSizing: "border-box",
      pointerEvents: "auto",
      touchAction: "manipulation",
      display: "flex",
      alignItems: "center",
      zIndex: "10",
    });

    // 样式注入：扩展删除按钮 ✕ 点击热区至 34×34px，隐藏滚动条
    const styleEl = document.createElement("style");
    styleEl.textContent = `
      .wbr-selection-remove-btn {
        position: absolute;
        top: -9px;
        right: -9px;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: #ef233c;
        color: #ffffff;
        font-size: 11px;
        font-weight: bold;
        line-height: 18px;
        text-align: center;
        cursor: pointer;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
        user-select: none;
        z-index: 10;
      }
      .wbr-selection-remove-btn::after {
        content: "";
        position: absolute;
        inset: -8px;
      }
      .wbr-selection-hint {
        scrollbar-width: none;
        -ms-overflow-style: none;
      }
      .wbr-selection-hint::-webkit-scrollbar {
        display: none;
      }
    `;

    // 1. 移动端分段模式切换器（选元素 / 滚页面）
    const modeToggleGroup = document.createElement("div");
    Object.assign(modeToggleGroup.style, {
      display: "flex",
      alignItems: "center",
      background: "rgba(255,255,255,0.12)",
      borderRadius: "999px",
      padding: "2px",
      gap: "2px",
      flexShrink: "0",
    });

    const pickBtn = document.createElement("button");
    pickBtn.textContent = t("selectionModePick");
    Object.assign(pickBtn.style, {
      border: "none",
      borderRadius: "999px",
      padding: "3px 7px",
      fontSize: "11px",
      cursor: "pointer",
      lineHeight: "1.2",
      whiteSpace: "nowrap",
      flexShrink: "0",
    });

    const scrollBtn = document.createElement("button");
    scrollBtn.textContent = t("selectionModeScroll");
    Object.assign(scrollBtn.style, {
      border: "none",
      borderRadius: "999px",
      padding: "3px 7px",
      fontSize: "11px",
      cursor: "pointer",
      lineHeight: "1.2",
      whiteSpace: "nowrap",
      flexShrink: "0",
    });

    modeToggleGroup.append(pickBtn, scrollBtn);

    // 2. PC 端提示文字
    const statusText = document.createElement("span");
    statusText.textContent = t("markModeHint", this.deps.shortcutKeyText);
    Object.assign(statusText.style, {
      minWidth: "0",
      maxWidth: "100%",
      overflowWrap: "anywhere",
    });

    // 3. 动作操作按钮组
    const btnGroup = document.createElement("div");
    Object.assign(btnGroup.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "8px",
      flexShrink: "0",
      maxWidth: "100%",
    });

    const finishBtn = document.createElement("button");
    finishBtn.textContent = t("enterScreenshot", "0");
    Object.assign(finishBtn.style, {
      background: "#ef233c",
      color: "#fff",
      border: "none",
      borderRadius: "999px",
      padding: "4px 12px",
      fontSize: "12px",
      fontWeight: "600",
      cursor: "pointer",
      whiteSpace: "nowrap",
      flexShrink: "0",
    });
    finishBtn.title = t("enterScreenshotByEnter");

    const clearBtn = document.createElement("button");
    clearBtn.textContent = t("clearShort");
    Object.assign(clearBtn.style, {
      background: "rgba(255,255,255,0.15)",
      color: "#fff",
      border: "1px solid rgba(255,255,255,0.2)",
      borderRadius: "999px",
      padding: "4px 10px",
      fontSize: "12px",
      fontWeight: "500",
      cursor: "pointer",
      whiteSpace: "nowrap",
      flexShrink: "0",
    });

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = t("cancelShort");
    Object.assign(cancelBtn.style, {
      background: "transparent",
      color: "rgba(255,255,255,0.7)",
      border: "none",
      borderRadius: "999px",
      padding: "4px 8px",
      fontSize: "12px",
      fontWeight: "500",
      cursor: "pointer",
      whiteSpace: "nowrap",
      flexShrink: "0",
    });

    // 4. 移动端一键置顶 / 贴底换位按钮
    const flipBtn = document.createElement("button");
    flipBtn.textContent = "⇅";
    flipBtn.title = t("selectionMoveTop");
    flipBtn.setAttribute?.("aria-label", t("selectionMoveTop"));
    Object.assign(flipBtn.style, {
      background: "rgba(255,255,255,0.15)",
      color: "#fff",
      border: "1px solid rgba(255,255,255,0.2)",
      borderRadius: "999px",
      padding: "3px 6px",
      fontSize: "12px",
      fontWeight: "600",
      cursor: "pointer",
      whiteSpace: "nowrap",
      flexShrink: "0",
      lineHeight: "1.2",
    });

    btnGroup.append(finishBtn, clearBtn, cancelBtn, flipBtn);
    hint.append(modeToggleGroup, statusText, btnGroup);
    shadow.append(outline, boxesContainer, hint, styleEl);
    document.documentElement.appendChild(layer);
    this.layer = layer;

    const selectedItems: SelectedTargetItem[] = [];
    let currentHovered:
      { element: Element; clientX: number; clientY: number } | undefined;

    const padX = 4;
    const padY = 3;

    const updateFlipBtn = () => {
      const label = this.isDockedTop
        ? t("selectionMoveBottom")
        : t("selectionMoveTop");
      flipBtn.title = label;
      flipBtn.setAttribute?.("aria-label", label);
    };

    const toggleDockPosition = () => {
      this.isDockedTop = !this.isDockedTop;
      if (this.isDockedTop) {
        hint.style.top = "12px";
        hint.style.bottom = "auto";
      } else {
        hint.style.bottom = "12px";
        hint.style.top = "auto";
      }
      updateFlipBtn();
    };

    const updateModeUI = () => {
      if (this.currentSelectionMode === "pick") {
        pickBtn.style.background = "rgba(255,255,255,0.25)";
        pickBtn.style.color = "#ffffff";
        pickBtn.style.fontWeight = "600";
        scrollBtn.style.background = "transparent";
        scrollBtn.style.color = "rgba(255,255,255,0.7)";
        scrollBtn.style.fontWeight = "normal";
      } else {
        pickBtn.style.background = "transparent";
        pickBtn.style.color = "rgba(255,255,255,0.7)";
        pickBtn.style.fontWeight = "normal";
        scrollBtn.style.background = "#2563eb";
        scrollBtn.style.color = "#ffffff";
        scrollBtn.style.fontWeight = "600";
      }
    };

    const syncSelectedBoxes = () => {
      const viewportWidth = Math.max(1, window.innerWidth);
      const viewportHeight = Math.max(1, window.innerHeight);

      for (const item of selectedItems) {
        if (
          !item.element ||
          typeof item.element.getBoundingClientRect !== "function"
        )
          continue;
        const rect = item.element.getBoundingClientRect();
        const left = rect.left - padX;
        const top = rect.top - padY;
        const width = rect.width + padX * 2;
        const height = rect.height + padY * 2;

        const isOutOfView =
          top + height <= 0 ||
          top >= viewportHeight ||
          left + width <= 0 ||
          left >= viewportWidth;

        if (isOutOfView) {
          item.overlayBox.style.display = "none";
        } else {
          item.overlayBox.style.display = "block";
          item.overlayBox.style.left = `${left}px`;
          item.overlayBox.style.top = `${top}px`;
          item.overlayBox.style.width = `${width}px`;
          item.overlayBox.style.height = `${height}px`;
        }

        item.box = {
          xRatio: Math.min(1, Math.max(0, left / viewportWidth)),
          yRatio: Math.min(1, Math.max(0, top / viewportHeight)),
          widthRatio: Math.min(1, Math.max(0, width / viewportWidth)),
          heightRatio: Math.min(1, Math.max(0, height / viewportHeight)),
        };
      }

      if (
        currentHovered?.element &&
        typeof currentHovered.element.getBoundingClientRect === "function"
      ) {
        const rect = currentHovered.element.getBoundingClientRect();
        const left = rect.left - padX;
        const top = rect.top - padY;
        const width = rect.width + padX * 2;
        const height = rect.height + padY * 2;

        const isOutOfView =
          top + height <= 0 ||
          top >= viewportHeight ||
          left + width <= 0 ||
          left >= viewportWidth;

        if (isOutOfView) {
          outline.style.display = "none";
        } else {
          Object.assign(outline.style, {
            display: "block",
            left: `${left}px`,
            top: `${top}px`,
            width: `${width}px`,
            height: `${height}px`,
          });
        }
      }
    };

    const applyInteractionMode = () => {
      const isScroll =
        this.isMobileMode && this.currentSelectionMode === "scroll";

      if (isScroll) {
        layer.style.pointerEvents = "none";
        hint.style.pointerEvents = "auto";
        outline.style.display = "none";
        currentHovered = undefined;
        for (const item of selectedItems) {
          item.overlayBox.style.pointerEvents = "none";
        }
        this.scrollLockController?.pause();
      } else {
        layer.style.pointerEvents = "auto";
        layer.style.cursor = "crosshair";
        for (const item of selectedItems) {
          item.overlayBox.style.pointerEvents = "auto";
        }
        this.scrollLockController?.resume();
        if (this.isMobileMode) {
          this.scrollLockController?.update({
            lockOverflow: false,
            allowWheel: true,
            allowTouchMove: false,
          });
        } else {
          this.scrollLockController?.update({
            lockOverflow: true,
            allowWheel: false,
            allowTouchMove: false,
          });
        }
      }
    };

    const applyEmulationMode = (isMobile: boolean) => {
      this.isMobileMode = isMobile;
      syncMobileEmulationAttribute(layer, isMobile);

      if (isMobile) {
        // 移动仿真态：贴底紧凑单行条 + 一键换位
        statusText.style.display = "none";
        modeToggleGroup.style.display = "flex";
        flipBtn.style.display = "inline-flex";

        hint.style.overflowX = "auto";
        hint.style.scrollbarWidth = "none";
        hint.style.width = "max-content";
        hint.style.maxWidth = "calc(100vw - 16px)";
        hint.style.padding = "4px 6px";
        hint.style.borderRadius = "20px";
        hint.style.gap = "4px";
        hint.style.whiteSpace = "nowrap";
        hint.style.flexWrap = "nowrap";

        if (this.isDockedTop) {
          hint.style.top = "12px";
          hint.style.bottom = "auto";
        } else {
          hint.style.bottom = "12px";
          hint.style.top = "auto";
        }

        btnGroup.style.gap = "4px";
        finishBtn.style.fontSize = "11px";
        finishBtn.style.padding = "3px 7px";
        clearBtn.style.fontSize = "11px";
        clearBtn.style.padding = "3px 5px";
        cancelBtn.style.fontSize = "11px";
        cancelBtn.style.padding = "3px 5px";
        flipBtn.style.fontSize = "12px";
        flipBtn.style.padding = "3px 5px";

        updateModeUI();
        updateFlipBtn();
      } else {
        // PC 桌面态：重置为 pick 模式并 100% 恢复 35067f2 之前的 999px 胶囊形态
        this.currentSelectionMode = "pick";
        hint.style.overflowX = "visible";
        hint.style.scrollbarWidth = "auto";
        statusText.style.display = "inline";
        modeToggleGroup.style.display = "none";
        flipBtn.style.display = "none";

        hint.style.top = "18px";
        hint.style.bottom = "auto";
        hint.style.width = "max-content";
        hint.style.maxWidth = "calc(100vw - 32px)";
        hint.style.padding = "8px 16px";
        hint.style.borderRadius = "999px";
        hint.style.gap = "12px";
        hint.style.whiteSpace = "nowrap";
        hint.style.flexWrap = "nowrap";

        btnGroup.style.gap = "8px";
        finishBtn.style.fontSize = "12px";
        finishBtn.style.padding = "4px 12px";
        clearBtn.style.fontSize = "12px";
        clearBtn.style.padding = "4px 10px";
        cancelBtn.style.fontSize = "12px";
        cancelBtn.style.padding = "4px 8px";

        updateModeUI();
      }
      applyInteractionMode();
      syncSelectedBoxes();
    };

    const setSelectionMode = (mode: "pick" | "scroll") => {
      if (this.currentSelectionMode === mode) return;
      this.currentSelectionMode = mode;
      updateModeUI();
      applyInteractionMode();
    };

    applyEmulationMode(this.isMobileMode);

    const updateUI = () => {
      finishBtn.textContent = t(
        "enterScreenshot",
        String(selectedItems.length)
      );
      if (selectedItems.length > 0) {
        statusText.textContent = t(
          "selectedCountHint",
          String(selectedItems.length)
        );
      } else {
        statusText.textContent = t("markModeHint", this.deps.shortcutKeyText);
      }
    };

    const addTarget = (el: Element) => {
      if (selectedItems.some((item) => item.element === el)) return;
      const privacyMode = this.deps.getSession()?.privacyMode ?? "safe";
      const viewportWidth = Math.max(1, window.innerWidth);
      const viewportHeight = Math.max(1, window.innerHeight);
      const target = buildDomSnapshot(el, privacyMode);
      const rect = el.getBoundingClientRect();
      const left = rect.left - padX;
      const top = rect.top - padY;
      const width = rect.width + padX * 2;
      const height = rect.height + padY * 2;

      const box = {
        xRatio: Math.min(1, Math.max(0, left / viewportWidth)),
        yRatio: Math.min(1, Math.max(0, top / viewportHeight)),
        widthRatio: Math.min(1, Math.max(0, width / viewportWidth)),
        heightRatio: Math.min(1, Math.max(0, height / viewportHeight)),
      };

      const overlayBox = document.createElement("div");
      Object.assign(overlayBox.style, {
        position: "fixed",
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
        border: "2.5px solid #ef233c",
        borderRadius: "2px",
        background: "transparent",
        pointerEvents:
          this.isMobileMode && this.currentSelectionMode === "scroll"
            ? "none"
            : "auto",
        boxSizing: "border-box",
      });

      const removeBtn = document.createElement("div");
      removeBtn.className = "wbr-selection-remove-btn";
      removeBtn.textContent = "✕";
      removeBtn.title = t("removeSelectionMark");
      Object.assign(removeBtn.style, {
        position: "absolute",
        top: "-9px",
        right: "-9px",
        width: "18px",
        height: "18px",
        borderRadius: "50%",
        background: "#ef233c",
        color: "#ffffff",
        fontSize: "11px",
        fontWeight: "bold",
        lineHeight: "18px",
        textAlign: "center",
        cursor: "pointer",
        boxShadow: "0 2px 6px rgba(0, 0, 0, 0.25)",
        userSelect: "none",
        zIndex: "10",
      });

      const item: SelectedTargetItem = { element: el, target, box, overlayBox };
      removeBtn.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
      });
      removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        removeTarget(item);
      });

      overlayBox.appendChild(removeBtn);
      boxesContainer.appendChild(overlayBox);
      selectedItems.push(item);
      updateUI();
    };

    const removeTarget = (item: SelectedTargetItem) => {
      const index = selectedItems.indexOf(item);
      if (index >= 0) {
        selectedItems.splice(index, 1);
        item.overlayBox.remove();
        updateUI();
      }
    };

    const clearAll = () => {
      selectedItems.forEach((item) => item.overlayBox.remove());
      selectedItems.length = 0;
      updateUI();
    };

    // 结束选择并进入截图编辑器：按钮点击与回车共用同一路径
    const doFinish = () => {
      if (selectedItems.length === 0 && !currentHovered) return;
      shadow.querySelectorAll("div").forEach((el) => {
        if (el.textContent === "✕") el.style.display = "none";
      });
      hint.style.display = "none";
      outline.style.display = "none";
      syncSelectedBoxes();
      this.captureMulti(selectedItems, currentHovered);
    };

    hint.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
    });
    hint.addEventListener("click", (e) => {
      e.stopPropagation();
    });

    pickBtn.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
    });
    pickBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      setSelectionMode("pick");
    });

    scrollBtn.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
    });
    scrollBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      setSelectionMode("scroll");
    });

    flipBtn.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
    });
    flipBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      toggleDockPosition();
    });

    finishBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      doFinish();
    });

    clearBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      clearAll();
    });

    cancelBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.close();
      this.deps.onCancel();
    });

    layer.addEventListener("pointermove", (event) => {
      if (this.currentSelectionMode === "scroll") return;
      const candidate = pageElementAtPoint(
        event.clientX,
        event.clientY,
        this.layer,
        this.deps.getEditorElement()
      );
      if (
        !candidate ||
        selectedItems.some((item) => item.element === candidate)
      ) {
        outline.style.display = "none";
        currentHovered = undefined;
        return;
      }
      currentHovered = {
        element: candidate,
        clientX: event.clientX,
        clientY: event.clientY,
      };
      const rect = candidate.getBoundingClientRect();
      Object.assign(outline.style, {
        display: "block",
        left: `${rect.left - padX}px`,
        top: `${rect.top - padY}px`,
        width: `${rect.width + padX * 2}px`,
        height: `${rect.height + padY * 2}px`,
      });
    });

    layer.addEventListener("pointerdown", (event) => {
      if (this.currentSelectionMode === "scroll") return;
      event.stopPropagation();
    });
    layer.addEventListener(
      "click",
      (event) => {
        if (this.currentSelectionMode === "scroll") return;
        event.preventDefault();
        event.stopPropagation();
        if (event.button != null && event.button !== 0) return;
        const candidate = pageElementAtPoint(
          event.clientX,
          event.clientY,
          this.layer,
          this.deps.getEditorElement()
        );
        if (candidate) addTarget(candidate);
      },
      { passive: false }
    );

    const handleScroll = () => {
      syncSelectedBoxes();
    };
    window.addEventListener("scroll", handleScroll, {
      capture: true,
      passive: true,
    });
    this.unobserveScroll = () => {
      window.removeEventListener("scroll", handleScroll, true);
    };

    this.unobserveMode = observeMobileEmulationMode((isMobile) => {
      applyEmulationMode(isMobile);
    });

    this.escapeListener = (event: KeyboardEvent) => {
      if (!this._isActive) return;
      if (event.key === "Escape") {
        event.preventDefault();
        this.close();
        this.deps.onCancel();
      } else if (event.key === "Enter") {
        // 回车快捷进入截图：有已选元素或正在 hover 的元素时生效，否则忽略
        event.preventDefault();
        doFinish();
      }
    };
    window.addEventListener("keydown", this.escapeListener, true);
  }

  close(): void {
    this.unlockScroll();
    this.unobserveMode?.();
    this.unobserveMode = undefined;
    this.unobserveScroll?.();
    this.unobserveScroll = undefined;
    this._isActive = false;
    if (this.escapeListener)
      window.removeEventListener("keydown", this.escapeListener, true);
    this.escapeListener = undefined;
    this.layer?.remove();
    this.layer = undefined;
  }

  // ─── Private ───

  private lockScroll(): void {
    if (this.scrollLockController) return;
    if (this.isMobileMode) {
      this.scrollLockController = lockViewportScroll({
        lockOverflow: false,
        allowWheel: true,
        allowTouchMove: false,
        allowEditableKeys: false,
      });
    } else {
      this.scrollLockController = lockViewportScroll({
        lockOverflow: true,
        allowWheel: false,
        allowTouchMove: false,
        allowEditableKeys: false,
      });
    }
  }

  private unlockScroll(): void {
    if (this.scrollLockController) {
      this.scrollLockController.release();
      this.scrollLockController = undefined;
    }
  }

  private captureMulti(
    items: SelectedTargetItem[],
    fallbackCandidate?: { element: Element; clientX: number; clientY: number }
  ): void {
    const session = this.deps.getSession();
    if (!session || !this._isActive) return;
    this._isActive = false;
    if (this.escapeListener)
      window.removeEventListener("keydown", this.escapeListener, true);
    this.escapeListener = undefined;

    let finalItems = [...items];
    if (finalItems.length === 0 && fallbackCandidate) {
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const target = buildDomSnapshot(
        fallbackCandidate.element,
        session.privacyMode
      );
      const rect = fallbackCandidate.element.getBoundingClientRect();
      const left = Math.max(0, rect.left - 4);
      const top = Math.max(0, rect.top - 3);
      const width = rect.width + 8;
      const height = rect.height + 6;
      const box = {
        xRatio: Math.min(1, Math.max(0, left / Math.max(1, viewport.width))),
        yRatio: Math.min(1, Math.max(0, top / Math.max(1, viewport.height))),
        widthRatio: Math.min(
          1,
          Math.max(0, width / Math.max(1, viewport.width))
        ),
        heightRatio: Math.min(
          1,
          Math.max(0, height / Math.max(1, viewport.height))
        ),
      };
      const dummyOverlay = document.createElement("div");
      finalItems = [
        {
          element: fallbackCandidate.element,
          target,
          box,
          overlayBox: dummyOverlay,
        },
      ];
    }

    if (finalItems.length === 0) {
      this.layer?.remove();
      this.layer = undefined;
      this.unlockScroll();
      this.unobserveMode?.();
      this.unobserveMode = undefined;
      this.unobserveScroll?.();
      this.unobserveScroll = undefined;
      this.deps.onCancel();
      return;
    }

    this.unlockScroll();
    this.unobserveMode?.();
    this.unobserveMode = undefined;
    this.unobserveScroll?.();
    this.unobserveScroll = undefined;
    this.layer?.remove();
    this.layer = undefined;

    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const targets = finalItems.map((item) => item.target);
    const targetBoxes = finalItems.map((item) => item.box);
    const primaryTarget = targets[0];
    const primaryBox = targetBoxes[0];
    const centerPoint = {
      clientX: (primaryBox.xRatio + primaryBox.widthRatio / 2) * viewport.width,
      clientY:
        (primaryBox.yRatio + primaryBox.heightRatio / 2) * viewport.height,
    };

    const annotation = {
      ...defaultAnnotation(
        centerPoint,
        viewport,
        primaryTarget.element.boundingBox
      ),
      targetBox: primaryBox,
      targetBoxes,
    };

    const selectionStartedAtEpochMs = this.startedAtEpochMs;
    this.startedAtEpochMs = undefined;
    void new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    )
      .then(() =>
        chrome.runtime.sendMessage(
          message(
            "issue-scene/capture",
            {
              captureId: crypto.randomUUID(),
              nonce: session.nonce,
              observedAtEpochMs: Date.now(),
              selectionStartedAtEpochMs,
              expectedAtMarkTime: this.deps.getPendingExpected?.(),
              page: {
                url: location.href,
                title: document.title,
                frameId: 0,
                viewport,
                scrollX: window.scrollX,
                scrollY: window.scrollY,
                devicePixelRatio: window.devicePixelRatio,
              },
              target: primaryTarget,
              targets,
              annotation,
            },
            session.sessionId
          )
        )
      )
      .then((response) => {
        if (!response?.ok || !response.scene) {
          this.deps.onError(
            t("issueSceneCaptureFailed", [response?.error ?? t("unknownError")])
          );
          this.deps.onCancel();
          return;
        }
        this.deps.onCaptureComplete(response.scene, response.dataUrl);
      })
      .catch((error) => {
        this.deps.onError(t("issueSceneCaptureFailed", [String(error)]));
        this.deps.onCancel();
      });
  }
}
