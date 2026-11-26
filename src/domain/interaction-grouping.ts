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
 * 智能裁剪超长标签文本：
 * - <= maxLen 完整保留；
 * - 含 `/` 的多段面包屑优先中间省略（保留首段与末端核心节点）；
 * - 普通文本末尾截断并补 `…`。
 */
export function compactSemanticLabel(text: string, maxLen = 60): string {
  const normalized = String(text ?? "")
    .replace(/[\r\n]+/g, " ")
    .trim();
  if (normalized.length <= maxLen) return normalized;

  if (normalized.includes("/")) {
    const parts = normalized
      .split("/")
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length >= 3) {
      const first = parts[0];
      const last = parts[parts.length - 1];
      const prefix = `${first} / … / `;
      if (prefix.length + last.length <= maxLen) {
        return `${prefix}${last}`;
      }
      if (last.length + 4 <= maxLen) {
        const headBudget = maxLen - last.length - 8;
        if (headBudget >= 4) {
          return `${first.slice(0, headBudget)}… / … / ${last}`;
        }
        return `… / ${last}`;
      }
      return `… / ${last.slice(-(maxLen - 4))}`;
    }
  }

  return `${normalized.slice(0, maxLen - 1)}…`;
}

function isStableUniqueLocator(
  loc: ElementDescriptor["locators"][number] | undefined
): boolean {
  if (!loc?.expression) return false;
  return (
    loc.kind === "testId" ||
    loc.kind === "id" ||
    (loc.kind === "attribute" && loc.matchCount === 1)
  );
}

/**
 * 判断两个元素描述符是否指向同一个 DOM 元素
 */
