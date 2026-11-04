import { t } from "../shared/i18n.ts";
import {
  syncVirtualClipboard,
  syncVirtualBlob,
  installVirtualClipboardHooks,
  isE2eAutomationActive,
} from "./virtual-clipboard.ts";

declare const process: {
  env: {
    NODE_ENV?: string;
    BUG_LENS_IS_E2E?: boolean;
  };
};

if (process.env.BUG_LENS_IS_E2E) {
  if (isE2eAutomationActive()) {
    installVirtualClipboardHooks();
  }
}

export async function copyTextToClipboard(
  value: string,
  root: Document = document
): Promise<void> {
  if (process.env.BUG_LENS_IS_E2E && isE2eAutomationActive()) {
    syncVirtualClipboard(value);
    installVirtualClipboardHooks();
    return;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
  } catch {
    // 本地文件报告可能拿不到 Clipboard API 权限，需降级处理。
  }

  const textarea = root.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  root.body.appendChild(textarea);
  textarea.select();
  const copied = root.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error(t("clipboardPermissionDenied"));
}

export async function copyRichTextToClipboard(
  payload: { html: string; text: string },
  root: Document = document
): Promise<void> {
  if (process.env.BUG_LENS_IS_E2E && isE2eAutomationActive()) {
    syncVirtualClipboard(payload.text);
    installVirtualClipboardHooks();
    return;
  }

  if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
    try {
      const item = new ClipboardItem({
        "text/html": new Blob([payload.html], { type: "text/html" }),
        "text/plain": new Blob([payload.text], { type: "text/plain" }),
      });
      await navigator.clipboard.write([item]);
      return;
    } catch {
      // 降级回退到纯文本方式
    }
  }
  await copyTextToClipboard(payload.text, root);
}

export async function copyDataUrlImageToClipboard(
  dataUrl: string
): Promise<void> {
  const [header, base64] = dataUrl.split(",", 2);
  const mimeType = header.match(/:(.*?);/)?.[1] || "image/png";
  const binary = atob(base64);
  const array = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    array[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([array], { type: mimeType });
  await copyBlobImageToClipboard(blob);
}

export async function copyBlobImageToClipboard(blob: Blob): Promise<void> {
  if (process.env.BUG_LENS_IS_E2E && isE2eAutomationActive()) {
    syncVirtualBlob(blob);
    return;
  }

  if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
    let pngBlob = blob;
    if (blob.type !== "image/png") {
      pngBlob = await convertBlobToPng(blob);
    }
    const item = new ClipboardItem({ "image/png": pngBlob });
    await navigator.clipboard.write([item]);
    return;
  }
  throw new Error(t("clipboardPermissionDenied"));
}

async function convertBlobToPng(sourceBlob: Blob): Promise<Blob> {
  if (
    typeof createImageBitmap !== "undefined" &&
    typeof OffscreenCanvas !== "undefined"
  ) {
    try {
      const bitmap = await createImageBitmap(sourceBlob);
      try {
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(bitmap, 0, 0);
          return await canvas.convertToBlob({ type: "image/png" });
        }
      } finally {
        bitmap.close();
      }
    } catch {
      // 回退
    }
  }
  return sourceBlob;
}
