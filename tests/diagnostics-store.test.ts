import test from "node:test";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
import {
  DEFAULT_DIAGNOSTICS_DATA,
  MAX_RECENT_PROFILES,
  clearDiagnosticsData,
  enrichDiagnosticsWithSessionOverviews,
  exportSanitizedDiagnostics,
  getDiagnosticsData,
  incrementPromptCopyCount,
  recordFlightLog,
  recordMicroOp,
  recordTaskProfile,
  sanitizeDiagnosticsText,
} from "../src/diagnostics/diagnostics-store.ts";
import {
  buildDiagnosticsAiPrompt,
  buildDiagnosticsZipArchive,
} from "../src/diagnostics/diagnostics-zip-builder.ts";

function setupMockChromeStorage() {
  const store: Record<string, any> = {};
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: async (key: string) => {
          return { [key]: store[key] };
        },
        set: async (items: Record<string, any>) => {
          Object.assign(store, items);
        },
      },
    },
    runtime: {
      getManifest: () => ({ version: "0.7.37" }),
    },
  };
  return store;
}

test("sanitizeDiagnosticsText: 显式脱敏工具函数仍能按需遮蔽 URL 与路径", () => {
  const rawUrl =
    "Request to https://api.internal.com/v1/auth/token?secret=123456&code=xyz failed with status 500";
  const sanitizedUrl = sanitizeDiagnosticsText(rawUrl);
  assert.ok(!sanitizedUrl.includes("secret=123456"));
  assert.ok(sanitizedUrl.includes("https://api.internal.com/v1/*"));

  const rawPath = "File not found at /Users/john_doe/secret_project/index.ts";
  const sanitizedPath = sanitizeDiagnosticsText(rawPath);
  assert.ok(!sanitizedPath.includes("john_doe"));
  assert.ok(sanitizedPath.includes("/Users/[masked-user]"));
});

test("diagnostics-store: 初始状态返回默认结构", async () => {
  setupMockChromeStorage();
  await clearDiagnosticsData();
  const data = await getDiagnosticsData();
  assert.equal(data.metrics.totalRecordings, 0);
  assert.equal(data.metrics.totalScreenshots, 0);
  assert.equal(data.recentProfiles.length, 0);
  assert.equal(data.flightRecorderLogs.length, 0);
});

test("diagnostics-store: 100% 原始无损保留真实 URL/路径，自动归集微操作并计算分位数与瓶颈阶段", async () => {
  setupMockChromeStorage();
  await clearDiagnosticsData();

  // 模拟录制期间产生的微操作与跨标签页切换
  recordMicroOp("rec_session_1", {
    category: "interaction-screenshot",
    name: "capture:primary",
    durationMs: 42.5,
    status: "ok",
    detail: { interactionId: "int_1", bytes: 45000 },
  });
  recordMicroOp("rec_session_1", {
    category: "storage-batch-flush",
    name: "idb-batch-commit",
    durationMs: 18.2,
    status: "ok",
    detail: { itemCount: 12 },
  });
  recordMicroOp("rec_session_1", {
    category: "multi-tab-event",
    name: "tab-switch",
    durationMs: 3.1,
    status: "ok",
    detail: { activeTabId: 102 },
  });

  // 记录完成任务
  await recordTaskProfile({
    id: "rec_session_1",
    taskType: "recording",
    status: "success",
    durationMs: 5000,
    pipelineWallClockMs: 650,
    context: {
      sourceType: "tab",
      tabCount: 2,
      targetUrl: "https://app.internal.com/dashboard?projectId=9981",
      targetTitle: "Internal Dashboard",
    },
    breakdown: {
      stage1_ipcDispatchMs: 15,
      stage2_cdpDrainMs: 35,
      stage3_assemblyMs: 120,
      stage4_zipPackMs: 380,
      stage5_browserDownloadMs: 100,
    },
  });

  const data = await getDiagnosticsData();
  assert.equal(data.metrics.totalRecordings, 1);
  assert.equal(data.metrics.totalRecordingDurationMs, 5000);
  assert.equal(data.metrics.totalExportDurationMs, 600);
  assert.equal(data.metrics.avgExportDurationMs, 600);
  assert.equal(data.metrics.exportLatencyStats?.p95Ms, 650);

  const profile = data.recentProfiles[0];
  // 验证真实 URL 与参数 100% 原始无损保留
  assert.equal(
    profile.context.targetUrl,
    "https://app.internal.com/dashboard?projectId=9981"
  );
  // 验证切 Tab 次数自动从微操作归集
  assert.equal(profile.context.tabSwitchCount, 1);
  // 验证微操作自动归档进该任务的 microOps
  assert.equal(profile.microOps?.length, 3);
  // 验证自动识别瓶颈阶段为 Stage4: 流式ZIP封包
  assert.ok(profile.bottleneckStage?.includes("Stage4"));
});

