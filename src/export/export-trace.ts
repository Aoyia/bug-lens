/**
 * 导出全链路算法级性能监控与时间账本模型。
 *
 * 跨越 Content Script、Background Service Worker 与 Offscreen Document，
 * 建立微秒级绝对时间戳跟踪、6 大阶段算法度量与未记账损耗数学闭环。
 */

/** 安全获取高精度时间基准原点 (Unix Epoch ms)，任何环境均不抛出异常 */
export function getPerformanceOrigin(): number {
  if (typeof performance !== "undefined") {
    if (Number.isFinite(performance.timeOrigin)) {
      return performance.timeOrigin;
    }
    if (typeof performance.now === "function") {
      return Date.now() - performance.now();
    }
  }
  return Date.now();
}

/** 获取基于 Unix 纪元的绝对高精度时间戳 (ms)，在支持的运行环境中具备亚毫秒精度 */
export function getEpochTimestampMs(): number {
  if (
    typeof performance !== "undefined" &&
    Number.isFinite(performance.timeOrigin) &&
    typeof performance.now === "function"
  ) {
    return performance.timeOrigin + performance.now();
  }
  return Date.now();
}

/** 阶段 1：触发与 IPC 分发指标 */
export type Stage1Metrics = {
  clickEpochMs: number;
  clickResponseDurationMs?: number;
  uiFreezeDurationMs: number;
  sendEpochMs: number;
  bgReceivedEpochMs?: number;
  ipcDispatchDurationMs?: number;
  totalDurationMs: number;
};

/** CDP 响应正文萃取算法级统计指标 */
export type CdpFinalizeStats = {
  totalRequests: number;
  successCount: number;
  failureCount: number;
  totalBodyBytes: number;
  avgDurationMs: number;
  durationMs: number;
  throughputMBps: number;
};

/** 阶段 2：采集器 Drain 与 CDP 萃取指标 */
export type Stage2Metrics = {
  mediaStopDurationMs: number;
  queueDrainDurationMs: number;
  cdpFinalizeStats: CdpFinalizeStats;
  issueSceneFinalizeDurationMs: number;
  qualityReconcileDurationMs: number;
  totalDurationMs: number;
};

/** 阶段 3：证据读取与结构化组装指标 */
export type Stage3Metrics = {
  dbQueryDurationMs: number;
  templateLoadDurationMs: number;
  assembleDurationMs: number;
  promptRenderDurationMs: number;
  promptCharCount: number;
  totalDurationMs: number;
};

/** 阶段 4：流式 ZIP 封包与哈希管线指标 */
export type Stage4Metrics = {
  hashDurationMs: number;
  hashThroughputMBps: number;
  staticFilesBytes: number;
  staticFilesCount: number;
  deflateAndPassDurationMs: number;
  mediaPackDurationMs: number;
  mediaBytes: number;
  mediaChunksCount: number;
  manifestDurationMs: number;
  manifestBytes: number;
  finalizeDurationMs: number;
  totalDurationMs: number;
  totalRawInputBytes: number;
  totalCompressedBytes: number;
  compressionRatio: number; // e.g. 0.42 (42%)
  overallThroughputMBps: number;
};

/** 阶段 5：浏览器内核下载与 OS 落盘指标 */
export type Stage5Metrics = {
  downloadCallDurationMs: number;
  pollWaitDurationMs: number;
  pollCount: number;
  avgPollIntervalMs: number;
  pathResolveDurationMs: number;
  resolvedFilename?: string;
  totalDurationMs: number;
};

/** 阶段 6：终端反馈指标 */
export type Stage6Metrics = {
  clipboardWriteDurationMs: number;
  toastDurationMs?: number;
  teardownDurationMs?: number;
  toastAndTeardownDurationMs: number;
  totalDurationMs: number;
};

/** 时间账本阶段条目 */
export type StageLedgerItem = {
  stageNumber: number;
  name: string;
  durationMs: number;
  percentage: number;
  metricsSummary: string;
  note: string;
};

/** 时间账本：闭环呈现各阶段耗时与未记账损耗 */
export type ExportTimeLedger = {
  t0EpochMs: number;
  tnEpochMs: number;
  totalWallClockMs: number;
  accountedSumMs: number;
  unaccountedOverheadMs: number;
  overheadPercentage: number;
  stageItems: StageLedgerItem[];
};

