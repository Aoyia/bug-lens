export interface ExportManifestFileEntry {
  byteLength: number;
  sha256: string;
}

export interface ExportManifest {
  format?: string;
  schemaVersion?: number;
  createdAtEpochMs?: number;
  sessionId?: string;
  files?: Record<string, ExportManifestFileEntry>;
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
  hasMedia?: boolean;
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
    dataUrl?: string;
  };
}

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
}

export interface NetworkEntry {
  id: string;
  createdAt?: number;
  url: string;
  method?: string;
  type?: string;
  status?: number;
  statusText?: string;
  durationMs?: number;
  initiatorType?: string;
  errorText?: string;
  request?: {
    headers?: Record<string, string>;
    postData?: string;
    body?: string;
  };
  response?: {
    mimeType?: string;
    bodyStatus?: string;
    byteLength?: number;
    truncated?: boolean;
    bodyPath?: string;
    body?: string;
    headers?: Record<string, string>;
    cache?: Record<string, unknown>;
  };
}

export interface NetworkDetailEntry {
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody?: string;
  postData?: string;
  initiator?: {
    type?: string;
    url?: string;
    lineNumber?: number;
    columnNumber?: number;
    stack?: unknown;
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
          confidence?: "explicit" | "inferred" | "missing" | string;
        };
    reproductionHint?: string;
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
}

export interface SessionDataPayload {
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
  networkEntries?: NetworkEntry[];
  issueScenes?: IssueSceneEnvelope[];
  frameworkStates?: FrameworkStateEntry[];
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
