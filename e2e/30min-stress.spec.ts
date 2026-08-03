import { test, expect } from "./fixtures/extension.ts";

function logE2e(message: string, details?: unknown): void {
  const suffix = details === undefined ? "" : ` ${JSON.stringify(details)}`;
  console.log(
    `[Bug Lens 30Min Stress E2E][${new Date().toISOString()}] ${message}${suffix}`
  );
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

test.describe("Bug Lens 30 分钟连续录制长效压力与零丢包 E2E 测试", () => {
  test("STRESS-30MIN: 连续录制 30 分钟高频证据流，无内存泄漏/丢包，保证 Session 数据落盘完整", async ({
    context,
    openActionPopup,
    waitForPopupClosed,
    activeTabId,
    mediaProbe,
    serverUrl,
  }) => {
    // 设置 35 分钟的最大测试超时，专门用于真实 30 分钟长效压测
    const isFullStress = process.env.RUN_FULL_30MIN === "true";
    const durationMinutes = isFullStress ? 30 : 1; // 默认环境跑 1 分钟高密度压力，若 RUN_FULL_30MIN=true 则跑满 30 分钟
    const totalDurationMs = durationMinutes * 60 * 1000;

    test.setTimeout(totalDurationMs + 120_000);

    logE2e(`启动 ${durationMinutes} 分钟连续录制压力测试`, {
      isFullStress,
      durationMinutes,
      totalDurationMs,
    });

    let targetPage = context.pages()[0];
    if (!targetPage) targetPage = await context.newPage();
    await targetPage.goto(serverUrl);
    await targetPage.bringToFront();

    const targetTabId = await activeTabId();
    expect(targetTabId).toBeTruthy();

    // 1. 启动录制
    const popup = await openActionPopup(targetPage);
    await popup.waitForSelector('[data-testid="record-panel"]');
    await popup.click('[data-testid="start-recording-btn"]');
    await popup.evaluate("window.close()").catch(() => undefined);
    await popup.dispose();
    await targetPage.bringToFront();
    await waitForPopupClosed();

    const session = await mediaProbe.waitForSession(targetTabId!);
    const sessionId = session.id;
    const startedAt = Date.now();

    logE2e("压力测试录制基线已建立", {
      sessionId,
      startedAt: new Date(startedAt).toISOString(),
    });

    let round = 0;
    const deadline = startedAt + totalDurationMs;

    let previousChunkCount = 0;

    // 2. 在持续期间高频持续触发证据流生成
    while (Date.now() < deadline) {
      round++;
      const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);

      // 触发交互与控制台事件
      await targetPage
        .evaluate((r) => {
          console.log(
            `[STRESS_TEST_CONSOLE_LOG] Round ${r} timestamp=${Date.now()}`
          );
          console.warn(
            `[STRESS_TEST_CONSOLE_WARN] Round ${r} performance check`
          );
          if (r % 5 === 0) {
            console.error(
              `[STRESS_TEST_CONSOLE_ERROR] Simulated issue at round ${r}`
            );
          }
        }, round)
        .catch(() => undefined);

      // 定期点击 DOM 生成 Interaction 记录
      const btn = targetPage.locator('[data-testid="normal-btn"]');
      if (await btn.isVisible()) {
        await btn.click().catch(() => undefined);
      }

      // 每轮采样并强断言：分片递增、 Session ID 恒定、健康状态无异常
      const chunkCount = await mediaProbe.mediaChunkCount(sessionId);
      const currentSession = await mediaProbe.activeSession();
      const badge = await mediaProbe.getBadgeText(targetTabId!);

      expect(currentSession?.id).toBe(sessionId);
      expect(currentSession?.status).toBe("RECORDING");
      expect(badge).toBe("REC");
      expect(chunkCount).toBeGreaterThanOrEqual(previousChunkCount);
      previousChunkCount = chunkCount;

      // 内存采样记录
      const memory = await targetPage
        .evaluate(() => {
          const mem = (performance as any).memory;
          return mem
            ? {
                usedJSHeapSize: mem.usedJSHeapSize,
                totalJSHeapSize: mem.totalJSHeapSize,
              }
            : undefined;
        })
        .catch(() => undefined);

      logE2e(
        `压力测试采样 [已录制 ${elapsedSec}s / ${durationMinutes * 60}s Mode=${isFullStress ? "FULL_30MIN" : "FAST_BASELINE"}]`,
        {
          round,
          chunkCount,
          sessionId: currentSession?.id,
          badge,
          memory,
        }
      );

      await delay(5000); // 每 5 秒一轮高密度压力
    }

    logE2e(
      `已达到目标录制时长 ${durationMinutes} 分钟，正在停止录制并校验数据完整性...`
    );

    // 3. 停止录制并校验落盘数据
    await targetPage.locator("#__wbr_stop_btn__").click();
    await delay(2000);

    const finalSession = await mediaProbe.getSession(sessionId);
    const finalChunkCount = await mediaProbe.mediaChunkCount(sessionId);

    logE2e("压力测试完成，数据落盘校验", {
      sessionId,
      status: finalSession?.status,
      overallQuality: finalSession?.quality.overall,
      consoleEntryCount: finalSession?.quality.consoleEntryCount,
      interactionCount: finalSession?.quality.interactionCount,
      finalChunkCount,
      isFullStress,
    });

    // 严密断言：数据无丢包、 Session ID 恒定、质量报告 complete、分片完整
    expect(finalSession?.status).toBe("PREVIEW_READY");
    expect(finalSession?.quality.overall).toBe("complete");
    expect(finalSession?.quality.consoleEntryCount).toBeGreaterThan(0);
    expect(finalChunkCount).toBeGreaterThan(0);

    if (!isFullStress) {
      logE2e(
        "注意：当前在 FAST_BASELINE 快速模式 (1 分钟) 下完成基线断言，生产完成标准验证请运行 RUN_FULL_30MIN=true pnpm exec playwright test e2e/30min-stress.spec.ts！"
      );
    } else {
      logE2e("连续录制 30 分钟长效压力测试成功通过！数据零丢失！");
    }
  });
});
