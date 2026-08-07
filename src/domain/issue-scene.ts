import type {
  AnnotationModel,
  CaptureIssue,
  ConsoleEntry,
  ExpectedStatement,
  InteractionRecord,
  IssueScene,
  IssueSequenceContext,
  TargetDomSnapshot,
} from "../shared/protocol.ts";

/**
 * 基于用户点击或视口信息，生成默认的标注信息（AnnotationModel）。
 * 默认标注通常是一个红色的箭头框。
 */
export function defaultAnnotation(
  point: { clientX: number; clientY: number },
  viewport: { width: number; height: number },
  target?: { x: number; y: number; width: number; height: number }
): AnnotationModel {
  const width = Math.max(1, viewport.width);
  const height = Math.max(1, viewport.height);
  return {
    type: "arrow-box",
    color: "#ef233c",
    point: {
      xRatio: clamp(point.clientX / width),
      yRatio: clamp(point.clientY / height),
    },
    targetBox: target
      ? {
          xRatio: clamp(target.x / width),
          yRatio: clamp(target.y / height),
          widthRatio: clamp(target.width / width),
          heightRatio: clamp(target.height / height),
        }
      : undefined,
  };
}

export function normalizeAnnotation(
  annotation: AnnotationModel
): AnnotationModel {
  return {
    ...annotation,
    point: {
      xRatio: clamp(annotation.point.xRatio),
      yRatio: clamp(annotation.point.yRatio),
    },
    targetBox: annotation.targetBox
      ? {
          xRatio: clamp(annotation.targetBox.xRatio),
          yRatio: clamp(annotation.targetBox.yRatio),
          widthRatio: clamp(annotation.targetBox.widthRatio),
          heightRatio: clamp(annotation.targetBox.heightRatio),
        }
      : undefined,
    targetBoxes: annotation.targetBoxes?.map((box) => ({
      xRatio: clamp(box.xRatio),
      yRatio: clamp(box.yRatio),
      widthRatio: clamp(box.widthRatio),
      heightRatio: clamp(box.heightRatio),
    })),
    userAnnotations: annotation.userAnnotations?.map((item) => {
      if (item.type === "rect") {
        return {
          type: "rect" as const,
          color: item.color || "#165dff",
          xRatio: clamp(item.xRatio),
          yRatio: clamp(item.yRatio),
          widthRatio: clamp(item.widthRatio),
          heightRatio: clamp(item.heightRatio),
        };
      }
      if (item.type === "arrow") {
        return {
          type: "arrow" as const,
          color: item.color || "#165dff",
          startXRatio: clamp(item.startXRatio),
          startYRatio: clamp(item.startYRatio),
          endXRatio: clamp(item.endXRatio),
          endYRatio: clamp(item.endYRatio),
        };
      }
      return {
        type: "text" as const,
        color: item.color || "#165dff",
        xRatio: clamp(item.xRatio),
        yRatio: clamp(item.yRatio),
        text: item.text.trim().slice(0, 100),
        fontSize: item.fontSize,
      };
    }),
    label: annotation.label?.trim().slice(0, 80) || undefined,
  };
}

/**
 * 归一化用户的"期望"陈述，兼容历史数据形态。
 * - `undefined` / 空串 → `undefined`
 * - 旧版 `string` → `{ text, confidence: "missing" }`（历史形态无法判定是否显式表达，保守标 missing）
 * - `ExpectedStatement` → 裁剪 text 与 tags；text 为空则视为缺失
 */
export function normalizeExpected(
  raw: string | ExpectedStatement | undefined
): ExpectedStatement | undefined {
  if (typeof raw === "string") {
    const text = raw.trim();
    return text ? { text, confidence: "missing" } : undefined;
  }
  if (!raw) return undefined;
  const text = raw.text?.trim() ?? "";
  if (!text) return undefined;
  const tags = raw.tags
    ?.map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
    .slice(0, 8);
  return {
    text,
    ...(tags && tags.length > 0 ? { tags } : {}),
    confidence: raw.confidence === "explicit" ? "explicit" : "missing",
  };
}

/**
 * 将用户补充的问题描述（Narrative）合并到现有的 IssueScene 中，
 * 并将该场景标记为已提交 (committed)。
 *
 * @param scene 当前的问题现场快照
 * @param narrative 用户输入的实际情况、预期和备注
 * @param annotation 经过编辑或确认的最终标注信息
 * @returns 更新后的 IssueScene
 */
export function withIssueNarrative(
  scene: IssueScene,
  narrative: IssueScene["narrative"],
  annotation: AnnotationModel
): IssueScene {
  const actual = narrative?.actual?.trim() ?? "";
  return {
    ...scene,
    status: "committed",
    committedAtEpochMs: Date.now(),
    narrative: {
      actual,
      expected: normalizeExpected(narrative?.expected),
      note: narrative?.note?.trim() || undefined,
    },
    annotation: normalizeAnnotation(annotation),
  };
}

