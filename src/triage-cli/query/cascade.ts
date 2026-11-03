import type {
  CascadeElementRef,
  CascadeIndex,
  CascadeRuleSource,
  CascadeSheetSource,
  ScreenshotDomAnchor,
  ScreenshotDomContext,
} from "../pack/types.ts";

const KEY_LAYOUT_STYLE_RE =
  /^(?:word-break|overflow-wrap|word-wrap|white-space|white-space-collapse|text-wrap|text-wrap-mode|text-overflow|overflow|overflow-x|overflow-y|display|width|max-width|min-width|height|max-height|min-height|flex|flex-grow|flex-shrink|flex-basis|flex-wrap|flex-direction|-webkit-line-clamp|line-clamp|position|z-index)$/i;

export interface LayoutDeviationGroup {
  kind: "text_overflow" | "flex_squeeze" | "grid_overflow";
  selector: string;
  selectorPath?: string;
  component?: string;
  anchorIndices: number[];
  summary: string;
  sampleText?: string;
  keyStyles?: Record<string, string>;
}

export function extractLayoutDeviations(
  dc?: ScreenshotDomContext
): LayoutDeviationGroup[] {
  if (!dc) return [];
  const groups = new Map<string, LayoutDeviationGroup>();

  const pickKeyStyles = (
    styles?: Record<string, string>
  ): Record<string, string> | undefined => {
    if (!styles) return undefined;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(styles)) {
      if (
        KEY_LAYOUT_STYLE_RE.test(k) &&
        v !== undefined &&
        v !== "" &&
        v !== "normal" &&
        v !== "auto" &&
        v !== "none" &&
        v !== "visible" &&
        v !== "static"
      ) {
        out[k] = v;
      }
    }
    return Object.keys(out).length > 0 ? out : undefined;
  };

  const inspectNode = (
    node: Record<string, unknown>,
    anchorIdx?: number
  ): void => {
    const selector =
      (node.selector as string) || (node.tagName as string) || "element";
    const selectorPath = node.selectorPath as string | undefined;
    const compName = node.componentName as string | undefined;
    const compFile = node.componentFile as string | undefined;
    const compLine = node.componentLine as number | undefined;
    const component = compName
      ? `${compName}${compFile ? ` @ ${compFile}${compLine ? `:${compLine}` : ""}` : ""}`
      : undefined;
    const layoutContext = (node.layoutContext ?? {}) as Record<string, unknown>;
    const textOv = (layoutContext.textOverflow ?? node.textOverflow) as
      Record<string, unknown> | undefined;
    const squeeze = (layoutContext.flexSqueezeRisk ?? node.flexSqueezeRisk) as
      Record<string, unknown> | undefined;
    const grid = (layoutContext.gridSelf ?? node.gridSelf) as
      Record<string, unknown> | undefined;
    const computedStyles = node.computedStyles as
      Record<string, string> | undefined;
    const sampleText =
      typeof node.innerText === "string"
        ? node.innerText.replace(/\s+/g, " ").trim().slice(0, 80)
        : undefined;

    if (textOv && textOv.isTruncated) {
      const scrollDim = (textOv.scrollDimension ?? {}) as Record<
        string,
        number
      >;
      const clientDim = (textOv.clientDimension ?? {}) as Record<
        string,
        number
      >;
      const delta = (textOv.overflowDelta ?? {}) as Record<string, number>;
      const truncType = String(textOv.truncationType ?? "truncated");
      const key = `text_overflow|${selector}|${truncType}|${clientDim.width ?? 0}x${clientDim.height ?? 0}`;
      const existing = groups.get(key);
      if (existing) {
        if (
          anchorIdx !== undefined &&
          !existing.anchorIndices.includes(anchorIdx)
        ) {
          existing.anchorIndices.push(anchorIdx);
        }
      } else {
        groups.set(key, {
          kind: "text_overflow",
          selector,
          selectorPath,
          component,
          anchorIndices: anchorIdx !== undefined ? [anchorIdx] : [],
          summary: `${truncType} truncation (scroll ${scrollDim.width ?? "?"}x${scrollDim.height ?? "?"}px > client ${clientDim.width ?? "?"}x${clientDim.height ?? "?"}px, delta +${delta.width ?? 0}px W / +${delta.height ?? 0}px H)`,
          sampleText,
          keyStyles: pickKeyStyles(computedStyles),
        });
      }
    }

    if (squeeze && squeeze.isSqueezed) {
      const key = `flex_squeeze|${selector}|${squeeze.renderedWidth ?? 0}`;
      const existing = groups.get(key);
      if (existing) {
        if (
          anchorIdx !== undefined &&
          !existing.anchorIndices.includes(anchorIdx)
        ) {
          existing.anchorIndices.push(anchorIdx);
        }
      } else {
        groups.set(key, {
          kind: "flex_squeeze",
          selector,
          selectorPath,
          component,
          anchorIndices: anchorIdx !== undefined ? [anchorIdx] : [],
          summary: `Flex squeeze (intrinsic ${squeeze.intrinsicWidth ?? "?"}px -> rendered ${squeeze.renderedWidth ?? "?"}px, flex-shrink=${squeeze.flexShrink ?? "?"})`,
          sampleText,
          keyStyles: pickKeyStyles(computedStyles),
        });
      }
    }

    if (grid && grid.isGridOverflow) {
      const key = `grid_overflow|${selector}`;
      const existing = groups.get(key);
      if (existing) {
        if (
          anchorIdx !== undefined &&
          !existing.anchorIndices.includes(anchorIdx)
        ) {
          existing.anchorIndices.push(anchorIdx);
        }
      } else {
        groups.set(key, {
          kind: "grid_overflow",
          selector,
          selectorPath,
          component,
          anchorIndices: anchorIdx !== undefined ? [anchorIdx] : [],
          summary: String(grid.reason ?? "Grid item overflowed track"),
          sampleText,
          keyStyles: pickKeyStyles(computedStyles),
        });
      }
    }
  };

  (dc.anchors ?? []).forEach((a, idx) => {
    inspectNode(a as unknown as Record<string, unknown>, idx);
  });

  const walkTree = (node?: Record<string, unknown>): void => {
    if (!node) return;
    inspectNode(node);
    const children = node.children as
      Array<Record<string, unknown>> | undefined;
    if (Array.isArray(children)) {
      for (const child of children) walkTree(child);
    }
  };
  if (dc.tree) {
    walkTree(dc.tree);
  }

  return Array.from(groups.values());
}

