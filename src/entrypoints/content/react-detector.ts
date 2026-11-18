import type {
  FrameworkComponentNode,
  FrameworkSnapshot,
} from "../../shared/protocol";
import { redactAndSanitizeState as redactAndSanitize } from "../../domain/privacy-policy";

const REACT_FIBER_KEY_PREFIX = "__reactFiber$";

/** 解析 "19.2.8" / "18.3.1" 这类版本号的主版本；非法值返回 undefined。 */
function parseReactMajorVersion(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const matched = value.match(/^(\d{1,2})\./);
  if (!matched) return undefined;
  const major = parseInt(matched[1], 10);
  return major >= 15 && major <= 30 ? major : undefined;
}

/**
 * 从 React DevTools 全局 hook 的 renderer 描述读取真实主版本。
 *
 * 注意：content script 运行在隔离世界，`window` 是隔离世界自己的全局对象，
 * 读不到页面主世界写入的 `__REACT_DEVTOOLS_GLOBAL_HOOK__`（该 hook 只能由
 * background 以 world:"MAIN" 注入的探针读取，见 main-world-probe.ts）。
 * 因此本函数在隔离世界里通常返回 0（未知）。isolated world 命中 fiber 属于
 * 理论上的边界情况，此时版本未知必须标记为 0，不能伪造成某个具体版本。
 */
function readReactMajorFromDevToolsHook(): number {
  try {
    const host: any = typeof window !== "undefined" ? window : undefined;
    const container = host?.__REACT_DEVTOOLS_GLOBAL_HOOK__?.renderers;
    if (!container) return 0;
    const renderers: any[] = [];
    if (typeof container.forEach === "function") {
      container.forEach((renderer: any) => {
        renderers.push(renderer);
      });
    } else if (typeof container === "object") {
      for (const key of Object.keys(container)) renderers.push(container[key]);
    }
    let fallback: number | undefined;
    for (const renderer of renderers) {
      if (!renderer || typeof renderer !== "object") continue;
      const major =
        parseReactMajorVersion(renderer.version) ??
        parseReactMajorVersion(renderer.reconcilerVersion);
      if (major === undefined) continue;
      if (renderer.rendererPackageName === "react-dom") return major;
      if (fallback === undefined) fallback = major;
    }
    return fallback ?? 0;
  } catch {
    return 0;
  }
}

function getFiberKey(el: Element): string | undefined {
  for (const key of Object.getOwnPropertyNames(el)) {
    if (key.startsWith(REACT_FIBER_KEY_PREFIX)) return key;
  }
  return undefined;
}

function getClosestFiber(element: HTMLElement): object | undefined {
  let curr: HTMLElement | null = element;
  while (curr && curr !== document.body) {
    const fiberKey = getFiberKey(curr);
    if (fiberKey) return (curr as any)[fiberKey];
    curr = curr.parentElement;
  }
  if (document.body) {
    const fiberKey = getFiberKey(document.body);
    if (fiberKey) return (document.body as any)[fiberKey];
  }
  return undefined;
}

function isComponentFiber(fiber: any): boolean {
  if (!fiber || typeof fiber !== "object") return false;
  const tag = fiber.tag;
  return (
    tag === 0 ||
    tag === 1 ||
    tag === 2 ||
    tag === 10 ||
    tag === 11 ||
    tag === 14 ||
    tag === 15 ||
    tag === 16 ||
    tag === 26 ||
    tag === 27
  );
}

function extractComponentName(fiber: any): string | undefined {
  if (!fiber || !fiber.type) return undefined;
  const type = fiber.type;
  if (typeof type === "string") return type;
  const name = type.displayName || type.name;
  if (name && name !== "" && name !== "_default") return name;
  if (type.$$typeof && type.$$typeof.toString() === "Symbol(react.forward_ref)")
    return "ForwardRef";
  return "Anonymous";
}

function extractFiberProps(fiber: any): Record<string, unknown> | undefined {
  if (!fiber || !fiber.memoizedProps) return undefined;
  const sanitized = redactAndSanitize(fiber.memoizedProps);
  if (sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)) {
    const keys = Object.keys(sanitized as Record<string, unknown>);
    return keys.length > 0 ? (sanitized as Record<string, unknown>) : undefined;
  }
  return undefined;
}

function extractFiberState(fiber: any): Record<string, unknown> | undefined {
  if (!fiber) return undefined;
  if (fiber.tag === 1 && fiber.stateNode) {
    const state = fiber.stateNode.state;
    if (state) {
      const sanitized = redactAndSanitize(state);
      if (
        sanitized &&
        typeof sanitized === "object" &&
        !Array.isArray(sanitized)
      ) {
        const keys = Object.keys(sanitized as Record<string, unknown>);
        return keys.length > 0
          ? (sanitized as Record<string, unknown>)
          : undefined;
      }
    }
  }
  return undefined;
}

