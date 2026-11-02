/**
 * 本地全量黑匣子性能与诊断存储管理
 *
 * 严格遵循本地隐私优先原则，所有数据仅存储于浏览器本地 chrome.storage.local（具备 unlimitedStorage 权限），
 * 绝不发起任何外部网络请求。
 *
 * 采集深度：
 * 1. 长期宏观统计与分位数基线（P50 / P95 / Max）
 * 2. 最近 200 条任务全量黑匣子 Profile（含 6 阶段完整账本、瀑布流、算法效率指标、QualitySummary、CaptureIssue[]）
 * 3. 录制期高频微操作明细（每次交互截图通道与耗时、IndexedDB 批量刷盘耗时、多标签页切换与 CDP 挂载耗时）
 * 4. 最近 1000 条跨进程内部运行告警与异常堆栈（Flight Recorder）
 * 5. 运行时 JS 堆内存与存储水位快照
 */

import type {
  ExportPipelineDashboard,
  ExportTraceContext,
} from "../export/export-trace";
import type {
  EvidenceSummary,
  QualitySummary,
  SessionOverview,
} from "../shared/protocol";

export interface LatencyPercentiles {
  count: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

export interface MacroMetrics {
  totalRecordings: number;
  totalScreenshots: number;
  totalPromptCopies: number;
  totalRecordingDurationMs: number;
  totalExportDurationMs: number;
  avgExportDurationMs: number;
  failedTasksCount: number;
  totalInternalErrors?: number;
  totalMicroOpsRecorded?: number;
  exportLatencyStats?: LatencyPercentiles;
  screenshotLatencyStats?: LatencyPercentiles;
}

export interface MemorySnapshot {
  usedJSHeapBytes: number;
  totalJSHeapBytes: number;
  jsHeapLimitBytes: number;
  capturedAt: number;
}

export interface StorageWaterlineSnapshot {
  usedBytes: number;
  quotaBytes: number;
  sessionCount: number;
  capturedAt: number;
}

export type MicroOpCategory =
  | "interaction-screenshot"
  | "storage-batch-flush"
  | "media-chunk-write"
  | "multi-tab-event"
  | "cdp-operation"
  | "screenshot-probe";

export interface MicroOpRecord {
  id: string;
  timestamp: number;
  category: MicroOpCategory;
  name: string;
  durationMs: number;
  status: "ok" | "degraded" | "error";
  detail?: Record<string, unknown>;
}

export type FlightLogProcess =
  | "background"
  | "offscreen"
  | "content"
  | "preview"
  | "popup"
  | "options"
  | "unknown";

export interface FlightRecorderLogEntry {
  id: string;
  timestamp: number;
  level: "warn" | "error" | "fatal";
  process: FlightLogProcess;
  sessionId?: string;
  code?: string;
  message: string;
  stack?: string;
  extra?: Record<string, unknown>;
}

export interface TaskProfileContext {
  sourceType?: "tab" | "desktop";
  captureSource?: "tab" | "window" | "screen";
  tabCount?: number;
  tabSwitchCount?: number;
  targetUrl?: string;
  targetTitle?: string;
  targetUrls?: string[];
  platform: string;
  userAgent?: string;
  extensionVersion: string;
}

export interface TaskProfileBreakdown {
  stage1_ipcDispatchMs?: number;
  stage2_cdpDrainMs?: number;
  stage3_assemblyMs?: number;
  stage3_idbReadMs?: number;
  stage3_sourceMapMs?: number;
  stage4_zipPackMs?: number;
  stage5_browserDownloadMs?: number;
  stage6_feedbackMs?: number;
  unaccountedOverheadMs?: number;
  // 截图阶段细分
  domCaptureMs?: number;
  imageRenderMs?: number;
  styleSourceMs?: number;
  zipPackMs?: number;
  promptFormatMs?: number;
}

export interface TaskProfileSummary {
  producedBytes?: number;
  rawInputBytes?: number;
  compressionRatio?: number;
  eventsCount?: number;
  requestsCount?: number;
  consoleCount?: number;
  mediaChunksCount?: number;
  mediaBytes?: number;
  throughputMBps?: number;
}

export interface ScreenshotDiagnosticDetail {
  viewport?: { width: number; height: number };
  cropBounds?: { x: number; y: number; width: number; height: number };
  dpr?: number;
  styleAdjustmentMode?: boolean;
  annotationCount?: number;
  domNodesCount?: number;
  domAnchorsCount?: number;
  frameworkComponentsCount?: number;
  cascadeElementsCount?: number;
  recentConsoleErrorsCount?: number;
  recentFailedRequestsCount?: number;
  zipBytes?: number;
  zipFilename?: string;
  promptInjectedWithPath?: boolean;
}

export interface TaskProfileError {
  code: string;
  message: string;
  stack?: string;
}

export interface TaskProfile {
  id: string;
  timestamp: number;
  taskType: "recording" | "screenshot";
  status: "success" | "error";
  durationMs: number;
  /** 端到端导出或处理总耗时（录制任务特指导出阶段总墙钟耗时，截图任务同 durationMs） */
  pipelineWallClockMs?: number;
  /** 自动识别出的耗时占比最高瓶颈阶段 */
  bottleneckStage?: string;
  context: TaskProfileContext;
  breakdown?: TaskProfileBreakdown;
  metricsSummary?: TaskProfileSummary;
  /** 录制会话质量摘要与全部采集期告警/异常 */
  qualitySummary?: QualitySummary;
  /** IndexedDB 中该会话各类证据资产体积与条数明细 */
  evidenceBreakdown?: EvidenceSummary[];
  /** 录制导出全链路 6 阶段原始指标 */
  exportTrace?: ExportTraceContext;
  /** 录制导出完整时间账本、算法效率看板与子步骤瀑布流 */
  exportDashboard?: ExportPipelineDashboard;
  /** 智能截图深度诊断上下文 */
  screenshotDetail?: ScreenshotDiagnosticDetail;
  /** 任务期间收集到的高频微操作明细 */
  microOps?: MicroOpRecord[];
  /** JS 堆内存水位快照 */
  memorySnapshot?: MemorySnapshot;
  /** IndexedDB 存储水位快照 */
  storageSnapshot?: StorageWaterlineSnapshot;
  error?: TaskProfileError;
}

export interface DiagnosticsData {
  metrics: MacroMetrics;
  recentProfiles: TaskProfile[];
  flightRecorderLogs: FlightRecorderLogEntry[];
}

export const DIAGNOSTICS_STORAGE_KEY = "bug_lens_diagnostics";
export const MAX_RECENT_PROFILES = 200;
export const MAX_FLIGHT_RECORDER_LOGS = 1000;
export const MAX_MICRO_OPS_PER_TASK = 500;

export const DEFAULT_DIAGNOSTICS_DATA: DiagnosticsData = {
  metrics: {
    totalRecordings: 0,
    totalScreenshots: 0,
    totalPromptCopies: 0,
    totalRecordingDurationMs: 0,
    totalExportDurationMs: 0,
    avgExportDurationMs: 0,
    failedTasksCount: 0,
    totalInternalErrors: 0,
    totalMicroOpsRecorded: 0,
  },
  recentProfiles: [],
  flightRecorderLogs: [],
};

// 内存级会话微操作缓冲区（按 sessionId 归集录制期高频微操作，在会话结束记录 Profile 时一并落盘）
const inMemoryMicroOpsBySession = new Map<string, MicroOpRecord[]>();
const inMemoryTabSwitchCountBySession = new Map<string, number>();

// 进程内串行写入锁，防止并发 get -> modify -> set 发生竞态覆盖
let storageMutationQueue: Promise<any> = Promise.resolve();

function enqueueStorageMutation<T>(fn: () => Promise<T>): Promise<T> {
  const next = storageMutationQueue.then(fn, fn);
  storageMutationQueue = next.catch(() => undefined);
  return next;
}

/** 合并两个对象，忽略 undefined 字段，避免后到的局部更新把已有的完整字段冲成 undefined */
function mergeDefined<T extends Record<string, any>>(
  base: T | undefined,
  patch: Partial<T> | undefined
): T | undefined {
  if (!base && !patch) return undefined;
  const result: Record<string, any> = { ...(base ?? {}) };
  if (patch) {
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) {
        result[k] = v;
      }
    }
  }
  return result as T;
}

