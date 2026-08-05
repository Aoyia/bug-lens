import {
  formatPayloadToHtml,
  formatPayloadToMarkdown,
  type AIScreenshotPayload,
  type AnnotationItem,
  type RectBounds,
} from "../domain/screenshot-payload.ts";
import { collectSpatialDomTree } from "./dom-spatial-collector.ts";
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
    const strokeColor = ann.color || "#ff3b30";
    ctx.strokeStyle = strokeColor;
    ctx.fillStyle = strokeColor;
    ctx.lineWidth = 3 * dpr;

    if (ann.type === "rect") {
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(
          ann.bounds.x * dpr,
          ann.bounds.y * dpr,
          ann.bounds.width * dpr,
          ann.bounds.height * dpr,
          4 * dpr
        );
      } else {
        ctx.rect(
          ann.bounds.x * dpr,
          ann.bounds.y * dpr,
          ann.bounds.width * dpr,
          ann.bounds.height * dpr
        );
      }
      ctx.stroke();
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
      // 高质感脱敏打码
      const x = ann.bounds.x * dpr;
      const y = ann.bounds.y * dpr;
      const w = ann.bounds.width * dpr;
      const h = ann.bounds.height * dpr;

      ctx.fillStyle = "rgba(15, 23, 42, 0.95)";
      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 4 * dpr);
        ctx.fill();
      } else {
        ctx.fillRect(x, y, w, h);
      }

      ctx.fillStyle = "#38bdf8";
      ctx.font = `bold ${11 * dpr}px ui-monospace, SFMono-Regular, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("[REDACTED]", x + w / 2, y + h / 2);
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

/** 核心处理器：物理裁剪图片、提取 DOM 上下文、写入多 MIME 剪切板 */
export async function processScreenshot(
  options: ProcessScreenshotOptions
): Promise<AIScreenshotPayload> {
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

  // 3. 收集空间 DOM 结构树
  const spatialDom = collectSpatialDomTree({
    cropBounds,
    annotations,
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

  const markdownContent = formatPayloadToMarkdown(payload);

  // 5. 优先同步写入系统剪切板（确保 Markdown AI Prompt 100% 成功写入）
  let writeSuccess = false;
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    if (navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(markdownContent);
        writeSuccess = true;
      } catch (err) {
        console.warn(
          "Bug Lens: clipboard.writeText 写入失败，准备 Fallback",
          err
        );
      }
    }
  }

  // 6. 如果 API 被阻断，通过 execCommand("copy") 兜底写入纯文本 Prompt
  if (!writeSuccess && typeof document !== "undefined") {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = markdownContent;
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

  // 7. 打包与触发 ZIP 文件下载（置于剪切板写入之后，避免 DOM 操作/下载动作打断剪切板权限手势）
  try {
    const zipPack = buildScreenshotZipPackage(payload);
    triggerZipDownload(zipPack.blobUrl, zipPack.filename);
  } catch (zipErr) {
    console.warn("Bug Lens: 截图 ZIP 打包下载异常", zipErr);
  }

  return payload;
}
