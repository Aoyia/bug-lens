export type JsonDiffKind = "added" | "removed" | "changed";

export interface JsonDiffEntry {
  path: string;
  kind: JsonDiffKind;
  left?: unknown;
  right?: unknown;
}

export interface JsonDiffResult {
  changes: JsonDiffEntry[];
  totalChanges: number;
  truncated: boolean;
}

const ARRAY_MATCH_KEYS = ["id", "key", "name", "fieldKey", "code"] as const;

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

/** 识别对象数组中唯一性足够高的主键字段，避免增删一项后引发全列表错位 Diff。 */
function detectArrayIdentityKey(
  leftArr: unknown[],
  rightArr: unknown[]
): string | undefined {
  const combined = [...leftArr, ...rightArr];
  if (combined.length === 0 || !combined.every((x) => isPlainObject(x))) {
    return undefined;
  }
  const hasUniqueKeys = (arr: unknown[], key: string): boolean => {
    const seen = new Set<string>();
    for (const item of arr) {
      const val = (item as Record<string, unknown>)[key];
      if (typeof val !== "string" && typeof val !== "number") return false;
      const str = String(val);
      if (!str || seen.has(str)) return false;
      seen.add(str);
    }
    return true;
  };
  for (const key of ARRAY_MATCH_KEYS) {
    if (hasUniqueKeys(leftArr, key) && hasUniqueKeys(rightArr, key)) {
      return key;
    }
  }
  return undefined;
}

function escapePathSegment(key: string): string {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key)
    ? `.${key}`
    : `[${JSON.stringify(key)}]`;
}

export function diffJsonValues(
  left: unknown,
  right: unknown,
  options: {
    ignoreKeys?: ReadonlySet<string>;
    maxDiffs?: number;
  } = {}
): JsonDiffResult {
  const ignoreKeys = options.ignoreKeys ?? new Set<string>();
  const maxDiffs = Math.max(1, options.maxDiffs ?? 80);
  const changes: JsonDiffEntry[] = [];
  let totalChanges = 0;

  const pushChange = (entry: JsonDiffEntry) => {
    totalChanges += 1;
    if (changes.length < maxDiffs) {
      changes.push(entry);
    }
  };

  const walk = (a: unknown, b: unknown, path: string): void => {
    if (Object.is(a, b)) return;

    if (Array.isArray(a) && Array.isArray(b)) {
      const idKey = detectArrayIdentityKey(a, b);
      if (idKey) {
        const rightByKey = new Map<string, Record<string, unknown>>();
        for (const item of b as Array<Record<string, unknown>>) {
          rightByKey.set(String(item[idKey]), item);
        }
        const seenKeys = new Set<string>();
        for (const lItem of a as Array<Record<string, unknown>>) {
          const kVal = String(lItem[idKey]);
          seenKeys.add(kVal);
          const itemPath = `${path}[${idKey}=${JSON.stringify(kVal)}]`;
          if (!rightByKey.has(kVal)) {
            pushChange({ path: itemPath, kind: "removed", left: lItem });
          } else {
            walk(lItem, rightByKey.get(kVal), itemPath);
          }
        }
        for (const rItem of b as Array<Record<string, unknown>>) {
          const kVal = String(rItem[idKey]);
          if (!seenKeys.has(kVal)) {
            pushChange({
              path: `${path}[${idKey}=${JSON.stringify(kVal)}]`,
              kind: "added",
              right: rItem,
            });
          }
        }
        return;
      }

      const maxLen = Math.max(a.length, b.length);
      for (let i = 0; i < maxLen; i += 1) {
        const itemPath = `${path}[${i}]`;
        if (i >= a.length) {
          pushChange({ path: itemPath, kind: "added", right: b[i] });
        } else if (i >= b.length) {
          pushChange({ path: itemPath, kind: "removed", left: a[i] });
        } else {
          walk(a[i], b[i], itemPath);
        }
      }
      return;
    }

    if (isPlainObject(a) && isPlainObject(b)) {
      const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
      for (const k of allKeys) {
        if (ignoreKeys.has(k)) continue;
        const childPath = path ? `${path}${escapePathSegment(k)}` : k;
        const inA =
          Object.prototype.hasOwnProperty.call(a, k) && a[k] !== undefined;
        const inB =
          Object.prototype.hasOwnProperty.call(b, k) && b[k] !== undefined;
        if (inA && !inB) {
          pushChange({ path: childPath, kind: "removed", left: a[k] });
        } else if (!inA && inB) {
          pushChange({ path: childPath, kind: "added", right: b[k] });
        } else if (inA && inB) {
          walk(a[k], b[k], childPath);
        }
      }
      return;
    }

    pushChange({
      path: path || "$",
      kind: "changed",
      left: a,
      right: b,
    });
  };

  walk(left, right, "");
  return {
    changes,
    totalChanges,
    truncated: totalChanges > changes.length,
  };
}

