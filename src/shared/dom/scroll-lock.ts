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
  /** 可选：闭合 Shadow DOM (mode: "closed") 引用，用于检测内部聚焦的输入框 */
  shadowRoot?: ShadowRoot | null;
}

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
 * 拦截页面 wheel、touchmove 与翻页/方向键滚动，返回解绑恢复函数。
 */
export function lockViewportScroll(
  options: ScrollLockOptions = {}
): () => void {
  const { lockOverflow = false, allowEditableKeys = true } = options;

  let originalDocOverflow: string | undefined;
  let originalBodyOverflow: string | undefined;

  if (lockOverflow && typeof document !== "undefined") {
    originalDocOverflow = document.documentElement.style.overflow;
    originalBodyOverflow = document.body?.style.overflow;
    document.documentElement.style.overflow = "hidden";
    if (document.body) document.body.style.overflow = "hidden";
  }

  const handlePreventScroll = (e: Event) => {
    if (e.type === "keydown") {
      const ke = e as KeyboardEvent;
      if (!SCROLL_KEYS.has(ke.key)) return;
      if (allowEditableKeys) {
        if (isEditableElement(options.shadowRoot?.activeElement)) {
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

  return () => {
    if (lockOverflow && typeof document !== "undefined") {
      if (originalDocOverflow !== undefined) {
        document.documentElement.style.overflow = originalDocOverflow;
      }
      if (originalBodyOverflow !== undefined && document.body) {
        document.body.style.overflow = originalBodyOverflow;
      }
    }
    window.removeEventListener("wheel", handlePreventScroll, true);
    window.removeEventListener("touchmove", handlePreventScroll, true);
    window.removeEventListener("keydown", handlePreventScroll, true);
  };
}
