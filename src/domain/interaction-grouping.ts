import type {
  InteractionRecord,
  ElementDescriptor,
} from "../shared/protocol.ts";

/**
 * 翻译函数：将 i18n key（及可选占位符参数）转换为当前界面语言的文案。
 * 由调用方注入（预览页传入 t），保持本域模块与 i18n 环境解耦。
 */
export type TranslateFn = (
  key: string,
  substitutions?: string | string[]
) => string;

/**
 * 表示被分组（合并）后的交互卡片的类型。
 * - `form_input_submit`: 包含表单输入（可能还有提交）的复合操作
 * - `continuous_click`: 对同一个元素的连续多次点击
 * - `atomic`: 无法或无需合并的单次原子操作
 */
export type GroupedCardKind =
  "form_input_submit" | "continuous_click" | "atomic";

/**
 * 分组（合并）后的交互卡片的聚合元数据，
 * 包含了用于前端展示的标题、描述、统计数据等。
 */
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
  /**
   * 用于作为卡片封面的主要截图记录（如果有的话）
   */
  primaryScreenshotRecord?: InteractionRecord;
}

/**
 * 分组（合并）后的交互卡片数据结构。
 * 它将底层的细粒度 InteractionRecord 组合成对用户更友好的高层语义操作。
 */
export interface GroupedInteractionCard {
  id: string;
  kind: GroupedCardKind;
  /** 代表这个分组核心意图的记录（例如最终输入或提交动作） */
  primaryRecord: InteractionRecord;
  /** 组成该分组的所有底层记录 */
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
  return ["click", "input", "keydown", "change", "submit", "dblclick"].includes(
    kind
  );
}

/**
 * 将平铺的 InteractionRecord 序列纯函数式转换为语义化 GroupedInteractionCard 序列
 */
export function groupInteractions(
  records: InteractionRecord[],
  translate: TranslateFn,
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

  return groups.map((children) => buildCard(children, translate));
}

function buildCard(
  children: InteractionRecord[],
  translate: TranslateFn
): GroupedInteractionCard {
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
        ? translate("stepClick")
        : record.kind === "input"
          ? translate("stepInput")
          : record.kind === "keydown"
            ? record.metadata?.shortcut
              ? translate("stepShortcut", record.metadata.shortcut)
              : translate("stepKey", record.metadata?.key ?? "")
            : record.kind === "navigation"
              ? translate("stepNavigation", [
                  record.metadata?.navigationType ?? "navigation",
                ])
              : record.kind;

    return {
      id: record.id,
      kind: "atomic",
      primaryRecord: record,
      children,
      aggregatedMeta: {
        title: translate("stepAtomicTitle", [actionLabel, elemName]),
        description:
          record.kind === "navigation"
            ? (record.metadata?.toUrl ?? record.page.url)
            : record.metadata?.value
              ? translate("stepInputValue", record.metadata.value)
              : record.metadata?.valueLength
                ? translate("stepInputRedacted", [
                    String(record.metadata.valueLength),
                  ])
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
      ? translate("stepFormSubmitTitle", elemIdentifier)
      : translate("stepFormInputTitle", elemIdentifier);
  } else if (kind === "continuous_click") {
    title = translate("stepContinuousClickTitle", [
      String(children.length),
      elemIdentifier,
    ]);
  } else {
    title = translate("stepCompositeTitle", elemIdentifier);
  }

  const descParts: string[] = [];
  if (finalValue !== undefined) {
    const shown =
      finalValue.length > 20 ? `${finalValue.slice(0, 20)}...` : finalValue;
    descParts.push(translate("stepInputTextValue", shown));
  } else if (finalValueLength !== undefined) {
    descParts.push(
      translate("stepInputTextRedacted", [String(finalValueLength)])
    );
  }
  if (hasEnterSubmit) {
    descParts.push(translate("stepEnterSubmit"));
  }
  if (totalInputEvents > 1) {
    descParts.push(translate("stepTypingEvents", String(totalInputEvents)));
  } else {
    descParts.push(translate("stepPhysicalEvents", String(children.length)));
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
