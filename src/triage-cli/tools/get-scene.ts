import { applyCharBudget } from "../format/budget.ts";
import { formatElementCompact } from "../format/element.ts";
import { formatRelativeTime } from "../format/time.ts";
import { openPack } from "../pack/open.ts";
import {
  extractLayoutDeviations,
  queryScreenshotDomAndCascade,
} from "../query/cascade.ts";
import {
  buildImageContentBlocks,
  type McpContentBlock,
} from "./image-helper.ts";

export function runGetSceneTool(args: {
  pack?: string;
  sceneId?: string;
  sceneIndex?: number;
  selector?: string;
  cssProperty?: string;
  includeImage?: boolean;
  format?: "text" | "json";
  maxChars?: number;
}): McpContentBlock[] {
  const loaded = openPack(args.pack);
  const effectiveSceneId =
    args.sceneId ??
    (args.sceneIndex !== undefined ? String(args.sceneIndex) : undefined);

  if (loaded.kind === "screenshot") {
    const anchors = loaded.domContext?.anchors ?? [];
    const textComments = anchors
      .map((a) => a.intentFlags?.textComment)
      .filter(Boolean);
    const deviations = extractLayoutDeviations(loaded.domContext);
    const filterSelector = args.selector ?? effectiveSceneId;

    const textOut =
      args.format === "json"
        ? applyCharBudget(
            JSON.stringify(
              {
                kind: "screenshot",
                smallestCommonAncestorSelector:
                  loaded.domContext?.smallestCommonAncestorSelector,
                textComments,
                deviations,
                anchors: filterSelector
                  ? anchors.filter((a, idx) =>
                      `${idx} ${a.selector ?? ""} ${a.selectorPath ?? ""} ${a.componentName ?? ""} ${a.innerText ?? ""}`
                        .toLowerCase()
                        .includes(filterSelector.toLowerCase())
                    )
                  : anchors,
                screenshotPath: loaded.getScreenshotImagePath(),
              },
              null,
              2
            ),
            args.maxChars
          )
        : applyCharBudget(
            [
              `# Screenshot Scene, DOM Anchors & CSS Cascade`,
              `- **Text Annotations**: ${textComments.length > 0 ? textComments.join(" | ") : "(none — expectation must be treated as inferred hypothesis)"}`,
              `- **Smallest Common Ancestor**: \`${loaded.domContext?.smallestCommonAncestorSelector ?? "—"}\``,
              ...(deviations.length > 0
                ? [
                    `\n## Auto-Detected Layout/Overflow Deviations (${deviations.length})`,
                    ...deviations.map(
                      (d) =>
                        `- ⚠️ **[${d.kind}] \`${d.selectorPath ?? d.selector}\`** (anchors: [${d.anchorIndices.slice(0, 6).join(",")}]) — ${d.summary}${d.keyStyles ? ` | styles=${JSON.stringify(d.keyStyles)}` : ""}`
                    ),
                  ]
                : []),
              "",
              ...queryScreenshotDomAndCascade(
                loaded.domContext,
                loaded.cascade,
                {
                  selector: filterSelector,
                  cssProperty: args.cssProperty,
                }
              ),
            ].join("\n"),
            args.maxChars
          );
    const blocks: McpContentBlock[] = [{ type: "text", text: textOut }];
    const imgPath = loaded.getScreenshotImagePath();
    if ((args.includeImage ?? true) && imgPath) {
      blocks.push(
        ...buildImageContentBlocks(loaded, imgPath, "Screenshot pack image")
      );
    }
    return blocks;
  }

  const scenes = loaded.getIssueScenes();
  if (scenes.length === 0) {
    return [
      {
        type: "text",
        text: "No issueScenes were recorded in this evidence pack.",
      },
    ];
  }

  const target = effectiveSceneId
    ? scenes.find(
        (s) => s.id === effectiveSceneId || String(s.index) === effectiveSceneId
      )
    : scenes[0];

  if (!target) {
    const available = scenes.map((s) => `${s.index}:${s.id}`).join(", ");
    throw new Error(
      `SCENE_NOT_FOUND: Scene "${effectiveSceneId ?? args.sceneId}" not found. Available scenes: [${available}]`
    );
  }

  const { scene } = target;
  const exp = scene.narrative?.expected;
  const expectedText = typeof exp === "string" ? exp : exp?.text;
  const confidence =
    typeof exp === "object" && exp !== null
      ? (exp.confidence ?? "missing")
      : expectedText
        ? "explicit"
        : "missing";

  const targetsList =
    scene.targets && scene.targets.length > 0
      ? scene.targets
      : scene.target
        ? [scene.target]
        : [];

  let textOut: string;
  if (args.format === "json") {
    textOut = applyCharBudget(
      JSON.stringify(
        {
          id: target.id,
          index: target.index,
          relativeMs: loaded.toRelativeMs(
            scene.selectionStartedAtEpochMs ?? scene.observedAtEpochMs
          ),
          narrative: {
            actual: scene.narrative?.actual ?? null,
            expected: expectedText ?? null,
            confidence,
            confidenceNotice:
              confidence === "missing"
                ? "UNCAPTURED_EXPECTATION: User expectation was not captured. Any expectation you formulate MUST be explicitly declared as an inferred hypothesis."
                : undefined,
          },
          sequenceContextNotice:
            "RAW_SAME_TIME_CONTEXT_ONLY: sequenceContext lists events near the mark moment and MUST NOT be treated as a proven causal chain.",
          sequenceContext: scene.sequenceContext,
          targets: targetsList,
          annotation: scene.annotation,
          originalSource: target.originalSource,
          annotatedSource: target.annotatedSource,
        },
        null,
        2
      ),
      args.maxChars
    );
  } else {
    const lines: string[] = [];
    const rel = loaded.toRelativeMs(
      scene.selectionStartedAtEpochMs ?? scene.observedAtEpochMs
    );
    lines.push(
      `# Issue Scene [${target.index}] \`${target.id}\` (at ${formatRelativeTime(rel)})`
    );
    lines.push(`\n## 1. Narrative & Expectation Anchor`);
    lines.push(`- **actual**: ${scene.narrative?.actual || "(empty)"}`);
    lines.push(
      `- **expected** [confidence: \`${confidence}\`]: ${expectedText || "(missing)"}`
    );
    if (confidence === "missing" || !expectedText) {
      lines.push(
        `  > ⚠️ **UNCAPTURED EXPECTATION**: You MUST explicitly state that the expected behavior was not captured and mark any inferred expectation as a hypothesis.`
      );
    }

    lines.push(`\n## 2. Selected DOM Targets (${targetsList.length})`);
    for (const [idx, t] of targetsList.entries()) {
      const elDesc = formatElementCompact(t.element, 80);
      const ancestorChain = (t.ancestors ?? [])
        .slice(0, 6)
        .map((a) => {
          const id = a.id ? `#${a.id}` : "";
          const cls =
            a.classNames && a.classNames.length > 0
              ? `.${a.classNames.slice(0, 2).join(".")}`
              : "";
          return `${a.tagName ?? "div"}${id}${cls}`;
        })
        .join(" <- ");
      lines.push(`- **Target #${idx}**: ${elDesc}`);
      if (ancestorChain) {
        lines.push(`  - **Ancestors**: ${ancestorChain}`);
      }
      if (t.sanitizedHtml) {
        lines.push(
          `  - **sanitizedHtml**: \`${t.sanitizedHtml.slice(0, 600)}\``
        );
      }
      if (t.computedStyle && Object.keys(t.computedStyle).length > 0) {
        lines.push(`  - **computedStyle**: ${JSON.stringify(t.computedStyle)}`);
      }
      if (t.state && Object.keys(t.state).length > 0) {
        lines.push(`  - **state**: ${JSON.stringify(t.state)}`);
      }
    }

    const seq = scene.sequenceContext;
    lines.push(
      `\n## 3. Sequence Context (Raw Same-Time Context — NOT Proven Causality)`
    );
    if (!seq) {
      lines.push(`(No sequenceContext recorded)`);
    } else {
      const seqInt = seq.interactions ?? [];
      const seqErr = seq.consoleErrors ?? [];
      const seqNet = seq.networkFailures ?? [];
      lines.push(
        `Window: ${seq.windowMs ?? 60000}ms before anchor | ${seqInt.length} interactions, ${seqErr.length} console errors, ${seqNet.length} network failures`
      );
      for (const item of seqInt.slice(-15)) {
        lines.push(
          `  - [${item.offsetMs ?? 0}ms] [${item.kind}] <${item.tagName ?? "?"}> text="${item.text ?? ""}" ${item.value !== undefined ? `val="${item.value}"` : ""}`
        );
      }
      for (const err of seqErr) {
        lines.push(
          `  - [${err.offsetMs ?? 0}ms] [CONSOLE ${err.level ?? "ERROR"}] ${err.text ?? ""}`
        );
      }
      for (const net of seqNet) {
        lines.push(
          `  - [${net.offsetMs ?? 0}ms] [NET ${net.method ?? "GET"} ${net.status ?? "ERR"}] ${net.url ?? ""}`
        );
      }
    }

    textOut = applyCharBudget(lines.join("\n"), args.maxChars);
  }

  const blocks: McpContentBlock[] = [{ type: "text", text: textOut }];
  const shouldIncludeImage = args.includeImage ?? true;
  const imgPath = target.annotatedSource ?? target.originalSource;
  if (shouldIncludeImage && imgPath) {
    blocks.push(
      ...buildImageContentBlocks(
        loaded,
        imgPath,
        `Scene [${target.index}] screenshot`
      )
    );
  }
  return blocks;
}
