import type { ExportPipelineDashboard } from "../export/export-trace";

export type PerfMetricItem = {
  step: string;
  durationMs: number;
  size?: string;
  note?: string;
};

export type PerfReportData = {
  title: string;
  metrics: PerfMetricItem[];
  extraContext?: Record<string, unknown>;
};

export class DevProfiler {
  private static overrideEnabled: boolean | null = null;
  private static chromeStorageChecked = false;
  private static bridgeInitialized = false;

  public static setEnabled(enabled: boolean | null): void {
    this.overrideEnabled = enabled;
  }

  /**
   * 在 Content Script 中初始化与宿主网页控制台（top 上下文）的通信桥接。
   * 使得开发者在网页控制台运行 window.postMessage 或触发事件时，能无缝穿透沙箱开启全扩展性能监控。
   */
  public static initPageBridge(): void {
    if (this.bridgeInitialized || typeof window === "undefined") return;
    this.bridgeInitialized = true;

    // 1. 监听宿主网页控制台通过 window.postMessage 发出的指令
    window.addEventListener("message", (event) => {
      const data = event.data;
      if (!data || typeof data !== "object") return;
      if (
        data.type === "BUG_LENS_DEV_PERF" ||
        data.type === "__BUG_LENS_PERF__" ||
        data.type === "BUG_LENS_DEBUG_PERF" ||
        data.type === "BUG_LENS_SET_PERF"
      ) {
        const enabled = Boolean(data.enabled ?? data.value ?? true);
        DevProfiler.setEnabled(enabled);
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          try {
            void chrome.storage.local.set({
              BUG_LENS_DEBUG_PERF: enabled ? "1" : "0",
            });
          } catch {
            // 忽略
          }
        }
        // eslint-disable-next-line no-console
        console.log(
          `%c🚀 [Bug Lens] 性能监控已${enabled ? "开启" : "关闭"} (已跨进程同步)`,
          "color: #52c41a; font-weight: bold;"
        );
      }
    });

