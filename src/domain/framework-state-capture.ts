import type {
  FrameworkSnapshot,
  FrameworkStateEvidence,
  FrameworkStateTrigger,
} from "../shared/protocol";
import { captureReactTree } from "../entrypoints/content/react-detector";
import { captureVueTree } from "../entrypoints/content/vue-detector";

const SENSITIVE_KEY_REGEX =
  /(password|token|secret|auth|creditcard|phone|mobile|idcard|jwt|bearer|private)/i;

/** 与 react/vue detector 保持一致的脱敏规则（独立实现避免共享内部函数）。 */
function redactAndSanitize(
  obj: unknown,
  currentDepth = 0,
  maxDepth = 4,
  visited = new WeakSet<object>()
): unknown {
  if (obj === null || obj === undefined) return undefined;
  const type = typeof obj;
  if (type === "number" || type === "boolean" || type === "string") return obj;
  if (type !== "object") return undefined;
  const objectValue = obj as object;
  if (
    typeof HTMLElement !== "undefined" &&
    (objectValue instanceof HTMLElement ||
      (typeof Node !== "undefined" && objectValue instanceof Node))
  ) {
    return undefined;
  }
  if (visited.has(objectValue)) return "[CIRCULAR]";
  if (currentDepth >= maxDepth) return "[MAX_DEPTH]";
  visited.add(objectValue);

  if (Array.isArray(objectValue)) {
    return (objectValue as unknown[])
      .slice(0, 10)
      .map((item) =>
        redactAndSanitize(item, currentDepth + 1, maxDepth, visited)
      );
  }

  const result: Record<string, unknown> = {};
  const keys = Object.keys(objectValue).slice(0, 20);
  for (const key of keys) {
    if (SENSITIVE_KEY_REGEX.test(key)) {
      result[key] = "[REDACTED:sensitive-store-key]";
    } else {
      try {
        const val = redactAndSanitize(
          (objectValue as Record<string, unknown>)[key],
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

/** 常见全局状态挂载点（SSR / Redux / Nuxt / Next.js 约定命名）。 */
const GLOBAL_STATE_KEYS = [
  "__NEXT_DATA__",
  "__INITIAL_STATE__",
  "__PRELOADED_STATE__",
  "__NUXT__",
  "__APP_STATE__",
  "__STORE__",
  "__store__",
  "__data__",
] as const;

export function captureGlobalState(): Record<string, unknown> | undefined {
  if (typeof window === "undefined") return undefined;
  const collected: Record<string, unknown> = {};
  const globalThisObject = window as unknown as Record<string, unknown>;
  for (const key of GLOBAL_STATE_KEYS) {
    try {
      const value = globalThisObject[key];
      if (value === undefined) continue;
      const sanitized = redactAndSanitize(value);
      if (sanitized !== undefined) collected[key] = sanitized;
    } catch {
      collected[key] = "[UNSERIALIZABLE]";
    }
  }
  return Object.keys(collected).length > 0 ? collected : undefined;
}

const MAX_STORAGE_VALUE_LENGTH = 4 * 1024;
const MAX_STORAGE_ENTRIES = 50;

function snapshotStorage(
  storage: Storage | undefined,
  safeMode: boolean
): Record<string, unknown> | undefined {
  if (!storage) return undefined;
  const result: Record<string, unknown> = {};
  try {
    const entries = Array.from({ length: storage.length }, (_, index) => {
      const key = storage.key(index);
      return key ? ([key, storage.getItem(key)] as const) : undefined;
    }).filter((entry): entry is readonly [string, string] => Boolean(entry));
    for (const [key, rawValue] of entries.slice(0, MAX_STORAGE_ENTRIES)) {
      if (safeMode) {
        result[key] = "[REDACTED]";
      } else if (SENSITIVE_KEY_REGEX.test(key)) {
        result[key] = "[REDACTED:sensitive-store-key]";
      } else {
        result[key] =
          rawValue.length > MAX_STORAGE_VALUE_LENGTH
            ? `${rawValue.slice(0, MAX_STORAGE_VALUE_LENGTH)}…[TRUNCATED]`
            : rawValue;
      }
    }
  } catch {
    return undefined;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function captureWebStorage(
  privacyMode: "safe" | "raw"
): FrameworkStateEvidence["webStorage"] {
  if (typeof window === "undefined") return undefined;
  const safeMode = privacyMode !== "raw";
  const localStorageSnapshot = snapshotStorage(window.localStorage, safeMode);
  const sessionStorageSnapshot = snapshotStorage(
    window.sessionStorage,
    safeMode
  );
  if (!localStorageSnapshot && !sessionStorageSnapshot) return undefined;
  return {
    localStorage: localStorageSnapshot,
    sessionStorage: sessionStorageSnapshot,
    redactedValues: safeMode,
  };
}

function captureTree(): FrameworkSnapshot | undefined {
  try {
    return captureReactTree() ?? captureVueTree();
  } catch {
    return undefined;
  }
}

export function captureFrameworkState(input: {
  sessionId: string;
  trigger: FrameworkStateTrigger;
  privacyMode: "safe" | "raw";
}): FrameworkStateEvidence {
  const now = Date.now();
  const snapshot = captureTree();
  const globalState = captureGlobalState();
  const webStorage = captureWebStorage(input.privacyMode);

  return {
    id: crypto.randomUUID(),
    sessionId: input.sessionId,
    capturedAtEpochMs: now,
    trigger: input.trigger,
    page: {
      url: typeof location !== "undefined" ? location.href : "about:blank",
      title: typeof document !== "undefined" ? document.title : "",
      frameId: typeof window !== "undefined" && window.top === window ? 0 : -1,
      viewport:
        typeof window !== "undefined"
          ? { width: window.innerWidth, height: window.innerHeight }
          : undefined,
      scrollY: typeof window !== "undefined" ? window.scrollY : undefined,
    },
    snapshot,
    globalState,
    webStorage,
  };
}

/** 已完整采集（组件树 + 至少一种状态源）才算有效证据，避免全空快照入库。 */
export function isMeaningfulFrameworkState(
  state: FrameworkStateEvidence
): boolean {
  return Boolean(
    state.snapshot?.rootComponent ||
    state.globalState ||
    state.webStorage?.localStorage ||
    state.webStorage?.sessionStorage
  );
}
