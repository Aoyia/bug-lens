import { zipSync } from "fflate";
import {
  formatPayloadToMarkdownForZip,
  normalizeDomTreeKeyOrder,
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
  const commaIdx = base64Data.indexOf(",");
  const raw = atob(
    commaIdx !== -1 ? base64Data.slice(commaIdx + 1) : base64Data
  );
  const len = raw.length;
  const u8 = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    u8[i] = raw.charCodeAt(i);
  }
  return u8;
}

/** 辅助将字符串编码为 Uint8Array */
export function stringToUint8Array(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/**
 * 按电脑本地时区格式化时间戳，用于导出文件命名。
 * 格式保持与历史一致：YYYY-MM-DD-HH-MM-SS（不使用 toISOString，避免 UTC 与本地时区混淆）。
 */
export function formatLocalTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `-${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  );
}

/**
 * 组装截图 ZIP 证据包 (fflate zipSync 差异化高性能压缩：PNG 走 Level 0 存储，文本走 Level 6 压缩)
 */
export function buildScreenshotZipPackage(
  payload: AIScreenshotPayload
): ScreenshotZipResult {
  // zip 内 ai-prompt.md 使用引导文案（打包先于下载，无法预知真实绝对路径）
  const markdownPrompt = formatPayloadToMarkdownForZip(payload);
  const imageU8 = base64ToUint8Array(payload.image.base64Data);

  // 使用电脑本地时区生成时间戳（避免 UTC 时间让用户看不懂）
  const timestamp = formatLocalTimestamp(new Date());
  const filename = `bug-lens-screenshot-${timestamp}.zip`;

  // 统一固定图片文件名为 screenshot.png
  const imageFilename = "screenshot.png";

  // 组装 ZIP 压缩包包含的文件列表（PNG 已为 Deflate 位图，采用 level 0 零算力封包；文本走 level 6 压缩）
  const zipFiles: Record<
    string,
    Uint8Array | [Uint8Array, { level?: number }]
  > = {
    [imageFilename]: [imageU8, { level: 0 }],
    "ai-prompt.md": [stringToUint8Array(markdownPrompt), { level: 6 }],
    "dom-context.json": [
      stringToUint8Array(
        JSON.stringify(
          normalizeDomTreeKeyOrder(payload.domContextTree),
          null,
          2
        )
      ),
      { level: 6 },
    ],
    "environment.json": [
      stringToUint8Array(JSON.stringify(payload.environment, null, 2)),
      { level: 6 },
    ],
  };

  if (payload.cascadeIndex) {
    zipFiles["cascade.json"] = [
      stringToUint8Array(JSON.stringify(payload.cascadeIndex, null, 2)),
      { level: 6 },
    ];
  }

  // 使用 fflate 高性能 zipSync 快速打包
  const zippedUint8 = zipSync(zipFiles as any);
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
