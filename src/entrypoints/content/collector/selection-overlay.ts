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
  resolveTriggerDomElement,
} from "./dom-snapshot";
import { probeFrameworkComponents } from "../../../screenshot/probes/framework-probe";
import { probeEntryToFrameworkSnapshot } from "../../../domain/framework-state-capture";
import { t } from "../../../shared/i18n";
import { lockViewportScroll } from "../../../shared/dom/scroll-lock";

/** 视口坐标系下的矩形（与 getBoundingClientRect 一致，单位 px） */
export type SelectionRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export type SelectedTargetItem = {
  element: Element;
  target: TargetDomSnapshot;
  box: {
    xRatio: number;
    yRatio: number;
    widthRatio: number;
    heightRatio: number;
  };
  /** 该元素的高亮框几何（视口 px），用于推导选区整体 rect */
  rect: SelectionRect;
  overlayBox: HTMLElement;
};

/** 草稿元素候选：框内元素 + 其视口面积 */
export type DraftElementCandidate = { element: Element; area: number };

/**
 * 框选完成快照：把「选了什么」交给上层弹速记卡，
 * 截图与 issue-scene/capture 推迟到卡片落定后由 capture() 执行。
 */
export type SelectionSnapshot = {
  items: SelectedTargetItem[];
  viewport: { width: number; height: number };
  /** 选区整体 rect（视口 px）：卡片定位锚点 */
  rect: SelectionRect;
  annotation: AnnotationModel;
  /** 选区中心点命中的页面元素（极小选区不探测） */
  hitTest?: Element;
  /** 框内元素及面积（极小选区为空） */
  candidates: DraftElementCandidate[];
  /** 选区退化（<8px 或空白）：上层据此走「无元素」草稿兜底 */
  emptySelection: boolean;
  selectionStartedAtEpochMs?: number;
};

/** 选区视为有效元素的最小边长：更小的点击视为"点到空白/极小题" */
export const MIN_SELECTION_PX = 8;

