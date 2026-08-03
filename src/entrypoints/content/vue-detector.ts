import type {
  VueComponentNode,
  VueFrameworkSnapshot,
  VueStoreSnapshot,
} from "../../shared/protocol";

const SENSITIVE_KEY_REGEX =
  /(password|token|secret|auth|creditcard|phone|mobile|idcard|jwt|bearer|private)/i;

/**
 * 安全且包含敏感脱敏的序列化函数
 */
function redactAndSanitize(
  obj: any,
  currentDepth = 0,
  maxDepth = 3,
  visited = new WeakSet()
): any {
  if (obj === null || obj === undefined) {
    return undefined;
  }
  const type = typeof obj;
  if (type === "number" || type === "boolean" || type === "string") {
    return obj;
  }
  if (type !== "object") {
    return undefined; // 过滤函数、Symbol 等
  }
  if (obj instanceof HTMLElement || obj instanceof Node) {
    return undefined; // 过滤 DOM 引用
  }
  if (visited.has(obj)) {
    return "[CIRCULAR]";
  }
  if (currentDepth >= maxDepth) {
    return "[MAX_DEPTH]";
  }

  visited.add(obj);

  if (Array.isArray(obj)) {
    return obj
      .slice(0, 10)
      .map((item) =>
        redactAndSanitize(item, currentDepth + 1, maxDepth, visited)
      );
  }

  const result: Record<string, any> = {};
  const keys = Object.keys(obj).slice(0, 20); // 最多只截取前 20 个 Key

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
        if (val !== undefined) {
          result[key] = val;
        }
      } catch {
        result[key] = "[UNSERIALIZABLE]";
      }
    }
  }

  return result;
}

/**
 * 从 Vue 3 component 提取 VueComponentNode
 */
function extractVue3Component(
  comp: any,
  isTarget = false
): VueComponentNode | undefined {
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
    version: 3,
    componentName,
    props: Object.keys(props || {}).length > 0 ? props : undefined,
    state: Object.keys(state || {}).length > 0 ? state : undefined,
    isTarget,
  };
}

/**
 * 从 Vue 2 vm 提取 VueComponentNode
 */
function extractVue2Component(
  vm: any,
  isTarget = false
): VueComponentNode | undefined {
  if (!vm) return undefined;
  const rawName = vm.$options?.name || vm.$options?._componentTag;
  const componentName =
    rawName && rawName !== "" ? rawName : "AnonymousComponent";

  const props = vm.$props ? redactAndSanitize(vm.$props) : undefined;
  const state = vm._data ? redactAndSanitize(vm._data) : undefined;

  return {
    version: 2,
    componentName,
    props: Object.keys(props || {}).length > 0 ? props : undefined,
    state: Object.keys(state || {}).length > 0 ? state : undefined,
    isTarget,
  };
}

/**
 * 提取 Pinia 及 Vuex 快照
 */
function extractStores(rootInstance: any): VueStoreSnapshot[] | undefined {
  const stores: VueStoreSnapshot[] = [];

  try {
    // 1. 尝试提取 Pinia
    const pinia =
      rootInstance?.appContext?.config?.globalProperties?.$pinia ||
      (window as any).__pinia;
    if (pinia && pinia._s) {
      const storeMap = pinia._s;
      storeMap.forEach((store: any, storeId: string) => {
        if (store && store.$state) {
          const sanitizedState = redactAndSanitize(store.$state);
          stores.push({
            type: "pinia",
            storeId,
            state: sanitizedState || {},
          });
        }
      });
    }

    // 2. 尝试提取 Vuex
    const vuexStore =
      rootInstance?.appContext?.config?.globalProperties?.$store ||
      rootInstance?.$store ||
      (window as any).__vuex_store__;
    if (vuexStore && vuexStore.state) {
      const sanitizedState = redactAndSanitize(vuexStore.state);
      stores.push({
        type: "vuex",
        storeId: "root",
        state: sanitizedState || {},
      });
    }
  } catch (e) {
    // 忽略提取过程中的异常
  }

  return stores.length > 0 ? stores : undefined;
}

