export const WORKSPACE_SPLIT_STORAGE_KEY = "bug-lens-workspace-split-ratio";

const DEFAULT_RESIZER_WIDTH_PX = 5;
const DEFAULT_MIN_LEFT_PX = 260;
const DEFAULT_MIN_RIGHT_PX = 320;
const DEFAULT_SPLIT_RATIO = 0.382;
const DEFAULT_ARIA_VALUE_NOW = "38";
const KEYBOARD_STEP_RATIO = 0.02;
const KEYBOARD_SHIFT_STEP_RATIO = 0.05;
const NARROW_FALLBACK_MIN_RATIO = 0.2;
const NARROW_FALLBACK_MAX_RATIO = 0.8;
const STORED_RATIO_MIN = 0.1;
const STORED_RATIO_MAX = 0.9;

const activeResizerCleanups = new WeakMap<object, () => void>();

export type ComputeWorkspaceSplitRatioParams = {
  containerWidth: number;
  desiredLeftPx: number;
  resizerWidthPx?: number;
  minLeftPx?: number;
  minRightPx?: number;
};

export type WorkspaceSplitRatioResult = {
  ratio: number;
  leftPct: number;
  leftPx: number;
};

export type BindWorkspaceResizerOptions = {
  storage?: Storage | null;
  resizerWidthPx?: number;
  minLeftPx?: number;
  minRightPx?: number;
};

/**
 * 计算左右工作区面板的合法分割比例与像素宽度。
 * 常规宽度下保证左侧不低于 minLeftPx、右侧不低于 minRightPx；
 * 容器过窄不足 minLeft + minRight + resizer 时按可用宽度比例降级，避免负值或溢出。
 */
export function computeWorkspaceSplitRatio(
  params: ComputeWorkspaceSplitRatioParams
): WorkspaceSplitRatioResult {
  const {
    containerWidth,
    desiredLeftPx,
    resizerWidthPx = DEFAULT_RESIZER_WIDTH_PX,
    minLeftPx = DEFAULT_MIN_LEFT_PX,
    minRightPx = DEFAULT_MIN_RIGHT_PX,
  } = params;

  if (!Number.isFinite(containerWidth) || containerWidth <= 0) {
    return {
      ratio: DEFAULT_SPLIT_RATIO,
      leftPct: Math.round(DEFAULT_SPLIT_RATIO * 10000) / 100,
      leftPx: 0,
    };
  }

  const safeResizerWidth = Number.isFinite(resizerWidthPx)
    ? Math.max(0, resizerWidthPx)
    : DEFAULT_RESIZER_WIDTH_PX;
  const availableWidth = containerWidth - safeResizerWidth;

  if (availableWidth <= 0) {
    return {
      ratio: DEFAULT_SPLIT_RATIO,
      leftPct: Math.round(DEFAULT_SPLIT_RATIO * 10000) / 100,
      leftPx: 0,
    };
  }

  const safeMinLeft = Number.isFinite(minLeftPx) ? Math.max(0, minLeftPx) : 0;
  const safeMinRight = Number.isFinite(minRightPx)
    ? Math.max(0, minRightPx)
    : 0;
  const safeDesired = Number.isFinite(desiredLeftPx)
    ? desiredLeftPx
    : availableWidth * DEFAULT_SPLIT_RATIO;

  let effectiveMinLeft: number;
  let effectiveMaxLeft: number;

  if (availableWidth >= safeMinLeft + safeMinRight) {
    effectiveMinLeft = safeMinLeft;
    effectiveMaxLeft = availableWidth - safeMinRight;
  } else {
    effectiveMinLeft = availableWidth * NARROW_FALLBACK_MIN_RATIO;
    effectiveMaxLeft = availableWidth * NARROW_FALLBACK_MAX_RATIO;
  }

  const clampedLeftPx = Math.min(
    effectiveMaxLeft,
    Math.max(effectiveMinLeft, safeDesired)
  );
  const ratio = clampedLeftPx / containerWidth;
  const leftPct = Math.round(ratio * 10000) / 100;

  return {
    ratio,
    leftPct,
    leftPx: clampedLeftPx,
  };
}