/** 核心算法与 I/O 效率看板指标 */
export type AlgorithmEfficiencyMetric = {
  dimension: string;
  value: string;
  details: string;
};

/** 瀑布流子任务条目 */
export type SubStepWaterfallItem = {
  step: string;
  stageName: string;
  durationMs: number;
  sizeOrVolume: string;
  statusOrNote: string;
};

/** 导出流水线完整监控大盘 */
export type ExportPipelineDashboard = {
  title: string;
  traceId: string;
  totalWallClockMs: number;
  ledger: ExportTimeLedger;
  efficiencyMetrics: AlgorithmEfficiencyMetric[];
  waterfall: SubStepWaterfallItem[];
  extraContext?: Record<string, unknown>;
};

/** 全链路 Trace 上下文数据载体 */
export type ExportTraceContext = {
  traceId: string;
  t0EpochMs: number;
  stage1?: Stage1Metrics;
  stage2?: Stage2Metrics;
  stage3?: Stage3Metrics;
  stage4?: Stage4Metrics;
  stage5?: Stage5Metrics;
  stage6?: Stage6Metrics;
  dashboard?: ExportPipelineDashboard;
};

/** 安全提取有限数值，非有限数返回 fallback */
export function safeNum(val: unknown, fallback = 0): number {
  return typeof val === "number" && Number.isFinite(val) ? val : fallback;
}

/** 安全提取非负耗时 (ms)，NaN / 负数 / 无效值强制归零 */
export function safeDuration(val: unknown): number {
  return Math.max(0, safeNum(val, 0));
}

/**
 * 创建导出 TraceContext。
 * @param t0EpochMs 悬浮窗点击时刻的绝对时间戳
 */
export function createExportTraceContext(
  t0EpochMs?: number,
  traceId?: string
): ExportTraceContext {
  let t0: number;
  if (
    typeof t0EpochMs === "number" &&
    Number.isFinite(t0EpochMs) &&
    t0EpochMs > 0
  ) {
    t0 = t0EpochMs;
  } else {
    t0 = getEpochTimestampMs();
  }
  return {
    traceId:
      traceId ??
      (typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `trace-${Date.now()}`),
    t0EpochMs: t0,
  };
}

/**
 * 构建时间账本，显式计算记账和与未记账损耗，实现数学闭环。
 */
