import { test, expect } from "./fixtures/extension.ts";
import type { CdpPopup } from "./fixtures/cdp-popup.ts";

function logE2e(message: string, details?: unknown): void {
  const suffix = details === undefined ? "" : ` ${JSON.stringify(details)}`;
  console.log(
    `[Bug Lens E2E][${new Date().toISOString()}] ${message}${suffix}`
  );
}

async function waitForPopupChecked(
  popup: CdpPopup,
  selector: string,
  expected: boolean,
  timeoutMs = 2_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const checked = await popup.evaluate<boolean>(
      `Boolean(document.querySelector(${JSON.stringify(selector)})?.checked)`
    );
    if (checked === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const actual = await popup.evaluate<boolean>(
    `Boolean(document.querySelector(${JSON.stringify(selector)})?.checked)`
  );
  throw new Error(
    `ACTION_POPUP_CHECKBOX_TIMEOUT: ${selector} expected=${expected} actual=${actual}`
  );
}

test.describe("Bug Lens Chrome Extension recording options", () => {
  test("OPT-001: disables video and screenshots while retaining diagnostics", async ({
    context,
    extensionId,
    openActionPopup,
    activeTabId,
    mediaProbe,
    serverUrl,
  }) => {
    context.on("console", (message) => {
      logE2e(`Browser console.${message.type()}`, {
        url: message.page()?.url() ?? "extension-worker-or-popup",
        text: message.text(),
      });
    });

    let targetPage = context.pages()[0];
    if (!targetPage) targetPage = await context.newPage();
    await targetPage.goto(serverUrl);
    await targetPage.bringToFront();
    await targetPage.waitForFunction(() => document.hasFocus(), undefined, {
      timeout: 2_000,
    });
    logE2e("Target page loaded", { url: targetPage.url() });

    const targetTabId = await activeTabId();
    expect(targetTabId).toBeTruthy();
    logE2e("Resolved target tab", { targetTabId, type: typeof targetTabId });

    const popup = await openActionPopup(targetPage);
    await popup.waitForSelector('[data-testid="record-panel"]');
    await popup.click("#toggle-options");
    await popup.waitForSelector("#advanced-options");

    expect(
      await popup.evaluate<boolean>(
        "Boolean(document.querySelector('#video')?.checked)"
      )
    ).toBe(true);
    expect(
      await popup.evaluate<boolean>(
        "Boolean(document.querySelector('#screenshots')?.checked)"
      )
    ).toBe(true);
    expect(
      await popup.evaluate<boolean>(
        "Boolean(document.querySelector('#console')?.checked)"
      )
    ).toBe(true);
    expect(
      await popup.evaluate<boolean>(
        "Boolean(document.querySelector('#network')?.checked)"
      )
    ).toBe(true);
    expect(
      await popup.evaluate<boolean>(
        "Boolean(document.querySelector('#framework-state')?.checked)"
      )
    ).toBe(true);
    expect(
      await popup.evaluate<string>(
        "document.querySelector('#video-quality')?.value || ''"
      )
    ).toBe("balanced");

    await popup.click("#video");
    await waitForPopupChecked(popup, "#video", false);
    await waitForPopupChecked(popup, "#audio", false);
    expect(
      await popup.evaluate<boolean>(
        "Boolean(document.querySelector('#audio')?.disabled)"
      )
    ).toBe(true);

    await popup.click("#screenshots");
    await waitForPopupChecked(popup, "#screenshots", false);
    expect(
      await popup.evaluate<boolean>(
        "Boolean(document.querySelector('#console')?.checked)"
      )
    ).toBe(true);
    expect(
      await popup.evaluate<boolean>(
        "Boolean(document.querySelector('#network')?.checked)"
      )
    ).toBe(true);
    expect(
      await popup.evaluate<boolean>(
        "Boolean(document.querySelector('#bodies')?.checked)"
      )
    ).toBe(true);
    logE2e("Diagnostic-only options selected", {
      video: false,
      screenshots: false,
      console: true,
      network: true,
      networkBodies: true,
    });

    await popup.click('[data-testid="start-recording-btn"]');
    await popup.dispose();

    const session = await mediaProbe.waitForSession(targetTabId!);
    expect(session.status).toBe("RECORDING");
    expect(session.options.captureVideo).toBe(false);
    expect(session.options.captureAudio).toBe(false);
    expect(session.options.captureScreenshots).toBe(false);
    expect(session.options.captureConsole).toBe(true);
    expect(session.options.captureNetwork).toBe(true);
    expect(session.options.captureNetworkBodies).toBe(true);
    expect(session.options.captureFrameworkState).toBe(true);
    expect(session.options.videoBitsPerSecond).toBe(2_500_000);
    expect(await mediaProbe.isOffscreenRecording(session.id)).toBe(false);
    const activeSnapshot = await mediaProbe.snapshot(session.id, targetTabId!);
    expect(activeSnapshot.capture).toBeUndefined();
    logE2e("Diagnostic-only recording became active", {
      sessionId: session.id,
      capture: activeSnapshot.capture,
      offscreenRecording: false,
    });

    await targetPage.bringToFront();
    await targetPage.locator('[data-testid="test-click-btn"]').click();
    await expect(targetPage.locator("#output")).toContainText(
      "点击已被成功记录"
    );
    await targetPage.locator('[data-testid="test-fetch-btn"]').click();
    await expect(targetPage.locator("#output")).toContainText("Fetch 请求成功");
    await targetPage.locator('[data-testid="test-error-btn"]').click();
    await expect(targetPage.locator("#output")).toHaveText("控制台报错已触发");
    logE2e("Diagnostic interactions completed");

    await targetPage.waitForTimeout(1_000);
    const stopButton = targetPage.locator("#__wbr_stop_btn__");
    await expect(stopButton).toBeVisible();
    const previewPagePromise = context.waitForEvent("page", {
      predicate: (page) =>
        page.url().startsWith(`chrome-extension://${extensionId}/preview.html`),
      timeout: 10_000,
    });
    await stopButton.click();
    const previewPage = await previewPagePromise;
    await previewPage.waitForLoadState("domcontentloaded");
    await previewPage.bringToFront();

    const evidence = await mediaProbe.persistedEvidence(
      previewPage,
      session.id
    );
    const totalMediaBytes = evidence.mediaChunks.reduce(
      (total, chunk) => total + chunk.byteLength,
      0
    );
    logE2e("Diagnostic-only evidence loaded", {
      sessionStatus: evidence.session?.status,
      timeline: evidence.session?.timeline,
      quality: evidence.session?.quality,
      mediaChunks: evidence.mediaChunks.length,
      mediaBytes: totalMediaBytes,
      interactions: evidence.interactionCount,
      consoleEntries: evidence.consoleCount,
      networkEntries: evidence.networkCount,
      assets: evidence.evidenceAssets.length,
      interactionTargets: evidence.interactions.map((interaction) => ({
        kind: interaction.kind,
        status: interaction.status,
        createdAt: interaction.createdAt,
        id: interaction.element.id,
        tagName: interaction.element.tagName,
        text: interaction.element.text,
        metadata: interaction.metadata,
      })),
    });

    expect(evidence.session?.status).toBe("PREVIEW_READY");
    expect(evidence.session?.quality.overall).toBe("complete");
    expect(evidence.session?.quality.issues).toEqual([]);
    expect(evidence.session?.target.tabId).toBe(targetTabId);
    expect(evidence.session?.options.captureVideo).toBe(false);
    expect(evidence.session?.options.captureAudio).toBe(false);
    expect(evidence.session?.options.captureScreenshots).toBe(false);
    expect(evidence.session?.options.captureConsole).toBe(true);
    expect(evidence.session?.options.captureNetwork).toBe(true);
    expect(evidence.session?.options.captureNetworkBodies).toBe(true);

    expect(evidence.mediaChunks).toEqual([]);
    expect(totalMediaBytes).toBe(0);
    expect(evidence.session?.quality.primaryScreenshotCount).toBe(0);
    expect(evidence.session?.quality.fallbackScreenshotCount).toBe(0);
    expect(evidence.session?.quality.unavailableScreenshotCount).toBe(0);
    expect(
      evidence.evidenceAssets.filter(
        (asset) => asset.kind === "interaction-screenshot"
      )
    ).toEqual([]);

    expect(evidence.interactionCount).toBe(3);
    for (const interaction of evidence.interactions) {
      expect(interaction.screenshot.status).toBe("disabled");
      expect(interaction.screenshot.assetId).toBeUndefined();
    }
    expect(evidence.consoleCount).toBe(2);
    expect(evidence.networkCount).toBe(1);

    await expect(previewPage.locator("#video")).toBeHidden();
    await expect(previewPage.locator("#video-empty")).toContainText(
      "没有可播放的媒体分片"
    );
    logE2e("Preview exposes explicit no-media state");

    const stoppedCapture = await previewPage.evaluate(async () =>
      chrome.tabCapture.getCapturedTabs()
    );
    expect(
      stoppedCapture.find((entry) => entry.tabId === targetTabId)?.status
    ).not.toBe("active");
    expect(
      stoppedCapture.find((entry) => entry.tabId === targetTabId)?.status
    ).not.toBe("pending");
    expect(await mediaProbe.isOffscreenRecording(session.id)).toBe(false);
    expect(await mediaProbe.activeSession()).toBeUndefined();
    expect(await mediaProbe.getBadgeText(targetTabId!)).toBe("");
    logE2e("OPT-001 resource cleanup assertions passed");
  });

  test("OPT-002: enforces option dependencies and records visual evidence only", async ({
    context,
    extensionId,
    openActionPopup,
    activeTabId,
    mediaProbe,
    serverUrl,
  }) => {
    context.on("console", (message) => {
      logE2e(`Browser console.${message.type()}`, {
        url: message.page()?.url() ?? "extension-worker-or-popup",
        text: message.text(),
      });
    });

    let targetPage = context.pages()[0];
    if (!targetPage) targetPage = await context.newPage();
    await targetPage.goto(serverUrl);
    await targetPage.bringToFront();
    await targetPage.waitForFunction(() => document.hasFocus(), undefined, {
      timeout: 2_000,
    });
    logE2e("Target page loaded", { url: targetPage.url() });

    const targetTabId = await activeTabId();
    expect(targetTabId).toBeTruthy();

    const popup = await openActionPopup(targetPage);
    await popup.waitForSelector('[data-testid="record-panel"]');
    await popup.click("#toggle-options");
    await popup.waitForSelector("#advanced-options");

    await popup.click("#audio");
    await waitForPopupChecked(popup, "#audio", true);
    await popup.click("#video");
    await waitForPopupChecked(popup, "#video", false);
    await waitForPopupChecked(popup, "#audio", false);
    expect(
      await popup.evaluate<boolean>(
        "Boolean(document.querySelector('#audio')?.disabled)"
      )
    ).toBe(true);

    await popup.click("#video");
    await waitForPopupChecked(popup, "#video", true);
    expect(
      await popup.evaluate<boolean>(
        "Boolean(document.querySelector('#audio')?.disabled)"
      )
    ).toBe(false);
    await waitForPopupChecked(popup, "#audio", false);

    await popup.click("#console");
    await waitForPopupChecked(popup, "#console", false);
    await popup.click("#network");
    await waitForPopupChecked(popup, "#network", false);
    await waitForPopupChecked(popup, "#bodies", false);
    expect(
      await popup.evaluate<boolean>(
        "Boolean(document.querySelector('#bodies')?.disabled)"
      )
    ).toBe(true);
    expect(
      await popup.evaluate<boolean>(
        "Boolean(document.querySelector('#screenshots')?.checked)"
      )
    ).toBe(true);
    logE2e("Visual-only options selected", {
      video: true,
      audio: false,
      screenshots: true,
      console: false,
      network: false,
      networkBodies: false,
    });

    await popup.click('[data-testid="start-recording-btn"]');
    await popup.dispose();

    const session = await mediaProbe.waitForSession(targetTabId!);
    const activeMedia = await mediaProbe.waitForActive(
      session.id,
      targetTabId!
    );
    expect(activeMedia.session?.status).toBe("RECORDING");
    expect(session.options.captureVideo).toBe(true);
    expect(session.options.captureAudio).toBe(false);
    expect(session.options.captureScreenshots).toBe(true);
    expect(session.options.captureConsole).toBe(false);
    expect(session.options.captureNetwork).toBe(false);
    expect(session.options.captureNetworkBodies).toBe(false);
    expect(await mediaProbe.isOffscreenRecording(session.id)).toBe(true);
    logE2e("Visual-only recording became active", {
      sessionId: session.id,
      captureStatus: activeMedia.capture?.status,
      offscreenRecording: true,
    });

    await targetPage.bringToFront();
    await targetPage.waitForFunction(() => document.hasFocus(), undefined, {
      timeout: 2_000,
    });
    await targetPage.locator('[data-testid="test-click-btn"]').click();
    await expect(targetPage.locator("#output")).toContainText(
      "点击已被成功记录"
    );
    await targetPage.locator('[data-testid="test-fetch-btn"]').click();
    await expect(targetPage.locator("#output")).toContainText("Fetch 请求成功");
    await targetPage.locator('[data-testid="test-error-btn"]').click();
    await expect(targetPage.locator("#output")).toHaveText("控制台报错已触发");
    logE2e("Visual interactions completed");

    await targetPage.waitForTimeout(2_500);
    const stopButton = targetPage.locator("#__wbr_stop_btn__");
    await expect(stopButton).toBeVisible();
    const previewPagePromise = context.waitForEvent("page", {
      predicate: (page) =>
        page.url().startsWith(`chrome-extension://${extensionId}/preview.html`),
      timeout: 10_000,
    });
    await stopButton.click();
    const previewPage = await previewPagePromise;
    await previewPage.waitForLoadState("domcontentloaded");
    await previewPage.bringToFront();

    const evidence = await mediaProbe.persistedEvidence(
      previewPage,
      session.id
    );
    const totalMediaBytes = evidence.mediaChunks.reduce(
      (total, chunk) => total + chunk.byteLength,
      0
    );
    logE2e("Visual-only evidence loaded", {
      sessionStatus: evidence.session?.status,
      timeline: evidence.session?.timeline,
      quality: evidence.session?.quality,
      mediaChunks: evidence.mediaChunks.length,
      mediaBytes: totalMediaBytes,
      interactions: evidence.interactionCount,
      consoleEntries: evidence.consoleCount,
      networkEntries: evidence.networkCount,
      assets: evidence.evidenceAssets.length,
      interactionTargets: evidence.interactions.map((interaction) => ({
        kind: interaction.kind,
        status: interaction.status,
        createdAt: interaction.createdAt,
        id: interaction.element.id,
        tagName: interaction.element.tagName,
        text: interaction.element.text,
        metadata: interaction.metadata,
      })),
    });

    expect(evidence.session?.status).toBe("PREVIEW_READY");
    expect(evidence.session?.quality.overall).toBe("complete");
    expect(evidence.session?.quality.issues).toEqual([]);
    expect(evidence.session?.options.captureVideo).toBe(true);
    expect(evidence.session?.options.captureAudio).toBe(false);
    expect(evidence.session?.options.captureScreenshots).toBe(true);
    expect(evidence.session?.options.captureConsole).toBe(false);
    expect(evidence.session?.options.captureNetwork).toBe(false);
    expect(evidence.session?.options.captureNetworkBodies).toBe(false);

    expect(evidence.mediaChunks.length).toBeGreaterThan(0);
    expect(totalMediaBytes).toBeGreaterThan(0);
    expect(
      evidence.mediaChunks.every((chunk, index) => chunk.sequence === index)
    ).toBe(true);
    expect(evidence.interactionCount).toBe(3);
    expect(evidence.session?.quality.primaryScreenshotCount).toBe(3);
    expect(evidence.session?.quality.fallbackScreenshotCount).toBe(0);
    expect(evidence.session?.quality.unavailableScreenshotCount).toBe(0);
    for (const interaction of evidence.interactions) {
      expect(interaction.screenshot.status).toBe("captured");
      expect(interaction.screenshot.assetId).toBeTruthy();
    }
    const screenshotAssets = evidence.evidenceAssets.filter(
      (asset) => asset.kind === "interaction-screenshot"
    );
    expect(screenshotAssets.length).toBe(3);
    expect(
      screenshotAssets.every(
        (asset) => asset.byteLength > 0 && asset.mimeType === "image/png"
      )
    ).toBe(true);
    expect(evidence.consoleCount).toBe(0);
    expect(evidence.networkCount).toBe(0);

    const video = previewPage.locator("#video");
    await expect(video).toBeVisible({ timeout: 10_000 });
    await previewPage.waitForFunction(
      () => {
        const element = document.querySelector<HTMLVideoElement>("#video");
        return Boolean(
          element &&
          element.readyState >= 1 &&
          Number.isFinite(element.duration) &&
          element.duration > 0
        );
      },
      undefined,
      { timeout: 10_000 }
    );

    await previewPage.locator('[data-tab="console"]').click();
    await expect(previewPage.locator("#tab-pane-console")).toContainText(
      "没有 Console 记录"
    );
    await previewPage.locator('[data-tab="network"]').click();
    await expect(previewPage.locator("#tab-pane-network")).toContainText(
      "没有 Network 记录"
    );
    logE2e("Preview exposes empty diagnostic states");

    const stoppedCapture = await previewPage.evaluate(async () =>
      chrome.tabCapture.getCapturedTabs()
    );
    const targetCapture = stoppedCapture.find(
      (entry) => entry.tabId === targetTabId
    );
    expect(targetCapture?.status).not.toBe("active");
    expect(targetCapture?.status).not.toBe("pending");
    expect(await mediaProbe.isOffscreenRecording(session.id)).toBe(false);
    expect(await mediaProbe.isOverlayRemoved(targetPage)).toBe(true);
    expect(await mediaProbe.activeSession()).toBeUndefined();
    expect(await mediaProbe.getBadgeText(targetTabId!)).toBe("");
    logE2e("OPT-002 option dependency and cleanup assertions passed");
  });
});
