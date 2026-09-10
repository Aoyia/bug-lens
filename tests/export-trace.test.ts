import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  createExportTraceContext,
  getEpochTimestampMs,
  getPerformanceOrigin,
  buildExportTimeLedger,
  buildExportPipelineDashboard,
  type ExportTraceContext,
  type Stage1Metrics,
  type Stage2Metrics,
  type Stage3Metrics,
  type Stage4Metrics,
  type Stage5Metrics,
  type Stage6Metrics,
} from "../src/export/export-trace.ts";
import { DevProfiler } from "../src/shared/dev-profiler.ts";

describe("ExportTrace & TimeLedger - 导出性能监控与时间账本闭环测试", () => {
  test("createExportTraceContext 生成唯一 TraceId 并记录起始时间戳", () => {
    const ctx = createExportTraceContext(1000);
    assert.equal(ctx.t0EpochMs, 1000);
    assert.ok(ctx.traceId && typeof ctx.traceId === "string");
  });

  test("getEpochTimestampMs 返回大于 0 的数值时间戳", () => {
    const ts = getEpochTimestampMs();
    assert.ok(Number.isFinite(ts) && ts > 0);
  });

  test("buildExportTimeLedger 实现数学闭环（记账和 + 未记账损耗 === 总 Wall-clock 耗时，占比合计 100%）", () => {
    const stage1: Stage1Metrics = {
      clickEpochMs: 1000,
      uiFreezeDurationMs: 15,
      sendEpochMs: 1015,
      bgReceivedEpochMs: 1025,
      ipcDispatchDurationMs: 10,
      totalDurationMs: 25,
    };
    const stage2: Stage2Metrics = {
      mediaStopDurationMs: 50,
      queueDrainDurationMs: 30,
      cdpFinalizeStats: {
        totalRequests: 5,
        successCount: 5,
        failureCount: 0,
        totalBodyBytes: 10240,
        avgDurationMs: 8,
        durationMs: 40,
        throughputMBps: 0.25,
      },
      issueSceneFinalizeDurationMs: 10,
      qualityReconcileDurationMs: 20,
      totalDurationMs: 150,
    };
    const stage3: Stage3Metrics = {
      dbQueryDurationMs: 40,
      templateLoadDurationMs: 10,
      assembleDurationMs: 25,
      promptRenderDurationMs: 5,
      promptCharCount: 1200,
      totalDurationMs: 80,
    };
    const stage4: Stage4Metrics = {
      hashDurationMs: 15,
      hashThroughputMBps: 50.0,
      staticFilesBytes: 1048576,
      staticFilesCount: 8,
      deflateAndPassDurationMs: 30,
      mediaPackDurationMs: 40,
      mediaBytes: 2097152,
      mediaChunksCount: 6,
      manifestDurationMs: 5,
      manifestBytes: 512,
      finalizeDurationMs: 10,
      totalDurationMs: 100,
      totalRawInputBytes: 3146240,
      totalCompressedBytes: 1573120,
      compressionRatio: 0.5,
      overallThroughputMBps: 30.0,
    };
    const stage5: Stage5Metrics = {
      downloadCallDurationMs: 10,
      pollWaitDurationMs: 60,
      pollCount: 3,
      avgPollIntervalMs: 20,
      pathResolveDurationMs: 1,
      resolvedFilename: "web-bug-report-test.zip",
      totalDurationMs: 71,
    };
    const stage6: Stage6Metrics = {
      clipboardWriteDurationMs: 8,
      toastAndTeardownDurationMs: 16,
      totalDurationMs: 24,
    };

    const t0 = 1000;
    // 假设端到端总 Wall-clock 耗时为 500ms
    const tn = 1500;
    const ledger = buildExportTimeLedger(t0, tn, {
      stage1,
      stage2,
      stage3,
      stage4,
      stage5,
      stage6,
    });

    const expectedAccounted = 25 + 150 + 80 + 100 + 71 + 24; // 450 ms
    assert.equal(ledger.accountedSumMs, expectedAccounted);
    assert.equal(ledger.totalWallClockMs, 500);

    // 未记账系统损耗 Overhead = 500 - 450 = 50 ms
    assert.equal(ledger.unaccountedOverheadMs, 50);

    // 闭环验证：记账和 + 未记账损耗 === 总耗时
    assert.equal(
      ledger.accountedSumMs + ledger.unaccountedOverheadMs,
      ledger.totalWallClockMs
    );

    // 占比闭环验证：所有阶段百分比 + 未记账百分比 === 100%
    const totalPercentage =
      ledger.stageItems.reduce((acc, item) => acc + item.percentage, 0) +
      ledger.overheadPercentage;
    assert.ok(
      Math.abs(totalPercentage - 100.0) < 0.0001,
      `占比总和应为 100%，实际: ${totalPercentage}`
    );

    assert.equal(ledger.stageItems.length, 6);
  });

  test("buildExportTimeLedger 面对时钟漂移或总耗时小于记账和时，自动安全对齐不产生负未记账损耗", () => {
    const stage1: Stage1Metrics = {
      clickEpochMs: 1000,
      uiFreezeDurationMs: 10,
      sendEpochMs: 1010,
      totalDurationMs: 10,
    };
    // tn 与 t0 相同或小于记账和
    const ledger = buildExportTimeLedger(1000, 1005, { stage1 });
    assert.equal(ledger.accountedSumMs, 10);
    assert.equal(ledger.totalWallClockMs, 10);
    assert.equal(ledger.unaccountedOverheadMs, 0);
    assert.equal(ledger.overheadPercentage, 0);
  });

  test("buildExportPipelineDashboard 完整构建算法看板指标与全流程瀑布流", () => {
    const traceCtx: ExportTraceContext = {
      traceId: "test-trace-123",
      t0EpochMs: 1000,
      stage1: {
        clickEpochMs: 1000,
        uiFreezeDurationMs: 10,
        sendEpochMs: 1010,
        ipcDispatchDurationMs: 5,
        totalDurationMs: 15,
      },
      stage2: {
        mediaStopDurationMs: 20,
        queueDrainDurationMs: 10,
        cdpFinalizeStats: {
          totalRequests: 4,
          successCount: 4,
          failureCount: 0,
          totalBodyBytes: 8192,
          avgDurationMs: 5,
          durationMs: 20,
          throughputMBps: 0.4,
        },
        issueSceneFinalizeDurationMs: 5,
        qualityReconcileDurationMs: 10,
        totalDurationMs: 65,
      },
      stage3: {
        dbQueryDurationMs: 15,
        templateLoadDurationMs: 5,
        assembleDurationMs: 10,
        promptRenderDurationMs: 5,
        promptCharCount: 850,
        totalDurationMs: 35,
      },
      stage4: {
        hashDurationMs: 10,
        hashThroughputMBps: 100,
        staticFilesBytes: 1048576,
        staticFilesCount: 5,
        deflateAndPassDurationMs: 15,
        mediaPackDurationMs: 20,
        mediaBytes: 1048576,
        mediaChunksCount: 2,
        manifestDurationMs: 2,
        manifestBytes: 300,
        finalizeDurationMs: 3,
        totalDurationMs: 50,
        totalRawInputBytes: 2097452,
        totalCompressedBytes: 1048726,
        compressionRatio: 0.5,
        overallThroughputMBps: 40.0,
      },
      stage5: {
        downloadCallDurationMs: 5,
        pollWaitDurationMs: 40,
        pollCount: 2,
        avgPollIntervalMs: 20,
        pathResolveDurationMs: 0.5,
        resolvedFilename: "test.zip",
        totalDurationMs: 45.5,
      },
      stage6: {
        clipboardWriteDurationMs: 5,
        toastAndTeardownDurationMs: 10,
        totalDurationMs: 15,
      },
    };

    const dashboard = buildExportPipelineDashboard(traceCtx, 1300, {
      文件: "test.zip",
    });

    assert.equal(dashboard.traceId, "test-trace-123");
    assert.ok(dashboard.totalWallClockMs >= 225.5);

    // 验证核心算法看板包含 8 大关键维度
    const dimensions = dashboard.efficiencyMetrics.map((m) => m.dimension);
    assert.ok(dimensions.includes("ZIP 整体封包吞吐速率"));
    assert.ok(dimensions.includes("ZIP 体积压缩比"));
    assert.ok(dimensions.includes("静态文件 SHA-256 并行计算"));
    assert.ok(dimensions.includes("CDP 网络正文拉取吞吐与效率"));
    assert.ok(dimensions.includes("CDP 正文拉取成功率"));
    assert.ok(dimensions.includes("OS 文件落盘轮询等待开销"));
    assert.ok(dimensions.includes("AI Prompt 提示词渲染效率"));

    // 验证瀑布流覆盖各阶段子任务
    assert.ok(dashboard.waterfall.length >= 15);
    const waterfallSteps = dashboard.waterfall.map((w) => w.step);
    assert.ok(waterfallSteps.includes("1.1 Content 响应与 UI 冻结"));
    assert.ok(waterfallSteps.includes("2.1 MediaRecorder 停止与分片排空"));
    assert.ok(waterfallSteps.includes("3.1 IndexedDB 批量查询加载"));
    assert.ok(waterfallSteps.includes("4.1 静态与证据文件 SHA-256 并行计算"));
    assert.ok(waterfallSteps.includes("5.1 chrome.downloads API 调用"));
    assert.ok(waterfallSteps.includes("6.1 系统剪贴板 AI Prompt 写入"));
  });

  test("DevProfiler.printExportDashboard 在启用状态下安全格式化输出且不崩溃", () => {
    DevProfiler.setEnabled(true);
    const traceCtx = createExportTraceContext(1000);
    traceCtx.stage1 = {
      clickEpochMs: 1000,
      uiFreezeDurationMs: 10,
      sendEpochMs: 1010,
      ipcDispatchDurationMs: 5,
      totalDurationMs: 15,
    };
    const dashboard = buildExportPipelineDashboard(traceCtx, 1100);

    // 验证执行无异常
    DevProfiler.printExportDashboard(dashboard);
    assert.ok(true);
  });

  test("DevProfiler.printExportDashboard 在禁用状态下静默跳过", () => {
    DevProfiler.setEnabled(false);
    const traceCtx = createExportTraceContext(1000);
    const dashboard = buildExportPipelineDashboard(traceCtx, 1100);

    DevProfiler.printExportDashboard(dashboard);
    assert.ok(true);
  });

  test("buildExportTimeLedger 面对 NaN、负数与无效输入时自动清洗且不产生 NaN 污染", () => {
    const ledger = buildExportTimeLedger(1000, 1100, {
      stage1: { totalDurationMs: NaN, uiFreezeDurationMs: NaN },
      stage2: { totalDurationMs: -20 },
      stage3: { totalDurationMs: 15 },
      stage4: { totalDurationMs: undefined },
    });

    assert.equal(ledger.accountedSumMs, 15);
    assert.equal(ledger.totalWallClockMs, 100);
    assert.equal(ledger.unaccountedOverheadMs, 85);
    assert.equal(ledger.overheadPercentage, 85);
    assert.ok(!Number.isNaN(ledger.accountedSumMs));
    assert.ok(!Number.isNaN(ledger.unaccountedOverheadMs));
    assert.ok(!Number.isNaN(ledger.overheadPercentage));
  });

  test("buildExportTimeLedger 面对系统休眠或时间回退 (tn < t0) 自动安全 clamp 消除负损耗", () => {
    const ledger = buildExportTimeLedger(2000, 1000, {
      stage1: { totalDurationMs: 30 },
      stage2: { totalDurationMs: 20 },
    });

    assert.equal(ledger.accountedSumMs, 50);
    // rawTotal 为 -1000，小于 accountedSumMs (50)，自动 clamp 为 50
    assert.equal(ledger.totalWallClockMs, 50);
    assert.equal(ledger.unaccountedOverheadMs, 0);
    assert.equal(ledger.overheadPercentage, 0);

    // 百分比之和仍为 100%
    const totalPct =
      ledger.stageItems.reduce((acc, s) => acc + s.percentage, 0) +
      ledger.overheadPercentage;
    assert.ok(Math.abs(totalPct - 100) < 0.0001);
  });

  test("buildExportTimeLedger 在全阶段为空且 tn <= t0 时 totalWallClockMs 归零而不产生虚假损耗", () => {
    const ledger = buildExportTimeLedger(1000, 1000, {});
    assert.equal(ledger.accountedSumMs, 0);
    assert.equal(ledger.totalWallClockMs, 0);
    assert.equal(ledger.unaccountedOverheadMs, 0);
    assert.equal(ledger.overheadPercentage, 0);
  });

  test("buildExportPipelineDashboard 在面对各类部分/残缺阶段对象时不抛出 TypeError", () => {
    // 缺失 cdpFinalizeStats
    const dPartial2 = buildExportPipelineDashboard({
      traceId: "t-partial-2",
      t0EpochMs: 1000,
      stage2: { totalDurationMs: 25 } as any,
    });
    assert.equal(dPartial2.traceId, "t-partial-2");
    assert.equal(dPartial2.efficiencyMetrics.length, 8);

    // 缺失 stage4 内部细分指标
    const dPartial4 = buildExportPipelineDashboard({
      traceId: "t-partial-4",
      t0EpochMs: 1000,
      stage4: { totalDurationMs: 40 } as any,
    });
    assert.ok(dPartial4.waterfall.length > 0);

    // 缺失 stage3/stage5 指标
    const dPartial35 = buildExportPipelineDashboard({
      traceId: "t-partial-35",
      t0EpochMs: 1000,
      stage3: { totalDurationMs: 10 } as any,
      stage5: { totalDurationMs: 20 } as any,
    });
    assert.ok(dPartial35.waterfall.length > 0);
  });

  test("buildExportPipelineDashboard 正确回写 dashboard 到 traceContext.dashboard", () => {
    const traceCtx: ExportTraceContext = {
      traceId: "trace-dashboard-link",
      t0EpochMs: 1000,
    };
    const dashboard = buildExportPipelineDashboard(traceCtx, 1200);
    assert.equal(traceCtx.dashboard, dashboard);
  });

  test("buildExportTimeLedger 在 stages 为 undefined 时优雅防御不抛出 TypeError", () => {
    const ledger = buildExportTimeLedger(100, 200, undefined as any);
    assert.equal(ledger.accountedSumMs, 0);
    assert.equal(ledger.totalWallClockMs, 100);
    assert.equal(ledger.unaccountedOverheadMs, 100);
    assert.equal(ledger.stageItems.length, 6);
  });

  test("buildExportPipelineDashboard 在 traceContext 为 undefined 时优雅自愈不抛出 TypeError", () => {
    const dashboard = buildExportPipelineDashboard(undefined as any);
    assert.ok(dashboard);
    assert.ok(dashboard.traceId && dashboard.traceId.length > 0);
    assert.ok(dashboard.totalWallClockMs >= 0);
    assert.equal(dashboard.efficiencyMetrics.length, 8);
  });

  test("buildExportPipelineDashboard 在 traceContext 为空对象时杜绝 56 年虚假损耗", () => {
    const dashboard = buildExportPipelineDashboard({} as any);
    assert.ok(dashboard);
    // 缺失 T0 自动对齐为有效耗时，绝不能突增至 1e12 ms (~56年)
    assert.ok(
      dashboard.totalWallClockMs < 10000,
      `耗时应合理，实际: ${dashboard.totalWallClockMs}`
    );
    assert.ok(dashboard.ledger.unaccountedOverheadMs < 10000);
  });

  test("buildExportTimeLedger 面对相对时钟 T0 与纪元时钟 Tn 跨时钟域混用时自动安全换算杜绝 56 年虚假损耗", () => {
    const relativeT0 = 1234.5; // performance.now() 典型返回值
    const epochTn = Date.now(); // Unix 纪元时间戳 (~1.78e12)
    const ledger = buildExportTimeLedger(relativeT0, epochTn, {
      stage1: { totalDurationMs: 15 },
    });
    assert.equal(ledger.accountedSumMs, 15);
    // 总耗时应在合理区间内，绝不能由于跨时钟减法暴涨至 56 年 (1e12 ms)
    assert.ok(
      ledger.totalWallClockMs < 86400000,
      `总耗时应在一天以内，实际: ${ledger.totalWallClockMs}`
    );
    assert.ok(ledger.unaccountedOverheadMs < 86400000);
  });

  test("createExportTraceContext 对非正数及 NaN 自动降级为当前绝对时间戳", () => {
    const ctxZero = createExportTraceContext(0);
    assert.ok(ctxZero.t0EpochMs > 1e11);

    const ctxNeg = createExportTraceContext(-500);
    assert.ok(ctxNeg.t0EpochMs > 1e11);

    const ctxNaN = createExportTraceContext(NaN);
    assert.ok(ctxNaN.t0EpochMs > 1e11);
  });

  test("getPerformanceOrigin 与 buildExportTimeLedger 在 performance 为 undefined 时永不抛出 ReferenceError", () => {
    const originalPerf = globalThis.performance;
    try {
      delete (globalThis as any).performance;
      const origin = getPerformanceOrigin();
      assert.ok(Number.isFinite(origin) && origin > 1e11);

      // 即使 performance 缺失，跨时钟域计算依然平稳自愈且不崩溃
      const ledger = buildExportTimeLedger(100, Date.now(), {
        stage1: { totalDurationMs: 20 },
      });
      assert.ok(ledger);
      assert.equal(ledger.accountedSumMs, 20);
      assert.ok(ledger.totalWallClockMs < 86400000);
    } finally {
      (globalThis as any).performance = originalPerf;
    }
  });

  test("buildExportTimeLedger 面对双相对单调时钟输入 (T0 < 1e11 且 Tn < 1e11) 统一转换为 Epoch 时间戳", () => {
    const relativeT0 = 1000;
    const relativeTn = 1250;
    const ledger = buildExportTimeLedger(relativeT0, relativeTn, {
      stage1: { totalDurationMs: 200 },
    });
    assert.equal(ledger.accountedSumMs, 200);
    assert.equal(ledger.totalWallClockMs, 250);
    assert.equal(ledger.unaccountedOverheadMs, 50);
    // 验证 T0 和 Tn 均已被安全转换为 Unix Epoch 纪元时间戳
    assert.ok(ledger.t0EpochMs > 1e11);
    assert.ok(ledger.tnEpochMs > 1e11);
    assert.equal(ledger.tnEpochMs - ledger.t0EpochMs, 250);
  });

  test("buildExportPipelineDashboard 支持 Stage 1 点击响应细分指标并在瀑布流中呈现 1.1/1.2/1.3", () => {
    const traceCtx: ExportTraceContext = {
      traceId: "trace-stage1-fine",
      t0EpochMs: 1000,
      stage1: {
        clickEpochMs: 1000,
        clickResponseDurationMs: 2,
        uiFreezeDurationMs: 10,
        sendEpochMs: 1012,
        ipcDispatchDurationMs: 8,
        totalDurationMs: 20,
      },
    };
    const dashboard = buildExportPipelineDashboard(traceCtx, 1050);
    const waterfallSteps = dashboard.waterfall.map((w) => w.step);
    assert.ok(waterfallSteps.includes("1.1 Content 点击响应与事件调度"));
    assert.ok(waterfallSteps.includes("1.2 挂件 UI 状态冻结与监视器停止"));
    assert.ok(waterfallSteps.includes("1.3 向 Background 消息 IPC 分发"));
  });

  test("buildExportPipelineDashboard 支持 Stage 2 问题现场收尾指标并呈现 2.4", () => {
    const traceCtx: ExportTraceContext = {
      traceId: "trace-stage2-fine",
      t0EpochMs: 1000,
      stage2: {
        mediaStopDurationMs: 10,
        queueDrainDurationMs: 15,
        cdpFinalizeStats: {
          totalRequests: 2,
          successCount: 2,
          failureCount: 0,
          totalBodyBytes: 4096,
          avgDurationMs: 5,
          durationMs: 10,
          throughputMBps: 0.4,
        },
        issueSceneFinalizeDurationMs: 12,
        qualityReconcileDurationMs: 8,
        totalDurationMs: 55,
      },
    };
    const dashboard = buildExportPipelineDashboard(traceCtx, 1100);
    const waterfallSteps = dashboard.waterfall.map((w) => w.step);
    assert.ok(waterfallSteps.includes("2.4 未完成问题现场结构化收尾"));
    assert.ok(waterfallSteps.includes("2.5 质量快照与指标重算"));
  });

  test("buildExportPipelineDashboard 支持 Stage 6 Toast 与卸载独立耗时指标", () => {
    const traceCtx: ExportTraceContext = {
      traceId: "trace-stage6-fine",
      t0EpochMs: 1000,
      stage6: {
        clipboardWriteDurationMs: 5,
        toastDurationMs: 8,
        teardownDurationMs: 12,
        toastAndTeardownDurationMs: 20,
        totalDurationMs: 25,
      },
    };
    const dashboard = buildExportPipelineDashboard(traceCtx, 1050);
    const toastStep = dashboard.waterfall.find((w) =>
      w.step.includes("6.2 挂件 Toast 呈现与平滑卸载")
    );
    assert.ok(toastStep);
    assert.match(toastStep.statusOrNote, /Toast 呈现 8.00 ms/);
    assert.match(toastStep.statusOrNote, /卸载销毁 12.00 ms/);
  });

  test("DevProfiler.printExportDashboard 在 console.table 缺失时降级平稳输出且最终清理全局状态", () => {
    DevProfiler.setEnabled(true);
    const originalTable = console.table;
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: any[]) => {
      logs.push(args.join(" "));
    };
    try {
      (console as any).table = undefined;
      const dashboard = buildExportPipelineDashboard(
        createExportTraceContext(1000),
        1100
      );
      DevProfiler.printExportDashboard(dashboard);
      assert.ok(logs.some((l) => l.includes("时间账本闭环")));
    } finally {
      console.table = originalTable;
      console.log = originalLog;
      DevProfiler.setEnabled(null);
    }
  });
});
