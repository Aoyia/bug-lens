import type {
  FrameworkComponentNode,
  FrameworkProbeEntry,
  FrameworkSnapshot,
  FrameworkStateEvidence,
  FrameworkStateTrigger,
} from "../shared/protocol";
import { captureReactTree } from "../entrypoints/content/react-detector";
import { captureVueTree } from "../entrypoints/content/vue-detector";
import { probeFrameworkComponents } from "../screenshot/probes/framework-probe";
import {
  redactAndSanitizeState,
  SENSITIVE_STATE_KEY_REGEX as SENSITIVE_KEY_REGEX,
} from "./privacy-policy";

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
      const sanitized = redactAndSanitizeState(value, 0, 4);
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
  privacyMode: "safe" | "strict" | "raw"
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
  privacyMode: "safe" | "strict" | "raw";
  frameId?: number;
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
      frameId:
        input.frameId !== undefined
          ? input.frameId
          : typeof window !== "undefined" && window.top === window
            ? 0
            : -1,
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
    state.snapshot?.targetComponent ||
    state.globalState ||
    state.webStorage?.localStorage ||
    state.webStorage?.sessionStorage
  );
}

function redactStrictRecord(
  record: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!record || typeof record !== "object") return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    out[k] = typeof v === "string" ? "[REDACTED]" : v;
  }
  return out;
}

function sanitizePropsAndState(
  rawProps: Record<string, unknown> | undefined,
  rawData: Record<string, unknown> | undefined,
  privacyMode: "safe" | "strict" | "raw"
): {
  props?: Record<string, unknown>;
  state?: Record<string, unknown>;
} {
  const cleanProps = redactAndSanitizeState(rawProps, 0, 2) as
    Record<string, unknown> | undefined;
  const cleanState = redactAndSanitizeState(rawData, 0, 2) as
    Record<string, unknown> | undefined;
  return {
    props:
      privacyMode === "strict" ? redactStrictRecord(cleanProps) : cleanProps,
    state:
      privacyMode === "strict" ? redactStrictRecord(cleanState) : cleanState,
  };
}

/** 将主世界探针条目转换为录屏态使用的 FrameworkSnapshot 结构（同步注入穿透提取的业务父组件状态）。 */
export function probeEntryToFrameworkSnapshot(
  entry: FrameworkProbeEntry,
  privacyMode: "safe" | "strict" | "raw"
): FrameworkSnapshot | undefined {
  const framework =
    entry.framework ??
    (entry.componentFile?.endsWith(".vue")
      ? "vue"
      : entry.componentFile
        ? "react"
        : undefined);
  if (!framework || !entry.componentName) return undefined;

  const version = entry.version ?? (framework === "react" ? 18 : 3);
  const targetClean = sanitizePropsAndState(
    entry.props,
    entry.data,
    privacyMode
  );

  const targetComponent: FrameworkComponentNode = {
    framework,
    version,
    componentName: entry.componentName,
    ...(entry.componentFile ? { componentFile: entry.componentFile } : {}),
    ...(entry.componentLine !== undefined
      ? { componentLine: entry.componentLine }
      : {}),
    ...(targetClean.props ? { props: targetClean.props } : {}),
    ...(targetClean.state ? { state: targetClean.state } : {}),
    isTarget: true,
  };

  const fullPath = Array.isArray(entry.componentPath)
    ? entry.componentPath.filter((name) => typeof name === "string" && name)
    : [];
  const ancestorNames =
    fullPath.length > 0 && fullPath[fullPath.length - 1] === entry.componentName
      ? fullPath.slice(0, -1)
      : fullPath.filter((name) => name !== entry.componentName);

  const remainingParents = [...(entry.parentComponents ?? [])];
  const consumeParentMeta = (name: string): FrameworkComponentNode => {
    const idx = remainingParents.findIndex((p) => p.componentName === name);
    const matched = idx >= 0 ? remainingParents.splice(idx, 1)[0] : undefined;
    if (!matched) {
      return { framework, version, componentName: name };
    }
    const clean = sanitizePropsAndState(
      matched.props,
      matched.data,
      privacyMode
    );
    return {
      framework,
      version,
      componentName: name,
      ...(matched.componentFile
        ? { componentFile: matched.componentFile }
        : {}),
      ...(matched.componentLine !== undefined
        ? { componentLine: matched.componentLine }
        : {}),
      ...(clean.props ? { props: clean.props } : {}),
      ...(clean.state ? { state: clean.state } : {}),
    };
  };

  const rootComponent: FrameworkComponentNode | undefined =
    ancestorNames.length > 0 ? consumeParentMeta(ancestorNames[0]!) : undefined;

  const parentChain: FrameworkComponentNode[] = ancestorNames
    .slice(1)
    .reverse()
    .map((name) => consumeParentMeta(name));

  for (const extraParent of remainingParents) {
    const clean = sanitizePropsAndState(
      extraParent.props,
      extraParent.data,
      privacyMode
    );
    parentChain.push({
      framework,
      version,
      componentName: extraParent.componentName,
      ...(extraParent.componentFile
        ? { componentFile: extraParent.componentFile }
        : {}),
      ...(extraParent.componentLine !== undefined
        ? { componentLine: extraParent.componentLine }
        : {}),
      ...(clean.props ? { props: clean.props } : {}),
      ...(clean.state ? { state: clean.state } : {}),
    });
  }

  return {
    ...(rootComponent ? { rootComponent } : {}),
    targetComponent,
    parentChain,
  };
}