    // 2. 监听自定义事件
    window.addEventListener("BUG_LENS_PERF_TOGGLE", ((
      event: CustomEvent<{ enabled?: boolean }>
    ) => {
      const enabled = Boolean(event.detail?.enabled ?? true);
      DevProfiler.setEnabled(enabled);
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        try {
          void chrome.storage.local.set({
            BUG_LENS_DEBUG_PERF: enabled ? "1" : "0",
          });
        } catch {
          // 忽略
        }
      }
      // eslint-disable-next-line no-console
      console.log(
        `%c🚀 [Bug Lens] 性能监控已${enabled ? "开启" : "关闭"} (已跨进程同步)`,
        "color: #52c41a; font-weight: bold;"
      );
    }) as EventListener);
  }

  private static isDebugMode(): boolean {
    if (this.overrideEnabled !== null) {
      return this.overrideEnabled;
    }
    // 1. 全局变量检测
    const g = globalThis as unknown as Record<string, unknown>;
    if (
      g.__BUG_LENS_PERF__ === true ||
      g.BUG_LENS_DEBUG_PERF === "1" ||
      g.BUG_LENS_DEBUG_PERF === true
    ) {
      return true;
    }
    // 2. localStorage 检测（网页、Preview 或 Popup）
    if (typeof localStorage !== "undefined") {
      try {
        if (
          localStorage.getItem("BUG_LENS_DEBUG_PERF") === "1" ||
          localStorage.getItem("BUG_LENS_DEBUG_PERF") === "true"
        ) {
          return true;
        }
      } catch {
        // 忽略跨域或无权限限制
      }
    }
    // 3. 异步监听 chrome.storage.local（跨所有扩展上下文同步）
    if (
      !this.chromeStorageChecked &&
      typeof chrome !== "undefined" &&
      chrome.storage?.local
    ) {
      this.chromeStorageChecked = true;
      try {
        chrome.storage.local.get("BUG_LENS_DEBUG_PERF", (res) => {
          if (
            res &&
            (res.BUG_LENS_DEBUG_PERF === "1" ||
              res.BUG_LENS_DEBUG_PERF === true)
          ) {
            DevProfiler.overrideEnabled = true;
          }
        });
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area === "local" && "BUG_LENS_DEBUG_PERF" in changes) {
            const val = changes.BUG_LENS_DEBUG_PERF.newValue;
            DevProfiler.overrideEnabled = val === "1" || val === true;
          }
        });
      } catch {
        // 忽略
      }
    }
    // 4. 环境变量检测
    const env = (
      globalThis as unknown as { process?: { env?: { NODE_ENV?: string } } }
    )?.process?.env;
    if (env?.NODE_ENV === "development") {
      return true;
    }
    return false;
  }

  public static isEnabled(): boolean {
    return this.isDebugMode();
  }

  public static time(
    label: string
  ): (extraInfo?: Record<string, unknown>) => number {
    if (!this.isEnabled()) {
      return () => 0;
    }
    const start = performance.now();
    return (extraInfo?: Record<string, unknown>) => {
      const duration = performance.now() - start;
      if (extraInfo) {
        // eslint-disable-next-line no-console
        console.log(
          `⏱️ [Bug Lens Perf] ${label}: ${duration.toFixed(2)}ms`,
          extraInfo
        );
      }
      return duration;
    };
  }

  public static async measure<T>(
    label: string,
    task: () => Promise<T> | T,
    extraInfo?: (
      result: T,
      durationMs: number
    ) => Record<string, unknown> | undefined
  ): Promise<T> {
    const end = this.time(label);
    const result = await task();
    const duration = end();
    if (this.isEnabled() && extraInfo) {
      const info = extraInfo(result, duration);
      if (info) {
        // eslint-disable-next-line no-console
        console.log(
          `⏱️ [Bug Lens Perf] ${label}: ${duration.toFixed(2)}ms`,
          info
        );
      }
    }
    return result;
  }

  public static buildSummaryReport(
    title: string,
    metrics: PerfMetricItem[],
    extraContext?: Record<string, unknown>
  ): PerfReportData {
    return { title, metrics, extraContext };
  }

  public static printReport(report: PerfReportData): void {
    this.printSummaryTable(report.title, report.metrics, report.extraContext);
  }

  public static printSummaryTable(
    title: string,
    metrics: PerfMetricItem[],
    extraContext?: Record<string, unknown>
  ): void {
    if (!this.isEnabled() || typeof console === "undefined") return;

    const total = metrics.reduce((acc, m) => acc + m.durationMs, 0);
    // eslint-disable-next-line no-console
    console.log(
      `\n%c📊 [Bug Lens Dev Profiler] ${title} (总耗时: ${total.toFixed(2)}ms)`,
      "color: #1677ff; font-weight: bold; font-size: 13px;"
    );
    if (extraContext) {
      // eslint-disable-next-line no-console
      console.log("上下文信息:", extraContext);
    }
    if (typeof console.table === "function") {
      console.table(
        metrics.map((m) => ({
          "阶段 / 任务": m.step,
          "耗时 (ms)": `${m.durationMs.toFixed(2)} ms`,
          耗时占比:
            total > 0
              ? `${((m.durationMs / total) * 100).toFixed(1)}%`
              : "0.0%",
          产出大小: m.size ?? "-",
          "备注 / 状态": m.note ?? "-",
        }))
      );
    }
  }

  /**
   * 打印导出全流程性能监控大盘（含六大阶段闭环时间账本、算法/IO效率看板与瀑布流）
   */
  public static printExportDashboard(dashboard: ExportPipelineDashboard): void {
    if (!this.isEnabled() || typeof console === "undefined" || !dashboard)
      return;

    try {
      const { ledger, efficiencyMetrics, waterfall, totalWallClockMs } =
        dashboard;
      const safeTotalWall =
        typeof totalWallClockMs === "number" &&
        Number.isFinite(totalWallClockMs)
          ? totalWallClockMs
          : 0;

      const title = `📊 [Bug Lens Dev Profiler] 导出全链路性能监控大盘 (端到端总耗时: ${safeTotalWall.toFixed(2)} ms)`;
      const hasGroup = typeof console.groupCollapsed === "function";
      if (hasGroup) {
        console.groupCollapsed(
          `%c${title}`,
          "color: #1677ff; font-weight: bold; font-size: 14px;"
        );
      } else {
        // eslint-disable-next-line no-console
        console.log(
          `\n%c${title}`,
          "color: #1677ff; font-weight: bold; font-size: 14px;"
        );
      }

      if (ledger) {
        const accounted =
          typeof ledger.accountedSumMs === "number" &&
          Number.isFinite(ledger.accountedSumMs)
            ? ledger.accountedSumMs
            : 0;
        const overhead =
          typeof ledger.unaccountedOverheadMs === "number" &&
          Number.isFinite(ledger.unaccountedOverheadMs)
            ? ledger.unaccountedOverheadMs
            : 0;
        const overheadPct =
          typeof ledger.overheadPercentage === "number" &&
          Number.isFinite(ledger.overheadPercentage)
            ? ledger.overheadPercentage
            : 0;
        // eslint-disable-next-line no-console
        console.log(
          `%c⏱️ 时间账本闭环: 记账耗时之和 = ${accounted.toFixed(2)} ms (${Math.max(0, 100 - overheadPct).toFixed(1)}%), 未记账系统损耗 = ${overhead.toFixed(2)} ms (${overheadPct.toFixed(1)}%)`,
          "color: #52c41a; font-weight: 600;"
        );
      }

      if (dashboard.extraContext) {
        // eslint-disable-next-line no-console
        console.log("上下文信息:", dashboard.extraContext);
      }

      // 1. 六大流水线阶段与时间账本闭环表格
      if (ledger?.stageItems) {
        // eslint-disable-next-line no-console
        console.log(
          "%c▼ 1. 六大流水线阶段耗时与时间账本闭环",
          "color: #fa8c16; font-weight: bold;"
        );
        const stageRows = ledger.stageItems.map((item) => ({
          "阶段 / 环节": item.name,
          "耗时 (ms)": `${(item.durationMs ?? 0).toFixed(2)} ms`,
          耗时占比: `${(item.percentage ?? 0).toFixed(1)}%`,
          "核心指标 / 产出": item.metricsSummary ?? "-",
          "备注 / 说明": item.note ?? "-",
        }));
        stageRows.push({
          "阶段 / 环节": "* 未记账系统损耗 (Overhead)",
          "耗时 (ms)": `${(ledger.unaccountedOverheadMs ?? 0).toFixed(2)} ms`,
          耗时占比: `${(ledger.overheadPercentage ?? 0).toFixed(1)}%`,
          "核心指标 / 产出": "IPC 序列化 / 线程切换 / 事件循环排队",
          "备注 / 说明": "时间账本闭环差值 (Total - 记账和)",
        });
        if (typeof console.table === "function") {
          console.table(stageRows);
        } else {
          stageRows.forEach((r) => {
            // eslint-disable-next-line no-console
            console.log(
              `  • [${r["阶段 / 环节"]}] 耗时: ${r["耗时 (ms)"]} (${r.耗时占比}) | ${r["核心指标 / 产出"]}`
            );
          });
        }
      }

      // 2. 核心算法与 I/O 效率看板
      if (efficiencyMetrics && efficiencyMetrics.length > 0) {
        // eslint-disable-next-line no-console
        console.log(
          "%c▼ 2. 核心算法与 I/O 效率看板",
          "color: #722ed1; font-weight: bold;"
        );
        if (typeof console.table === "function") {
          console.table(
            efficiencyMetrics.map((em) => ({
              "算法 / I/O 维度": em.dimension,
              度量值: em.value,
              明细数据: em.details,
            }))
          );
        } else {
          efficiencyMetrics.forEach((em) => {
            // eslint-disable-next-line no-console
            console.log(`  • [${em.dimension}] ${em.value} (${em.details})`);
          });
        }
      }

      // 3. 详细子阶段瀑布流明细
      if (waterfall && waterfall.length > 0) {
        // eslint-disable-next-line no-console
        console.log(
          "%c▼ 3. 详细子步骤瀑布流明细",
          "color: #13c2c2; font-weight: bold;"
        );
        if (typeof console.table === "function") {
          console.table(
            waterfall.map((w) => ({
              子任务: w.step,
              所属阶段: w.stageName,
              "耗时 (ms)": `${(w.durationMs ?? 0).toFixed(2)} ms`,
              耗时占比:
                safeTotalWall > 0
                  ? `${(((w.durationMs ?? 0) / safeTotalWall) * 100).toFixed(1)}%`
                  : "0.0%",
              数据规模: w.sizeOrVolume ?? "-",
              状态与说明: w.statusOrNote ?? "-",
            }))
          );
        } else {
          waterfall.forEach((w) => {
            // eslint-disable-next-line no-console
            console.log(
              `  • [${w.step}] ${(w.durationMs ?? 0).toFixed(2)}ms | ${w.statusOrNote}`
            );
          });
        }
      }

      if (hasGroup && typeof console.groupEnd === "function") {
        console.groupEnd();
      }
    } catch {
      // 容错兜底：控制台输出失败绝不抛出异常影响业务
    }
  }
}
