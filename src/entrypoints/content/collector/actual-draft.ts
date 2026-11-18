import type { PrivacyMode } from "../../../domain/privacy-policy";
import {
  containsSensitiveData,
  isSensitiveKeyName,
} from "../../../domain/privacy-policy";
import { t } from "../../../shared/i18n";
import { resolveAccessibleName, textOf } from "./dom-snapshot";

/**
 * 元素语义快照：草稿生成的唯一输入。
 * 只承载可直接从 DOM 读到的客观事实（标签、角色、文案、条数），
 * 不含任何推断出的业务含义，避免"编造现象"。
 */
export type DraftElementSemantics = {
  tagName?: string;
  role?: string;
  /** 元素可见文案（已脱敏） */
  text?: string;
  ariaLabel?: string;
  placeholder?: string;
  /** 表单控件当前值（已脱敏，空表示无值） */
  value?: string;
  /** 列表/表格行数 */
  itemCount?: number;
  /** 列表区域名（aria-label / caption / 邻近标题） */
  regionName?: string;
  /** 弹窗标题 */
  dialogTitle?: string;
  /** 元素自身即弹窗/浮层 */
  isDialog?: boolean;
};

export type DraftTranslate = (
  key: string,
  substitutions?: string | string[]
) => string;

const BUTTON_TAGS = new Set(["button", "a"]);
const BUTTON_ROLES = new Set(["button", "link", "menuitem"]);
const INPUT_TAGS = new Set(["input", "textarea", "select"]);
const INPUT_ROLES = new Set(["textbox", "combobox", "searchbox", "spinbutton"]);
const LIST_TAGS = new Set(["table", "tbody", "ul", "ol", "dl", "menu"]);
const LIST_ROLES = new Set(["table", "grid", "list", "listbox", "tree"]);
const TEXT_TAGS = new Set([
  "p",
  "span",
  "div",
  "section",
  "article",
  "label",
  "li",
  "td",
  "th",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "strong",
  "em",
  "pre",
  "code",
  "blockquote",
]);

const TEXT_PREVIEW_LENGTH = 20;

function collapseWhitespace(value: string | undefined): string | undefined {
  const clean = value?.replace(/\s+/g, " ").trim();
  return clean ? clean : undefined;
}

function firstDefined(...values: (string | undefined)[]): string | undefined {
  return values.find((value) => Boolean(value));
}

function normalizeTag(tagName: string | undefined): string | undefined {
  const tag = tagName?.trim().toLowerCase();
  return tag ? tag : undefined;
}

export type DraftKind =
  "dialog" | "button" | "input" | "list" | "text" | "fallback";

/**
 * 按控件语义决定草稿模板类别。优先级：自身弹窗 > 按钮 > 输入框 > 列表 > 文本 > 兜底。
 * 祖先弹窗只在"容器类元素"上生效，避免把弹窗里的提交按钮误判成弹窗。
 */
export function resolveDraftKind(semantics: DraftElementSemantics): DraftKind {
  const tag = normalizeTag(semantics.tagName);
  const role = semantics.role?.toLowerCase();

  if (semantics.isDialog) return "dialog";
  if (tag === "dialog" || role === "dialog" || role === "alertdialog") {
    return "dialog";
  }
  if (tag && BUTTON_TAGS.has(tag)) return "button";
  if (role && BUTTON_ROLES.has(role)) return "button";
  if (tag && INPUT_TAGS.has(tag)) return "input";
  if (role && INPUT_ROLES.has(role)) return "input";
  if (tag && LIST_TAGS.has(tag)) return "list";
  if (role && LIST_ROLES.has(role)) return "list";
  if (tag && TEXT_TAGS.has(tag)) return "text";
  return "fallback";
}

/**
 * 生成本地规则的"事实陈述"草稿（离线、纯函数）。
 * 文案缺失时不猜测业务语义，直接落到 `{tagName} 元素与预期不符`。
 */
