/**
 * 提前向页面 Main World 注入 Vue DevTools Global Hook 强开调试。
 *
 * 为什么需要该文件：
 * 生产环境构建的 Vue 应用默认会擦除/禁用 DOM 元素上的内部组件指针（如 __vue__ / __vueParentComponent$）。
 * 在 document_start 阶段提前注入此脚本并创建 __VUE_DEVTOOLS_GLOBAL_HOOK__，
 * Vue 初始化时会识别到 DevTools 存在并把 App 实例注册到 hook.apps 列表中，
 * 同时开启 Vue 构造函数/App 实例上的 devtools 支持。
 */

interface VueDevtoolsHook {
  enabled?: boolean;
  apps: any[];
  emit: (event: string, ...args: any[]) => void;
  on: (event: string, fn: Function) => void;
  once: (event: string, fn: Function) => void;
  off: (event: string, fn: Function) => void;
  Vue?: any;
}

declare global {
  interface Window {
    __VUE_DEVTOOLS_GLOBAL_HOOK__?: VueDevtoolsHook;
  }
}

export function injectVueDevtoolsHook(): void {
  // 如果主世界中 Hook 已经存在或已被插件初始化，则直接确保 enabled 为 true
  if (window.__VUE_DEVTOOLS_GLOBAL_HOOK__) {
    window.__VUE_DEVTOOLS_GLOBAL_HOOK__.enabled = true;
    return;
  }

  const apps: any[] = [];
  const listeners: Record<string, Function[]> = {};

  const hook: VueDevtoolsHook = {
    enabled: true,
    apps,
    on(event: string, fn: Function) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(fn);
    },
    once(event: string, fn: Function) {
      const self = this;
      const on = (...args: any[]) => {
        self.off(event, on);
        fn.apply(self, args);
      };
      this.on(event, on);
    },
    off(event: string, fn: Function) {
      if (!listeners[event]) return;
      const index = listeners[event].indexOf(fn);
      if (index !== -1) listeners[event].splice(index, 1);
    },
    emit(event: string, ...args: any[]) {
      if (event === "app:init") {
        const app = args[0];
        if (app && !apps.includes(app)) {
          apps.push(app);
        }
      } else if (event === "init") {
        const Vue = args[0];
        if (Vue && Vue.config) {
          Vue.config.devtools = true;
        }
        hook.Vue = Vue;
      }
      if (listeners[event]) {
        listeners[event].forEach((fn) => {
          try {
            fn(...args);
          } catch {}
        });
      }
    },
  };

  Object.defineProperty(window, "__VUE_DEVTOOLS_GLOBAL_HOOK__", {
    get: () => hook,
    set: (val) => {
      // 防止页面代码或其它扩展覆盖已创建的 hook
      if (val && val !== hook) {
        val.enabled = true;
        if (Array.isArray(val.apps)) {
          for (const app of val.apps) {
            if (!apps.includes(app)) apps.push(app);
          }
        }
      }
    },
    configurable: true,
    enumerable: true,
  });
}
