import { test, expect } from "./fixtures/extension.ts";
import type { InteractionRecord } from "../src/shared/protocol.ts";
import fs from "node:fs";
import { unzipSync } from "fflate";

function logStress(message: string, details?: unknown): void {
  const suffix =
    details === undefined ? "" : ` ${JSON.stringify(details, null, 2)}`;
  console.log(
    `[Bug Lens E2E Burst Stress][${new Date().toISOString()}] ${message}${suffix}`
  );
}

test.describe("Bug Lens 突发高频压力与容灾熔断测试 (Burst Stress Suite)", () => {
  test("STRESS-BURST-001: 极限高频密集连击压测（20+次瞬时点击，验证队列防抖与无死锁排空）", async ({
    context,
    extensionId,
    openActionPopup,
    mediaProbe,
    serverUrl,
  }) => {
    logStress("STRESS-001: 启动高频密集连击压测");
    let targetPage = context.pages()[0];
    if (!targetPage) targetPage = await context.newPage();
    await targetPage.goto(serverUrl);
    await targetPage.bringToFront();

    const popup = await openActionPopup(targetPage);
    await popup.waitForSelector('[data-testid="record-panel"]');
    const targetTabId = await popup.evaluate<number | undefined>(
      "(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id)()"
    );
    expect(targetTabId).toBeTruthy();
    await popup.click('[data-testid="start-recording-btn"]');
    await popup.dispose();

    const session = await mediaProbe.waitForSession(targetTabId!, 10_000);
    await mediaProbe.waitForActive(session.id, targetTabId!, 10_000);

    await targetPage.bringToFront();
    await targetPage.waitForTimeout(300);

    const clickBtn = targetPage.locator('[data-testid="test-click-btn"]');
    logStress("开始密集高速连击 20 次");
    for (let i = 0; i < 20; i++) {
      await clickBtn.click({ force: true });
      await targetPage.waitForTimeout(40); // 模拟 ~25fps 极端密集点击
    }

    // 等待 1 秒使队列正常消化
    await targetPage.waitForTimeout(1000);

    const stopBtn = targetPage.locator("#__wbr_stop_btn__");
    await expect(stopBtn).toBeVisible({ timeout: 5000 });
    await stopBtn.click();

    const exportedDownload = await mediaProbe.waitForExportDownload(25_000);
    expect(exportedDownload.state).toBe("complete");

    const fullEvidence = await mediaProbe.persistedFullEvidence(session.id);
    logStress("高频连击落盘数据", {
      totalInteractions: fullEvidence.interactions.length,
      primaryCount: fullEvidence.session?.quality.primaryScreenshotCount,
      unavailableCount:
        fullEvidence.session?.quality.unavailableScreenshotCount,
    });

    // 核心硬性断言：无论多少次密集点击，绝不能有任何交互处于 pending 状态！
    const pendingInteractions = fullEvidence.interactions.filter(
      (i: InteractionRecord) => i.screenshot?.status === "pending"
    );
    expect(pendingInteractions.length).toBe(0);
    expect(fullEvidence.interactions.length).toBeGreaterThanOrEqual(10);
    logStress("STRESS-001 通过：无任何 pending 残留，队列与排空自洽");
  });

  test("STRESS-BURST-002: 快速交替打字与表单回车压测（防抖合并与截屏无竞态冲突）", async ({
    context,
    extensionId,
    openActionPopup,
    mediaProbe,
    serverUrl,
  }) => {
    logStress("STRESS-002: 启动快速打字与回车竞态压测");
    let targetPage = context.pages()[0];
    if (!targetPage) targetPage = await context.newPage();
    await targetPage.goto(serverUrl);
    await targetPage.bringToFront();

    const popup = await openActionPopup(targetPage);
    await popup.waitForSelector('[data-testid="record-panel"]');
    const targetTabId = await popup.evaluate<number | undefined>(
      "(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id)()"
    );
    await popup.click('[data-testid="start-recording-btn"]');
    await popup.dispose();

    const session = await mediaProbe.waitForSession(targetTabId!, 10_000);
    await mediaProbe.waitForActive(session.id, targetTabId!, 10_000);

    await targetPage.bringToFront();
    const input = targetPage.locator('[data-testid="test-text-input"]');

    // 快速进行 3 轮连续打字与回车
    for (let round = 1; round <= 3; round++) {
      await input.click();
      await input.fill(`Burst typing batch ${round}`);
      await input.press("Enter");
      await targetPage.waitForTimeout(300);
    }

    const stopBtn = targetPage.locator("#__wbr_stop_btn__");
    await expect(stopBtn).toBeVisible({ timeout: 5000 });
    await stopBtn.click();

    const exportedDownload = await mediaProbe.waitForExportDownload(25_000);
    expect(exportedDownload.state).toBe("complete");

    const fullEvidence = await mediaProbe.persistedFullEvidence(session.id);
    const pendingInteractions = fullEvidence.interactions.filter(
      (i: InteractionRecord) => i.screenshot?.status === "pending"
    );
    expect(pendingInteractions.length).toBe(0);
    logStress("STRESS-002 通过：打字会话合并与回车截屏平稳落盘");
  });

  test("STRESS-BURST-003: 截屏通道故障注入与平稳降级压测（首选 CDP 失败后瞬间降级走 captureVisibleTab）", async ({
    context,
    extensionId,
    serviceWorker,
    openActionPopup,
    mediaProbe,
    serverUrl,
  }) => {
    logStress("STRESS-003: 启动截屏通道故障注入压测");

    // 注入故障：模拟 CDP Page.captureScreenshot 抛错，同时统计 captureVisibleTab 兜底调用
    await serviceWorker.evaluate(() => {
      (globalThis as any).__fallbackCaptureCalls = 0;
      const originalCapture = chrome.tabs.captureVisibleTab.bind(chrome.tabs);
      (chrome.tabs as any).captureVisibleTab = function (...args: any[]) {
        (globalThis as any).__fallbackCaptureCalls++;
        return (originalCapture as any)(...args);
      };

      const originalSendCommand = chrome.debugger.sendCommand.bind(
        chrome.debugger
      );
      (chrome.debugger as any).sendCommand = function (
        target: chrome.debugger.DebuggerSession,
        method: string,
        params?: object
      ) {
        if (method === "Page.captureScreenshot") {
          console.warn(
            "[Fault Injection] 模拟 CDP Page.captureScreenshot 抛错"
          );
          return Promise.reject(new Error("CDP_SIMULATED_SCREENSHOT_FAILURE"));
        }
        return (originalSendCommand as any)(target, method, params);
      };
    });

    let targetPage = context.pages()[0];
    if (!targetPage) targetPage = await context.newPage();
    await targetPage.goto(serverUrl);
    await targetPage.bringToFront();

    const popup = await openActionPopup(targetPage);
    await popup.waitForSelector('[data-testid="record-panel"]');
    const targetTabId = await popup.evaluate<number | undefined>(
      "(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id)()"
    );
    await popup.click('[data-testid="start-recording-btn"]');
    await popup.dispose();

    const session = await mediaProbe.waitForSession(targetTabId!, 10_000);
    await mediaProbe.waitForActive(session.id, targetTabId!, 10_000);

    await targetPage.bringToFront();
    await targetPage.waitForTimeout(300);

    // 触发 2 次点击交互
    const clickBtn = targetPage.locator('[data-testid="test-click-btn"]');
    await clickBtn.click();
    await targetPage.waitForTimeout(400);
    await clickBtn.click();
    await targetPage.waitForTimeout(400);

    const stopBtn = targetPage.locator("#__wbr_stop_btn__");
    await expect(stopBtn).toBeVisible({ timeout: 5000 });
    await stopBtn.click();

    const exportedDownload = await mediaProbe.waitForExportDownload(25_000);
    expect(exportedDownload.state).toBe("complete");

    const fallbackCalls = await serviceWorker.evaluate(
      () => (globalThis as any).__fallbackCaptureCalls
    );
    logStress("STRESS-003 captureVisibleTab 兜底调用次数", { fallbackCalls });
    expect(fallbackCalls).toBeGreaterThanOrEqual(2);

    const fullEvidence = await mediaProbe.persistedFullEvidence(session.id);
    logStress("降级落盘数据", {
      interactionCount: fullEvidence.interactions.length,
      quality: fullEvidence.session?.quality,
      screenshotStatuses: fullEvidence.interactions.map((i) => i.screenshot),
    });

    // 核心断言：CDP 失败后必须平稳降级至 captureVisibleTab，且截图状态必须为 captured！
    expect(fullEvidence.interactions.length).toBeGreaterThanOrEqual(2);
    for (const item of fullEvidence.interactions) {
      expect(item.screenshot?.status).toBe("captured");
      expect(item.screenshot?.assetId).toBeTruthy();
    }
    logStress(
      "STRESS-003 通过：CDP 故障后成功平稳降级至 captureVisibleTab 并产出有效截图"
    );
  });

  test("STRESS-BURST-004: 极速启停竞态压测（启动后瞬时停止，验证在途任务收敛无孤儿状态）", async ({
    context,
    extensionId,
    openActionPopup,
    mediaProbe,
    serverUrl,
  }) => {
    logStress("STRESS-004: 启动极速启停竞态压测");
    let targetPage = context.pages()[0];
    if (!targetPage) targetPage = await context.newPage();
    await targetPage.goto(serverUrl);
    await targetPage.bringToFront();

    const popup = await openActionPopup(targetPage);
    await popup.waitForSelector('[data-testid="record-panel"]');
    const targetTabId = await popup.evaluate<number | undefined>(
      "(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id)()"
    );
    await popup.click('[data-testid="start-recording-btn"]');
    await popup.dispose();

    const session = await mediaProbe.waitForSession(targetTabId!, 10_000);
    await mediaProbe.waitForActive(session.id, targetTabId!, 10_000);

    await targetPage.bringToFront();
    // 立即产生 1 次点击，紧接着瞬间停止（不给队列喘息时间，制造在途截断竞态）
    const clickBtn = targetPage.locator('[data-testid="test-click-btn"]');
    await clickBtn.click({ force: true });

    const stopBtn = targetPage.locator("#__wbr_stop_btn__");
    await expect(stopBtn).toBeVisible({ timeout: 5000 });
    await stopBtn.click();

    const exportedDownload = await mediaProbe.waitForExportDownload(25_000);
    expect(exportedDownload.state).toBe("complete");

    const fullEvidence = await mediaProbe.persistedFullEvidence(session.id);
    const pendingInteractions = fullEvidence.interactions.filter(
      (i: InteractionRecord) => i.screenshot?.status === "pending"
    );

    // 状态必须要么是 captured，要么已收敛为 unavailable，绝对不能是 pending！
    expect(pendingInteractions.length).toBe(0);
    for (const item of fullEvidence.interactions) {
      expect(["captured", "unavailable"]).toContain(item.screenshot?.status);
    }
    logStress("STRESS-004 通过：极速启停竞态下在途任务 100% 收敛完毕");
  });
});
