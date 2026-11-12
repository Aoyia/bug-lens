import type {
  FrameworkComponentNode,
  FrameworkSnapshot,
} from "../../shared/protocol";
import { redactAndSanitizeState } from "../../domain/privacy-policy";

const VUE_SENSITIVE_KEY_REGEX =
  /(password|token|secret|auth|cookie|authorization|jwt|bearer)/i;

function redactAndSanitize(obj: any): any {
  return redactAndSanitizeState(
    obj,
    0,
    3,
    new WeakSet(),
    VUE_SENSITIVE_KEY_REGEX
  );
}

function extractVue3Component(
  comp: any,
  isTarget = false
): FrameworkComponentNode | undefined {
  if (!comp) return undefined;
  const rawName =
    comp.type?.__name || comp.type?.name || comp.type?.options?.name;
  const componentName =
    rawName && rawName !== "" ? rawName : "AnonymousComponent";

  const props = comp.props ? redactAndSanitize(comp.props) : undefined;
  const state = comp.setupState
    ? redactAndSanitize(comp.setupState)
    : comp.data
      ? redactAndSanitize(comp.data)
      : undefined;

  return {
    framework: "vue",
    version: 3,
    componentName,
    props: props && Object.keys(props).length > 0 ? props : undefined,
    state: state && Object.keys(state).length > 0 ? state : undefined,
    isTarget,
  };
}

function extractVue2Component(
  vm: any,
  isTarget = false
): FrameworkComponentNode | undefined {
  if (!vm) return undefined;
  const rawName = vm.$options?.name || vm.$options?._componentTag;
  const componentName =
    rawName && rawName !== "" ? rawName : "AnonymousComponent";

  const props = vm.$props ? redactAndSanitize(vm.$props) : undefined;
  const state = vm._data ? redactAndSanitize(vm._data) : undefined;

  return {
    framework: "vue",
    version: 2,
    componentName,
    props: props && Object.keys(props).length > 0 ? props : undefined,
    state: state && Object.keys(state).length > 0 ? state : undefined,
    isTarget,
  };
}

export function isVueProject(): boolean {
  if (typeof window === "undefined" || !document) return false;

  const w = window as any;
  if (
    w.__VUE__ ||
    w.Vue ||
    (w.__VUE_DEVTOOLS_GLOBAL_HOOK__?.apps &&
      w.__VUE_DEVTOOLS_GLOBAL_HOOK__.apps.length > 0)
  ) {
    return true;
  }

  try {
    if (
      document.querySelector("[data-v-app]") ||
      document.querySelector("[data-v-]") ||
      document.querySelector("#app[data-v-]")
    ) {
      return true;
    }
  } catch {}

  const candidates = [
    document.getElementById("app"),
    document.getElementById("__nuxt"),
    document.body,
  ];
  for (const el of candidates) {
    if (
      el &&
      ((el as any).__vue__ ||
        (el as any).__vueParentComponent ||
        (el as any).__vnode)
    ) {
      return true;
    }
  }

  return false;
}

function buildVueTree(
  comp: any,
  isVue3: boolean,
  depth = 0,
  maxDepth = 6
): FrameworkComponentNode | undefined {
  if (!comp || depth > maxDepth) return undefined;

  const node = isVue3 ? extractVue3Component(comp) : extractVue2Component(comp);
  if (!node) return undefined;

  const children: FrameworkComponentNode[] = [];
  if (isVue3) {
    try {
      const subTree = comp.subTree;
      if (subTree && subTree.children) {
        let siblingCount = 0;
        for (const child of subTree.children) {
          if (siblingCount >= 20) break;
          if (child.component && child.component !== comp) {
            const childNode = buildVueTree(
              child.component,
              true,
              depth + 1,
              maxDepth
            );
            if (childNode) {
              children.push(childNode);
              siblingCount++;
            }
          }
        }
      }
    } catch {}
  } else {
    try {
      if (comp.$children) {
        let siblingCount = 0;
        for (const child of comp.$children) {
          if (siblingCount >= 20) break;
          const childNode = buildVueTree(child, false, depth + 1, maxDepth);
          if (childNode) {
            children.push(childNode);
            siblingCount++;
          }
        }
      }
    } catch {}
  }

  if (children.length > 0) {
    node.children = children;
  }

  return node;
}

