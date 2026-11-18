import type { ExpectedStatement } from "../shared/protocol.ts";

/**
 * 由用户预期陈述（`IssueScene.narrative.expected`）派生的可执行断言。
 *
 * 设计约束：
 * - 纯本地规则匹配，无 AI / 网络调用，确定性可复现；
 * - `code` 为单行 TypeScript（Playwright 断言），不含缩进，调用方负责缩进；
 * - 只派生「可判定」的断言，规则覆盖不到的句式一律不猜。
 */
export interface DerivedAssertion {
  /** 单行 TS 断言代码，不含缩进；为提示性结果时为空字符串 */
  code: string;
  /** high：定位信息充分；low：缺少选择器或 URL，只能弱断言/给提示 */
  confidence: "high" | "low";
  /** 为什么这么派生（给人和 AI 看） */
  rationale: string;
}

export interface AssertionContext {
  /** 异常现场主目标的选择器（CSS），用于隐藏/文案变更/清空类断言 */
  targetSelector?: string;
  /** 异常发生页面 URL，仅用于补充说明，不参与匹配 */
  pageUrl?: string;
}

const MAX_ASSERTIONS = 3;

/** 引号包裹的实体，优先「」『』“”再退到 ASCII 引号 */
const QUOTE_PATTERNS: RegExp[] = [
  /「([^」\n]{1,120})」/,
  /『([^』\n]{1,120})』/,
  /“([^”\n]{1,120})”/,
  /"([^"\n]{1,120})"/,
  /'([^'\n]{1,120})'/,
];