function getSafeStorage(explicitStorage?: Storage | null): Storage | null {
  if (explicitStorage !== undefined) {
    return explicitStorage;
  }
  try {
    const scope = globalThis as {
      window?: { localStorage?: Storage };
      localStorage?: Storage;
    };
    return scope.window?.localStorage ?? scope.localStorage ?? null;
  } catch {
    return null;
  }
}

function readStoredRatio(storage: Storage | null): number | null {
  if (!storage || typeof storage.getItem !== "function") return null;
  try {
    const raw = storage.getItem(WORKSPACE_SPLIT_STORAGE_KEY);
    if (raw == null) return null;
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStoredRatio(storage: Storage | null, ratio: number): void {
  if (!storage || typeof storage.setItem !== "function") return;
  try {
    storage.setItem(WORKSPACE_SPLIT_STORAGE_KEY, ratio.toFixed(4));
  } catch {
    // 受限沙盒或 file:// 协议下忽略持久化失败
  }
}

function removeStoredRatio(storage: Storage | null): void {
  if (!storage || typeof storage.removeItem !== "function") return;
  try {
    storage.removeItem(WORKSPACE_SPLIT_STORAGE_KEY);
  } catch {
    // 受限沙盒或 file:// 协议下忽略持久化清理失败
  }
}

function readContainerWidth(el: HTMLElement | null): number {
  const width = el?.getBoundingClientRect?.().width;
  return typeof width === "number" && Number.isFinite(width) && width > 0
    ? width
    : 0;
}

/**
 * 为预览页与离线报告 `.zen-workspace` 绑定可拖拽垂直分隔栏（#workspace-resizer）。
 * 缺失必要 DOM 节点时安全返回空清理函数，兼容最小 mock 测试环境。
 */
export function bindWorkspaceResizer(
  root: Document,
  options: BindWorkspaceResizerOptions = {}
): () => void {
  const workspace = root?.querySelector?.(
    ".zen-workspace"
  ) as HTMLElement | null;
  const resizer = root?.querySelector?.(
    "#workspace-resizer"
  ) as HTMLElement | null;
  if (!workspace || !resizer) {
    return () => {};
  }

  // 防止同一分隔栏元素被重复绑定（如离线报告入口与 PreviewPageShell 同时初始化）
  if (typeof resizer === "object") {
    activeResizerCleanups.get(resizer)?.();
  }

  const leftPanel = root?.querySelector?.(
    ".zen-left-panel"
  ) as HTMLElement | null;
  const resizerWidthPx = options.resizerWidthPx ?? DEFAULT_RESIZER_WIDTH_PX;
  const minLeftPx = options.minLeftPx ?? DEFAULT_MIN_LEFT_PX;
  const minRightPx = options.minRightPx ?? DEFAULT_MIN_RIGHT_PX;
  const storage = getSafeStorage(options.storage);

  let latestRatio: number | null = null;
  let activeDragCleanup: (() => void) | null = null;

  const applySplit = (ratio: number, leftPct: number) => {
    latestRatio = ratio;
    workspace.style?.setProperty?.("--zen-workspace-left", `${leftPct}%`);
    workspace.classList?.add?.("zen-workspace--resized");
    resizer.setAttribute?.("aria-valuenow", String(Math.round(leftPct)));
  };

  const resetSplit = () => {
    latestRatio = null;
    workspace.style?.removeProperty?.("--zen-workspace-left");
    workspace.classList?.remove?.("zen-workspace--resized");
    resizer.setAttribute?.("aria-valuenow", DEFAULT_ARIA_VALUE_NOW);
    removeStoredRatio(storage);
  };

  const getCurrentRatio = (containerWidth: number): number => {
    const inlineVal =
      workspace.style?.getPropertyValue?.("--zen-workspace-left") ?? "";
    const parsedPct = Number.parseFloat(inlineVal);
    if (Number.isFinite(parsedPct) && parsedPct > 0 && parsedPct < 100) {
      return parsedPct / 100;
    }
    const leftWidth = readContainerWidth(leftPanel);
    if (leftWidth > 0 && containerWidth > 0) {
      return leftWidth / containerWidth;
    }
    return latestRatio ?? DEFAULT_SPLIT_RATIO;
  };

  // 初始化恢复本地存储的分割比例
  const storedRatio = readStoredRatio(storage);
  if (storedRatio !== null) {
    const containerWidth = readContainerWidth(workspace);
    if (containerWidth > 0) {
      const computed = computeWorkspaceSplitRatio({
        containerWidth,
        desiredLeftPx: storedRatio * containerWidth,
        resizerWidthPx,
        minLeftPx,
        minRightPx,
      });
      applySplit(computed.ratio, computed.leftPct);
    } else {
      const clamped = Math.min(
        STORED_RATIO_MAX,
        Math.max(STORED_RATIO_MIN, storedRatio)
      );
      const leftPct = Math.round(clamped * 10000) / 100;
      applySplit(clamped, leftPct);
    }
  }

  const startDrag = (
    startX: number,
    mode: "pointer" | "mouse",
    pointerId?: number
  ) => {
    if (activeDragCleanup) return;
    const containerWidth = readContainerWidth(workspace);
    if (containerWidth <= 0) return;

    const leftWidth = readContainerWidth(leftPanel);
    const startLeftPx =
      leftWidth > 0
        ? leftWidth
        : getCurrentRatio(containerWidth) * containerWidth;

    resizer.classList?.add?.("dragging");
    const bodyStyle = root.body?.style;
    const prevCursor = bodyStyle?.cursor ?? "";
    const prevUserSelect = bodyStyle?.userSelect ?? "";
    if (bodyStyle) {
      bodyStyle.cursor = "col-resize";
      bodyStyle.userSelect = "none";
    }

    // 挂载全屏透明遮罩，防止拖拽经过 <video> 播放器时丢失指针事件
    let dragOverlay: HTMLElement | null = null;
    if (typeof root.createElement === "function" && root.body?.appendChild) {
      dragOverlay = root.createElement("div");
      if (dragOverlay?.style) {
        dragOverlay.style.cssText =
          "position:fixed;inset:0;z-index:9999;cursor:col-resize;";
      }
      root.body.appendChild(dragOverlay);
    }

    if (mode === "pointer" && pointerId !== undefined) {
      try {
        (
          resizer as HTMLElement & { setPointerCapture?: (id: number) => void }
        ).setPointerCapture?.(pointerId);
      } catch {
        // 忽略合成事件无活跃 pointerId 时的异常
      }
    }

    let dragRatio: number | null = null;

    const handleMove = (moveEvent: Event) => {
      const clientX = (moveEvent as Partial<PointerEvent>).clientX;
      if (typeof clientX !== "number") return;
      const desiredLeftPx = startLeftPx + (clientX - startX);
      const computed = computeWorkspaceSplitRatio({
        containerWidth,
        desiredLeftPx,
        resizerWidthPx,
        minLeftPx,
        minRightPx,
      });
      dragRatio = computed.ratio;
      applySplit(computed.ratio, computed.leftPct);
    };

    const finishDrag = (persist: boolean) => {
      if (!activeDragCleanup) return;
      const cleanup = activeDragCleanup;
      activeDragCleanup = null;
      cleanup();
      if (persist && dragRatio !== null) {
        writeStoredRatio(storage, dragRatio);
      }
    };

    const handleEnd = () => finishDrag(true);
    const handleCancel = () => finishDrag(false);

    if (mode === "pointer") {
      root.addEventListener?.("pointermove", handleMove);
      root.addEventListener?.("pointerup", handleEnd);
      root.addEventListener?.("pointercancel", handleCancel);
    } else {
      root.addEventListener?.("mousemove", handleMove);
      root.addEventListener?.("mouseup", handleEnd);
    }

    const globalWin = (globalThis as { window?: Window }).window;
    globalWin?.addEventListener?.("blur", handleCancel);

    activeDragCleanup = () => {
      resizer.classList?.remove?.("dragging");
      if (bodyStyle) {
        bodyStyle.cursor = prevCursor;
        bodyStyle.userSelect = prevUserSelect;
      }
      dragOverlay?.remove?.();
      if (mode === "pointer") {
        root.removeEventListener?.("pointermove", handleMove);
        root.removeEventListener?.("pointerup", handleEnd);
        root.removeEventListener?.("pointercancel", handleCancel);
        if (pointerId !== undefined) {
          try {
            (
              resizer as HTMLElement & {
                releasePointerCapture?: (id: number) => void;
              }
            ).releasePointerCapture?.(pointerId);
          } catch {
            // 忽略未持有捕获时的释放异常
          }
        }
      } else {
        root.removeEventListener?.("mousemove", handleMove);
        root.removeEventListener?.("mouseup", handleEnd);
      }
      globalWin?.removeEventListener?.("blur", handleCancel);
    };
  };

  const onPointerDown = (event: PointerEvent) => {
    if (typeof event.button === "number" && event.button !== 0) return;
    event.preventDefault?.();
    startDrag(event.clientX, "pointer", event.pointerId);
  };

  const onMouseDown = (event: MouseEvent) => {
    if (typeof PointerEvent !== "undefined") return;
    if (typeof event.button === "number" && event.button !== 0) return;
    event.preventDefault?.();
    startDrag(event.clientX, "mouse");
  };

  const onDblClick = () => {
    resetSplit();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const key = event.key;
    if (
      key !== "ArrowLeft" &&
      key !== "ArrowRight" &&
      key !== "Home" &&
      key !== "End"
    ) {
      return;
    }

    const containerWidth = readContainerWidth(workspace);
    if (containerWidth <= 0) return;

    event.preventDefault?.();

    let desiredLeftPx: number;
    if (key === "Home") {
      desiredLeftPx = 0;
    } else if (key === "End") {
      desiredLeftPx = containerWidth;
    } else {
      const step = event.shiftKey
        ? KEYBOARD_SHIFT_STEP_RATIO
        : KEYBOARD_STEP_RATIO;
      const delta = key === "ArrowRight" ? step : -step;
      const currentRatio = getCurrentRatio(containerWidth);
      desiredLeftPx = (currentRatio + delta) * containerWidth;
    }

    const computed = computeWorkspaceSplitRatio({
      containerWidth,
      desiredLeftPx,
      resizerWidthPx,
      minLeftPx,
      minRightPx,
    });
    applySplit(computed.ratio, computed.leftPct);
    writeStoredRatio(storage, computed.ratio);
  };

  resizer.addEventListener?.("pointerdown", onPointerDown as EventListener);
  resizer.addEventListener?.("mousedown", onMouseDown as EventListener);
  resizer.addEventListener?.("dblclick", onDblClick as EventListener);
  resizer.addEventListener?.("keydown", onKeyDown as EventListener);

  const cleanup = () => {
    if (
      typeof resizer === "object" &&
      activeResizerCleanups.get(resizer) === cleanup
    ) {
      activeResizerCleanups.delete(resizer);
    }
    if (activeDragCleanup) {
      const dragCleanup = activeDragCleanup;
      activeDragCleanup = null;
      dragCleanup();
    }
    resizer.removeEventListener?.(
      "pointerdown",
      onPointerDown as EventListener
    );
    resizer.removeEventListener?.("mousedown", onMouseDown as EventListener);
    resizer.removeEventListener?.("dblclick", onDblClick as EventListener);
    resizer.removeEventListener?.("keydown", onKeyDown as EventListener);
  };

  if (typeof resizer === "object") {
    activeResizerCleanups.set(resizer, cleanup);
  }

  return cleanup;
}