export function buildActualDraft(
  semantics: DraftElementSemantics,
  translate: DraftTranslate = t
): string {
  const kind = resolveDraftKind(semantics);
  const text = collapseWhitespace(semantics.text);
  const ariaLabel = collapseWhitespace(semantics.ariaLabel);
  const placeholder = collapseWhitespace(semantics.placeholder);

  if (kind === "dialog") {
    const title = firstDefined(
      collapseWhitespace(semantics.dialogTitle),
      ariaLabel,
      text
    );
    if (title) {
      return translate("actualDraftDialog", title.slice(0, 32));
    }
  }

  if (kind === "button") {
    const label = firstDefined(ariaLabel, text);
    if (label) {
      return translate("actualDraftButton", label.slice(0, 32));
    }
  }

  if (kind === "input") {
    const label = firstDefined(ariaLabel, placeholder);
    if (label) {
      const value = collapseWhitespace(semantics.value);
      return value
        ? translate("actualDraftInputFilled", [
            label.slice(0, 32),
            value.slice(0, 32),
          ])
        : translate("actualDraftInputEmpty", label.slice(0, 32));
    }
  }

  if (kind === "list") {
    const name = firstDefined(
      collapseWhitespace(semantics.regionName),
      ariaLabel
    );
    if (name) {
      const count = Math.max(0, Math.trunc(semantics.itemCount ?? 0));
      return translate("actualDraftList", [name.slice(0, 32), String(count)]);
    }
  }

  if (kind === "text" && text) {
    return translate("actualDraftText", text.slice(0, TEXT_PREVIEW_LENGTH));
  }

  const tag = normalizeTag(semantics.tagName);
  if (tag) {
    return translate("actualDraftFallback", tag.toUpperCase());
  }
  return translate("actualDraftUnknownElement");
}

function closestBySelector(
  element: Element,
  selector: string
): Element | undefined {
  return typeof element.closest === "function"
    ? (element.closest(selector) ?? undefined)
    : undefined;
}

function headingTextOf(container: Element): string | undefined {
  const heading = container.querySelector?.(
    "h1,h2,h3,h4,h5,h6,[role='heading'],legend"
  );
  const raw = heading?.textContent?.replace(/\s+/g, " ").trim();
  return raw ? raw.slice(0, 64) : undefined;
}

function dialogTitleOf(dialog: Element): string | undefined {
  const labelledBy = dialog.getAttribute("aria-labelledby");
  if (labelledBy && dialog.ownerDocument) {
    const fromLabel = labelledBy
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => dialog.ownerDocument.getElementById(id)?.textContent?.trim())
      .filter(Boolean)
      .join(" ");
    if (fromLabel) return fromLabel.replace(/\s+/g, " ").slice(0, 64);
  }
  return (
    dialog.getAttribute("aria-label")?.trim() ||
    headingTextOf(dialog) ||
    undefined
  );
}

function regionNameOf(element: Element): string | undefined {
  const caption = element.querySelector?.("caption")?.textContent?.trim();
  if (caption) return caption.slice(0, 64);

  const previous = element.previousElementSibling;
  if (previous && /^h[1-6]$/i.test(previous.tagName ?? "")) {
    const raw = previous.textContent?.replace(/\s+/g, " ").trim();
    if (raw) return raw.slice(0, 64);
  }

  const region = closestBySelector(
    element,
    "section,[role='region'],[role='tabpanel'],fieldset"
  );
  return region ? headingTextOf(region) : undefined;
}

function countListItems(element: Element): number {
  return (
    element.querySelectorAll?.("li,tr,[role='row'],[role='listitem']").length ??
    0
  );
}

function readControlValue(
  element: Element,
  privacyMode: PrivacyMode
): string | undefined {
  if (privacyMode === "strict") return undefined;
  const type = element.getAttribute("type")?.toLowerCase() ?? "";
  if (type === "password") return undefined;

  const sensitiveKeyHit = [
    element.getAttribute("name"),
    element.id,
    element.getAttribute("autocomplete"),
    element.getAttribute("aria-label"),
  ]
    .filter(Boolean)
    .some((key) => isSensitiveKeyName(String(key)));
  if (sensitiveKeyHit) return undefined;

  const domValue = (element as HTMLInputElement).value;
  if (typeof domValue !== "string" || domValue.length === 0) return undefined;
  if (containsSensitiveData(domValue)) return undefined;
  return domValue.slice(0, 32);
}