/**
 * 标记特定 IssueScene 的处理结果（完整、部分完成或失败），
 * 并在必要时附加错误 / 警告信息。
 */
export function markIssueSceneResult(
  scene: IssueScene,
  result: "complete" | "partial" | "failed",
  issue?: CaptureIssue
): IssueScene {
  return {
    ...scene,
    status: result,
    issues: issue ? [...scene.issues, issue] : scene.issues,
  };
}

/**
 * 构造目标 DOM 元素的精简快照（用于保存和分析）。
 * 为了防止数据过大，会限制保存的祖先元素层级数量和计算样式的数量。
 */
export function buildTargetSnapshot(
  element: TargetDomSnapshot
): TargetDomSnapshot {
  return {
    ...element,
    capturedAtEpochMs: element.capturedAtEpochMs || Date.now(),
    ancestors: element.ancestors.slice(0, 5),
    computedStyle: Object.fromEntries(
      Object.entries(element.computedStyle).slice(0, 20)
    ),
  };
}

/** 时序切片默认回看窗口：标记当下前 60s */
export const ISSUE_SEQUENCE_WINDOW_MS = 60_000;
/** 时序切片默认上限，防止场景元数据膨胀挤占存储预算 */
export const ISSUE_SEQUENCE_MAX_INTERACTIONS = 30;
export const ISSUE_SEQUENCE_MAX_CONSOLE_ENTRIES = 30;

const SEQUENCE_INTERACTION_TEXT_MAX = 80;
const SEQUENCE_CONSOLE_TEXT_MAX = 500;

/**
 * 以"标记当下"为锚点，冻结一段时间窗口内的交互与 Console 报错，
 * 生成问题现场的时序上下文切片（P1 的 Sequence 维度）。
 *
 * - 仅投影已脱敏的交互字段，复用入库时 privacy-policy 的清洗结果；
 * - 按时间升序排列，只保留窗口内最近的部分条目，控制体积；
 * - 排除已取消交互；值已脱敏的输入仅保留 valueRedacted 标记；
 * - 返回 undefined 表示窗口内没有任何时序上下文（场景不携带空切片）。
 */
export function buildIssueSequenceContext(input: {
  anchorEpochMs: number;
  windowMs?: number;
  maxInteractions?: number;
  maxConsoleEntries?: number;
  interactions: InteractionRecord[];
  consoleEntries?: ConsoleEntry[];
}): IssueSequenceContext | undefined {
  const anchorEpochMs = input.anchorEpochMs;
  const windowMs = input.windowMs ?? ISSUE_SEQUENCE_WINDOW_MS;
  const start = anchorEpochMs - windowMs;
  const end = anchorEpochMs;

  const interactions = input.interactions
    .filter(
      (item) =>
        item.status !== "cancelled" &&
        item.createdAt >= start &&
        item.createdAt <= end
    )
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(-(input.maxInteractions ?? ISSUE_SEQUENCE_MAX_INTERACTIONS))
    .map((item) => ({
      id: item.id,
      kind: item.kind,
      createdAt: item.createdAt,
      offsetMs: item.createdAt - anchorEpochMs,
      tagName: item.element.tagName,
      text: item.element.text?.slice(0, SEQUENCE_INTERACTION_TEXT_MAX),
      role: item.element.role,
      toUrl: item.kind === "navigation" ? item.metadata?.toUrl : undefined,
      scrollX: item.kind === "scroll" ? item.metadata?.scrollX : undefined,
      scrollY: item.kind === "scroll" ? item.metadata?.scrollY : undefined,
      key: item.metadata?.key,
      shortcut: item.metadata?.shortcut,
      value: item.metadata?.valueRedacted
        ? undefined
        : item.metadata?.value?.slice(0, SEQUENCE_INTERACTION_TEXT_MAX),
      valueRedacted: item.metadata?.valueRedacted,
      fileCount: item.metadata?.fileCount,
    }));

  const consoleEntries = (input.consoleEntries ?? [])
    .filter(
      (entry) =>
        (entry.level === "error" ||
          entry.level === "warning" ||
          entry.level === "warn") &&
        entry.createdAt >= start &&
        entry.createdAt <= end
    )
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(-(input.maxConsoleEntries ?? ISSUE_SEQUENCE_MAX_CONSOLE_ENTRIES))
    .map((entry) => ({
      createdAt: entry.createdAt,
      offsetMs: entry.createdAt - anchorEpochMs,
      level: entry.level,
      text: entry.text.slice(0, SEQUENCE_CONSOLE_TEXT_MAX),
    }));

  if (interactions.length === 0 && consoleEntries.length === 0)
    return undefined;
  return {
    anchorEpochMs,
    windowMs,
    interactions,
    consoleEntries,
  };
}

function clamp(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}
