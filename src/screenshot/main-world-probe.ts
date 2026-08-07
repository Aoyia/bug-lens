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
  const MAX_PATH = 5;
  const MAX_HOPS = 12;

  const push = (path: string[], name: string | undefined): void => {
    if (!name || name === "undefined") return;
    if (/^[a-z]/.test(name)) return;
    const normalized = `<${name}>`;
    if (!path.includes(normalized)) path.push(normalized);
  };

  const detect = (el: Element): FrameworkProbeEntry | null => {
    const path: string[] = [];
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
            path,
            typeof type === "function"
              ? type.name || type.displayName
              : typeof type === "object" && type
                ? type.displayName || type.name
                : undefined
          );
          fiber = fiber.return;
          hops += 1;
          if (path.length >= MAX_PATH) break;
        }
        return path.length
          ? {
              componentName: path[0],
              componentPath: path,
              framework: "react",
              version: 18,
            }
          : null;
      }

      // Vue：__vueParentComponent$ / __vueParentComponent / __vnode / __vue__
      // 仅挂在组件根 DOM 上，须沿 DOM 向上找最近组件根，再沿 parent 链收集组件名。
      let host: Element | null = el;
      while (host) {
        const anyHost = host as any;
        const vnode3 =
          anyHost.__vueParentComponent$ || anyHost.__vueParentComponent;
        if (vnode3) {
          let vnode = vnode3;
          let hops = 0;
          while (vnode && hops < MAX_HOPS) {
            const type = vnode.type;
            push(path, type?.name || type?.__name);
            vnode = vnode.parent;
            hops += 1;
            if (path.length >= MAX_PATH) break;
          }
          return path.length
            ? {
                componentName: path[0],
                componentPath: path,
                framework: "vue",
                version: 3,
              }
            : null;
        }
        const vnodeFromEl = anyHost.__vnode;
        if (vnodeFromEl && vnodeFromEl.component) {
          let vnode = vnodeFromEl.component;
          let hops = 0;
          while (vnode && hops < MAX_HOPS) {
            const type = vnode.type;
            push(path, type?.name || type?.__name);
            vnode = vnode.parent;
            hops += 1;
            if (path.length >= MAX_PATH) break;
          }
          return path.length
            ? {
                componentName: path[0],
                componentPath: path,
                framework: "vue",
                version: 3,
              }
            : null;
        }
        const vue2 = anyHost.__vue__;
        if (vue2) {
          let vm = vue2;
          let hops = 0;
          while (vm && hops < MAX_HOPS) {
            const options = vm.$options;
            push(path, options?.name || options?._componentTag);
            vm = vm.$parent;
            hops += 1;
            if (path.length >= MAX_PATH) break;
          }
          return path.length
            ? {
                componentName: path[0],
                componentPath: path,
                framework: "vue",
                version: 2,
              }
            : null;
        }
        host = host.parentElement;
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
