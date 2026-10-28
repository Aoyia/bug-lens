import { applyCharBudget } from "../format/budget.ts";
import { formatRelativeTime } from "../format/time.ts";
import { openPack } from "../pack/open.ts";
import type {
  FrameworkComponentNode,
  FrameworkStateEntry,
} from "../pack/types.ts";
import { evaluateJsonPath } from "../query/json-path.ts";

function collectComponentNodes(
  st: FrameworkStateEntry
): FrameworkComponentNode[] {
  const nodes: FrameworkComponentNode[] = [];
  if (st.snapshot?.targetComponent) nodes.push(st.snapshot.targetComponent);
  if (st.snapshot?.rootComponent) nodes.push(st.snapshot.rootComponent);
  if (Array.isArray(st.snapshot?.parentChain)) {
    nodes.push(...st.snapshot.parentChain);
  }
  if (Array.isArray(st.components)) {
    nodes.push(...st.components);
  }
  return nodes;
}

export function runGetFrameworkStateTool(args: {
  pack: string;
  index?: number;
  nearMs?: number;
  component?: string;
  path?: string;
  format?: "text" | "json";
  maxChars?: number;
}): string {
  const loaded = openPack(args.pack);
  if (loaded.kind === "screenshot") {
    const compList =
      loaded.environment?.frameworkComponentStates ??
      loaded.environment?.vueComponentStates ??
      [];
    const compFilter = args.component?.toLowerCase();
    const filtered = compFilter
      ? compList.filter((c) =>
          (c.componentName ?? "").toLowerCase().includes(compFilter)
        )
      : compList;
    if (args.path) {
      return applyCharBudget(
        JSON.stringify(evaluateJsonPath(filtered, args.path), null, 2),
        args.maxChars
      );
    }
    if (args.format === "json") {
      return applyCharBudget(
        JSON.stringify(
          { totalComponents: compList.length, components: filtered },
          null,
          2
        ),
        args.maxChars
      );
    }
    if (filtered.length === 0) {
      return "No framework component states recorded in this screenshot pack.";
    }
    const lines = [
      `# Screenshot Pack Component States (${filtered.length} of ${compList.length})`,
      ...filtered.map(
        (c) =>
          `- **${c.componentName ?? "Anonymous"}** (${c.framework ?? "vue/react"})${c.componentFile ? ` @ ${c.componentFile}:${c.componentLine ?? ""}` : ""}\n  - props: ${JSON.stringify(c.props ?? {})}\n  - data: ${JSON.stringify(c.data ?? c.state ?? {})}`
      ),
    ];
    return applyCharBudget(lines.join("\n"), args.maxChars);
  }

  const states = loaded.getFrameworkStates();
  if (states.length === 0) {
    return "No frameworkStates were captured in this session pack.";
  }

  let selectedIndex = args.index;
  if (selectedIndex === undefined && args.nearMs !== undefined) {
    let bestIdx = 0;
    let bestDist = Infinity;
    states.forEach((st, idx) => {
      const rel = loaded.toRelativeMs(st.capturedAtEpochMs) ?? 0;
      const dist = Math.abs(rel - args.nearMs!);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = idx;
      }
    });
    selectedIndex = bestIdx;
  }

  // 如果指定了 path 或 index，则针对单个快照深度输出
  const targetIdx = selectedIndex ?? states.length - 1;
  const targetState = states[targetIdx];
  if (!targetState) {
    throw new Error(
      `FRAMEWORK_STATE_NOT_FOUND: Index ${targetIdx} out of range (0..${states.length - 1})`
    );
  }

  if (args.path) {
    const extracted = evaluateJsonPath(targetState, args.path);
    return applyCharBudget(
      JSON.stringify(
        {
          stateIndex: targetIdx,
          relativeMs: loaded.toRelativeMs(targetState.capturedAtEpochMs),
          path: args.path,
          value: extracted,
        },
        null,
        2
      ),
      args.maxChars
    );
  }

  const compFilter = args.component?.toLowerCase();

  if (args.format === "json") {
    return applyCharBudget(
      JSON.stringify(
        {
          totalStates: states.length,
          overview: states.map((s, idx) => ({
            index: idx,
            relativeMs: loaded.toRelativeMs(s.capturedAtEpochMs),
            trigger: s.trigger,
            components: collectComponentNodes(s)
              .map((c) => c.componentName)
              .filter(Boolean),
            localStorageKeys: Object.keys(s.webStorage?.localStorage ?? {}),
            sessionStorageKeys: Object.keys(s.webStorage?.sessionStorage ?? {}),
          })),
          selectedIndex: targetIdx,
          selectedState: targetState,
        },
        null,
        2
      ),
      args.maxChars
    );
  }

  const lines: string[] = [];
  lines.push(`# Framework States (${states.length} snapshots in pack)`);
  lines.push(`\n## Snapshot Index Overview`);
  states.forEach((st, idx) => {
    const rel = loaded.toRelativeMs(st.capturedAtEpochMs);
    const comps = collectComponentNodes(st)
      .map((c) => c.componentName)
      .filter(Boolean);
    const lsKeys = Object.keys(st.webStorage?.localStorage ?? {});
    const ssKeys = Object.keys(st.webStorage?.sessionStorage ?? {});
    const marker = idx === targetIdx ? " <-- [SELECTED]" : "";
    lines.push(
      `- **[${idx}]** ${formatRelativeTime(rel)} trigger=\`${st.trigger ?? "?"}\` | components=[${comps.slice(0, 5).join(", ") || "none"}] | localStorageKeys=${lsKeys.length} | sessionStorageKeys=${ssKeys.length}${marker}`
    );
  });

  const rel = loaded.toRelativeMs(targetState.capturedAtEpochMs);
  lines.push(
    `\n## Selected Snapshot [${targetIdx}] (at ${formatRelativeTime(rel)}, trigger=\`${targetState.trigger ?? "?"}\`)`
  );

  const compNodes = collectComponentNodes(targetState).filter((c) =>
    compFilter
      ? (c.componentName ?? "").toLowerCase().includes(compFilter)
      : true
  );

  if (compNodes.length > 0) {
    lines.push(`\n### Component Tree / Chain (${compNodes.length})`);
    for (const c of compNodes) {
      lines.push(
        `- **${c.componentName ?? "Anonymous"}** (${c.framework ?? "framework"} v${c.version ?? "?"})`
      );
      if (c.props && Object.keys(c.props).length > 0) {
        lines.push(`  - props: ${JSON.stringify(c.props)}`);
      }
      const stData = c.state ?? c.data;
      if (stData && Object.keys(stData).length > 0) {
        lines.push(`  - state: ${JSON.stringify(stData)}`);
      }
    }
  } else {
    lines.push(
      `\n### Component Tree\n(No component tree recorded on snapshot [${targetIdx}])`
    );
  }

  if (
    targetState.globalState &&
    Object.keys(targetState.globalState).length > 0
  ) {
    lines.push(`\n### Global State`);
    lines.push(JSON.stringify(targetState.globalState, null, 2));
  }

  if (targetState.webStorage) {
    const ws = targetState.webStorage;
    lines.push(
      `\n### Web Storage (redactedValues: ${Boolean(ws.redactedValues)})`
    );
    if (ws.localStorage && Object.keys(ws.localStorage).length > 0) {
      lines.push(`#### localStorage`);
      lines.push(JSON.stringify(ws.localStorage, null, 2));
    }
    if (ws.sessionStorage && Object.keys(ws.sessionStorage).length > 0) {
      lines.push(`#### sessionStorage`);
      lines.push(JSON.stringify(ws.sessionStorage, null, 2));
    }
  }

  return applyCharBudget(lines.join("\n"), args.maxChars);
}
