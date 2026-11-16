import { openPack } from "../pack/open.ts";
import {
  buildImageContentBlocks,
  type McpContentBlock,
} from "./image-helper.ts";

export function runGetScreenshotTool(args: {
  pack?: string;
  kind?:
    | "step"
    | "settled"
    | "final"
    | "issue-original"
    | "issue-annotated"
    | "screenshot";
  step?: number;
  settled?: boolean;
  final?: boolean;
  sceneId?: string;
}): McpContentBlock[] {
  const loaded = openPack(args.pack);

  if (loaded.kind === "screenshot") {
    const imgPath = loaded.getScreenshotImagePath();
    if (!imgPath) {
      throw new Error(
        `SCREENSHOT_NOT_FOUND: No screenshot image found in screenshot pack "${args.pack}".`
      );
    }
    return buildImageContentBlocks(loaded, imgPath, "Screenshot pack image");
  }

  const effectiveKind = args.final
    ? "final"
    : args.settled
      ? "settled"
      : (args.kind ?? (args.step !== undefined ? "step" : "issue-annotated"));

  if (effectiveKind === "final") {
    const candidates: string[] = [];
    if (loaded.data.summary?.finalFramePath) {
      candidates.push(loaded.data.summary.finalFramePath);
    }
    for (const ext of ["jpg", "png", "jpeg", "webp"]) {
      candidates.push(`screenshots/final-frame.${ext}`);
    }
    for (const candidate of candidates) {
      if (loaded.files.has(candidate)) {
        const durMs = loaded.data.summary?.durationMs;
        const label = durMs
          ? `Final frame before stop (+${durMs}ms)`
          : `Final frame before stop`;
        return buildImageContentBlocks(loaded, candidate, label);
      }
    }
    const availableShots = Array.from(loaded.files.keys())
      .filter((k) => k.startsWith("screenshots/"))
      .slice(0, 15)
      .join(", ");
    throw new Error(
      `FINAL_FRAME_NOT_FOUND: Final frame screenshot (screenshots/final-frame.*) was not found in pack. Available screenshots: [${availableShots}]`
    );
  }

  if (effectiveKind === "settled") {
    const stepNum = args.step ?? 1;
    const interaction = loaded.getInteractions()[stepNum - 1];
    const settledDurationMs =
      interaction?.screenshots?.settledDurationMs ??
      interaction?.screenshot?.settledDurationMs;
    const candidates: string[] = [];
    if (interaction?.screenshots?.settledPath) {
      candidates.push(interaction.screenshots.settledPath);
    }
    for (const ext of ["jpg", "png", "jpeg", "webp"]) {
      candidates.push(`screenshots/step-${stepNum}-settled.${ext}`);
    }
    for (const candidate of candidates) {
      if (loaded.files.has(candidate)) {
        const durNote =
          typeof settledDurationMs === "number"
            ? `, settled in ${settledDurationMs}ms`
            : "";
        return buildImageContentBlocks(
          loaded,
          candidate,
          `Step ${stepNum} settled screenshot${durNote}`
        );
      }
    }
    const availableSettled = Array.from(loaded.files.keys())
      .filter((k) => /^screenshots\/step-\d+-settled\./.test(k))
      .slice(0, 15)
      .join(", ");
    throw new Error(
      `SETTLED_SCREENSHOT_NOT_FOUND: Settled screenshot for step ${stepNum} not found. Available settled frames: [${availableSettled}]`
    );
  }

  if (effectiveKind === "step") {
    const stepNum = args.step ?? 1;
    for (const ext of ["jpg", "png", "jpeg", "webp"]) {
      const candidate = `screenshots/step-${stepNum}.${ext}`;
      if (loaded.files.has(candidate)) {
        const summary = loaded.data.screenshotSummaries?.find(
          (s) => s.step === stepNum
        );
        const label = summary
          ? `Step ${stepNum} screenshot (+${summary.elapsedMs ?? 0}ms [${summary.kind ?? "?"}] ${summary.element ?? ""})`
          : `Step ${stepNum} screenshot`;
        return buildImageContentBlocks(loaded, candidate, label);
      }
    }
    const availableSteps = Array.from(loaded.files.keys())
      .filter((k) => k.startsWith("screenshots/step-"))
      .slice(0, 15)
      .join(", ");
    throw new Error(
      `STEP_SCREENSHOT_NOT_FOUND: Screenshot for step ${stepNum} not found. Available sample: [${availableSteps}]`
    );
  }

  const scenes = loaded.getIssueScenes();
  if (scenes.length === 0) {
    throw new Error(
      `SCENE_SCREENSHOT_NOT_FOUND: Pack has no issueScenes. Use kind="step" with step=1..N to inspect interaction screenshots.`
    );
  }
  const target = args.sceneId
    ? scenes.find(
        (s) => s.id === args.sceneId || String(s.index) === args.sceneId
      )
    : scenes[0];

  if (!target) {
    throw new Error(
      `SCENE_NOT_FOUND: Scene "${args.sceneId}" not found in pack.`
    );
  }

  const relPath =
    effectiveKind === "issue-original"
      ? (target.originalSource ?? target.annotatedSource)
      : (target.annotatedSource ?? target.originalSource);

  if (!relPath) {
    throw new Error(
      `SCENE_IMAGE_MISSING: Scene "${target.id}" does not have a ${effectiveKind} image file.`
    );
  }

  return buildImageContentBlocks(
    loaded,
    relPath,
    `Scene [${target.index}] (${target.id}) ${effectiveKind}`
  );
}
