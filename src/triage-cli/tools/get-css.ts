import { applyCharBudget } from "../format/budget.ts";
import { openPack } from "../pack/open.ts";
import type {
  IssueSceneDomContextV5,
  IssueSceneDomStylesV5,
} from "../pack/types.ts";
import { queryScreenshotDomAndCascade } from "../query/cascade.ts";

function parseJsonSafe<T>(raw: string | undefined): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

export function runGetCssTool(args: {
  pack?: string;
  scene?: string;
  sceneId?: string;
  sceneIndex?: number;
  selector?: string;
  property?: string;
  format?: "text" | "json";
  maxChars?: number;
}): string {
  const loaded = openPack(args.pack);

  if (loaded.kind === "screenshot") {
    if (args.format === "json") {
      return applyCharBudget(
        JSON.stringify(
          {
            kind: "screenshot",
            selectorFilter: args.selector ?? null,
            propertyFilter: args.property ?? null,
            anchors: loaded.domContext?.anchors ?? [],
            rules: loaded.cascade?.rules ?? [],
          },
          null,
          2
        ),
        args.maxChars
      );
    }
    const lines = queryScreenshotDomAndCascade(
      loaded.domContext,
      loaded.cascade,
      {
        selector: args.selector,
        cssProperty: args.property,
      }
    );
    return applyCharBudget(lines.join("\n"), args.maxChars);
  }

  const scenes = loaded.getIssueScenes();
  if (scenes.length === 0) {
    return "No issueScenes found in this session pack. Capture an issue scene or pass a screenshot pack.";
  }

  const effectiveSceneId =
    args.sceneId ??
    args.scene ??
    (args.sceneIndex !== undefined ? String(args.sceneIndex) : undefined);

  const target = effectiveSceneId
    ? scenes.find(
        (s) => s.id === effectiveSceneId || String(s.index) === effectiveSceneId
      )
    : scenes[0];

  if (!target) {
    const available = scenes.map((s) => `${s.index}:${s.id}`).join(", ");
    throw new Error(
      `SCENE_NOT_FOUND: Scene "${effectiveSceneId}" not found. Available scenes: [${available}]`
    );
  }

  const domStyles =
    parseJsonSafe<IssueSceneDomStylesV5>(
      loaded.getTextFile(
        target.domStylesPath ?? `issues/${target.id}/dom-styles.json`
      )
    ) ??
    ({
      sceneId: target.id,
      targetSelector: target.targetSelector,
      computedLayoutStyles: target.scene.target?.computedStyle ?? {},
      winnerRules: target.scene.target?.winnerRules ?? [],
    } satisfies IssueSceneDomStylesV5);

  const domContext = parseJsonSafe<IssueSceneDomContextV5>(
    loaded.getTextFile(
      target.domContextPath ?? `issues/${target.id}/dom-context.json`
    )
  );

  const matchesTokens = (
    tokens: string[],
    ...haystacks: unknown[]
  ): boolean => {
    if (tokens.length === 0) return true;
    const lower = haystacks.map((h) => String(h ?? "").toLowerCase());
    return tokens.some((tok) => lower.some((s) => s.includes(tok)));
  };
  const tokenizeFilter = (raw?: string): string[] =>
    raw
      ? raw
          .toLowerCase()
          .split("|")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

  const selTokens = tokenizeFilter(args.selector);
  const propTokens = tokenizeFilter(args.property);

  const rawComputed = domStyles.computedLayoutStyles ?? {};
  const filteredComputed =
    propTokens.length > 0
      ? Object.fromEntries(
          Object.entries(rawComputed).filter(([k, v]) =>
            matchesTokens(propTokens, k, v)
          )
        )
      : rawComputed;

  const rawRules = domStyles.winnerRules ?? [];
  const filteredRules = rawRules.filter((rule) => {
    if (
      !matchesTokens(selTokens, `${rule.selector ?? ""} ${rule.source ?? ""}`)
    ) {
      return false;
    }
    if (propTokens.length > 0) {
      return Object.entries(rule.properties ?? {}).some(([k, v]) =>
        matchesTokens(propTokens, k, v)
      );
    }
    return true;
  });

  const triggerElement =
    domContext?.triggerElement ?? target.scene.target?.triggerElement;
  const relatedOverlays =
    domContext?.relatedOverlays ?? target.scene.target?.relatedOverlays;

  if (args.format === "json") {
    return applyCharBudget(
      JSON.stringify(
        {
          kind: "session",
          sceneId: target.id,
          sceneIndex: target.index,
          targetSelector:
            domStyles.targetSelector ??
            target.targetSelector ??
            domContext?.targetSelector,
          computedLayoutStyles: filteredComputed,
          winnerRules: filteredRules,
          ...(triggerElement ? { triggerElement } : {}),
          ...(relatedOverlays?.length ? { relatedOverlays } : {}),
        },
        null,
        2
      ),
      args.maxChars
    );
  }

  const lines: string[] = [];
  const targetSel =
    domStyles.targetSelector ??
    target.targetSelector ??
    domContext?.targetSelector ??
    "—";
  lines.push(
    `# Winner CSS & Computed Layout Styles (Scene [${target.index}] \`${target.id}\`)`
  );
  lines.push(`- **Target Selector**: \`${targetSel}\``);

  if (triggerElement) {
    lines.push(
      `- **Portal Trigger Element**: \`${triggerElement.selectorPath ?? triggerElement.tagName ?? "?"}\`${triggerElement.componentName ? ` (component: \`${triggerElement.componentName}\`)` : ""}`
    );
  }
  if (relatedOverlays && relatedOverlays.length > 0) {
    lines.push(
      `- **Related Portal Overlays (${relatedOverlays.length})**: ${relatedOverlays.map((o) => `${o.tagName ?? "div"}${o.id ? `#${o.id}` : ""} (${o.relationReason ?? "linked"})`).join(", ")}`
    );
  }

  const computedEntries = Object.entries(filteredComputed);
  lines.push(`\n## Computed Layout Styles (${computedEntries.length})`);
  if (computedEntries.length === 0) {
    lines.push("(No computed layout properties matched)");
  } else {
    for (const [k, v] of computedEntries) {
      lines.push(`- \`${k}\`: \`${v}\``);
    }
  }

  lines.push(
    `\n## Winner CSS Rules (${filteredRules.length} of ${rawRules.length})`
  );
  if (filteredRules.length === 0) {
    lines.push("(No winner rules recorded or matched filter)");
  } else {
    for (const rule of filteredRules) {
      lines.push(
        `- **\`${rule.selector}\`** — \`${rule.source}\`${rule.specificity ? ` (specificity: \`${rule.specificity}\`)` : ""}`
      );
      for (const [k, v] of Object.entries(rule.properties ?? {})) {
        if (!matchesTokens(propTokens, k, v)) {
          continue;
        }
        lines.push(`  - \`${k}: ${v}\``);
      }
    }
  }

  return applyCharBudget(lines.join("\n"), args.maxChars);
}