/** 多个元素框的并集（视口 px）；空数组返回 0 尺寸矩形 */
export function unionSelectionRect(rects: SelectionRect[]): SelectionRect {
  if (rects.length === 0) return { top: 0, left: 0, width: 0, height: 0 };
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  const right = Math.max(...rects.map((r) => r.left + r.width));
  const bottom = Math.max(...rects.map((r) => r.top + r.height));
  return {
    top,
    left,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

/** 选区是否退化：宽或高不足 MIN_SELECTION_PX */
export function isDegenerateSelection(rect: SelectionRect): boolean {
  return (
    rect.width < MIN_SELECTION_PX ||
    rect.height < MIN_SELECTION_PX ||
    rect.width * rect.height <= 0
  );
}

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
  /** 最近一次页面确认点击的宿主元素（用于 Portal 浮层逆向绑定 triggerElement） */
  getLastTriggerElement?(): Element | undefined;
  onCaptureComplete(
    scene: {
      id: string;
      page: { viewport: { width: number; height: number } };
      annotation: AnnotationModel;
    },
    dataUrl: string | undefined
  ): void;
  /**
   * 框选完成：遮罩已收起、截图尚未采集。上层在此弹出速记卡，
   * 卡片落定后再调用 overlay.capture(snapshot) 继续截图与落库。
   */
  onSelectionReady(snapshot: SelectionSnapshot): void;
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

  // 滚动锁定状态
  private unlockScrollFn: (() => void) | undefined;

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
      const target = buildDomSnapshot(el, privacyMode, {
        fallbackTriggerElement: this.deps.getLastTriggerElement?.(),
      });
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

      const item: SelectedTargetItem = {
        element: el,
        target,
        box,
        rect: { top, left, width, height },
        overlayBox,
      };
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

    // 结束选择：收起遮罩，交给上层弹速记卡（截图在卡片落定后进行）
    const doFinish = () => {
      if (selectedItems.length === 0 && !currentHovered) return;
      shadow.querySelectorAll("div").forEach((el) => {
        if (el.textContent === "✕") el.style.display = "none";
      });
      hint.style.display = "none";
      outline.style.display = "none";
      this.finishSelection(selectedItems, currentHovered);
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
    if (this.unlockScrollFn) return;
    this.unlockScrollFn = lockViewportScroll({
      lockOverflow: true,
      allowEditableKeys: false,
    });
  }

  private unlockScroll(): void {
    if (this.unlockScrollFn) {
      this.unlockScrollFn();
      this.unlockScrollFn = undefined;
    }
  }

  /**
   * 框选结束：只产出"选了什么"（rect / 命中元素 / annotation），
   * 收起遮罩并把控制权交回上层（弹速记卡）。截图推迟到 capture()。
   */
  private finishSelection(
    items: SelectedTargetItem[],
    fallbackCandidate?: { element: Element; clientX: number; clientY: number }
  ): void {
    const session = this.deps.getSession();
    if (!session || !this._isActive) return;

    let finalItems = [...items];
    if (finalItems.length === 0 && fallbackCandidate) {
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const target = buildDomSnapshot(
        fallbackCandidate.element,
        session.privacyMode,
        { fallbackTriggerElement: this.deps.getLastTriggerElement?.() }
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
          rect: {
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
          },
          overlayBox: dummyOverlay,
        },
      ];
    }

    if (finalItems.length === 0) {
      this.teardownInteraction();
      this._isActive = false;
      this.deps.onCancel();
      return;
    }

    // 收起遮罩与滚动锁，但保持 _isActive：卡片阶段仍视作标记流程进行中，
    // 空闲监测与页面交互采集不在此期间抢跑。
    this.teardownInteraction();

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

    const rect = unionSelectionRect(finalItems.map((item) => item.rect));
    const degenerate = isDegenerateSelection(rect);
    const hitTest = degenerate
      ? undefined
      : pageElementAtPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
          undefined,
          this.deps.getEditorElement()
        );

    const snapshot: SelectionSnapshot = {
      items: finalItems,
      viewport,
      rect,
      annotation,
      hitTest,
      candidates: degenerate
        ? []
        : finalItems.map((item) => ({
            element: item.element,
            area: Math.max(0, item.rect.width) * Math.max(0, item.rect.height),
          })),
      emptySelection: degenerate,
      selectionStartedAtEpochMs: this.startedAtEpochMs,
    };

    this.deps.onSelectionReady(snapshot);
  }

  private teardownInteraction(): void {
    if (this.escapeListener)
      window.removeEventListener("keydown", this.escapeListener, true);
    this.escapeListener = undefined;
    this.unlockScroll();
    this.layer?.remove();
    this.layer = undefined;
  }

  /**
   * 卡片落定后继续采集：框架探针 → issue-scene/capture → 编辑器。
   * 期望在此时才读取，确保 captures 到的是速记卡产出的 expected。
   */
  capture(snapshot: SelectionSnapshot): void {
    const session = this.deps.getSession();
    if (!session || !this._isActive) return;
    this._isActive = false;
    const { items: finalItems, viewport, annotation } = snapshot;
    const targets = finalItems.map((item) => item.target);
    const primaryTarget = targets[0];
    const selectionStartedAtEpochMs = snapshot.selectionStartedAtEpochMs;
    this.startedAtEpochMs = undefined;
    const enrichFrameworkViaMainProbe = async () => {
      if (
        typeof chrome === "undefined" ||
        typeof chrome.runtime?.sendMessage !== "function"
      ) {
        return;
      }
      const triggerFallback = this.deps.getLastTriggerElement?.();
      const triggerElByTarget = new Map<SelectedTargetItem, Element>();
      const probeList: Element[] = [];
      for (const item of finalItems) {
        probeList.push(item.element);
        const trigEl = resolveTriggerDomElement(item.element, triggerFallback);
        if (trigEl) {
          triggerElByTarget.set(item, trigEl);
          probeList.push(trigEl);
        }
      }
      if (probeList.length === 0) return;
      try {
        const probeMap = await Promise.race([
          probeFrameworkComponents(probeList),
          new Promise<Map<Element, null>>((resolve) =>
            setTimeout(() => resolve(new Map()), 150)
          ),
        ]);
        for (const item of finalItems) {
          const entry = probeMap.get(item.element);
          if (entry && !item.target.element.framework) {
            const snapshot = probeEntryToFrameworkSnapshot(
              entry,
              session.privacyMode
            );
            if (snapshot) {
              item.target.element.framework = snapshot;
            }
          }
          const trigEl = triggerElByTarget.get(item);
          const trigEntry = trigEl ? probeMap.get(trigEl) : undefined;
          if (
            trigEntry?.componentName &&
            item.target.triggerElement &&
            !item.target.triggerElement.componentName
          ) {
            item.target.triggerElement = {
              ...item.target.triggerElement,
              componentName: trigEntry.componentName,
            };
          }
        }
      } catch {
        // 探针失败不阻塞 issue-scene 采集
      }
    };
    void new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    )
      .then(() => enrichFrameworkViaMainProbe())
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
