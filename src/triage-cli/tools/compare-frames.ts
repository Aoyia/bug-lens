import { applyCharBudget } from "../format/budget.ts";
import { openPack } from "../pack/open.ts";
import type { LoadedSessionPack } from "../pack/session-pack.ts";
import {
  buildImageContentBlocks,
  inferImageMimeType,
  type McpContentBlock,
} from "./image-helper.ts";

interface ImageDimensions {
  width: number;
  height: number;
}

/** 零依赖解析 PNG/JPEG 头部分辨率（仅供视觉帧比对元信息展示）。 */
export function parseImageDimensions(
  bytes: Uint8Array,
  filePath: string
): ImageDimensions | undefined {
  if (bytes.byteLength < 24) return undefined;
  const mime = inferImageMimeType(filePath);
  if (
    mime === "image/png" &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return {
      width: view.getUint32(16, false),
      height: view.getUint32(20, false),
    };
  }
  if (mime === "image/jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.byteLength) {
      if (bytes[i] !== 0xff) break;
      const marker = bytes[i + 1]!;
      const len = (bytes[i + 2]! << 8) | bytes[i + 3]!;
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      ) {
        const height = (bytes[i + 5]! << 8) | bytes[i + 6]!;
        const width = (bytes[i + 7]! << 8) | bytes[i + 8]!;
        return { width, height };
      }
      if (len < 2) break;
      i += 2 + len;
    }
  }
  return undefined;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function findStepPath(
  pack: LoadedSessionPack,
  stepNum: number,
  settled = false
): string | undefined {
  const interaction = pack.getInteractions()[stepNum - 1];
  const hinted = settled
    ? interaction?.screenshots?.settledPath
    : interaction?.screenshots?.instantPath;
  if (hinted && pack.files.has(hinted)) return hinted;
  const suffix = settled ? "-settled" : "";
  for (const ext of ["jpg", "png", "jpeg", "webp"]) {
    const candidate = `screenshots/step-${stepNum}${suffix}.${ext}`;
    if (pack.files.has(candidate)) return candidate;
  }
  return undefined;
}

function findFinalFramePath(pack: LoadedSessionPack): string | undefined {
  const hinted = pack.data.summary?.finalFramePath;
  if (hinted && pack.files.has(hinted)) return hinted;
  for (const ext of ["jpg", "png", "jpeg", "webp"]) {
    const candidate = `screenshots/final-frame.${ext}`;
    if (pack.files.has(candidate)) return candidate;
  }
  return undefined;
}

function findLastStepWithScreenshot(
  pack: LoadedSessionPack
): number | undefined {
  let maxStep: number | undefined;
  for (const key of pack.files.keys()) {
    const m = /^screenshots\/step-(\d+)\./.exec(key);
    if (m) {
      const n = Number(m[1]);
      if (maxStep === undefined || n > maxStep) maxStep = n;
    }
  }
  return maxStep;
}

