export interface PackFileEntryMeta {
  path: string;
  byteLength: number;
}

export type PackFileMap =
  | Map<string, Uint8Array>
  | {
      has(relPath: string): boolean;
      get(relPath: string): Uint8Array | undefined;
      delete?(relPath: string): boolean;
      readonly size: number;
      keys(): IterableIterator<string>;
      entries(): IterableIterator<[string, Uint8Array]>;
      listEntries?(): PackFileEntryMeta[];
      getMetadata?(relPath: string): { byteLength: number } | undefined;
      readBytesUncached?(relPath: string): Uint8Array | undefined;
    };

export interface ExportManifestFileEntry {
  byteLength: number;
  sha256: string;
}

export interface ExportManifest {
  format?: string;
  schemaVersion?: number;
  packMode?: "ai-minimal" | "full-viewer" | string;
  createdAtEpochMs?: number;
  sessionId?: string;
  extensionVersion?: string;
  files?: Record<string, ExportManifestFileEntry>;
  casStats?: {
    totalBlobCount?: number;
    totalBlobBytes?: number;
    deduplicatedBytesSaved?: number;
  };
  migration?: {
    currentSchemaVersion?: number;
    supportedFrom?: number[];
  };
}

export interface IntegrityReport {
  hasManifest: boolean;
  valid: boolean;
  schemaVersion?: number;
  schemaWarning?: string;
  checkedCount: number;
  skippedCount: number;
  mismatches: string[];
}

export interface SessionSummary {
  url?: string;
  title?: string;
  durationMs?: number;
  privacyMode?: string;
  quality?: string;
  environment?: {
    os?: string;
    browser?: string;
    language?: string;
    screen?: string;
    viewport?: string;
  };
  interactions?: {
    total?: number;
    byKind?: Record<string, number>;
    screenshots?: number;
  };
  console?: {
    total?: number;
    errors?: number;
    warnings?: number;
  };
  network?: {
    total?: number;
    byStatus?: Record<string, number>;
    byType?: Record<string, number>;
    domains?: string[];
    failures?: unknown[];
  };
  issueScenes?: number;
  frameworkStates?: number;
  finalFramePath?: string;
  hasMedia?: boolean;
  metrics?: {
    interactionCount?: number;
    screenshotCount?: number;
    consoleSummary?: {
      totalOriginalEntries?: number;
      uniqueSignatureCount?: number;
      errorCount?: number;
      warningCount?: number;
    };
    networkSummary?: {
      totalRequests?: number;
      failedRequests?: number;
      totalNetworkBytes?: number;
      casDeduplicatedCount?: number;
    };
    issueSceneCount?: number;
    frameworkStateCount?: number;
  };
}

export interface ScreenshotSummaryItem {
  step?: number;
  path?: string;
  elapsedMs?: number;
  kind?: string;
  element?: string;
  pageUrl?: string;
}

export interface ElementLocator {
  kind?: string;
  expression?: string;
  matchCount?: number;
  stabilityScore?: number;
  reasons?: string[];
}

export interface FrameworkComponentNode {
  framework?: "vue" | "react" | string;
  version?: number;
  componentName?: string;
  props?: Record<string, unknown>;
  state?: Record<string, unknown>;
  data?: Record<string, unknown>;
  children?: FrameworkComponentNode[];
  isTarget?: boolean;
  componentPath?: string[];
  componentFile?: string;
  componentLine?: number;
  filePath?: string;
}

export interface FrameworkSnapshot {
  rootComponent?: FrameworkComponentNode;
  targetComponent?: FrameworkComponentNode;
  parentChain?: FrameworkComponentNode[];
}

export interface ElementDescriptor {
  tagName?: string;
  id?: string;
  classNames?: string[];
  attributes?: Record<string, string>;
  text?: string;
  value?: string;
  role?: string;
  accessibleName?: string;
  boundingBox?: { x?: number; y?: number; width?: number; height?: number };
  locators?: ElementLocator[];
  framework?: FrameworkSnapshot | FrameworkComponentNode;
}

