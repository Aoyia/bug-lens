import type {
  ExpectedStatement,
  IssueScene,
  TicketDraft,
} from "../shared/protocol.ts";
import { isEn, t } from "../shared/i18n.ts";

export type TicketAudience = "internal" | "customer";

export type TicketQuestionId =
  "symptom" | "impact" | "isBug" | "workaround" | "eta";

export type TicketQuestionSource = "auto" | "derived" | "user";

export type TicketQuestion = {
  id: TicketQuestionId;
  /** 1-based 固定顺序，五问顺序不可变 */
  order: number;
  title: string;
  value: string;
  source: TicketQuestionSource;
  editable: boolean;
  placeholder: string;
  /** 仅 isBug 使用：自动推导依据 */
  reason?: string;
};

export type TicketQuestionOverrides = Partial<Record<TicketQuestionId, string>>;

export type IsBugVerdict = "defect" | "suspected" | "unknown";

export type IsBugResult = {
  verdict: IsBugVerdict;
  reason: string;
};

const ETA_PLACEHOLDER = "<待研发确认>";

const QUESTION_IDS: TicketQuestionId[] = [
  "symptom",
  "impact",
  "isBug",
  "workaround",
  "eta",
];

/**
 * 把用户当场编辑的 override 收敛为可持久化的工单草稿。
 * 只保留实际编辑过的字段，避免把自动草稿冻结进草稿。
 */
export function buildTicketDraft(
  overrides: TicketQuestionOverrides,
  now = Date.now()
): TicketDraft {
  const draft: TicketDraft = {};
  for (const id of QUESTION_IDS) {
    if (overrides[id] !== undefined) draft[id] = String(overrides[id]);
  }
  draft.updatedAtEpochMs = now;
  return draft;
}

