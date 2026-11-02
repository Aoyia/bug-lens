/**
 * 全量黑匣子诊断包（分层结构化 ZIP）构建器与 AI 引导指令生成器
 *
 * 将本地收集的宏观指标、200 条全量任务黑匣子（含 6 阶段时间账本、瀑布流、微操作时间线）
 * 与 1000 条跨进程内部运行日志打包为分层 ZIP 归档，并生成指向固定临时工作区的 AI 诊断 Prompt。
 */

import { strToU8, zipSync } from "fflate";
import {
  captureMemorySnapshot,
  computeEffectivePipelineMs,
  getRuntimeContext,
  type DiagnosticsData,
  type MicroOpRecord,
  type TaskProfile,
} from "./diagnostics-store";
import type { SessionOverview, StorageOverview } from "../shared/protocol";

export interface DiagnosticsZipBuildResult {
  filename: string;
  bytes: Uint8Array;
  blob: Blob;
  summaryMarkdown: string;
}

function safeFileId(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function formatIso(epochMs: number): string {
  try {
    return new Date(epochMs).toISOString();
  } catch {
    return String(epochMs);
  }
}

/** 聚合所有任务中的录制期微操作统计，帮助快速发现高频 I/O 或截图通道退化 */
export function aggregateMicroOpsSummary(profiles: TaskProfile[]) {
  const byCategory: Record<
    string,
    {
      totalCount: number;
      okCount: number;
      degradedCount: number;
      errorCount: number;
      totalDurationMs: number;
      maxDurationMs: number;
      avgDurationMs: number;
    }
  > = {};

  for (const p of profiles) {
    if (!p.microOps) continue;
    for (const op of p.microOps) {
      const cat = `${op.category}:${op.name}`;
      if (!byCategory[cat]) {
        byCategory[cat] = {
          totalCount: 0,
          okCount: 0,
          degradedCount: 0,
          errorCount: 0,
          totalDurationMs: 0,
          maxDurationMs: 0,
          avgDurationMs: 0,
        };
      }
      const bucket = byCategory[cat];
      bucket.totalCount += 1;
      if (op.status === "ok") bucket.okCount += 1;
      else if (op.status === "degraded") bucket.degradedCount += 1;
      else bucket.errorCount += 1;
      bucket.totalDurationMs += op.durationMs;
      if (op.durationMs > bucket.maxDurationMs) {
        bucket.maxDurationMs = op.durationMs;
      }
    }
  }

  for (const key of Object.keys(byCategory)) {
    const b = byCategory[key];
    b.avgDurationMs =
      b.totalCount > 0
        ? Math.round((b.totalDurationMs / b.totalCount) * 100) / 100
        : 0;
    b.totalDurationMs = Math.round(b.totalDurationMs * 100) / 100;
    b.maxDurationMs = Math.round(b.maxDurationMs * 100) / 100;
  }

  return byCategory;
}

/** 构建全局 SUMMARY.md（AI 首读入口） */
export function buildDiagnosticsSummaryMarkdown(
  data: DiagnosticsData,
  storageOverview?: StorageOverview
): string {
  const env = getRuntimeContext();
  const mem = captureMemorySnapshot();
  const m = data.metrics;
  const expStats = m.exportLatencyStats;
  const shotStats = m.screenshotLatencyStats;
  const microSummary = aggregateMicroOpsSummary(data.recentProfiles);

  // 选出最慢 Top 10 任务（按导出墙钟耗时或任务耗时排序）
  const rankedBySlowest = [...data.recentProfiles]
    .map((p) => ({
      profile: p,
      effectiveMs: computeEffectivePipelineMs(p) ?? p.durationMs,
    }))
    .sort((a, b) => b.effectiveMs - a.effectiveMs)
    .slice(0, 10);

  // 选出异常或降级任务
  const abnormalProfiles = [...data.recentProfiles]
    .filter(
      (p) =>
        p.status === "error" ||
        (p.qualitySummary && p.qualitySummary.overall !== "complete") ||
        (p.qualitySummary?.issues && p.qualitySummary.issues.length > 0)
    )
    .reverse()
    .slice(0, 20);

  const lines: string[] = [
    "# Bug Lens 全量黑匣子诊断总览 (SUMMARY)",
    "",
    `- **生成时间**: \`${new Date().toISOString()}\``,
    `- **扩展版本**: \`v${env.extensionVersion}\``,
    `- **操作系统与平台**: \`${env.platform}\``,
    `- **User Agent**: \`${env.userAgent ?? "unknown"}\``,
    mem
      ? `- **当前 JS 堆内存水位**: 已用 \`${(mem.usedJSHeapBytes / 1024 / 1024).toFixed(2)} MB\` / 总分配 \`${(mem.totalJSHeapBytes / 1024 / 1024).toFixed(2)} MB\` (上限 \`${(mem.jsHeapLimitBytes / 1024 / 1024).toFixed(0)} MB\`)`
      : "",
    storageOverview
      ? `- **IndexedDB 存储水位**: 已用 \`${(storageOverview.usedBytes / 1024 / 1024).toFixed(2)} MB\` / 配额 \`${(storageOverview.quotaBytes / 1024 / 1024).toFixed(0)} MB\` (活跃/历史会话数: \`${storageOverview.sessionCount}\`)`
      : "",
    "",
    "---",
    "",
    "## 1. 宏观用量与全链路性能分位数基线",
    "",
    "| 指标维度 | 数值 / 状态 |",
    "| :--- | :--- |",
    `| 累计录制次数 | \`${m.totalRecordings}\` 次 (累计录制时长 \`${(m.totalRecordingDurationMs / 1000).toFixed(1)} s\`) |`,
    `| 累计智能截图次数 | \`${m.totalScreenshots}\` 次 |`,
    `| AI Prompt 复制总次数 | \`${m.totalPromptCopies}\` 次 |`,
    `| 失败任务总数 | \`${m.failedTasksCount}\` 次 |`,
    `| 内部告警与异常日志数 | \`${data.flightRecorderLogs.length}\` 条 (累计触发 \`${m.totalInternalErrors ?? data.flightRecorderLogs.length}\` 次) |`,
    `| 录制导出耗时分位数 (Stage1~6) | Avg: \`${expStats?.avgMs ?? m.avgExportDurationMs} ms\` / P50: \`${expStats?.p50Ms ?? 0} ms\` / **P95: \`${expStats?.p95Ms ?? 0} ms\`** / **Max: \`${expStats?.maxMs ?? 0} ms\`** (样本数: ${expStats?.count ?? 0}) |`,
    `| 智能截图耗时分位数 (端到端) | Avg: \`${shotStats?.avgMs ?? 0} ms\` / P50: \`${shotStats?.p50Ms ?? 0} ms\` / **P95: \`${shotStats?.p95Ms ?? 0} ms\`** / **Max: \`${shotStats?.maxMs ?? 0} ms\`** (样本数: ${shotStats?.count ?? 0}) |`,
    "",
    "---",
    "",
    "## 2. 最慢任务 Top 10 排行榜 (按处理/导出总耗时降序)",
    "",
  ];

  if (rankedBySlowest.length === 0) {
    lines.push("暂无任务记录。", "");
  } else {
    lines.push(
      "| 排名 | 任务 ID | 类型 | 状态 | 流水线耗时 | 录制时长 | 最大瓶颈阶段 | 页面 URL | 详情黑匣子路径 |",
      "| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |"
    );
    rankedBySlowest.forEach(({ profile: p, effectiveMs }, idx) => {
      const fileRef = `profiles/tasks/${safeFileId(p.id)}.json`;
      lines.push(
        `| #${idx + 1} | \`${p.id}\` | ${p.taskType} | ${p.status} | **${Math.round(effectiveMs)} ms** | ${p.durationMs} ms | ${p.bottleneckStage ?? "-"} | \`${p.context.targetUrl ?? "-"}\` | \`${fileRef}\` |`
      );
    });
    lines.push("");
  }

  lines.push(
    "---",
    "",
    "## 3. 录制期高频微操作聚合统计 (Micro-Operations)",
    ""
  );
  const microKeys = Object.keys(microSummary);
  if (microKeys.length === 0) {
    lines.push("暂无微操作明细记录。", "");
  } else {
    lines.push(
      "| 微操作类别与名称 | 总调用次数 | 正常(ok) | 降级(degraded) | 失败(error) | 平均耗时 | 最大峰值耗时 |",
      "| :--- | :--- | :--- | :--- | :--- | :--- | :--- |"
    );
    for (const k of microKeys) {
      const b = microSummary[k];
      lines.push(
        `| \`${k}\` | ${b.totalCount} | ${b.okCount} | ${b.degradedCount} | ${b.errorCount} | ${b.avgDurationMs} ms | **${b.maxDurationMs} ms** |`
      );
    }
    lines.push("");
  }

  lines.push(
    "---",
    "",
    "## 4. 异常与质量降级任务汇总 (Failed & Degraded Tasks)",
    ""
  );
  if (abnormalProfiles.length === 0) {
    lines.push("所有已记录任务均健康完成，无失败或降级告警。", "");
  } else {
    for (const p of abnormalProfiles) {
      const fileRef = `profiles/tasks/${safeFileId(p.id)}.json`;
      lines.push(
        `### 任务 \`${p.id}\` (${p.taskType} | ${formatIso(p.timestamp)} | 状态: \`${p.status}\`)`,
        `- **黑匣子文件**: \`${fileRef}\``,
        `- **目标页面**: \`${p.context.targetUrl ?? "-"}\` (标签页数: ${p.context.tabCount ?? 1}, 切换次数: ${p.context.tabSwitchCount ?? 0})`
      );
      if (p.error) {
        lines.push(`- **致命错误**: \`[${p.error.code}] ${p.error.message}\``);
      }
      if (p.qualitySummary?.issues?.length) {
        lines.push("- **采集期告警与异常 (CaptureIssues)**:");
        for (const iss of p.qualitySummary.issues) {
          lines.push(
            `  - \`[${iss.source}:${iss.code}]\` (可恢复: ${iss.recoverable}): ${iss.message}`
          );
        }
      }
      lines.push("");
    }
  }

  lines.push(
    "---",
    "",
    "## 5. 最近跨进程内部告警与异常日志 (Flight Recorder Top 20)",
    ""
  );
  const recentLogs = [...data.flightRecorderLogs].reverse().slice(0, 20);
  if (recentLogs.length === 0) {
    lines.push("暂无跨进程内部错误或告警日志。", "");
  } else {
    for (const log of recentLogs) {
      lines.push(
        `- **[\`${formatIso(log.timestamp)}\`]** \`[${log.process}:${log.level.toUpperCase()}]\` ${log.code ? `\`(${log.code})\` ` : ""}${log.message}${log.sessionId ? ` *(session: ${log.sessionId})*` : ""}`
      );
    }
    lines.push(
      "",
      "> 完整 1000 条带堆栈日志请读取 `logs/internal-flight-recorder.json`。"
    );
  }

  return lines.filter((l) => l !== undefined).join("\n");
}

/** 构建分层结构化 ZIP 诊断包 */
export function buildDiagnosticsZipArchive(
  data: DiagnosticsData,
  storageOverview?: StorageOverview,
  sessionOverviews?: SessionOverview[]
): DiagnosticsZipBuildResult {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const filename = `bug-lens-diagnostics-${stamp}.zip`;

  const summaryMarkdown = buildDiagnosticsSummaryMarkdown(
    data,
    storageOverview
  );
  const microOpsGlobalSummary = aggregateMicroOpsSummary(data.recentProfiles);

  const macroSummaryJson = {
    reportType: "Bug Lens Full Blackbox Diagnostics Archive",
    generatedAt: now.toISOString(),
    environment: getRuntimeContext(),
    memorySnapshot: captureMemorySnapshot(),
    storageOverview,
    metrics: data.metrics,
    microOpsGlobalSummary,
  };

  // 构建 200 条任务的轻量索引表（剥离巨型 waterfall 与 microOps 数组，方便 AI 快速全局扫描）
  const recentIndex = [...data.recentProfiles].reverse().map((p) => {
    const file = `profiles/tasks/${safeFileId(p.id)}.json`;
    return {
      id: p.id,
      file,
      timestamp: p.timestamp,
      isoTime: formatIso(p.timestamp),
      taskType: p.taskType,
      status: p.status,
      durationMs: p.durationMs,
      pipelineWallClockMs: p.pipelineWallClockMs,
      bottleneckStage: p.bottleneckStage,
      targetUrl: p.context.targetUrl,
      targetTitle: p.context.targetTitle,
      sourceType: p.context.sourceType,
      tabCount: p.context.tabCount,
      tabSwitchCount: p.context.tabSwitchCount,
      breakdown: p.breakdown,
      metricsSummary: p.metricsSummary,
      qualityOverall: p.qualitySummary?.overall,
      issuesCount: p.qualitySummary?.issues?.length ?? 0,
      microOpsCount: p.microOps?.length ?? 0,
      error: p.error
        ? { code: p.error.code, message: p.error.message }
        : undefined,
    };
  });

  const zipEntries: Record<string, Uint8Array> = {
    "SUMMARY.md": strToU8(summaryMarkdown),
    "metrics/macro-summary.json": strToU8(
      JSON.stringify(macroSummaryJson, null, 2)
    ),
    "profiles/recent-index.json": strToU8(JSON.stringify(recentIndex, null, 2)),
    "logs/internal-flight-recorder.json": strToU8(
      JSON.stringify([...data.flightRecorderLogs].reverse(), null, 2)
    ),
  };

  if (sessionOverviews && sessionOverviews.length > 0) {
    zipEntries["metrics/idb-sessions-overview.json"] = strToU8(
      JSON.stringify(sessionOverviews, null, 2)
    );
  }

  // 将每条任务的全量黑匣子详情写入独立 JSON 文件
  for (const profile of data.recentProfiles) {
    const taskFile = `profiles/tasks/${safeFileId(profile.id)}.json`;
    zipEntries[taskFile] = strToU8(JSON.stringify(profile, null, 2));
  }

  const zippedBytes = zipSync(zipEntries, { level: 6 });
  const copyBuffer = new Uint8Array(zippedBytes.byteLength);
  copyBuffer.set(zippedBytes);
  const blob = new Blob([copyBuffer.buffer], { type: "application/zip" });

  return {
    filename,
    bytes: zippedBytes,
    blob,
    summaryMarkdown,
  };
}

/**
 * 触发浏览器下载诊断 ZIP 并解析本地真实绝对路径
 */
export async function downloadDiagnosticsZipAndResolvePath(
  zipResult: DiagnosticsZipBuildResult
): Promise<{ downloadId?: number; absolutePath?: string }> {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    return {};
  }

  const blobUrl = URL.createObjectURL(zipResult.blob);
  try {
    if (typeof chrome !== "undefined" && chrome.downloads?.download) {
      const downloadId = await new Promise<number | undefined>((resolve) => {
        try {
          chrome.downloads.download(
            {
              url: blobUrl,
              filename: zipResult.filename,
              saveAs: false,
            },
            (id) => {
              if (chrome.runtime?.lastError) {
                resolve(undefined);
                return;
              }
              resolve(id);
            }
          );
        } catch {
          resolve(undefined);
        }
      });

      if (downloadId !== undefined && chrome.downloads?.search) {
        // 轮询等待落盘路径解析完成（最长等待 5 秒）
        for (let i = 0; i < 50; i++) {
          const items = await new Promise<chrome.downloads.DownloadItem[]>(
            (resolve) => {
              chrome.downloads.search({ id: downloadId }, (res) =>
                resolve(res || [])
              );
            }
          );
          const item = items[0];
          if (item?.filename && (item.state === "complete" || i >= 8)) {
            return { downloadId, absolutePath: item.filename };
          }
          await new Promise((r) => setTimeout(r, 80));
        }
        return { downloadId };
      }
    }

    // 降级：通过 DOM <a> 标签触发下载
    if (typeof document !== "undefined") {
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = zipResult.filename;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
    return {};
  } finally {
    setTimeout(() => {
      try {
        URL.revokeObjectURL(blobUrl);
      } catch {
        // 忽略
      }
    }, 10_000);
  }
}

/**
 * 构建复制到剪贴板的 AI 诊断引导 Prompt（指向本地分层 ZIP 包与 O(1) 临时工作区）
 */
export function buildDiagnosticsAiPrompt(
  data: DiagnosticsData,
  filename: string,
  absolutePath?: string
): string {
  const resolvedPath = absolutePath || `~/Downloads/${filename}`;
  const workspaceDir = "/tmp/bug-lens-diagnostics";
  const m = data.metrics;
  const expStats = m.exportLatencyStats;
  const shotStats = m.screenshotLatencyStats;
  const latestProfile = data.recentProfiles[data.recentProfiles.length - 1];

  const unzipCmd = `rm -rf "${workspaceDir}" && mkdir -p "${workspaceDir}" && unzip -q -o "${resolvedPath}" -d "${workspaceDir}"`;

  return [
    "# Bug Lens 插件自身性能与运行故障黑匣子诊断请求",
    "",
    "请分析以下由 Bug Lens 导出的**全量本地黑匣子诊断包 (ZIP)**，帮助定位扩展在录制、CDP 采集、视频分片落盘、流式 ZIP 封包或智能截图过程中的性能瓶颈与异常根因。",
    "",
    "## 1. 诊断包位置与工作区准备（O(1) 固定临时目录覆盖解压，严禁解压到代码工程目录）",
    `- **诊断包路径**: \`${resolvedPath}\``,
    "- **一键解压命令**:",
    "  ```bash",
    `  ${unzipCmd}`,
    "  ```",
    `- **解压后工作区**: \`${workspaceDir}\``,
    "",
    "## 2. 当前宏观水位快照",
    `- **累计用量**: 录制 \`${m.totalRecordings}\` 次 (总时长 \`${(m.totalRecordingDurationMs / 1000).toFixed(1)}s\`) | 截图 \`${m.totalScreenshots}\` 次 | Prompt 复制 \`${m.totalPromptCopies}\` 次`,
    `- **录制导出耗时 (Stage1~6)**: Avg \`${expStats?.avgMs ?? m.avgExportDurationMs}ms\` | P50 \`${expStats?.p50Ms ?? 0}ms\` | **P95 \`${expStats?.p95Ms ?? 0}ms\`** | **Max \`${expStats?.maxMs ?? 0}ms\`**`,
    `- **智能截图耗时 (端到端)**: Avg \`${shotStats?.avgMs ?? 0}ms\` | P50 \`${shotStats?.p50Ms ?? 0}ms\` | **P95 \`${shotStats?.p95Ms ?? 0}ms\`** | **Max \`${shotStats?.maxMs ?? 0}ms\`**`,
    `- **异常与告警计数**: 失败任务 \`${m.failedTasksCount}\` 次 | 内部 Flight Recorder 日志 \`${data.flightRecorderLogs.length}\` 条 | 微操作采样 \`${m.totalMicroOpsRecorded ?? 0}\` 条`,
    latestProfile
      ? `- **最近一次任务**: \`${latestProfile.id}\` (${latestProfile.taskType} | 状态: \`${latestProfile.status}\` | 流水线耗时: \`${Math.round(computeEffectivePipelineMs(latestProfile) ?? latestProfile.durationMs)}ms\` | 录制时长: \`${latestProfile.durationMs}ms\` | 瓶颈: \`${latestProfile.bottleneckStage ?? "-"}\` | 页面: \`${latestProfile.context.targetUrl ?? "-"}\`)`
      : "",
    "",
    "## 3. 分层诊断文件按需读取指南（避免一次性读取超大文件）",
    `1. **首读全局概览**: 先读取 \`${workspaceDir}/SUMMARY.md\`，查看**最慢任务 Top 10 排行榜**、**录制期高频微操作聚合统计**（交互截图通道命中率、IndexedDB 批量刷盘耗时、多标签页切换耗时）以及**异常/降级任务列表**。`,
    `2. **检索历史索引**: 如需对比趋势，读取 \`${workspaceDir}/profiles/recent-index.json\`（包含最近 ${data.recentProfiles.length} 条任务的轻量元数据与阶段耗时拆解）。`,
    `3. **深挖单次任务黑匣子**: 根据 \`SUMMARY.md\` 或索引中的任务 ID，按需读取对应的 \`${workspaceDir}/profiles/tasks/<taskId>.json\`，内含：`,
    "   - `exportDashboard`: 6 大阶段微秒级时间账本闭环 (`ledger`)、未记账系统损耗 (`unaccountedOverheadMs`)、算法与 I/O 效率看板 (`efficiencyMetrics`)、完整子步骤瀑布流 (`waterfall`)；",
    "   - `exportTrace`: Stage 1~6 原始高精度时间戳与 CDP 响应体萃取吞吐率 (`cdpFinalizeStats`)；",
    "   - `qualitySummary`: 交互截图主通道/降级/失败计数与全部 `CaptureIssue[]`；",
    "   - `screenshotDetail`: 视口/选区尺寸、DOM 空间树节点数、框架探针与 CSS 级联耗时；",
    "   - `microOps`: 任务期间每一次交互截图、IndexedDB 批量事务刷盘、媒体分片写入重试、跨标签页导航恢复的逐条微操作时间线。",
    `4. **排查跨进程异常堆栈**: 读取 \`${workspaceDir}/logs/internal-flight-recorder.json\` 查看 Background / Offscreen / Content Script 的告警与错误堆栈。`,
    "5. **结合源码给出方案**: 定位具体代码模块与函数瓶颈，给出明确的分析结论与优化补丁。",
  ]
    .filter(Boolean)
    .join("\n");
}
