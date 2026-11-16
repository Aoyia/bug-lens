import type {
  FrameworkProbeEntry,
  FrameworkProbeParentEntry,
} from "../../shared/protocol";

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
          /(password|passwd|pwd|token|secret|apikey|api_key|access_key|private_key|auth|authorization|credential|session_id|cookie|creditcard|card_number|cvv|ssn|idcard|id_card|phone|mobile|jwt|bearer|session|private|key)/i.test(
            k
          )
        ) {
          res[k] = "[REDACTED_SENSITIVE_KEY]";
        } else {
          try {
            res[k] = sanitizeValue(val[k], depth + 1, seen);
          } catch {
            res[k] = "[Unreadable]";
          }
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

  const MAX_PARENT_STATES = 2;
  const WRAPPER_NAME_RE =
    /^(?:Transition|TransitionGroup|BaseTransition|KeepAlive|KeepAliveImpl|Suspense|Fragment|RouterView|RouterLink|Anonymous|AnonymousComponent|(?:El|Van|Ant|Nz)[A-Z].*)$/;

  const isLibraryFile = (filePath?: string): boolean =>
    typeof filePath === "string" &&
    (filePath.indexOf("node_modules/") === 0 ||
      filePath.indexOf("/node_modules/") !== -1);

  const isWrapperName = (name?: string): boolean =>
    !name || WRAPPER_NAME_RE.test(name);

  type AncestorCandidate = {
    name: string;
    file?: string;
    line?: number;
    hasRawState: boolean;
    node: any;
  };

  const selectAndExtractParents = (
    candidates: AncestorCandidate[],
    primaryName: string | undefined,
    primaryFile: string | undefined,
    primaryHasData: boolean,
    extractParent: (
      candidate: AncestorCandidate
    ) => FrameworkProbeParentEntry | null
  ): FrameworkProbeParentEntry[] | undefined => {
    if (candidates.length === 0) return undefined;

    const primaryIsWrapperOrThirdParty =
      isLibraryFile(primaryFile) ||
      (!primaryFile && isWrapperName(primaryName)) ||
      !primaryHasData;

    const tier1: AncestorCandidate[] = [];
    const tier2: AncestorCandidate[] = [];
    const tier3: AncestorCandidate[] = [];

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (!c.name || isWrapperName(c.name) || isLibraryFile(c.file)) continue;
      if (c.file && c.hasRawState) {
        tier1.push(c);
      } else if (!c.file && c.hasRawState) {
        tier2.push(c);
      } else if (c.file && primaryIsWrapperOrThirdParty) {
        tier3.push(c);
      }
    }

    const ordered = [...tier1, ...tier2, ...tier3];
    if (ordered.length === 0) return undefined;

    const out: FrameworkProbeParentEntry[] = [];
    for (let i = 0; i < ordered.length && out.length < MAX_PARENT_STATES; i++) {
      const entry = extractParent(ordered[i]);
      if (
        entry &&
        (entry.props !== undefined ||
          entry.data !== undefined ||
          entry.componentFile !== undefined ||
          entry.componentLine !== undefined)
      ) {
        out.push(entry);
      }
    }
    return out.length > 0 ? out : undefined;
  };

  const resolveVueMeta = (vnodeOrVm: any): { name?: string; file?: string } => {
    if (!vnodeOrVm) return {};
    try {
      const type = vnodeOrVm.type;
      const opts = vnodeOrVm.$options;
      const name =
        type?.name ||
        type?.__name ||
        opts?.name ||
        opts?._componentTag ||
        opts?.__name ||
        vnodeOrVm.$vnode?.componentOptions?.tag;
      const rawFile =
        type?.__file ||
        type?.__file_name ||
        opts?.__file ||
        vnodeOrVm.constructor?.options?.__file ||
        vnodeOrVm.constructor?.extendOptions?.__file ||
        vnodeOrVm.$vnode?.componentOptions?.Ctor?.options?.__file;
      return {
        name: typeof name === "string" ? name : undefined,
        file: normalizeFilePath(rawFile),
      };
    } catch {
      return {};
    }
  };

  const hasRawVueState = (vnodeOrVm: any): boolean => {
    if (!vnodeOrVm || typeof vnodeOrVm !== "object") return false;
    try {
      if (vnodeOrVm.setupState && typeof vnodeOrVm.setupState === "object") {
        const keys = Object.keys(vnodeOrVm.setupState);
        for (let i = 0; i < keys.length; i++) {
          const k = keys[i];
          if (!k.startsWith("__") && !k.startsWith("$")) return true;
        }
      }
      if (
        vnodeOrVm.data &&
        typeof vnodeOrVm.data === "object" &&
        Object.keys(vnodeOrVm.data).length > 0
      ) {
        return true;
      }
      if (
        vnodeOrVm.props &&
        typeof vnodeOrVm.props === "object" &&
        Object.keys(vnodeOrVm.props).length > 0
      ) {
        return true;
      }
      const v2Data = vnodeOrVm.$data || vnodeOrVm._data;
      if (
        v2Data &&
        typeof v2Data === "object" &&
        Object.keys(v2Data).length > 0
      ) {
        return true;
      }
      const v2Props = vnodeOrVm.$props || vnodeOrVm._props;
      if (
        v2Props &&
        typeof v2Props === "object" &&
        Object.keys(v2Props).length > 0
      ) {
        return true;
      }
    } catch {
      return false;
    }
    return false;
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
        filePath = resolveVueMeta(vnodeOrVm).file;
        rawProps = vnodeOrVm.$props || vnodeOrVm._props;
        rawData = vnodeOrVm.$data || vnodeOrVm._data;
      }
      // 3. 兜底
      else {
        filePath = resolveVueMeta(vnodeOrVm).file;
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
        rawProps = vnodeOrVm.props || vnodeOrVm.$props || vnodeOrVm._props;
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

  const extractReactComponentState = (compFiber: any) => {
    let cleanProps: Record<string, unknown> | undefined;
    const rawProps = compFiber?.memoizedProps || compFiber?.pendingProps;
    if (rawProps && typeof rawProps === "object" && !Array.isArray(rawProps)) {
      const filtered: Record<string, unknown> = {};
      let filteredCount = 0;
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
        filteredCount += 1;
        if (filteredCount >= 20) break;
      }
      const sanitized = sanitizeValue(filtered);
      if (sanitized && Object.keys(sanitized).length > 0) {
        cleanProps = sanitized;
      }
    }

    let cleanData: Record<string, unknown> | undefined;
    if (compFiber) {
      const extractedData: Record<string, any> = {};
      if (compFiber.tag === 1) {
        const rawState = compFiber.stateNode?.state || compFiber.memoizedState;
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
        Object.assign(extractedData, compFiber.memoizedState);
      } else {
        let hook = compFiber.memoizedState;
        let hookHops = 0;
        let stateIdx = 0;
        let refIdx = 0;
        let memoIdx = 0;

        while (hook && typeof hook === "object" && hookHops < 30) {
          hookHops++;
          const mState = hook.memoizedState;
          const isEffect =
            mState &&
            typeof mState === "object" &&
            (typeof mState.create === "function" ||
              typeof mState.destroy === "function" ||
              ("tag" in mState && "create" in mState));

          if (!isEffect) {
            if (hook.queue && typeof hook.queue === "object") {
              extractedData[`useState_${stateIdx}`] = mState;
              stateIdx++;
            } else if (
              mState &&
              typeof mState === "object" &&
              "current" in mState &&
              hook.queue === null
            ) {
              const cur = mState.current;
              if (
                cur &&
                typeof cur === "object" &&
                (cur.nodeType !== undefined ||
                  (typeof Element !== "undefined" && cur instanceof Element))
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

    return { cleanProps, cleanData };
  };

  const resolveReactFiberMeta = (
    fiber: any
  ): { name?: string; file?: string; line?: number } => {
    if (!fiber) return {};
    const type = fiber.type;
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
    const ds = fiber._debugSource;
    return {
      name,
      file: ds?.fileName ? normalizeFilePath(ds.fileName) : undefined,
      line:
        typeof ds?.lineNumber === "number" && ds.lineNumber > 0
          ? ds.lineNumber
          : undefined,
    };
  };

  const hasRawReactFiberState = (fiber: any): boolean => {
    if (!fiber) return false;
    try {
      if (fiber.memoizedState) return true;
      const p = fiber.memoizedProps || fiber.pendingProps;
      if (p && typeof p === "object" && !Array.isArray(p)) {
        const keys = Object.keys(p);
        for (let i = 0; i < keys.length; i++) {
          const k = keys[i];
          if (
            k !== "children" &&
            k !== "key" &&
            k !== "ref" &&
            !k.startsWith("$$typeof") &&
            !k.startsWith("__") &&
            !k.startsWith("_owner") &&
            !k.startsWith("_store") &&
            !k.startsWith("_self") &&
            !k.startsWith("_source")
          ) {
            return true;
          }
        }
      }
    } catch {
      return false;
    }
    return false;
  };

  const collectReactChain = (hostFiber: any): FrameworkProbeEntry | null => {
    const rawPath: string[] = [];
    let debugSource: { fileName?: string; lineNumber?: number } | undefined =
      hostFiber?._debugSource;
    let compFiber: any = null;
    const ancestorCandidates: AncestorCandidate[] = [];
    let fiber = hostFiber;
    let hops = 0;

    while (fiber && hops < MAX_HOPS) {
      if (!debugSource && fiber._debugSource) {
        debugSource = fiber._debugSource;
      }

      const type = fiber.type;
      const isHost = fiber.tag === 5 || typeof type === "string";
      if (!isHost) {
        const meta = resolveReactFiberMeta(fiber);
        if (!compFiber) {
          compFiber = fiber;
        } else if (meta.name) {
          ancestorCandidates.push({
            name: meta.name,
            file: meta.file,
            line: meta.line,
            hasRawState: hasRawReactFiberState(fiber),
            node: fiber,
          });
        }
        if (meta.name) {
          push(rawPath, meta.name);
        }
      }

      fiber = fiber.return;
      hops += 1;
      if (rawPath.length >= MAX_PATH) break;
    }

    const { cleanProps, cleanData } = compFiber
      ? extractReactComponentState(compFiber)
      : { cleanProps: undefined, cleanData: undefined };

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
          fullPath.length > 0 ? fullPath : compName ? [compName] : undefined,
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

      const parents = selectAndExtractParents(
        ancestorCandidates,
        compName,
        componentFile,
        cleanData !== undefined,
        (candidate) => {
          const st = extractReactComponentState(candidate.node);
          return {
            componentName: candidate.name,
            ...(candidate.file ? { componentFile: candidate.file } : {}),
            ...(candidate.line !== undefined
              ? { componentLine: candidate.line }
              : {}),
            ...(st.cleanProps !== undefined ? { props: st.cleanProps } : {}),
            ...(st.cleanData !== undefined ? { data: st.cleanData } : {}),
          };
        }
      );
      if (parents) {
        result.parentComponents = parents;
      }
      return result;
    }
    return null;
  };

  const collectVueChain = (
    startNode: any,
    isVue3: boolean,
    fromHookApp = false
  ): FrameworkProbeEntry | null => {
    if (!startNode) return null;
    const rawPath: string[] = [];
    const visited: any[] = [];
    const ancestorCandidates: AncestorCandidate[] = [];
    const stateInfo = extractVueState(startNode);
    let curr = startNode;
    let hops = 0;

    while (curr && hops < MAX_HOPS) {
      if (visited.indexOf(curr) !== -1) break;
      visited.push(curr);

      const meta = resolveVueMeta(curr);
      if (!stateInfo.componentFile && meta.file) {
        stateInfo.componentFile = meta.file;
      }
      if (meta.name) {
        push(rawPath, meta.name);
        if (hops > 0) {
          ancestorCandidates.push({
            name: meta.name,
            file: meta.file,
            hasRawState: hasRawVueState(curr),
            node: curr,
          });
        }
      }

      if (isVue3) {
        curr = fromHookApp
          ? curr.subTree?.component || curr.parent
          : curr.parent;
      } else {
        curr = curr.$parent || curr.$vnode?.context || null;
      }
      hops += 1;
      if (rawPath.length >= MAX_PATH) break;
    }

    const fullPath = [...rawPath].reverse();
    if (fullPath.length === 0) return null;

    const compName = fullPath[fullPath.length - 1];
    const res: FrameworkProbeEntry = {
      componentName: compName,
      componentPath: fullPath,
      framework: "vue",
      version: isVue3 ? 3 : 2,
      props: stateInfo?.props,
      data: stateInfo?.data,
    };
    if (stateInfo?.componentFile) {
      res.componentFile = stateInfo.componentFile;
      res.filePath = stateInfo.componentFile;
    }

    const parents = selectAndExtractParents(
      ancestorCandidates,
      compName,
      res.componentFile,
      stateInfo?.data !== undefined,
      (candidate) => {
        const st = extractVueState(candidate.node);
        const f = st.componentFile ?? candidate.file;
        return {
          componentName: candidate.name,
          ...(f ? { componentFile: f } : {}),
          ...(st.props !== undefined ? { props: st.props } : {}),
          ...(st.data !== undefined ? { data: st.data } : {}),
        };
      }
    );
    if (parents) {
      res.parentComponents = parents;
    }
    return res;
  };

  const detectOnHost = (anyHost: any): FrameworkProbeEntry | null => {
    for (const k of Object.getOwnPropertyNames(anyHost)) {
      if (
        k.startsWith("__reactFiber$") ||
        k.startsWith("__reactInternalInstance$")
      ) {
        const res = collectReactChain(anyHost[k]);
        if (res) return res;
        break;
      }
    }

    const vnode3 =
      anyHost.__vueParentComponent$ || anyHost.__vueParentComponent;
    if (vnode3) return collectVueChain(vnode3, true);

    const vnodeFromEl = anyHost.__vnode;
    if (vnodeFromEl && vnodeFromEl.component) {
      return collectVueChain(vnodeFromEl.component, true);
    }

    const vue2 = anyHost.__vue__;
    if (vue2) return collectVueChain(vue2, false);

    const vueApp = anyHost.__vue_app__;
    if (vueApp && vueApp._instance) {
      return collectVueChain(vueApp._instance, true);
    }

    return null;
  };

  const detect = (el: Element): FrameworkProbeEntry | null => {
    try {
      // 1. 沿目标元素及 DOM 祖先链上溯探测（React Fiber / Vue 3 / Vue 2）
      let host: Element | null = el;
      while (host) {
        const hit = detectOnHost(host as any);
        if (hit) return hit;
        host = host.parentElement;
      }

      // 2. 通过 DevTools Global Hook 兜底（同时兼容 Vue 3 apps._instance 与 Vue 2 _isVue/$options 实例）
      const globalHost: any =
        typeof window !== "undefined" ? window : globalThis;
      const hook = globalHost?.__VUE_DEVTOOLS_GLOBAL_HOOK__;
      if (hook) {
        if (hook.apps && hook.apps.length > 0) {
          for (let a = 0; a < hook.apps.length; a++) {
            const app = hook.apps[a];
            if (!app) continue;
            if (app._instance) {
              const hit3 = collectVueChain(app._instance, true, true);
              if (hit3) return hit3;
            }
            if (app._isVue || app.$options) {
              const hit2 = collectVueChain(app, false, true);
              if (hit2) return hit2;
            }
          }
        }
        if (
          hook.store?._vm &&
          (hook.store._vm._isVue || hook.store._vm.$options)
        ) {
          const storeRoot = hook.store._vm.$root || hook.store._vm;
          const hitStore = collectVueChain(storeRoot, false, true);
          if (hitStore) return hitStore;
        }
      }

      // 3. 候选节点为 body/documentElement 且上述未命中时，执行受限广度扫描定位非标准挂载根
      if (typeof document !== "undefined") {
        const isRootLike =
          el === (document as any).body ||
          el === (document as any).documentElement ||
          !el.parentElement;
        if (isRootLike) {
          const queue: Element[] = [];
          const queued = new Set<Element>();
          const enqueue = (node: any) => {
            if (!node || typeof node !== "object" || !node.tagName) return;
            if (queued.has(node)) return;
            queued.add(node);
            queue.push(node as Element);
          };
          if (typeof document.querySelector === "function") {
            enqueue(document.querySelector("#app, #root, [data-v-app]"));
          }
          const bodyChildren = (document as any).body?.children;
          if (bodyChildren && typeof bodyChildren.length === "number") {
            for (let i = 0; i < Math.min(8, bodyChildren.length); i++) {
              enqueue(bodyChildren[i]);
            }
          }
          let scanned = 0;
          while (queue.length > 0 && scanned < 24) {
            const cur = queue.shift()!;
            scanned += 1;
            const hit = detectOnHost(cur as any);
            if (hit) return hit;
            const children = (cur as any).children;
            if (children && typeof children.length === "number") {
              for (let c = 0; c < Math.min(4, children.length); c++) {
                enqueue(children[c]);
              }
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
