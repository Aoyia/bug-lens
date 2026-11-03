/**
 * 交互点击红圈标注：在截图上按视口比例绘制“外白内红”双圈，并输出 JPEG Blob。
 *
 * 仅依赖 OffscreenCanvas + createImageBitmap，可同时运行于 Service Worker 与 Offscreen Document。
 * Background 优先在本进程内直接标注：Offscreen Document 属于隐藏主线程文档，
 * 其 convertToBlob 编码走空闲任务调度，实测存在约 1s 的固定排队延迟。
 */
export type ClickAnnotationPayload = {
  clientX: number;
  clientY: number;
  viewportWidth: number;
  viewportHeight: number;
};

/** 截图最长边上限，超出后等比缩放 */
const MAX_DIMENSION = 2048;

/** 当前上下文是否具备本地标注能力（Node 测试环境等不具备时返回 false） */
export function canAnnotateInCurrentContext(): boolean {
  return (
    typeof OffscreenCanvas !== "undefined" &&
    typeof createImageBitmap === "function"
  );
}

/** data URL 解码为 Blob */
export function dataUrlToBlob(dataUrl: string): Blob {
  const [metadata = "", encoded = ""] = dataUrl.split(",", 2);
  const mimeType = metadata.match(/^data:([^;,]+)/)?.[1] || "image/jpeg";
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

export async function annotateClickImage(
  source: Blob,
  payload: ClickAnnotationPayload,
  quality = 0.83
): Promise<Blob> {
  const bitmap = await createImageBitmap(source);
  try {
    const rawWidth = bitmap.width;
    const rawHeight = bitmap.height;
    const longestEdge = Math.max(rawWidth, rawHeight);
    const scale = longestEdge > MAX_DIMENSION ? MAX_DIMENSION / longestEdge : 1;
    const targetWidth = Math.max(1, Math.round(rawWidth * scale));
    const targetHeight = Math.max(1, Math.round(rawHeight * scale));

    const canvas = new OffscreenCanvas(targetWidth, targetHeight);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("CANVAS_CONTEXT_UNAVAILABLE");

    // JPEG 格式不支持透明度，预先填充纯白背景
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, targetWidth, targetHeight);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      bitmap,
      0,
      0,
      rawWidth,
      rawHeight,
      0,
      0,
      targetWidth,
      targetHeight
    );

    // 交互点击坐标：按视口尺寸比例换算为图片像素坐标
    const x =
      payload.clientX * (targetWidth / Math.max(1, payload.viewportWidth));
    const y =
      payload.clientY * (targetHeight / Math.max(1, payload.viewportHeight));
    const radius = Math.max(12, Math.min(targetWidth, targetHeight) * 0.018);
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.lineWidth = Math.max(7, radius * 0.45);
    context.strokeStyle = "rgba(255,255,255,.95)";
    context.stroke();
    // 外白内红双圈，模拟点击水波纹效果
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.lineWidth = Math.max(3, radius * 0.22);
    context.strokeStyle = "#ef233c";
    context.stroke();

    return await canvas.convertToBlob({ type: "image/jpeg", quality });
  } finally {
    bitmap.close();
  }
}
