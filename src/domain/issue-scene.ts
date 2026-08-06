import type {
  AnnotationModel,
  CaptureIssue,
  ExpectedStatement,
  IssueScene,
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

function clamp(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}