const URL_RE = /https?:\/\/[^\s"'），。；、]+/i;
const PATH_RE = /(?:^|[\s到至（(])(\/[^\s"'），。；、]+)/;

const NAV_VERB_RE =
  /(?:跳转到|跳转至|跳到|进入|来到|打开|导航到|navigate[sd]?\s+to|redirect(?:s|ed)?\s+to|go(?:es)?\s+to|land(?:s|ed)?\s+on|open(?:s|ed)?)/i;
const NAV_PAGE_HINT_RE = /(?:页|页面|page|url|route|地址)/i;

const HIDE_RE =
  /(?:不显示|不出现|看不到|消失|关闭|隐藏|不再出现|should\s+not\s+(?:show|display|appear|be\s+visible)|not\s+be\s+visible|disappear(?:s|ed)?|hidden|closes?)/i;
const CHANGE_RE =
  /(?:变成|变为|改为|更新为|becomes?|changed?\s+to|updated?\s+to|turns?\s+into)/i;
const EMPTY_RE = /(?:清空|为空|空值|empty|cleared|blank)/i;
const ERROR_RE =
  /(?:报错|错误提示|提示错误|发生错误|异常提示|crash(?:es|ed)?|error|exception)/i;
const SHOW_RE =
  /(?:显示|出现|弹出|提示|展示|should\s+show|should\s+display|display(?:s|ed)?|show(?:s|n)?|appear(?:s|ed)?|visible|pop(?:s|ped)?\s*up|toast)/i;
/** 无具体对象的泛化结果词（成功/失败/正常）——无法定位，不派生断言 */
const GENERIC_RESULT_RE =
  /(?:成功|失败|正常|success(?:ful(?:ly)?)?|fail(?:s|ed|ure)?|works?\s+(?:fine|normally)|normally)/i;

/** 单引号字符串字面量转义：反斜杠、单引号、换行 */
function quoteString(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\r?\n/g, "\\n");
  return `'${escaped}'`;
}

/** 正则字面量转义：所有正则元字符与分隔符 `/` */
function regexLiteral(value: string): string {
  const escaped = value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return `/${escaped}/`;
}

/** 归一化抽出的实体：压空白、去前导助词/冠词、去尾部标点 */
function normalizeEntity(raw: string): string {
  let value = raw.replace(/\s+/g, " ").trim();
  value = value.replace(/^[\s，,、:：\-—]+/, "");
  for (let i = 0; i < 2; i += 1) {
    value = value.replace(
      /^(?:到|至|了|的|应|应该|将会|会|是|在|向|the|a|an|to|be|is|into|on)\s*/i,
      ""
    );
  }
  value = value.replace(/[\s。，,.;；:：!！?？]+$/, "");
  return value.trim();
}

function extractUrlEntity(clause: string): string | undefined {
  const full = URL_RE.exec(clause);
  if (full?.[0]) return full[0];
  const path = PATH_RE.exec(clause);
  if (path?.[1]) return path[1];
  return undefined;
}

/**
 * 抽取文本实体：引号包裹优先；其次取谓语之后的剩余文本；最后退到整句模糊匹配。
 */
function extractTextEntity(
  clause: string,
  afterIndex?: number
): string | undefined {
  for (const pattern of QUOTE_PATTERNS) {
    const match = pattern.exec(clause);
    if (match?.[1]) {
      const value = normalizeEntity(match[1]);
      if (value) return value;
    }
  }
  if (afterIndex !== undefined) {
    const tail = normalizeEntity(clause.slice(afterIndex));
    if (tail) return tail;
  }
  const whole = normalizeEntity(clause);
  return whole || undefined;
}

function visibleByText(entity: string): string {
  return `await expect(page.getByText(${quoteString(entity)})).toBeVisible();`;
}

function hiddenByText(entity: string): string {
  return `await expect(page.getByText(${quoteString(entity)})).toBeHidden();`;
}

function deriveForClause(
  clause: string,
  ctx: AssertionContext,
  selector: string | undefined
): DerivedAssertion | undefined {
  // 1. 跳转 / 导航
  const nav = NAV_VERB_RE.exec(clause);
  if (nav) {
    const url = extractUrlEntity(clause);
    if (url) {
      const originNote = ctx.pageUrl ? `（相对当前页面 ${ctx.pageUrl}）` : "";
      return {
        code: `await expect(page).toHaveURL(${regexLiteral(url)});`,
        confidence: "high",
        rationale: `预期跳转到 ${url}，用 toHaveURL 校验地址栏${originNote}`,
      };
    }
    const entity = extractTextEntity(clause, nav.index + nav[0].length);
    if (entity && NAV_PAGE_HINT_RE.test(clause)) {
      return {
        code: visibleByText(entity),
        confidence: "low",
        rationale: `预期进入「${entity}」，但未给出 URL 片段，降级为页面文本可见性断言`,
      };
    }
    // 「打开弹窗」这类非导航语义，继续交给后续规则
  }

  // 2. 隐藏 / 消失
  const hide = HIDE_RE.exec(clause);
  if (hide) {
    if (selector) {
      return {
        code: `await expect(page.locator(${quoteString(selector)})).toBeHidden();`,
        confidence: "high",
        rationale: `预期目标元素隐藏/消失，用 toBeHidden 校验 ${selector}`,
      };
    }
    const entity =
      extractTextEntity(clause, hide.index + hide[0].length) ??
      normalizeEntity(clause);
    if (entity) {
      return {
        code: hiddenByText(entity),
        confidence: "low",
        rationale: `预期「${entity}」隐藏/消失，但缺少目标选择器，降级为文本隐藏断言`,
      };
    }
    return undefined;
  }

  // 3. 文案变更
  const change = CHANGE_RE.exec(clause);
  if (change) {
    const entity = extractTextEntity(clause, change.index + change[0].length);
    if (!entity) return undefined;
    if (selector) {
      return {
        code: `await expect(page.locator(${quoteString(selector)})).toHaveText(${regexLiteral(entity)});`,
        confidence: "high",
        rationale: `预期 ${selector} 的文案变为「${entity}」，用 toHaveText 校验`,
      };
    }
    return {
      code: visibleByText(entity),
      confidence: "low",
      rationale: `预期文案变为「${entity}」，但缺少目标选择器，降级为文本可见性断言`,
    };
  }

  // 4. 清空 / 为空
  const empty = EMPTY_RE.exec(clause);
  if (empty) {
    if (!selector) return undefined;
    return {
      code: `await expect(page.locator(${quoteString(selector)})).toHaveValue('');`,
      confidence: "high",
      rationale: `预期 ${selector} 被清空，用 toHaveValue('') 校验`,
    };
  }

  // 5. 报错 / 错误提示
  const error = ERROR_RE.exec(clause);
  if (error) {
    const entity = extractTextEntity(clause, error.index + error[0].length);
    if (!entity) return undefined;
    return {
      code: visibleByText(entity),
      confidence: "high",
      rationale: `预期出现错误提示「${entity}」，用文本可见性校验`,
    };
  }

  // 6. 显示 / 出现 / 弹出
  const show = SHOW_RE.exec(clause);
  if (show) {
    const entity = extractTextEntity(clause, show.index + show[0].length);
    if (!entity) return undefined;
    return {
      code: visibleByText(entity),
      confidence: "high",
      rationale: `预期出现「${entity}」，用文本可见性校验`,
    };
  }

  // 7. 泛化结果词（成功/失败/正常）无具体对象 → 无法定位
  if (GENERIC_RESULT_RE.test(clause)) return undefined;

  return undefined;
}

/**
 * 从预期陈述派生 Playwright 断言（最多 3 条，按置信度排序）。
 *
 * - `undefined` / `confidence: "missing"` / 空 text → `[]`
 * - `confidence: "tag-only"` → 一条 `code: ""` 的 low 提示
 */
export function deriveAssertions(
  expected: ExpectedStatement | undefined,
  ctx: AssertionContext = {}
): DerivedAssertion[] {
  if (!expected) return [];

  const tags = (expected.tags ?? [])
    .map((tag) => String(tag).trim())
    .filter(Boolean);

  if (expected.confidence === "tag-only") {
    return [
      {
        code: "",
        confidence: "low",
        rationale: `仅有症状标签（${tags.join("、") || "无"}），无明确预期结果，请人工补充断言`,
      },
    ];
  }

  if (expected.confidence === "missing") return [];

  const text = (expected.text ?? "").trim();
  if (!text) {
    // 与 resolveSceneExpectation 一致：只有标签、没有显式文本时视为 tag-only
    if (tags.length > 0) {
      return [
        {
          code: "",
          confidence: "low",
          rationale: `仅有症状标签（${tags.join("、")}），无明确预期结果，请人工补充断言`,
        },
      ];
    }
    return [];
  }

  const selector = ctx.targetSelector?.trim() || undefined;
  const clauses = text
    .split(/[。；;\n]+/)
    .map((clause) => clause.trim())
    .filter(Boolean);

  const results: DerivedAssertion[] = [];
  for (const clause of clauses) {
    const assertion = deriveForClause(clause, ctx, selector);
    if (!assertion) continue;
    if (results.some((item) => item.code === assertion.code)) continue;
    results.push(assertion);
    if (results.length >= MAX_ASSERTIONS) break;
  }

  return results
    .sort((a, b) => {
      if (a.confidence === b.confidence) return 0;
      return a.confidence === "high" ? -1 : 1;
    })
    .slice(0, MAX_ASSERTIONS);
}