/**
 * 判断当前页面是否属于 Vue 项目 (Vue 2 或 Vue 3)
 */
export function isVueProject(): boolean {
  if (typeof window === "undefined" || !document) return false;

  const w = window as any;
  // 1. 全局变量/标志位检测
  if (
    w.__VUE__ ||
    w.Vue ||
    (w.__VUE_DEVTOOLS_GLOBAL_HOOK__?.apps &&
      w.__VUE_DEVTOOLS_GLOBAL_HOOK__.apps.length > 0)
  ) {
    return true;
  }

  // 2. DOM 节点特征属性检测 (Vue 作用域属性如 data-v-* 或 Vue 3 app 挂载点)
  try {
    if (
      document.querySelector("[data-v-app]") ||
      document.querySelector("[data-v-]") ||
      document.querySelector("#app[data-v-]")
    ) {
      return true;
    }
  } catch {
    // 忽略 querySelector 异常
  }

  // 3. 核心挂载点实例检测 (#app, #__nuxt, body)
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

/**
 * 尝试探索目标 DOM 元素的 Vue 组件树及状态
 */
export function detectVue(
  targetElement: HTMLElement
): VueFrameworkSnapshot | undefined {
  if (!targetElement) return undefined;

  // 先判定当前页面是否是 Vue 项目，如果不是则不进行探针抓取
  if (!isVueProject()) {
    return undefined;
  }

  let curr: HTMLElement | null = targetElement;
  let vue3Comp: any = null;
  let vue2Vm: any = null;

  // 1. 探索性向上冒泡寻找最近的 Vue 实例节点
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

  const parentChain: VueComponentNode[] = [];
  const childrenComponents: VueComponentNode[] = [];

  if (vue3Comp) {
    const targetComponent = extractVue3Component(vue3Comp, true);

    // 2. 追溯 Vue 3 父节点链
    let parent = vue3Comp.parent;
    while (parent) {
      const node = extractVue3Component(parent);
      if (node) {
        parentChain.unshift(node);
      }
      parent = parent.parent;
    }

    // 3. 向下浅层探索子节点
    try {
      const childrenNodes = targetElement.querySelectorAll("*");
      let count = 0;
      for (let i = 0; i < childrenNodes.length && count < 5; i++) {
        const childEl = childrenNodes[i];
        const childComp =
          (childEl as any).__vueParentComponent ||
          (childEl as any).__vnode?.component;
        if (childComp && childComp !== vue3Comp) {
          const childNode = extractVue3Component(childComp);
          if (
            childNode &&
            !childrenComponents.some(
              (c) => c.componentName === childNode.componentName
            )
          ) {
            childrenComponents.push(childNode);
            count++;
          }
        }
      }
    } catch {
      // 忽略
    }

    // 4. 提取 Stores
    const stores = extractStores(vue3Comp);

    return {
      version: 3,
      targetComponent,
      parentChain,
      childrenComponents,
      stores,
    };
  }

  if (vue2Vm) {
    const targetComponent = extractVue2Component(vue2Vm, true);

    // 2. 追溯 Vue 2 父节点链
    let parent = vue2Vm.$parent;
    while (parent) {
      const node = extractVue2Component(parent);
      if (node) {
        parentChain.unshift(node);
      }
      parent = parent.$parent;
    }

    // 3. 向下浅层探索子节点
    try {
      const childrenNodes = targetElement.querySelectorAll("*");
      let count = 0;
      for (let i = 0; i < childrenNodes.length && count < 5; i++) {
        const childEl = childrenNodes[i];
        const childVm = (childEl as any).__vue__;
        if (childVm && childVm !== vue2Vm) {
          const childNode = extractVue2Component(childVm);
          if (
            childNode &&
            !childrenComponents.some(
              (c) => c.componentName === childNode.componentName
            )
          ) {
            childrenComponents.push(childNode);
            count++;
          }
        }
      }
    } catch {
      // 忽略
    }

    // 4. 提取 Stores
    const stores = extractStores(vue2Vm);

    return {
      version: 2,
      targetComponent,
      parentChain,
      childrenComponents,
      stores,
    };
  }

  return undefined;
}
