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
    | { sessionId: string; nonce: string; privacyMode: "safe" | "raw" }
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
  getEditorElement(): HTMLElement | undefined;
  shortcutKeyText: string;
};

export class SelectionOverlay {
  private _isActive = false;
  private startedAtEpochMs: number | undefined;
  private layer: HTMLDivElement | undefined;
  private escapeListener: ((event: KeyboardEvent) => void) | undefined;

  // Scroll lock state
  private scrollPreventListener: ((event: Event) => void) | undefined;
  private scrollKeyPreventListener:
    ((event: KeyboardEvent) => void) | undefined;
  private originalDocOverflow: string | undefined;
  private originalBodyOverflow: string | undefined;

  constructor(private readonly deps: SelectionOverlayDeps) {}

  get isActive(): boolean {
    return this._isActive;
  }
  get element(): HTMLDivElement | undefined {
    return this.layer;
  }

  open(): void {
    if (!this.deps.getSession() || this._isActive) return;
    this._isActive = true;
    this.startedAtEpochMs = Date.now();
    this.lockScroll();

    const layer = document.createElement("div");
    layer.id = "__wbr_issue_selection__";
    Object.assign(layer.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483646",
      cursor: "crosshair",
      background: "transparent",
    });
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
    Object.assign(hint.style, {
      position: "fixed",
      top: "18px",
      left: "50%",
      transform: "translateX(-50%)",
      maxWidth: "calc(100vw - 32px)",
      padding: "8px 16px",
      borderRadius: "999px",
      background: "rgba(29,33,41,.94)",
      border: "1px solid rgba(255,255,255,.2)",
      boxShadow: "0 8px 28px rgba(0,0,0,.28)",
      color: "#fff",
      font: "600 13px/1.35 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      whiteSpace: "nowrap",
      pointerEvents: "auto",
      display: "flex",
      alignItems: "center",
      gap: "12px",
      zIndex: "10",
    });

    const statusText = document.createElement("span");
    statusText.textContent = t("markModeHint", this.deps.shortcutKeyText);

    const btnGroup = document.createElement("div");
    Object.assign(btnGroup.style, {
      display: "flex",
      alignItems: "center",
      gap: "8px",
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
    });

    btnGroup.append(finishBtn, clearBtn, cancelBtn);
    hint.append(statusText, btnGroup);
    shadow.append(outline, boxesContainer, hint);
    document.documentElement.appendChild(layer);
    this.layer = layer;

    const selectedItems: SelectedTargetItem[] = [];
    let currentHovered:
      { element: Element; clientX: number; clientY: number } | undefined;

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

    const padX = 4;
    const padY = 3;

    const addTarget = (el: Element) => {
      if (selectedItems.some((item) => item.element === el)) return;
      const privacyMode = this.deps.getSession()?.privacyMode ?? "safe";
      const viewportWidth = Math.max(1, window.innerWidth);
      const viewportHeight = Math.max(1, window.innerHeight);
      const target = buildDomSnapshot(el, privacyMode);
      const rect = el.getBoundingClientRect();
      const left = Math.max(0, rect.left - padX);
      const top = Math.max(0, rect.top - padY);
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
        pointerEvents: "auto",
        boxSizing: "border-box",
      });

      const removeBtn = document.createElement("div");
      removeBtn.textContent = "✕";
      removeBtn.title = "移除该标记";
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
      this.captureMulti(selectedItems, currentHovered);
    };

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
        left: `${Math.max(0, rect.left - padX)}px`,
        top: `${Math.max(0, rect.top - padY)}px`,
        width: `${rect.width + padX * 2}px`,
        height: `${rect.height + padY * 2}px`,
      });
    });

    layer.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });
    layer.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (event.button !== 0) return;
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
    this._isActive = false;
    if (this.escapeListener)
      window.removeEventListener("keydown", this.escapeListener, true);
    this.escapeListener = undefined;
    this.layer?.remove();
    this.layer = undefined;
  }

  // ─── Private ───

  private lockScroll(): void {
    if (this.scrollPreventListener) return;
    this.originalDocOverflow = document.documentElement.style.overflow;
    this.originalBodyOverflow = document.body?.style.overflow;
    document.documentElement.style.overflow = "hidden";
    if (document.body) document.body.style.overflow = "hidden";

    this.scrollPreventListener = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    const scrollKeys = new Set([
      "ArrowUp",
      "ArrowDown",
      "PageUp",
      "PageDown",
      "Home",
      "End",
      " ",
    ]);
    this.scrollKeyPreventListener = (event: KeyboardEvent) => {
      if (scrollKeys.has(event.key)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("wheel", this.scrollPreventListener, {
      passive: false,
      capture: true,
    });
    window.addEventListener("touchmove", this.scrollPreventListener, {
      passive: false,
      capture: true,
    });
    window.addEventListener("keydown", this.scrollKeyPreventListener, {
      capture: true,
    });
  }

  private unlockScroll(): void {
    if (this.originalDocOverflow !== undefined) {
      document.documentElement.style.overflow = this.originalDocOverflow;
      this.originalDocOverflow = undefined;
    }
    if (this.originalBodyOverflow !== undefined && document.body) {
      document.body.style.overflow = this.originalBodyOverflow;
      this.originalBodyOverflow = undefined;
    }
    if (this.scrollPreventListener) {
      window.removeEventListener("wheel", this.scrollPreventListener, true);
      window.removeEventListener("touchmove", this.scrollPreventListener, true);
      this.scrollPreventListener = undefined;
    }
    if (this.scrollKeyPreventListener) {
      window.removeEventListener(
        "keydown",
        this.scrollKeyPreventListener,
        true
      );
      this.scrollKeyPreventListener = undefined;
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
      const box = {
        xRatio: Math.min(
          1,
          Math.max(0, rect.left / Math.max(1, viewport.width))
        ),
        yRatio: Math.min(
          1,
          Math.max(0, rect.top / Math.max(1, viewport.height))
        ),
        widthRatio: Math.min(
          1,
          Math.max(0, rect.width / Math.max(1, viewport.width))
        ),
        heightRatio: Math.min(
          1,
          Math.max(0, rect.height / Math.max(1, viewport.height))
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
      this.deps.onCancel();
      return;
    }

    this.unlockScroll();
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
          alert(`问题现场采集失败：${response?.error ?? "未知错误"}`);
          this.deps.onCancel();
          return;
        }
        this.deps.onCaptureComplete(response.scene, response.dataUrl);
      })
      .catch((error) => {
        alert(`问题现场采集失败：${String(error)}`);
        this.deps.onCancel();
      });
  }
}