export function isSameElement(
  a: ElementDescriptor,
  b: ElementDescriptor
): boolean {
  if (a.id && b.id) return a.id === b.id;

  const firstLocA = a.locators?.[0];
  const firstLocB = b.locators?.[0];
  if (isStableUniqueLocator(firstLocA) && isStableUniqueLocator(firstLocB)) {
    return firstLocA!.expression === firstLocB!.expression;
  }
  const locA = firstLocA?.expression;
  const locB = firstLocB?.expression;

  const tagA = (a.tagName ?? "").toLowerCase();
  const tagB = (b.tagName ?? "").toLowerCase();
  if (tagA !== tagB) return false;

  const classA = a.classNames?.join(" ") ?? "";
  const classB = b.classNames?.join(" ") ?? "";
  if (classA !== classB) return false;

  if (a.boundingBox && b.boundingBox) {
    const dx = Math.abs(a.boundingBox.x - b.boundingBox.x);
    const dy = Math.abs(a.boundingBox.y - b.boundingBox.y);
    return dx <= 5 && dy <= 5;
  }

  // 无坐标与定位器时，仅允许同为纯输入控件且文本一致时合并，避免跨元素误合并
  if (
    (tagA === "input" || tagA === "textarea") &&
    !a.id &&
    !b.id &&
    !locA &&
    !locB
  ) {
    return (a.text ?? "") === (b.text ?? "");
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
  windowMs: number = 3000,
  isEnglish?: boolean
): GroupedInteractionCard[] {
  if (!records || records.length === 0) return [];

  const resolvedIsEnglish = isEnglish ?? translate("stepClick") === "Click";

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
      record.page?.url === previous.page?.url &&
      record.page?.frameId === previous.page?.frameId;
    const sameElem =
      first.element && record.element
        ? isSameElement(first.element, record.element)
        : false;

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

  return groups.map((children) =>
    buildCard(children, translate, resolvedIsEnglish)
  );
}

function resolveSemanticTarget(
  element: ElementDescriptor,
  isEnglish = false
): { name: string; quoted: boolean } {
  const rawTag = element.tagName ? element.tagName.toLowerCase() : "element";
  const classes = element.classNames || [];
  const classStr = classes.join(" ").toLowerCase();

  // 1. 获取原始候选文本
  let rawText = element.accessibleName || element.text || "";
  rawText = String(rawText)
    .replace(/[\r\n]+/g, " ")
    .trim();

  // 2. 清洗字体图标占位符与机械 tag 名
  const isIconTag =
    rawTag === "i" ||
    rawTag === "svg" ||
    classes.some((c) => /icon|ico\b/i.test(c));

  if (isIconTag && (rawText.toLowerCase() === "i" || rawText.length <= 1)) {
    rawText = "";
  }
  if (rawTag === "input" && rawText.toLowerCase() === "input") {
    rawText = "";
  }

  // 3. 特殊字符业务符号意图映射
  if (
    rawText === "《" ||
    rawText === "<" ||
    rawText === "‹" ||
    rawText === "«"
  ) {
    return {
      name: isEnglish
        ? `Collapse / Back ("${rawText}")`
        : `折叠/返回 "${rawText}"`,
      quoted: false,
    };
  }
  if (
    rawText === "》" ||
    rawText === ">" ||
    rawText === "›" ||
    rawText === "»"
  ) {
    return {
      name: isEnglish
        ? `Expand / Next ("${rawText}")`
        : `展开/前进 "${rawText}"`,
      quoted: false,
    };
  }
  if (
    rawText === "×" ||
    rawText === "X" ||
    rawText === "x" ||
    rawText === "✕" ||
    rawText === "✖"
  ) {
    return {
      name: isEnglish ? `Close ("${rawText}")` : `关闭 "${rawText}"`,
      quoted: false,
    };
  }

  // 4. 若已有清洗后的有效文本，隐藏底层 HTML 标签并用引号包裹
  if (rawText) {
    return { name: compactSemanticLabel(rawText), quoted: true };
  }

  // 5. 图标类元素：从类名中推导意图，杜绝暴露裸标签 "i"
  if (isIconTag) {
    if (/close|cancel/i.test(classStr))
      return { name: isEnglish ? "Close icon" : "关闭图标", quoted: false };
    if (/arrow-left|prev|back|fold|collapse/i.test(classStr))
      return {
        name: isEnglish ? "Back / Collapse icon" : "返回/折叠图标",
        quoted: false,
      };
    if (/arrow-right|next|expand|unfold/i.test(classStr))
      return {
        name: isEnglish ? "Next / Expand icon" : "前进/展开图标",
        quoted: false,
      };
    if (/arrow-down|caret-down/i.test(classStr))
      return {
        name: isEnglish ? "Dropdown icon" : "下拉图标",
        quoted: false,
      };
    if (/arrow-up|caret-up/i.test(classStr))
      return {
        name: isEnglish ? "Collapse icon" : "收起图标",
        quoted: false,
      };
    if (/delete|remove|trash/i.test(classStr))
      return { name: isEnglish ? "Delete icon" : "删除图标", quoted: false };
    if (/edit|pencil/i.test(classStr))
      return { name: isEnglish ? "Edit icon" : "编辑图标", quoted: false };
    if (/search/i.test(classStr))
      return { name: isEnglish ? "Search icon" : "搜索图标", quoted: false };
    if (/refresh|reload/i.test(classStr))
      return { name: isEnglish ? "Refresh icon" : "刷新图标", quoted: false };
    if (/info|help|question/i.test(classStr))
      return {
        name: isEnglish ? "Details / Help icon" : "详情/提示图标",
        quoted: false,
      };
    if (/check|success/i.test(classStr))
      return { name: isEnglish ? "Confirm icon" : "确认图标", quoted: false };
    if (/more/i.test(classStr))
      return {
        name: isEnglish ? "More icon" : "更多操作图标",
        quoted: false,
      };
    return { name: isEnglish ? "Icon button" : "图标按钮", quoted: false };
  }

  // 6. 其他无文本元素：优先使用 #ID
  if (element.id) {
    return { name: `#${element.id}`, quoted: false };
  }

  // 7. 布局类包装标签（span, div），如果没有任何文本和类名意图
  if (rawTag === "span" || rawTag === "div") {
    return { name: isEnglish ? "Page area" : "页面区域", quoted: false };
  }

  return { name: rawTag, quoted: false };
}

function formatTargetLabel(target: { name: string; quoted: boolean }): string {
  return target.quoted ? `"${target.name}"` : target.name;
}

/**
 * 解析并提升元素的业务/语义名称，杜绝将 "i"、"span" 等无语义标签裸露在卡片标题中
 */
export function resolveSemanticElementName(
  element: ElementDescriptor,
  isEnglish = false
): string {
  return resolveSemanticTarget(element, isEnglish).name;
}

function buildCard(
  children: InteractionRecord[],
  translate: TranslateFn,
  isEnglish: boolean
): GroupedInteractionCard {
  const first = children[0];
  const last = children[children.length - 1];

  if (children.length === 1) {
    const record = children[0];
    const elemLabel = formatTargetLabel(
      resolveSemanticTarget(record.element, isEnglish)
    );
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
        title: translate("stepAtomicTitle", [actionLabel, elemLabel]),
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
          record.screenshot?.status === "captured" ? record : undefined,
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
      (c) => c.screenshot?.status === "captured" && c.screenshot?.dataUrl
    ) ||
    children.find((c) => c.screenshot?.status === "captured") ||
    children.find((c) => c.kind === "keydown" && c.metadata?.key === "Enter") ||
    children[0];

  const primaryRecord =
    children.find((c) => c.kind === "keydown" && c.metadata?.key === "Enter") ||
    children.find(
      (c) => c.kind === "input" && c.metadata?.valueLength !== undefined
    ) ||
    screenshotRecord;

  const elemLabel = formatTargetLabel(
    resolveSemanticTarget(primaryRecord.element ?? first.element, isEnglish)
  );

  let title = "";
  if (kind === "form_input_submit") {
    title = hasEnterSubmit
      ? translate("stepFormSubmitTitle", elemLabel)
      : translate("stepFormInputTitle", elemLabel);
  } else if (kind === "continuous_click") {
    title = translate("stepContinuousClickTitle", [
      String(children.length),
      elemLabel,
    ]);
  } else {
    title = translate("stepCompositeTitle", elemLabel);
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
        screenshotRecord.screenshot?.status === "captured"
          ? screenshotRecord
          : undefined,
    },
  };
}