export function formatDiffValueInline(value: unknown, maxLen = 140): string {
  let raw: string;
  if (typeof value === "string") {
    raw = JSON.stringify(value);
  } else {
    try {
      raw = JSON.stringify(value);
    } catch {
      raw = String(value);
    }
  }
  if (raw === undefined) return "undefined";
  return raw.length > maxLen ? `${raw.slice(0, maxLen - 1)}…` : raw;
}

export interface TextLineDiffHunk {
  lineNumberLeft?: number;
  lineNumberRight?: number;
  kind: "removed" | "added";
  text: string;
}

export function diffTextLines(
  leftText: string,
  rightText: string,
  maxHunks = 80
): { hunks: TextLineDiffHunk[]; totalHunks: number; truncated: boolean } {
  const leftLines = leftText.split(/\r?\n/);
  const rightLines = rightText.split(/\r?\n/);
  const hunks: TextLineDiffHunk[] = [];
  let totalHunks = 0;

  let i = 0;
  let j = 0;
  while (i < leftLines.length || j < rightLines.length) {
    if (
      i < leftLines.length &&
      j < rightLines.length &&
      leftLines[i] === rightLines[j]
    ) {
      i += 1;
      j += 1;
      continue;
    }
    // 向前寻找最近公共行以对齐局部插入/删除
    let matchedLeft = -1;
    let matchedRight = -1;
    const lookahead = 20;
    outer: for (let d = 1; d <= lookahead; d += 1) {
      for (let li = 0; li <= d; li += 1) {
        const ri = d - li;
        if (
          i + li < leftLines.length &&
          j + ri < rightLines.length &&
          leftLines[i + li] === rightLines[j + ri]
        ) {
          matchedLeft = i + li;
          matchedRight = j + ri;
          break outer;
        }
      }
    }
    const endI = matchedLeft !== -1 ? matchedLeft : leftLines.length;
    const endJ = matchedRight !== -1 ? matchedRight : rightLines.length;
    for (; i < endI; i += 1) {
      totalHunks += 1;
      if (hunks.length < maxHunks) {
        hunks.push({
          lineNumberLeft: i + 1,
          kind: "removed",
          text: leftLines[i]!,
        });
      }
    }
    for (; j < endJ; j += 1) {
      totalHunks += 1;
      if (hunks.length < maxHunks) {
        hunks.push({
          lineNumberRight: j + 1,
          kind: "added",
          text: rightLines[j]!,
        });
      }
    }
  }

  return { hunks, totalHunks, truncated: totalHunks > hunks.length };
}

/** 生成超长 JSON 的紧凑结构大纲，并推导真实可用的 jsonPath 示例。 */
export function buildJsonOutline(
  value: unknown,
  options: { maxDepth?: number; maxKeysPerLevel?: number } = {}
): { outline: unknown; suggestedJsonPaths: string[] } {
  const maxDepth = options.maxDepth ?? 3;
  const maxKeys = options.maxKeysPerLevel ?? 16;
  const suggestedJsonPaths: string[] = [];

  const summarize = (
    node: unknown,
    depth: number,
    pathPrefix: string
  ): unknown => {
    if (node === null || node === undefined) return node;
    if (typeof node !== "object") {
      if (typeof node === "string") {
        return node.length > 60 ? `string(${node.length})` : node;
      }
      return node;
    }
    if (Array.isArray(node)) {
      if (node.length === 0) return "Array[0]";
      if (depth >= maxDepth) return `Array[${node.length}]`;
      const sample = summarize(node[0], depth + 1, `${pathPrefix}[0]`);
      return { _type: `Array[${node.length}]`, sample0: sample };
    }
    const entries = Object.entries(node as Record<string, unknown>);
    if (depth >= maxDepth) {
      return `Object{${entries.length} keys: ${entries
        .slice(0, 6)
        .map(([k]) => k)
        .join(", ")}${entries.length > 6 ? ", …" : ""}}`;
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries.slice(0, maxKeys)) {
      const childPath = pathPrefix ? `${pathPrefix}.${k}` : k;
      if (
        suggestedJsonPaths.length < 4 &&
        depth <= 1 &&
        v !== null &&
        typeof v === "object"
      ) {
        suggestedJsonPaths.push(childPath);
      }
      out[k] = summarize(v, depth + 1, childPath);
    }
    if (entries.length > maxKeys) {
      out.__moreKeys = `+${entries.length - maxKeys} keys omitted`;
    }
    return out;
  };

  return {
    outline: summarize(value, 0, ""),
    suggestedJsonPaths,
  };
}
