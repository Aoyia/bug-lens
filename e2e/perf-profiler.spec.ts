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
    if (!targetPage) targetPage = await context.newPage();
    await targetPage.goto(serverUrl);
    await targetPage.bringToFront();
    await targetPage.waitForFunction(() => document.hasFocus(), undefined, {
      timeout: 2_000,
    });

    // 2. 开启性能监控开关 (通过 chrome.storage.local)
    await targetPage.evaluate(async () => {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        await chrome.storage.local.set({ BUG_LENS_DEBUG_PERF: "1" });
      }
      (window as unknown as { __BUG_LENS_PERF__?: boolean }).__BUG_LENS_PERF__ =
        true;
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

    await targetPage.click('[data-testid="normal-btn"]');
    await expect(
      targetPage.locator('[data-testid="action-status"]')
    ).toHaveText("普通点击 1 完成");
    await delay(500);

    // 5. 停止录制并打开 Preview 页面
    const stopBtn = targetPage.locator("#__wbr_stop_btn__");
    await expect(stopBtn).toBeVisible();

    const previewPagePromise = (async () => {
      const existing = context
        .pages()
        .find((p) => p.url().includes("preview.html"));
      if (existing) return existing;
      try {
        return await context.waitForEvent("page", {
          predicate: (p) => p.url().includes("preview.html"),
          timeout: 10_000,
        });
      } catch {
        const p = await context.newPage();
        await p.goto(
          `chrome-extension://${extensionId}/preview.html?id=${session.id}`
        );
        return p;
      }
    })();

    await stopBtn.click();
    const previewPage = await previewPagePromise;
    await previewPage.waitForLoadState("domcontentloaded");
    await previewPage.bringToFront();

    // 6. 在 Preview 页面确保开启性能监控并触发导出
    await previewPage.evaluate(async () => {
      localStorage.setItem("BUG_LENS_DEBUG_PERF", "1");
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        await chrome.storage.local.set({ BUG_LENS_DEBUG_PERF: "1" });
      }
      (window as unknown as { __BUG_LENS_PERF__?: boolean }).__BUG_LENS_PERF__ =
        true;
    });

    const exportBtn = previewPage.locator("#export-btn");
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
    if (!targetPage) targetPage = await context.newPage();
    await targetPage.goto(serverUrl);
    await targetPage.bringToFront();
    await targetPage.waitForFunction(() => document.hasFocus(), undefined, {
      timeout: 2_000,
    });

    // 2. 开启性能监控开关
    await targetPage.evaluate(async () => {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        await chrome.storage.local.set({ BUG_LENS_DEBUG_PERF: "1" });
      }
      (window as unknown as { __BUG_LENS_PERF__?: boolean }).__BUG_LENS_PERF__ =
        true;
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
    await expect(targetPage.locator("#click-output")).toHaveText(
      "普通点击 1 完成"
    );
    await delay(500);

    // 5. 直接点击悬浮条上的停止按钮（触发静默导出，不打开预览页）
    const stopBtn = targetPage.locator("#__wbr_stop_btn__");
    await expect(stopBtn).toBeVisible();

    const downloadPromise = targetPage
      .waitForEvent("download", {
        timeout: 15_000,
      })
      .catch(() => null);

    await stopBtn.click();
    await downloadPromise;

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