function formatSheetRef(
  sheetId: string,
  sheetsMap: Map<string, CascadeSheetSource>
): string {
  const s = sheetsMap.get(sheetId);
  if (!s) return sheetId;
  if (s.href) {
    try {
      const u = new URL(s.href);
      const base = u.pathname.split("/").filter(Boolean).pop() ?? u.pathname;
      return `${sheetId}:${base}`;
    } catch {
      const clean = s.href.split("?")[0];
      const base = clean.split("/").filter(Boolean).pop() ?? clean.slice(-30);
      return `${sheetId}:${base}`;
    }
  }
  return `${sheetId}:inline`;
}

function extractKeyDeclarations(rule: CascadeRuleSource): string[] {
  const out: string[] = [];
  if (rule.styleProps && Object.keys(rule.styleProps).length > 0) {
    for (const [prop, val] of Object.entries(rule.styleProps)) {
      if (KEY_LAYOUT_STYLE_RE.test(prop)) {
        out.push(`${prop}: ${val}`);
      }
    }
  } else if (rule.cssText) {
    const bodyMatch = rule.cssText.match(/\{([\s\S]*)\}/);
    const body = bodyMatch ? bodyMatch[1] : rule.cssText;
    for (const decl of body.split(";")) {
      const trimmed = decl.trim();
      if (!trimmed) continue;
      const colonIdx = trimmed.indexOf(":");
      if (colonIdx > 0) {
        const prop = trimmed.slice(0, colonIdx).trim();
        if (KEY_LAYOUT_STYLE_RE.test(prop)) {
          out.push(trimmed);
        }
      }
    }
  }
  return out;
}

