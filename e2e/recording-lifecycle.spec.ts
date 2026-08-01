import { test, expect } from "./fixtures/extension.ts";

function logE2e(message: string, details?: unknown): void {
  const suffix = details === undefined ? "" : ` ${JSON.stringify(details)}`;
  console.log(`[Bug Lens E2E][${new Date().toISOString()}] ${message}${suffix}`);
}

test.describe("Bug Lens Chrome Extension recording lifecycle", () => {
  test("REC-002: reopens real Action Popup during recording without creating duplicate sessions or interrupting media capture", async ({
    context,
    extensionId,
    openActionPopup,
    waitForPopupClosed,
    activeTabId,
    mediaProbe,
    serverUrl
  }) => {
    context.on("console", (message) => {
      logE2e(`Browser console.${message.type()}`, {
        url: message.page()?.url() ?? "extension-worker-or-popup",
        text: message.text()
      });
    });

    // 1. 打开测试网页
    let targetPage = context.pages()[0];
    if (!targetPage) targetPage = await context.newPage();
    await targetPage.goto(serverUrl);

    // 2. 确认目标页面获得浏览器焦点
    await targetPage.bringToFront();
    await targetPage.waitForFunction(() => document.hasFocus(), undefined, { timeout: 2_000 });
    logE2e("Target page loaded and focused", { url: targetPage.url() });

    // 3. 在打开 Popup 之前读取真实 targetTabId
    const targetTabId = await activeTabId();
    expect(targetTabId).toBeTruthy();
    logE2e("Resolved targetTabId before opening initial Popup", { targetTabId });

    // 4. 通过 openActionPopup 打开真实 Popup
    const startPopup = await openActionPopup(targetPage);
    await startPopup.waitForSelector('[data-testid="record-panel"]');
    expect(await startPopup.isVisible('[data-testid="record-panel"]')).toBe(true);
    expect(await startPopup.text("#url")).toBe(serverUrl);

    // 5. 点击开始按钮启动录制
    await startPopup.click('[data-testid="start-recording-btn"]');
    logE2e("Clicked start recording in first Popup");
    await startPopup.evaluate("window.close()").catch(() => undefined);
    await startPopup.dispose();
    await targetPage.bringToFront();
    await waitForPopupClosed();
    await targetPage.waitForFunction(() => document.hasFocus(), undefined, { timeout: 2_000 });

    // 6. 等待 Session 状态 RECORDING、tabCapture active、Offscreen Recorder recording
    const initialSession = await mediaProbe.waitForSession(targetTabId!);
    const activeMedia = await mediaProbe.waitForActive(initialSession.id, targetTabId!);
    expect(await mediaProbe.isOffscreenRecording(initialSession.id)).toBe(true);

    // 7. 记录基线
    const initialSessionId = initialSession.id;
    const initialStartCommandId = initialSession.commandIds?.start;
    expect(initialStartCommandId).toBeTruthy();
    const initialSessionCount = await mediaProbe.sessionCount();
    const initialChunkCount = await mediaProbe.mediaChunkCount(initialSessionId);

    logE2e("Initial session recording active baseline", {
      initialSessionId,
      targetTabId,
      initialStartCommandId,
      initialSessionCount,
      initialChunkCount,
      status: activeMedia.session?.status,
      captureStatus: activeMedia.capture?.status,
      offscreenActive: activeMedia.offscreenActive
    });

    // 8. 等待至少产生一个媒体分片
    const chunkCountBeforeReopen = await mediaProbe.waitForMediaChunkCountGreaterThan(initialSessionId, 0, 5_000);
    expect(chunkCountBeforeReopen).toBeGreaterThan(0);
    logE2e("Confirmed initial media chunk generated", { chunkCountBeforeReopen });

    // 9. 重新把目标页面置前并确认焦点
    await targetPage.bringToFront();
    await targetPage.waitForFunction(() => document.hasFocus(), undefined, { timeout: 2_000 });

    // 10. 再次通过 openActionPopup(targetPage) 打开真实 Popup
    logE2e("Reopening real Action Popup during recording");
    const secondPopup = await openActionPopup(targetPage);

    // 11. 第二次 Popup 必须验证
    // 1. [data-testid="record-panel"] 可见
    await secondPopup.waitForSelector('[data-testid="record-panel"]');
    expect(await secondPopup.isVisible('[data-testid="record-panel"]')).toBe(true);

    // 2. Popup 显示的目标 URL 与测试网页一致
    expect(await secondPopup.text("#url")).toBe(serverUrl);

    // 3. 状态文本表示正在录制
    const secondStatusText = await secondPopup.text("#status");
    expect(secondStatusText).toBeTruthy();

    // 4. 计时器存在、格式正确，并且会继续递增
    const timer1 = await secondPopup.text("#timer");
    expect(timer1).toMatch(/^\d{2}:\d{2}$/);
    let timer2 = timer1;
    const timerDeadline = Date.now() + 5_000;
    while (Date.now() < timerDeadline) {
      timer2 = await secondPopup.text("#timer");
      if (timer2 !== timer1) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(timer2).toMatch(/^\d{2}:\d{2}$/);
    expect(timer2).not.toBe(timer1);

    // 5. 开始按钮不存在或不可见
    expect(await secondPopup.isVisible('[data-testid="start-recording-btn"]')).toBe(false);

    // 6. 停止按钮可见并可用
    expect(await secondPopup.isVisible('[data-testid="stop-recording-btn"]')).toBe(true);
    const stopDisabled = await secondPopup.evaluate<boolean>("Boolean(document.querySelector('[data-testid=\"stop-recording-btn\"]')?.disabled)");
    expect(stopDisabled).toBe(false);

    // 7. Preview 按钮不应出现
    expect(await secondPopup.isVisible('[data-testid="preview-btn"]')).toBe(false);

    // 8 & 9. 展开高级配置并验证所有控件被锁定以及默认值保持正确
    await secondPopup.click("#toggle-options");
    await secondPopup.waitForSelector("#advanced-options");

    const secondPopupOptionsState = await secondPopup.evaluate<{
      videoChecked: boolean;
      videoDisabled: boolean;
      audioChecked: boolean;
      audioDisabled: boolean;
      screenshotsChecked: boolean;
      screenshotsDisabled: boolean;
      consoleChecked: boolean;
      consoleDisabled: boolean;
      networkChecked: boolean;
      networkDisabled: boolean;
      bodiesChecked: boolean;
      bodiesDisabled: boolean;
      privacyValue: string;
      privacyDisabled: boolean;
    }>(`(() => {
      const get = (id) => document.querySelector("#" + id);
      return {
        videoChecked: Boolean(get("video")?.checked),
        videoDisabled: Boolean(get("video")?.disabled),
        audioChecked: Boolean(get("audio")?.checked),
        audioDisabled: Boolean(get("audio")?.disabled),
        screenshotsChecked: Boolean(get("screenshots")?.checked),
        screenshotsDisabled: Boolean(get("screenshots")?.disabled),
        consoleChecked: Boolean(get("console")?.checked),
        consoleDisabled: Boolean(get("console")?.disabled),
        networkChecked: Boolean(get("network")?.checked),
        networkDisabled: Boolean(get("network")?.disabled),
        bodiesChecked: Boolean(get("bodies")?.checked),
        bodiesDisabled: Boolean(get("bodies")?.disabled),
        privacyValue: get("privacy")?.value || "",
        privacyDisabled: Boolean(get("privacy")?.disabled)
      };
    })()`);

    logE2e("Second Popup verified status, timer, and locked options", {
      statusText: secondStatusText,
      timerInitial: timer1,
      timerIncremented: timer2,
      optionsState: secondPopupOptionsState
    });

    expect(secondPopupOptionsState.videoDisabled).toBe(true);
    expect(secondPopupOptionsState.audioDisabled).toBe(true);
    expect(secondPopupOptionsState.screenshotsDisabled).toBe(true);
    expect(secondPopupOptionsState.consoleDisabled).toBe(true);
    expect(secondPopupOptionsState.networkDisabled).toBe(true);
    expect(secondPopupOptionsState.bodiesDisabled).toBe(true);
    expect(secondPopupOptionsState.privacyDisabled).toBe(true);

    expect(secondPopupOptionsState.videoChecked).toBe(true);
    expect(secondPopupOptionsState.audioChecked).toBe(false);
    expect(secondPopupOptionsState.screenshotsChecked).toBe(true);
    expect(secondPopupOptionsState.consoleChecked).toBe(true);
    expect(secondPopupOptionsState.networkChecked).toBe(true);
    expect(secondPopupOptionsState.bodiesChecked).toBe(true);
    expect(secondPopupOptionsState.privacyValue).toBe("safe");

    // 12. 校验 Session 与契约数据
    const sessionDuringReopen = await mediaProbe.activeSession();
    expect(sessionDuringReopen?.id).toBe(initialSessionId);
    expect(sessionDuringReopen?.commandIds?.start).toBe(initialStartCommandId);
    expect(sessionDuringReopen?.target.tabId).toBe(targetTabId);

    const sessionCountDuringReopen = await mediaProbe.sessionCount();
    expect(sessionCountDuringReopen).toBe(initialSessionCount);

    const snapshotDuringReopen = await mediaProbe.snapshot(initialSessionId, targetTabId!);
    expect(snapshotDuringReopen.capture?.status).toBe("active");
    expect(snapshotDuringReopen.offscreenActive).toBe(true);
    expect(await mediaProbe.isOffscreenRecording(initialSessionId)).toBe(true);
    expect(sessionDuringReopen?.quality.issues).toEqual([]);

    logE2e("Reopened Popup session contract verified", {
      reopenedSessionId: sessionDuringReopen?.id,
      reopenedSessionCount: sessionCountDuringReopen,
      startCommandId: sessionDuringReopen?.commandIds?.start,
      captureStatus: snapshotDuringReopen.capture?.status,
      offscreenActive: snapshotDuringReopen.offscreenActive
    });

    // 13. 关闭第二次 Popup，恢复到目标页面
    await secondPopup.evaluate("window.close()").catch(() => undefined);
    await secondPopup.dispose();
    await targetPage.bringToFront();
    await waitForPopupClosed();
    await targetPage.waitForFunction(() => document.hasFocus(), undefined, { timeout: 2_000 });
    logE2e("Second Popup closed and target page focused");

    // 14. 验证 Popup 关闭后媒体分片数量继续增长
    const chunkCountAfterClose = await mediaProbe.waitForMediaChunkCountGreaterThan(initialSessionId, chunkCountBeforeReopen, 5_000);
    expect(chunkCountAfterClose).toBeGreaterThan(chunkCountBeforeReopen);
    logE2e("Media chunks continued to grow after closing second Popup", {
      chunkCountBeforeReopen,
      chunkCountAfterClose
    });

    // 15. 从页面内可见停止按钮停止录制
    const stopButton = targetPage.locator("#__wbr_stop_btn__");
    await expect(stopButton).toBeVisible();

    const previewPagePromise = context.waitForEvent("page", {
      predicate: (page) => page.url().startsWith(`chrome-extension://${extensionId}/preview.html`),
      timeout: 10_000
    });
    logE2e("Clicking in-page stop button");
    await stopButton.click();

    const previewPage = await previewPagePromise;
    await previewPage.waitForLoadState("domcontentloaded");
    await previewPage.bringToFront();
    logE2e("Preview page opened", { previewUrl: previewPage.url() });

    // 16. 停止后的断言与资源清理
    expect(previewPage.url()).toContain(initialSessionId);

    const evidence = await mediaProbe.persistedEvidence(previewPage, initialSessionId);
    const totalMediaBytes = evidence.mediaChunks.reduce((total, chunk) => total + chunk.byteLength, 0);

    logE2e("Final evidence and quality summary", {
      sessionId: evidence.session?.id,
      sessionStatus: evidence.session?.status,
      overallQuality: evidence.session?.quality.overall,
      qualityIssues: evidence.session?.quality.issues,
      mediaChunkCount: evidence.mediaChunks.length,
      totalMediaBytes
    });

    expect(evidence.session?.id).toBe(initialSessionId);
    expect(evidence.session?.status).toBe("PREVIEW_READY");
    expect(evidence.session?.quality.overall).toBe("complete");
    expect(evidence.session?.quality.issues).toEqual([]);

    expect(evidence.mediaChunks.length).toBeGreaterThan(0);
    expect(totalMediaBytes).toBeGreaterThan(0);
    expect(evidence.mediaChunks.every((chunk, index) => chunk.sequence === index)).toBe(true);

    const video = previewPage.locator("#video");
    await expect(video).toBeVisible({ timeout: 10_000 });
    await previewPage.waitForFunction(() => {
      const element = document.querySelector<HTMLVideoElement>("#video");
      return Boolean(element && element.readyState >= 1 && Number.isFinite(element.duration) && element.duration > 0);
    }, undefined, { timeout: 10_000 });
    const duration = await video.evaluate((element) => (element as HTMLVideoElement).duration);
    expect(duration).toBeGreaterThan(0);

    const stoppedCapture = await previewPage.evaluate(async () => chrome.tabCapture.getCapturedTabs());
    const targetCapture = stoppedCapture.find((entry) => entry.tabId === targetTabId);
    expect(targetCapture?.status).not.toBe("active");
    expect(targetCapture?.status).not.toBe("pending");

    expect(await mediaProbe.isOffscreenRecording(initialSessionId)).toBe(false);
    expect(await mediaProbe.isOverlayRemoved(targetPage)).toBe(true);
    expect(await mediaProbe.activeSession()).toBeUndefined();

    const previewPages = context.pages().filter(
      (p) => p.url().includes(`chrome-extension://${extensionId}/preview.html`) && p.url().includes(initialSessionId)
    );
    expect(previewPages.length).toBe(1);

    const badgeText = await mediaProbe.getBadgeText(targetTabId!);
    expect(badgeText).toBe("");

    logE2e("REC-002 test assertions and resource cleanup completed successfully", {
      sessionId: initialSessionId,
      previewUrl: previewPage.url(),
      qualityOverall: evidence.session?.quality.overall,
      cleanup: {
        tabCaptureActive: targetCapture?.status === "active",
        offscreenRecording: false,
        overlayRemoved: true,
        activeSessionCleared: true,
        previewCount: previewPages.length,
        badgeText
      }
    });
  });
});
