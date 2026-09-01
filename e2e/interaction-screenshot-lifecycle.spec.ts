import { test, expect } from "./fixtures/extension.ts";
import fs from "node:fs";
import { unzipSync } from "fflate";

function logE2e(message: string, details?: unknown): void {
  const suffix = details === undefined ? "" : ` ${JSON.stringify(details)}`;
  console.log(
    `[Bug Lens E2E][${new Date().toISOString()}] ${message}${suffix}`
  );
}

test.describe("Bug Lens Chrome Extension E2E: Interaction Screenshot Lifecycle & Timeline", () => {
  test("SHOT-001: records interaction screenshots, persists assets, renders timeline thumbnails and verifies zero data loss", async ({
    context,
    extensionId,
    openActionPopup,
    mediaProbe,
    serverUrl,
  }) => {
    const scenarioId = "SHOT-001";
    logE2e(`${scenarioId}: Starting interaction screenshot lifecycle test`);

    const previewPageUrl = serverUrl.replace(
      "mock-page.html",
      "preview-page.html"
    );

    // 1. 打开被测页面
    let targetPage = context.pages()[0];
    if (!targetPage) targetPage = await context.newPage();
    await targetPage.goto(previewPageUrl);
    logE2e(`${scenarioId}: Target page loaded`, { url: targetPage.url() });

    await targetPage.bringToFront();
    await targetPage.waitForFunction(() => document.hasFocus(), undefined, {
      timeout: 2_000,
    });

    // 2. 通过 Action Popup 开启录制（默认开启 captureScreenshots: true）
    const popup = await openActionPopup(targetPage);
    await popup.waitForSelector('[data-testid="record-panel"]');

    const targetTabId = await popup.evaluate<number | undefined>(
      "(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id)()"
    );
    expect(targetTabId).toBeTruthy();

    await popup.click('[data-testid="start-recording-btn"]');
    await popup.dispose();

    const session = await mediaProbe.waitForSession(targetTabId!);
    await mediaProbe.waitForActive(session.id, targetTabId!);
    logE2e(`${scenarioId}: Recording is active with screenshots enabled`, {
      sessionId: session.id,
    });

    // 3. 执行受控测试动作（保证交互与截图正常产生）
    await targetPage.bringToFront();
    await targetPage.waitForFunction(() => document.hasFocus(), undefined, {
      timeout: 2_000,
    });

    // 动作 1：点击普通按钮
    await targetPage.click('[data-testid="normal-btn"]');
    await expect(
      targetPage.locator('[data-testid="action-status"]')
    ).toHaveText("普通点击 1 完成");
    logE2e(`${scenarioId}: Clicked normal-btn`);
    await targetPage.waitForTimeout(300);

    // 动作 2：点击网络请求按钮
    await targetPage.click('[data-testid="btn-net-success"]');
    await expect(
      targetPage.locator('[data-testid="action-status"]')
    ).toContainText("Success Net 完成");
    logE2e(`${scenarioId}: Clicked btn-net-success`);

    // 等待交互证据、截图完成与媒体分片完全落库
    await mediaProbe.waitForEvidenceCounts(session.id, {
      interactionCount: 2,
    });
    // 确保所有在途截图均已完成（非 pending 状态）
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const full = await mediaProbe.persistedFullEvidence(session.id);
      if (
        full.interactions.length >= 2 &&
        full.interactions.every((i) => i.screenshot.status !== "pending")
      ) {
        break;
      }
      await targetPage.waitForTimeout(100);
    }
    await mediaProbe.waitForMediaChunkCountGreaterThan(session.id, 0, 5_000);

    // 4. 停止录制并完成静默导出
    const stopButton = targetPage.locator("#__wbr_stop_btn__");
    await expect(stopButton).toBeVisible();
    await stopButton.click();

    const exportedDownload = await mediaProbe.waitForExportDownload();
    expect(exportedDownload.state).toBe("complete");
    expect(exportedDownload.totalBytes ?? 0).toBeGreaterThan(0);
    logE2e(`${scenarioId}: Export downloaded`, {
      filename: exportedDownload.filename,
    });

    // 5. 打开预览页验证元数据与时间轴
    const previewPage = await context.newPage();
    await previewPage.goto(
      `chrome-extension://${extensionId}/preview.html?sessionId=${session.id}`
    );
    await previewPage.waitForLoadState("domcontentloaded");

    const evidence = await mediaProbe.persistedEvidence(session.id);

    logE2e(`${scenarioId}: Persisted evidence loaded`, {
      quality: evidence.session?.quality,
      interactions: evidence.interactions.map((i) => ({
        kind: i.kind,
        status: i.status,
        screenshot: i.screenshot,
      })),
    });

    // --- 断言 A：元数据与质量大盘 ---
    expect(evidence.session?.status).toBe("PREVIEW_READY");
    expect(evidence.session?.quality.overall).toBe("complete");
    expect(evidence.session?.quality.unavailableScreenshotCount).toBe(0);
    expect(
      evidence.session?.quality.primaryScreenshotCount
    ).toBeGreaterThanOrEqual(1);

    // --- 断言 B：每条已确认交互均具备 captured 截图与 assetId ---
    expect(evidence.interactionCount).toBeGreaterThanOrEqual(2);
    for (const interaction of evidence.interactions) {
      expect(interaction.screenshot.status).toBe("captured");
      expect(interaction.screenshot.assetId).toBeTruthy();
    }

    // --- 断言 C：资产库包含非空截图图片 ---
    const screenshotAssets = evidence.evidenceAssets.filter(
      (asset) => asset.kind === "interaction-screenshot"
    );
    expect(screenshotAssets.length).toBeGreaterThanOrEqual(2);
    for (const asset of screenshotAssets) {
      expect(asset.byteLength).toBeGreaterThan(0);
      expect(["image/jpeg", "image/png"]).toContain(asset.mimeType);
    }

    // --- 断言 D：预览页时间轴 UI 正确渲染步骤截图缩略图 ---
    const interactionCards = previewPage.locator(".grouped-card");
    await expect(interactionCards.first()).toBeVisible({ timeout: 5_000 });

    const stepThumbnails = previewPage.locator("img.step-shot");
    const thumbCount = await stepThumbnails.count();
    expect(thumbCount).toBeGreaterThanOrEqual(1);

    const firstThumbSrc = await stepThumbnails.first().getAttribute("src");
    expect(firstThumbSrc).toMatch(/^(blob:|data:image\/)/);
    logE2e(
      `${scenarioId}: Verified step thumbnail rendering in preview timeline`
    );

    // --- 断言 E：点击步骤缩略图可唤起大图查看器 ---
    await stepThumbnails.first().click();
    const imageModal = previewPage.locator("#image-modal");
    await expect(imageModal).toBeVisible({ timeout: 3_000 });
    const modalImage = previewPage.locator("#modal-image");
    await expect(modalImage).toBeVisible();
    expect(await modalImage.getAttribute("src")).toMatch(
      /^(blob:|data:image\/)/
    );

    // 关闭查看器
    await previewPage.locator("#modal-close-btn").click();
    await expect(imageModal).toBeHidden();
    logE2e(`${scenarioId}: Image viewer modal verified`);

    // --- 断言 F：验证导出的 Zip 证据包包含步骤截图 ---
    if (exportedDownload.filename && fs.existsSync(exportedDownload.filename)) {
      const zipBuffer = fs.readFileSync(exportedDownload.filename);
      const unzipped = unzipSync(new Uint8Array(zipBuffer));
      const zipFiles = Object.keys(unzipped);

      // 检查 manifest.json 与 data/session-data.js
      expect(zipFiles).toContain("manifest.json");
      expect(zipFiles).toContain("data/session-data.js");

      // 检查 session-data.js 中的 screenshotSummaries
      const sessionDataCode = new TextDecoder().decode(
        unzipped["data/session-data.js"]
      );
      expect(sessionDataCode).toContain("screenshotSummaries");

      // 检查至少有一张图片资产或截图包含在 zip 文件清单中
      const hasImageFile = zipFiles.some(
        (f) => f.endsWith(".jpg") || f.endsWith(".png") || f.endsWith(".jpeg")
      );
      expect(hasImageFile).toBe(true);
      logE2e(`${scenarioId}: Verified zip archive contains screenshots`);
    }

    logE2e(
      `${scenarioId}: All interaction screenshot assertions passed successfully!`
    );
  });
});