export function formatCascadeOverview(cascade?: CascadeIndex): string[] {
  if (!cascade) return [];
  const sheets = cascade.sheets ?? [];
  const rules = cascade.rules ?? [];
  const elements = cascade.elements ?? [];

  const sheetsMap = new Map<string, CascadeSheetSource>();
  for (const s of sheets) sheetsMap.set(s.id, s);

  const rulesMap = new Map<string, CascadeRuleSource>();
  for (const r of rules) rulesMap.set(r.id, r);

  const lines: string[] = [];
  lines.push(
    `\n## CSS Cascade Index (${sheets.length} stylesheets, ${rules.length} rules, ${elements.length} indexed elements)`
  );

  const activeSheetIds = new Set<string>();
  for (const el of elements) {
    for (const rid of el.matchedRuleIds ?? []) {
      const r = rulesMap.get(rid);
      if (r) activeSheetIds.add(r.sheetId);
    }
  }

  const externalSheets = sheets.filter(
    (s) =>
      Boolean(s.href) && (activeSheetIds.size === 0 || activeSheetIds.has(s.id))
  );
  const inlineCount = sheets.filter((s) => !s.href).length;
  if (externalSheets.length > 0 || inlineCount > 0) {
    lines.push(`### Active Stylesheets (referenced by captured elements)`);
    for (const s of externalSheets.slice(0, 12)) {
      lines.push(`- \`${s.id}\`: ${s.href} (${s.rulesCount ?? 0} rules)`);
    }
    if (externalSheets.length > 12) {
      lines.push(
        `- ... +${externalSheets.length - 12} more active stylesheets`
      );
    }
    if (inlineCount > 0) {
      lines.push(`- \`inline <style>\`: ${inlineCount} inline style tag(s)`);
    }
  }

  if (elements.length > 0) {
    lines.push(`### Indexed Elements & Key Layout/Wrapping Rule Overrides`);
    const seenElSig = new Map<string, string[]>();
    const uniqueElements: Array<{
      idx: number;
      el: CascadeElementRef;
      sig: string;
    }> = [];
    elements.forEach((el, idx) => {
      const sig = `${el.tagName}|${(el.matchedRuleIds ?? []).join(",")}`;
      const list = seenElSig.get(sig);
      if (list) {
        list.push(el.id);
      } else {
        seenElSig.set(sig, [el.id]);
        uniqueElements.push({ idx, el, sig });
      }
    });

    for (const { idx, el, sig } of uniqueElements.slice(0, 12)) {
      const matchedIds = el.matchedRuleIds ?? [];
      const allIds = seenElSig.get(sig) ?? [el.id];
      const dupIds =
        allIds.length > 1 ? ` (also ${allIds.slice(1).join(", ")})` : "";
      const dedupRules = new Map<
        string,
        {
          rule: CascadeRuleSource;
          decls: string[];
          ruleIds: string[];
          sheetRefs: Set<string>;
        }
      >();

      for (const rid of matchedIds) {
        const r = rulesMap.get(rid);
        if (!r) continue;
        const decls = extractKeyDeclarations(r);
        if (decls.length === 0) continue;
        const ruleSig = `${r.selectorText}||${decls.join(";")}`;
        const sheetRef = formatSheetRef(r.sheetId, sheetsMap);
        const existing = dedupRules.get(ruleSig);
        if (existing) {
          existing.ruleIds.push(rid);
          existing.sheetRefs.add(sheetRef);
        } else {
          dedupRules.set(ruleSig, {
            rule: r,
            decls,
            ruleIds: [rid],
            sheetRefs: new Set([sheetRef]),
          });
        }
      }

      lines.push(
        `- **[${idx}] \`${el.id}\`${dupIds} \`<${el.tagName}>\` \`${el.selector}\`** (${matchedIds.length} matched rules)`
      );
      for (const item of dedupRules.values()) {
        const idsStr =
          item.ruleIds.length > 1
            ? `${item.ruleIds[0]} (+${item.ruleIds.length - 1})`
            : item.ruleIds[0];
        const sheetsStr = Array.from(item.sheetRefs).slice(0, 2).join(", ");
        lines.push(
          `  - [${idsStr} @ ${sheetsStr}] \`${item.rule.selectorText}\` -> \`${item.decls.join("; ")}\``
        );
      }
    }
    if (uniqueElements.length > 12) {
      lines.push(
        `- ... +${uniqueElements.length - 12} more elements (call \`get_scene(selector="...")\` or \`search_pack\` to inspect)`
      );
    }
  }

  return lines;
}

