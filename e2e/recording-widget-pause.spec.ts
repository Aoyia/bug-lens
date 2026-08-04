import { test, expect } from "./fixtures/extension.ts";

function logE2e(message: string, details?: unknown): void {
  const suffix = details === undefined ? "" : ` ${JSON.stringify(details)}`;
  console.log(
    `[Bug Lens E2E][${new Date().toISOString()}] ${message}${suffix}`
  );
}

test.describe("Bug Lens Recording Widget Pause & Resume E2E", () => {
  test("WIDGET-001: toggles pause and resume states via recording widget control bar", async ({
    context,
    extensionId,
    openActionPopup,
    mediaProbe,
    serverUrl,
  }) => {
    context.on("console", (message) => {
      logE2e(`Browser console.${message.type()}`, {
        url: message.page()?.url() ?? "extension-worker-or-popup",
        text: message.text(),
      });
    });

    // 1. 打开测试网页
    let targetPage = context.pages()[0];
    if (!targetPage) targetPage = await context.newPage();
    await targetPage.goto(serverUrl);
    await targetPage.bringToFront();
    await targetPage.waitForFunction(() => document.hasFocus(), undefined, {
      timeout: 2_000,
    });
    logE2e("Target page loaded and focused", { url: targetPage.url() });

    // 2. 启动录制
    const startPopup = await openActionPopup(targetPage);
    await startPopup.waitForSelector('[data-testid="record-panel"]');
    const targetTabId = await startPopup.evaluate<number | undefined>(
      "(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id)()"
    );
    expect(targetTabId).toBeTruthy();

    await startPopup.click('[data-testid="start-recording-btn"]');
    logE2e("Started recording via Action Popup");
    await startPopup.dispose();

    await targetPage.bringToFront();
    const session = await mediaProbe.waitForSession(targetTabId!);
    await mediaProbe.waitForActive(session.id, targetTabId!);
    logE2e("Session recording active", { sessionId: session.id });

    // 3. 定位右下角 Recording Widget 及其按钮
    const pauseButton = targetPage.locator("#__wbr_pause_btn__");
    const timerDisplay = targetPage.locator("#__wbr_timer_display__");

    // 验证控制栏与暂停按钮正常渲染
    await expect(pauseButton).toBeVisible({ timeout: 5_000 });
    const initialText = await pauseButton.textContent();
    expect(initialText?.trim()).toBe("暂停");

    // 4. 点击【暂停】按钮
    await pauseButton.click();
    logE2e("Clicked pause button on Recording Widget");

    // 校验文本变为【继续】
    await expect(pauseButton).toHaveText("继续", { timeout: 3_000 });

    // 校验 timerDisplay 显示包含 (idlePaused) 状态提示
    await expect(timerDisplay).toContainText("idlePaused", { timeout: 3_000 });

    // 5. 点击【继续】按钮恢复录制
    await pauseButton.click();
    logE2e("Clicked resume button on Recording Widget");

    // 校验文本恢复为【暂停】
    await expect(pauseButton).toHaveText("暂停", { timeout: 3_000 });

    // 6. 正常停止录制
    const stopButton = targetPage.locator("#__wbr_stop_btn__");
    await expect(stopButton).toBeVisible();
    await stopButton.click();
    logE2e("Clicked stop button on Recording Widget");
  });
});