export interface InteractionEntry {
  id?: string;
  sessionId?: string;
  kind?: string;
  status?: string;
  createdAt?: number;
  elapsedMs?: number;
  page?: {
    url?: string;
    title?: string;
    frameId?: number;
  };
  input?: {
    pointerType?: string;
    button?: number;
    isTrusted?: boolean;
    data?: string;
    value?: string;
    key?: string;
  };
  coordinates?: {
    clientX?: number;
    clientY?: number;
    pageX?: number;
    pageY?: number;
  };
  element?: ElementDescriptor;
  target?: ElementDescriptor;
  metadata?: Record<string, unknown>;
  screenshot?: {
    status?: string;
    source?: string;
    assetId?: string;
    settledAssetId?: string;
    settledDurationMs?: number;
    dataUrl?: string;
  };
  screenshots?: {
    instantPath?: string;
    settledPath?: string;
    settledDurationMs?: number;
  };
}

import type { ConsoleNoiseCategory } from "../../domain/console-noise.ts";

export interface DiagnosticStackFrame {
  functionName?: string;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
  sourceMappedLocation?: {
    resolved?: boolean;
    originalFile?: string;
    originalLine?: number;
    originalColumn?: number;
    originalFunctionName?: string;
  };
}

export interface ConsoleEntry {
  id?: string;
  createdAt?: number;
  level?: string;
  text?: string;
  source?: string;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
  stackTrace?: string | DiagnosticStackFrame[];
  stack?: string;
  sourceMappedLocation?: {
    resolved?: boolean;
    originalFile?: string;
    originalLine?: number;
    originalColumn?: number;
    originalFunctionName?: string;
    originalName?: string;
    failureReason?: string;
  };
  /** 良性插件/内部诊断噪音标注（如 Vue DevTools 版本冲突提示） */
  isNoise?: boolean;
  noiseCategory?: ConsoleNoiseCategory;
  /** Schema v5 consoleSummary 预折叠元数据（内部/查询保留，避免展开大数组） */
  repeatCount?: number;
  lastCreatedAt?: number;
  timeRangeMs?: [number, number];
  summarySignature?: string;
  summaryTimestamps?: number[];
}

export interface ConsoleFoldedEntryV5 {
  signature?: string;
  level: string;
  text: string;
  source?: string;
  count: number;
  isNoise?: boolean;
  noiseCategory?: ConsoleNoiseCategory;
  firstCreatedAt?: number;
  lastCreatedAt?: number;
  timeRangeMs?: [number, number];
  timestamps?: number[];
  location?:
    | string
    | {
        url?: string;
        lineNumber?: number;
        columnNumber?: number;
      };
  sourceMappedLocation?: ConsoleEntry["sourceMappedLocation"];
}

export interface NetworkEntry {
  id: string;
  createdAt?: number;
  elapsedMs?: number;
  url: string;
  method?: string;
  type?: string;
  status?: number;
  statusText?: string;
  durationMs?: number;
  initiatorType?: string;
  errorText?: string;
  isStaticAsset?: boolean;
  isBenignStatic?: boolean;
  businessError?: {
    code?: string | number;
    message?: string;
  };
  request?: {
    headers?: Record<string, string>;
    postData?: string;
    body?: string;
    bodyHash?: string;
    byteLength?: number;
    contentType?: string;
  };
  response?: {
    mimeType?: string;
    bodyStatus?: string;
    byteLength?: number;
    truncated?: boolean;
    bodyPath?: string;
    bodyHash?: string;
    body?: string;
    fromCache?: boolean;
    isBinary?: boolean;
    headers?: Record<string, string>;
    cache?: Record<string, unknown>;
  };
}

export interface NetworkDetailEntry {
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody?: string;
  postData?: string;
  bodyBlob?: {
    path?: string;
    hash?: string;
    byteLength?: number;
    size?: number;
    mimeType?: string;
  };
  requestBodyBlob?: {
    path?: string;
    hash?: string;
    byteLength?: number;
    size?: number;
  };
  initiator?: {
    type?: string;
    url?: string;
    lineNumber?: number;
    columnNumber?: number;
    stack?: unknown;
    topFrame?: {
      type?: string;
      url?: string;
      lineNumber?: number;
      columnNumber?: number;
      functionName?: string;
      sourceMappedLocation?: ConsoleEntry["sourceMappedLocation"];
    };
  };
}

