import type {
  FrameworkComponentNode,
  FrameworkSnapshot,
} from "../../shared/protocol";

const SENSITIVE_KEY_REGEX =
  /(password|token|secret|auth|creditcard|phone|mobile|idcard|jwt|bearer|private)/i;

function redactAndSanitize(
  obj: any,
  currentDepth = 0,
  maxDepth = 3,
  visited = new WeakSet()
): any {
  if (obj === null || obj === undefined) return undefined;
  const type = typeof obj;
  if (type === "number" || type === "boolean" || type === "string") return obj;
  if (type !== "object") return undefined;
  if (obj instanceof HTMLElement || obj instanceof Node) return undefined;
  if (visited.has(obj)) return "[CIRCULAR]";
  if (currentDepth >= maxDepth) return "[MAX_DEPTH]";

  visited.add(obj);

  if (Array.isArray(obj)) {
    return obj
      .slice(0, 10)
      .map((item) =>
        redactAndSanitize(item, currentDepth + 1, maxDepth, visited)
      );
  }

  const result: Record<string, any> = {};
  const keys = Object.keys(obj).slice(0, 20);

  for (const key of keys) {
    if (SENSITIVE_KEY_REGEX.test(key)) {
      result[key] = "[REDACTED:sensitive-store-key]";
    } else {
      try {
        const val = redactAndSanitize(
          obj[key],
          currentDepth + 1,
          maxDepth,
          visited
        );
        if (val !== undefined) result[key] = val;
      } catch {
        result[key] = "[UNSERIALIZABLE]";
      }
    }
  }

  return result;
}

const REACT_FIBER_KEY_PREFIX = "__reactFiber$";

function getFiberKey(el: Element): string | undefined {
  for (const key of Object.getOwnPropertyNames(el)) {
    if (key.startsWith(REACT_FIBER_KEY_PREFIX)) return key;
  }
  return undefined;
}

function getClosestFiber(
  element: HTMLElement
): object | undefined {
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
  isTarget = false
): FrameworkComponentNode | undefined {
  if (!fiber || !isComponentFiber(fiber)) return undefined;
  const name = extractComponentName(fiber);
  if (!name) return undefined;

  return {
    framework: "react",
    version: 18,
    componentName: name,
    props: extractFiberProps(fiber),
    state: extractFiberState(fiber),
    isTarget,
  };
}

function buildReactTree(
  fiber: any,
  depth = 0,
  maxDepth = 6
): FrameworkComponentNode | undefined {
  if (!fiber || depth > maxDepth) return undefined;
  if (!isComponentFiber(fiber)) return undefined;

  const name = extractComponentName(fiber);
  if (!name) return undefined;

  const node: FrameworkComponentNode = {
    framework: "react",
    version: 18,
    componentName: name,
    props: extractFiberProps(fiber),
    state: extractFiberState(fiber),
  };

  const children: FrameworkComponentNode[] = [];
  let child = fiber.child;
  let siblingCount = 0;

  while (child && siblingCount < 20) {
    if (isComponentFiber(child)) {
      const childNode = buildReactTree(child, depth + 1, maxDepth);
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
  } catch {
  }

  try {
    const root = document.getElementById("root");
    if (root) {
      const fiberKey = getFiberKey(root);
      if (fiberKey) return true;
    }
  } catch {
  }

  try {
    if (document.querySelector("#root, [data-reactroot]")) return true;
  } catch {
  }

  return false;
}

export function detectReact(
  targetElement: HTMLElement
): FrameworkSnapshot | undefined {
  if (!targetElement) return undefined;

  if (!isReactProject()) return undefined;

  const fiber = getClosestFiber(targetElement);
  if (!fiber) return undefined;

  const targetComponent = extractFiberNode(fiber, true);
  if (!targetComponent) return undefined;

  const parentChain: FrameworkComponentNode[] = [];
  let parent = (fiber as any).return;
  while (parent) {
    if (isComponentFiber(parent)) {
      const node = extractFiberNode(parent);
      if (node) {
        parentChain.unshift(node);
      }
    }
    parent = parent.return;
  }

  const rootFiber = getRootFiber(fiber as any);
  const rootChild = rootFiber ? rootFiber.child : null;
  const rootComponent = rootChild
    ? buildReactTree(rootChild, 0, 6)
    : undefined;

  return {
    targetComponent,
    rootComponent,
    parentChain,
  };
}