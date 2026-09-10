import { test, expect } from "./fixtures/extension.ts";
import type { InteractionRecord } from "../src/shared/protocol.ts";
import fs from "node:fs";
import { unzipSync } from "fflate";

function logE2e(message: string, details?: unknown): void {
  const suffix =
    details === undefined ? "" : ` ${JSON.stringify(details, null, 2)}`;
  console.log(
    `[Bug Lens E2E Bing Reproduce][${new Date().toISOString()}] ${message}${suffix}`
  );
}

test.describe("Bug Lens 真实用户 Bing 搜索交互截图复现测试", () => {
  test("REPRO-BING-001 @slow: 真实 Bing 搜索表单提交与全套交互链路，检测截图状态与 CDP 原生时序", async ({
    context,
    extensionId,
    serviceWorker,
    openActionPopup,
    mediaProbe,
  }) => {
    const bingUrl = "https://www.bing.com";
    logE2e("Step 0: 访问 Bing 首页", { url: bingUrl });

    // 1. 在 Service Worker 中安装原生无侵入探针，记录真实的 CDP 截屏与命令调用详情（绝不人为挂起）
    await serviceWorker.evaluate(() => {
      const originalSendCommand = chrome.debugger.sendCommand.bind(
        chrome.debugger
      );
      (self as any).__CDP_SPY_LOGS__ = [] as Array<{
        method: string;
        start: number;
        durationMs?: number;
        ok?: boolean;
        hasData?: boolean;
        error?: string;
      }>;

      (chrome.debugger as any).sendCommand = async function (
        target: chrome.debugger.DebuggerSession,
        method: string,
        params?: object
      ) {
        const start = Date.now();
        const entry: any = { method, start };
        (self as any).__CDP_SPY_LOGS__.push(entry);
        try {
          const res = await (originalSendCommand as any)(
            target,
            method,
            params
          );
          entry.durationMs = Date.now() - start;
          entry.ok = true;
          entry.hasData = Boolean(res?.data);
          return res;
        } catch (err) {
          entry.durationMs = Date.now() - start;
          entry.ok = false;
          entry.error = String(err);
          throw err;
        }
      };
    });

    let targetPage = context.pages()[0];
    if (!targetPage) targetPage = await context.newPage();

    let isBingReachable = true;
    try {
      const response = await targetPage.goto(bingUrl, {
        waitUntil: "domcontentloaded",
        timeout: 15_000,
      });
      if (response && response.status() >= 400) {
        isBingReachable = false;
      }
    } catch (err) {
      logE2e("Bing 首页无法访问，网络不可达", { error: String(err) });
      isBingReachable = false;
    }

    if (!isBingReachable) {
      test.skip(true, "当前网络无法访问 Bing，跳过在线测试");
      return;
    }

    await targetPage.bringToFront();
    await targetPage.waitForTimeout(1000);

    // 2. 打开 Action Popup 启动录制
    logE2e("Step 1: 打开 Popup 启动录制");
    const startPopup = await openActionPopup(targetPage);
    await startPopup.waitForSelector('[data-testid="record-panel"]');

    const targetTabId = await startPopup.evaluate<number | undefined>(
      "(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id)()"
    );
    expect(targetTabId).toBeTruthy();

    await startPopup.click('[data-testid="start-recording-btn"]');
    await startPopup.dispose();

    const session = await mediaProbe.waitForSession(targetTabId!, 15_000);
    await mediaProbe.waitForActive(session.id, targetTabId!, 15_000);
    logE2e("录制会话已激活", { sessionId: session.id, targetTabId });

    await targetPage.bringToFront();
    await targetPage.waitForTimeout(800);

    // 3. 执行真实 Bing 搜索交互链路（表单输入、回车提交、跨页面导航、二次搜索）
    const searchInput = targetPage
      .locator('#sb_form_q, textarea[name="q"], input[name="q"]')
      .first();
    await expect(searchInput).toBeVisible({ timeout: 10_000 });

    // 交互 1: 点击输入框
    logE2e("交互 1: 点击 Bing 搜索输入框");
    await searchInput.click({ force: true });
    await targetPage.waitForTimeout(500);

    // 交互 2: 输入搜索词
    const text1 = "今天上海的天气";
    logE2e("交互 2: 输入搜索关键词", { text: text1 });
    await searchInput.fill(text1);
    await targetPage.waitForTimeout(600);

    // 交互 3: 按下 Enter 提交表单（触发页面跨文档导航至 Bing 搜索结果页）
    logE2e("交互 3: 回车提交搜索表单");
    await searchInput.press("Enter");

    // 交互 4 (导航): 等待搜索结果页导航加载完成
    logE2e("交互 4: 等待 Bing 搜索结果页导航加载完成");
    await targetPage
      .waitForLoadState("domcontentloaded", { timeout: 15_000 })
      .catch(() => undefined);
    await targetPage.waitForTimeout(2000);

    // 交互 5: 点击搜索结果页的主体内容
    logE2e("交互 5: 点击搜索结果页主体");
    const resultContainer = targetPage
      .locator("#b_results, #b_content, main, body")
      .first();
    if (await resultContainer.isVisible()) {
      await resultContainer.click({ force: true }).catch(() => undefined);
    }
    await targetPage.waitForTimeout(800);

    // 交互 6-8: 再次点击搜索框，修改为“今天广州的天气”，回车再次触发导航
    const secondSearchInput = targetPage
      .locator('#sb_form_q, textarea[name="q"], input[name="q"]')
      .first();
    if (await secondSearchInput.isVisible()) {
      logE2e("交互 6: 再次点击搜索框");
      await secondSearchInput.click({ force: true });
      await targetPage.waitForTimeout(400);

      const text2 = "今天广州的天气";
      logE2e("交互 7: 修改输入为新关键词", { text: text2 });
      await secondSearchInput.fill(text2);
      await targetPage.waitForTimeout(600);

      logE2e("交互 8: 再次回车提交搜索");
      await secondSearchInput.press("Enter");
      await targetPage
        .waitForLoadState("domcontentloaded", { timeout: 15_000 })
        .catch(() => undefined);
      await targetPage.waitForTimeout(2000);
    }

    // 交互 9: 结果页再次点击
    if (await resultContainer.isVisible()) {
      await resultContainer.click({ force: true }).catch(() => undefined);
      await targetPage.waitForTimeout(500);
    }

    // 4. 停止录制
    logE2e("Step 4: 停止录制并导出证据包");
    await targetPage.bringToFront();
    const stopButton = targetPage.locator("#__wbr_stop_btn__");
    await expect(stopButton).toBeVisible({ timeout: 10_000 });
    await stopButton.click();

    const exportedDownload = await mediaProbe.waitForExportDownload(30_000);
    expect(exportedDownload.state).toBe("complete");
    logE2e("证据包导出下载完成", { filename: exportedDownload.filename });

    // 5. 提取 Service Worker 捕获的真实原生 CDP 调用探针日志
    const cdpLogs = await serviceWorker.evaluate(
      () => (self as any).__CDP_SPY_LOGS__
    );
    const screenshotCdpCalls = cdpLogs.filter(
      (l: any) => l.method === "Page.captureScreenshot"
    );
    logE2e("原生 CDP Page.captureScreenshot 探针详情", {
      totalCdpCalls: cdpLogs.length,
      screenshotCallsCount: screenshotCdpCalls.length,
      screenshotCalls: screenshotCdpCalls,
    });

    // 6. 深度收集落盘数据与截图状态现场
    const fullEvidence = await mediaProbe.persistedFullEvidence(session.id);
    const screenshotStatusList = fullEvidence.interactions.map(
      (i: InteractionRecord, idx: number) => ({
        step: idx + 1,
        kind: i.kind,
        element: i.element?.tagName,
        status: i.status,
        screenshotStatus: i.screenshot?.status,
        screenshotSource: i.screenshot?.source,
        assetId: i.screenshot?.assetId,
      })
    );

    logE2e("落盘交互与截图状态详情", {
      quality: fullEvidence.session?.quality,
      interactionCount: fullEvidence.interactions.length,
      screenshotStatusList,
      assetsCount: fullEvidence.evidenceAssets.length,
      assetKinds: fullEvidence.evidenceAssets.map((a) => a.kind),
    });

    const pendingInteractions = fullEvidence.interactions.filter(
      (i: InteractionRecord) => i.screenshot?.status === "pending"
    );
    const capturedInteractions = fullEvidence.interactions.filter(
      (i: InteractionRecord) => i.screenshot?.status === "captured"
    );
    const unavailableInteractions = fullEvidence.interactions.filter(
      (i: InteractionRecord) => i.screenshot?.status === "unavailable"
    );

    logE2e("截图状态统计结果", {
      total: fullEvidence.interactions.length,
      pendingCount: pendingInteractions.length,
      capturedCount: capturedInteractions.length,
      unavailableCount: unavailableInteractions.length,
    });

    // 7. 解压导出的 ZIP 包验证
    if (exportedDownload.filename && fs.existsSync(exportedDownload.filename)) {
      const zipBuffer = fs.readFileSync(exportedDownload.filename);
      const unzipped = unzipSync(new Uint8Array(zipBuffer));
      const zipFiles = Object.keys(unzipped);

      const stepImageFiles = zipFiles.filter((f) =>
        f.startsWith("screenshots/step-")
      );
      logE2e("导出的 ZIP 包文件检查", {
        fileCount: zipFiles.length,
        stepImageFilesCount: stepImageFiles.length,
        stepImageFiles,
      });

      const sessionDataCode = new TextDecoder().decode(
        unzipped["data/session-data.js"]
      );
      const summaryMatch = sessionDataCode.match(/"interactions":\s*\{[^}]+\}/);
      logE2e("session-data summary 交互摘要", {
        snippet: summaryMatch ? summaryMatch[0] : "none",
      });
      expect(sessionDataCode).not.toMatch(/"status":\s*"pending"/);
    }

    // 8. 验证预览页面 UI 表现
    const previewPage = await context.newPage();
    await previewPage.goto(
      `chrome-extension://${extensionId}/preview.html?sessionId=${session.id}`
    );
    await previewPage.waitForLoadState("domcontentloaded");
    logE2e("预览页面已加载");

    const stepsTab = previewPage.locator('.zen-tab-btn[data-tab="steps"]');
    if (await stepsTab.isVisible()) {
      await stepsTab.click();
    }
    await previewPage.waitForSelector(".grouped-card", { timeout: 10_000 });

    const stepThumbnails = previewPage.locator("img.step-shot");
    const thumbCount = await stepThumbnails.count();
    const pendingBadges = previewPage.locator(".badge:has-text('pending')");
    const pendingBadgeCount = await pendingBadges.count();

    logE2e("预览页面 UI 现场", {
      cardCount: await previewPage.locator(".grouped-card").count(),
      thumbnailImgCount: thumbCount,
      pendingBadgeCount,
    });

    // 断言交互截图绝不残留 pending，且预览页无 pending 徽标
    expect(pendingInteractions.length).toBe(0);
    expect(pendingBadgeCount).toBe(0);

    // 综合判定问题是否存在
    const hasPendingIssue = pendingInteractions.length > 0;
    logE2e("=== Bing 真实测试执行结论 ===", {
      hasPendingIssue,
      pendingInteractionsCount: pendingInteractions.length,
      capturedCount: capturedInteractions.length,
      unavailableCount: unavailableInteractions.length,
      detail: hasPendingIssue
        ? "发现截屏停留为 pending 状态！问题真实存在并复现！"
        : "在当前 Playwright 环境下截屏未挂起，全部成功 captured",
    });
  });

  test("REPRO-CDP-TIMEOUT-002: 底层 CDP 截屏挂起时，通道平稳超时降级至 captureVisibleTab，队列不阻塞且不残留 pending", async ({
    context,
    extensionId,
    serviceWorker,
    openActionPopup,
    mediaProbe,
  }) => {
    let targetPage = context.pages()[0];
    if (!targetPage) targetPage = await context.newPage();

    try {
      await targetPage.goto("https://www.bing.com", {
        waitUntil: "domcontentloaded",
        timeout: 15_000,
      });
    } catch {
      test.skip(true, "当前网络无法访问 Bing，跳过在线测试");
      return;
    }

    // 在 Service Worker 中安装探针：使 CDP Page.captureScreenshot 永久挂起
    await serviceWorker.evaluate(() => {
      const originalSendCommand = chrome.debugger.sendCommand.bind(
        chrome.debugger
      );
      (chrome.debugger as any).sendCommand = async function (
        target: chrome.debugger.DebuggerSession,
        method: string,
        params?: object
      ) {
        if (method === "Page.captureScreenshot") {
          return new Promise(() => {}); // 模拟底层 CDP 挂起
        }
        return (originalSendCommand as any)(target, method, params);
      };
    });

    await targetPage.bringToFront();
    await targetPage.waitForTimeout(500);

    const startPopup = await openActionPopup(targetPage);
    await startPopup.waitForSelector('[data-testid="record-panel"]');
    const targetTabId = await startPopup.evaluate<number | undefined>(
      "(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id)()"
    );
    expect(targetTabId).toBeTruthy();
    await startPopup.click('[data-testid="start-recording-btn"]');
    await startPopup.dispose();

    const session = await mediaProbe.waitForSession(targetTabId!, 15_000);
    await mediaProbe.waitForActive(session.id, targetTabId!, 15_000);

    await targetPage.bringToFront();
    await targetPage.waitForTimeout(600);

    const searchInput = targetPage
      .locator('#sb_form_q, textarea[name="q"], input[name="q"]')
      .first();
    if (await searchInput.isVisible()) {
      await searchInput.click({ force: true });
      await targetPage.waitForTimeout(1300); // 等待 1000ms 超时降级至 captureVisibleTab
      await searchInput.fill("Bug Lens 超时降级验证");
      await targetPage.waitForTimeout(1300);
    }

    const stopButton = targetPage.locator("#__wbr_stop_btn__");
    await expect(stopButton).toBeVisible({ timeout: 10_000 });
    await stopButton.click();

    const exportedDownload = await mediaProbe.waitForExportDownload(30_000);
    expect(exportedDownload.state).toBe("complete");

    const fullEvidence = await mediaProbe.persistedFullEvidence(session.id);
    console.log(
      "REPRO-CDP-TIMEOUT-002 all interactions:",
      JSON.stringify(
        fullEvidence.interactions.map((i) => ({
          id: i.id,
          kind: i.kind,
          status: i.status,
          screenshot: i.screenshot,
          element: i.element?.tagName,
        })),
        null,
        2
      )
    );
    const pendingList = fullEvidence.interactions.filter(
      (i: InteractionRecord) => i.screenshot?.status === "pending"
    );
    expect(pendingList.length).toBe(0);

    if (exportedDownload.filename && fs.existsSync(exportedDownload.filename)) {
      const zipBuffer = fs.readFileSync(exportedDownload.filename);
      const unzipped = unzipSync(new Uint8Array(zipBuffer));
      if (unzipped["data/session-data.js"]) {
        const sessionDataCode = new TextDecoder().decode(
          unzipped["data/session-data.js"]
        );
        expect(sessionDataCode).not.toMatch(/"status":\s*"pending"/);
      }
    }

    const previewPage = await context.newPage();
    await previewPage.goto(
      `chrome-extension://${extensionId}/preview.html?sessionId=${session.id}`
    );
    await previewPage.waitForLoadState("domcontentloaded");
    const stepsTab = previewPage.locator('.zen-tab-btn[data-tab="steps"]');
    if (await stepsTab.isVisible()) {
      await stepsTab.click();
    }
    const pendingBadges = previewPage.locator(".badge:has-text('pending')");
    expect(await pendingBadges.count()).toBe(0);
  });
});
