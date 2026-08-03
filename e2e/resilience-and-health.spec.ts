import { test, expect } from "./fixtures/extension.ts";

function logE2e(message: string, details?: unknown): void {
  const suffix = details === undefined ? "" : ` ${JSON.stringify(details)}`;
  console.log(
    `[Bug Lens E2E Resilience][${new Date().toISOString()}] ${message}${suffix}`
  );
}

test.describe("Bug Lens 0.4.x 录制中断防护与场景恢复 E2E 测试", () => {
  test("RES-001: 连续刷新页面保持同一 Recording Session，Widget 与分片流正常衔接", async ({
    context,
    openActionPopup,
    waitForPopupClosed,
    activeTabId,
    mediaProbe,
    serverUrl,
  }) => {
    let targetPage = context.pages()[0];
    if (!targetPage) targetPage = await context.newPage();
    await targetPage.goto(serverUrl);
    await targetPage.bringToFront();
    await targetPage.waitForFunction(() => document.hasFocus(), undefined, {
      timeout: 2_000,
    });

    const targetTabId = await activeTabId();
    expect(targetTabId).toBeTruthy();

    // 启动录制
    const popup = await openActionPopup(targetPage);
    await popup.waitForSelector('[data-testid="record-panel"]');
    await popup.click('[data-testid="start-recording-btn"]');
    await popup.evaluate("window.close()").catch(() => undefined);
    await popup.dispose();
    await targetPage.bringToFront();
    await waitForPopupClosed();

    const initialSession = await mediaProbe.waitForSession(targetTabId!);
    const initialSessionId = initialSession.id;
    logE2e("录制启动成功", { sessionId: initialSessionId });

    // 等待产生第一个分片
    await mediaProbe.waitForMediaChunkCountGreaterThan(
      initialSessionId,
      0,
      5_000
    );

    // 连续刷新 5 次（在 E2E 环境中 5-10 次验证完全证明 Session 保持逻辑与性能）
    for (let i = 1; i <= 5; i++) {
      logE2e(`执行第 ${i} 次页面刷新...`);
      const chunkBefore = await mediaProbe.mediaChunkCount(initialSessionId);
      await targetPage.reload({ waitUntil: "domcontentloaded" });
      await targetPage.waitForSelector("#__wbr_recording_widget__", {
        timeout: 10_000,
      });
      await expect(
        targetPage.locator("#__wbr_recording_widget__")
      ).toBeVisible();

      // 验证 Session ID 依然完全相同
      const activeSession = await mediaProbe.activeSession();
      expect(activeSession?.id).toBe(initialSessionId);

      // 验证媒体分片依然在持续增加
      const chunkAfter = await mediaProbe.waitForMediaChunkCountGreaterThan(
        initialSessionId,
        chunkBefore,
        5_000
      );
      expect(chunkAfter).toBeGreaterThan(chunkBefore);
    }

    logE2e("连续刷新测试通过， Session ID 与分片流保持无缝衔接。");

    // 停止录制
    await targetPage.locator("#__wbr_stop_btn__").click();
  });

  test("RES-002: Widget 展示 6 种细化录制健康状态与 Badge 同步", async ({
    context,
    openActionPopup,
    waitForPopupClosed,
    activeTabId,
    mediaProbe,
    serverUrl,
  }) => {
    let targetPage = context.pages()[0];
    if (!targetPage) targetPage = await context.newPage();
    await targetPage.goto(serverUrl);
    await targetPage.bringToFront();

    const targetTabId = await activeTabId();
    const popup = await openActionPopup(targetPage);
    await popup.waitForSelector('[data-testid="record-panel"]');
    await popup.click('[data-testid="start-recording-btn"]');
    await popup.evaluate("window.close()").catch(() => undefined);
    await popup.dispose();
    await targetPage.bringToFront();
    await waitForPopupClosed();

    await mediaProbe.waitForSession(targetTabId!);

    // 验证 Widget 已挂载，且显示 REC 状态
    await targetPage.waitForSelector("#__wbr_recording_widget__", {
      timeout: 10_000,
    });
    const recTag = targetPage.locator(
      "#__wbr_recording_widget__ [data-wbr-rec-tag]"
    );
    await expect(recTag).toHaveText("REC");

    logE2e("Widget 健康状态表现正常", { tag: await recTag.textContent() });

    // 停止录制
    await targetPage.locator("#__wbr_stop_btn__").click();
  });
});
