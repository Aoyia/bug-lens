import {
  formatPayloadToMarkdown,
  normalizePayloadKeyOrder,
  type AIScreenshotPayload,
  type AnnotationItem,
  type RectBounds,
} from "../domain/screenshot-payload.ts";
import { message } from "../shared/protocol.ts";
import {
  TEXT_ANNOTATION_FONT_FAMILY,
  TEXT_ANNOTATION_FONT_SIZE,
  TEXT_BUBBLE_BACKGROUND,
  TEXT_BUBBLE_SHADOW_BLUR,
  TEXT_BUBBLE_SHADOW_COLOR,
  TEXT_BUBBLE_SHADOW_OFFSET_Y,
  TEXT_BUBBLE_STROKE,
  TEXT_DEFAULT_COLOR,
  TEXT_MAX_WIDTH,
  TEXT_MIN_WIDTH,
  TEXT_PADDING_X,
  TEXT_PADDING_Y,
  TEXT_LINE_HEIGHT,
} from "./text-layout.ts";
import { collectSpatialDomTree } from "./dom-spatial-collector.ts";
import { collectCascadeIndex } from "./cascade-snapshot-collector.ts";
import { probeFrameworkComponents } from "./framework-probe.ts";
import { recentErrorsTracker } from "./recent-errors-tracker.ts";
import {
  buildScreenshotZipPackage,
  triggerZipDownload,
} from "./screenshot-zip-builder.ts";

export interface ProcessScreenshotOptions {
  viewportDataUrl: string;
  viewportImage?: HTMLImageElement | null;
  cropBounds: RectBounds;
  annotations: AnnotationItem[];
  devicePixelRatio?: number;
  styleAdjustmentMode?: boolean;
  disablePruning?: boolean;
}

/** 辅助将 Base64 数据转为 Image 对象 */
function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = dataUrl;
  });
}

