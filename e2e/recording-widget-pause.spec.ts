import { test, expect } from "./fixtures/extension.ts";

function logE2e(message: string, details?: unknown): void {
  const suffix = details === undefined ? "" : ` ${JSON.stringify(details)}`;
  console.log(
    `[Bug Lens E2E][${new Date().toISOString()}] ${message}${suffix}`
  );
}

test.describe("Bug Lens Recording Widget Compact Controls E2E", () => {
  test("WIDGET-001: renders mark-screenshot and stop controls, triggers silent export on stop", async ({
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

    // 按钮文案：标记截图（含快捷键），停止并导出（仅保留一个停止按钮）
    // 快捷键文案随平台变化（macOS 显示 Option+S，其余平台 Alt+S）
    await expect(issueButton).toContainText("标记截图");
    await expect(issueButton).toContainText(/\(?(Alt|Option)\+S\)?/);
    await expect(stopButton).toHaveText("结束并导出");

    // 已移除的按钮不应存在
    await expect(targetPage.locator("#__wbr_discard_btn__")).toHaveCount(0);
    await expect(targetPage.locator("#__wbr_pause_btn__")).toHaveCount(0);
    await expect(targetPage.locator("#__wbr_stop_export_btn__")).toHaveCount(0);

    // 4. 点击【结束并导出】：停止录制并直出证据包下载（不打开预览页）
    logE2e("Clicking the compact stop-export control");
    await stopButton.click();
    // Playwright 捕获不到扩展后台发起的下载，改由 chrome.downloads API 轮询验证
    const exportedDownload = await mediaProbe.waitForExportDownload();
    logE2e("Silent export download completed", {
      filename: exportedDownload.filename,
      state: exportedDownload.state,
      totalBytes: exportedDownload.totalBytes,
    });
    expect(exportedDownload.state).toBe("complete");
    expect(exportedDownload.totalBytes ?? 0).toBeGreaterThan(0);

    // 静默导出不自动打开 Preview 页
    await targetPage.waitForTimeout(1_500);
    const previewPages = context
      .pages()
      .filter((p) =>
        p.url().includes(`chrome-extension://${extensionId}/preview.html`)
      );
    expect(previewPages.length).toBe(0);

    // 会话进入 PREVIEW_READY、previewPending 清空且 active 已清除
    const exportedSession = await mediaProbe.waitForSessionStatus(
      session.id,
      "PREVIEW_READY"
    );
    expect(exportedSession.status).toBe("PREVIEW_READY");
    expect(exportedSession.previewPending).toBe(false);
    expect(await mediaProbe.activeSession()).toBeUndefined();
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

  test("WIDGET-003: renders in English when user language preference is set to English and updates synchronously on language toggle", async ({
    context,
    serviceWorker,
    mediaProbe,
    openActionPopup,
    serverUrl,
  }) => {
    // 1. 设置用户语言偏好为英文
    await serviceWorker.evaluate(async () => {
      await chrome.storage.sync.set({ user_language_preference: "en-US" });
    });
    logE2e("Set user_language_preference to en-US before recording");

    // 2. 打开测试网页
    let targetPage = context.pages()[0];
    if (!targetPage) targetPage = await context.newPage();
    await targetPage.goto(serverUrl);
    await targetPage.bringToFront();
    await targetPage.waitForFunction(() => document.hasFocus(), undefined, {
      timeout: 2_000,
    });

    // 3. 启动录制
    const startPopup = await openActionPopup(targetPage);
    await startPopup.waitForSelector('[data-testid="record-panel"]');
    const targetTabId = await startPopup.evaluate<number | undefined>(
      "(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id)()"
    );
    expect(targetTabId).toBeTruthy();

    await startPopup.click('[data-testid="start-recording-btn"]');
    logE2e("Started recording via Action Popup with English preference");
    await startPopup.dispose();

    await targetPage.bringToFront();
    const session = await mediaProbe.waitForSession(targetTabId!);
    await mediaProbe.waitForActive(session.id, targetTabId!);

    // 4. 断言：挂件上的所有文本必须是英文，绝不能出现中文
    const widget = targetPage.locator("#__wbr_recording_widget__");
    await widget.waitFor({ state: "visible", timeout: 5_000 });
    await widget.hover(); // 展开挂件

    const stopBtn = targetPage.locator("#__wbr_stop_btn__");
    const issueBtn = targetPage.locator("#__wbr_issue_btn__");
    const dragHandle = targetPage.locator(".__wbr_drag_handle");

    await expect(stopBtn).toHaveText("Stop & Export");
    await expect(issueBtn).toContainText("Mark Screenshot");
    await expect(dragHandle).toHaveAttribute("title", "Drag to move");
    logE2e(
      "Widget verified in English: Stop & Export / Mark Screenshot / Drag to move"
    );

    // 5. 模拟在运行中切换语言为中文 (zh-CN)
    await serviceWorker.evaluate(async () => {
      await chrome.storage.sync.set({ user_language_preference: "zh-CN" });
    });
    await expect(stopBtn).toHaveText("结束并导出", { timeout: 3_000 });
    await expect(issueBtn).toContainText("标记截图", { timeout: 3_000 });
    await expect(dragHandle).toHaveAttribute("title", "拖拽移动位置", {
      timeout: 3_000,
    });
    logE2e("Widget dynamically switched to Chinese upon storage update");

    // 6. 再次切换回英文 (en-US)
    await serviceWorker.evaluate(async () => {
      await chrome.storage.sync.set({ user_language_preference: "en-US" });
    });
    await expect(stopBtn).toHaveText("Stop & Export", { timeout: 3_000 });
    await expect(issueBtn).toContainText("Mark Screenshot", { timeout: 3_000 });
    logE2e("Widget dynamically switched back to English");

    // 7. 停止录制并完成导出
    await stopBtn.click();
    const exportedDownload = await mediaProbe.waitForExportDownload();
    expect(exportedDownload.state).toBe("complete");
    logE2e("Export completed cleanly after i18n testing");
  });
});
