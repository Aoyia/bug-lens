import {
  formatPayloadToMarkdown,
  type AIScreenshotPayload,
  type AnnotationItem,
  type RectBounds,
} from "../domain/screenshot-payload.ts";
import { message } from "../shared/protocol.ts";
import { collectSpatialDomTree } from "./dom-spatial-collector.ts";
import { probeFrameworkComponents } from "./framework-probe.ts";
import { recentErrorsTracker } from "./recent-errors-tracker.ts";
import {
  buildScreenshotZipPackage,
  triggerZipDownload,
} from "./screenshot-zip-builder.ts";

export interface ProcessScreenshotOptions {
  viewportDataUrl: string;
  cropBounds: RectBounds;
  annotations: AnnotationItem[];
  devicePixelRatio?: number;
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

/** 辅助 canvas.toBlob */
function canvasToBlob(
  canvas: HTMLCanvasElement,
  type = "image/png"
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Canvas toBlob failed"));
    }, type);
  });
}

/** 在 Canvas 上绘制批注 (Burn-in 离屏渲染) */
export function drawAnnotationsOnCanvas(
  ctx: CanvasRenderingContext2D,
  annotations: AnnotationItem[],
  dpr: number
): void {
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
      ctx.imageSmoothingEnabled = false;
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
            ctx.restore();
          }
        }
      }
    } else if (ann.type === "text") {
      // 绘制高档 Inline 文本气泡
      const px = ann.position.x * dpr;
      const py = ann.position.y * dpr;
      const text = ann.text;

      ctx.font = `bold ${13 * dpr}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      const metrics = ctx.measureText(text);
      const paddingX = 10 * dpr;
      const paddingY = 6 * dpr;
      const bgWidth = metrics.width + paddingX * 2;
      const bgHeight = 26 * dpr;

      ctx.fillStyle = "rgba(15, 23, 42, 0.92)";
      ctx.strokeStyle = "#0284c7";
      ctx.lineWidth = 1 * dpr;

      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(px, py, bgWidth, bgHeight, 6 * dpr);
      } else {
        ctx.rect(px, py, bgWidth, bgHeight);
      }
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "#f8fafc";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(text, px + paddingX, py + bgHeight / 2);
    }
    ctx.restore();
  }
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
  const { viewportDataUrl, cropBounds, annotations } = options;

  // 1. 加载视口原图并在 Canvas 中按选区+DPR物理裁剪
  const img = await loadImage(viewportDataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(cropBounds.width * dpr);
  canvas.height = Math.round(cropBounds.height * dpr);

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get 2d context");

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

  // 2. 将批注渲染 burn-in 进 Canvas 图像
  // 需将批注坐标转换为相对选区的坐标
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

  const croppedBase64 = canvas.toDataURL("image/png");
  const imageBlob = await canvasToBlob(canvas, "image/png");

  // 3. 收集空间 DOM 结构树（经主世界探针读取 Vue/React 组件链）
  const spatialDom = await collectSpatialDomTree({
    cropBounds,
    annotations,
    probeFramework: probeFrameworkComponents,
  });

  // 4. 组装完整 AIScreenshotPayload
  const payload: AIScreenshotPayload = {
    version: "1.0",
    timestamp: Date.now(),
    cropBounds,
    image: {
      base64Data: croppedBase64,
      width: cropBounds.width,
      height: cropBounds.height,
      devicePixelRatio: dpr,
    },
    annotations,
    annotationGroups: [],
    domContextTree: spatialDom,
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
    },
  };

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
