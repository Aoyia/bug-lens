import { zipSync } from "fflate";
import {
  formatPayloadToMarkdownForZip,
  type AIScreenshotPayload,
} from "../domain/screenshot-payload.ts";

export interface ScreenshotZipResult {
  blob: Blob;
  blobUrl: string;
  filename: string;
  markdownPrompt: string;
}

/** 辅助将 Base64 dataURL 转化为 Uint8Array */
export function base64ToUint8Array(base64Data: string): Uint8Array {
  const parts = base64Data.split(",");
  const raw = atob(parts[1] || parts[0]);
  const u8 = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    u8[i] = raw.charCodeAt(i);
  }
  return u8;
}

/** 辅助将字符串编码为 Uint8Array */
export function stringToUint8Array(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/**
 * 组装截图 ZIP 证据包 (fflate zipSync 高性能同步压缩)
 */
export function buildScreenshotZipPackage(
  payload: AIScreenshotPayload
): ScreenshotZipResult {
  // zip 内 ai-prompt.md 使用引导文案（打包先于下载，无法预知真实绝对路径）
  const markdownPrompt = formatPayloadToMarkdownForZip(payload);
  const imageU8 = base64ToUint8Array(payload.image.base64Data);

  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const filename = `bug-lens-screenshot-${timestamp}.zip`;

  // 根据 Base64 header 自动判断扩展名 (png / webp)
  const isWebP = payload.image.base64Data.startsWith("data:image/webp");
  const imageFilename = isWebP ? "screenshot.webp" : "screenshot.png";

  // 组装 ZIP 压缩包包含的文件列表
  const zipFiles: Record<string, Uint8Array> = {
    [imageFilename]: imageU8,
    "ai-prompt.md": stringToUint8Array(markdownPrompt),
    "dom-context.json": stringToUint8Array(
      JSON.stringify(payload.domContextTree, null, 2)
    ),
    "environment.json": stringToUint8Array(
      JSON.stringify(payload.environment, null, 2)
    ),
  };

  if (payload.cascadeIndex) {
    zipFiles["cascade.json"] = stringToUint8Array(
      JSON.stringify(payload.cascadeIndex, null, 2)
    );
  }

  // 使用 fflate 高性能 zipSync 快速打包
  const zippedUint8 = zipSync(zipFiles, { level: 6 });
  const blob = new Blob([zippedUint8], { type: "application/zip" });
  const blobUrl =
    typeof URL !== "undefined" && URL.createObjectURL
      ? URL.createObjectURL(blob)
      : "";

  return {
    blob,
    blobUrl,
    filename,
    markdownPrompt,
  };
}

/**
 * 触发浏览器通用静默/显式文件下载
 */
export function triggerZipDownload(blobUrl: string, filename: string): void {
  if (typeof document === "undefined" || !blobUrl) return;
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    if (a.parentElement) a.parentElement.removeChild(a);
  }, 1000);
}