function oneLine(value: unknown): string {
  return String(value ?? "")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

function snippet(value: string, max = 80): string {
  const text = oneLine(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * 由「期望陈述 + 实际现象」确定性推导是否缺陷。
 * explicit → defect；仅症状标签 → suspected；缺失 → unknown。
 */
export function deriveIsBug(
  expected: ExpectedStatement | undefined,
  actual: string
): IsBugResult {
  const en = isEn();
  const actualSnippet = snippet(actual);
  const text = oneLine(expected?.text);

  if (expected && expected.confidence === "explicit" && text) {
    return {
      verdict: "defect",
      reason: en
        ? `User explicitly stated the expected result "${snippet(text)}", which conflicts with the observed behaviour${
            actualSnippet ? ` "${actualSnippet}"` : ""
          }.`
        : `用户已明确说明期望结果「${snippet(text)}」，与实际现象${
            actualSnippet ? `「${actualSnippet}」` : ""
          }不一致。`,
    };
  }

  if (expected && expected.confidence === "tag-only") {
    const tags = (expected.tags ?? []).map(oneLine).filter(Boolean);
    return {
      verdict: "suspected",
      reason: en
        ? `Only symptom tags${tags.length ? ` (${tags.join(", ")})` : ""} were provided; the expected result is unstated, so human confirmation is required.`
        : `仅记录了症状标签${tags.length ? `（${tags.join("、")}）` : ""}，未说明期望结果，需人工确认是否属于缺陷。`,
    };
  }

  return {
    verdict: "unknown",
    reason: en
      ? "No clear expected result was captured; this cannot be determined automatically and needs human confirmation."
      : "未捕获明确的期望结果，无法自动判定，需人工确认。",
  };
}

function verdictLabel(verdict: IsBugVerdict): string {
  const en = isEn();
  switch (verdict) {
    case "defect":
      return en ? "Defect" : "是缺陷";
    case "suspected":
      return en ? "Suspected, needs confirmation" : "疑似，待确认";
    default:
      return en ? "To be confirmed" : "待确认";
  }
}

export function verdictForCustomer(verdict: IsBugVerdict): string {
  const en = isEn();
  switch (verdict) {
    case "defect":
      return en ? "Confirmed defect" : "已确认是缺陷";
    case "suspected":
      return en ? "Suspected issue, pending confirmation" : "疑似问题，待确认";
    default:
      return en ? "Pending confirmation" : "待确认";
  }
}

export function buildTicketQuestions(
  scene: IssueScene | undefined,
  overrides: TicketQuestionOverrides = {}
): TicketQuestion[] {
  const en = isEn();
  const actual = scene?.narrative?.actual ?? "";
  const derived = deriveIsBug(scene?.narrative?.expected, actual);
  const draft = scene?.ticketDraft;

  // 优先级：当场编辑 > 已持久化的工单草稿 > 自动草稿/工具推导
  const pick = (id: TicketQuestionId, fallback: string): string => {
    if (overrides[id] !== undefined) return String(overrides[id]);
    const stored = draft?.[id];
    if (stored !== undefined) return String(stored);
    return fallback;
  };

  return [
    {
      id: "symptom",
      order: 1,
      title: en ? "What happens (plain language)" : "什么现象（不带术语）",
      value: pick("symptom", actual.trim()),
      source: "auto",
      editable: true,
      placeholder: en
        ? "Describe what the user sees in business language"
        : "请用业务语言描述用户看到的现象",
    },
    {
      id: "impact",
      order: 2,
      title: en ? "Business impact" : "影响我什么",
      value: pick("impact", ""),
      source: "user",
      editable: true,
      placeholder: en
        ? "Scope / affected customers / whether a core flow is blocked"
        : "影响范围 / 受影响客户 / 是否核心流程",
    },
    {
      id: "isBug",
      order: 3,
      title: en ? "Is it a defect" : "算不算 bug",
      value: pick("isBug", verdictLabel(derived.verdict)),
      source: "derived",
      editable: true,
      placeholder: verdictLabel(derived.verdict),
      reason: derived.reason,
    },
    {
      id: "workaround",
      order: 4,
      title: en ? "Workaround" : "有没有绕过方案",
      value: pick("workaround", ""),
      source: "user",
      editable: true,
      placeholder: en
        ? "Any temporary workaround?"
        : "请填写临时绕过办法（如无请注明）",
    },
    {
      id: "eta",
      order: 5,
      title: en ? "Expected fix date" : "什么时候修好",
      value: pick("eta", ""),
      source: "user",
      editable: true,
      placeholder: ETA_PLACEHOLDER,
    },
  ];
}

function questionValue(question: TicketQuestion): string {
  const value = question.value.trim();
  return value || question.placeholder;
}

function renderQuestionsSection(
  questions: TicketQuestion[],
  audience: TicketAudience
): string {
  const en = isEn();
  const customer = audience === "customer";
  const lines: string[] = [];
  for (const question of questions) {
    lines.push(`## ${question.order}. ${question.title}`);
    lines.push("");
    if (question.id === "isBug" && customer) {
      lines.push(sanitizeForCustomer(question.value || question.placeholder));
    } else if (question.id === "isBug") {
      lines.push(`- 结论：${questionValue(question)}`);
      if (question.reason) lines.push(`- 依据：${question.reason}`);
    } else if (customer) {
      const fallback =
        question.id === "eta"
          ? ETA_PLACEHOLDER
          : en
            ? "To be provided"
            : "待补充";
      lines.push(question.value.trim() || fallback);
    } else {
      lines.push(questionValue(question));
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

/**
 * 客户版输出级脱敏：白名单字段之外仍在用户输入中出现的敏感 token 在此统一剥离。
 */
export function sanitizeForCustomer(input: string): string {
  let output = String(input ?? "");

  // 1. 内部 URL（含内部接口地址与带内部路径的页面链接）
  output = output.replace(/https?:\/\/[^\s<>"'）)\]]+/gi, "[内部链接已隐藏]");

  // 2. 内部绝对路径（如 /issues/abc123/）
  output = output.replace(
    /(?<![\w:])\/(?:[\w.@%-]+\/)+[\w.@%-]*/g,
    "[内部路径已隐藏]"
  );

  // 3. evidence / 截图 / 数据目录结构
  output = output.replace(
    /\b(?:evidence|screenshots|network|media|data)\/[\w./@-]*/gi,
    "[内部文件已隐藏]"
  );

  // 3. 文件路径（含组件源码路径）
  output = output.replace(
    /(?:[A-Za-z]:[\\/]|\.{1,2}\/|\/)?(?:[\w.@-]+\/)+[\w.@-]+\.(?:tsx?|jsx?|mjs|cjs|vue|svelte|css|scss|less|sass|json|ya?ml|html?|md|py|go|java|rs|rb|php)\b/gi,
    "[内部文件已隐藏]"
  );

  // 4. CSS 选择器（tag.class > tag 组合）
  output = output.replace(
    /\b(?:[a-z][a-z0-9-]*)?(?:\.[A-Za-z_][\w-]*)+(?:\s*>\s*[a-z][a-z0-9-]*(?:\.[A-Za-z_][\w-]*)*)*/gi,
    "[页面元素]"
  );

  // 5. 裸类名 / ID 选择器
  output = output.replace(
    /(?<![\w])\.([a-z][\w-]{1,})(?=[\s,.;:，。；：)）]|$)/gi,
    "[页面元素]"
  );
  output = output.replace(/(?<=\s)#[A-Za-z][\w-]*/g, "[页面元素]");

  // 6. 内部场景标识
  output = output.replace(/\bscene[-_][\w-]+/gi, "[场景已隐藏]");
  output = output.replace(/\bsceneId\b/gi, "场景编号");

  // 7. JSX/框架组件名与 CamelCase 组件
  output = output.replace(/<\/?[A-Z][\w.]*\s*\/?>/g, "[组件]");
  output = output.replace(/\b[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+\b/g, "[组件]");

  // 8. 技术术语替换为业务表述
  output = output
    .replace(/\bDOM\b/gi, "页面内容")
    .replace(/\bselectors?\b/gi, "定位方式")
    .replace(/\bfiber\b/gi, "内部实现")
    .replace(/\bportal\b/gi, "弹层")
    .replace(/\bclassName\b/gi, "样式名")
    .replace(/\bCSS\b/gi, "样式")
    .replace(/\bAPI\b/gi, "接口");

  // 9. 堆栈行
  output = output.replace(/^\s*at\s+.+$/gm, "[调用细节已隐藏]");

  // 10. 折叠连续占位符，避免输出噪声
  output = output.replace(/(?:\[[^\]]*已隐藏\]\s*){2,}/g, "[内部信息已隐藏]");

  return output.trim();
}

function renderInternalAppendix(scene: IssueScene | undefined): string {
  if (!scene) return "";
  const en = isEn();
  const lines: string[] = [];
  lines.push(
    en ? "## Technical Context (Internal)" : "## 技术上下文（研发版）"
  );

  if (scene.page?.url) {
    lines.push(`- ${en ? "Page URL" : "页面地址"}：${oneLine(scene.page.url)}`);
  }
  if (scene.id) {
    lines.push(`- ${en ? "Scene ID" : "场景 ID"}：${oneLine(scene.id)}`);
  }
  if (scene.status) {
    lines.push(`- ${en ? "Scene status" : "场景状态"}：${scene.status}`);
  }

  const element = scene.target?.element;
  if (element) {
    const classes = (element.classNames ?? [])
      .map((name) => `.${name}`)
      .join("");
    lines.push(
      `- ${en ? "Target element" : "触发元素"}：<${element.tagName ?? "unknown"}>${classes}`
    );
    if (element.id) {
      lines.push(`- ${en ? "Element id" : "元素 ID"}：${oneLine(element.id)}`);
    }
    const locators = Array.isArray(element.locators) ? element.locators : [];
    if (locators.length > 0) {
      lines.push(`- ${en ? "Locators" : "选择器"}：`);
      for (const locator of locators.slice(0, 6)) {
        if (locator?.expression) {
          lines.push(`  - \`${oneLine(locator.expression)}\``);
        }
      }
    }
    const attributes = element.attributes ?? {};
    const attributeEntries = Object.entries(attributes).slice(0, 12);
    if (attributeEntries.length > 0) {
      lines.push(`- ${en ? "Attributes" : "元素属性"}：`);
      for (const [key, value] of attributeEntries) {
        lines.push(`  - ${key}: ${oneLine(value)}`);
      }
    }

    const component =
      element.framework?.targetComponent ?? element.framework?.rootComponent;
    if (component) {
      lines.push(
        `- ${en ? "Component" : "组件"}：${oneLine(component.componentName)}${
          component.componentFile
            ? ` (${oneLine(component.componentFile)})`
            : ""
        }`
      );
    }
  }

  if (scene.screenshot) {
    const parts: string[] = [];
    if (scene.screenshot.originalAssetId)
      parts.push(`original=${scene.screenshot.originalAssetId}`);
    if (scene.screenshot.annotatedAssetId)
      parts.push(`annotated=${scene.screenshot.annotatedAssetId}`);
    if (parts.length > 0) {
      lines.push(
        `- ${en ? "Screenshot assets" : "截图资产"}：${parts.join(", ")}`
      );
    }
  }

  return lines.join("\n");
}

export type TicketRenderOptions = {
  /**
   * 客户版截图区块的自定义渲染结果。传入后替换默认的 `screenshot-annotated` 占位；
   * 传空字符串表示不输出截图区块。
   * 该区块在脱敏之后拼接，避免 base64 被脱敏规则误伤。
   */
  customerScreenshotBlock?: string;
};

/**
 * 纯函数：五问 + 场景 → Markdown。
 * internal 保留技术细节；customer 仅输出业务字段并做输出级脱敏。
 */
export function renderTicketMarkdown(
  questions: TicketQuestion[],
  scene: IssueScene | undefined,
  audience: TicketAudience,
  options: TicketRenderOptions = {}
): string {
  const en = isEn();
  const customer = audience === "customer";
  const heading = customer
    ? en
      ? "# Issue Report (Customer Version)"
      : "# 问题说明（客户版）"
    : en
      ? "# Ticket Draft (Engineering Version)"
      : "# 工单草稿（研发版）";

  const body = renderQuestionsSection(questions, audience);

  if (customer) {
    const sections = [heading, "", body];
    const customBlock = options.customerScreenshotBlock;
    if (customBlock !== undefined) {
      const text = sanitizeForCustomer(sections.join("\n")).trim();
      return customBlock ? `${text}\n\n${customBlock}\n` : `${text}\n`;
    }
    if (scene?.screenshot?.annotatedAssetId) {
      sections.push(
        "",
        en ? "## Attached Screenshot" : "## 问题截图",
        "",
        en
          ? "![Annotated issue screenshot](screenshot-annotated)"
          : "![问题标注截图](screenshot-annotated)"
      );
    }
    return sanitizeForCustomer(sections.join("\n")).trim() + "\n";
  }

  const appendix = renderInternalAppendix(scene);
  return [heading, "", body, appendix ? `\n${appendix}` : ""]
    .join("\n")
    .trim()
    .concat("\n");
}

/** 供现有工单模板复用的五问区块（不含受众标题与技术附录）。 */
export function renderTicketQuestionsSection(
  questions: TicketQuestion[],
  audience: TicketAudience
): string {
  return renderQuestionsSection(questions, audience);
}

const CUSTOMER_NOTE_TITLE_MAX = 60;

/** 客户版单文件内联截图的体积上限（1.5MB 原始字节，base64 后约 2MB）。 */
export const CUSTOMER_NOTE_IMAGE_MAX_BYTES = 1_572_864;

/** 仅接受可直接内联的图片 data URI，避免任意字符串被写进 Markdown 图片语法。 */
const INLINE_IMAGE_DATA_URI =
  /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

function dataUriByteLength(dataUri: string): number {
  const comma = dataUri.indexOf(",");
  if (comma < 0) return 0;
  const payload = dataUri.slice(comma + 1);
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

/** 纯函数：data URI 是否为合法图片且未超过内联体积上限。 */
export function isCustomerNoteImageWithinLimit(dataUri: string): boolean {
  if (!INLINE_IMAGE_DATA_URI.test(dataUri)) return false;
  return dataUriByteLength(dataUri) <= CUSTOMER_NOTE_IMAGE_MAX_BYTES;
}

export type CustomerNoteFileOptions = {
  /**
   * 调用方同步读好的标注截图 data URI（仅 issue-annotated 资产）。
   * 缺省 / 非法 / 超限时不会输出 Markdown 图片语法。
   */
  annotatedImageDataUri?: string;
};

/**
 * 客户版截图区块：有图内联为 data URI，无图/超限退化为可读文字，
 * 任何情况下都不产生裂图引用。
 */
function renderCustomerNoteScreenshotBlock(
  dataUri: string | undefined
): string {
  const heading = `## ${t("customerNoteScreenshotHeading")}`;
  if (!dataUri || !INLINE_IMAGE_DATA_URI.test(dataUri)) {
    return `${heading}\n\n${t("customerNoteScreenshotMissing")}`;
  }
  if (!isCustomerNoteImageWithinLimit(dataUri)) {
    return `${heading}\n\n${t("customerNoteScreenshotTooLarge")}`;
  }
  return `${heading}\n\n![${t("customerNoteScreenshotAlt")}](${dataUri})`;
}

/** 从五问里取现象摘要作为单文件标题（已脱敏、单行、截断）。 */
function customerNoteTitle(questions: TicketQuestion[]): string {
  const symptom = questions.find((question) => question.id === "symptom");
  const raw = oneLine(sanitizeForCustomer(oneLine(symptom?.value ?? "")))
    .replace(/^#+\s*/, "")
    .trim();
  const title =
    raw.length > CUSTOMER_NOTE_TITLE_MAX
      ? `${raw.slice(0, CUSTOMER_NOTE_TITLE_MAX)}…`
      : raw;
  return title || t("customerNoteDefaultTitle");
}

/**
 * 纯函数：客户版单文件说明。
 * 只含「一句话标题 + 脱敏提示 + 客户版正文」，不含研发版/技术附录/证据目录/sceneId。
 * 无 ticketDraft 时由自动草稿生成，不抛错。
 * 截图由调用方同步读好 data URI 后传入；纯函数不做字节读取，保持可单测。
 */
export function buildCustomerNoteFile(
  questions: TicketQuestion[],
  scene: IssueScene | undefined,
  options: CustomerNoteFileOptions = {}
): string {
  const body = renderTicketMarkdown(questions, scene, "customer", {
    customerScreenshotBlock: renderCustomerNoteScreenshotBlock(
      options.annotatedImageDataUri
    ),
  }).trim();
  return [
    `# ${customerNoteTitle(questions)}`,
    "",
    `> ${t("customerNotePrivacyNotice")}`,
    "",
    body,
    "",
  ].join("\n");
}

/**
 * 纯函数：客户版说明文件名。
 * 只用 sessionId / sceneId 之类的短标识，避免页面标题、客户名进入文件名。
 */
export function buildCustomerNoteFilename(identifier?: string): string {
  const short = oneLine(identifier)
    .slice(0, 8)
    .replace(/[^A-Za-z0-9]/g, "")
    .toLowerCase();
  return `bug-lens-customer-note-${short || "note"}.md`;
}

const CUSTOMER_LEAK_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "http://", pattern: /https?:\/\//i },
  { label: "/issues/", pattern: /\/issues\//i },
  { label: ".tsx", pattern: /\.(?:tsx?|jsx?|vue|mjs|cjs)\b/i },
  { label: "sceneId", pattern: /\bscene[-_][\w-]+|\bsceneId\b/i },
  { label: "selector", pattern: /\bselectors?\b/i },
];

/**
 * 纯函数：导出前的可疑残留检测（只提示、不阻断）。
 * 返回命中的特征标签，供 UI 展示警告文案。
 */
export function detectCustomerNoteLeaks(text: string): string[] {
  const input = String(text ?? "");
  return CUSTOMER_LEAK_PATTERNS.filter(({ pattern }) =>
    pattern.test(input)
  ).map(({ label }) => label);
}