function collectProbeCandidateElements(targetElement?: Element): Element[] {
  const candidates: Element[] = [];
  const seen = new Set<Element>();
  const add = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (typeof (node as Element).tagName !== "string") return;
    const el = node as Element;
    if (seen.has(el)) return;
    seen.add(el);
    candidates.push(el);
  };

  add(targetElement);
  if (typeof document !== "undefined") {
    add((document as { activeElement?: unknown }).activeElement);
    if (typeof document.querySelector === "function") {
      add(document.querySelector("#app, #root, [data-reactroot], main"));
      add(document.querySelector("#app > *, #root > *, [data-v-app] > *"));
      add(document.querySelector("body > div, body > main, body > section"));
    }
    add(document.body);
  }
  return candidates;
}

export type CaptureFrameworkStateWithMainProbeInput = {
  sessionId: string;
  trigger: FrameworkStateTrigger;
  privacyMode: "safe" | "strict" | "raw";
  frameId?: number;
  targetElement?: Element;
  probeFn?: (
    elements: Element[]
  ) => Promise<Map<Element, FrameworkProbeEntry | null>>;
};

/**
 * 采集录制态框架状态，并在隔离世界探不到组件树时通过 background world:"MAIN" 探针补全。
 */
export async function captureFrameworkStateWithMainProbe(
  input: CaptureFrameworkStateWithMainProbeInput
): Promise<FrameworkStateEvidence> {
  const base = captureFrameworkState(input);
  if (base.snapshot?.rootComponent || base.snapshot?.targetComponent) {
    return base;
  }

  const canRunProbe =
    typeof input.probeFn === "function" ||
    (typeof chrome !== "undefined" &&
      typeof chrome.runtime?.sendMessage === "function");
  if (!canRunProbe) return base;

  const candidates = collectProbeCandidateElements(input.targetElement);
  if (candidates.length === 0) return base;

  try {
    const probe = input.probeFn ?? probeFrameworkComponents;
    const probed = await probe(candidates);
    for (const el of candidates) {
      const entry = probed.get(el);
      if (!entry) continue;
      const snapshot = probeEntryToFrameworkSnapshot(entry, input.privacyMode);
      if (snapshot) {
        return { ...base, snapshot };
      }
    }
  } catch {
    // 主世界探测失败时保留同步基线证据，不阻塞录制流程
  }
  return base;
}