/**
 * 从真实元素提取草稿语义。不抛异常：宿主 DOM 千奇百怪，
 * 任何一环缺失都退化为"信息更少的草稿"，而不是失败。
 */
export function describeDraftSemantics(
  element: Element | undefined,
  privacyMode: PrivacyMode = "safe"
): DraftElementSemantics {
  if (!element) return {};

  const tagName = normalizeTag(element.tagName);
  const role = element.getAttribute?.("role")?.toLowerCase() || undefined;
  const semantics: DraftElementSemantics = { tagName, role };

  const ownDialogLike =
    tagName === "dialog" || role === "dialog" || role === "alertdialog";
  const ancestorDialog = ownDialogLike
    ? undefined
    : closestBySelector(element, "[role='dialog'],[role='alertdialog'],dialog");

  const containerOnly =
    tagName !== undefined &&
    ["div", "section", "aside", "main", "article", "form"].includes(tagName);

  if (ownDialogLike) {
    semantics.isDialog = true;
    semantics.dialogTitle = dialogTitleOf(element);
  } else if (ancestorDialog && containerOnly) {
    semantics.isDialog = true;
    semantics.dialogTitle = dialogTitleOf(ancestorDialog);
  }

  semantics.ariaLabel =
    element.getAttribute?.("aria-label")?.trim() || undefined;
  semantics.placeholder =
    element.getAttribute?.("placeholder")?.trim() || undefined;

  if (tagName && INPUT_TAGS.has(tagName)) {
    semantics.value = readControlValue(element, privacyMode);
  }

  if (tagName && LIST_TAGS.has(tagName)) {
    semantics.itemCount = countListItems(element);
    semantics.regionName = regionNameOf(element);
  } else if (role && LIST_ROLES.has(role)) {
    semantics.itemCount = countListItems(element);
    semantics.regionName = regionNameOf(element);
  }

  const rawText =
    textOf(element, privacyMode) ??
    resolveAccessibleName(element) ??
    element.textContent?.replace(/\s+/g, " ").trim();
  semantics.text = rawText ? rawText.slice(0, 256) : undefined;

  return semantics;
}

/** 框内元素候选：area 为该元素与选区求交后的视口面积（px²） */
export type SelectionElementCandidate = { element: Element; area: number };

export type PickDraftElementInput = {
  /** 选区中心点命中的元素（elementsFromPoint 结果） */
  hitTest?: Element | null;
  /** 框内元素（含面积），用于"最大面积"回退 */
  candidates?: SelectionElementCandidate[];
  /** 最后交互元素：仅在选区有内容但拿不到候选时兜底 */
  fallback?: Element;
  /** 选区退化为空白/极小题：不退化到 fallback，直接走"无元素"文案 */
  emptySelection?: boolean;
};

/**
 * 为草稿挑选语义来源元素（纯函数，可测）。
 * 优先级：中心点命中 > 框内面积最大 > fallback（最后交互元素）。
 * `emptySelection` 为 true 时跳过 fallback —— 用户圈的是空白/极小题，
 * 拿"最后交互元素"冒充选区内容会写出与选区无关的现象。
 */
export function pickDraftElement(
  input: PickDraftElementInput
): Element | undefined {
  if (input.hitTest) return input.hitTest;

  let best: SelectionElementCandidate | undefined;
  for (const candidate of input.candidates ?? []) {
    if (!candidate || !candidate.element) continue;
    if (candidate.area <= 0) continue;
    if (!best || candidate.area > best.area) best = candidate;
  }
  if (best) return best.element;

  if (input.emptySelection) return undefined;
  return input.fallback;
}