/**
 * 显式脱敏工具函数（供需要对外公开分享的场景或单元测试调用）。
 * 注意：在本地自用黑匣子模式（recordTaskProfile / exportFullDiagnostics）中，
 * 默认 100% 原始无损保留真实 URL、路径与错误堆栈。
 */
export function sanitizeDiagnosticsText(text: string): string {
  if (!text) return "";
  return text
    .replace(/https?:\/\/[^\s"'`<>]+/g, (url) => {
      try {
        const parsed = new URL(url);
        return `${parsed.protocol}//${parsed.hostname}${parsed.pathname.split("/").slice(0, 2).join("/")}/*`;
      } catch {
        return "https://[masked-domain]/*";
      }
    })
    .replace(
      /(?:\/Users\/|\/home\/|C:\\Users\\)[^/\\'"\s]+/g,
      "/Users/[masked-user]"
    );
}

/** 仅过滤高危凭证字面量（如 Bearer Token），100% 保留真实 URL、文件路径与错误堆栈 */
export function redactCredentialsOnly(text: string): string {
  if (!text) return "";
  return text.replace(
    /\b(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi,
    "$1[REDACTED_TOKEN]"
  );
}

/** 捕获当前进程 JS 堆内存水位快照 */
export function captureMemorySnapshot(): MemorySnapshot | undefined {
  try {
    const perf =
      typeof performance !== "undefined" ? (performance as any) : undefined;
    if (perf && perf.memory) {
      return {
        usedJSHeapBytes: Number(perf.memory.usedJSHeapSize) || 0,
        totalJSHeapBytes: Number(perf.memory.totalJSHeapSize) || 0,
        jsHeapLimitBytes: Number(perf.memory.jsHeapSizeLimit) || 0,
        capturedAt: Date.now(),
      };
    }
  } catch {
    // 忽略非 Chromium 或未暴露 performance.memory 的环境
  }
  return undefined;
}

/** 计算耗时数组的分位数统计（Avg / P50 / P95 / Max） */
export function computeLatencyPercentiles(
  values: number[]
): LatencyPercentiles {
  const valid = values.filter(
    (v) => typeof v === "number" && Number.isFinite(v) && v >= 0
  );
  if (valid.length === 0) {
    return { count: 0, avgMs: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 };
  }
  const sorted = [...valid].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const pick = (p: number) => {
    const idx = Math.min(
      sorted.length - 1,
      Math.max(0, Math.ceil(p * sorted.length) - 1)
    );
    return Math.round(sorted[idx]);
  };
  return {
    count: sorted.length,
    avgMs: Math.round(sum / sorted.length),
    p50Ms: pick(0.5),
    p95Ms: pick(0.95),
    maxMs: Math.round(sorted[sorted.length - 1]),
  };
}

/** 计算单条任务的导出/处理流水线总墙钟耗时 */
export function computeEffectivePipelineMs(
  p: Partial<TaskProfile>
): number | undefined {
  if (
    typeof p.pipelineWallClockMs === "number" &&
    Number.isFinite(p.pipelineWallClockMs) &&
    p.pipelineWallClockMs > 0
  ) {
    return Math.round(p.pipelineWallClockMs);
  }
  if (
    p.exportDashboard?.totalWallClockMs &&
    p.exportDashboard.totalWallClockMs > 0
  ) {
    return Math.round(p.exportDashboard.totalWallClockMs);
  }
  if (p.taskType === "recording" && p.breakdown) {
    const sum =
      (p.breakdown.stage1_ipcDispatchMs || 0) +
      (p.breakdown.stage2_cdpDrainMs || 0) +
      (p.breakdown.stage3_assemblyMs || 0) +
      (p.breakdown.stage4_zipPackMs || 0) +
      (p.breakdown.stage5_browserDownloadMs || 0) +
      (p.breakdown.stage6_feedbackMs || 0);
    if (sum > 0) return Math.round(sum);
  }
  if (p.taskType === "screenshot" && p.durationMs && p.durationMs > 0) {
    return Math.round(p.durationMs);
  }
  return undefined;
}

/** 自动识别单次任务中耗时占比最高的瓶颈阶段 */
export function detectBottleneckStage(
  taskType: "recording" | "screenshot",
  breakdown?: TaskProfileBreakdown
): string | undefined {
  if (!breakdown) return undefined;
  const candidates: Array<{ name: string; ms: number }> =
    taskType === "recording"
      ? [
          { name: "Stage1: IPC分发", ms: breakdown.stage1_ipcDispatchMs ?? 0 },
          {
            name: "Stage2: CDP排空与萃取",
            ms: breakdown.stage2_cdpDrainMs ?? 0,
          },
          {
            name:
              breakdown.stage3_sourceMapMs &&
              breakdown.stage3_sourceMapMs > (breakdown.stage3_idbReadMs ?? 0)
                ? "Stage3: SourceMap逆向与组装"
                : "Stage3: DB读取与组装",
            ms: breakdown.stage3_assemblyMs ?? 0,
          },
          { name: "Stage4: 流式ZIP封包", ms: breakdown.stage4_zipPackMs ?? 0 },
          {
            name: "Stage5: 浏览器下载落盘",
            ms: breakdown.stage5_browserDownloadMs ?? 0,
          },
          {
            name: "Stage6: 终端剪贴板反馈",
            ms: breakdown.stage6_feedbackMs ?? 0,
          },
        ]
      : [
          { name: "图像裁剪与绘制", ms: breakdown.imageRenderMs ?? 0 },
          { name: "DOM空间树与探针", ms: breakdown.domCaptureMs ?? 0 },
          { name: "CDP样式源码定位", ms: breakdown.styleSourceMs ?? 0 },
          { name: "ZIP封包与下载", ms: breakdown.zipPackMs ?? 0 },
          { name: "Prompt格式化", ms: breakdown.promptFormatMs ?? 0 },
        ];

  let maxItem: { name: string; ms: number } | undefined;
  let totalSum = 0;
  for (const item of candidates) {
    if (item.ms > 0) {
      totalSum += item.ms;
      if (!maxItem || item.ms > maxItem.ms) {
        maxItem = item;
      }
    }
  }
  if (!maxItem) return undefined;
  const pct = totalSum > 0 ? ((maxItem.ms / totalSum) * 100).toFixed(1) : "0.0";
  return `${maxItem.name} (${Math.round(maxItem.ms)}ms, ${pct}%)`;
}

/** 获取运行环境元数据 */
export function getRuntimeContext(
  partial?: Partial<TaskProfileContext>
): TaskProfileContext {
  let platform = "unknown";
  let userAgent: string | undefined;
  if (typeof navigator !== "undefined") {
    platform =
      navigator.platform || (navigator as any).userAgentData?.platform || "web";
    userAgent = navigator.userAgent;
  }

  let extensionVersion = "0.7.37";
  if (typeof chrome !== "undefined" && chrome.runtime?.getManifest) {
    try {
      extensionVersion =
        chrome.runtime.getManifest().version || extensionVersion;
    } catch {
      // 忽略
    }
  }

  return {
    platform,
    userAgent,
    extensionVersion,
    ...partial,
  };
}

/**
 * 记录会话内高频微操作（内存 O(1) 缓冲，不阻塞主业务 I/O，随任务收口自动归档）
 */
export function recordMicroOp(
  sessionId: string | undefined,
  op: Omit<MicroOpRecord, "id" | "timestamp"> & {
    id?: string;
    timestamp?: number;
  }
): void {
  const key = sessionId || "__global__";
  const list = inMemoryMicroOpsBySession.get(key) ?? [];
  const now = op.timestamp ?? Date.now();
  const record: MicroOpRecord = {
    id: op.id || `op_${now}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: now,
    category: op.category,
    name: op.name,
    durationMs: Math.round(op.durationMs * 100) / 100,
    status: op.status,
    detail: op.detail,
  };
  list.push(record);
  if (list.length > MAX_MICRO_OPS_PER_TASK) {
    list.splice(0, list.length - MAX_MICRO_OPS_PER_TASK);
  }
  inMemoryMicroOpsBySession.set(key, list);

  if (
    op.category === "multi-tab-event" &&
    op.name === "tab-switch" &&
    sessionId
  ) {
    inMemoryTabSwitchCountBySession.set(
      sessionId,
      (inMemoryTabSwitchCountBySession.get(sessionId) ?? 0) + 1
    );
  }
}

/** 提取并清空指定会话的内存微操作缓冲 */
export function consumeSessionMicroOps(sessionId: string): {
  microOps: MicroOpRecord[];
  tabSwitchCount: number;
} {
  const ops = inMemoryMicroOpsBySession.get(sessionId) ?? [];
  inMemoryMicroOpsBySession.delete(sessionId);
  const switches = inMemoryTabSwitchCountBySession.get(sessionId) ?? 0;
  inMemoryTabSwitchCountBySession.delete(sessionId);
  return { microOps: ops, tabSwitchCount: switches };
}

/** 对读取出的 Profile 进行规范化与缺失派生字段（如旧记录的 bottleneckStage / pipelineWallClockMs）自动回填 */
function normalizeProfileOnRead(p: TaskProfile): TaskProfile {
  const effectivePipelineMs = computeEffectivePipelineMs(p);
  const bottleneck =
    p.bottleneckStage || detectBottleneckStage(p.taskType, p.breakdown);
  return {
    ...p,
    pipelineWallClockMs: p.pipelineWallClockMs ?? effectivePipelineMs,
    bottleneckStage: bottleneck,
  };
}

/**
 * 利用 IndexedDB 中现存的 SessionOverview[] 自动关联回填并丰富诊断 Profile（如补齐旧记录缺失的 targetUrl、qualitySummary、evidenceBreakdown）
 */
export function enrichDiagnosticsWithSessionOverviews(
  data: DiagnosticsData,
  overviews?: SessionOverview[]
): DiagnosticsData {
  if (!overviews || overviews.length === 0) return data;

  const overviewMap = new Map<string, SessionOverview>();
  for (const ov of overviews) {
    if (ov?.session?.id) {
      overviewMap.set(ov.session.id, ov);
    }
  }

  const enrichedProfiles = data.recentProfiles.map((p) => {
    const ov = overviewMap.get(p.id);
    if (!ov) return p;
    const s = ov.session;
    return normalizeProfileOnRead({
      ...p,
      durationMs:
        p.durationMs ||
        s.timeline?.durationMs ||
        (s.timeline?.stoppedAtEpochMs && s.timeline?.startedAtEpochMs
          ? Math.max(
              0,
              s.timeline.stoppedAtEpochMs - s.timeline.startedAtEpochMs
            )
          : 0),
      context: {
        ...p.context,
        captureSource: p.context.captureSource ?? s.captureSource ?? "tab",
        sourceType:
          p.context.sourceType ??
          (s.captureSource === "tab" ? "tab" : "desktop"),
        tabCount: p.context.tabCount ?? s.targets?.length ?? 1,
        targetUrl: p.context.targetUrl || s.target?.initialUrl,
        targetTitle: p.context.targetTitle || s.target?.initialTitle,
        targetUrls: p.context.targetUrls ?? s.targets?.map((t) => t.url),
      },
      metricsSummary: {
        ...p.metricsSummary,
        eventsCount:
          p.metricsSummary?.eventsCount ?? s.quality?.interactionCount,
        requestsCount:
          p.metricsSummary?.requestsCount ?? s.quality?.networkEntryCount,
        consoleCount:
          p.metricsSummary?.consoleCount ?? s.quality?.consoleEntryCount,
        producedBytes: p.metricsSummary?.producedBytes ?? ov.sizeBytes,
      },
      qualitySummary: p.qualitySummary ?? s.quality,
      evidenceBreakdown: p.evidenceBreakdown ?? ov.evidence,
    });
  });

  return {
    ...data,
    recentProfiles: enrichedProfiles,
  };
}

/** 读取完整诊断数据 */
export async function getDiagnosticsData(): Promise<DiagnosticsData> {
  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    return {
      metrics: { ...DEFAULT_DIAGNOSTICS_DATA.metrics },
      recentProfiles: [],
      flightRecorderLogs: [],
    };
  }

  try {
    const res = await chrome.storage.local.get(DIAGNOSTICS_STORAGE_KEY);
    const data = res[DIAGNOSTICS_STORAGE_KEY] as
      Partial<DiagnosticsData> | undefined;
    if (!data || typeof data !== "object") {
      return {
        metrics: { ...DEFAULT_DIAGNOSTICS_DATA.metrics },
        recentProfiles: [],
        flightRecorderLogs: [],
      };
    }

    const recentProfiles = (
      Array.isArray(data.recentProfiles)
        ? data.recentProfiles.slice(-MAX_RECENT_PROFILES)
        : []
    ).map(normalizeProfileOnRead);

    const flightRecorderLogs = Array.isArray(data.flightRecorderLogs)
      ? data.flightRecorderLogs.slice(-MAX_FLIGHT_RECORDER_LOGS)
      : [];

    // 实时派生分位数统计
    const exportLatencies: number[] = [];
    const screenshotLatencies: number[] = [];
    for (const p of recentProfiles) {
      if (p.taskType === "recording") {
        const expMs = computeEffectivePipelineMs(p);
        if (expMs && expMs > 0) exportLatencies.push(expMs);
      } else if (p.taskType === "screenshot" && p.durationMs > 0) {
        screenshotLatencies.push(p.durationMs);
      }
    }

    return {
      metrics: {
        totalRecordings: Number(data.metrics?.totalRecordings) || 0,
        totalScreenshots: Number(data.metrics?.totalScreenshots) || 0,
        totalPromptCopies: Number(data.metrics?.totalPromptCopies) || 0,
        totalRecordingDurationMs:
          Number(data.metrics?.totalRecordingDurationMs) || 0,
        totalExportDurationMs: Number(data.metrics?.totalExportDurationMs) || 0,
        avgExportDurationMs: Number(data.metrics?.avgExportDurationMs) || 0,
        failedTasksCount: Number(data.metrics?.failedTasksCount) || 0,
        totalInternalErrors:
          Number(data.metrics?.totalInternalErrors) ||
          flightRecorderLogs.length,
        totalMicroOpsRecorded: Number(data.metrics?.totalMicroOpsRecorded) || 0,
        exportLatencyStats: computeLatencyPercentiles(exportLatencies),
        screenshotLatencyStats: computeLatencyPercentiles(screenshotLatencies),
      },
      recentProfiles,
      flightRecorderLogs,
    };
  } catch {
    return {
      metrics: { ...DEFAULT_DIAGNOSTICS_DATA.metrics },
      recentProfiles: [],
      flightRecorderLogs: [],
    };
  }
}

/** 写入并持久化诊断数据 */
export async function saveDiagnosticsData(
  data: DiagnosticsData
): Promise<void> {
  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    return;
  }
  await chrome.storage.local.set({
    [DIAGNOSTICS_STORAGE_KEY]: {
      metrics: data.metrics,
      recentProfiles: data.recentProfiles.slice(-MAX_RECENT_PROFILES),
      flightRecorderLogs: (data.flightRecorderLogs ?? []).slice(
        -MAX_FLIGHT_RECORDER_LOGS
      ),
    },
  });
}

/**
 * 记录跨进程内部告警或错误日志到黑匣子（Flight Recorder）
 */
export function recordFlightLog(
  entry: Omit<FlightRecorderLogEntry, "id" | "timestamp"> & {
    id?: string;
    timestamp?: number;
  }
): Promise<void> {
  return enqueueStorageMutation(async () => {
    const current = await getDiagnosticsData();
    const now = entry.timestamp ?? Date.now();
    const logItem: FlightRecorderLogEntry = {
      id: entry.id || `log_${now}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: now,
      level: entry.level,
      process: entry.process,
      sessionId: entry.sessionId,
      code: entry.code,
      message: redactCredentialsOnly(entry.message),
      stack: entry.stack ? redactCredentialsOnly(entry.stack) : undefined,
      extra: entry.extra,
    };

    const nextLogs = [...current.flightRecorderLogs, logItem];
    if (nextLogs.length > MAX_FLIGHT_RECORDER_LOGS) {
      nextLogs.splice(0, nextLogs.length - MAX_FLIGHT_RECORDER_LOGS);
    }

    current.metrics.totalInternalErrors =
      (current.metrics.totalInternalErrors ?? 0) + 1;
    current.flightRecorderLogs = nextLogs;
    await saveDiagnosticsData(current);
  });
}

