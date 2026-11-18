import { applyCharBudget } from "../format/budget.ts";
import { diffJsonValues, formatDiffValueInline } from "../format/json-diff.ts";
import { formatRelativeTime } from "../format/time.ts";
import { openPack } from "../pack/open.ts";
import type {
  FrameworkComponentNode,
  FrameworkStateEntry,
} from "../pack/types.ts";
import { evaluateJsonPath } from "../query/json-path.ts";

function resolveComponentName(c: FrameworkComponentNode): string {
  const rec = c as FrameworkComponentNode & { name?: string };
  return rec.componentName ?? rec.name ?? "Anonymous";
}

function collectComponentNodes(
  st: FrameworkStateEntry
): FrameworkComponentNode[] {
  const roots: FrameworkComponentNode[] = [];
  if (st.snapshot?.targetComponent) roots.push(st.snapshot.targetComponent);
  if (st.snapshot?.rootComponent) roots.push(st.snapshot.rootComponent);
  if (Array.isArray(st.snapshot?.parentChain)) {
    roots.push(...st.snapshot.parentChain);
  }
  if (roots.length === 0 && Array.isArray(st.components)) {
    roots.push(...st.components);
  }

  const expanded: FrameworkComponentNode[] = [];
  for (const node of roots) {
    expanded.push(node);
    const parents = (
      node as FrameworkComponentNode & {
        parentComponents?: FrameworkComponentNode[];
      }
    ).parentComponents;
    if (Array.isArray(parents)) {
      for (const p of parents) {
        if (p) expanded.push(p);
      }
    }
  }
  return expanded;
}

function reconstructStorageAt(
  states: readonly FrameworkStateEntry[],
  targetIdx: number
): {
  localStorage: Record<string, unknown>;
  sessionStorage: Record<string, unknown>;
} {
  const local: Record<string, unknown> = {};
  const session: Record<string, unknown> = {};

  const applyDelta = (
    target: Record<string, unknown>,
    delta: Record<string, unknown> | undefined
  ) => {
    if (!delta) return;
    for (const [k, v] of Object.entries(delta)) {
      if (v === null) {
        delete target[k];
      } else {
        target[k] = v;
      }
    }
  };

  for (let i = 0; i <= targetIdx && i < states.length; i += 1) {
    const st = states[i]!;
    if (st.webStorage) {
      for (const k of Object.keys(local)) delete local[k];
      for (const k of Object.keys(session)) delete session[k];
      Object.assign(local, st.webStorage.localStorage ?? {});
      Object.assign(session, st.webStorage.sessionStorage ?? {});
    } else if (st.webStorageDiff) {
      applyDelta(
        local,
        st.webStorageDiff.localStorageChanged ?? st.webStorageDiff.localStorage
      );
      applyDelta(
        session,
        st.webStorageDiff.sessionStorageChanged ??
          st.webStorageDiff.sessionStorage
      );
    }
  }
  return { localStorage: local, sessionStorage: session };
}

function componentKey(c: FrameworkComponentNode): string {
  return `${c.componentFile ?? ""}::${resolveComponentName(c)}`;
}

function normalizeComponentData(c: FrameworkComponentNode): {
  props?: Record<string, unknown>;
  state?: Record<string, unknown>;
} {
  return {
    ...(c.props ? { props: c.props } : {}),
    ...((c.state ?? c.data) ? { state: c.state ?? c.data } : {}),
  };
}

