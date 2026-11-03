export type JsonPathToken =
  | { kind: "prop"; key: string }
  | { kind: "index"; index: number }
  | { kind: "wildcard" }
  | { kind: "filter"; field: string; value: string };

/**
 * 解析轻量 JSONPath 表达式：
 * 支持：
 * - `a.b.c` / `$.a.b.c`
 * - `items[0].name`
 * - `items[*].id`
 * - `elements[id=ssd_a]` / `elements[id="ssd_a"]`
 */
export function parseJsonPath(expr: string): JsonPathToken[] {
  const trimmed = expr.trim().replace(/^\$\.?/, "");
  if (!trimmed) return [];

  const tokens: JsonPathToken[] = [];
  const segmentRegex = /([^.[\]]+)|\[([^\]]+)\]/g;
  let match: RegExpExecArray | null;

  while ((match = segmentRegex.exec(trimmed)) !== null) {
    if (match[1] !== undefined) {
      tokens.push({ kind: "prop", key: match[1] });
    } else if (match[2] !== undefined) {
      const inside = match[2].trim();
      if (inside === "*") {
        tokens.push({ kind: "wildcard" });
      } else if (/^-?\d+$/.test(inside)) {
        tokens.push({ kind: "index", index: Number.parseInt(inside, 10) });
      } else {
        const filterMatch =
          /^(?:\?\(\s*)?(?:@\.)?([a-zA-Z0-9_$-]+)\s*={1,3}\s*(.+?)(?:\s*\))?$/.exec(
            inside
          );
        if (filterMatch) {
          const field = filterMatch[1].trim();
          const rawVal = filterMatch[2].trim().replace(/^['"]|['"]$/g, "");
          tokens.push({ kind: "filter", field, value: rawVal });
        } else {
          const cleanKey = inside.replace(/^['"]|['"]$/g, "");
          tokens.push({ kind: "prop", key: cleanKey });
        }
      }
    }
  }
  return tokens;
}

export function evaluateJsonPath(root: unknown, expr: string): unknown {
  const tokens = parseJsonPath(expr);
  if (tokens.length === 0) return root;

  let current: unknown[] = [root];
  let usedMultiSelector = false;

  for (const token of tokens) {
    const next: unknown[] = [];
    for (const item of current) {
      if (item === null || item === undefined) continue;

      if (token.kind === "prop") {
        if (typeof item === "object" && !Array.isArray(item)) {
          const val = (item as Record<string, unknown>)[token.key];
          if (val !== undefined) next.push(val);
        }
      } else if (token.kind === "index") {
        if (Array.isArray(item)) {
          const idx = token.index < 0 ? item.length + token.index : token.index;
          if (idx >= 0 && idx < item.length) {
            next.push(item[idx]);
          }
        }
      } else if (token.kind === "wildcard") {
        usedMultiSelector = true;
        if (Array.isArray(item)) {
          next.push(...item);
        } else if (typeof item === "object") {
          next.push(...Object.values(item as Record<string, unknown>));
        }
      } else if (token.kind === "filter") {
        usedMultiSelector = true;
        if (Array.isArray(item)) {
          for (const elem of item) {
            if (elem && typeof elem === "object") {
              const fieldVal = (elem as Record<string, unknown>)[token.field];
              if (String(fieldVal) === token.value) {
                next.push(elem);
              }
            }
          }
        }
      }
    }
    current = next;
  }

  if (usedMultiSelector) return current;
  return current.length === 1 ? current[0] : current;
}