let flightRecorderInstalled = false;

/**
 * 在当前扩展进程挂载全局未捕获异常与 Promise 拒绝黑匣子监听
 */
export function installProcessFlightRecorder(
  processName: FlightLogProcess,
  getSessionId?: () => string | undefined
): void {
  if (flightRecorderInstalled || typeof globalThis === "undefined") return;
  flightRecorderInstalled = true;

  try {
    if (typeof globalThis.addEventListener === "function") {
      globalThis.addEventListener("error", (event: any) => {
        const err = event?.error;
        const msg = err?.message || event?.message || "Uncaught Runtime Error";
        void recordFlightLog({
          level: "error",
          process: processName,
          sessionId: getSessionId?.(),
          code: "UNCAUGHT_ERROR",
          message: String(msg),
          stack: err?.stack,
          extra: {
            filename: event?.filename,
            lineno: event?.lineno,
            colno: event?.colno,
          },
        }).catch(() => undefined);
      });

      globalThis.addEventListener("unhandledrejection", (event: any) => {
        const reason = event?.reason;
        const msg =
          reason?.message || String(reason || "Unhandled Promise Rejection");
        void recordFlightLog({
          level: "error",
          process: processName,
          sessionId: getSessionId?.(),
          code: "UNHANDLED_REJECTION",
          message: msg,
          stack: reason?.stack,
        }).catch(() => undefined);
      });
    }
  } catch {
    // 忽略受限环境
  }
}

