import type { AnnotationModel, CaptureIssue, IssueScene, TargetDomSnapshot } from "../shared/protocol.ts";

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
    point: { xRatio: clamp(point.clientX / width), yRatio: clamp(point.clientY / height) },
    targetBox: target ? {
      xRatio: clamp(target.x / width),
      yRatio: clamp(target.y / height),
      widthRatio: clamp(target.width / width),
      heightRatio: clamp(target.height / height)
    } : undefined
  };
}

export function normalizeAnnotation(annotation: AnnotationModel): AnnotationModel {
  return {
    ...annotation,
    point: { xRatio: clamp(annotation.point.xRatio), yRatio: clamp(annotation.point.yRatio) },
    targetBox: annotation.targetBox ? {
      xRatio: clamp(annotation.targetBox.xRatio),
      yRatio: clamp(annotation.targetBox.yRatio),
      widthRatio: clamp(annotation.targetBox.widthRatio),
      heightRatio: clamp(annotation.targetBox.heightRatio)
    } : undefined,
    targetBoxes: annotation.targetBoxes?.map((box) => ({
      xRatio: clamp(box.xRatio),
      yRatio: clamp(box.yRatio),
      widthRatio: clamp(box.widthRatio),
      heightRatio: clamp(box.heightRatio)
    })),
    userAnnotations: annotation.userAnnotations?.map((item) => {
      if (item.type === "rect") {
        return {
          type: "rect" as const,
          color: item.color || "#165dff",
          xRatio: clamp(item.xRatio),
          yRatio: clamp(item.yRatio),
          widthRatio: clamp(item.widthRatio),
          heightRatio: clamp(item.heightRatio)
        };
      }
      if (item.type === "arrow") {
        return {
          type: "arrow" as const,
          color: item.color || "#165dff",
          startXRatio: clamp(item.startXRatio),
          startYRatio: clamp(item.startYRatio),
          endXRatio: clamp(item.endXRatio),
          endYRatio: clamp(item.endYRatio)
        };
      }
      return {
        type: "text" as const,
        color: item.color || "#165dff",
        xRatio: clamp(item.xRatio),
        yRatio: clamp(item.yRatio),
        text: item.text.trim().slice(0, 100),
        fontSize: item.fontSize
      };
    }),
    label: annotation.label?.trim().slice(0, 80) || undefined
  };
}

export function withIssueNarrative(scene: IssueScene, narrative: IssueScene["narrative"], annotation: AnnotationModel): IssueScene {
  const actual = narrative?.actual?.trim() ?? "";
  return {
    ...scene,
    status: "committed",
    committedAtEpochMs: Date.now(),
    narrative: {
      actual,
      expected: narrative?.expected?.trim() || undefined,
      note: narrative?.note?.trim() || undefined
    },
    annotation: normalizeAnnotation(annotation)
  };
}

export function markIssueSceneResult(scene: IssueScene, result: "complete" | "partial" | "failed", issue?: CaptureIssue): IssueScene {
  return {
    ...scene,
    status: result,
    issues: issue ? [...scene.issues, issue] : scene.issues
  };
}

export function buildTargetSnapshot(element: TargetDomSnapshot): TargetDomSnapshot {
  return {
    ...element,
    capturedAtEpochMs: element.capturedAtEpochMs || Date.now(),
    ancestors: element.ancestors.slice(0, 5),
    computedStyle: Object.fromEntries(Object.entries(element.computedStyle).slice(0, 20))
  };
}

function clamp(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}
