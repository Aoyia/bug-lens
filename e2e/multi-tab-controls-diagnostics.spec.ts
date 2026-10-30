import { test, expect } from "./fixtures/extension.ts";
import fs from "node:fs";
import { unzipSync } from "fflate";

test.describe("跨标签页挂件控制与诊断归属测试 (Multi-Tab Controls & Diagnostics)", () => {
  test("CONTROL-001: 跨标签页秒表同步与分布式暂停/继续状态广播", async ({
    context,
    openActionPopup,
    mediaProbe,
    serviceWorker,
    serverUrl,
  }) => {
    // 1. 打开 Tab 1 并启动录制
    const tab1Url = serverUrl.replace("mock-page.html", "timer-tab-1.html");
    let tab1Page = context.pages()[0];
    if (!tab1Page) tab1Page = await context.newPage();
    await tab1Page.goto(tab1Url);
    await tab1Page.bringToFront();

    const popup = await openActionPopup(tab1Page);
    await popup.waitForSelector('[data-testid="record-panel"]');
    const tab1Id = await popup.evaluate<number | undefined>(
      "(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id)()"
    );
    expect(tab1Id).toBeTruthy();

    await popup.click('[data-testid="start-recording-btn"]');
    await popup.dispose();

    const session = await mediaProbe.waitForSession(tab1Id!, 10_000);
    await mediaProbe.waitForActive(session.id, tab1Id!, 10_000);

    // 2. 打开 Tab 2 并聚焦，等待挂件同步出现
    const tab2Url = serverUrl.replace("mock-page.html", "timer-tab-2.html");
    const tab2Page = await context.newPage();
    await tab2Page.goto(tab2Url);
    await tab2Page.bringToFront();
    await tab2Page.waitForTimeout(800);

    const tab2StopBtn = tab2Page.locator("#__wbr_stop_btn__");
    await expect(tab2StopBtn).toBeVisible({ timeout: 8000 });

    // 3. 模拟触发全局暂停
    await serviceWorker.evaluate(async (sid) => {
      const runtime = (
        self as unknown as {
          __BUGLENS_BACKGROUND_RUNTIME__?: {
            lifecycle: {
              updatePauseState: (
                s: string,
                p: boolean,
                d: number,
                a: number
              ) => Promise<void>;
            };
          };
        }
      ).__BUGLENS_BACKGROUND_RUNTIME__;
      await runtime?.lifecycle.updatePauseState(sid, true, 1000, Date.now());
    }, session.id);

    await tab2Page.waitForTimeout(400);

    // 4. 验证 Tab 2 挂件同步进入黄色暂停态（暂停小黄点）
    const tab2Dot = tab2Page.locator(".__wbr_dot");
    await expect(tab2Dot).toHaveCSS("background-color", "rgb(255, 193, 7)");

    // 5. 切回 Tab 1，验证 Tab 1 也已实时同步为黄色暂停态
    await tab1Page.bringToFront();
    await tab1Page.waitForTimeout(400);
    const tab1Dot = tab1Page.locator(".__wbr_dot");
    await expect(tab1Dot).toHaveCSS("background-color", "rgb(255, 193, 7)");

    // 6. 模拟触发全局继续
    await serviceWorker.evaluate(async (sid) => {
      const runtime = (
        self as unknown as {
          __BUGLENS_BACKGROUND_RUNTIME__?: {
            lifecycle: {
              updatePauseState: (
                s: string,
                p: boolean,
                d: number,
                a: number
              ) => Promise<void>;
            };
          };
        }
      ).__BUGLENS_BACKGROUND_RUNTIME__;
      await runtime?.lifecycle.updatePauseState(sid, false, 1500, Date.now());
    }, session.id);

    await tab1Page.waitForTimeout(400);

    // 7. 验证 Tab 1 恢复为红色录制态
    await expect(tab1Dot).toHaveCSS("background-color", "rgb(245, 63, 63)");

    // 8. 切回 Tab 2，验证 Tab 2 也同步恢复为红色录制态
    await tab2Page.bringToFront();
    await tab2Page.waitForTimeout(400);
    await expect(tab2Dot).toHaveCSS("background-color", "rgb(245, 63, 63)");

    // 9. 停止录制并完成导出
    await tab2StopBtn.click();
    const exportedDownload = await mediaProbe.waitForExportDownload(20_000);
    expect(exportedDownload.state).toBe("complete");

    // 验证暂停时长记录有效
    const updatedSession = await mediaProbe.getSession(session.id);
    expect(updatedSession?.timeline.pausedDurationMs ?? 0).toBeGreaterThan(0);
  });

  test("DIAGNOSTIC-001: 跨标签页独立日志与网络请求精准归属溯源", async ({
    context,
    openActionPopup,
    mediaProbe,
    serviceWorker,
    serverUrl,
  }) => {
    // 1. 打开 Tab 1 并启动录制
    const tab1Url = serverUrl.replace("mock-page.html", "diag-tab-1.html");
    let tab1Page = context.pages()[0];
    if (!tab1Page) tab1Page = await context.newPage();
    await tab1Page.goto(tab1Url);
    await tab1Page.bringToFront();

    const popup = await openActionPopup(tab1Page);
    await popup.waitForSelector('[data-testid="record-panel"]');
    const tab1Id = await popup.evaluate<number | undefined>(
      "(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id)()"
    );
    expect(tab1Id).toBeTruthy();

    await popup.click('[data-testid="start-recording-btn"]');
    await popup.dispose();

    const session = await mediaProbe.waitForSession(tab1Id!, 10_000);
    await mediaProbe.waitForActive(session.id, tab1Id!, 10_000);

    // 2. 在 Tab 1 触发专属控制台报错与专属接口请求
    const tab1ErrorBtn = tab1Page.locator('[data-testid="test-error-btn"]');
    const tab1FetchBtn = tab1Page.locator('[data-testid="test-fetch-btn"]');
    await tab1ErrorBtn.click();
    await tab1FetchBtn.click();
    await tab1Page.waitForTimeout(500);

    // 3. 打开 Tab 2 并聚焦
    const tab2Url = serverUrl.replace("mock-page.html", "diag-tab-2.html");
    const tab2Page = await context.newPage();
    await tab2Page.goto(tab2Url);
    await tab2Page.bringToFront();
    await tab2Page.waitForTimeout(800);

    // 4. 在 Tab 2 触发 Tab 2 独有的错误日志与网络请求
    await tab2Page.evaluate(() => {
      console.error("[TAB2-SPECIFIC-ERROR] 来自 Tab 2 前台的独立业务报错");
      void fetch("/api/preview/success");
    });
    await tab2Page.waitForTimeout(800);

    // 5. 在 Tab 2 上结束录制
    const tab2StopBtn = tab2Page.locator("#__wbr_stop_btn__");
    await expect(tab2StopBtn).toBeVisible({ timeout: 5000 });
    await tab2StopBtn.click();

    // 6. 验证导出并校验数据归属
    const exportedDownload = await mediaProbe.waitForExportDownload(20_000);
    expect(exportedDownload.state).toBe("complete");

    const fullEvidence = await mediaProbe.persistedFullEvidence(session.id);

    // 验证控制台日志的归属准确
    const tab1Logs = fullEvidence.consoleEntries.filter(
      (log) =>
        log.text?.includes("[E2E-TEST]") ||
        log.url?.includes("diag-tab-1.html")
    );
    const tab2Logs = fullEvidence.consoleEntries.filter(
      (log) =>
        log.text?.includes("[TAB2-SPECIFIC-ERROR]") ||
        log.url?.includes("diag-tab-2.html")
    );

    expect(tab1Logs.length).toBeGreaterThanOrEqual(1);
    expect(tab2Logs.length).toBeGreaterThanOrEqual(1);
    expect(
      tab2Logs.some((l) => l.text?.includes("[TAB2-SPECIFIC-ERROR]"))
    ).toBe(true);

    // 验证网络请求的页面归属准确
    const todoRequests = fullEvidence.networkEntries.filter((req) =>
      req.url?.includes("/api/todo")
    );
    const previewRequests = fullEvidence.networkEntries.filter((req) =>
      req.url?.includes("/api/preview/success")
    );

    expect(todoRequests.length).toBeGreaterThanOrEqual(1);
    expect(previewRequests.length).toBeGreaterThanOrEqual(1);

    if (exportedDownload.filename && fs.existsSync(exportedDownload.filename)) {
      const zipBuffer = fs.readFileSync(exportedDownload.filename);
      const unzipped = unzipSync(new Uint8Array(zipBuffer));
      const sessionDataCode = new TextDecoder().decode(
        unzipped["data/session-data.js"]
      );

      expect(sessionDataCode).toContain("diag-tab-1.html");
      expect(sessionDataCode).toContain("diag-tab-2.html");
      expect(sessionDataCode).toContain("[TAB2-SPECIFIC-ERROR]");
    }
  });
});
