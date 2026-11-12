const FIELD_STOP_PROPAGATION_EVENTS = [
  "click",
  "keydown",
  "keyup",
  "keypress",
  "input",
  "beforeinput",
  "compositionstart",
  "compositionupdate",
  "compositionend",
] as const;

const CONTAINER_STOP_PROPAGATION_EVENTS = [
  "pointerdown",
  "mousedown",
  "mouseup",
  "click",
  "dblclick",
  "contextmenu",
  "focusin",
  "focusout",
] as const;

/**
 * 为注入输入框挂载事件冒泡阻断屏障，防止宿主页面全局快捷键或模态框拦截输入。
 */
export function attachFieldEventShield(
  field: HTMLElement | null,
  options?: {
    onFocusOrPointer?: (target: EventTarget | null) => void;
  }
): void {
  if (!field) return;
  const onFocusOrPointer = options?.onFocusOrPointer;
  field.addEventListener("focus", (e) => {
    onFocusOrPointer?.(e.target);
    e.stopPropagation?.();
  });
  field.addEventListener("pointerdown", (e) => {
    onFocusOrPointer?.(e.target);
    e.stopPropagation?.();
  });
  field.addEventListener("mousedown", (e) => {
    onFocusOrPointer?.(e.target);
    e.stopPropagation?.();
    field.focus();
  });
  for (const eventName of FIELD_STOP_PROPAGATION_EVENTS) {
    field.addEventListener(eventName, (e) => e.stopPropagation?.());
  }
}

/**
 * 为注入卡片/面板容器挂载指针与焦点冒泡屏障。
 */
export function attachContainerEventShield(container: HTMLElement): void {
  for (const eventName of CONTAINER_STOP_PROPAGATION_EVENTS) {
    container.addEventListener(eventName, (e) => e.stopPropagation?.());
  }
}

/**
 * 在 window 捕获阶段挂载反向焦点陷阱，防止宿主页面（如 AntD/Element Modal）抢夺焦点。
 */
export function installWindowFocusShield(options: {
  root: HTMLElement;
  isOpen: () => boolean;
  getActiveField: () => HTMLElement | null;
}): () => void {
  const handleWindowFocusCapture = (e: FocusEvent) => {
    const target = e.target as Node | null;
    if (target && (options.root.contains?.(target) ?? false)) {
      e.stopImmediatePropagation?.();
      return;
    }
    const isExternalElement =
      typeof HTMLElement !== "undefined"
        ? target instanceof HTMLElement
        : Boolean(target && (target as any).tagName);
    const activeField = options.getActiveField();
    if (
      activeField &&
      options.isOpen() &&
      isExternalElement &&
      target !== document.body &&
      target !== document.documentElement
    ) {
      e.stopImmediatePropagation?.();
      e.preventDefault?.();
      activeField.focus();
    }
  };

  window.addEventListener("focus", handleWindowFocusCapture, true);
  window.addEventListener("focusin", handleWindowFocusCapture, true);

  return () => {
    window.removeEventListener("focus", handleWindowFocusCapture, true);
    window.removeEventListener("focusin", handleWindowFocusCapture, true);
  };
}