function computeFrameworkStateDiff(
  states: readonly FrameworkStateEntry[],
  fromIdx: number,
  toIdx: number,
  compFilter?: string
) {
  const fromState = states[fromIdx]!;
  const toState = states[toIdx]!;
  const filterFn = (c: FrameworkComponentNode) =>
    compFilter
      ? resolveComponentName(c).toLowerCase().includes(compFilter)
      : true;

  const fromNodes = collectComponentNodes(fromState).filter(filterFn);
  const toNodes = collectComponentNodes(toState).filter(filterFn);
  const fromMap = new Map<string, FrameworkComponentNode>();
  for (const n of fromNodes) {
    if (!fromMap.has(componentKey(n))) fromMap.set(componentKey(n), n);
  }
  const toMap = new Map<string, FrameworkComponentNode>();
  for (const n of toNodes) {
    if (!toMap.has(componentKey(n))) toMap.set(componentKey(n), n);
  }

  const componentDiffs: Array<{
    componentName: string;
    componentFile?: string;
    status: "added" | "removed" | "modified";
    changes: ReturnType<typeof diffJsonValues>["changes"];
  }> = [];

  for (const [key, rNode] of toMap.entries()) {
    const lNode = fromMap.get(key);
    if (!lNode) {
      componentDiffs.push({
        componentName: resolveComponentName(rNode),
        ...(rNode.componentFile ? { componentFile: rNode.componentFile } : {}),
        status: "added",
        changes: [],
      });
      continue;
    }
    const diff = diffJsonValues(
      normalizeComponentData(lNode),
      normalizeComponentData(rNode),
      { maxDiffs: 60 }
    );
    if (diff.totalChanges > 0) {
      componentDiffs.push({
        componentName: resolveComponentName(rNode),
        ...(rNode.componentFile ? { componentFile: rNode.componentFile } : {}),
        status: "modified",
        changes: diff.changes,
      });
    }
  }
  for (const [key, lNode] of fromMap.entries()) {
    if (!toMap.has(key)) {
      componentDiffs.push({
        componentName: resolveComponentName(lNode),
        ...(lNode.componentFile ? { componentFile: lNode.componentFile } : {}),
        status: "removed",
        changes: [],
      });
    }
  }

  const fromStorage = reconstructStorageAt(states, fromIdx);
  const toStorage = reconstructStorageAt(states, toIdx);
  const storageDiff = diffJsonValues(fromStorage, toStorage, { maxDiffs: 60 });

  return {
    fromIndex: fromIdx,
    toIndex: toIdx,
    componentDiffs,
    storageChanges: storageDiff.changes,
  };
}

function resolveStateStorage(st: FrameworkStateEntry): {
  isDiff: boolean;
  local?: Record<string, unknown>;
  session?: Record<string, unknown>;
} {
  if (st.webStorageDiff) {
    return {
      isDiff: true,
      local:
        st.webStorageDiff.localStorageChanged ?? st.webStorageDiff.localStorage,
      session:
        st.webStorageDiff.sessionStorageChanged ??
        st.webStorageDiff.sessionStorage,
    };
  }
  return {
    isDiff: false,
    local: st.webStorage?.localStorage,
    session: st.webStorage?.sessionStorage,
  };
}

