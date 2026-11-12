import {
  buildClipboardScreenshotPrompt,
  normalizePayloadKeyOrder,
  type AIScreenshotPayload,
  type AnnotationItem,
  type FrameworkComponentStateSnapshot,
  type RectBounds,
} from "../../domain/screenshot-payload";
import { loadAppSettings } from "../../shared/settings";
import { message } from "../../shared/protocol";
import { getRenderer } from "../annotations/renderers/renderer-registry";
import { collectSpatialDomTree } from "../probes/dom-spatial-collector";
import { collectCascadeIndex } from "../probes/cascade-snapshot-collector";
import { probeFrameworkComponents } from "../probes/framework-probe";
import { recentErrorsTracker } from "../probes/recent-errors-tracker";
import {
  buildScreenshotZipPackage,
  triggerZipDownload,
} from "./screenshot-zip-builder";
import {
  captureMemorySnapshot,
  recordTaskProfile,
  incrementPromptCopyCount,
} from "../../diagnostics/diagnostics-store";
import { copyTextToClipboard } from "../../shared/clipboard";

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

/** 在 Canvas 上绘制批注 (Burn-in 离屏渲染，统一委托给 RendererRegistry) */
export function drawAnnotationsOnCanvas(
  ctx: CanvasRenderingContext2D,
  annotations: AnnotationItem[],
  dpr: number
): void {
  ctx.save();
  const logicalWidth = (ctx.canvas?.width || 800) / dpr;
  const logicalHeight = (ctx.canvas?.height || 600) / dpr;
  const rc = {
    selection: { x: 0, y: 0, width: logicalWidth, height: logicalHeight },
    viewportImage: null,
    dpr,
  };

  for (const ann of annotations) {
    ctx.save();
    const strokeColor = ann.color || "#FA5252";
    ctx.strokeStyle = strokeColor;
    ctx.fillStyle = strokeColor;
    ctx.lineWidth = 3 * dpr;
    getRenderer(ann.type).draw(ctx, ann, rc);
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
  try {
    await copyTextToClipboard(text);
    return true;
  } catch (err) {
    console.warn("Bug Lens: 写入剪贴板失败", err);
    return false;
  }
}

/** 核心处理器：物理裁剪图片、提取 DOM 上下文、写入多 MIME 剪切板 */
export async function processScreenshot(
  options: ProcessScreenshotOptions
): Promise<ScreenshotProcessResult> {
  const t0 = performance.now();
  const dpr =
    options.devicePixelRatio ||
    (typeof window !== "undefined" ? window.devicePixelRatio : 1);
  const { cropBounds, annotations } = options;
  const styleAdjustmentMode = options.styleAdjustmentMode ?? true;

  let imageDurationMs = 0;
  let domDurationMs = 0;

  // 轨道 A：图像裁剪、DPR 映射与批注渲染烧录（与 DOM 轨完全并行）
  const imagePromise = (async () => {
    const tImg = performance.now();
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

    // 预先填充纯白背景（JPEG 不支持透明，且省去 <= 2048px 时的二次 tempCanvas 拷贝）
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

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
    // 方案 A：上限 2048px + JPEG 92% 质量，兼顾大屏（27寸 2K/4K）小字清晰度与轻量体积
    let finalCanvas = canvas;
    const maxDimension = 2048;
    const longestEdge = Math.max(canvas.width, canvas.height);

    if (longestEdge > maxDimension) {
      const scale = maxDimension / longestEdge;
      const scaledW = Math.round(canvas.width * scale);
      const scaledH = Math.round(canvas.height * scale);
      const scaledCanvas = document.createElement("canvas");
      scaledCanvas.width = scaledW;
      scaledCanvas.height = scaledH;
      const scaledCtx = scaledCanvas.getContext("2d");
      if (scaledCtx) {
        scaledCtx.fillStyle = "#ffffff";
        scaledCtx.fillRect(0, 0, scaledW, scaledH);
        scaledCtx.imageSmoothingEnabled = true;
        scaledCtx.imageSmoothingQuality = "high";
        scaledCtx.drawImage(canvas, 0, 0, scaledW, scaledH);
        finalCanvas = scaledCanvas;
      }
    }

    const dataUrl = finalCanvas.toDataURL("image/jpeg", 0.92);
    imageDurationMs = performance.now() - tImg;
    return dataUrl;
  })();

  // 轨道 B：空间 DOM 结构树采集、主世界框架探针与 CSS 级联快照（与图像轨完全并行）
  const domAndStylePromise = (async () => {
    const tDom = performance.now();
    // 1. 收集空间 DOM 结构树（经主世界探针读取 Vue/React 组件链）
    const spatialDom = await collectSpatialDomTree({
      cropBounds,
      annotations,
      probeFramework: probeFrameworkComponents,
      styleAdjustmentMode,
      disablePruning: options.disablePruning,
    });

    // 2. 收集 Vue/React 组件的状态（Props / Data / Hooks / 源码定位）
    const frameworkComponentStates: FrameworkComponentStateSnapshot[] = [];

    const collectedStateComponents = new Set<string>();
    const collectStateFromTree = (
      node: NonNullable<typeof spatialDom.tree>
    ) => {
      if (
        node.componentName &&
        (node.props || node.data || node.componentFile)
      ) {
        const key = `${node.componentName}_${node.componentPath?.join(">")}_${node.componentFile ?? ""}`;
        if (!collectedStateComponents.has(key)) {
          collectedStateComponents.add(key);
          const inferredFramework: "vue" | "react" | undefined =
            node.componentFile?.endsWith(".vue")
              ? "vue"
              : node.componentFile?.endsWith(".tsx") ||
                  node.componentFile?.endsWith(".jsx") ||
                  node.componentLine !== undefined
                ? "react"
                : undefined;

          frameworkComponentStates.push({
            componentName: node.componentName,
            componentPath: node.componentPath,
            framework: inferredFramework,
            componentFile: node.componentFile,
            componentLine: node.componentLine,
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
    if (spatialDom.anchors) {
      for (const anchor of spatialDom.anchors) {
        if (anchor.componentName && anchor.componentFile) {
          const key = `${anchor.componentName}_${anchor.componentPath?.join(">")}_${anchor.componentFile}`;
          if (!collectedStateComponents.has(key)) {
            collectedStateComponents.add(key);
            const inferredFramework: "vue" | "react" | undefined =
              anchor.componentFile.endsWith(".vue")
                ? "vue"
                : anchor.componentFile.endsWith(".tsx") ||
                    anchor.componentFile.endsWith(".jsx") ||
                    anchor.componentLine !== undefined
                  ? "react"
                  : undefined;
            frameworkComponentStates.push({
              componentName: anchor.componentName,
              componentPath: anchor.componentPath,
              framework: inferredFramework,
              componentFile: anchor.componentFile,
              componentLine: anchor.componentLine,
            });
          }
        }
      }
    }

    // 3. 如果开启了样式微调模式，收集 CSS 级联快照，并通过 CDP 补全代码行号
    let cascadeIndex: any = undefined;
    let styleSourceMs = 0;
    if (styleAdjustmentMode) {
      const tCascade = performance.now();
      try {
        cascadeIndex = collectCascadeIndex({
          bounds: cropBounds,
          domTree: spatialDom,
        });

        // 提取选区元素选择器发往 Background 调用 CDP
        const selectors = cascadeIndex.elements
          .map((el: any) => el.selector)
          .filter(Boolean);

        if (
          selectors.length > 0 &&
          typeof chrome !== "undefined" &&
          chrome.runtime?.sendMessage
        ) {
          const res = (await chrome.runtime.sendMessage(
            message("screenshot/style-source", { selectors })
          )) as unknown as {
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
      styleSourceMs = performance.now() - tCascade;
    }

    domDurationMs = performance.now() - tDom;
    return {
      spatialDom,
      frameworkComponentStates,
      vueComponentStates: frameworkComponentStates,
      cascadeIndex,
      styleSourceMs,
    };
  })();

  // 三轨并行等待就绪（含剪贴板提示词模板配置读取，失败则回退标准模板）
  const [
    croppedBase64,
    { spatialDom, frameworkComponentStates, cascadeIndex, styleSourceMs },
    promptSettings,
  ] = await Promise.all([
    imagePromise,
    domAndStylePromise,
    loadAppSettings()
      .then((s) => s.ai)
      .catch(() => undefined),
  ]);

  const tPromptStart = performance.now();
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
      frameworkComponentStates:
        frameworkComponentStates.length > 0
          ? frameworkComponentStates
          : undefined,
      vueComponentStates:
        frameworkComponentStates.length > 0
          ? frameworkComponentStates
          : undefined,
    },
  });

  // 5. 先写入占位符提示词：发生在用户点击“完成”的手势窗口内，写入最可靠，
  //    确保用户在任何后续失败下都能拿到可用的 AI 提示词。
  await writeTextToClipboard(
    buildClipboardScreenshotPrompt(payload, undefined, promptSettings)
  );

  // 6. 打包 ZIP 并触发下载。
  //    先在页面内触发标准原生下载，确保浏览器/Playwright 均可感知下载事件；
  //    同时通知 background 监听该任务以解析真实绝对路径；若页面未生效则由 background 兜底。
  let zipPath: string | undefined;
  let zipPackDurationMs = 0;
  let zipBytes: number | undefined;
  let zipFilename: string | undefined;
  const tZipStart = performance.now();
  try {
    const zipPack = buildScreenshotZipPackage(payload);
    zipBytes = zipPack.blob.size;
    zipFilename = zipPack.filename;
    triggerZipDownload(zipPack.blobUrl, zipPack.filename);

    if (typeof chrome !== "undefined" && chrome.runtime?.id) {
      try {
        const dataUrl = await blobToDataUrl(zipPack.blob);
        const response = (await chrome.runtime.sendMessage(
          message("screenshot/download", {
            dataUrl,
            filename: zipPack.filename,
          })
        )) as
          | { ok?: boolean; downloadId?: number; absolutePath?: string }
          | undefined;
        if (response?.ok && response.absolutePath) {
          zipPath = response.absolutePath;
        }
      } catch (bgErr) {
        console.warn("Bug Lens: 经由 background 解析截图 ZIP 下载失败", bgErr);
      }
    }
  } catch (zipErr) {
    console.warn("Bug Lens: 截图 ZIP 打包下载异常", zipErr);
  }
  zipPackDurationMs = performance.now() - tZipStart;

  // 7. 拿到真实绝对路径后，覆盖写回带真实路径的最终提示词，替换占位符。
  let promptInjectedWithPath = false;
  const finalPrompt = buildClipboardScreenshotPrompt(
    payload,
    zipPath,
    promptSettings
  );
  promptInjectedWithPath = await writeTextToClipboard(finalPrompt);

  const promptDurationMs = Math.max(
    0,
    performance.now() - tPromptStart - zipPackDurationMs
  );
  const totalDurationMs = performance.now() - t0;

  let domNodesCount = 0;
  const countDomTree = (n: any) => {
    if (!n) return;
    domNodesCount += 1;
    if (Array.isArray(n.children)) {
      for (const c of n.children) countDomTree(c);
    }
  };
  if (spatialDom?.tree) countDomTree(spatialDom.tree);

  void recordTaskProfile({
    taskType: "screenshot",
    status: "success",
    durationMs: totalDurationMs,
    pipelineWallClockMs: totalDurationMs,
    context: {
      targetUrl: payload.environment.url,
      targetTitle: payload.environment.title,
    },
    breakdown: {
      imageRenderMs: Math.round(imageDurationMs),
      domCaptureMs: Math.round(domDurationMs),
      styleSourceMs: Math.round(styleSourceMs),
      zipPackMs: Math.round(zipPackDurationMs),
      promptFormatMs: Math.round(promptDurationMs),
    },
    metricsSummary: {
      producedBytes: zipBytes ?? payload.image.base64Data?.length,
      eventsCount: annotations.length,
    },
    screenshotDetail: {
      viewport: payload.environment.viewport,
      cropBounds,
      dpr: payload.image.devicePixelRatio,
      styleAdjustmentMode,
      annotationCount: annotations.length,
      domNodesCount,
      domAnchorsCount: spatialDom?.anchors?.length ?? 0,
      frameworkComponentsCount: frameworkComponentStates.length,
      cascadeElementsCount: cascadeIndex?.elements?.length ?? 0,
      recentConsoleErrorsCount:
        payload.environment.recentConsoleErrors?.length ?? 0,
      recentFailedRequestsCount:
        payload.environment.recentFailedRequests?.length ?? 0,
      zipBytes,
      zipFilename: zipPath ?? zipFilename,
      promptInjectedWithPath,
    },
    memorySnapshot: captureMemorySnapshot(),
  }).catch(() => undefined);
  void incrementPromptCopyCount().catch(() => undefined);

  return { payload, promptInjectedWithPath };
}
