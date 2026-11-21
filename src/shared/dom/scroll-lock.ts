const SCROLL_KEYS = new Set([
  " ",
  "Space",
  "PageUp",
  "PageDown",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
]);

export interface ScrollLockOptions {
  /** 是否同时将 documentElement 与 body 的 overflow 设为 hidden */
  lockOverflow?: boolean;
  /** 是否放行 INPUT / TEXTAREA 内部的滚动按键 */
  allowEditableKeys?: boolean;
  /** 是否放行鼠标滚轮 wheel 事件（例如在移动仿真模式下允许通过滚轮查看页面长内容） */
  allowWheel?: boolean;
  /** 是否放行 touchmove 事件（例如在「滚页面」模式下允许用户拖拽滚动） */
  allowTouchMove?: boolean;
  /** 可选：闭合 Shadow DOM (mode: "closed") 引用，用于检测内部聚焦的输入框 */
  shadowRoot?: ShadowRoot | null;
}

export type ScrollLockController = (() => void) & {
  release: () => void;
  pause: () => void;
  resume: () => void;
  update: (newOptions: Partial<ScrollLockOptions>) => void;
};

function isEditableElement(el: Element | null | undefined): boolean {
  if (!el) return false;
  const htmlEl = el as HTMLElement;
  return (
    htmlEl.tagName === "INPUT" ||
    htmlEl.tagName === "TEXTAREA" ||
    Boolean(htmlEl.isContentEditable) ||
    htmlEl.classList?.contains("inline-text-input")
  );
}

/**
 * 拦截页面 wheel、touchmove 与翻页/方向键滚动，返回解绑恢复控制器。
 */
export function lockViewportScroll(
  options: ScrollLockOptions = {}
): ScrollLockController {
  let currentOptions: ScrollLockOptions = {
    lockOverflow: false,
    allowEditableKeys: true,
    allowWheel: false,
    allowTouchMove: false,
    ...options,
  };

  let isPaused = false;
  let isReleased = false;

  let originalDocOverflow: string | undefined;
  let originalBodyOverflow: string | undefined;
  let isOverflowLocked = false;

  const applyOverflowLock = () => {
    if (isOverflowLocked || typeof document === "undefined") return;
    originalDocOverflow = document.documentElement?.style?.overflow;
    originalBodyOverflow = document.body?.style?.overflow;
    if (document.documentElement) {
      document.documentElement.style.overflow = "hidden";
    }
    if (document.body) {
      document.body.style.overflow = "hidden";
    }
    isOverflowLocked = true;
  };

  const restoreOverflowLock = () => {
    if (!isOverflowLocked || typeof document === "undefined") return;
    if (document.documentElement && originalDocOverflow !== undefined) {
      document.documentElement.style.overflow = originalDocOverflow;
    }
    if (document.body && originalBodyOverflow !== undefined) {
      document.body.style.overflow = originalBodyOverflow;
    }
    isOverflowLocked = false;
  };

  if (currentOptions.lockOverflow) {
    applyOverflowLock();
  }

  const handlePreventScroll = (e: Event) => {
    if (isPaused || isReleased) return;

    if (e.type === "wheel") {
      if (currentOptions.allowWheel) return;
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (e.type === "touchmove") {
      if (currentOptions.allowTouchMove) return;
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (e.type === "keydown") {
      const ke = e as KeyboardEvent;
      if (!SCROLL_KEYS.has(ke.key)) return;
      if (currentOptions.allowEditableKeys) {
        if (isEditableElement(currentOptions.shadowRoot?.activeElement)) {
          return;
        }
        const composedTarget =
          typeof ke.composedPath === "function"
            ? (ke.composedPath()[0] as Element | undefined)
            : undefined;
        const target = composedTarget ?? (ke.target as Element | null);
        if (isEditableElement(target)) {
          return;
        }
      }
      e.preventDefault();
      e.stopPropagation();
    } else {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  if (typeof window !== "undefined") {
    window.addEventListener("wheel", handlePreventScroll, {
      passive: false,
      capture: true,
    });
    window.addEventListener("touchmove", handlePreventScroll, {
      passive: false,
      capture: true,
    });
    window.addEventListener("keydown", handlePreventScroll, {
      capture: true,
    });
  }

  const release = () => {
    if (isReleased) return;
    isReleased = true;
    restoreOverflowLock();
    if (typeof window !== "undefined") {
      window.removeEventListener("wheel", handlePreventScroll, true);
      window.removeEventListener("touchmove", handlePreventScroll, true);
      window.removeEventListener("keydown", handlePreventScroll, true);
    }
  };

  const pause = () => {
    if (isPaused || isReleased) return;
    isPaused = true;
    if (isOverflowLocked) {
      restoreOverflowLock();
    }
  };

  const resume = () => {
    if (!isPaused || isReleased) return;
    isPaused = false;
    if (currentOptions.lockOverflow) {
      applyOverflowLock();
    }
  };

  const update = (newOptions: Partial<ScrollLockOptions>) => {
    if (isReleased) return;
    const prevLockOverflow = currentOptions.lockOverflow;
    currentOptions = { ...currentOptions, ...newOptions };
    if (!isPaused) {
      if (!prevLockOverflow && currentOptions.lockOverflow) {
        applyOverflowLock();
      } else if (prevLockOverflow && !currentOptions.lockOverflow) {
        restoreOverflowLock();
      }
    }
  };

  const controller = release as ScrollLockController;
  controller.release = release;
  controller.pause = pause;
  controller.resume = resume;
  controller.update = update;

  return controller;
}