export interface IssueSceneTarget {
  capturedAtEpochMs?: number;
  element?: ElementDescriptor;
  sanitizedHtml?: string;
  ancestors?: Array<{
    tagName?: string;
    id?: string;
    classNames?: string[];
  }>;
  state?: Record<string, unknown>;
  computedStyle?: Record<string, string>;
  relatedOverlays?: Array<{
    tagName?: string;
    id?: string;
    classNames?: string[];
    role?: string;
    boundingBox?: { x?: number; y?: number; width?: number; height?: number };
    relationReason?: string;
    sanitizedHtml?: string;
  }>;
  triggerElement?: {
    tagName?: string;
    id?: string;
    classNames?: string[];
    role?: string;
    accessibleName?: string;
    text?: string;
    selectorPath?: string;
    componentName?: string;
    ancestors?: Array<{ tagName?: string; id?: string; classNames?: string[] }>;
  };
  winnerRules?: Array<{
    selector: string;
    source: string;
    specificity?: string;
    properties: Record<string, string>;
  }>;
}

export interface IssueSceneDomContextV5 {
  sceneId?: string;
  targetSelector?: string;
  targetElement?: Record<string, unknown>;
  relatedOverlays?: IssueSceneTarget["relatedOverlays"];
  triggerElement?: IssueSceneTarget["triggerElement"];
}

export interface IssueSceneDomStylesV5 {
  sceneId?: string;
  targetSelector?: string;
  computedLayoutStyles?: Record<string, string>;
  winnerRules?: Array<{
    selector: string;
    source: string;
    specificity?: string;
    properties: Record<string, string>;
  }>;
}

export interface IssueSceneObject {
  id?: string;
  sessionId?: string;
  status?: string;
  observedAtEpochMs?: number;
  selectionStartedAtEpochMs?: number;
  committedAtEpochMs?: number;
  sequenceContext?: {
    anchorEpochMs?: number;
    windowMs?: number;
    interactions?: Array<{
      id?: string;
      kind?: string;
      createdAt?: number;
      offsetMs?: number;
      tagName?: string;
      text?: string;
      value?: string;
    }>;
    consoleErrors?: Array<{
      id?: string;
      createdAt?: number;
      offsetMs?: number;
      text?: string;
      level?: string;
    }>;
    networkFailures?: Array<{
      id?: string;
      createdAt?: number;
      offsetMs?: number;
      url?: string;
      status?: number;
      method?: string;
    }>;
  };
  page?: {
    url?: string;
    title?: string;
  };
  target?: IssueSceneTarget;
  targets?: IssueSceneTarget[];
  annotation?: Record<string, unknown>;
  narrative?: {
    actual?: string;
    expected?:
      | string
      | {
          text?: string;
          tags?: string[];
          confidence?:
            "explicit" | "tag-only" | "inferred" | "missing" | string;
        };
    note?: string;
    reproductionHint?: string;
  };
  /** 工单五问人工草稿（可选，旧包缺失） */
  ticketDraft?: {
    symptom?: string;
    impact?: string;
    isBug?: string;
    workaround?: string;
    eta?: string;
    updatedAtEpochMs?: number;
  };
  screenshot?: {
    status?: string;
    originalAssetId?: string;
    annotatedAssetId?: string;
  };
  issues?: unknown[];
}

export interface IssueSceneEnvelope {
  scene?: IssueSceneObject;
  id?: string;
  observedAtEpochMs?: number;
  targetSelector?: string;
  domContextPath?: string;
  domStylesPath?: string;
  originalSource?: string;
  annotatedSource?: string;
  // 兼容直接扁平 scene 结构
  narrative?: IssueSceneObject["narrative"];
  sequenceContext?: IssueSceneObject["sequenceContext"];
  target?: IssueSceneTarget;
  targets?: IssueSceneTarget[];
}

export interface FrameworkStateEntry {
  id?: string;
  sessionId?: string;
  capturedAtEpochMs?: number;
  trigger?: string;
  framework?: string;
  page?: {
    url?: string;
    title?: string;
    frameId?: number;
    viewport?: { width?: number; height?: number };
    scrollY?: number;
  };
  snapshot?: FrameworkSnapshot;
  components?: FrameworkComponentNode[];
  globalState?: Record<string, unknown>;
  webStorage?: {
    localStorage?: Record<string, unknown>;
    sessionStorage?: Record<string, unknown>;
    redactedValues?: boolean;
  };
  webStorageDiff?: {
    localStorageChanged?: Record<string, unknown>;
    sessionStorageChanged?: Record<string, unknown>;
    localStorage?: Record<string, unknown>;
    sessionStorage?: Record<string, unknown>;
    redactedValues?: boolean;
  };
}

