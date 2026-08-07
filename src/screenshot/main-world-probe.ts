import type { FrameworkProbeEntry } from "../shared/protocol.ts";

/**
 * 在页面主世界运行的框架组件探针。
 *
 * 为什么需要主世界：content script 运行在 Chrome 的隔离世界，页面框架
 * （Vue/React）挂在 DOM 元素上的 __vue__/__reactFiber$ 等 expando 属性
 * 属于页面主世界，content script 永远读不到。因此由 background 以
 * chrome.scripting.executeScript({ world: "MAIN" }) 将该函数序列化注入页面。
 *
 * 注意：该函数会被 toString() 序列化后注入，必须完全自包含——
 * 除类型（编译期擦除）与标准全局外不得引用任何模块作用域成员。
 */
export function runMainWorldFrameworkProbe(
  probeIds: string[]
): Record<string, FrameworkProbeEntry | null> {
  const MAX_PATH = 8;
  const MAX_HOPS = 15;

  const sanitizeValue = (val: any, depth = 0, seen = new WeakSet()): any => {
    if (val === null || val === undefined) return val;
    if (
      typeof val === "boolean" ||
      typeof val === "number" ||
      typeof val === "string"
    ) {
      return val;
    }
    if (depth >= 3) return "[Truncated]";
    if (typeof val === "function") return "[Function]";
    if (typeof val === "object") {
      if (seen.has(val)) return "[Circular]";
      seen.add(val);
      if (Array.isArray(val)) {
        return val
          .slice(0, 10)
          .map((item) => sanitizeValue(item, depth + 1, seen));
      }
      const res: Record<string, any> = {};
      const keys = Object.keys(val).slice(0, 20);
      for (const k of keys) {
        if (
          /^(token|cookie|auth|authorization|secret|password|jwt|session|bearer|key)$/i.test(
            k
          )
        ) {
          res[k] = "[REDACTED_SENSITIVE_KEY]";
        } else {
          res[k] = sanitizeValue(val[k], depth + 1, seen);
        }
      }
      return res;
    }
    return String(val);
  };

  const extractVueState = (vnodeOrVm: any) => {
    let rawProps: any = null;
    let rawData: any = null;
    if (vnodeOrVm) {
      if (vnodeOrVm.props) rawProps = vnodeOrVm.props;
      else if (vnodeOrVm.$props) rawProps = vnodeOrVm.$props;

      if (vnodeOrVm.data) rawData = vnodeOrVm.data;
      else if (vnodeOrVm.setupState) rawData = vnodeOrVm.setupState;
      else if (vnodeOrVm.$data) rawData = vnodeOrVm.$data;
    }
    return {
      props: rawProps ? sanitizeValue(rawProps) : undefined,
      data: rawData ? sanitizeValue(rawData) : undefined,
    };
  };

  const push = (path: string[], name: string | undefined): void => {
    if (!name || name === "undefined") return;
    if (/^[a-z]/.test(name)) return;
    const normalized = name.replace(/^<|>$/g, "");
    if (!path.includes(normalized)) path.push(normalized);
  };

  const detect = (el: Element): FrameworkProbeEntry | null => {
    const rawPath: string[] = [];
    let stateInfo: { props?: any; data?: any } | undefined;

    try {
      // React Fiber：__reactFiber$ 挂在每个 DOM 元素自身
      let fiberKey: string | undefined;
      for (const k of Object.getOwnPropertyNames(el)) {
        if (
          k.startsWith("__reactFiber$") ||
          k.startsWith("__reactInternalInstance$")
        ) {
          fiberKey = k;
          break;
        }
      }
      if (fiberKey) {
        let fiber = (el as any)[fiberKey];
        let hops = 0;
        while (fiber && hops < MAX_HOPS) {
          const type = fiber.type;
          push(
            rawPath,
            typeof type === "function"
              ? type.name || type.displayName
              : typeof type === "object" && type
                ? type.displayName || type.name
                : undefined
          );
          fiber = fiber.return;
          hops += 1;
          if (rawPath.length >= MAX_PATH) break;
        }
        const fullPath = [...rawPath].reverse();
        return fullPath.length
          ? {
              componentName: fullPath[fullPath.length - 1],
              componentPath: fullPath,
              framework: "react",
              version: 18,
            }
          : null;
      }

      // Vue：__vueParentComponent$ / __vueParentComponent / __vnode / __vue__
      let host: Element | null = el;
      while (host) {
        const anyHost = host as any;
        const vnode3 =
          anyHost.__vueParentComponent$ || anyHost.__vueParentComponent;
        if (vnode3) {
          let vnode = vnode3;
          let hops = 0;
          stateInfo = extractVueState(vnode);
          while (vnode && hops < MAX_HOPS) {
            const type = vnode.type;
            push(rawPath, type?.name || type?.__name);
            vnode = vnode.parent;
            hops += 1;
            if (rawPath.length >= MAX_PATH) break;
          }
          const fullPath = [...rawPath].reverse();
          return fullPath.length
            ? {
                componentName: fullPath[fullPath.length - 1],
                componentPath: fullPath,
                framework: "vue",
                version: 3,
                props: stateInfo?.props,
                data: stateInfo?.data,
              }
            : null;
        }
        const vnodeFromEl = anyHost.__vnode;
        if (vnodeFromEl && vnodeFromEl.component) {
          let vnode = vnodeFromEl.component;
          let hops = 0;
          stateInfo = extractVueState(vnode);
          while (vnode && hops < MAX_HOPS) {
            const type = vnode.type;
            push(rawPath, type?.name || type?.__name);
            vnode = vnode.parent;
            hops += 1;
            if (rawPath.length >= MAX_PATH) break;
          }
          const fullPath = [...rawPath].reverse();
          return fullPath.length
            ? {
                componentName: fullPath[fullPath.length - 1],
                componentPath: fullPath,
                framework: "vue",
                version: 3,
                props: stateInfo?.props,
                data: stateInfo?.data,
              }
            : null;
        }
        const vue2 = anyHost.__vue__;
        if (vue2) {
          let vm = vue2;
          let hops = 0;
          stateInfo = extractVueState(vm);
          while (vm && hops < MAX_HOPS) {
            const options = vm.$options;
            push(rawPath, options?.name || options?._componentTag);
            vm = vm.$parent;
            hops += 1;
            if (rawPath.length >= MAX_PATH) break;
          }
          const fullPath = [...rawPath].reverse();
          return fullPath.length
            ? {
                componentName: fullPath[fullPath.length - 1],
                componentPath: fullPath,
                framework: "vue",
                version: 2,
                props: stateInfo?.props,
                data: stateInfo?.data,
              }
            : null;
        }

        // 检查 Vue 3 根挂载点特征 __vue_app__
        const vueApp = anyHost.__vue_app__;
        if (vueApp && vueApp._instance) {
          let vnode = vueApp._instance;
          let hops = 0;
          stateInfo = extractVueState(vnode);
          while (vnode && hops < MAX_HOPS) {
            const type = vnode.type;
            push(rawPath, type?.name || type?.__name);
            vnode = vnode.parent;
            hops += 1;
            if (rawPath.length >= MAX_PATH) break;
          }
          const fullPath = [...rawPath].reverse();
          return fullPath.length
            ? {
                componentName: fullPath[fullPath.length - 1],
                componentPath: fullPath,
                framework: "vue",
                version: 3,
                props: stateInfo?.props,
                data: stateInfo?.data,
              }
            : null;
        }

        host = host.parentElement;
      }

      // 如果通过 DOM 上溯没找到组件关联，尝试检查通过 DevTools Hook 注入注册的 Vue 实例
      const hook = (window as any).__VUE_DEVTOOLS_GLOBAL_HOOK__;
      if (hook && hook.apps && hook.apps.length > 0) {
        for (let a = 0; a < hook.apps.length; a++) {
          const appInstance = hook.apps[a]._instance;
          if (appInstance) {
            let vnode = appInstance;
            let hops = 0;
            stateInfo = extractVueState(vnode);
            while (vnode && hops < MAX_HOPS) {
              const type = vnode.type;
              push(rawPath, type?.name || type?.__name);
              vnode = vnode.subTree?.component || vnode.parent;
              hops += 1;
              if (rawPath.length >= MAX_PATH) break;
            }
            const fullPath = [...rawPath].reverse();
            if (fullPath.length > 0) {
              return {
                componentName: fullPath[fullPath.length - 1],
                componentPath: fullPath,
                framework: "vue",
                version: 3,
                props: stateInfo?.props,
                data: stateInfo?.data,
              };
            }
          }
        }
      }
      return null;
    } catch {
      return null;
    }
  };

  const results: Record<string, FrameworkProbeEntry | null> = {};
  try {
    const els = document.querySelectorAll("[data-bug-lens-probe-id]");
    for (let i = 0; i < els.length; i++) {
      const el = els[i] as Element;
      const id = el.getAttribute("data-bug-lens-probe-id");
      if (id && probeIds.indexOf(id) !== -1) {
        results[id] = detect(el);
      }
    }
  } catch {
    return results;
  }
  return results;
}
