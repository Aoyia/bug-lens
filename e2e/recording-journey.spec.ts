import { test, expect } from "./fixtures/extension.ts";

function envMilliseconds(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function logE2e(message: string, details?: unknown): void {
  const suffix = details === undefined ? "" : ` ${JSON.stringify(details)}`;
  console.log(`[Bug Lens E2E][${new Date().toISOString()}] ${message}${suffix}`);
}

const previewHoldMs = envMilliseconds("E2E_PREVIEW_HOLD_MS", process.env.CI ? 0 : 8_000);

test.describe("Bug Lens Chrome Extension E2E User Journey", () => {
  test("REC-001: records the active tab through a trusted extension invocation", async ({
    context,
    extensionId,
    openActionPopup,
    mediaProbe,
    serverUrl
  }) => {
    context.on("console", (message) => {
      logE2e(`Browser console.${message.type()}`, {
        url: message.page()?.url() ?? "extension-worker-or-popup",
        text: message.text()
      });
    });

    let targetPage = context.pages()[0];
    if (!targetPage) targetPage = await context.newPage();
    await targetPage.goto(serverUrl);
    logE2e("Target page loaded", { url: targetPage.url() });

    const startPopup = await openActionPopup(targetPage);
    await startPopup.waitForSelector('[data-testid="record-panel"]');
    expect(await startPopup.isVisible('[data-testid="record-panel"]')).toBe(true);
    expect(await startPopup.text("#url")).toBe(serverUrl);
    const targetTabId = await startPopup.evaluate<number | undefined>("(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id)()");
    expect(targetTabId).toBeTruthy();
    logE2e("Real Action Popup is ready", { targetTabId, targetUrl: serverUrl });
    await startPopup.click('[data-testid="start-recording-btn"]');
    logE2e("Clicked start recording through the real Action Popup");
    await startPopup.dispose();

    const session = await mediaProbe.waitForSession(targetTabId!);
    const activeMedia = await mediaProbe.waitForActive(session.id, targetTabId!);
    logE2e("Recording became active", {
      sessionId: session.id,
      sessionStatus: activeMedia.session?.status,
      captureStatus: activeMedia.capture?.status,
      offscreenActive: activeMedia.offscreenActive
    });
    expect(await mediaProbe.isOffscreenRecording(session.id)).toBe(true);

    await targetPage.bringToFront();
    // 页面焦点为截图关键前置条件，若未获得焦点应显式超时报错
    await targetPage.waitForFunction(() => document.hasFocus(), undefined, { timeout: 2_000 });

    // 控制极简敏捷间隔（已在产品层面由 captureVisibleTab 队列保护频次）
    await targetPage.locator('[data-testid="test-click-btn"]').click();
    await expect(targetPage.locator("#output")).toContainText("点击已被成功记录");
    logE2e("Recorded click interaction");

    await targetPage.waitForTimeout(200);

    await targetPage.locator('[data-testid="test-fetch-btn"]').click();
    await expect(targetPage.locator("#output")).toContainText("Fetch 请求成功");
    logE2e("Recorded fetch interaction");

    await targetPage.waitForTimeout(200);

    await targetPage.locator('[data-testid="test-error-btn"]').click();
    await expect(targetPage.locator("#output")).toHaveText("控制台报错已触发");
    logE2e("Recorded console error interaction");

    await targetPage.waitForTimeout(2_500);
    const stopButton = targetPage.locator("#__wbr_stop_btn__");
    await expect(stopButton).toBeVisible();

    const previewPagePromise = context.waitForEvent("page", {
      predicate: (page) => page.url().startsWith(`chrome-extension://${extensionId}/preview.html`),
      timeout: 10_000
    });
    logE2e("Clicking the visible in-page stop control");
    await stopButton.click();
    const previewPage = await previewPagePromise;
    await previewPage.waitForLoadState("domcontentloaded");
    await previewPage.bringToFront();
    logE2e("Preview page opened", { url: previewPage.url() });

    const evidence = await mediaProbe.persistedEvidence(previewPage, session.id);
    const totalMediaBytes = evidence.mediaChunks.reduce((total, chunk) => total + chunk.byteLength, 0);
    logE2e("Persisted evidence loaded", {
      sessionStatus: evidence.session?.status,
      overallQuality: evidence.session?.quality.overall,
      mediaChunks: evidence.mediaChunks.length,
      mediaBytes: totalMediaBytes,
      interactions: evidence.interactionCount,
      consoleEntries: evidence.consoleCount,
      networkEntries: evidence.networkCount,
      qualityIssues: evidence.session?.quality.issues
    });

    // --- 二、收紧质量契约与确定性断言 ---
    expect(evidence.session?.status).toBe("PREVIEW_READY");
    expect(evidence.session?.quality.overall).toBe("complete");
    expect(evidence.session?.quality.issues).toEqual([]);

    // 验证 session.target.tabId 与实际录制标签一致
    expect(evidence.session?.target.tabId).toBe(targetTabId);

    // 精确数量断言（与测试动作精确对应）
    expect(evidence.interactionCount).toBe(3);
    expect(evidence.consoleCount).toBe(2);
    expect(evidence.networkCount).toBe(1);
    expect(evidence.session?.quality.primaryScreenshotCount).toBe(3);

    // 验证 3 条交互的截图状态均为 captured，且具有 assetId
    expect(evidence.interactions.length).toBe(3);
    for (const interaction of evidence.interactions) {
      expect(interaction.screenshot.status).toBe("captured");
      expect(interaction.screenshot.assetId).toBeTruthy();
    }

    // 验证截图资产真实存在且非空
    const screenshotAssets = evidence.evidenceAssets.filter((asset) => asset.kind === "interaction-screenshot");
    expect(screenshotAssets.length).toBe(3);
    for (const asset of screenshotAssets) {
      expect(asset.byteLength).toBeGreaterThan(0);
      expect(asset.mimeType).toBe("image/png");
    }

    // 验证媒体分片连续且非空
    expect(evidence.mediaChunks.length).toBeGreaterThan(0);
    expect(totalMediaBytes).toBeGreaterThan(0);
    expect(evidence.mediaChunks.every((chunk, index) => chunk.sequence === index)).toBe(true);
    expect(evidence.mediaChunks.every((chunk) => chunk.mimeType.includes("video/webm"))).toBe(true);

    // 严格时间戳校验：必须持久化真实的 startedAtEpochMs/stoppedAtEpochMs/durationMs，不使用 Date.now() 兜底
    const startedAt = evidence.session?.timeline.startedAtEpochMs;
    const stoppedAt = evidence.session?.timeline.stoppedAtEpochMs;
    const durationMs = evidence.session?.timeline.durationMs;

    expect(typeof startedAt).toBe("number");
    expect(typeof stoppedAt).toBe("number");
    expect(typeof durationMs).toBe("number");
    expect(startedAt!).toBeGreaterThan(0);
    expect(stoppedAt!).toBeGreaterThanOrEqual(startedAt!);
    expect(durationMs!).toBe(stoppedAt! - startedAt!);
    expect(durationMs!).toBeGreaterThan(0);

    const allEvidenceItems = [
      ...evidence.interactions,
      ...evidence.consoleEntries,
      ...evidence.networkEntries
    ];
    for (const item of allEvidenceItems) {
      const timestamp = item.createdAt ?? item.createdAtEpochMs ?? item.occurredAt ?? item.timestamp ?? 0;
      expect(timestamp).toBeGreaterThanOrEqual(startedAt!);
      expect(timestamp).toBeLessThanOrEqual(stoppedAt! + 1000); // 1s 宽松缓冲以适应时间戳记录时序
    }

    // 验证 WebM 视频可播放
    const video = previewPage.locator("#video");
    await expect(video).toBeVisible({ timeout: 10_000 });
    await previewPage.waitForFunction(() => {
      const element = document.querySelector<HTMLVideoElement>("#video");
      return Boolean(element && element.readyState >= 1 && Number.isFinite(element.duration) && element.duration > 0);
    }, undefined, { timeout: 10_000 });
    const duration = await video.evaluate((element) => (element as HTMLVideoElement).duration);
    expect(duration).toBeGreaterThan(0);
    logE2e("Preview video is playable", { durationSeconds: duration });

    // --- 三、停止后的资源清理断言 ---
    // 1. 目标 tab 不再处于 active/pending tabCapture
    const stoppedCapture = await previewPage.evaluate(async () => chrome.tabCapture.getCapturedTabs());
    const targetTabCapture = stoppedCapture.find((entry) => entry.tabId === targetTabId);
    expect(targetTabCapture?.status).not.toBe("active");
    expect(targetTabCapture?.status).not.toBe("pending");

    // 2. Offscreen Recorder 不再 recording/paused
    expect(await mediaProbe.isOffscreenRecording(session.id)).toBe(false);

    // 3. 页面内 Bug Lens 录制浮层已经移除
    expect(await mediaProbe.isOverlayRemoved(targetPage)).toBe(true);

    // 4. IndexedDB 中不存在错误的 active-session 指针
    const activeSessionAfterStop = await mediaProbe.activeSession();
    expect(activeSessionAfterStop).toBeUndefined();

    // 5. 同一个 sessionId 只打开了一个 Preview
    const previewPages = context.pages().filter(
      (p) => p.url().includes(`chrome-extension://${extensionId}/preview.html`) && p.url().includes(session.id)
    );
    expect(previewPages.length).toBe(1);

    // 6. Chrome Action badge 恢复为空闲状态
    const badgeText = await mediaProbe.getBadgeText(targetTabId!);
    expect(badgeText).toBe("");

    logE2e("All REC-001 Golden Path assertions passed cleanly");

    if (previewHoldMs > 0) {
      logE2e("Holding Preview page for visual inspection", { milliseconds: previewHoldMs });
      await previewPage.waitForTimeout(previewHoldMs);
    }
  });
});