test("diagnostics-store: 200 条大容量 FIFO 限制与幂等合并", async () => {
  setupMockChromeStorage();
  await clearDiagnosticsData();

  assert.equal(MAX_RECENT_PROFILES, 200);

  for (let i = 1; i <= 205; i++) {
    await recordTaskProfile({
      id: `task_${i}`,
      taskType: "screenshot",
      status: "success",
      durationMs: 100 + i,
    });
  }

  let data = await getDiagnosticsData();
  assert.equal(data.recentProfiles.length, 200);
  assert.equal(data.recentProfiles[0].id, "task_6");
  assert.equal(data.recentProfiles[199].id, "task_205");

  // 幂等更新 task_205
  await recordTaskProfile({
    id: "task_205",
    taskType: "screenshot",
    status: "success",
    durationMs: 305,
    screenshotDetail: {
      domNodesCount: 420,
      frameworkComponentsCount: 18,
    },
  });

  data = await getDiagnosticsData();
  assert.equal(data.metrics.totalScreenshots, 205);
  assert.equal(data.recentProfiles[199].screenshotDetail?.domNodesCount, 420);
});

test("diagnostics-zip-builder: 构建分层结构化 ZIP 诊断包与 O(1) AI 引导指令", async () => {
  setupMockChromeStorage();
  await clearDiagnosticsData();

  await recordFlightLog({
    level: "warn",
    process: "offscreen",
    sessionId: "sess_zip_1",
    code: "MEDIA_CHUNK_RETRY",
    message: "Media chunk write retried once on /Users/dev/project",
  });

  recordMicroOp("sess_zip_1", {
    category: "interaction-screenshot",
    name: "capture:primary",
    durationMs: 38,
    status: "ok",
  });

  await recordTaskProfile({
    id: "sess_zip_1",
    taskType: "recording",
    status: "error",
    durationMs: 8200,
    pipelineWallClockMs: 1450,
    context: {
      sourceType: "desktop",
      tabCount: 3,
      targetUrl: "https://staging.example.com/checkout?step=2",
    },
    breakdown: {
      stage2_cdpDrainMs: 920,
      stage4_zipPackMs: 410,
    },
    error: {
      code: "CDP_DRAIN_TIMEOUT",
      message: "Drain timed out on https://staging.example.com/checkout?step=2",
      stack:
        "Error: Drain timed out\n    at performStop (/Users/dev/lifecycle.ts:500:12)",
    },
  });

  await incrementPromptCopyCount();

  const data = await getDiagnosticsData();
  const zipResult = buildDiagnosticsZipArchive(data, {
    usedBytes: 12 * 1024 * 1024,
    quotaBytes: 512 * 1024 * 1024,
    sessionCount: 4,
    policy: {
      retentionDays: 7,
      maxSessionBytes: 512 * 1024 * 1024,
      maxResponseBodyBytes: 2 * 1024 * 1024,
      compression: "balanced",
    },
  });

  assert.ok(zipResult.filename.startsWith("bug-lens-diagnostics-"));
  assert.ok(zipResult.filename.endsWith(".zip"));
  assert.ok(zipResult.bytes.byteLength > 0);

  // 解压验证分层结构
  const unzipped = unzipSync(zipResult.bytes);
  assert.ok(unzipped["SUMMARY.md"]);
  assert.ok(unzipped["metrics/macro-summary.json"]);
  assert.ok(unzipped["profiles/recent-index.json"]);
  assert.ok(unzipped["profiles/tasks/sess_zip_1.json"]);
  assert.ok(unzipped["logs/internal-flight-recorder.json"]);

  const summaryMd = strFromU8(unzipped["SUMMARY.md"]);
  assert.ok(summaryMd.includes("sess_zip_1"));
  assert.ok(summaryMd.includes("https://staging.example.com/checkout?step=2"));
  assert.ok(summaryMd.includes("CDP_DRAIN_TIMEOUT"));

  const taskDetail = JSON.parse(
    strFromU8(unzipped["profiles/tasks/sess_zip_1.json"])
  );
  assert.equal(taskDetail.id, "sess_zip_1");
  assert.equal(taskDetail.microOps.length, 1);
  assert.ok(taskDetail.error.stack.includes("/Users/dev/lifecycle.ts:500:12"));

  // 验证 AI 引导 Prompt
  const prompt = buildDiagnosticsAiPrompt(
    data,
    zipResult.filename,
    `/Users/dev/Downloads/${zipResult.filename}`
  );
  assert.ok(prompt.includes(`/Users/dev/Downloads/${zipResult.filename}`));
  assert.ok(prompt.includes("/tmp/bug-lens-diagnostics"));
  assert.ok(prompt.includes("SUMMARY.md"));
  assert.ok(prompt.includes("profiles/recent-index.json"));
});