export function buildExportTimeLedger(
  t0EpochMs: number,
  tnEpochMs: number,
  stages?: {
    stage1?: Partial<Stage1Metrics>;
    stage2?: Partial<Stage2Metrics>;
    stage3?: Partial<Stage3Metrics>;
    stage4?: Partial<Stage4Metrics>;
    stage5?: Partial<Stage5Metrics>;
    stage6?: Partial<Stage6Metrics>;
  }
): ExportTimeLedger {
  const safeStages = stages ?? {};
  const d1 = safeDuration(safeStages.stage1?.totalDurationMs);
  const d2 = safeDuration(safeStages.stage2?.totalDurationMs);
  const d3 = safeDuration(safeStages.stage3?.totalDurationMs);
  const d4 = safeDuration(safeStages.stage4?.totalDurationMs);
  const d5 = safeDuration(safeStages.stage5?.totalDurationMs);
  const d6 = safeDuration(safeStages.stage6?.totalDurationMs);
  const accountedSumMs = d1 + d2 + d3 + d4 + d5 + d6;

  let validT0 = safeNum(t0EpochMs, 0);
  let validTn = safeNum(tnEpochMs, 0);
  if (validTn <= 0) {
    validTn = getEpochTimestampMs();
  }

  // 缺失/非正 T0 兜底：对齐为 validTn - accountedSumMs，杜绝 56 年虚假损耗
  if (validT0 <= 0) {
    validT0 = validTn - accountedSumMs;
  } else if (validT0 < 1e11 && validTn < 1e11) {
    // 双方均为相对单调时钟：统一换算为 Unix 纪元基准
    const origin = getPerformanceOrigin();
    validT0 = origin + validT0;
    validTn = origin + validTn;
  } else if (validT0 < 1e11 && validTn >= 1e11) {
    // 跨时钟域混用防御：t0 为相对单调时钟，tn 为 Unix 纪元时钟
    validT0 = getPerformanceOrigin() + validT0;
  } else if (validTn < 1e11 && validT0 >= 1e11) {
    // 跨时钟域混用防御：tn 为相对单调时钟，t0 为 Unix 纪元时钟
    validTn = getPerformanceOrigin() + validTn;
  }

  let rawTotal = validTn - validT0;

  if (!Number.isFinite(rawTotal) || rawTotal < accountedSumMs) {
    rawTotal = accountedSumMs;
  }
  const totalWallClockMs = Math.max(
    rawTotal,
    accountedSumMs > 0 ? accountedSumMs : 0
  );
  const unaccountedOverheadMs = Math.max(0, totalWallClockMs - accountedSumMs);
  const overheadPercentage =
    totalWallClockMs > 0 ? (unaccountedOverheadMs / totalWallClockMs) * 100 : 0;

  const calcPct = (d: number) =>
    totalWallClockMs > 0 ? (d / totalWallClockMs) * 100 : 0;

  const stageItems: StageLedgerItem[] = [
    {
      stageNumber: 1,
      name: "1. 触发与 IPC 分发",
      durationMs: d1,
      percentage: calcPct(d1),
      metricsSummary:
        safeStages.stage1?.clickResponseDurationMs !== undefined
          ? `点击响应: ${safeDuration(safeStages.stage1.clickResponseDurationMs).toFixed(2)} ms, UI 冻结: ${safeDuration(safeStages.stage1.uiFreezeDurationMs).toFixed(2)} ms, IPC: ${safeDuration(safeStages.stage1.ipcDispatchDurationMs).toFixed(2)} ms`
          : `UI 冻结: ${safeDuration(safeStages.stage1?.uiFreezeDurationMs).toFixed(2)} ms, IPC: ${safeDuration(safeStages.stage1?.ipcDispatchDurationMs).toFixed(2)} ms`,
      note: "悬浮挂件点击响应、状态锁定与向 Background 发送消息",
    },
    {
      stageNumber: 2,
      name: "2. 采集器 Drain 与 CDP 萃取",
      durationMs: d2,
      percentage: calcPct(d2),
      metricsSummary: `CDP 正文: ${safeNum(safeStages.stage2?.cdpFinalizeStats?.totalRequests)} 个 (成功 ${safeNum(safeStages.stage2?.cdpFinalizeStats?.successCount)}, 吞吐 ${safeNum(safeStages.stage2?.cdpFinalizeStats?.throughputMBps).toFixed(2)} MB/s)`,
      note: "MediaRecorder 末片排空 / 队列排空 / CDP 响应正文萃取 / 质量重算",
    },
    {
      stageNumber: 3,
      name: "3. 证据读取与结构化组装",
      durationMs: d3,
      percentage: calcPct(d3),
      metricsSummary: `DB 加载: ${safeDuration(safeStages.stage3?.dbQueryDurationMs).toFixed(2)} ms, Prompt: ${safeNum(safeStages.stage3?.promptCharCount)} 字符`,
      note: "IndexedDB 批量查询 / 离线报告模版读取 / 离线包组装 / Prompt 渲染",
    },
    {
      stageNumber: 4,
      name: "4. 流式 ZIP 封包与哈希管线",
      durationMs: d4,
      percentage: calcPct(d4),
      metricsSummary: `封包吞吐: ${safeNum(safeStages.stage4?.overallThroughputMBps).toFixed(2)} MB/s, 压缩比: ${(safeNum(safeStages.stage4?.compressionRatio, 1) * 100).toFixed(1)}%`,
      note: "SHA-256 并行计算 / Deflate 压缩与 PassThrough / 视频流式增量哈希 / 清单追加",
    },
    {
      stageNumber: 5,
      name: "5. 浏览器内核下载与 OS 落盘",
      durationMs: d5,
      percentage: calcPct(d5),
      metricsSummary: `轮询: ${safeNum(safeStages.stage5?.pollCount)} 次 (均周 ${safeNum(safeStages.stage5?.avgPollIntervalMs).toFixed(1)} ms), 路径解析: ${safeDuration(safeStages.stage5?.pathResolveDurationMs).toFixed(2)} ms`,
      note: "chrome.downloads API 调用 / 轮询等待 OS 写入 / 绝对路径探测",
    },
    {
      stageNumber: 6,
      name: "6. 终端反馈",
      durationMs: d6,
      percentage: calcPct(d6),
      metricsSummary:
        safeStages.stage6?.toastDurationMs !== undefined
          ? `剪贴板写入: ${safeDuration(safeStages.stage6.clipboardWriteDurationMs).toFixed(2)} ms, Toast: ${safeDuration(safeStages.stage6.toastDurationMs).toFixed(2)} ms, 卸载: ${safeDuration(safeStages.stage6.teardownDurationMs).toFixed(2)} ms`
          : `剪贴板写入: ${safeDuration(safeStages.stage6?.clipboardWriteDurationMs).toFixed(2)} ms, Toast与卸载: ${safeDuration(safeStages.stage6?.toastAndTeardownDurationMs).toFixed(2)} ms`,
      note: "AI 提示词写入剪贴板 / 挂件 Toast 反馈 / 悬浮挂件平滑卸载",
    },
  ];

  return {
    t0EpochMs: validT0,
    tnEpochMs: validTn,
    totalWallClockMs,
    accountedSumMs,
    unaccountedOverheadMs,
    overheadPercentage,
    stageItems,
  };
}

