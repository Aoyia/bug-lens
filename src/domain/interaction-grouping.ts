import type {
  InteractionRecord,
  ElementDescriptor,
} from "../shared/protocol.ts";

export type GroupedCardKind =
  "form_input_submit" | "continuous_click" | "atomic";

export interface GroupedMeta {
  title: string;
  description: string;
  startTime: number;
  endTime: number;
  hasEnterSubmit: boolean;
  finalValue?: string;
  finalValueLength?: number;
  totalInputEvents?: number;
  isCompositionInput?: boolean;
  primaryScreenshotRecord?: InteractionRecord;
}

export interface GroupedInteractionCard {
  id: string;
  kind: GroupedCardKind;
  primaryRecord: InteractionRecord;
  children: InteractionRecord[];
  aggregatedMeta: GroupedMeta;
}

/**
 * 判断两个元素描述符是否指向同一个 DOM 元素
 */
export function isSameElement(
  a: ElementDescriptor,
  b: ElementDescriptor
): boolean {
  if (a.id && b.id && a.id === b.id) return true;

  const locA = a.locators?.[0]?.expression;
  const locB = b.locators?.[0]?.expression;
  if (locA && locB && locA === locB) return true;

  if (a.tagName !== b.tagName) return false;

  const classA = a.classNames?.join(" ") ?? "";
  const classB = b.classNames?.join(" ") ?? "";
  if (classA !== classB) return false;

  if (a.boundingBox && b.boundingBox) {
    const dx = Math.abs(a.boundingBox.x - b.boundingBox.x);
    const dy = Math.abs(a.boundingBox.y - b.boundingBox.y);
    if (dx <= 5 && dy <= 5) return true;
  }

  return false;
}

/**
 * 判断事件是否属于可合并的表单/输入/按键交互
 */
function isFormOrInputKind(kind: InteractionRecord["kind"]): boolean {
  return ["click", "input", "keydown", "change", "submit"].includes(kind);
}

/**
 * 将平铺的 InteractionRecord 序列纯函数式转换为语义化 GroupedInteractionCard 序列
 */
export function groupInteractions(
  records: InteractionRecord[],
  windowMs: number = 3000
): GroupedInteractionCard[] {
  if (!records || records.length === 0) return [];

  // 按时间升序排序
  const sorted = [...records].sort((a, b) => a.createdAt - b.createdAt);
  const groups: InteractionRecord[][] = [];
  let currentGroup: InteractionRecord[] = [];

  for (const record of sorted) {
    if (currentGroup.length === 0) {
      currentGroup.push(record);
      continue;
    }

    const previous = currentGroup[currentGroup.length - 1];
    const first = currentGroup[0];
    const dt = record.createdAt - previous.createdAt;
    const samePage =
      record.page.url === previous.page.url &&
      record.page.frameId === previous.page.frameId;
    const sameElem = isSameElement(first.element, record.element);

    const canGroup =
      samePage &&
      dt <= windowMs &&
      sameElem &&
      isFormOrInputKind(record.kind) &&
      isFormOrInputKind(first.kind);

    if (canGroup) {
      currentGroup.push(record);
    } else {
      groups.push(currentGroup);
      currentGroup = [record];
    }
  }

  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  return groups.map((children) => buildCard(children));
}