/** 记录或幂等合并一次任务全量黑匣子 Profile（带串行锁与非破坏性深度合并） */
export function recordTaskProfile(
  input: Omit<TaskProfile, "id" | "timestamp" | "context"> & {
    id?: string;
    timestamp?: number;
    context?: Partial<TaskProfileContext>;
  }
): Promise<DiagnosticsData> {
  return enqueueStorageMutation(async () => {
    const current = await getDiagnosticsData();
    const now = input.timestamp || Date.now();
    const id =
      input.id || `task_${now}_${Math.random().toString(36).slice(2, 7)}`;

    // 提取内存中归集的该会话微操作与切 Tab 计数
    const buffered = consumeSessionMicroOps(id);
    const mergedMicroOps = [
      ...(buffered.microOps ?? []),
      ...(input.microOps ?? []),
    ];

    // 错误信息：100% 保留真实 URL 与完整堆栈，仅过滤 Bearer 凭证字面量
    const rawError = input.error
      ? {
          code: input.error.code || "UNKNOWN_ERROR",
          message: redactCredentialsOnly(input.error.message),
          stack: input.error.stack
            ? redactCredentialsOnly(input.error.stack)
            : undefined,
        }
      : undefined;

    const existingIndex = current.recentProfiles.findIndex((p) => p.id === id);
    const existingProfile =
      existingIndex >= 0 ? current.recentProfiles[existingIndex] : undefined;

    const mergedBreakdown = mergeDefined(
      existingProfile?.breakdown,
      input.breakdown
    );

    const bottleneckStage =
      input.bottleneckStage ||
      detectBottleneckStage(input.taskType, mergedBreakdown) ||
      existingProfile?.bottleneckStage;

    const combinedMicroOps = [
      ...(existingProfile?.microOps ?? []),
      ...mergedMicroOps,
    ].slice(-MAX_MICRO_OPS_PER_TASK);

    const tabSwitchCount =
      input.context?.tabSwitchCount ??
      (existingProfile?.context?.tabSwitchCount || 0) + buffered.tabSwitchCount;

    const mergedContext = {
      ...getRuntimeContext(existingProfile?.context),
      ...(mergeDefined(existingProfile?.context, input.context) ?? {}),
      tabSwitchCount,
    };

    const effectiveDurationMs = Math.max(
      0,
      Math.round(
        (input.durationMs && input.durationMs > 0
          ? input.durationMs
          : existingProfile?.durationMs) || 0
      )
    );

    const candidateProfile: TaskProfile = {
      id,
      timestamp: existingProfile?.timestamp ?? now,
      taskType: input.taskType,
      status:
        input.status === "error" || existingProfile?.status === "error"
          ? "error"
          : input.status,
      durationMs: effectiveDurationMs,
      pipelineWallClockMs:
        input.pipelineWallClockMs ??
        input.exportDashboard?.totalWallClockMs ??
        existingProfile?.pipelineWallClockMs,
      bottleneckStage,
      context: mergedContext,
      breakdown: mergedBreakdown,
      metricsSummary: mergeDefined(
        existingProfile?.metricsSummary,
        input.metricsSummary
      ),
      qualitySummary: input.qualitySummary ?? existingProfile?.qualitySummary,
      evidenceBreakdown:
        input.evidenceBreakdown ?? existingProfile?.evidenceBreakdown,
      exportTrace: input.exportTrace ?? existingProfile?.exportTrace,
      exportDashboard:
        input.exportDashboard ?? existingProfile?.exportDashboard,
      screenshotDetail: mergeDefined(
        existingProfile?.screenshotDetail,
        input.screenshotDetail
      ),
      microOps: combinedMicroOps.length > 0 ? combinedMicroOps : undefined,
      memorySnapshot:
        input.memorySnapshot ??
        existingProfile?.memorySnapshot ??
        captureMemorySnapshot(),
      storageSnapshot:
        input.storageSnapshot ?? existingProfile?.storageSnapshot,
      error: rawError ?? existingProfile?.error,
    };

    const newProfile = normalizeProfileOnRead(candidateProfile);

    const nextMetrics: MacroMetrics = { ...current.metrics };

    if (!existingProfile) {
      if (input.taskType === "recording") {
        nextMetrics.totalRecordings += 1;
      } else if (input.taskType === "screenshot") {
        nextMetrics.totalScreenshots += 1;
      }
    }

    if (input.taskType === "recording" && effectiveDurationMs > 0) {
      const prevDuration = existingProfile?.durationMs || 0;
      nextMetrics.totalRecordingDurationMs += Math.max(
        0,
        effectiveDurationMs - prevDuration
      );
    }

    const exportDuration =
      (mergedBreakdown?.stage3_assemblyMs || 0) +
      (mergedBreakdown?.stage4_zipPackMs || 0) +
      (mergedBreakdown?.stage5_browserDownloadMs || 0);

    if (input.taskType === "recording" && exportDuration > 0) {
      const prevExportDuration =
        (existingProfile?.breakdown?.stage3_assemblyMs || 0) +
        (existingProfile?.breakdown?.stage4_zipPackMs || 0) +
        (existingProfile?.breakdown?.stage5_browserDownloadMs || 0);
      nextMetrics.totalExportDurationMs += Math.max(
        0,
        exportDuration - prevExportDuration
      );
      if (nextMetrics.totalRecordings > 0) {
        nextMetrics.avgExportDurationMs = Math.round(
          nextMetrics.totalExportDurationMs / nextMetrics.totalRecordings
        );
      }
    }

    if (input.status === "error" && existingProfile?.status !== "error") {
      nextMetrics.failedTasksCount += 1;
    }

    nextMetrics.totalMicroOpsRecorded =
      (nextMetrics.totalMicroOpsRecorded ?? 0) + mergedMicroOps.length;

    // 若任务失败或包含 CaptureIssue，同步追加到 Flight Recorder 日志以便集中检索
    let nextFlightLogs = [...current.flightRecorderLogs];
    if (rawError && existingProfile?.status !== "error") {
      nextFlightLogs.push({
        id: `log_err_${id}`,
        timestamp: now,
        level: "error",
        process: "background",
        sessionId: id,
        code: rawError.code,
        message: rawError.message,
        stack: rawError.stack,
      });
      nextMetrics.totalInternalErrors =
        (nextMetrics.totalInternalErrors ?? 0) + 1;
    }

    if (
      input.qualitySummary?.issues?.length &&
      !existingProfile?.qualitySummary
    ) {
      for (const iss of input.qualitySummary.issues) {
        nextFlightLogs.push({
          id: `log_issue_${id}_${iss.code}_${iss.occurredAt}`,
          timestamp: iss.occurredAt || now,
          level: iss.recoverable ? "warn" : "error",
          process: "background",
          sessionId: id,
          code: iss.code,
          message: `[${iss.source}] ${iss.message}`,
        });
      }
    }

    if (nextFlightLogs.length > MAX_FLIGHT_RECORDER_LOGS) {
      nextFlightLogs = nextFlightLogs.slice(-MAX_FLIGHT_RECORDER_LOGS);
    }

    let nextProfiles = [...current.recentProfiles];
    if (existingIndex >= 0) {
      nextProfiles[existingIndex] = newProfile;
    } else {
      nextProfiles.push(newProfile);
      if (nextProfiles.length > MAX_RECENT_PROFILES) {
        nextProfiles = nextProfiles.slice(-MAX_RECENT_PROFILES);
      }
    }

    const updatedData: DiagnosticsData = {
      metrics: nextMetrics,
      recentProfiles: nextProfiles,
      flightRecorderLogs: nextFlightLogs,
    };

    await saveDiagnosticsData(updatedData);
    return updatedData;
  });
}

