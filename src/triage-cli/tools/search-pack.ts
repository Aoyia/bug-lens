import { applyCharBudget } from "../format/budget.ts";
import { openPack } from "../pack/open.ts";
import type { LoadedScreenshotPack } from "../pack/screenshot-pack.ts";
import type { CascadeRuleSource, CascadeSheetSource } from "../pack/types.ts";
import { searchSessionPack, type SearchScope } from "../query/search.ts";

function searchScreenshotPackStructured(
  pack: LoadedScreenshotPack,
  query: string,
  limit = 30,
  radius = 180
): {
  totalHits: number;
  hits: Array<{ category: string; ref: string; detail: string }>;
} {
  const needle = query.trim().toLowerCase();
  if (!needle) return { totalHits: 0, hits: [] };

  const hits: Array<{ category: string; ref: string; detail: string }> = [];

  // 1. Search DOM Anchors in dom-context.json
  const anchors = pack.domContext?.anchors ?? [];
  anchors.forEach((a, idx) => {
    const raw = JSON.stringify({
      selector: a.selector,
      selectorPath: a.selectorPath,
      componentName: a.componentName,
      componentFile: a.componentFile,
      innerText: a.innerText,
      computedStyles: a.computedStyles,
      layoutContext: a.layoutContext,
      intentFlags: a.intentFlags,
    });
    if (raw.toLowerCase().includes(needle)) {
      const comp = a.componentName
        ? ` [${a.componentName}${a.componentFile ? ` @ ${a.componentFile}:${a.componentLine ?? ""}` : ""}]`
        : "";
      const trunc = (
        (a.layoutContext as Record<string, unknown> | undefined)
          ?.textOverflow as Record<string, unknown> | undefined
      )?.reason;
      hits.push({
        category: "dom-anchor",
        ref: `anchor#${idx}`,
        detail: `\`${a.selectorPath ?? a.selector ?? "?"}\`${comp} text="${(a.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 80)}"${trunc ? ` | overflow: ${trunc}` : ""} | styles=${JSON.stringify(a.computedStyles ?? {})}`,
      });
    }
  });

  // 2. Search CSS Cascade Index in cascade.json
  if (pack.cascade) {
    const sheets = pack.cascade.sheets ?? [];
    const rules = pack.cascade.rules ?? [];
    const elements = pack.cascade.elements ?? [];
    const sheetsMap = new Map<string, CascadeSheetSource>();
    for (const s of sheets) sheetsMap.set(s.id, s);
    const rulesMap = new Map<string, CascadeRuleSource>();
    for (const r of rules) rulesMap.set(r.id, r);

    // 反向索引：ruleId -> matched element selectors
    const ruleToElements = new Map<string, string[]>();
    for (const el of elements) {
      const label = `${el.id}(${el.selector})`;
      for (const rid of el.matchedRuleIds ?? []) {
        const list = ruleToElements.get(rid);
        if (list) list.push(label);
        else ruleToElements.set(rid, [label]);
      }
    }

    for (const s of sheets) {
      if (
        s.id.toLowerCase() === needle ||
        (s.href && s.href.toLowerCase().includes(needle))
      ) {
        hits.push({
          category: "cascade-sheet",
          ref: s.id,
          detail: `href=${s.href ?? "inline"} (${s.rulesCount ?? 0} rules, tag=<${s.ownerNodeTag ?? "style"}>)`,
        });
      }
    }

    for (const [idx, el] of elements.entries()) {
      if (
        el.id.toLowerCase() === needle ||
        el.selector.toLowerCase().includes(needle)
      ) {
        const sampleRules = (el.matchedRuleIds ?? [])
          .slice(-6)
          .map((rid) => {
            const r = rulesMap.get(rid);
            return r ? `${rid}:${r.selectorText}` : rid;
          })
          .join(", ");
        hits.push({
          category: "cascade-element",
          ref: `${el.id} (index ${idx})`,
          detail: `<${el.tagName}> \`${el.selector}\` (${(el.matchedRuleIds ?? []).length} matched rules, e.g. [${sampleRules}])`,
        });
      }
    }

    // 合并相同 selectorText + cssText 的命中规则
    const matchedRuleGroups = new Map<
      string,
      {
        rule: CascadeRuleSource;
        ruleIds: string[];
        sheetRefs: Set<string>;
        matchedElements: Set<string>;
      }
    >();

    for (const r of rules) {
      if (
        r.id.toLowerCase() === needle ||
        r.selectorText.toLowerCase().includes(needle) ||
        r.cssText.toLowerCase().includes(needle)
      ) {
        const sig = `${r.selectorText}||${r.cssText}`;
        const sheetObj = sheetsMap.get(r.sheetId);
        const sheetLabel = sheetObj?.href
          ? `${r.sheetId} (${sheetObj.href})`
          : `${r.sheetId} (inline)`;
        const els = ruleToElements.get(r.id) ?? [];
        const ex = matchedRuleGroups.get(sig);
        if (ex) {
          ex.ruleIds.push(r.id);
          ex.sheetRefs.add(sheetLabel);
          for (const e of els) ex.matchedElements.add(e);
        } else {
          matchedRuleGroups.set(sig, {
            rule: r,
            ruleIds: [r.id],
            sheetRefs: new Set([sheetLabel]),
            matchedElements: new Set(els),
          });
        }
      }
    }

    for (const g of matchedRuleGroups.values()) {
      const idsStr =
        g.ruleIds.length > 3
          ? `${g.ruleIds.slice(0, 3).join(", ")} (+${g.ruleIds.length - 3})`
          : g.ruleIds.join(", ");
      const sheetsStr = Array.from(g.sheetRefs).slice(0, 2).join(" | ");
      const elsArr = Array.from(g.matchedElements);
      const elsStr =
        elsArr.length > 0
          ? ` | matchedElements: [${elsArr.slice(0, 5).join(", ")}${elsArr.length > 5 ? ", ..." : ""}]`
          : "";
      hits.push({
        category: "cascade-rule",
        ref: idsStr,
        detail: `[sheet: ${sheetsStr}] \`${g.rule.selectorText}\` -> \`${g.rule.cssText}\`${elsStr}`,
      });
    }
  }

  // 3. Search Component States & Environment in environment.json
  const compStates =
    pack.environment?.frameworkComponentStates ??
    pack.environment?.vueComponentStates ??
    [];
  compStates.forEach((c, idx) => {
    const raw = JSON.stringify(c);
    if (raw.toLowerCase().includes(needle)) {
      hits.push({
        category: "component-state",
        ref: `${c.componentName ?? "Component"}#${idx}`,
        detail: `${c.componentFile ? `@ ${c.componentFile}:${c.componentLine ?? ""} ` : ""}props=${JSON.stringify(c.props ?? {})} data=${JSON.stringify(c.data ?? c.state ?? {})}`,
      });
    }
  });

  // 4. Fallback raw text snippet search if no structured hits found
  if (hits.length === 0) {
    for (const fileInfo of pack.listFiles()) {
      if (fileInfo.path.endsWith(".json") || fileInfo.path.endsWith(".md")) {
        const text = pack.getTextFile(fileInfo.path) ?? "";
        const idx = text.toLowerCase().indexOf(needle);
        if (idx >= 0) {
          const start = Math.max(0, idx - radius);
          const end = Math.min(text.length, idx + needle.length + radius);
          hits.push({
            category: "file",
            ref: fileInfo.path,
            detail: text.slice(start, end).replace(/\s+/g, " ").trim(),
          });
        }
      }
    }
  }

  return {
    totalHits: hits.length,
    hits: hits.slice(0, limit),
  };
}