function extractFiberNode(
  fiber: any,
  version: number,
  isTarget = false
): FrameworkComponentNode | undefined {
  if (!fiber || !isComponentFiber(fiber)) return undefined;
  const name = extractComponentName(fiber);
  if (!name) return undefined;

  return {
    framework: "react",
    version,
    componentName: name,
    props: extractFiberProps(fiber),
    state: extractFiberState(fiber),
    isTarget,
  };
}

function buildReactTree(
  fiber: any,
  version: number,
  depth = 0,
  maxDepth = 6
): FrameworkComponentNode | undefined {
  if (!fiber || depth > maxDepth) return undefined;
  if (!isComponentFiber(fiber)) return undefined;

  const name = extractComponentName(fiber);
  if (!name) return undefined;

  const node: FrameworkComponentNode = {
    framework: "react",
    version,
    componentName: name,
    props: extractFiberProps(fiber),
    state: extractFiberState(fiber),
  };

  const children: FrameworkComponentNode[] = [];
  let child = fiber.child;
  let siblingCount = 0;

  while (child && siblingCount < 20) {
    if (isComponentFiber(child)) {
      const childNode = buildReactTree(child, version, depth + 1, maxDepth);
      if (childNode) {
        children.push(childNode);
        siblingCount++;
      }
    }
    child = child.sibling;
  }

  if (children.length > 0) {
    node.children = children;
  }

  return node;
}

function getRootFiber(fiber: any): any {
  let current = fiber;
  while (current && current.return) {
    current = current.return;
  }
  return current;
}

export function isReactProject(): boolean {
  if (typeof window === "undefined" || !document) return false;

  const w = window as any;

  if (w.__REACT_DEVTOOLS_GLOBAL_HOOK__) return true;

  try {
    const fiberKey = getFiberKey(document.body);
    if (fiberKey) return true;
  } catch {}

  try {
    const root = document.getElementById("root");
    if (root) {
      const fiberKey = getFiberKey(root);
      if (fiberKey) return true;
    }
  } catch {}

  try {
    if (document.querySelector("#root, [data-reactroot]")) return true;
  } catch {}

  return false;
}

export function detectReact(
  targetElement: HTMLElement
): FrameworkSnapshot | undefined {
  if (!targetElement) return undefined;

  if (!isReactProject()) return undefined;

  const fiber = getClosestFiber(targetElement);
  if (!fiber) return undefined;

  const version = readReactMajorFromDevToolsHook();
  const targetComponent = extractFiberNode(fiber, version, true);
  if (!targetComponent) return undefined;

  const parentChain: FrameworkComponentNode[] = [];
  let parent = (fiber as any).return;
  while (parent) {
    if (isComponentFiber(parent)) {
      const node = extractFiberNode(parent, version);
      if (node) {
        parentChain.unshift(node);
      }
    }
    parent = parent.return;
  }

  const rootFiber = getRootFiber(fiber as any);
  const rootChild = rootFiber ? rootFiber.child : null;
  const rootComponent = rootChild
    ? buildReactTree(rootChild, version, 0, 6)
    : undefined;

  return {
    targetComponent,
    rootComponent,
    parentChain,
  };
}

/**
 * 独立证据流：无需目标元素，直接捕获整棵 React 组件树（脱敏）。
 * 若页面没有可识别的 fiber 挂载点则返回 undefined。
 */
export function captureReactTree(): FrameworkSnapshot | undefined {
  if (!isReactProject()) return undefined;

  let fiber: object | undefined;
  try {
    const root = document.body ?? document.documentElement;
    const key = root ? getFiberKey(root) : undefined;
    if (key) fiber = (root as any)[key];
    if (!fiber) {
      const appRoot =
        document.getElementById("root") ?? document.getElementById("app");
      if (appRoot) {
        const appKey = getFiberKey(appRoot);
        if (appKey) fiber = (appRoot as any)[appKey];
      }
    }
  } catch {
    return undefined;
  }
  if (!fiber) return undefined;

  const rootFiber = getRootFiber(fiber as any);
  const rootChild = rootFiber ? rootFiber.child : null;
  const version = readReactMajorFromDevToolsHook();
  const rootComponent = rootChild
    ? buildReactTree(rootChild, version, 0, 6)
    : undefined;
  if (!rootComponent) return undefined;

  return { rootComponent, parentChain: [] };
}