export function queryScreenshotDomAndCascade(
  dc: ScreenshotDomContext | undefined,
  cascade: CascadeIndex | undefined,
  options: {
    selector?: string;
    cssProperty?: string;
  }
): string[] {
  const lines: string[] = [];
  const selNeedle = options.selector?.trim().toLowerCase();
  const propNeedle = options.cssProperty?.trim().toLowerCase();
  const propRegex = propNeedle ? new RegExp(propNeedle, "i") : undefined;

  const anchors: ScreenshotDomAnchor[] = dc?.anchors ?? [];
  const matchedAnchors: Array<{ idx: number; anchor: ScreenshotDomAnchor }> =
    [];

  anchors.forEach((a, idx) => {
    if (!selNeedle) {
      matchedAnchors.push({ idx, anchor: a });
      return;
    }
    const hay =
      `${idx} ${a.selector ?? ""} ${a.selectorPath ?? ""} ${a.tagName ?? ""} ${a.componentName ?? ""} ${a.componentFile ?? ""} ${a.innerText ?? ""}`.toLowerCase();
    if (hay.includes(selNeedle)) {
      matchedAnchors.push({ idx, anchor: a });
    }
  });

  lines.push(
    `## Matched DOM Anchors (${matchedAnchors.length} of ${anchors.length})`
  );

  // 对具有相同 selectorPath + computedStyles 的大量重复行折叠展示
  const seenSignatures = new Map<string, number[]>();
  const representativeAnchors: Array<{
    idx: number;
    anchor: ScreenshotDomAnchor;
    sig: string;
  }> = [];

  for (const item of matchedAnchors) {
    const a = item.anchor;
    const truncType = (
      (a.layoutContext as Record<string, unknown> | undefined)?.textOverflow as
        Record<string, unknown> | undefined
    )?.truncationType;
    const sig = `${a.selectorPath ?? a.selector}|${a.componentName ?? ""}|${truncType ?? ""}|${JSON.stringify(a.intentFlags ?? {})}`;
    const existingList = seenSignatures.get(sig);
    if (existingList) {
      existingList.push(item.idx);
      // 如果用户明确用 selector 过滤且数量不多（<= 10），仍逐个展示；否则折叠重复行
      if (selNeedle && matchedAnchors.length <= 10) {
        representativeAnchors.push({ ...item, sig: `${sig}#${item.idx}` });
      }
    } else {
      seenSignatures.set(sig, [item.idx]);
      representativeAnchors.push({ ...item, sig });
    }
  }

  for (const { idx, anchor: a, sig } of representativeAnchors.slice(0, 30)) {
    const groupIndices = seenSignatures.get(sig) ?? [idx];
    const dupSuffix =
      groupIndices.length > 1
        ? ` (and ${groupIndices.length - 1} identical sibling anchor(s): [${groupIndices.slice(1, 8).join(", ")}${groupIndices.length > 8 ? ", ..." : ""}])`
        : "";
    const comp = a.componentName
      ? ` [${a.componentName}${a.componentFile ? ` @ ${a.componentFile}:${a.componentLine ?? ""}` : ""}]`
      : "";
    lines.push(
      `- **[${idx}] \`${a.selectorPath ?? a.selector ?? "?"}\`**${comp}${dupSuffix}`
    );
    if (a.intentFlags && Object.keys(a.intentFlags).length > 0) {
      lines.push(`  - flags: ${JSON.stringify(a.intentFlags)}`);
    }
    if (a.innerText) {
      lines.push(
        `  - text: "${a.innerText.replace(/\s+/g, " ").trim().slice(0, 140)}"`
      );
    }
    if (a.relativeRect) {
      lines.push(`  - rect: ${JSON.stringify(a.relativeRect)}`);
    }
    if (a.boxModel) {
      lines.push(`  - boxModel: ${JSON.stringify(a.boxModel)}`);
    }
    if (a.computedStyles && Object.keys(a.computedStyles).length > 0) {
      const styles = propRegex
        ? Object.fromEntries(
            Object.entries(a.computedStyles).filter(
              ([k, v]) => propRegex.test(k) || propRegex.test(v)
            )
          )
        : a.computedStyles;
      lines.push(`  - computedStyles: ${JSON.stringify(styles)}`);
    }
    if (a.layoutContext && Object.keys(a.layoutContext).length > 0) {
      lines.push(`  - layoutContext: ${JSON.stringify(a.layoutContext)}`);
    }
  }

  if (cascade) {
    const sheets = cascade.sheets ?? [];
    const rules = cascade.rules ?? [];
    const elements = cascade.elements ?? [];
    const sheetsMap = new Map<string, CascadeSheetSource>();
    for (const s of sheets) sheetsMap.set(s.id, s);
    const rulesMap = new Map<string, CascadeRuleSource>();
    for (const r of rules) rulesMap.set(r.id, r);

    const matchedCascadeEls: Array<{ idx: number; el: CascadeElementRef }> = [];
    elements.forEach((el, idx) => {
      if (!selNeedle) {
        matchedCascadeEls.push({ idx, el });
        return;
      }
      const hay = `${idx} ${el.id} ${el.tagName} ${el.selector}`.toLowerCase();
      if (hay.includes(selNeedle)) {
        matchedCascadeEls.push({ idx, el });
      }
    });

    lines.push(
      `\n## Matched CSS Cascade Elements (${matchedCascadeEls.length} of ${elements.length})`
    );
    for (const { idx, el } of matchedCascadeEls.slice(0, 20)) {
      lines.push(
        `- **[${idx}] \`${el.id}\` \`<${el.tagName}>\` \`${el.selector}\`**`
      );
      const dedup = new Map<
        string,
        {
          rule: CascadeRuleSource;
          ruleIds: string[];
          sheetHrefs: Set<string>;
        }
      >();

      for (const rid of el.matchedRuleIds ?? []) {
        const r = rulesMap.get(rid);
        if (!r) continue;
        if (
          propRegex &&
          !propRegex.test(r.cssText) &&
          !propRegex.test(r.selectorText)
        ) {
          continue;
        }
        const sig = `${r.selectorText}||${r.cssText}`;
        const sheetObj = sheetsMap.get(r.sheetId);
        const sheetLabel = sheetObj?.href
          ? `${r.sheetId} (${sheetObj.href})`
          : `${r.sheetId} (inline <${sheetObj?.ownerNodeTag ?? "style"}>)`;
        const ex = dedup.get(sig);
        if (ex) {
          ex.ruleIds.push(rid);
          ex.sheetHrefs.add(sheetLabel);
        } else {
          dedup.set(sig, {
            rule: r,
            ruleIds: [rid],
            sheetHrefs: new Set([sheetLabel]),
          });
        }
      }

      if (dedup.size === 0) {
        lines.push(`  - (no matched rules for filter)`);
      } else {
        for (const item of dedup.values()) {
          const idsLabel = item.ruleIds.join(", ");
          const sheetsLabel = Array.from(item.sheetHrefs).join(" | ");
          lines.push(
            `  - **[${idsLabel}]** [sheet: ${sheetsLabel}] \`${item.rule.selectorText}\` -> \`${item.rule.cssText}\``
          );
        }
      }

      if (el.inheritedRules && el.inheritedRules.length > 0) {
        for (const inh of el.inheritedRules) {
          const inhStr = JSON.stringify(inh.inheritedProps ?? {});
          if (
            propRegex &&
            !propRegex.test(inhStr) &&
            !propRegex.test(inh.ancestorSelector)
          ) {
            continue;
          }
          const r = rulesMap.get(inh.ruleId);
          const sheetObj = r ? sheetsMap.get(r.sheetId) : undefined;
          const sheetRef = sheetObj?.href ?? r?.sheetId ?? "?";
          lines.push(
            `  - *[inherited from \`<${inh.ancestorTagName}> ${inh.ancestorSelector}\` via ${inh.ruleId} @ ${sheetRef}]*: ${inhStr}`
          );
        }
      }
    }
  }

  return lines;
}