export function runSearchPackTool(args: {
  pack?: string;
  query: string;
  scopes?: SearchScope[];
  limit?: number;
  contextChars?: number;
  format?: "text" | "json";
  maxChars?: number;
}): string {
  const loaded = openPack(args.pack);
  const radius = Math.min(2000, Math.max(40, args.contextChars ?? 180));

  if (loaded.kind === "screenshot") {
    const res = searchScreenshotPackStructured(
      loaded,
      args.query,
      args.limit ?? 30,
      radius
    );
    if (args.format === "json") {
      return applyCharBudget(
        JSON.stringify(
          { query: args.query, totalHits: res.totalHits, hits: res.hits },
          null,
          2
        ),
        args.maxChars
      );
    }
    const lines = [
      `# Search Results in Screenshot Pack for "${args.query}" (showing ${res.hits.length} of ${res.totalHits} total hits)`,
      ...(res.hits.length === 0
        ? [
            `(No matches found in dom-context.json, cascade.json, or environment.json)`,
          ]
        : res.hits.map(
            (h) => `- **[${h.category}]** \`${h.ref}\` — ${h.detail}`
          )),
    ];
    return applyCharBudget(lines.join("\n"), args.maxChars);
  }

  const res = searchSessionPack(loaded, {
    query: args.query,
    scopes: args.scopes,
    limit: args.limit,
    contextChars: args.contextChars,
  });

  if (args.format === "json") {
    return applyCharBudget(JSON.stringify(res, null, 2), args.maxChars);
  }

  const lines: string[] = [];
  lines.push(
    `# Search Hits for "${res.query}" (showing ${res.hits.length} of ${res.totalHits} total hits)`
  );
  if (res.hits.length === 0) {
    lines.push(`(No matches found across requested scopes)`);
  } else {
    for (const hit of res.hits) {
      lines.push(`- **[${hit.scope}]** \`${hit.ref}\` — ${hit.snippet}`);
    }
  }
  return applyCharBudget(lines.join("\n"), args.maxChars);
}
