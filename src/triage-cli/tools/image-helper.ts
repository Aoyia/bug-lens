import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { LoadedPack } from "../pack/cache.ts";
import {
  getTriageWorkspaceDir,
  sanitizeRelativePathForDisk,
} from "../pack/open.ts";

export const MAX_INLINE_IMAGE_BYTES = Math.floor(1.5 * 1024 * 1024); // 1.5 MB

export type McpContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export function inferImageMimeType(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

export function exportPackImageToTemp(
  pack: LoadedPack,
  relPath: string
): string | undefined {
  const bytes = pack.getBinaryFile(relPath);
  if (!bytes) return undefined;
  const { sanitized } = sanitizeRelativePathForDisk(relPath);
  const packPrefix =
    pack.kind === "session"
      ? pack.sessionId.slice(0, 8) || "session"
      : "screenshot";
  const destPath = resolve(
    join(getTriageWorkspaceDir(), "images", packPrefix, sanitized)
  );
  try {
    mkdirSync(dirname(destPath), { recursive: true });
    writeFileSync(destPath, bytes);
    return destPath;
  } catch {
    return undefined;
  }
}

export function buildImageContentBlocks(
  pack: LoadedPack,
  relPath: string,
  label?: string
): McpContentBlock[] {
  const bytes = pack.getBinaryFile(relPath);
  if (!bytes) {
    return [
      {
        type: "text",
        text: `[Image not found in pack: ${relPath}]`,
      },
    ];
  }
  const mimeType = inferImageMimeType(relPath);
  const sizeKb = (bytes.byteLength / 1024).toFixed(1);
  const savedPath = exportPackImageToTemp(pack, relPath);
  if (bytes.byteLength > MAX_INLINE_IMAGE_BYTES) {
    return [
      {
        type: "text",
        text: savedPath
          ? `[Image "${relPath}" (${sizeKb} KB) saved to: ${savedPath} — call read_file on this path to view it directly]`
          : `[Image "${relPath}" (${sizeKb} KB) exceeds inline size limit (1.5 MB). Call extract_pack to write files to disk and read the image from the extracted path.]`,
      },
    ];
  }
  const base64 = Buffer.from(bytes).toString("base64");
  const blocks: McpContentBlock[] = [];
  const pathNotice = savedPath ? ` -> Saved to: ${savedPath}` : "";
  const offloadHint =
    " (Tip: call read_file on the saved image path to view the visual image directly — do NOT unzip or run scripts)";
  if (label) {
    blocks.push({
      type: "text",
      text: `${label} (${relPath}, ${sizeKb} KB, ${mimeType})${pathNotice}${offloadHint}`,
    });
  }
  blocks.push({
    type: "image",
    data: base64,
    mimeType,
  });
  return blocks;
}
