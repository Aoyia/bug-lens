import type { LoadedSessionPack } from "./session-pack.ts";
import type { IssueSceneObject } from "./types.ts";

export interface ResolvedSceneExpectation {
  actual: string;
  expectedText: string;
  confidence: string;
  tags: string[];
  note?: string;
  confidenceNotice?: string;
}

/**
 * 统一解析异常现场的期望陈述：
 * 1. `expected.text` 存在 → 沿用其 `confidence`（"explicit" | "missing" 等）
 * 2. `expected.text` 缺失但 `narrative.note` 非空 → 将 `note` 兜底识别为 `note-fallback`，消除漏读
 * 3. 仅有 `tags` 无文本 → 标记 `tag-only` 并附提示，避免把症状标签误判为完整预期
 */
export function resolveSceneExpectation(
  narrative?: IssueSceneObject["narrative"]
): ResolvedSceneExpectation {
  const actual = narrative?.actual?.trim() ?? "";
  const rawExp = narrative?.expected;
  const note = narrative?.note?.trim() || undefined;
  const tags =
    typeof rawExp === "object" && rawExp !== null && Array.isArray(rawExp.tags)
      ? rawExp.tags.map((t) => String(t).trim()).filter(Boolean)
      : [];

  let expectedText =
    typeof rawExp === "string" ? rawExp.trim() : (rawExp?.text?.trim() ?? "");
  let confidence =
    typeof rawExp === "object" && rawExp !== null
      ? (rawExp.confidence ?? (expectedText ? "explicit" : "missing"))
      : expectedText
        ? "explicit"
        : "missing";

  if (!expectedText && note) {
    expectedText = note;
    confidence = "note-fallback";
  } else if (!expectedText && tags.length > 0 && confidence === "missing") {
    confidence = "tag-only";
  }

  let confidenceNotice: string | undefined;
  if (confidence === "tag-only") {
    confidenceNotice = `TAG_ONLY_EXPECTATION: User only selected symptom tag(s) [${tags.join(", ")}] without stating an explicit expected outcome. Treat any specific expected behavior as a hypothesis.`;
  } else if (confidence === "missing" || (!expectedText && tags.length === 0)) {
    confidenceNotice =
      "UNCAPTURED_EXPECTATION: User expectation was not captured. Any expectation you formulate MUST be explicitly declared as an inferred hypothesis.";
  }

  return {
    actual,
    expectedText,
    confidence,
    tags,
    ...(note ? { note } : {}),
    ...(confidenceNotice ? { confidenceNotice } : {}),
  };
}

export function getSessionUserNarrative(
  pack: LoadedSessionPack
):
  | { actual?: string; expected?: string; updatedAtEpochMs?: number }
  | undefined {
  const raw = pack.data.userNarrative ?? pack.data.session?.userNarrative;
  if (!raw) return undefined;
  const actual = raw.actual?.trim() || undefined;
  const expected = raw.expected?.trim() || undefined;
  if (!actual && !expected) return undefined;
  return {
    ...(actual ? { actual } : {}),
    ...(expected ? { expected } : {}),
    ...(raw.updatedAtEpochMs !== undefined
      ? { updatedAtEpochMs: raw.updatedAtEpochMs }
      : {}),
  };
}