test("diagnostics-store: 历史旧版记录动态补齐瓶颈阶段与 IndexedDB 会话回填 + 并发写入防覆盖", async () => {
  const store = setupMockChromeStorage();
  await clearDiagnosticsData();

  // 模拟升级前遗留的旧版 v1 记录（无 bottleneckStage、无 pipelineWallClockMs、无 targetUrl）
  store["bug_lens_diagnostics"] = {
    metrics: {
      totalRecordings: 1,
      totalRecordingDurationMs: 21078,
      totalScreenshots: 0,
      totalPromptCopies: 1,
      totalExportDurationMs: 14463,
      avgExportDurationMs: 14463,
      failedTasksCount: 0,
    },
    recentProfiles: [
      {
        id: "cfd9cfb1-5589-440b-9943-01833e96ace7",
        timestamp: 1793592391940,
        taskType: "recording",
        status: "success",
        durationMs: 21078,
        context: {
          sourceType: "tab",
          tabCount: 1,
        },
        breakdown: {
          stage1_ipcDispatchMs: 5.3,
          stage2_cdpDrainMs: 57.6,
          stage3_assemblyMs: 12620.3,
          stage4_zipPackMs: 136.1,
          stage5_browserDownloadMs: 1643.5,
        },
        metricsSummary: {
          producedBytes: 14281548,
          eventsCount: 49,
        },
      },
    ],
    flightRecorderLogs: [],
  };

  let data = await getDiagnosticsData();
  const legacyProfile = data.recentProfiles[0];
  // 读取时自动推算瓶颈阶段（Stage3 占 87.3%）与流水线墙钟耗时（14463ms）
  assert.ok(legacyProfile.bottleneckStage?.includes("Stage3: DB读取与组装"));
  assert.ok(legacyProfile.bottleneckStage?.includes("87.3%"));
  assert.equal(legacyProfile.pipelineWallClockMs, 14463);

  // 通过 IndexedDB SessionOverview 自动回填缺失的页面 URL、质量摘要与证据分布
  data = enrichDiagnosticsWithSessionOverviews(data, [
    {
      session: {
        id: "cfd9cfb1-5589-440b-9943-01833e96ace7",
        state: "stopped",
        captureSource: "tab",
        target: {
          tabId: 10,
          initialUrl: "https://console.internal.com/orders?id=881",
          initialTitle: "Orders Console",
        },
        timeline: {
          createdAtEpochMs: 1793592370000,
          startedAtEpochMs: 1793592370862,
          stoppedAtEpochMs: 1793592391940,
          durationMs: 21078,
        },
        options: {
          privacyMode: "raw",
          captureConsole: true,
          captureNetwork: true,
          captureDomSnapshot: true,
          captureInteractionScreenshots: true,
        },
        quality: {
          overall: "complete",
          issues: [],
          interactionCount: 12,
          consoleEntryCount: 8,
          networkEntryCount: 35,
          mediaChunkCount: 21,
          issueSceneCount: 1,
          interactionScreenshotsCaptured: 10,
          interactionScreenshotsDegraded: 2,
          interactionScreenshotsFailed: 0,
        },
      },
      totalBytes: 14281548,
      evidence: {
        mediaBytes: 13800000,
        mediaChunks: 21,
        networkBytes: 320000,
        networkCount: 35,
        consoleBytes: 12000,
        consoleCount: 8,
        interactionBytes: 149548,
        interactionCount: 12,
        issueSceneBytes: 0,
        issueSceneCount: 1,
      },
    },
  ]);

  const enriched = data.recentProfiles[0];
  assert.equal(
    enriched.context.targetUrl,
    "https://console.internal.com/orders?id=881"
  );
  assert.equal(enriched.qualitySummary?.interactionScreenshotsDegraded, 2);
  assert.equal(enriched.evidenceBreakdown?.networkCount, 35);

  // 测试并发调用不互相覆盖
  await Promise.all([
    recordTaskProfile({
      id: "cfd9cfb1-5589-440b-9943-01833e96ace7",
      taskType: "recording",
      status: "success",
      durationMs: 21078,
      breakdown: {
        stage6_feedbackMs: 18.4,
      },
    }),
    incrementPromptCopyCount(),
  ]);

  const afterConcurrent = await getDiagnosticsData();
  assert.equal(afterConcurrent.metrics.totalPromptCopies, 2);
  assert.equal(
    afterConcurrent.recentProfiles[0].breakdown?.stage3_assemblyMs,
    12620.3
  );
  assert.equal(
    afterConcurrent.recentProfiles[0].breakdown?.stage6_feedbackMs,
    18.4
  );
});
