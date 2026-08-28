import { test, expect } from "./fixtures/extension.ts";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test.describe("Bug Lens DevProfiler 性能监控输出验证", () => {
  test("PERF-001: 开启 BUG_LENS_DEBUG_PERF 后，录制交互与导出流程在控制台输出性能度量日志", async ({
    context,
    extensionId,
    openActionPopup,
    waitForPopupClosed,
    activeTabId,
    mediaProbe,
    serverUrl,
  }) => {
    test.setTimeout(60_000);

    const perfLogs: string[] = [];
    context.on("console", (msg) => {
      const text = msg.text();
      if (
        text.includes("Bug Lens Dev Profiler") ||
        text.includes("Bug Lens Perf")
      ) {
        perfLogs.push(text);
      }
    });

    // 1. 打开测试目标网页
    let targetPage = context.pages()[0];
    const targetUrl = serverUrl.replace("mock-page.html", "preview-page.html");
    await targetPage.goto(targetUrl);

    // 2. 开启性能监控开关 (通过 Service Worker 写入真正的 chrome.storage.local)
    await mediaProbe.evaluateWorker(async () => {
      await chrome.storage.local.set({ BUG_LENS_DEBUG_PERF: "1" });
    });
    await targetPage.evaluate(() => {
      (window as unknown as { __BUG_LENS_PERF__?: boolean }).__BUG_LENS_PERF__ =
        true;
      localStorage.setItem("BUG_LENS_DEBUG_PERF", "1");
    });

    const targetTabId = await activeTabId();
    expect(targetTabId).toBeTruthy();

    // 3. 打开 Popup 启动录制
    const popup = await openActionPopup(targetPage);
    await popup.waitForSelector('[data-testid="record-panel"]');
    await popup.click('[data-testid="start-recording-btn"]');
    await popup.evaluate("window.close()").catch(() => undefined);
    await popup.dispose();
    await targetPage.bringToFront();
    await waitForPopupClosed();

    const session = await mediaProbe.waitForSession(targetTabId!);
    await mediaProbe.waitForActive(session.id, targetTabId!);

    // 4. 进行点击交互产生截图与 IndexedDB 写入
    const markIssueButton = targetPage.locator("#__wbr_issue_btn__");
    await expect(markIssueButton).toBeVisible({ timeout: 5_000 });

    await targetPage.click("#normal-btn");
    await expect(targetPage.locator("#action-status")).toContainText(
      "普通点击 1 完成"
    );
    await delay(500);

    // 5. 停止录制并打开 Preview 页面
    const stopBtn = targetPage.locator("#__wbr_stop_btn__");
    await expect(stopBtn).toBeVisible();

    await stopBtn.click();
    await mediaProbe.waitForExportDownload();

    const previewPage = await context.newPage();
    await previewPage.goto(
      `chrome-extension://${extensionId}/preview.html?sessionId=${session.id}`
    );
    await previewPage.waitForLoadState("domcontentloaded");

    // 6. 在 Preview 页面确保开启性能监控并触发导出
    await previewPage.evaluate(async () => {
      localStorage.setItem("BUG_LENS_DEBUG_PERF", "1");
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        await chrome.storage.local.set({ BUG_LENS_DEBUG_PERF: "1" });
      }
      (window as unknown as { __BUG_LENS_PERF__?: boolean }).__BUG_LENS_PERF__ =
        true;
    });

    const exportBtn = previewPage.locator("#export");
    await expect(exportBtn).toBeVisible({ timeout: 10_000 });

    const downloadPromise = previewPage
      .waitForEvent("download", {
        timeout: 15_000,
      })
      .catch(() => null);

    await exportBtn.click();
    await downloadPromise;

    // 7. 验证性能日志是否成功输出
    const hasPerfLogs = perfLogs.some(
      (log) =>
        log.includes("Bug Lens Dev Profiler") ||
        log.includes("Bug Lens Perf") ||
        log.includes("导出流水线性能分析报告") ||
        log.includes("IndexedDB 批量写入")
    );

    expect(hasPerfLogs).toBe(true);
  });

  test("PERF-002: 不打开 Preview 页面，直接通过悬浮条点击「结束并导出」输出静默导出性能日志", async ({
    context,
    openActionPopup,
    waitForPopupClosed,
    activeTabId,
    mediaProbe,
    serverUrl,
  }) => {
    test.setTimeout(60_000);

    const perfLogs: string[] = [];
    context.on("console", (msg) => {
      const text = msg.text();
      if (
        text.includes("Bug Lens Dev Profiler") ||
        text.includes("Bug Lens Perf")
      ) {
        perfLogs.push(text);
      }
    });

    // 1. 打开测试目标网页
    let targetPage = context.pages()[0];
    const targetUrl = serverUrl.replace("mock-page.html", "preview-page.html");
    await targetPage.goto(targetUrl);

    // 2. 开启性能监控开关 (通过 Service Worker 写入真正的 chrome.storage.local)
    await mediaProbe.evaluateWorker(async () => {
      await chrome.storage.local.set({ BUG_LENS_DEBUG_PERF: "1" });
    });
    await targetPage.evaluate(() => {
      (window as unknown as { __BUG_LENS_PERF__?: boolean }).__BUG_LENS_PERF__ =
        true;
      localStorage.setItem("BUG_LENS_DEBUG_PERF", "1");
    });

    const targetTabId = await activeTabId();
    expect(targetTabId).toBeTruthy();

    // 3. 打开 Popup 启动录制
    const popup = await openActionPopup(targetPage);
    await popup.waitForSelector('[data-testid="record-panel"]');
    await popup.click('[data-testid="start-recording-btn"]');
    await popup.evaluate("window.close()").catch(() => undefined);
    await popup.dispose();
    await targetPage.bringToFront();
    await waitForPopupClosed();

    const session = await mediaProbe.waitForSession(targetTabId!);
    await mediaProbe.waitForActive(session.id, targetTabId!);

    // 4. 进行点击交互产生截图
    const markIssueButton = targetPage.locator("#__wbr_issue_btn__");
    await expect(markIssueButton).toBeVisible({ timeout: 15_000 });

    const normalBtn = targetPage.locator("#normal-btn");
    await normalBtn.click();
    await expect(targetPage.locator("#action-status")).toHaveText(
      "普通点击 1 完成"
    );
    await delay(500);

    // 5. 直接点击悬浮条上的停止按钮（触发静默导出，不打开预览页）
    const stopBtn = targetPage.locator("#__wbr_stop_btn__");
    await expect(stopBtn).toBeVisible();

    await stopBtn.click();
    await mediaProbe.waitForExportDownload();

    // 6. 验证性能日志是否输出（包含全链路大盘或ZIP流水线报告）
    const hasPerfLogs = perfLogs.some(
      (log) =>
        log.includes("Bug Lens Dev Profiler") ||
        log.includes("Bug Lens Perf") ||
        log.includes("端到端（E2E）导出耗时全链路大盘") ||
        log.includes("ZIP 导出流水线分析报告") ||
        log.includes("IndexedDB 批量写入")
    );

    expect(hasPerfLogs).toBe(true);
  });
});
