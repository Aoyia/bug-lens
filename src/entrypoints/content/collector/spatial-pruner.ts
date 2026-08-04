import { buildDomSnapshot } from "./dom-snapshot";
import type { TargetDomSnapshot } from "../../../shared/protocol";
import { detectReact } from "../react-detector";
import { detectVue } from "../vue-detector";

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SpatialSnapshotResult {
  boundingBox: BoundingBox;
  nodes: TargetDomSnapshot[];
  components: Array<{
    framework: "react" | "vue";
    name: string;
    props?: Record<string, unknown>;
    state?: Record<string, unknown>;
  }>;
}

/**
 * 判断两个矩形区域是否有相交部分
 */
export function isRectIntersecting(
  rectA: BoundingBox,
  rectB: BoundingBox
): boolean {
  return !(
    rectA.x + rectA.width < rectB.x ||
    rectB.x + rectB.width < rectA.x ||
    rectA.y + rectA.height < rectB.y ||
    rectB.y + rectB.height < rectA.y
  );
}

/**
 * 空间 DOM & Component 剪枝器
 * 针对拖拽框选的矩形区域进行深度匹配与剪枝，只保留相交的 DOM 与 React/Vue 组件 State
 */
export class SpatialPruner {
  /**
   * 收集并剪枝给定坐标矩形内的所有 DOM 节点与前端框架组件
   */
  public static extractSpatialSnapshot(
    box: BoundingBox,
    privacyMode: "safe" | "raw" = "safe"
  ): SpatialSnapshotResult {
    const matchedElements: Element[] = [];
    const matchedComponents: Array<{
      framework: "react" | "vue";
      name: string;
      props?: Record<string, unknown>;
      state?: Record<string, unknown>;
    }> = [];
    const visitedComponentNames = new Set<string>();

    // 遍历 DOM 树元素，匹配在 BoundingBox 范围内的可视节点
    const allElements = Array.from(document.querySelectorAll("*"));
    for (const el of allElements) {
      // 忽略不可见节点
      if (!(el instanceof HTMLElement) && !(el instanceof SVGElement)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;

      const elementBox: BoundingBox = {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      };

      if (isRectIntersecting(box, elementBox)) {
        matchedElements.push(el);

        // 尝试检测 React 组件
        try {
          if (el instanceof HTMLElement) {
            const reactInfo = detectReact(el);
            if (
              reactInfo?.targetComponent &&
              !visitedComponentNames.has(
                reactInfo.targetComponent.componentName
              )
            ) {
              visitedComponentNames.add(
                reactInfo.targetComponent.componentName
              );
              matchedComponents.push({
                framework: "react",
                name: reactInfo.targetComponent.componentName,
                props: reactInfo.targetComponent.props as Record<
                  string,
                  unknown
                >,
                state: reactInfo.targetComponent.state as Record<
                  string,
                  unknown
                >,
              });
            }
          }
        } catch {
          // ignore detection errors
        }

        // 尝试检测 Vue 组件
        try {
          if (el instanceof HTMLElement) {
            const vueInfo = detectVue(el);
            if (
              vueInfo?.targetComponent &&
              !visitedComponentNames.has(vueInfo.targetComponent.componentName)
            ) {
              visitedComponentNames.add(vueInfo.targetComponent.componentName);
              matchedComponents.push({
                framework: "vue",
                name: vueInfo.targetComponent.componentName,
                props: vueInfo.targetComponent.props as Record<string, unknown>,
                state: vueInfo.targetComponent.state as Record<string, unknown>,
              });
            }
          }
        } catch {
          // ignore detection errors
        }
      }
    }

    // 将匹配到的前 N 个关键 DOM 节点打成轻量级 TargetDomSnapshot
    // 为防 payload 放大，限制深度匹配前 10 个顶层/重要节点
    const nodes = matchedElements
      .slice(0, 10)
      .map((el) => buildDomSnapshot(el, privacyMode));

    return {
      boundingBox: box,
      nodes,
      components: matchedComponents,
    };
  }
}