export function runGetFrameworkStateTool(args: {
  pack?: string;
  index?: number;
  nearMs?: number;
  component?: string;
  path?: string;
  diff?: boolean;
  compareFrom?: number;
  compareTo?: number;
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
  } else if (selectedIndex === undefined && args.component) {
    const needle = args.component.toLowerCase();
    for (let i = states.length - 1; i >= 0; i -= 1) {
      const match = collectComponentNodes(states[i]!).some((c) =>
        resolveComponentName(c).toLowerCase().includes(needle)
      );
      if (match) {
        selectedIndex = i;
        break;
      }
    }
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

  if (
    args.diff ||
    args.compareFrom !== undefined ||
    args.compareTo !== undefined
  ) {
    const toIdx = args.compareTo ?? targetIdx;
    const fromIdx = args.compareFrom ?? (toIdx > 0 ? toIdx - 1 : 0);
    if (!states[fromIdx]) {
      throw new Error(
        `FRAMEWORK_STATE_NOT_FOUND: compareFrom index ${fromIdx} out of range (0..${states.length - 1})`
      );
    }
    if (!states[toIdx]) {
      throw new Error(
        `FRAMEWORK_STATE_NOT_FOUND: compareTo index ${toIdx} out of range (0..${states.length - 1})`
      );
    }
    const diffRes = computeFrameworkStateDiff(
      states,
      fromIdx,
      toIdx,
      compFilter
    );
    if (args.format === "json") {
      return applyCharBudget(
        JSON.stringify(
          {
            totalStates: states.length,
            fromRelativeMs: loaded.toRelativeMs(
              states[fromIdx]!.capturedAtEpochMs
            ),
            toRelativeMs: loaded.toRelativeMs(states[toIdx]!.capturedAtEpochMs),
            ...diffRes,
          },
          null,
          2
        ),
        args.maxChars
      );
    }
    const fromRel = formatRelativeTime(
      loaded.toRelativeMs(states[fromIdx]!.capturedAtEpochMs)
    );
    const toRel = formatRelativeTime(
      loaded.toRelativeMs(states[toIdx]!.capturedAtEpochMs)
    );
    const diffLines: string[] = [
      `# Framework State Diff ([${fromIdx}] ${fromRel} -> [${toIdx}] ${toRel})`,
      `- **Snapshots compared**: [${fromIdx}] (\`${states[fromIdx]!.trigger ?? "?"}\`) -> [${toIdx}] (\`${states[toIdx]!.trigger ?? "?"}\`)`,
      `\n## Component State Changes (${diffRes.componentDiffs.length})`,
    ];
    if (diffRes.componentDiffs.length === 0) {
      diffLines.push(
        "(No component props/state changes between these snapshots)"
      );
    } else {
      for (const cd of diffRes.componentDiffs) {
        const loc = cd.componentFile ? ` @ ${cd.componentFile}` : "";
        diffLines.push(`- **${cd.componentName}**${loc} [${cd.status}]`);
        for (const ch of cd.changes) {
          const lStr =
            ch.kind === "added" ? "—" : formatDiffValueInline(ch.left);
          const rStr =
            ch.kind === "removed" ? "—" : formatDiffValueInline(ch.right);
          diffLines.push(
            `  - \`${ch.path}\` (${ch.kind}): \`${lStr}\` -> \`${rStr}\``
          );
        }
      }
    }
    diffLines.push(
      `\n## WebStorage Changes (${diffRes.storageChanges.length})`
    );
    if (diffRes.storageChanges.length === 0) {
      diffLines.push("(No localStorage/sessionStorage changes)");
    } else {
      for (const ch of diffRes.storageChanges) {
        const lStr = ch.kind === "added" ? "—" : formatDiffValueInline(ch.left);
        const rStr =
          ch.kind === "removed" ? "—" : formatDiffValueInline(ch.right);
        diffLines.push(
          `- \`${ch.path}\` (${ch.kind}): \`${lStr}\` -> \`${rStr}\``
        );
      }
    }
    return applyCharBudget(diffLines.join("\n"), args.maxChars);
  }

  if (args.format === "json") {
    return applyCharBudget(
      JSON.stringify(
        {
          totalStates: states.length,
          overview: states.map((s, idx) => {
            const storage = resolveStateStorage(s);
            return {
              index: idx,
              relativeMs: loaded.toRelativeMs(s.capturedAtEpochMs),
              trigger: s.trigger,
              components: collectComponentNodes(s)
                .map((c) => resolveComponentName(c))
                .filter((n) => n !== "Anonymous"),
              localStorageKeys: Object.keys(storage.local ?? {}),
              sessionStorageKeys: Object.keys(storage.session ?? {}),
              hasWebStorageDiff: storage.isDiff,
            };
          }),
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
      .map((c) => resolveComponentName(c))
      .filter((n) => n !== "Anonymous");
    const storage = resolveStateStorage(st);
    const lsKeys = Object.keys(storage.local ?? {});
    const ssKeys = Object.keys(storage.session ?? {});
    const storageKind = storage.isDiff ? "diff" : "keys";
    const marker = idx === targetIdx ? " <-- [SELECTED]" : "";
    lines.push(
      `- **[${idx}]** ${formatRelativeTime(rel)} trigger=\`${st.trigger ?? "?"}\` | components=[${comps.slice(0, 5).join(", ") || "none"}] | localStorage(${storageKind})=${lsKeys.length} | sessionStorage(${storageKind})=${ssKeys.length}${marker}`
    );
  });

  const rel = loaded.toRelativeMs(targetState.capturedAtEpochMs);
  lines.push(
    `\n## Selected Snapshot [${targetIdx}] (at ${formatRelativeTime(rel)}, trigger=\`${targetState.trigger ?? "?"}\`)`
  );

  const compNodes = collectComponentNodes(targetState).filter((c) =>
    compFilter
      ? resolveComponentName(c).toLowerCase().includes(compFilter)
      : true
  );

  if (compNodes.length > 0) {
    lines.push(`\n### Component Tree / Chain (${compNodes.length})`);
    for (const c of compNodes) {
      const fileLoc = c.componentFile
        ? ` @ ${c.componentFile}${c.componentLine !== undefined ? `:${c.componentLine}` : ""}`
        : "";
      lines.push(
        `- **${resolveComponentName(c)}** (${c.framework ?? "framework"} v${c.version ?? "?"})${fileLoc}`
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

  if (targetState.webStorageDiff) {
    const storage = resolveStateStorage(targetState);
    lines.push(`\n### Web Storage Diff (delta vs previous state)`);
    if (storage.local && Object.keys(storage.local).length > 0) {
      lines.push(`#### localStorage diff`);
      lines.push(JSON.stringify(storage.local, null, 2));
    }
    if (storage.session && Object.keys(storage.session).length > 0) {
      lines.push(`#### sessionStorage diff`);
      lines.push(JSON.stringify(storage.session, null, 2));
    }
  }

  return applyCharBudget(lines.join("\n"), args.maxChars);
}