export interface SessionDataPayload {
  format?: string;
  schemaVersion?: number;
  summary?: SessionSummary;
  screenshotSummaries?: ScreenshotSummaryItem[];
  protocolVersion?: number;
  session?: {
    id?: string;
    schemaVersion?: number;
    extensionVersion?: string;
    status?: string;
    target?: {
      initialUrl?: string;
      initialTitle?: string;
      environment?: Record<string, unknown>;
    };
    userNarrative?: {
      actual?: string;
      expected?: string;
      updatedAtEpochMs?: number;
    };
    options?: Record<string, unknown>;
    timeline?: {
      createdAtEpochMs?: number;
      startedAtEpochMs?: number;
      stoppedAtEpochMs?: number;
      durationMs?: number;
    };
    quality?: Record<string, unknown>;
  };
  interactions?: InteractionEntry[];
  consoleEntries?: ConsoleEntry[];
  consoleLogs?: ConsoleEntry[];
  consoleSummary?: ConsoleFoldedEntryV5[];
  networkEntries?: NetworkEntry[];
  issueScenes?: IssueSceneEnvelope[];
  frameworkStates?: FrameworkStateEntry[];
  userNarrative?: {
    actual?: string;
    expected?: string;
    updatedAtEpochMs?: number;
  };
  hasMedia?: boolean;
}

export interface ScreenshotDomAnchor {
  selector?: string;
  tagName?: string;
  id?: string;
  className?: string;
  selectorPath?: string;
  innerText?: string;
  relativeRect?: { x?: number; y?: number; width?: number; height?: number };
  computedStyles?: Record<string, string>;
  boxModel?: Record<string, unknown>;
  layoutContext?: Record<string, unknown>;
  componentName?: string;
  componentPath?: string[];
  componentFile?: string;
  componentLine?: number;
  visibility?: string;
  exposure?: string;
  obscuredBy?: string;
  isErrorSignal?: boolean;
  selectState?: Record<string, unknown>;
  intentFlags?: {
    isArrowTarget?: boolean;
    isHighlightedFocus?: boolean;
    isPrivacyRedacted?: boolean;
    textComment?: string;
  };
}

export interface ScreenshotDomContext {
  smallestCommonAncestorSelector?: string;
  meta?: {
    anchorCount?: number;
    leafCount?: number;
    ancestorCount?: number;
    truncated?: boolean;
  };
  anchors?: ScreenshotDomAnchor[];
  leaves?: Array<Record<string, unknown>>;
  ancestors?: Array<Record<string, unknown>>;
  tree?: Record<string, unknown>;
}

export interface ScreenshotEnvironment {
  url?: string;
  title?: string;
  userAgent?: string;
  viewport?: { width?: number; height?: number; dpr?: number };
  mediaBreakpoint?: string;
  recentConsoleErrors?: Array<{
    message?: string;
    stack?: string;
    timestamp?: number;
  }>;
  recentFailedRequests?: Array<{
    url?: string;
    method?: string;
    status?: number;
    statusText?: string;
    timestamp?: number;
  }>;
  frameworkComponentStates?: FrameworkComponentNode[];
  vueComponentStates?: FrameworkComponentNode[];
}

export interface CascadeSheetSource {
  id: string;
  href?: string;
  ownerNodeTag?: string;
  rulesCount?: number;
  isInline?: boolean;
}

export interface CascadeRuleSource {
  id: string;
  sheetId: string;
  selectorText: string;
  cssText: string;
  styleProps?: Record<string, string>;
  source?: string;
}

export interface CascadeInheritedRuleRef {
  ancestorSelector: string;
  ancestorTagName: string;
  ruleId: string;
  inheritedProps: Record<string, string>;
}

export interface CascadeElementRef {
  id: string;
  selector: string;
  tagName: string;
  matchedRuleIds: string[];
  inheritedRules?: CascadeInheritedRuleRef[];
}

export interface CascadePropertySource {
  property: string;
  value: string;
  sourceRuleId?: string;
  isInline?: boolean;
  isImportant?: boolean;
  inheritedFromSelector?: string;
}

export interface CascadeIndex {
  sheets?: CascadeSheetSource[];
  rules?: CascadeRuleSource[];
  elements?: CascadeElementRef[];
  perProperty?: Record<
    string,
    CascadePropertySource[] | Record<string, CascadePropertySource>
  >;
  meta?: {
    sheetCount?: number;
    ruleCount?: number;
    elementCount?: number;
    totalSheetCount?: number;
    totalRuleCount?: number;
    pruned?: boolean;
    capturedAtEpochMs?: number;
  };
}
