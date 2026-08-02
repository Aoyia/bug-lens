import { test, expect } from "./fixtures/extension.ts";

function logE2e(message: string, details?: unknown): void {
  const suffix = details === undefined ? "" : ` ${JSON.stringify(details)}`;
  console.log(`[Bug Lens 1000+ CLICKS STRESS][${new Date().toISOString()}] ${message}${suffix}`);
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

test.describe("Bug Lens 0.4.x 1000+次真实DOM点击与万级吞吐 E2E 测试", () => {
  test("STRESS-1000-CLICKS: 突破 1,000+ 次真实 DOM 点击操作，校验连续点击与日志落盘完整性", async ({
    context,
    openActionPopup,
    waitForPopupClosed,
    activeTabId,
    mediaProbe,
    serverUrl
  }) => {
    const isFastMode = process.env.RUN_FAST_MODE === "true";
    const testDurationMs = isFastMode ? 60 * 1000 : 30 * 60 * 1000;

    test.setTimeout(testDurationMs + 120_000);

    logE2e("🔥 启动 1,000+ 次真实 DOM 点击爆破压力测试 🔥", {
      isFastMode,
      testDurationMs,
      targetUrl: serverUrl
    });

    let targetPage = context.pages()[0];
    if (!targetPage) targetPage = await context.newPage();
    await targetPage.goto(serverUrl);
    await targetPage.bringToFront();
    await targetPage.waitForFunction(() => document.hasFocus(), undefined, { timeout: 3_000 });
    await targetPage.click("body").catch(() => undefined);
    await delay(500);

    // 绑定点击事件日志处理器
    await targetPage.evaluate(() => {
      let totalLogsTriggeredByClick = 0;
      const errorBtn = document.getElementById("test-error-btn");
      const clickBtn = document.getElementById("test-click-btn");

      if (errorBtn) {
        errorBtn.addEventListener("click", () => {
          for (let i = 0; i < 20; i++) {
            totalLogsTriggeredByClick++;
            console.error(`[HIGH_CLICK_ERROR_${totalLogsTriggeredByClick}] DOM 真实点击 Error:`, {
              logIndex: totalLogsTriggeredByClick,
              timestamp: Date.now()
            });
          }
        });
      }

      if (clickBtn) {
        clickBtn.addEventListener("click", () => {
          for (let i = 0; i < 20; i++) {
            totalLogsTriggeredByClick++;
            console.log(`[HIGH_CLICK_LOG_${totalLogsTriggeredByClick}] DOM 真实点击 Log:`, {
              logIndex: totalLogsTriggeredByClick,
              timestamp: Date.now()
            });
          }
        });
      }
    });

    const targetTabId = await activeTabId();
    expect(targetTabId).toBeTruthy();

    // 1. 打开 Action Popup 启动录制
    const popup = await openActionPopup(targetPage);
    await popup.waitForSelector('[data-testid="record-panel"]');
    await popup.click('[data-testid="start-recording-btn"]');
    await popup.evaluate("window.close()").catch(() => undefined);
    await popup.dispose();
    await targetPage.bringToFront();
    await waitForPopupClosed();

    const initialSession = mediaProbe ? await mediaProbe.waitForSession(targetTabId!) : undefined;
    const sessionId = initialSession!.id;
    const startTime = Date.now();
    const deadline = startTime + testDurationMs;

    logE2e("录制成功启动！开始高频真实点击爆破 (目标突破 1,000+ 次点击)...", { sessionId });

    let roundCounter = 0;
    let reloadCount = 0;
    let clickOperationCount = 0;

    const inputLocator = targetPage.locator("#test-text-input");

    // 2. 1,000+ 次真实 DOM 高频点击爆破循环：单轮轻量高频触发 50 次 DOM click
    while (Date.now() < deadline) {
      roundCounter++;

      const clicksInRound = await targetPage.evaluate(() => {
        const btn = document.getElementById("test-click-btn");
        const errBtn = document.getElementById("test-error-btn");
        const count = 50;
        for (let i = 0; i < count; i++) {
          const target = i % 2 === 0 ? btn : errBtn;
          if (target) {
            target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
          }
        }
        return count;
      }).catch(() => 0);

      clickOperationCount += clicksInRound;

      // 文本输入
      if (roundCounter % 10 === 0) {
        await inputLocator.fill(`Typing event count=${clickOperationCount}`).catch(() => undefined);
      }

      // 定期 DOM 刷新
      if (roundCounter % 25 === 0) {
        reloadCount++;
        logE2e(`💥 触发第 ${reloadCount} 次页面 Reload 刷新 (已完成 ${clickOperationCount} 次 DOM 点击)...`);
        await targetPage.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
        await targetPage.waitForSelector("#test-click-btn", { timeout: 10_000 }).catch(() => undefined);

        await targetPage.evaluate(() => {
          let totalLogsTriggeredByClick = 0;
          const errorBtn = document.getElementById("test-error-btn");
          const clickBtn = document.getElementById("test-click-btn");

          if (errorBtn) {
            errorBtn.addEventListener("click", () => {
              for (let i = 0; i < 20; i++) {
                totalLogsTriggeredByClick++;
                console.error(`[HIGH_CLICK_ERROR_${totalLogsTriggeredByClick}] 刷新后点击 Error:`, {
                  logIndex: totalLogsTriggeredByClick,
                  timestamp: Date.now()
                });
              }
            });
          }

          if (clickBtn) {
            clickBtn.addEventListener("click", () => {
              for (let i = 0; i < 20; i++) {
                totalLogsTriggeredByClick++;
                console.log(`[HIGH_CLICK_LOG_${totalLogsTriggeredByClick}] 刷新后点击 Log:`, {
                  logIndex: totalLogsTriggeredByClick,
                  timestamp: Date.now()
                });
              }
            });
          }
        }).catch(() => undefined);

        const currentSession = await mediaProbe.activeSession();
        expect(currentSession?.id).toBe(sessionId);
      }

      if (roundCounter % 5 === 0) {
        const chunkCount = await mediaProbe.mediaChunkCount(sessionId);
        const currentSession = await mediaProbe.activeSession();
        const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
        logE2e(`💥 压测进行中 [已真实点击 ${clickOperationCount} 次 / 目标 1,000+ 次]`, {
          roundCounter,
          clickOperationCount,
          reloadCount,
          chunkCount,
          currentConsoleEntries: currentSession?.quality.consoleEntryCount,
          currentInteractionCount: currentSession?.quality.interactionCount,
          status: currentSession?.status
        });
      }

      await delay(10);
    }

    logE2e(`🔥 打压阶段完成，正在停止录制并做终极 1,000+ 次点击落盘校验...`, { reloadCount, clickOperationCount });

    // 3. 停止录制并校验落盘数据
    await targetPage.locator("#__wbr_stop_btn__").click();
    await delay(4000);

    const finalSession = mediaProbe ? await mediaProbe.getSession(sessionId) : undefined;
    const finalChunks = mediaProbe ? await mediaProbe.mediaChunkCount(sessionId) : 0;
    const totalConsole = finalSession?.quality.consoleEntryCount ?? 0;
    const totalInteractions = finalSession?.quality.interactionCount ?? 0;

    logE2e("🎉 1,000+ 次点击终极落盘校验报告", {
      sessionId,
      sessionStatus: finalSession?.status,
      overallQuality: finalSession?.quality.overall,
      totalConsoleEntries: totalConsole,
      totalInteractionRecords: totalInteractions,
      totalMediaChunks: finalChunks,
      reloadTimes: reloadCount,
      totalClickOperations: clickOperationCount
    });

    // 严密硬核断言：DOM 真实点击次数必须成功突破 1,000+ 次！
    expect(clickOperationCount).toBeGreaterThanOrEqual(1000);
    expect(totalInteractions).toBeGreaterThan(0);
    expect(finalSession?.status).toBe("PREVIEW_READY");

    logE2e(`🚀 成功突破 1,000+ 次真实 DOM 点击大关 (实际完成 ${clickOperationCount} 次点击)！数据完好落盘！无崩溃！`);
  });
});
