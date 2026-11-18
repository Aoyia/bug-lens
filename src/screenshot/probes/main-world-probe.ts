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

  /** 路径标准化：将绝对路径、URL、Vite/@fs、Webpack 虚拟路径归一化为相对路径 */
  const normalizeFilePath = (filePath: any): string | undefined => {
    if (!filePath || typeof filePath !== "string") return undefined;
    let p = filePath.replace(/\\/g, "/").trim();
    if (!p) return undefined;

    // 构建工具虚拟协议：webpack:///./src/x.jsx、webpack-internal:///、vite://
    // 协议后的 host 段（webpack://app/... 里的 app）随路径锚定一起被丢弃。
    p = p.replace(/^(?:webpack|webpack-internal|vite):\/\/+/, "");
    // 真实 URL origin：http(s)://host[:port]、file:// → 只保留 origin 之后的路径
    p = p.replace(/^(?:https?|file):\/\/[^/]*/i, "");

    p = p.split("?")[0].split("#")[0];
    p = p.replace(/^\/@fs\//, "/");

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

  /** 解析 "19.2.8" / "18.3.1" 这类版本号的主版本；非法值返回 undefined。 */
  const parseReactMajorVersion = (value: any): number | undefined => {
    if (typeof value !== "string") return undefined;
    const matched = value.match(/^(\d{1,2})\./);
    if (!matched) return undefined;
    const major = parseInt(matched[1], 10);
    return major >= 15 && major <= 30 ? major : undefined;
  };

  /**
   * 首选版本来源：React DevTools 全局 hook 的 renderer 描述。
   * react-dom 启动时会以 injectInternals({ version: ReactVersion, ... }) 把自己的
   * 真实版本号注册进 hook，renderers 里因此带有权威的 version 字段。
   */
  const readReactMajorFromDevTools = (): number | undefined => {
    try {
      const globalHost: any =
        typeof window !== "undefined" ? window : globalThis;
      const hook: any = globalHost?.__REACT_DEVTOOLS_GLOBAL_HOOK__;
      const container = hook?.renderers;
      if (!container) return undefined;
      const renderers: any[] = [];
      if (typeof container.forEach === "function") {
        container.forEach((renderer: any) => {
          renderers.push(renderer);
        });
      } else if (typeof container === "object") {
        const keys = Object.keys(container);
        for (let i = 0; i < keys.length; i++) {
          renderers.push(container[keys[i]]);
        }
      }
      let fallback: number | undefined;
      for (let i = 0; i < renderers.length; i++) {
        const renderer = renderers[i];
        if (!renderer || typeof renderer !== "object") continue;
        const major =
          parseReactMajorVersion(renderer.version) ??
          parseReactMajorVersion(renderer.reconcilerVersion);
        if (major === undefined) continue;
        if (renderer.rendererPackageName === "react-dom") return major;
        if (fallback === undefined) fallback = major;
      }
      return fallback;
    } catch {
      return undefined;
    }
  };

  /**
   * 无 hook 时的结构启发式（只有 dev 构建可判别）：
   * React 19 的 FiberNode 自带 _debugInfo/_debugTask/_debugStack 且已删除 _debugSource；
   * React 18 相反（有 _debugSource，无上述三者）。生产构建三者都被剥离，
   * 无法判别时返回 0（未知），绝不猜成 18/19。
   */
  const inferReactMajorFromFiber = (hostFiber: any): number => {
    let fiber = hostFiber;
    let hops = 0;
    let sawReact18DebugSource = false;
    while (fiber && hops < MAX_HOPS) {
      try {
        if (
          "_debugInfo" in fiber ||
          "_debugTask" in fiber ||
          "_debugStack" in fiber
        ) {
          return 19;
        }
        if (fiber._debugSource) sawReact18DebugSource = true;
      } catch {
        // 不可读的 fiber 跳过
      }
      fiber = fiber.return;
      hops += 1;
    }
    return sawReact18DebugSource ? 18 : 0;
  };

  let cachedReactMajor: number | undefined;
  const getReactMajorVersion = (hostFiber: any): number => {
    if (cachedReactMajor !== undefined) return cachedReactMajor;
    const fromHook = readReactMajorFromDevTools();
    if (fromHook !== undefined) {
      cachedReactMajor = fromHook;
      return fromHook;
    }
    const inferred = inferReactMajorFromFiber(hostFiber);
    if (inferred !== 0) {
      cachedReactMajor = inferred;
      return inferred;
    }
    return 0;
  };

  /** React 内部/打包器运行时帧：其行号不是业务源码位置。 */
  const isReactStackInternalFile = (filePath: string): boolean =>
    /node_modules[\/\\]/.test(filePath) ||
    /react[_-]?jsx(?:-dev)?-runtime/i.test(filePath) ||
    /react[_-]?stack[_-]?bottom[_-]?frame/i.test(filePath);

  /**
   * 从 Error/stack 字符串解析业务源码位置（React 19 的 fiber._debugStack 与
   * _debugInfo[].debugLocation 都是这种 V8 风格栈）。
   * 栈可能为空、被 minify 或不含源码目录；解析不到时返回空对象，不编造行号。
   */
  const parseReactStackLocation = (
    stackLike: any
  ): { file?: string; line?: number } => {
    let text: string | undefined;
    if (typeof stackLike === "string") {
      text = stackLike;
    } else if (stackLike && typeof stackLike.stack === "string") {
      text = stackLike.stack;
    }
    if (!text) return {};

    // React 在栈底插入 react_stack_bottom_frame，其下方全部是框架内部调用
    const bottomIdx = text.indexOf("react_stack_bottom_frame");
    if (bottomIdx !== -1) {
      const lineStart = text.lastIndexOf("\n", bottomIdx);
      if (lineStart > 0) text = text.slice(0, lineStart);
    }

    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line || line.indexOf(":") === -1) continue;
      const matched =
        line.match(/\((.*?):(\d+):(\d+)\)\s*$/) ||
        line.match(/(?:@|\bat\s+)(.*?):(\d+):(\d+)\s*$/);
      if (!matched) continue;
      const rawFile = (matched[1] || "").trim();
      const lineNumber = parseInt(matched[2], 10);
      if (!rawFile || !(lineNumber > 0)) continue;
      if (isReactStackInternalFile(rawFile)) continue;
      const bareFile = rawFile.split("?")[0].split("#")[0];
      if (!/\.(?:[cm]?[jt]sx?|vue)$/i.test(bareFile)) continue;
      const normalized = normalizeFilePath(rawFile);
      if (!normalized || normalized.indexOf("/") === -1) continue;
      return { file: normalized, line: lineNumber };
    }
    return {};
  };

  /** React 19 的 _debugInfo 条目（{name, env, debugLocation}）里可能带调用点栈。 */
  const readReactDebugInfoLocation = (
    fiber: any
  ): { file?: string; line?: number } => {
    try {
      const info = fiber?._debugInfo;
      if (!Array.isArray(info)) return {};
      for (let i = info.length - 1; i >= 0; i--) {
        const entry = info[i];
        if (!entry || typeof entry !== "object") continue;
        const candidates = [entry.debugLocation, entry.debugStack, entry.stack];
        for (let c = 0; c < candidates.length; c++) {
          const located = parseReactStackLocation(candidates[c]);
          if (located.file) return located;
        }
      }
    } catch {
      return {};
    }
    return {};
  };

  /** 单个 fiber 的源码位置，3 级回退：_debugSource → _debugStack → _debugInfo。 */
  const resolveReactFiberLocation = (
    fiber: any
  ): { file?: string; line?: number } => {
    if (!fiber) return {};
    try {
      const ds = fiber._debugSource;
      if (ds && ds.fileName) {
        const file = normalizeFilePath(ds.fileName);
        if (file) {
          return {
            file,
            line:
              typeof ds.lineNumber === "number" && ds.lineNumber > 0
                ? ds.lineNumber
                : undefined,
          };
        }
      }
      if (fiber._debugStack) {
        const fromStack = parseReactStackLocation(fiber._debugStack);
        if (fromStack.file) return fromStack;
      }
      if (fiber._debugInfo) {
        const fromInfo = readReactDebugInfoLocation(fiber);
        if (fromInfo.file) return fromInfo;
      }
    } catch {
      return {};
    }
    return {};
  };

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
    const location = resolveReactFiberLocation(fiber);
    return {
      name,
      file: location.file,
      line: location.line,
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
    // 3 级源码定位回退，分别收集后再按优先级取用
    let debugSourceLocation: { file?: string; line?: number } | undefined;
    let debugStackLocation: { file?: string; line?: number } | undefined;
    let debugInfoLocation: { file?: string; line?: number } | undefined;
    let compFiber: any = null;
    const ancestorCandidates: AncestorCandidate[] = [];
    let fiber = hostFiber;
    let hops = 0;

    while (fiber && hops < MAX_HOPS) {
      try {
        if (!debugSourceLocation && fiber._debugSource?.fileName) {
          const ds = fiber._debugSource;
          const file = normalizeFilePath(ds.fileName);
          if (file) {
            debugSourceLocation = {
              file,
              line:
                typeof ds.lineNumber === "number" && ds.lineNumber > 0
                  ? ds.lineNumber
                  : undefined,
            };
          }
        }
        if (!debugStackLocation && fiber._debugStack) {
          const fromStack = parseReactStackLocation(fiber._debugStack);
          if (fromStack.file) debugStackLocation = fromStack;
        }
        if (!debugInfoLocation && fiber._debugInfo) {
          const fromInfo = readReactDebugInfoLocation(fiber);
          if (fromInfo.file) debugInfoLocation = fromInfo;
        }
      } catch {
        // 调试字段不可读时继续沿父链上溯
      }

      const type = fiber.type;
      const isHost = fiber.tag === 5 || typeof type === "string";
      // HostRoot(3)/LegacyRoot(17) 不是业务组件，跳过以免污染组件名
      const isRootFiber = fiber.tag === 3 || fiber.tag === 17;
      if (!isHost && !isRootFiber) {
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

    const location = debugSourceLocation
      ? debugSourceLocation
      : debugStackLocation
        ? debugStackLocation
        : debugInfoLocation;
    let componentFile: string | undefined;
    let componentLine: number | undefined;
    if (location?.file) {
      componentFile = location.file;
      if (typeof location.line === "number" && location.line > 0) {
        componentLine = location.line;
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
        version: getReactMajorVersion(hostFiber),
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

  /**
   * 解引用 __reactContainer$ 上挂的值。
   * react-dom 在 createRoot/hydrateRoot 里写入的是 `fiberRoot.current`
   * （HostRoot fiber，tag 3），而不是 FiberRoot 本身。
   * 活动树不一定在 HostRoot.child 上：实测 React 19 的 HostRoot fiber
   * `child === null`，树在 `stateNode.current.child`（FiberRoot.current 的另一
   * 份引用）或 `alternate.child`（当前/备用树交替）上，因此按序取第一个
   * 形似 fiber 的节点。解不出来返回 null，不猜测。
   */
  const resolveReactContainerFiber = (value: any): any => {
    if (!value || typeof value !== "object") return null;
    let root = value;
    // 少数封装/工具会直接挂 FiberRoot：{ current: HostRootFiber, containerInfo }
    if (
      typeof root.tag !== "number" &&
      root.current &&
      typeof root.current === "object"
    ) {
      root = root.current;
    }
    if (!root || typeof root !== "object") return null;
    if (root.tag === 3 || root.tag === 17) {
      const candidates = [
        root.child,
        root.stateNode?.current?.child,
        root.alternate?.child,
      ];
      for (let i = 0; i < candidates.length; i++) {
        const candidate = candidates[i];
        if (
          candidate &&
          typeof candidate === "object" &&
          typeof candidate.tag === "number"
        ) {
          return candidate;
        }
      }
      return null;
    }
    return typeof root.tag === "number" ? root : null;
  };

  const detectOnHost = (anyHost: any): FrameworkProbeEntry | null => {
    let containerKey: string | null = null;
    for (const k of Object.getOwnPropertyNames(anyHost)) {
      if (
        k.startsWith("__reactFiber$") ||
        k.startsWith("__reactInternalInstance$")
      ) {
        const res = collectReactChain(anyHost[k]);
        if (res) return res;
      }
      if (k.startsWith("__reactContainer$")) {
        containerKey = k;
      }
    }

    // 目标元素恰为 React 根容器时，只有 __reactContainer$ 而没有 __reactFiber$
    if (containerKey) {
      const containerFiber = resolveReactContainerFiber(anyHost[containerKey]);
      if (containerFiber) {
        const res = collectReactChain(containerFiber);
        if (res) return res;
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