/**
 * 组装导出全流程大盘数据结构。
 */
export function buildExportPipelineDashboard(
  traceContext?: ExportTraceContext,
  tnEpochMs?: number,
  extraContext?: Record<string, unknown>
): ExportPipelineDashboard {
  const safeContext: ExportTraceContext =
    traceContext ?? createExportTraceContext();
  if (!safeContext.traceId) {
    safeContext.traceId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `trace-${Date.now()}`;
  }
  if (!Number.isFinite(safeContext.t0EpochMs) || safeContext.t0EpochMs <= 0) {
    safeContext.t0EpochMs = getEpochTimestampMs();
  }
  const tn =
    typeof tnEpochMs === "number" && Number.isFinite(tnEpochMs) && tnEpochMs > 0
      ? tnEpochMs
      : getEpochTimestampMs();
  const ledger = buildExportTimeLedger(safeContext.t0EpochMs, tn, safeContext);
  const s1 = safeContext.stage1;
  const s2 = safeContext.stage2;
  const s3 = safeContext.stage3;
  const s4 = safeContext.stage4;
  const s5 = safeContext.stage5;
  const s6 = safeContext.stage6;

  const efficiencyMetrics: AlgorithmEfficiencyMetric[] = [
    {
      dimension: "ZIP 整体封包吞吐速率",
      value:
        s4?.overallThroughputMBps !== undefined
          ? `${safeNum(s4.overallThroughputMBps).toFixed(2)} MB/s`
          : "-",
      details: s4
        ? `封包总输入: ${(safeNum(s4.totalRawInputBytes) / (1024 * 1024)).toFixed(2)} MB, 总耗时: ${safeDuration(s4.totalDurationMs).toFixed(2)} ms`
        : "-",
    },
    {
      dimension: "ZIP 体积压缩比",
      value:
        s4?.compressionRatio !== undefined
          ? `${(safeNum(s4.compressionRatio) * 100).toFixed(1)}%`
          : "-",
      details: s4
        ? `未压缩: ${(safeNum(s4.totalRawInputBytes) / (1024 * 1024)).toFixed(2)} MB -> 压缩产物: ${(safeNum(s4.totalCompressedBytes) / (1024 * 1024)).toFixed(2)} MB`
        : "-",
    },
    {
      dimension: "静态文件 SHA-256 并行计算",
      value:
        s4?.hashThroughputMBps !== undefined
          ? `${safeNum(s4.hashThroughputMBps).toFixed(2)} MB/s`
          : "-",
      details: s4
        ? `${safeNum(s4.staticFilesCount)} 个文件, ${(safeNum(s4.staticFilesBytes) / (1024 * 1024)).toFixed(2)} MB, 耗时: ${safeDuration(s4.hashDurationMs).toFixed(2)} ms`
        : "-",
    },
    {
      dimension: "视频流式增量封包",
      value:
        s4?.mediaChunksCount !== undefined
          ? `${safeNum(s4.mediaChunksCount)} 个分片`
          : "-",
      details: s4
        ? `媒体总体积: ${(safeNum(s4.mediaBytes) / (1024 * 1024)).toFixed(2)} MB, 耗时: ${safeDuration(s4.mediaPackDurationMs).toFixed(2)} ms`
        : "-",
    },
    {
      dimension: "CDP 网络正文拉取吞吐与效率",
      value:
        s2?.cdpFinalizeStats?.throughputMBps !== undefined
          ? `${safeNum(s2.cdpFinalizeStats.throughputMBps).toFixed(2)} MB/s`
          : "-",
      details: s2?.cdpFinalizeStats
        ? `总请求: ${safeNum(s2.cdpFinalizeStats.totalRequests)}, 正文: ${(safeNum(s2.cdpFinalizeStats.totalBodyBytes) / 1024).toFixed(1)} KB, 均耗时: ${safeDuration(s2.cdpFinalizeStats.avgDurationMs).toFixed(2)} ms/req`
        : "-",
    },
    {
      dimension: "CDP 正文拉取成功率",
      value:
        s2?.cdpFinalizeStats && s2.cdpFinalizeStats.totalRequests > 0
          ? `${((safeNum(s2.cdpFinalizeStats.successCount) / s2.cdpFinalizeStats.totalRequests) * 100).toFixed(1)}%`
          : s2?.cdpFinalizeStats?.totalRequests === 0
            ? "100.0% (无在途)"
            : "-",
      details: s2?.cdpFinalizeStats
        ? `成功: ${safeNum(s2.cdpFinalizeStats.successCount)}, 失败: ${safeNum(s2.cdpFinalizeStats.failureCount)}`
        : "-",
    },
    {
      dimension: "OS 文件落盘轮询等待开销",
      value:
        s5?.pollWaitDurationMs !== undefined
          ? `${safeDuration(s5.pollWaitDurationMs).toFixed(2)} ms`
          : "-",
      details: s5
        ? `轮询次数: ${safeNum(s5.pollCount)} 次, 平均周期: ${safeNum(s5.avgPollIntervalMs).toFixed(1)} ms`
        : "-",
    },
    {
      dimension: "AI Prompt 提示词渲染效率",
      value:
        s3?.promptRenderDurationMs !== undefined
          ? `${safeDuration(s3.promptRenderDurationMs).toFixed(2)} ms`
          : "-",
      details: s3 ? `生成提示词规模: ${safeNum(s3.promptCharCount)} 字符` : "-",
    },
  ];

  const waterfall: SubStepWaterfallItem[] = [];
  if (s1) {
    if (s1.clickResponseDurationMs !== undefined) {
      waterfall.push({
        step: "1.1 Content 点击响应与事件调度",
        stageName: "阶段一: 触发与 IPC 分发",
        durationMs: safeDuration(s1.clickResponseDurationMs),
        sizeOrVolume: "-",
        statusOrNote: "悬浮挂件点击事件捕获并进入调度",
      });
      waterfall.push({
        step: "1.2 挂件 UI 状态冻结与监视器停止",
        stageName: "阶段一: 触发与 IPC 分发",
        durationMs: safeDuration(s1.uiFreezeDurationMs),
        sizeOrVolume: "-",
        statusOrNote: "锁定交互并停止无操作超时监测",
      });
      waterfall.push({
        step: "1.3 向 Background 消息 IPC 分发",
        stageName: "阶段一: 触发与 IPC 分发",
        durationMs: safeDuration(s1.ipcDispatchDurationMs),
        sizeOrVolume: "-",
        statusOrNote: "Content Script -> Background Service Worker 进程间传输",
      });
    } else {
      waterfall.push({
        step: "1.1 Content 响应与 UI 冻结",
        stageName: "阶段一: 触发与 IPC 分发",
        durationMs: safeDuration(s1.uiFreezeDurationMs),
        sizeOrVolume: "-",
        statusOrNote: "点击事件捕获并锁定挂件交互",
      });
      waterfall.push({
        step: "1.2 向 Background 消息 IPC 分发",
        stageName: "阶段一: 触发与 IPC 分发",
        durationMs: safeDuration(s1.ipcDispatchDurationMs),
        sizeOrVolume: "-",
        statusOrNote: "Content Script -> Background Service Worker 进程间传输",
      });
    }
  }
  if (s2) {
    waterfall.push({
      step: "2.1 MediaRecorder 停止与分片排空",
      stageName: "阶段二: 采集器 Drain 与 CDP 萃取",
      durationMs: safeDuration(s2.mediaStopDurationMs),
      sizeOrVolume: "-",
      statusOrNote: "等待录制器触发 stop 并写入末片",
    });
    waterfall.push({
      step: "2.2 交互与问题现场队列排空",
      stageName: "阶段二: 采集器 Drain 与 CDP 萃取",
      durationMs: safeDuration(s2.queueDrainDurationMs),
      sizeOrVolume: "-",
      statusOrNote: "排空在途交互事件、截图与 IndexedDB 批处理队列",
    });
    waterfall.push({
      step: "2.3 CDP 网络正文拉取与萃取",
      stageName: "阶段二: 采集器 Drain 与 CDP 萃取",
      durationMs: safeDuration(s2.cdpFinalizeStats?.durationMs),
      sizeOrVolume: `${(safeNum(s2.cdpFinalizeStats?.totalBodyBytes) / 1024).toFixed(1)} KB`,
      statusOrNote: `拉取 ${safeNum(s2.cdpFinalizeStats?.totalRequests)} 个请求正文`,
    });
    if (
      s2.issueSceneFinalizeDurationMs !== undefined &&
      s2.issueSceneFinalizeDurationMs > 0
    ) {
      waterfall.push({
        step: "2.4 未完成问题现场结构化收尾",
        stageName: "阶段二: 采集器 Drain 与 CDP 萃取",
        durationMs: safeDuration(s2.issueSceneFinalizeDurationMs),
        sizeOrVolume: "-",
        statusOrNote: "未完成问题现场数据补齐与序列化",
      });
    }
    waterfall.push({
      step: "2.5 质量快照与指标重算",
      stageName: "阶段二: 采集器 Drain 与 CDP 萃取",
      durationMs: safeDuration(s2.qualityReconcileDurationMs),
      sizeOrVolume: "-",
      statusOrNote: "重新核算四类证据指标与质量评级",
    });
  }
  if (s3) {
    waterfall.push({
      step: "3.1 IndexedDB 批量查询加载",
      stageName: "阶段三: 证据读取与结构化组装",
      durationMs: safeDuration(s3.dbQueryDurationMs),
      sizeOrVolume: "-",
      statusOrNote: "PreviewSessionRuntime 加载会话、事件与资源索引",
    });
    waterfall.push({
      step: "3.2 离线报告模版资源读取",
      stageName: "阶段三: 证据读取与结构化组装",
      durationMs: safeDuration(s3.templateLoadDurationMs),
      sizeOrVolume: "-",
      statusOrNote: "读取静态 HTML/CSS/JS 报告模版",
    });
    waterfall.push({
      step: "3.3 离线证据包 HTML/JSON 组装",
      stageName: "阶段三: 证据读取与结构化组装",
      durationMs: safeDuration(s3.assembleDurationMs),
      sizeOrVolume: "-",
      statusOrNote: "组装证据文件清单与离线 HTML 数据注入",
    });
    waterfall.push({
      step: "3.4 AI Prompt 提示词生成",
      stageName: "阶段三: 证据读取与结构化组装",
      durationMs: safeDuration(s3.promptRenderDurationMs),
      sizeOrVolume: `${safeNum(s3.promptCharCount)} 字符`,
      statusOrNote: "生成供 LLM 分析的结构化诊断提示词",
    });
  }
  if (s4) {
    waterfall.push({
      step: "4.1 静态与证据文件 SHA-256 并行计算",
      stageName: "阶段四: 流式 ZIP 封包与哈希管线",
      durationMs: safeDuration(s4.hashDurationMs),
      sizeOrVolume: `${(safeNum(s4.staticFilesBytes) / (1024 * 1024)).toFixed(2)} MB`,
      statusOrNote: `${safeNum(s4.staticFilesCount)} 个文件并行哈希 (吞吐 ${safeNum(s4.hashThroughputMBps).toFixed(2)} MB/s)`,
    });
    waterfall.push({
      step: "4.2 文本快速 Deflate 与媒体 PassThrough",
      stageName: "阶段四: 流式 ZIP 封包与哈希管线",
      durationMs: safeDuration(s4.deflateAndPassDurationMs),
      sizeOrVolume: "-",
      statusOrNote: "文本快速 Deflate (level 1) / 媒体零压缩写入",
    });
    waterfall.push({
      step: "4.3 视频分片流式封包与增量哈希",
      stageName: "阶段四: 流式 ZIP 封包与哈希管线",
      durationMs: safeDuration(s4.mediaPackDurationMs),
      sizeOrVolume: `${(safeNum(s4.mediaBytes) / (1024 * 1024)).toFixed(2)} MB`,
      statusOrNote: `${safeNum(s4.mediaChunksCount)} 个视频分片边读边封包边计算 SHA-256`,
    });
    waterfall.push({
      step: "4.4 Manifest 完整性清单生成追加",
      stageName: "阶段四: 流式 ZIP 封包与哈希管线",
      durationMs: safeDuration(s4.manifestDurationMs),
      sizeOrVolume: `${safeNum(s4.manifestBytes)} B`,
      statusOrNote: "生成 manifest.json 指纹清单并追加至压缩流",
    });
    waterfall.push({
      step: "4.5 ZIP 压缩流收尾与 Sink 写入",
      stageName: "阶段四: 流式 ZIP 封包与哈希管线",
      durationMs: safeDuration(s4.finalizeDurationMs),
      sizeOrVolume: `${(safeNum(s4.totalCompressedBytes) / (1024 * 1024)).toFixed(2)} MB`,
      statusOrNote: "排空背压队列并通知 Sink 完成写入",
    });
  }
  if (s5) {
    waterfall.push({
      step: "5.1 chrome.downloads API 调用",
      stageName: "阶段五: 浏览器内核下载与 OS 落盘",
      durationMs: safeDuration(s5.downloadCallDurationMs),
      sizeOrVolume: "-",
      statusOrNote: "触发浏览器内核原生下载任务",
    });
    waterfall.push({
      step: "5.2 轮询等待 OS 文件写入落盘",
      stageName: "阶段五: 浏览器内核下载与 OS 落盘",
      durationMs: safeDuration(s5.pollWaitDurationMs),
      sizeOrVolume: `${safeNum(s5.pollCount)} 次轮询`,
      statusOrNote: `平均轮询周期: ${safeNum(s5.avgPollIntervalMs).toFixed(1)} ms`,
    });
    waterfall.push({
      step: "5.3 物理绝对文件路径解析",
      stageName: "阶段五: 浏览器内核下载与 OS 落盘",
      durationMs: safeDuration(s5.pathResolveDurationMs),
      sizeOrVolume: "-",
      statusOrNote: `解析物理路径: ${s5.resolvedFilename ?? "-"}`,
    });
  }
  if (s6) {
    waterfall.push({
      step: "6.1 系统剪贴板 AI Prompt 写入",
      stageName: "阶段六: 终端反馈",
      durationMs: safeDuration(s6.clipboardWriteDurationMs),
      sizeOrVolume: "-",
      statusOrNote: "将诊断提示词安全写入系统剪贴板",
    });
    waterfall.push({
      step: "6.2 挂件 Toast 呈现与平滑卸载",
      stageName: "阶段六: 终端反馈",
      durationMs: safeDuration(s6.toastAndTeardownDurationMs),
      sizeOrVolume: "-",
      statusOrNote:
        s6.toastDurationMs !== undefined
          ? `Toast 呈现 ${safeDuration(s6.toastDurationMs).toFixed(2)} ms, 卸载销毁 ${safeDuration(s6.teardownDurationMs).toFixed(2)} ms`
          : "呈现成功状态 Toast 并过渡销毁 DOM 节点",
    });
  }
  if (ledger.unaccountedOverheadMs > 0) {
    waterfall.push({
      step: "7.0 未记账系统与调度损耗",
      stageName: "时间账本: 系统开销",
      durationMs: ledger.unaccountedOverheadMs,
      sizeOrVolume: "-",
      statusOrNote: "跨进程通信传输延迟、事件循环排队与系统线程调度",
    });
  }

  const dashboardResult: ExportPipelineDashboard = {
    title: "导出全流程性能大盘与算法效率指标",
    traceId: safeContext.traceId,
    totalWallClockMs: ledger.totalWallClockMs,
    ledger,
    efficiencyMetrics,
    waterfall,
    extraContext,
  };

  safeContext.dashboard = dashboardResult;
  return dashboardResult;
}
