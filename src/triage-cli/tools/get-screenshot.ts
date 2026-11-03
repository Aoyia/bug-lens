import { openPack } from "../pack/open.ts";
import {
  buildImageContentBlocks,
  type McpContentBlock,
} from "./image-helper.ts";

export function runGetScreenshotTool(args: {
  pack?: string;
  kind?: "step" | "issue-original" | "issue-annotated" | "screenshot";
  step?: number;
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

  const kind =
    args.kind ?? (args.step !== undefined ? "step" : "issue-annotated");

  if (kind === "step") {
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
    kind === "issue-original"
      ? (target.originalSource ?? target.annotatedSource)
      : (target.annotatedSource ?? target.originalSource);

  if (!relPath) {
    throw new Error(
      `SCENE_IMAGE_MISSING: Scene "${target.id}" does not have a ${kind} image file.`
    );
  }

  return buildImageContentBlocks(
    loaded,
    relPath,
    `Scene [${target.index}] (${target.id}) ${kind}`
  );
}
