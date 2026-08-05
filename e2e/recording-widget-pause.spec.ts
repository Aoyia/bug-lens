import { test, expect } from "./fixtures/extension.ts";

function logE2e(message: string, details?: unknown): void {
  const suffix = details === undefined ? "" : ` ${JSON.stringify(details)}`;
  console.log(
    `[Bug Lens E2E][${new Date().toISOString()}] ${message}${suffix}`
  );
}

test.describe("Bug Lens Recording Widget Compact Controls E2E", () => {
  test("WIDGET-001: renders mark-screenshot and stop-preview controls, opens preview on stop", async ({
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

    // 3. 验证精简后的挂件控制栏：标记截图 + 停止并预览
    const issueButton = targetPage.locator("#__wbr_issue_btn__");
    const stopButton = targetPage.locator("#__wbr_stop_btn__");
    const timerDisplay = targetPage.locator("#__wbr_timer_display__");

    await expect(issueButton).toBeVisible({ timeout: 5_000 });
    await expect(stopButton).toBeVisible();
    await expect(timerDisplay).toBeVisible();

    // 按钮文案：标记截图（含快捷键），停止并预览，停止并丢弃
    await expect(issueButton).toContainText("标记截图");
    await expect(issueButton).toContainText("Alt+S");
    await expect(stopButton).toHaveText("停止并预览");
    await expect(targetPage.locator("#__wbr_discard_btn__")).toHaveText(
      "停止并丢弃"
    );

    // 已移除的按钮不应存在
    await expect(targetPage.locator("#__wbr_pause_btn__")).toHaveCount(0);
    await expect(targetPage.locator("#__wbr_stop_export_btn__")).toHaveCount(0);

    // 4. 点击【停止并预览】：停止录制并自动打开预览页
    const previewPagePromise = context.waitForEvent("page", {
      predicate: (page) =>
        page.url().startsWith(`chrome-extension://${extensionId}/preview.html`),
      timeout: 10_000,
    });
    logE2e("Clicking the compact stop-preview control");
    await stopButton.click();
    const previewPage = await previewPagePromise;
    await previewPage.waitForLoadState("domcontentloaded");
    await previewPage.bringToFront();
    logE2e("Preview page opened after stop", { url: previewPage.url() });
    await expect(previewPage.locator(".zen-workspace")).toBeVisible({
      timeout: 5_000,
    });
  });

  test("WIDGET-002: stays expanded while hovering and only collapses after mouse leaves", async ({
    context,
    mediaProbe,
    openActionPopup,
    serverUrl,
  }) => {
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

    // 3. 挂件出现后立即悬停，保持展开
    const widget = targetPage.locator("#__wbr_recording_widget__");
    await widget.waitFor({ state: "visible", timeout: 5_000 });
    await widget.hover();
    logE2e("Hovering over recording widget");

    // 4. 悬停期间等待超过折叠倒计时（1.5s），仍然展开
    await targetPage.waitForTimeout(2_500);
    await expect(widget).not.toHaveClass(/__wbr_collapsed__/);
    await expect(targetPage.locator("#__wbr_issue_btn__")).toBeVisible({
      timeout: 2_000,
    });
    logE2e("Widget stayed expanded while hovering");

    // 5. 鼠标移出挂件后开始折叠倒计时
    await targetPage.mouse.move(10, 10);
    await expect(widget).toHaveClass(/__wbr_collapsed__/, {
      timeout: 4_000,
    });
    logE2e("Widget collapsed after mouse left");
  });
});