/** 在 Canvas 上绘制批注 (Burn-in 离屏渲染) */
export function drawAnnotationsOnCanvas(
  ctx: CanvasRenderingContext2D,
  annotations: AnnotationItem[],
  dpr: number
): void {
  ctx.save();

  for (const ann of annotations) {
    ctx.save();
    const strokeColor = ann.color || "#FA5252";
    ctx.strokeStyle = strokeColor;
    ctx.fillStyle = strokeColor;
    ctx.lineWidth = 3 * dpr;

    if (ann.type === "rect") {
      const lw = Math.max(2, Math.round(2 * dpr));
      const rx = Math.floor(ann.bounds.x * dpr);
      const ry = Math.floor(ann.bounds.y * dpr);
      const rw = Math.round(ann.bounds.width * dpr);
      const rh = Math.round(ann.bounds.height * dpr);

      const rOuter = Math.min(6 * dpr, Math.min(rw, rh) / 2);
      const rInner = Math.max(0, rOuter - lw);

      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.fillStyle = ann.color || "#FA5252";

      ctx.beginPath();
      if (ctx.roundRect && rw > 2 * lw && rh > 2 * lw) {
        ctx.roundRect(rx, ry, rw, rh, rOuter);
        ctx.roundRect(rx + lw, ry + lw, rw - 2 * lw, rh - 2 * lw, rInner);
      } else {
        ctx.rect(rx, ry, rw, rh);
        if (rw > 2 * lw && rh > 2 * lw) {
          ctx.rect(rx + lw, ry + lw, rw - 2 * lw, rh - 2 * lw);
        }
      }
      ctx.fill("evenodd");
      ctx.restore();
    } else if (ann.type === "arrow") {
      const sx = ann.startPoint.x * dpr;
      const sy = ann.startPoint.y * dpr;
      const ex = ann.endPoint.x * dpr;
      const ey = ann.endPoint.y * dpr;

      // 绘制矢量干线
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();

      // 绘制经典的 30° 矢量箭头头部
      const angle = Math.atan2(ey - sy, ex - sx);
      const headLen = 14 * dpr;
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(
        ex - headLen * Math.cos(angle - Math.PI / 6),
        ey - headLen * Math.sin(angle - Math.PI / 6)
      );
      ctx.lineTo(
        ex - headLen * Math.cos(angle + Math.PI / 6),
        ey - headLen * Math.sin(angle + Math.PI / 6)
      );
      ctx.closePath();
      ctx.fill();
    } else if (ann.type === "privacy") {
      // 真实像素化马赛克 (Pixelated Mosaic)
      const x = Math.round(ann.bounds.x * dpr);
      const y = Math.round(ann.bounds.y * dpr);
      const w = Math.round(ann.bounds.width * dpr);
      const h = Math.round(ann.bounds.height * dpr);

      if (w > 0 && h > 0) {
        const tileSize = Math.max(6, Math.round(10 * dpr));
        const sampleW = Math.max(1, Math.floor(w / tileSize));
        const sampleH = Math.max(1, Math.floor(h / tileSize));

        const offCanvas =
          typeof document !== "undefined"
            ? document.createElement("canvas")
            : null;
        if (offCanvas) {
          offCanvas.width = sampleW;
          offCanvas.height = sampleH;
          const offCtx = offCanvas.getContext("2d");
          if (offCtx) {
            offCtx.imageSmoothingEnabled = false;
            offCtx.drawImage(ctx.canvas, x, y, w, h, 0, 0, sampleW, sampleH);

            ctx.save();
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(offCanvas, 0, 0, sampleW, sampleH, x, y, w, h);
            ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
            ctx.lineWidth = 1 * dpr;
            ctx.strokeRect(x, y, w, h);
            ctx.restore();
          }
        } else if (w > 0 && h > 0) {
          ctx.save();
          const blockSize = 8 * dpr;
          for (let bx = x; bx < x + w; bx += blockSize) {
            for (let by = y; by < y + h; by += blockSize) {
              const isEven =
                (Math.floor(bx / blockSize) + Math.floor(by / blockSize)) %
                  2 ===
                0;
              ctx.fillStyle = isEven
                ? "rgba(71, 85, 105, 0.9)"
                : "rgba(30, 41, 59, 0.95)";
              ctx.fillRect(
                bx,
                by,
                Math.min(blockSize, x + w - bx),
                Math.min(blockSize, y + h - by)
              );
            }
          }
          ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
          ctx.lineWidth = 1 * dpr;
          ctx.strokeRect(x, y, w, h);
          ctx.restore();
        }
      }
    } else if (ann.type === "text") {
      // 绘制高档 Inline 多行文本气泡（配色/尺寸与 overlay 渲染层完全一致）
      const px = ann.position.x * dpr;
      const py = ann.position.y * dpr;
      const text = ann.text;

      ctx.font = `${TEXT_ANNOTATION_FONT_SIZE * dpr}px ${TEXT_ANNOTATION_FONT_FAMILY}`;

      const boundsRight = ctx.canvas?.width || 800;
      const maxTextWidth = Math.max(
        TEXT_MIN_WIDTH * dpr,
        Math.min(TEXT_MAX_WIDTH * dpr, boundsRight - px - 24 * dpr)
      );

      // 按换行符与 maxTextWidth 自动拆分多行
      const lines: string[] = [];
      const paragraphs = text.split("\n");
      for (const p of paragraphs) {
        if (!p) {
          lines.push("");
          continue;
        }
        let cur = "";
        for (const ch of p) {
          const test = cur + ch;
          if (ctx.measureText(test).width > maxTextWidth && cur !== "") {
            lines.push(cur);
            cur = ch;
          } else {
            cur = test;
          }
        }
        if (cur) lines.push(cur);
      }

      const paddingX = TEXT_PADDING_X * dpr;
      const paddingY = TEXT_PADDING_Y * dpr;
      const lineHeight = TEXT_LINE_HEIGHT * dpr;
      let maxW = 0;
      for (const l of lines) {
        const w = ctx.measureText(l).width;
        if (w > maxW) maxW = w;
      }

      const bgWidth = maxW + paddingX * 2;
      const bgHeight = paddingY * 2 + lines.length * lineHeight;

      ctx.fillStyle = TEXT_BUBBLE_BACKGROUND;
      ctx.strokeStyle = TEXT_BUBBLE_STROKE;
      ctx.lineWidth = 1 * dpr;

      // 轻阴影与 overlay 渲染层同参数（dpr 缩放保持视觉一致）
      ctx.shadowColor = TEXT_BUBBLE_SHADOW_COLOR;
      ctx.shadowBlur = TEXT_BUBBLE_SHADOW_BLUR * dpr;
      ctx.shadowOffsetY = TEXT_BUBBLE_SHADOW_OFFSET_Y * dpr;

      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(px, py, bgWidth, bgHeight, 6 * dpr);
      } else {
        ctx.rect(px, py, bgWidth, bgHeight);
      }
      ctx.fill();
      ctx.stroke();

      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;

      // 文字色可配置（白底深色系），未设置用默认近黑
      ctx.fillStyle = ann.color || TEXT_DEFAULT_COLOR;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(
          lines[i],
          px + paddingX,
          py + paddingY + i * lineHeight + 1 * dpr
        );
      }
    }
    ctx.restore();
  }

  ctx.restore();
}

