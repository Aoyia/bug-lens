import { test, expect } from "./fixtures/extension.ts";
import type { InteractionRecord } from "../src/shared/protocol.ts";
import fs from "node:fs";
import { unzipSync } from "fflate";

function logSmoke(message: string, details?: unknown): void {
  const suffix =
    details === undefined ? "" : ` ${JSON.stringify(details, null, 2)}`;
  console.log(
    `[Bug Lens E2E Smoke][${new Date().toISOString()}] ${message}${suffix}`
  );
}

test.describe("Bug Lens 核心功能极速冒烟测试 (Smoke Suite)", () => {
  test("SMOKE-001: 极速黄金主旅程验证（唤起录制 -> 交互与截屏 -> 停止导出 -> 质量与资产完整性）", async ({
    context,
    extensionId,
    openActionPopup,
    mediaProbe,
    serverUrl,
  }) => {
    const startTime = Date.now();
    logSmoke("Step 1: 打开本地 Mock 测试页面", { serverUrl });

    let targetPage = context.pages()[0];
    if (!targetPage) targetPage = await context.newPage();
    await targetPage.goto(serverUrl);
    await targetPage.bringToFront();
    await targetPage.waitForFunction(() => document.hasFocus(), undefined, {
      timeout: 2000,
    });

    // 1. 唤起 Action Popup 并开启录制
    logSmoke("Step 2: 唤起 Popup 启动录制");
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
    logSmoke("录制已激活", { sessionId: session.id });

    // 2. 执行核心操作链路：1 次按钮点击 + 1 次文本输入
    await targetPage.bringToFront();
    await targetPage.waitForTimeout(300);

    logSmoke("Step 3: 执行核心交互（点击 + 输入）");
    const clickBtn = targetPage.locator('[data-testid="test-click-btn"]');
    await clickBtn.click();
    await targetPage.waitForTimeout(400);

    const textInput = targetPage.locator('[data-testid="test-text-input"]');
    await textInput.fill("Bug Lens Smoke Test 2026");
    await textInput.press("Enter");

    // 等待在途截屏完成落盘，确保质量状态达到 complete
    await expect
      .poll(
        async () => {
          const evidence = await mediaProbe.persistedFullEvidence(session.id);
          return (
            evidence.interactions.length >= 2 &&
            evidence.interactions.every(
              (i) => i.screenshot?.status === "captured"
            )
          );
        },
        { timeout: 8000 }
      )
      .toBe(true);

    // 3. 点击录制悬浮控件停止并导出
    logSmoke("Step 4: 点击停止按钮完成录制与导出");
    const stopBtn = targetPage.locator("#__wbr_stop_btn__");
    await expect(stopBtn).toBeVisible({ timeout: 5000 });
    await stopBtn.click();

    const exportedDownload = await mediaProbe.waitForExportDownload(20_000);
    expect(exportedDownload.state).toBe("complete");
    expect(exportedDownload.totalBytes ?? 0).toBeGreaterThan(0);
    logSmoke("导出下载完成", {
      filename: exportedDownload.filename,
      size: exportedDownload.totalBytes,
    });

    // 4. 深度验证落盘数据契约
    const fullEvidence = await mediaProbe.persistedFullEvidence(session.id);
    expect(fullEvidence.interactions.length).toBeGreaterThanOrEqual(2);
    expect(fullEvidence.session?.quality.overall).toBe("complete");

    // 状态硬性断言：所有交互必须全部 captured，绝对不允许残留 pending 状态
    for (const item of fullEvidence.interactions) {
      expect(item.screenshot?.status).toBe("captured");
      expect(item.screenshot?.assetId).toBeTruthy();
    }
    expect(
      fullEvidence.session?.quality.primaryScreenshotCount
    ).toBeGreaterThanOrEqual(2);
    expect(fullEvidence.session?.quality.unavailableScreenshotCount).toBe(0);

    // 5. 验证导出的 ZIP 包物理文件完整性
    if (exportedDownload.filename && fs.existsSync(exportedDownload.filename)) {
      const zipBuffer = fs.readFileSync(exportedDownload.filename);
      const unzipped = unzipSync(new Uint8Array(zipBuffer));
      const zipFiles = Object.keys(unzipped);

      expect(zipFiles).toContain("manifest.json");
      expect(zipFiles).toContain("data/session-data.js");
      expect(zipFiles).toContain("data/network-details.js");
      expect(zipFiles).toContain("media/recording.mp4");

      const stepShots = zipFiles.filter((f) =>
        f.startsWith("screenshots/step-")
      );
      expect(stepShots.length).toBeGreaterThanOrEqual(2);

      const sessionDataCode = new TextDecoder().decode(
        unzipped["data/session-data.js"]
      );
      expect(sessionDataCode).not.toContain('"status": "pending"');
    }

    // 6. 验证预览页面 UI 正确渲染
    const previewPage = await context.newPage();
    await previewPage.goto(
      `chrome-extension://${extensionId}/preview.html?sessionId=${session.id}`
    );
    await previewPage.waitForLoadState("domcontentloaded");

    const stepsTab = previewPage.locator('.zen-tab-btn[data-tab="steps"]');
    if (await stepsTab.isVisible()) {
      await stepsTab.click();
    }
    await previewPage.waitForSelector(".grouped-card", { timeout: 8000 });

    const thumbnails = previewPage.locator("img.step-shot");
    expect(await thumbnails.count()).toBeGreaterThanOrEqual(1);

    const pendingBadges = previewPage.locator(".badge:has-text('pending')");
    expect(await pendingBadges.count()).toBe(0);

    const totalElapsedMs = Date.now() - startTime;
    logSmoke(
      `SMOKE-001 冒烟测试全链路通过，总耗时: ${(totalElapsedMs / 1000).toFixed(1)}s`
    );
    expect(totalElapsedMs).toBeLessThan(30_000);
  });
});
