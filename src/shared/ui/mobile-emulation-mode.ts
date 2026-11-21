export const MOBILE_EMULATION_ATTR = "data-wbr-mobile-mode";
export const MOBILE_VIEWPORT_MAX_WIDTH = 600;
export const MOBILE_LANDSCAPE_SHORT_SIDE_MAX = 500;

export const MOBILE_POINTER_MEDIA_QUERY = "(hover: none), (pointer: coarse)";

const DEFAULT_VIEWPORT_WIDTH = 1024;
const DEFAULT_VIEWPORT_HEIGHT = 768;
const DEFAULT_VIEWPORT_PADDING = 8;

export interface ViewportMetrics {
  width: number;
  height: number;
}

type MediaQueryListLike = MediaQueryList & {
  addListener?: (listener: () => void) => void;
  removeListener?: (listener: () => void) => void;
};

function resolveWindow(win?: Window): Window | undefined {
  if (win) return win;
  return typeof window !== "undefined" ? window : undefined;
}

function toPositiveFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  return undefined;
}

/**
 * 安全读取当前视口 CSS 像素宽高（优先 innerWidth/innerHeight，其次 documentElement.clientWidth/clientHeight，兜底 1024×768）。
 */
export function getViewportMetrics(win?: Window): ViewportMetrics {
  const targetWin = resolveWindow(win);
  if (!targetWin) {
    return { width: DEFAULT_VIEWPORT_WIDTH, height: DEFAULT_VIEWPORT_HEIGHT };
  }

  const docEl = targetWin.document?.documentElement;
  const width =
    toPositiveFiniteNumber(targetWin.innerWidth) ??
    toPositiveFiniteNumber(docEl?.clientWidth) ??
    DEFAULT_VIEWPORT_WIDTH;
  const height =
    toPositiveFiniteNumber(targetWin.innerHeight) ??
    toPositiveFiniteNumber(docEl?.clientHeight) ??
    DEFAULT_VIEWPORT_HEIGHT;

  return { width, height };
}

/**
 * 检测当前设备/仿真环境是否匹配无悬停或粗粒度指针。
 */
export function isCoarseOrNoHoverPointer(win?: Window): boolean {
  const targetWin = resolveWindow(win);
  if (!targetWin || typeof targetWin.matchMedia !== "function") {
    return false;
  }
  try {
    return Boolean(targetWin.matchMedia(MOBILE_POINTER_MEDIA_QUERY)?.matches);
  } catch {
    return false;
  }
}

/**
 * 判断当前是否处于移动设备或 Chrome DevTools 手机仿真视口。
 */
export function isMobileEmulationViewport(win?: Window): boolean {
  const { width, height } = getViewportMetrics(win);
  if (width <= MOBILE_VIEWPORT_MAX_WIDTH) {
    return true;
  }
  if (
    isCoarseOrNoHoverPointer(win) &&
    Math.min(width, height) <= MOBILE_LANDSCAPE_SHORT_SIDE_MAX
  ) {
    return true;
  }
  return false;
}

/**
 * 同步宿主容器上的移动仿真模式属性标记，用于驱动样式切换。
 */
export function syncMobileEmulationAttribute(
  el: HTMLElement | null | undefined,
  isMobile: boolean
): void {
  if (!el) return;
  if (isMobile) {
    if (typeof el.setAttribute === "function") {
      el.setAttribute(MOBILE_EMULATION_ATTR, "true");
    } else if (el.dataset) {
      el.dataset.wbrMobileMode = "true";
    }
    return;
  }

  if (typeof el.removeAttribute === "function") {
    el.removeAttribute(MOBILE_EMULATION_ATTR);
  } else if (el.dataset) {
    delete el.dataset.wbrMobileMode;
  }
}

/**
 * 监听视口尺寸与指针媒体查询变更，并在变化时回调最新移动仿真状态，返回幂等清理函数。
 */
export function observeMobileEmulationMode(
  onChange: (isMobile: boolean, metrics: ViewportMetrics) => void,
  win?: Window
): () => void {
  const targetWin = resolveWindow(win);
  if (!targetWin) {
    return () => {};
  }

  let cleaned = false;

  const handleChange = () => {
    if (cleaned) return;
    const metrics = getViewportMetrics(targetWin);
    const isMobile =
      metrics.width <= MOBILE_VIEWPORT_MAX_WIDTH ||
      (isCoarseOrNoHoverPointer(targetWin) &&
        Math.min(metrics.width, metrics.height) <=
          MOBILE_LANDSCAPE_SHORT_SIDE_MAX);
    onChange(isMobile, metrics);
  };

  if (typeof targetWin.addEventListener === "function") {
    targetWin.addEventListener("resize", handleChange);
  }

  const visualViewport = targetWin.visualViewport;
  if (visualViewport && typeof visualViewport.addEventListener === "function") {
    visualViewport.addEventListener("resize", handleChange);
  }

  let mql: MediaQueryListLike | undefined;
  let mqlListenerMode: "event" | "legacy" | undefined;
  if (typeof targetWin.matchMedia === "function") {
    try {
      mql = targetWin.matchMedia(
        MOBILE_POINTER_MEDIA_QUERY
      ) as MediaQueryListLike;
      if (mql && typeof mql.addEventListener === "function") {
        mql.addEventListener("change", handleChange);
        mqlListenerMode = "event";
      } else if (mql && typeof mql.addListener === "function") {
        mql.addListener(handleChange);
        mqlListenerMode = "legacy";
      }
    } catch {
      mql = undefined;
    }
  }

  return () => {
    if (cleaned) return;
    cleaned = true;

    if (typeof targetWin.removeEventListener === "function") {
      targetWin.removeEventListener("resize", handleChange);
    }
    if (
      visualViewport &&
      typeof visualViewport.removeEventListener === "function"
    ) {
      visualViewport.removeEventListener("resize", handleChange);
    }
    if (mql) {
      try {
        if (
          mqlListenerMode === "event" &&
          typeof mql.removeEventListener === "function"
        ) {
          mql.removeEventListener("change", handleChange);
        } else if (
          mqlListenerMode === "legacy" &&
          typeof mql.removeListener === "function"
        ) {
          mql.removeListener(handleChange);
        }
      } catch {
        // 忽略受限环境注销异常
      }
    }
  };
}

/**
 * 将悬浮盒坐标约束在安全视口边距之内，避免窄屏越界遮挡。
 */
export function clampPositionToViewport(
  x: number,
  y: number,
  boxWidth: number,
  boxHeight: number,
  padding = DEFAULT_VIEWPORT_PADDING,
  win?: Window
): { x: number; y: number } {
  const { width: vw, height: vh } = getViewportMetrics(win);
  const safePadding =
    Number.isFinite(padding) && padding >= 0
      ? padding
      : DEFAULT_VIEWPORT_PADDING;
  const safeBoxWidth =
    Number.isFinite(boxWidth) && boxWidth >= 0 ? boxWidth : 0;
  const safeBoxHeight =
    Number.isFinite(boxHeight) && boxHeight >= 0 ? boxHeight : 0;

  const maxX = Math.max(safePadding, vw - safeBoxWidth - safePadding);
  const maxY = Math.max(safePadding, vh - safeBoxHeight - safePadding);

  const safeX = Number.isFinite(x) ? x : safePadding;
  const safeY = Number.isFinite(y) ? y : safePadding;

  return {
    x: Math.min(Math.max(safeX, safePadding), maxX),
    y: Math.min(Math.max(safeY, safePadding), maxY),
  };
}