function buildCard(children: InteractionRecord[]): GroupedInteractionCard {
  const first = children[0];
  const last = children[children.length - 1];

  if (children.length === 1) {
    const record = children[0];
    const elemName =
      record.element.accessibleName ||
      record.element.text ||
      record.element.id ||
      record.element.tagName.toLowerCase();
    const actionLabel =
      record.kind === "click"
        ? "点击"
        : record.kind === "input"
          ? "输入"
          : record.kind === "keydown"
            ? record.metadata?.shortcut
              ? `快捷键 ${record.metadata.shortcut}`
              : `按键 ${record.metadata?.key ?? ""}`
            : record.kind === "navigation"
              ? `页面导航 (${record.metadata?.navigationType ?? "navigation"})`
              : record.kind;

    return {
      id: record.id,
      kind: "atomic",
      primaryRecord: record,
      children,
      aggregatedMeta: {
        title: `${actionLabel} (${elemName})`,
        description:
          record.kind === "navigation"
            ? (record.metadata?.toUrl ?? record.page.url)
            : record.metadata?.value
              ? `输入: "${record.metadata.value}"`
              : record.metadata?.valueLength
                ? `输入: ${record.metadata.valueLength} 字符 (脱敏)`
                : record.page.url,
        startTime: record.createdAt,
        endTime: record.createdAt,
        hasEnterSubmit:
          record.kind === "keydown" && record.metadata?.key === "Enter",
        finalValue: record.metadata?.value,
        finalValueLength: record.metadata?.valueLength,
        totalInputEvents:
          record.metadata?.inputEventCount ?? (record.kind === "input" ? 1 : 0),
        isCompositionInput: record.metadata?.inputType?.includes("Composition"),
        primaryScreenshotRecord:
          record.screenshot.status === "captured" ? record : undefined,
      },
    };
  }

  // 多条记录合并
  const hasInput = children.some((c) => c.kind === "input");
  const hasKeydown = children.some((c) => c.kind === "keydown");
  const hasEnterSubmit = children.some(
    (c) => c.kind === "keydown" && c.metadata?.key === "Enter"
  );
  const allClick = children.every((c) => c.kind === "click");

  const kind: GroupedCardKind = allClick
    ? "continuous_click"
    : hasInput || hasKeydown || hasEnterSubmit
      ? "form_input_submit"
      : "atomic";

  let totalInputEvents = 0;
  let isCompositionInput = false;

  for (const child of children) {
    if (child.metadata?.inputEventCount) {
      totalInputEvents += child.metadata.inputEventCount;
    } else if (child.kind === "input") {
      totalInputEvents += 1;
    }
    if (child.metadata?.inputType?.includes("Composition")) {
      isCompositionInput = true;
    }
  }

  // 从后往前寻找最接近操作完成时的终值与终值长度
  let finalValue: string | undefined;
  let finalValueLength: number | undefined;
  for (let i = children.length - 1; i >= 0; i--) {
    const c = children[i];
    if (finalValue === undefined && c.metadata?.value !== undefined) {
      finalValue = c.metadata.value;
    }
    if (
      finalValueLength === undefined &&
      c.metadata?.valueLength !== undefined
    ) {
      finalValueLength = c.metadata.valueLength;
    }
    if (finalValue !== undefined && finalValueLength !== undefined) break;
  }

  // 最佳主记录与最佳截图记录
  const screenshotRecord =
    children.find(
      (c) => c.screenshot.status === "captured" && c.screenshot.dataUrl
    ) ||
    children.find((c) => c.screenshot.status === "captured") ||
    children.find((c) => c.kind === "keydown" && c.metadata?.key === "Enter") ||
    children[0];

  const primaryRecord =
    children.find((c) => c.kind === "keydown" && c.metadata?.key === "Enter") ||
    children.find(
      (c) => c.kind === "input" && c.metadata?.valueLength !== undefined
    ) ||
    screenshotRecord;

  const elemTag = first.element.tagName.toLowerCase();
  const elemIdentifier = first.element.id
    ? `#${first.element.id}`
    : first.element.accessibleName || first.element.text || elemTag;

  let title = "";
  if (kind === "form_input_submit") {
    title = hasEnterSubmit
      ? `表单输入与回车提交 (${elemIdentifier})`
      : `表单连续输入与修改 (${elemIdentifier})`;
  } else if (kind === "continuous_click") {
    title = `连续点击 ${children.length} 次 (${elemIdentifier})`;
  } else {
    title = `复合操作 (${elemIdentifier})`;
  }

  const descParts: string[] = [];
  if (finalValue !== undefined) {
    descParts.push(
      `输入文本: "${finalValue.length > 20 ? finalValue.slice(0, 20) + "..." : finalValue}"`
    );
  } else if (finalValueLength !== undefined) {
    descParts.push(`输入文本: ${finalValueLength} 字符 (脱敏)`);
  }
  if (hasEnterSubmit) {
    descParts.push("按 Enter 提交");
  }
  if (totalInputEvents > 1) {
    descParts.push(`共 ${totalInputEvents} 次连续打字事件`);
  } else {
    descParts.push(`包含 ${children.length} 个物理事件`);
  }

  return {
    id: primaryRecord.id,
    kind,
    primaryRecord,
    children,
    aggregatedMeta: {
      title,
      description: descParts.join(" · "),
      startTime: first.createdAt,
      endTime: last.createdAt,
      hasEnterSubmit,
      finalValue,
      finalValueLength,
      totalInputEvents,
      isCompositionInput,
      primaryScreenshotRecord:
        screenshotRecord.screenshot.status === "captured"
          ? screenshotRecord
          : undefined,
    },
  };
}