/**
 * 截图处理结果。promptInjectedWithPath 表示剪切板中的 AI 提示词是否已写入真实 ZIP 绝对路径。
 */
export interface ScreenshotProcessResult {
  payload: AIScreenshotPayload;
  promptInjectedWithPath: boolean;
}

/** 将 Blob 转为 data URL 字符串（content script 上下文可用 FileReader） */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(reader.error ?? new Error("FileReader 读取 Blob 失败"));
    reader.readAsDataURL(blob);
  });
}

/** 将文本写入系统剪切板（navigator.clipboard 优先，execCommand 兜底） */
async function writeTextToClipboard(text: string): Promise<boolean> {
  let writeSuccess = false;
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    if (navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        writeSuccess = true;
      } catch (err) {
        console.warn(
          "Bug Lens: clipboard.writeText 写入失败，准备 Fallback",
          err
        );
      }
    }
  }
  // 如果 API 被阻断，通过 execCommand("copy") 兜底写入纯文本 Prompt
  if (!writeSuccess && typeof document !== "undefined") {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      textarea.style.top = "-9999px";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const success = document.execCommand("copy");
      document.body.removeChild(textarea);
      if (success) writeSuccess = true;
    } catch (err3) {
      console.warn("Bug Lens: execCommand 复制降级失败", err3);
    }
  }
  return writeSuccess;
}

