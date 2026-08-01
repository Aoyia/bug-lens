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
  test("records the active tab through a trusted extension invocation", async ({
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

    await targetPage.bringToFront();

    await targetPage.locator('[data-testid="test-click-btn"]').click();
    await expect(targetPage.locator("#output")).toContainText("点击已被成功记录");
    logE2e("Recorded click interaction");
    await targetPage.locator('[data-testid="test-fetch-btn"]').click();
    await expect(targetPage.locator("#output")).toContainText("Fetch 请求成功");
    logE2e("Recorded fetch interaction");
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
    logE2e("Persisted evidence loaded", {
      sessionStatus: evidence.session?.status,
      mediaChunks: evidence.mediaChunks.length,
      mediaBytes: evidence.mediaChunks.reduce((total, chunk) => total + chunk.byteLength, 0),
      interactions: evidence.interactionCount,
      consoleEntries: evidence.consoleCount,
      networkEntries: evidence.networkCount,
      qualityIssues: evidence.session?.quality.issues.map((entry) => entry.code) ?? []
    });
    expect(evidence.session?.status).toBe("PREVIEW_READY");
    expect(evidence.session?.target.tabId).toBe(targetTabId);
    expect(evidence.session?.quality.issues.map((entry) => entry.code)).not.toContain("MEDIA_STREAM_ID_FAILED");
    expect(evidence.session?.quality.issues.map((entry) => entry.code)).not.toContain("MEDIA_RECORDER_FAILED");
    expect(evidence.interactionCount).toBeGreaterThanOrEqual(3);
    expect(evidence.consoleCount).toBeGreaterThan(0);
    expect(evidence.networkCount).toBeGreaterThan(0);
    expect(evidence.mediaChunks.length).toBeGreaterThan(0);
    expect(evidence.mediaChunks.reduce((total, chunk) => total + chunk.byteLength, 0)).toBeGreaterThan(0);
    expect(evidence.mediaChunks.every((chunk, index) => chunk.sequence === index)).toBe(true);
    expect(evidence.mediaChunks.every((chunk) => chunk.mimeType.includes("video/webm"))).toBe(true);

    const stoppedCapture = await previewPage.evaluate(async () => chrome.tabCapture.getCapturedTabs());
    expect(stoppedCapture.find((entry) => entry.tabId === targetTabId)?.status).not.toBe("active");
    expect(stoppedCapture.find((entry) => entry.tabId === targetTabId)?.status).not.toBe("pending");

    const video = previewPage.locator("#video");
    await expect(video).toBeVisible({ timeout: 10_000 });
    await previewPage.waitForFunction(() => {
      const element = document.querySelector<HTMLVideoElement>("#video");
      return Boolean(element && element.readyState >= 1 && Number.isFinite(element.duration) && element.duration > 0);
    }, undefined, { timeout: 10_000 });
    const duration = await video.evaluate((element) => (element as HTMLVideoElement).duration);
    logE2e("Preview video is playable", { durationSeconds: duration });

    if (previewHoldMs > 0) {
      logE2e("Holding Preview page for visual inspection", { milliseconds: previewHoldMs });
      await previewPage.waitForTimeout(previewHoldMs);
    }
  });
});
