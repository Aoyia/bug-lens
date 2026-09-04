export interface FrameOffset {
  x: number;
  y: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export interface FrameGeometry {
  offset: FrameOffset;
  viewport: ViewportSize;
}

export interface NormalizedCoordinates {
  clientX: number;
  clientY: number;
  localX: number;
  localY: number;
  viewport: ViewportSize;
}

export const QUERY_FRAME_OFFSET_TYPE = "__BUG_LENS_QUERY_FRAME_OFFSET__";
export const RESPONSE_FRAME_OFFSET_TYPE = "__BUG_LENS_FRAME_OFFSET_RESPONSE__";

let cachedCrossChunkOffset: FrameOffset = { x: 0, y: 0 };
let cachedTopViewport: ViewportSize | null = null;

/**
 * 遍历 window.frameElement 链，向上累加同源 iframe 的 getBoundingClientRect().left/top，
 * 并获取顶层窗口的视口大小。
 */
export function calculateSameOriginFrameOffset(win: Window = window): {
  offset: FrameOffset;
  viewport: ViewportSize;
  reachedTop: boolean;
} {
  let offsetX = 0;
  let offsetY = 0;
  let curr: Window = win;

  try {
    if (curr.top === curr) {
      return {
        offset: { x: 0, y: 0 },
        viewport: { width: curr.innerWidth, height: curr.innerHeight },
        reachedTop: true,
      };
    }

    while (curr && curr !== curr.top) {
      const frameEl = curr.frameElement;
      if (!frameEl) break;
      const rect = frameEl.getBoundingClientRect();
      const borderLeft = Number((frameEl as any).clientLeft) || 0;
      const borderTop = Number((frameEl as any).clientTop) || 0;
      offsetX += rect.left + borderLeft;
      offsetY += rect.top + borderTop;
      curr = curr.parent;
    }

    if (curr === curr.top) {
      return {
        offset: { x: offsetX, y: offsetY },
        viewport: { width: curr.innerWidth, height: curr.innerHeight },
        reachedTop: true,
      };
    }
  } catch {
    // 跨域访问 curr.frameElement 或 curr.parent 时抛出 SecurityError，终止同源遍历
  }

  return {
    offset: { x: offsetX, y: offsetY },
    viewport: {
      width: win.innerWidth ?? 0,
      height: win.innerHeight ?? 0,
    },
    reachedTop: false,
  };
}

/**
 * 初始化跨域 postMessage 几何通信桥：
 * 1. 顶层窗口监听来自子 iframe 的偏移查询，匹配 iframe.contentWindow 并回传偏移与视口大小；
 * 2. 顶层窗口监听滚动与缩放，主动向所有 iframe 广播最新视口与几何偏移；
 * 3. 嵌套跨域 frame 无法直接匹配时回传权威顶层视口兜底响应；
 * 4. 子 iframe 校验 event.source 保证安全，防恶意消息污染。
 */
export function initFrameGeometryBridge(win: Window = window): () => void {
  if (typeof win === "undefined") return () => undefined;
  if ((win as any).__BUG_LENS_FRAME_GEOMETRY_BRIDGE_INSTALLED__) {
    return (
      (win as any).__BUG_LENS_FRAME_GEOMETRY_BRIDGE_CLEANUP__ ||
      (() => undefined)
    );
  }
  (win as any).__BUG_LENS_FRAME_GEOMETRY_BRIDGE_INSTALLED__ = true;

  const isTop = win.top === win;

  const broadcastGeometry = () => {
    try {
      if (!win.document || typeof win.document.querySelectorAll !== "function")
        return;
      const iframes = Array.from(win.document.querySelectorAll("iframe"));
      for (const iframe of iframes) {
        if (iframe.contentWindow) {
          const rect = iframe.getBoundingClientRect();
          const borderLeft = Number((iframe as any).clientLeft) || 0;
          const borderTop = Number((iframe as any).clientTop) || 0;
          try {
            (iframe.contentWindow as WindowProxy).postMessage(
              {
                type: RESPONSE_FRAME_OFFSET_TYPE,
                offset: {
                  x: rect.left + borderLeft,
                  y: rect.top + borderTop,
                },
                viewport: {
                  width: win.innerWidth ?? 0,
                  height: win.innerHeight ?? 0,
                },
              },
              "*"
            );
          } catch {}
        }
      }
    } catch {}
  };

  let rafId: any = null;
  const onScrollOrResize = () => {
    if (rafId !== null) return;
    const schedule =
      typeof win.requestAnimationFrame === "function"
        ? (cb: () => void) => win.requestAnimationFrame(cb)
        : (cb: () => void) => win.setTimeout(cb, 16);
    rafId = schedule(() => {
      rafId = null;
      broadcastGeometry();
    });
  };

  if (isTop && typeof win.addEventListener === "function") {
    win.addEventListener("scroll", onScrollOrResize, {
      capture: true,
      passive: true,
    } as any);
    win.addEventListener("resize", onScrollOrResize, { passive: true } as any);
  }

  const handleMessage = (event: MessageEvent) => {
    if (!event.data || typeof event.data !== "object") return;

    // 顶层及中间窗口处理查询
    if (event.data.type === QUERY_FRAME_OFFSET_TYPE) {
      const reqId = event.data.reqId;
      let matched = false;
      try {
        if (
          win.document &&
          typeof win.document.querySelectorAll === "function"
        ) {
          const iframes = Array.from(win.document.querySelectorAll("iframe"));
          for (const iframe of iframes) {
            if (iframe.contentWindow === event.source) {
              const rect = iframe.getBoundingClientRect();
              const borderLeft = Number((iframe as any).clientLeft) || 0;
              const borderTop = Number((iframe as any).clientTop) || 0;
              const baseOffset = isTop
                ? { x: 0, y: 0 }
                : getFrameGeometry(win).offset;
              const baseViewport = isTop
                ? { width: win.innerWidth ?? 0, height: win.innerHeight ?? 0 }
                : getFrameGeometry(win).viewport;

              (event.source as WindowProxy).postMessage(
                {
                  type: RESPONSE_FRAME_OFFSET_TYPE,
                  reqId,
                  offset: {
                    x: baseOffset.x + rect.left + borderLeft,
                    y: baseOffset.y + rect.top + borderTop,
                  },
                  viewport: baseViewport,
                },
                "*"
              );
              matched = true;
              return;
            }
          }
        }
      } catch {
        // 忽略 DOM 访问异常
      }

      // 若为顶层窗口且在当前 DOM 中未能直接匹配该 source（例如跨域嵌套的孙 frame），
      // 必须回传兜底响应提供顶层权威视口尺寸，防止子 frame 发生画布乘数放大畸变
      if (isTop && !matched && event.source) {
        try {
          (event.source as WindowProxy).postMessage(
            {
              type: RESPONSE_FRAME_OFFSET_TYPE,
              reqId,
              offset: { x: 0, y: 0 },
              viewport: {
                width: win.innerWidth ?? 0,
                height: win.innerHeight ?? 0,
              },
              isFallback: true,
            },
            "*"
          );
        } catch {}
      }
      return;
    }

    // 子 iframe 处理响应
    if (!isTop && event.data.type === RESPONSE_FRAME_OFFSET_TYPE) {
      // 核心安全守卫：拒绝一切非 win.top 且非 win.parent 的伪造来源
      if (
        !event.source ||
        (event.source !== win.top && event.source !== win.parent)
      ) {
        return;
      }
      if (event.data.offset) {
        cachedCrossChunkOffset = {
          x: Number(event.data.offset.x) || 0,
          y: Number(event.data.offset.y) || 0,
        };
      }
      if (event.data.viewport) {
        cachedTopViewport = {
          width: Number(event.data.viewport.width) || 0,
          height: Number(event.data.viewport.height) || 0,
        };
      }
    }
  };

  win.addEventListener("message", handleMessage);

  // 子 iframe 主动向 window.top 与 window.parent 发起查询
  if (!isTop) {
    const reqId = crypto.randomUUID?.() ?? String(Date.now());
    try {
      win.top?.postMessage({ type: QUERY_FRAME_OFFSET_TYPE, reqId }, "*");
    } catch {
      // 忽略跨域发送异常
    }
    try {
      if (win.parent && win.parent !== win.top) {
        win.parent.postMessage({ type: QUERY_FRAME_OFFSET_TYPE, reqId }, "*");
      }
    } catch {}
  }

  const cleanup = () => {
    (win as any).__BUG_LENS_FRAME_GEOMETRY_BRIDGE_INSTALLED__ = false;
    delete (win as any).__BUG_LENS_FRAME_GEOMETRY_BRIDGE_CLEANUP__;
    if (typeof win.removeEventListener === "function") {
      win.removeEventListener("message", handleMessage);
      if (isTop) {
        try {
          win.removeEventListener("scroll", onScrollOrResize, {
            capture: true,
          } as any);
          win.removeEventListener("resize", onScrollOrResize);
          if (rafId !== null) {
            if (typeof win.cancelAnimationFrame === "function") {
              win.cancelAnimationFrame(rafId);
            } else if (typeof win.clearTimeout === "function") {
              win.clearTimeout(rafId);
            }
            rafId = null;
          }
        } catch {}
      }
    }
  };
  (win as any).__BUG_LENS_FRAME_GEOMETRY_BRIDGE_CLEANUP__ = cleanup;
  return cleanup;
}

/**
 * 获取当前窗口相对于顶层视口的几何信息（offset 与 viewport）。
 * 优先同源计算；若存在跨域障碍，融合跨域 postMessage 缓存。
 */
export function getFrameGeometry(win: Window = window): FrameGeometry {
  if (typeof win === "undefined") {
    return { offset: { x: 0, y: 0 }, viewport: { width: 0, height: 0 } };
  }

  const sameOrigin = calculateSameOriginFrameOffset(win);
  if (sameOrigin.reachedTop) {
    return {
      offset: sameOrigin.offset,
      viewport: sameOrigin.viewport,
    };
  }

  return {
    offset: {
      x: sameOrigin.offset.x + cachedCrossChunkOffset.x,
      y: sameOrigin.offset.y + cachedCrossChunkOffset.y,
    },
    viewport: cachedTopViewport ?? sameOrigin.viewport,
  };
}

/**
 * 将局部坐标规范化为绝对视口坐标：
 * 在顶层视口时 clientX === localX；
 * 在子 frame 中时 clientX = localX + offset.x，同时保留 localX/localY。
 */
export function normalizeCoordinates(
  localX: number,
  localY: number,
  win: Window = window
): NormalizedCoordinates {
  const isChild = typeof win !== "undefined" && win.top !== win;
  const geometry = getFrameGeometry(win);

  return {
    clientX: isChild ? localX + geometry.offset.x : localX,
    clientY: isChild ? localY + geometry.offset.y : localY,
    localX,
    localY,
    viewport: geometry.viewport,
  };
}

// 供单元测试注入与重置的辅助方法
export function setCachedCrossOriginGeometry(
  offset: FrameOffset,
  viewport: ViewportSize
): void {
  cachedCrossChunkOffset = offset;
  cachedTopViewport = viewport;
}

export function resetFrameGeometryCache(): void {
  cachedCrossChunkOffset = { x: 0, y: 0 };
  cachedTopViewport = null;
}