/** 累加 Prompt 复制成功计数（带串行锁） */
export function incrementPromptCopyCount(): Promise<void> {
  return enqueueStorageMutation(async () => {
    const current = await getDiagnosticsData();
    current.metrics.totalPromptCopies += 1;
    await saveDiagnosticsData(current);
  });
}

/** 清空所有诊断数据与内存缓冲 */
export function clearDiagnosticsData(): Promise<void> {
  return enqueueStorageMutation(async () => {
    inMemoryMicroOpsBySession.clear();
    inMemoryTabSwitchCountBySession.clear();
    await saveDiagnosticsData({
      metrics: { ...DEFAULT_DIAGNOSTICS_DATA.metrics },
      recentProfiles: [],
      flightRecorderLogs: [],
    });
  });
}

/** 导出完整诊断报告 JSON（兼容旧调用） */
export async function exportSanitizedDiagnostics(): Promise<string> {
  const data = await getDiagnosticsData();
  const exported = {
    reportType: "Bug Lens Local Diagnostics Report",
    generatedAt: new Date().toISOString(),
    environment: getRuntimeContext(),
    memorySnapshot: captureMemorySnapshot(),
    metrics: data.metrics,
    recentProfiles: data.recentProfiles,
    flightRecorderLogs: data.flightRecorderLogs,
  };
  return JSON.stringify(exported, null, 2);
}