/** 核心处理器：物理裁剪图片、提取 DOM 上下文、写入多 MIME 剪切板 */
export async function processScreenshot(
  options: ProcessScreenshotOptions
): Promise<ScreenshotProcessResult> {
  const dpr =
    options.devicePixelRatio ||
    (typeof window !== "undefined" ? window.devicePixelRatio : 1);
  const { cropBounds, annotations } = options;
  const styleAdjustmentMode = options.styleAdjustmentMode ?? true;

  // 轨道 A：图像裁剪、DPR 映射与批注渲染烧录（与 DOM 轨完全并行）
  const imagePromise = (async () => {
    // 优先复用已就绪的 HTMLImageElement，省去二次 Base64 字符串解析与解码
    const img =
      options.viewportImage?.complete && options.viewportImage.naturalWidth > 0
        ? options.viewportImage
        : await loadImage(options.viewportDataUrl);

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(cropBounds.width * dpr);
    canvas.height = Math.round(cropBounds.height * dpr);

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get 2d context");

    // 设置高质量图像插值平滑
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    // 映射裁剪坐标
    ctx.drawImage(
      img,
      cropBounds.x * dpr,
      cropBounds.y * dpr,
      cropBounds.width * dpr,
      cropBounds.height * dpr,
      0,
      0,
      canvas.width,
      canvas.height
    );

    // 将批注坐标转换为相对选区的坐标
    const relativeAnnotations = annotations.map((ann) => {
      if (ann.type === "rect" || ann.type === "privacy") {
        return {
          ...ann,
          bounds: {
            x: ann.bounds.x - cropBounds.x,
            y: ann.bounds.y - cropBounds.y,
            width: ann.bounds.width,
            height: ann.bounds.height,
          },
        };
      }
      if (ann.type === "arrow") {
        return {
          ...ann,
          startPoint: {
            x: ann.startPoint.x - cropBounds.x,
            y: ann.startPoint.y - cropBounds.y,
          },
          endPoint: {
            x: ann.endPoint.x - cropBounds.x,
            y: ann.endPoint.y - cropBounds.y,
          },
        };
      }
      if (ann.type === "text") {
        return {
          ...ann,
          position: {
            x: ann.position.x - cropBounds.x,
            y: ann.position.y - cropBounds.y,
          },
        };
      }
      return ann;
    });

    drawAnnotationsOnCanvas(ctx, relativeAnnotations as AnnotationItem[], dpr);
    return canvas.toDataURL("image/png");
  })();

  // 轨道 B：空间 DOM 结构树采集、主世界框架探针与 CSS 级联快照（与图像轨完全并行）
  const domAndStylePromise = (async () => {
    // 1. 收集空间 DOM 结构树（经主世界探针读取 Vue/React 组件链）
    const spatialDom = await collectSpatialDomTree({
      cropBounds,
      annotations,
      probeFramework: probeFrameworkComponents,
      styleAdjustmentMode,
      disablePruning: options.disablePruning,
    });

    // 2. 收集 Vue/React 组件的状态（Props / Data）
    const vueComponentStates: Array<{
      componentName: string;
      componentPath?: string[];
      props?: Record<string, unknown>;
      data?: Record<string, unknown>;
    }> = [];

    const collectedStateComponents = new Set<string>();
    const collectStateFromTree = (
      node: NonNullable<typeof spatialDom.tree>
    ) => {
      if (node.componentName && (node.props || node.data)) {
        const key = `${node.componentName}_${node.componentPath?.join(">")}`;
        if (!collectedStateComponents.has(key)) {
          collectedStateComponents.add(key);
          vueComponentStates.push({
            componentName: node.componentName,
            componentPath: node.componentPath,
            props: node.props,
            data: node.data,
          });
        }
      }
      if (node.children) {
        for (const child of node.children) collectStateFromTree(child);
      }
    };
    if (spatialDom.tree) {
      collectStateFromTree(spatialDom.tree);
    }

    // 3. 如果开启了样式微调模式，收集 CSS 级联快照，并通过 CDP 补全代码行号
    let cascadeIndex: any = undefined;
    if (styleAdjustmentMode) {
      try {
        cascadeIndex = collectCascadeIndex({
          bounds: cropBounds,
          domTree: spatialDom,
        });

        // 提取选区元素选择器发往 Background 调用 CDP
        const selectors = cascadeIndex.elements
          .map((el: any) => el.selector)
          .filter(Boolean);

        if (selectors.length > 0) {
          const res = (await message("screenshot/style-source", {
            selectors,
          })) as unknown as {
            ok: boolean;
            sources?: Array<{ selector: string; source: any }>;
          };
          if (res && res.ok && res.sources && res.sources.length > 0) {
            const sourceMap = new Map(
              res.sources.map((s: any) => [s.selector, s])
            );
            for (const rule of cascadeIndex.rules) {
              const match = sourceMap.get(rule.selectorText);
              if (match && match.source) {
                rule.source = match.source;
                cascadeIndex.meta.cdpLineInfo = true;
              }
            }
          }
        }
      } catch (err) {
        console.warn("Bug Lens: 级联快照收集发生非阻断异常", err);
      }
    }

    return { spatialDom, vueComponentStates, cascadeIndex };
  })();

  // 双轨并行等待就绪
  const [croppedBase64, { spatialDom, vueComponentStates, cascadeIndex }] =
    await Promise.all([imagePromise, domAndStylePromise]);

  // 5. 组装完整 AIScreenshotPayload 并规范化 Key 顺序（确保意图/DOM在上，大图像/底层规则在下）
  const payload: AIScreenshotPayload = normalizePayloadKeyOrder({
    version: "1.0",
    timestamp: Date.now(),
    cropBounds,
    image: {
      base64Data: croppedBase64,
      width: cropBounds.width,
      height: cropBounds.height,
      devicePixelRatio: Math.round(dpr * 100) / 100,
    },
    annotations,
    annotationGroups: [],
    domContextTree: spatialDom,
    cascadeIndex,
    environment: {
      url: typeof window !== "undefined" ? window.location.href : "",
      title: typeof document !== "undefined" ? document.title : "",
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
      viewport: {
        width: typeof window !== "undefined" ? window.innerWidth : 0,
        height: typeof window !== "undefined" ? window.innerHeight : 0,
      },
      mediaBreakpoint:
        typeof window !== "undefined" && window.innerWidth < 768
          ? "mobile"
          : "desktop",
      recentConsoleErrors: recentErrorsTracker.getRecentConsoleErrors(5000),
      recentFailedRequests: recentErrorsTracker.getRecentFailedRequests(5000),
      vueComponentStates:
        vueComponentStates.length > 0 ? vueComponentStates : undefined,
    },
  });

  // 5. 先写入占位符提示词：发生在用户点击“完成”的手势窗口内，写入最可靠，
  //    确保用户在任何后续失败下都能拿到可用的 AI 提示词。
  await writeTextToClipboard(formatPayloadToMarkdown(payload));

  // 6. 打包 ZIP 并触发下载。优先经由 background 下载（content script 无
  //    chrome.downloads 权限）并解析真实绝对路径；background 不可用时回退页面内
  //    <a download>（该路径无法拿到绝对路径，提示词保留占位符）。
  let zipPath: string | undefined;
  let downloaded = false;
  try {
    const zipPack = buildScreenshotZipPackage(payload);
    if (typeof chrome !== "undefined" && chrome.runtime?.id) {
      try {
        // 直接发送 data URL 字符串而非 ArrayBuffer：字符串在消息序列化中不会丢字节，
        // 规避 ArrayBuffer 跨上下文传递被清空/序列化成空对象的问题。
        const dataUrl = await blobToDataUrl(zipPack.blob);
        const response = (await chrome.runtime.sendMessage(
          message("screenshot/download", {
            dataUrl,
            filename: zipPack.filename,
          })
        )) as
          | { ok?: boolean; downloadId?: number; absolutePath?: string }
          | undefined;
        if (response?.ok) {
          downloaded = true;
          zipPath = response.absolutePath;
        }
      } catch (bgErr) {
        console.warn(
          "Bug Lens: 经由 background 下载截图 ZIP 失败，回退页面内下载",
          bgErr
        );
      }
    }
    if (!downloaded) {
      triggerZipDownload(zipPack.blobUrl, zipPack.filename);
    } else if (zipPack.blobUrl) {
      URL.revokeObjectURL(zipPack.blobUrl);
    }
  } catch (zipErr) {
    console.warn("Bug Lens: 截图 ZIP 打包下载异常", zipErr);
  }

  // 7. 拿到真实绝对路径后，覆盖写回带真实路径的最终提示词，替换占位符。
  let promptInjectedWithPath = false;
  if (zipPath) {
    const finalPrompt = formatPayloadToMarkdown(payload, zipPath);
    promptInjectedWithPath = await writeTextToClipboard(finalPrompt);
  }

  return { payload, promptInjectedWithPath };
}
