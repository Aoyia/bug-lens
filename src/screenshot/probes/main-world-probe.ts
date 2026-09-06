import type { FrameworkProbeEntry } from "../../shared/protocol";

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

  /** 路径标准化：将绝对路径、Vite/@fs、Webpack 虚拟路径归一化为相对路径 */
  const normalizeFilePath = (filePath: any): string | undefined => {
    if (!filePath || typeof filePath !== "string") return undefined;
    let p = filePath.replace(/\\/g, "/").trim();
    p = p.split("?")[0].split("#")[0];
    p = p.replace(/^\/@fs\//, "/");
    p = p.replace(/^webpack:\/\/\/?(?:\.\/)?/, "");

    // 关键目录锚定匹配：src/, app/, components/, views/, pages/, lib/, e2e/
    const anchorMatch = p.match(
      /(?:^|\/)((?:src|app|components|views|pages|lib|e2e)\/.*)$/i
    );
    if (anchorMatch) return anchorMatch[1];

    // node_modules 目录锚定匹配
    const nmMatch = p.match(/(?:^|\/)(node_modules\/.*)$/i);
    if (nmMatch) return nmMatch[1];

    // 剔除盘符与开头的 / 或 ./
    p = p.replace(/^[a-zA-Z]:\//, "").replace(/^(\.\/|\/)+/, "");
    return p || undefined;
  };

  /** 数据脱敏与防爆安全序列化 */
  const sanitizeValue = (val: any, depth = 0, seen = new WeakSet()): any => {
    if (val === null || val === undefined) return val;
    if (typeof val === "boolean" || typeof val === "number") {
      return val;
    }
    if (typeof val === "string") {
      if (
        /(password|token|secret|auth|cookie|authorization|jwt|bearer)/i.test(
          val
        )
      ) {
        return "[REDACTED_SENSITIVE_KEY]";
      }
      return val;
    }
    if (typeof val === "function") return "[Function]";
    if (typeof val === "object") {
      // 拦截 DOM 元素与全局对象
      if (
        (typeof Node !== "undefined" && val instanceof Node) ||
        (typeof Element !== "undefined" && val instanceof Element) ||
        typeof val.nodeType === "number" ||
        (typeof val.getAttribute === "function" &&
          (val.tagName !== undefined || val.nodeType !== undefined)) ||
        (typeof window !== "undefined" && val === window) ||
        (typeof document !== "undefined" && val === document)
      ) {
        return "[DOM Element]";
      }
      if (seen.has(val)) return "[Circular]";
      seen.add(val);
      if (depth >= 3) return "[Truncated]";
      if (Array.isArray(val)) {
        return val
          .slice(0, 10)
          .map((item) => sanitizeValue(item, depth + 1, seen));
      }
      const res: Record<string, any> = {};
      const keys = Object.keys(val).slice(0, 20);
      for (const k of keys) {
        if (
          k.startsWith("__v_") ||
          k.startsWith("$$typeof") ||
          k.startsWith("_owner") ||
          k.startsWith("_store") ||
          k.startsWith("_self") ||
          k.startsWith("_source")
        ) {
          continue;
        }
        if (
          /(password|token|secret|auth|cookie|authorization|jwt|bearer|session|private|key)/i.test(
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
    const str = String(val);
    if (
      /(password|token|secret|auth|cookie|authorization|jwt|bearer)/i.test(str)
    ) {
      return "[REDACTED_SENSITIVE_KEY]";
    }
    return str;
  };

  const extractVueState = (vnodeOrVm: any) => {
    let rawProps: any = null;
    let rawData: any = null;
    let filePath: string | undefined;

    if (vnodeOrVm) {
      // 1. Vue 3 (ComponentInternalInstance)
      if (
        vnodeOrVm.type &&
        (vnodeOrVm.setupState !== undefined ||
          vnodeOrVm.subTree !== undefined ||
          vnodeOrVm.devtoolsRawSetupState !== undefined ||
          vnodeOrVm.ctx !== undefined ||
          vnodeOrVm.data !== undefined)
      ) {
        filePath = vnodeOrVm.type?.__file || vnodeOrVm.type?.__file_name;
        if (vnodeOrVm.props && typeof vnodeOrVm.props === "object") {
          rawProps = vnodeOrVm.props;
        }

        // 优先提取 setupState（Vue 3 SFC / <script setup> / Composition API）
        if (vnodeOrVm.setupState && typeof vnodeOrVm.setupState === "object") {
          const setupKeys = Object.keys(vnodeOrVm.setupState).filter(
            (k) => !k.startsWith("__") && !k.startsWith("$")
          );
          if (setupKeys.length > 0) {
            const s: Record<string, any> = {};
            for (const k of setupKeys) {
              const val = vnodeOrVm.setupState[k];
              s[k] =
                val && typeof val === "object" && "__v_isRef" in val
                  ? val.value
                  : val;
            }
            rawData = s;
          }
        }

        // 兜底检查 Options API data
        if (!rawData && vnodeOrVm.data && typeof vnodeOrVm.data === "object") {
          const dataKeys = Object.keys(vnodeOrVm.data);
          if (dataKeys.length > 0) {
            rawData = vnodeOrVm.data;
          }
        }
      }
      // 2. Vue 2 (VueComponent)
      else if (vnodeOrVm._isVue || vnodeOrVm.$options) {
        filePath =
          vnodeOrVm.$options?.__file || vnodeOrVm.constructor?.options?.__file;
        rawProps = vnodeOrVm.$props;
        rawData = vnodeOrVm.$data || vnodeOrVm._data;
      }
      // 3. 兜底
      else {
        filePath =
          vnodeOrVm.type?.__file ||
          vnodeOrVm.type?.__file_name ||
          vnodeOrVm.$options?.__file;
        if (vnodeOrVm.setupState && typeof vnodeOrVm.setupState === "object") {
          const setupKeys = Object.keys(vnodeOrVm.setupState).filter(
            (k) => !k.startsWith("__") && !k.startsWith("$")
          );
          if (setupKeys.length > 0) {
            const s: Record<string, any> = {};
            for (const k of setupKeys) s[k] = vnodeOrVm.setupState[k];
            rawData = s;
          }
        }
        if (!rawData && vnodeOrVm.data && typeof vnodeOrVm.data === "object") {
          if (Object.keys(vnodeOrVm.data).length > 0) rawData = vnodeOrVm.data;
        } else if (!rawData && (vnodeOrVm.$data || vnodeOrVm._data)) {
          rawData = vnodeOrVm.$data || vnodeOrVm._data;
        }
        rawProps = vnodeOrVm.props || vnodeOrVm.$props;
      }
    }

    const cleanProps = rawProps ? sanitizeValue(rawProps) : undefined;
    const cleanData = rawData ? sanitizeValue(rawData) : undefined;
    const normalizedFile = filePath ? normalizeFilePath(filePath) : undefined;

    return {
      props:
        cleanProps && Object.keys(cleanProps).length > 0
          ? cleanProps
          : undefined,
      data:
        cleanData && Object.keys(cleanData).length > 0 ? cleanData : undefined,
      componentFile: normalizedFile,
    };
  };

  /** 将有效组件名加入路径链，废除 /^[a-z]/ 误杀正则 */
  const push = (path: string[], name: string | undefined): void => {
    if (!name || name === "undefined" || name === "Anonymous") return;
    const normalized = name.replace(/^<|>$/g, "");
    if (normalized && !path.includes(normalized)) path.push(normalized);
  };

  const detect = (el: Element): FrameworkProbeEntry | null => {
    const rawPath: string[] = [];
    let stateInfo:
      { props?: any; data?: any; componentFile?: string } | undefined;

    try {
      // React Fiber：__reactFiber$ / __reactInternalInstance$ 挂在 DOM 元素自身
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
        const hostFiber = (el as any)[fiberKey];
        let debugSource:
          { fileName?: string; lineNumber?: number } | undefined =
          hostFiber?._debugSource;

        let compFiber: any = null;
        let fiber = hostFiber;
        let hops = 0;

        while (fiber && hops < MAX_HOPS) {
          if (!debugSource && fiber._debugSource) {
            debugSource = fiber._debugSource;
          }

          const type = fiber.type;
          const isHost = fiber.tag === 5 || typeof type === "string";

          if (!isHost) {
            if (!compFiber) {
              compFiber = fiber;
            }

            let name: string | undefined;
            if (typeof type === "function") {
              name = type.displayName || type.name;
            } else if (typeof type === "object" && type !== null) {
              name =
                type.displayName ||
                type.name ||
                type.render?.displayName ||
                type.render?.name ||
                type.type?.displayName ||
                type.type?.name;
            }

            if (name) {
              push(rawPath, name);
            }
          }

          fiber = fiber.return;
          hops += 1;
          if (rawPath.length >= MAX_PATH) break;
        }

        // 解包 React memoizedProps
        let cleanProps: Record<string, unknown> | undefined;
        if (compFiber) {
          const rawProps = compFiber.memoizedProps || compFiber.pendingProps;
          if (
            rawProps &&
            typeof rawProps === "object" &&
            !Array.isArray(rawProps)
          ) {
            const filtered: Record<string, unknown> = {};
            for (const k of Object.keys(rawProps)) {
              if (
                k === "children" ||
                k === "key" ||
                k === "ref" ||
                k.startsWith("$$typeof") ||
                k.startsWith("__") ||
                k.startsWith("_owner") ||
                k.startsWith("_store") ||
                k.startsWith("_self") ||
                k.startsWith("_source")
              ) {
                continue;
              }
              filtered[k] = rawProps[k];
            }
            const sanitized = sanitizeValue(filtered);
            if (sanitized && Object.keys(sanitized).length > 0) {
              cleanProps = sanitized;
            }
          }
        }

        // 解包 React memoizedState（Hooks 链表或 Class 状态）
        let cleanData: Record<string, unknown> | undefined;
        if (compFiber) {
          const extractedData: Record<string, any> = {};

          if (compFiber.tag === 1) {
            // Class Component
            const rawState =
              compFiber.stateNode?.state || compFiber.memoizedState;
            if (rawState && typeof rawState === "object") {
              Object.assign(extractedData, rawState);
            }
          } else if (
            compFiber.memoizedState &&
            typeof compFiber.memoizedState === "object" &&
            !("queue" in compFiber.memoizedState) &&
            !("next" in compFiber.memoizedState) &&
            !("memoizedState" in compFiber.memoizedState)
          ) {
            // Mock 或直接挂载的 State 对象
            Object.assign(extractedData, compFiber.memoizedState);
          } else {
            // Function Component: 遍历 Hooks 链表
            let hook = compFiber.memoizedState;
            let hookHops = 0;
            let stateIdx = 0;
            let refIdx = 0;
            let memoIdx = 0;

            while (hook && typeof hook === "object" && hookHops < 30) {
              hookHops++;
              const mState = hook.memoizedState;

              // 跳过副作用 Hooks（useEffect / useLayoutEffect / useInsertionEffect）
              const isEffect =
                mState &&
                typeof mState === "object" &&
                (typeof mState.create === "function" ||
                  typeof mState.destroy === "function" ||
                  ("tag" in mState && "create" in mState));

              if (!isEffect) {
                if (hook.queue && typeof hook.queue === "object") {
                  // useState 或 useReducer
                  extractedData[`useState_${stateIdx}`] = mState;
                  stateIdx++;
                } else if (
                  mState &&
                  typeof mState === "object" &&
                  "current" in mState &&
                  hook.queue === null
                ) {
                  // useRef
                  const cur = mState.current;
                  if (
                    cur &&
                    typeof cur === "object" &&
                    (cur.nodeType !== undefined ||
                      (typeof Element !== "undefined" &&
                        cur instanceof Element))
                  ) {
                    extractedData[`useRef_${refIdx}`] = "[DOM Element]";
                  } else {
                    extractedData[`useRef_${refIdx}`] = cur;
                  }
                  refIdx++;
                } else if (
                  Array.isArray(mState) &&
                  mState.length === 2 &&
                  Array.isArray(mState[1]) &&
                  hook.queue === null
                ) {
                  // useMemo [value, deps]
                  if (typeof mState[0] !== "function") {
                    extractedData[`useMemo_${memoIdx}`] = mState[0];
                    memoIdx++;
                  }
                } else if (mState !== undefined && hook.queue !== undefined) {
                  extractedData[`state_${stateIdx}`] = mState;
                  stateIdx++;
                }
              }

              hook = hook.next;
            }
          }

          const sanitized = sanitizeValue(extractedData);
          if (sanitized && Object.keys(sanitized).length > 0) {
            cleanData = sanitized;
          }
        }

        let componentFile: string | undefined;
        let componentLine: number | undefined;
        if (debugSource) {
          componentFile = normalizeFilePath(debugSource.fileName);
          if (
            typeof debugSource.lineNumber === "number" &&
            debugSource.lineNumber > 0
          ) {
            componentLine = debugSource.lineNumber;
          }
        }

        const fullPath = [...rawPath].reverse();
        if (fullPath.length > 0 || compFiber) {
          const compName =
            fullPath.length > 0
              ? fullPath[fullPath.length - 1]
              : typeof compFiber?.type === "function"
                ? compFiber.type.displayName || compFiber.type.name
                : undefined;

          const result: FrameworkProbeEntry = {
            componentName: compName,
            componentPath:
              fullPath.length > 0
                ? fullPath
                : compName
                  ? [compName]
                  : undefined,
            framework: "react",
            version: 18,
          };

          if (componentFile) {
            result.componentFile = componentFile;
            result.filePath = componentFile;
          }
          if (componentLine !== undefined) {
            result.componentLine = componentLine;
          }
          if (cleanProps !== undefined) {
            result.props = cleanProps;
          }
          if (cleanData !== undefined) {
            result.data = cleanData;
          }
          return result;
        }
        return null;
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
            if (
              !stateInfo.componentFile &&
              (type?.__file || type?.__file_name)
            ) {
              stateInfo.componentFile = normalizeFilePath(
                type.__file || type.__file_name
              );
            }
            push(rawPath, type?.name || type?.__name);
            vnode = vnode.parent;
            hops += 1;
            if (rawPath.length >= MAX_PATH) break;
          }
          const fullPath = [...rawPath].reverse();
          if (fullPath.length > 0) {
            const res: FrameworkProbeEntry = {
              componentName: fullPath[fullPath.length - 1],
              componentPath: fullPath,
              framework: "vue",
              version: 3,
              props: stateInfo?.props,
              data: stateInfo?.data,
            };
            if (stateInfo?.componentFile) {
              res.componentFile = stateInfo.componentFile;
              res.filePath = stateInfo.componentFile;
            }
            return res;
          }
          return null;
        }

        const vnodeFromEl = anyHost.__vnode;
        if (vnodeFromEl && vnodeFromEl.component) {
          let vnode = vnodeFromEl.component;
          let hops = 0;
          stateInfo = extractVueState(vnode);
          while (vnode && hops < MAX_HOPS) {
            const type = vnode.type;
            if (
              !stateInfo.componentFile &&
              (type?.__file || type?.__file_name)
            ) {
              stateInfo.componentFile = normalizeFilePath(
                type.__file || type.__file_name
              );
            }
            push(rawPath, type?.name || type?.__name);
            vnode = vnode.parent;
            hops += 1;
            if (rawPath.length >= MAX_PATH) break;
          }
          const fullPath = [...rawPath].reverse();
          if (fullPath.length > 0) {
            const res: FrameworkProbeEntry = {
              componentName: fullPath[fullPath.length - 1],
              componentPath: fullPath,
              framework: "vue",
              version: 3,
              props: stateInfo?.props,
              data: stateInfo?.data,
            };
            if (stateInfo?.componentFile) {
              res.componentFile = stateInfo.componentFile;
              res.filePath = stateInfo.componentFile;
            }
            return res;
          }
          return null;
        }

        const vue2 = anyHost.__vue__;
        if (vue2) {
          let vm = vue2;
          let hops = 0;
          stateInfo = extractVueState(vm);
          while (vm && hops < MAX_HOPS) {
            const options = vm.$options;
            if (!stateInfo.componentFile && options?.__file) {
              stateInfo.componentFile = normalizeFilePath(options.__file);
            }
            push(rawPath, options?.name || options?._componentTag);
            vm = vm.$parent;
            hops += 1;
            if (rawPath.length >= MAX_PATH) break;
          }
          const fullPath = [...rawPath].reverse();
          if (fullPath.length > 0) {
            const res: FrameworkProbeEntry = {
              componentName: fullPath[fullPath.length - 1],
              componentPath: fullPath,
              framework: "vue",
              version: 2,
              props: stateInfo?.props,
              data: stateInfo?.data,
            };
            if (stateInfo?.componentFile) {
              res.componentFile = stateInfo.componentFile;
              res.filePath = stateInfo.componentFile;
            }
            return res;
          }
          return null;
        }

        // 检查 Vue 3 根挂载点特征 __vue_app__
        const vueApp = anyHost.__vue_app__;
        if (vueApp && vueApp._instance) {
          let vnode = vueApp._instance;
          let hops = 0;
          stateInfo = extractVueState(vnode);
          while (vnode && hops < MAX_HOPS) {
            const type = vnode.type;
            if (
              !stateInfo.componentFile &&
              (type?.__file || type?.__file_name)
            ) {
              stateInfo.componentFile = normalizeFilePath(
                type.__file || type.__file_name
              );
            }
            push(rawPath, type?.name || type?.__name);
            vnode = vnode.parent;
            hops += 1;
            if (rawPath.length >= MAX_PATH) break;
          }
          const fullPath = [...rawPath].reverse();
          if (fullPath.length > 0) {
            const res: FrameworkProbeEntry = {
              componentName: fullPath[fullPath.length - 1],
              componentPath: fullPath,
              framework: "vue",
              version: 3,
              props: stateInfo?.props,
              data: stateInfo?.data,
            };
            if (stateInfo?.componentFile) {
              res.componentFile = stateInfo.componentFile;
              res.filePath = stateInfo.componentFile;
            }
            return res;
          }
          return null;
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
              if (
                !stateInfo.componentFile &&
                (type?.__file || type?.__file_name)
              ) {
                stateInfo.componentFile = normalizeFilePath(
                  type.__file || type.__file_name
                );
              }
              push(rawPath, type?.name || type?.__name);
              vnode = vnode.subTree?.component || vnode.parent;
              hops += 1;
              if (rawPath.length >= MAX_PATH) break;
            }
            const fullPath = [...rawPath].reverse();
            if (fullPath.length > 0) {
              const res: FrameworkProbeEntry = {
                componentName: fullPath[fullPath.length - 1],
                componentPath: fullPath,
                framework: "vue",
                version: 3,
                props: stateInfo?.props,
                data: stateInfo?.data,
              };
              if (stateInfo?.componentFile) {
                res.componentFile = stateInfo.componentFile;
                res.filePath = stateInfo.componentFile;
              }
              return res;
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
