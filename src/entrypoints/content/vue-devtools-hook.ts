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
  const listeners: Record<string, Function[]> = {};
  const syncAppList = (targetApps: unknown[], sourceApps: unknown[]): void => {
    for (const app of sourceApps) {
      if (app && !targetApps.includes(app)) {
        targetApps.push(app);
      }
    }
  };

  const attachBugLensTap = (target: VueDevtoolsHook): void => {
    const anyTarget = target as unknown as Record<string, unknown>;
    if (anyTarget.__bugLensTapped) {
      target.enabled = true;
      return;
    }
    anyTarget.__bugLensTapped = true;
    target.enabled = true;
    if (!Array.isArray(target.apps)) {
      target.apps = [];
    }
    const origEmit =
      typeof target.emit === "function" ? target.emit.bind(target) : undefined;
    target.emit = (event: string, ...args: any[]) => {
      if (event === "app:init") {
        const app = args[0];
        if (app && !target.apps.includes(app)) {
          target.apps.push(app);
        }
      } else if (event === "init") {
        const Vue = args[0];
        if (Vue && Vue.config) {
          Vue.config.devtools = true;
        }
        target.Vue = Vue;
      }
      if (listeners[event]) {
        listeners[event].forEach((fn) => {
          try {
            fn(...args);
          } catch {}
        });
      }
      if (origEmit) {
        try {
          origEmit(event, ...args);
        } catch {}
      }
    };
  };

  // 若主世界中官方 Vue Devtools 或宿主已先注入 Hook，则透明协同挂接，不破坏外部扩展
  const existingHook = window.__VUE_DEVTOOLS_GLOBAL_HOOK__;
  if (existingHook) {
    attachBugLensTap(existingHook);
    return;
  }

  const apps: any[] = [];
  let externalHook: VueDevtoolsHook | undefined;

  const internalHook: VueDevtoolsHook = {
    enabled: true,
    apps,
    on(event: string, fn: Function) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(fn);
      if (externalHook && typeof externalHook.on === "function") {
        try {
          externalHook.on(event, fn);
        } catch {}
      }
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
      if (listeners[event]) {
        const index = listeners[event].indexOf(fn);
        if (index !== -1) listeners[event].splice(index, 1);
      }
      if (externalHook && typeof externalHook.off === "function") {
        try {
          externalHook.off(event, fn);
        } catch {}
      }
    },
    emit(event: string, ...args: any[]) {
      if (event === "app:init") {
        const app = args[0];
        if (app && !apps.includes(app)) {
          apps.push(app);
        }
        if (
          externalHook &&
          Array.isArray(externalHook.apps) &&
          app &&
          !externalHook.apps.includes(app)
        ) {
          externalHook.apps.push(app);
        }
      } else if (event === "init") {
        const Vue = args[0];
        if (Vue && Vue.config) {
          Vue.config.devtools = true;
        }
        internalHook.Vue = Vue;
        if (externalHook) {
          externalHook.Vue = Vue;
        }
      }
      if (listeners[event]) {
        listeners[event].forEach((fn) => {
          try {
            fn(...args);
          } catch {}
        });
      }
      if (externalHook && typeof externalHook.emit === "function") {
        try {
          externalHook.emit(event, ...args);
        } catch {}
      }
    },
  };

  try {
    Object.defineProperty(window, "__VUE_DEVTOOLS_GLOBAL_HOOK__", {
      get: () => externalHook ?? internalHook,
      set: (val: VueDevtoolsHook | undefined) => {
        // 协同让位给官方 Vue Devtools，同时双向同步 apps / Vue / emit 监听
        if (val && val !== internalHook) {
          externalHook = val;
          attachBugLensTap(val);
          syncAppList(val.apps, apps);
          syncAppList(apps, val.apps);
          if (internalHook.Vue && !val.Vue) {
            val.Vue = internalHook.Vue;
          } else if (val.Vue && !internalHook.Vue) {
            internalHook.Vue = val.Vue;
          }
          for (const [evt, fns] of Object.entries(listeners)) {
            if (typeof val.on === "function") {
              for (const fn of fns) {
                try {
                  val.on(evt, fn);
                } catch {}
              }
            }
          }
        }
      },
      configurable: true,
      enumerable: true,
    });
  } catch {
    // 某些极严格页面可能预先 defineProperty 不可配置
    if (!window.__VUE_DEVTOOLS_GLOBAL_HOOK__) {
      (
        window as unknown as Record<string, unknown>
      ).__VUE_DEVTOOLS_GLOBAL_HOOK__ = internalHook;
    }
  }
}