export function detectVue(
  targetElement: HTMLElement
): FrameworkSnapshot | undefined {
  if (!targetElement) return undefined;

  if (!isVueProject()) {
    return undefined;
  }

  let curr: HTMLElement | null = targetElement;
  let vue3Comp: any = null;
  let vue2Vm: any = null;

  while (curr && curr !== document.body) {
    const comp3 =
      (curr as any).__vueParentComponent || (curr as any).__vnode?.component;
    if (comp3) {
      vue3Comp = comp3;
      break;
    }

    const vm2 = (curr as any).__vue__;
    if (vm2) {
      vue2Vm = vm2;
      break;
    }

    curr = curr.parentElement;
  }

  if (!vue3Comp && !vue2Vm) {
    return undefined;
  }

  const parentChain: FrameworkComponentNode[] = [];

  if (vue3Comp) {
    const targetComponent = extractVue3Component(vue3Comp, true);

    let parent = vue3Comp.parent;
    while (parent) {
      const node = extractVue3Component(parent);
      if (node) {
        parentChain.unshift(node);
      }
      parent = parent.parent;
    }

    let rootInstance =
      parentChain.length > 0
        ? (() => {
            let p = vue3Comp.parent;
            while (p && p.parent) p = p.parent;
            return p;
          })()
        : vue3Comp;
    if (!rootInstance) rootInstance = vue3Comp;

    const rootComponent = buildVueTree(rootInstance, true);

    return {
      targetComponent,
      rootComponent,
      parentChain,
    };
  }

  if (vue2Vm) {
    const targetComponent = extractVue2Component(vue2Vm, true);

    let parent = vue2Vm.$parent;
    while (parent) {
      const node = extractVue2Component(parent);
      if (node) {
        parentChain.unshift(node);
      }
      parent = parent.$parent;
    }

    const rootVm =
      parentChain.length > 0
        ? (() => {
            let p = vue2Vm.$parent;
            while (p && p.$parent) p = p.$parent;
            return p;
          })()
        : vue2Vm;

    const rootComponent = buildVueTree(rootVm, false);

    return {
      targetComponent,
      rootComponent,
      parentChain,
    };
  }

  return undefined;
}

/**
 * 独立证据流：无需目标元素，直接捕获整棵 Vue 组件树（脱敏）。
 * 优先使用 DevTools hook 暴露的根实例，其次从 document.body 上溯根实例。
 */
export function captureVueTree(): FrameworkSnapshot | undefined {
  if (!isVueProject()) return undefined;

  const hook = (window as any).__VUE_DEVTOOLS_GLOBAL_HOOK__;
  if (hook?.apps && hook.apps.length > 0) {
    const rootComponent = buildVueTree(hook.apps[0], true);
    if (rootComponent) return { rootComponent, parentChain: [] };
  }

  try {
    const mount = document.getElementById("app") ?? document.body;
    const comp3 = (mount as any).__vueParentComponent;
    if (comp3) {
      let root = comp3;
      while (root.parent) root = root.parent;
      const rootComponent = buildVueTree(root, true);
      if (rootComponent) return { rootComponent, parentChain: [] };
    }
    const vm2 = (mount as any).__vue__;
    if (vm2) {
      let root = vm2;
      while (root.$parent) root = root.$parent;
      const rootComponent = buildVueTree(root, false);
      if (rootComponent) return { rootComponent, parentChain: [] };
    }
  } catch {
    return undefined;
  }

  return undefined;
}