export function runCompareFramesTool(args: {
  pack?: string;
  step?: number;
  from?: number;
  to?: number;
  against?: string;
  settled?: boolean;
  final?: boolean;
  left?: string;
  right?: string;
  includeImage?: boolean;
  format?: "text" | "json";
  maxChars?: number;
}): McpContentBlock[] {
  const loaded = openPack(args.pack);
  if (loaded.kind !== "session") {
    throw new Error(
      `UNSUPPORTED_PACK_KIND: compare_frames requires a session evidence pack, but "${args.pack}" is a screenshot pack.`
    );
  }

  let leftPath = args.left;
  let rightPath = args.right;
  let leftLabel = "Left frame";
  let rightLabel = "Right frame";

  if (!leftPath || !rightPath) {
    if (args.from !== undefined) {
      leftPath = leftPath ?? findStepPath(loaded, args.from, false);
      leftLabel = `Step ${args.from} (instant)`;
      if (args.to !== undefined) {
        rightPath = rightPath ?? findStepPath(loaded, args.to, false);
        rightLabel = `Step ${args.to} (instant)`;
      } else if (args.final) {
        rightPath = rightPath ?? findFinalFramePath(loaded);
        rightLabel = "Final frame";
      } else {
        rightPath = rightPath ?? findStepPath(loaded, args.from, true);
        rightLabel = `Step ${args.from} (settled)`;
      }
    } else {
      const targetStep = args.step ?? findLastStepWithScreenshot(loaded) ?? 1;
      leftPath = leftPath ?? findStepPath(loaded, targetStep, false);
      leftLabel = `Step ${targetStep} (instant)`;

      const againstRaw = args.against?.trim().toLowerCase();
      if (
        args.final ||
        againstRaw === "final" ||
        againstRaw === "final-frame"
      ) {
        rightPath = rightPath ?? findFinalFramePath(loaded);
        rightLabel = "Final frame";
      } else if (againstRaw && /^\d+$/.test(againstRaw)) {
        const rhsStep = Number(againstRaw);
        rightPath = rightPath ?? findStepPath(loaded, rhsStep, false);
        rightLabel = `Step ${rhsStep} (instant)`;
      } else if (
        againstRaw &&
        againstRaw !== "settled" &&
        loaded.files.has(args.against!)
      ) {
        rightPath = args.against!;
        rightLabel = args.against!;
      } else {
        rightPath = rightPath ?? findStepPath(loaded, targetStep, true);
        rightLabel = `Step ${targetStep} (settled)`;
        if (!rightPath && !args.settled && !args.against) {
          const fallbackFinal = findFinalFramePath(loaded);
          if (fallbackFinal) {
            rightPath = fallbackFinal;
            rightLabel = "Final frame";
          }
        }
      }
    }
  }

  if (!leftPath || !loaded.files.has(leftPath)) {
    throw new Error(
      `FRAME_NOT_FOUND: Left comparison image not found (${leftPath ?? "unspecified"}). Pass --step N or --from A --to B.`
    );
  }
  if (!rightPath || !loaded.files.has(rightPath)) {
    throw new Error(
      `FRAME_NOT_FOUND: Right comparison image (${rightLabel}) not found in pack (${rightPath ?? "unspecified"}).`
    );
  }

  const leftBytes = loaded.getBinaryFile(leftPath)!;
  const rightBytes = loaded.getBinaryFile(rightPath)!;
  const identicalBytes = bytesEqual(leftBytes, rightBytes);
  const byteDelta = rightBytes.byteLength - leftBytes.byteLength;
  const maxLen = Math.max(1, leftBytes.byteLength, rightBytes.byteLength);
  const sizeDeltaPct = Number(
    ((Math.abs(byteDelta) / maxLen) * 100).toFixed(2)
  );
  const leftDims = parseImageDimensions(leftBytes, leftPath);
  const rightDims = parseImageDimensions(rightBytes, rightPath);
  const resolutionChanged = Boolean(
    leftDims &&
    rightDims &&
    (leftDims.width !== rightDims.width || leftDims.height !== rightDims.height)
  );

  let textOut: string;
  if (args.format === "json") {
    textOut = applyCharBudget(
      JSON.stringify(
        {
          left: {
            path: leftPath,
            label: leftLabel,
            byteLength: leftBytes.byteLength,
            dimensions: leftDims ?? null,
          },
          right: {
            path: rightPath,
            label: rightLabel,
            byteLength: rightBytes.byteLength,
            dimensions: rightDims ?? null,
          },
          identicalBytes,
          byteDelta,
          sizeDeltaPct,
          resolutionChanged,
        },
        null,
        2
      ),
      args.maxChars
    );
  } else {
    const lines = [
      `# Frame Comparison: ${leftLabel} vs ${rightLabel}`,
      `- **Left**: \`${leftPath}\` (${leftBytes.byteLength} B${leftDims ? `, ${leftDims.width}x${leftDims.height}` : ""})`,
      `- **Right**: \`${rightPath}\` (${rightBytes.byteLength} B${rightDims ? `, ${rightDims.width}x${rightDims.height}` : ""})`,
      `- **Identical Bytes**: ${identicalBytes ? "true (no pixel/encoding change between captures)" : "false"}`,
      `- **Byte Delta**: ${byteDelta >= 0 ? `+${byteDelta}` : byteDelta} B (${sizeDeltaPct}% size difference)`,
      `- **Resolution Changed**: ${resolutionChanged}`,
    ];
    textOut = applyCharBudget(lines.join("\n"), args.maxChars);
  }

  const blocks: McpContentBlock[] = [{ type: "text", text: textOut }];
  if (args.includeImage ?? true) {
    blocks.push(
      ...buildImageContentBlocks(loaded, leftPath, `[Before] ${leftLabel}`),
      ...buildImageContentBlocks(loaded, rightPath, `[After] ${rightLabel}`)
    );
  }
  return blocks;
}
