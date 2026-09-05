import { test, expect } from "./fixtures/extension.ts";
import type { CdpPopup } from "./fixtures/cdp-popup.ts";
import fs from "node:fs";
import { unzipSync, strFromU8 } from "fflate";
import { verifyExportIntegrity } from "../src/export/export-manifest.ts";
import type { ExportManifest } from "../src/shared/protocol.ts";

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
    logE2e("Target page loaded and focused", { url: targetPage.url() });

    const targetTabId = await activeTabId();
    expect(targetTabId).toBeTruthy();
    logE2e("Resolved target tab", { targetTabId, type: typeof targetTabId });

    const popup = await openActionPopup(targetPage);
    await popup.waitForSelector('[data-testid="record-panel"]');
    await popup.click("#toggle-options");
    await popup.waitForSelector("#advanced-options");

    // 1. 验证 2×3 矩阵几何规整性：6 个 Chip 均分两行，每行 3 个，宽度一致无折行
    const gridLayout = await popup.evaluate<{
      chipCount: number;
      chipDetails: Array<{
        id: string;
        top: number;
        left: number;
        width: number;
        height: number;
        text: string;
        overflowing: boolean;
      }>;
      formRows: Array<{
        labelWidth: number;
        labelLeft: number;
        selectLeft: number;
        selectWidth: number;
      }>;
    }>(`(() => {
      const chips = Array.from(
        document.querySelectorAll(".scopes-grid .scope-chip")
      );
      const rows = Array.from(
        document.querySelectorAll(".video-quality-row")
      );
      const labels = rows.map((r) =>
        r.querySelector(".video-quality-label")
      );
      const selects = rows.map((r) =>
        r.querySelector(".privacy-select")
      );

      return {
        chipCount: chips.length,
        chipDetails: chips.map((c) => {
          const rect = c.getBoundingClientRect();
          const span = c.querySelector("span");
          return {
            id: c.querySelector("input")?.id || "",
            top: Math.round(rect.top),
            left: Math.round(rect.left),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            text: span?.textContent?.trim() || "",
            overflowing: span ? span.scrollWidth > span.clientWidth : false,
          };
        }),
        formRows: rows.map((r, i) => {
          const lRect = labels[i]?.getBoundingClientRect();
          const sRect = selects[i]?.getBoundingClientRect();
          return {
            labelWidth: Math.round(lRect?.width ?? 0),
            labelLeft: Math.round(lRect?.left ?? 0),
            selectLeft: Math.round(sRect?.left ?? 0),
            selectWidth: Math.round(sRect?.width ?? 0),
          };
        }),
      };
    })()`);

    // 严格 6 个芯片，2 行 × 3 列
    expect(gridLayout.chipCount).toBe(6);
    const rowTops = Array.from(
      new Set(gridLayout.chipDetails.map((c) => c.top))
    ).sort((a, b) => a - b);
    expect(rowTops.length).toBe(2);
    const row1Chips = gridLayout.chipDetails.filter(
      (c) => c.top === rowTops[0]
    );
    const row2Chips = gridLayout.chipDetails.filter(
      (c) => c.top === rowTops[1]
    );
    expect(row1Chips.map((c) => c.id)).toEqual([
      "video",
      "audio",
      "screenshots",
    ]);
    expect(row2Chips.map((c) => c.id)).toEqual([
      "console",
      "network",
      "framework-state",
    ]);
    // 各芯片等宽且无文字溢出
    for (const chip of gridLayout.chipDetails) {
      expect(Math.abs(chip.width - row1Chips[0].width)).toBeLessThanOrEqual(1);
      expect(chip.overflowing).toBe(false);
    }
    // 表单行（Response Bodies、Masking、Language）左侧标签与右侧 Select 完美垂直对齐
    expect(gridLayout.formRows.length).toBe(3);
    for (let i = 1; i < gridLayout.formRows.length; i++) {
      expect(gridLayout.formRows[i].labelLeft).toBe(
        gridLayout.formRows[0].labelLeft
      );
      expect(gridLayout.formRows[i].labelWidth).toBe(96);
      expect(gridLayout.formRows[i].selectLeft).toBe(
        gridLayout.formRows[0].selectLeft
      );
      expect(
        Math.abs(
          gridLayout.formRows[i].selectWidth -
            gridLayout.formRows[0].selectWidth
        )
      ).toBeLessThanOrEqual(1);
    }

    // 2. 验证多语言切换（zh-CN <-> en-US）下的视觉布局稳定性与对齐无漂移
    await popup.selectOptionByKeys("#language-preference", "en-US");
    const enLayout = await popup.evaluate<{
      labels: string[];
      labelLefts: number[];
      labelWidths: number[];
      selectLefts: number[];
    }>(`(() => {
      const rows = Array.from(
        document.querySelectorAll(".video-quality-row")
      );
      const labels = rows.map((r) =>
        r.querySelector(".video-quality-label")?.textContent?.trim() || ""
      );
      const labelRects = rows.map((r) =>
        r.querySelector(".video-quality-label")?.getBoundingClientRect()
      );
      const selectRects = rows.map((r) =>
        r.querySelector(".privacy-select")?.getBoundingClientRect()
      );
      return {
        labels,
        labelLefts: labelRects.map((r) => Math.round(r?.left ?? 0)),
        labelWidths: labelRects.map((r) => Math.round(r?.width ?? 0)),
        selectLefts: selectRects.map((r) => Math.round(r?.left ?? 0)),
      };
    })()`);
    expect(enLayout.labels).toEqual(["Response Bodies", "Masking", "Language"]);
    expect(enLayout.labelWidths).toEqual([96, 96, 96]);
    expect(enLayout.labelLefts[0]).toBe(enLayout.labelLefts[1]);
    expect(enLayout.labelLefts[1]).toBe(enLayout.labelLefts[2]);
    expect(enLayout.selectLefts[0]).toBe(enLayout.selectLefts[1]);
    expect(enLayout.selectLefts[1]).toBe(enLayout.selectLefts[2]);

    // 切换回 zh-CN
    await popup.selectOptionByKeys("#language-preference", "zh-CN");
    const zhLayout = await popup.evaluate<string[]>(`(() => {
      const rows = Array.from(
        document.querySelectorAll(".video-quality-row")
      );
      return rows.map((r) =>
        r.querySelector(".video-quality-label")?.textContent?.trim() || ""
      );
    })()`);
    expect(zhLayout).toEqual(["响应正文", "脱敏模式", "界面语言"]);

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
        "document.querySelector('#privacy')?.value || ''"
      )
    ).toBe("safe");

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
        "document.querySelector('#response-bodies')?.value === 'standard'"
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

    const stopButton = targetPage.locator("#__wbr_stop_btn__");
    await expect(stopButton).toBeVisible();
    await stopButton.click();
    const exportedDownload = await mediaProbe.waitForExportDownload();
    expect(exportedDownload.state).toBe("complete");

    const previewPage = await context.newPage();
    await previewPage.goto(
      `chrome-extension://${extensionId}/preview.html?sessionId=${session.id}`
    );
    await previewPage.waitForLoadState("domcontentloaded");

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
    expect(evidence.session?.options.captureFullResponseBody).toBe(false);

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

    await previewPage.waitForSelector(".zen-app-frame", { timeout: 10_000 });
    await expect(previewPage.locator("#video")).toBeHidden();
    await expect(previewPage.locator("#video-empty")).toHaveText(
      /没有可播放的媒体分片|No playable media chunks|正在读取/
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
    logE2e("Target page loaded and focused", { url: targetPage.url() });

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

    // 验证响应正文策略三态切换与 Network 联动
    await popup.selectOptionByKeys("#response-bodies", "disabled");
    expect(
      await popup.evaluate<string>(
        "document.querySelector('#response-bodies')?.value || ''"
      )
    ).toBe("disabled");
    await popup.selectOptionByKeys("#response-bodies", "full");
    expect(
      await popup.evaluate<string>(
        "document.querySelector('#response-bodies')?.value || ''"
      )
    ).toBe("full");
    await popup.selectOptionByKeys("#response-bodies", "standard");
    expect(
      await popup.evaluate<string>(
        "document.querySelector('#response-bodies')?.value || ''"
      )
    ).toBe("standard");

    await popup.click("#network");
    await waitForPopupChecked(popup, "#network", false);
    expect(
      await popup.evaluate<boolean>(
        "document.querySelector('#response-bodies') === null"
      )
    ).toBe(true);

    // 重新开启 Network：下拉行应重新显示并记忆此前的 standard 选择
    await popup.click("#network");
    await waitForPopupChecked(popup, "#network", true);
    expect(
      await popup.evaluate<boolean>(
        "document.querySelector('#response-bodies') !== null"
      )
    ).toBe(true);
    expect(
      await popup.evaluate<string>(
        "document.querySelector('#response-bodies')?.value || ''"
      )
    ).toBe("standard");

    // 再次关闭 Network 以进行纯视觉录制：下拉行再次隐藏
    await popup.click("#network");
    await waitForPopupChecked(popup, "#network", false);
    expect(
      await popup.evaluate<boolean>(
        "document.querySelector('#response-bodies') === null"
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
    expect(session.options.captureFullResponseBody).toBe(false);
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
    await targetPage.waitForTimeout(500);
    await targetPage.locator('[data-testid="test-fetch-btn"]').click();
    await expect(targetPage.locator("#output")).toContainText("Fetch 请求成功");
    await targetPage.waitForTimeout(500);
    await targetPage.locator('[data-testid="test-error-btn"]').click();
    await expect(targetPage.locator("#output")).toHaveText("控制台报错已触发");
    await targetPage.waitForTimeout(500);
    logE2e("Visual interactions completed");

    const stopButton = targetPage.locator("#__wbr_stop_btn__");
    await expect(stopButton).toBeVisible();
    await mediaProbe.waitForMediaChunkCountGreaterThan(session.id, 0, 5_000);
    await stopButton.click();
    const exportedDownload = await mediaProbe.waitForExportDownload();
    expect(exportedDownload.state).toBe("complete");

    const previewPage = await context.newPage();
    await previewPage.goto(
      `chrome-extension://${extensionId}/preview.html?sessionId=${session.id}`
    );
    await previewPage.waitForLoadState("domcontentloaded");

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
        (asset) =>
          asset.byteLength > 0 &&
          ["image/png", "image/jpeg"].includes(asset.mimeType)
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

  test("OPT-003: dynamically displays response bodies dropdown on network toggle and activates full body recording", async ({
    context,
    extensionId,
    openActionPopup,
    activeTabId,
    mediaProbe,
    serverUrl,
  }) => {
    let targetPage = context.pages()[0];
    if (!targetPage) targetPage = await context.newPage();
    await targetPage.goto(serverUrl);
    await targetPage.bringToFront();
    await targetPage.waitForFunction(() => document.hasFocus(), undefined, {
      timeout: 2_000,
    });

    const targetTabId = await activeTabId();
    expect(targetTabId).toBeTruthy();

    const popup = await openActionPopup(targetPage);
    await popup.waitForSelector('[data-testid="record-panel"]');
    await popup.click("#toggle-options");
    await popup.waitForSelector("#advanced-options");

    // 1. 验证初次展开：默认勾选 network 时，#response-bodies 必须存在
    expect(
      await popup.evaluate<boolean>(
        "document.querySelector('#response-bodies') !== null"
      )
    ).toBe(true);

    // 2. 取消勾选 network：#response-bodies 必须从 DOM 中完全移除
    await popup.click("#network");
    await waitForPopupChecked(popup, "#network", false);
    expect(
      await popup.evaluate<boolean>(
        "document.querySelector('#response-bodies') === null"
      )
    ).toBe(true);

    // 3. 再次勾选 network：#response-bodies 必须重新出现并可选
    await popup.click("#network");
    await waitForPopupChecked(popup, "#network", true);
    expect(
      await popup.evaluate<boolean>(
        "document.querySelector('#response-bodies') !== null"
      )
    ).toBe(true);

    // 4. 选择 full 完整无截断采集档位
    await popup.selectOptionByKeys("#response-bodies", "full");
    expect(
      await popup.evaluate<string>(
        "document.querySelector('#response-bodies')?.value || ''"
      )
    ).toBe("full");

    // 5. 启动录制并验证会话 options 接收到了 captureFullResponseBody: true
    await popup.click('[data-testid="start-recording-btn"]');
    await popup.dispose();

    const session = await mediaProbe.waitForSession(targetTabId!);
    expect(session.options.captureNetwork).toBe(true);
    expect(session.options.captureNetworkBodies).toBe(true);
    expect(session.options.captureFullResponseBody).toBe(true);

    // 6. 页面交互并触发 Fetch
    await targetPage.bringToFront();
    await targetPage.locator('[data-testid="test-fetch-btn"]').click();
    await expect(targetPage.locator("#output")).toContainText("Fetch 请求成功");

    const stopButton = targetPage.locator("#__wbr_stop_btn__");
    await expect(stopButton).toBeVisible();
    await stopButton.click();
    const exportedDownload = await mediaProbe.waitForExportDownload();
    expect(exportedDownload.state).toBe("complete");

    // 7. 预览验证：网络记录被成功采集
    const previewPage = await context.newPage();
    await previewPage.goto(
      `chrome-extension://${extensionId}/preview.html?sessionId=${session.id}`
    );
    await previewPage.waitForLoadState("domcontentloaded");
    const evidence = await mediaProbe.persistedEvidence(
      previewPage,
      session.id
    );
    expect(await mediaProbe.activeSession()).toBeUndefined();
    expect(await mediaProbe.getBadgeText(targetTabId!)).toBe("");
    logE2e("OPT-003 dynamic display and full body E2E passed");
  });

  async function waitForNetworkBodyCaptured(
    mediaProbe: import("./fixtures/media-probe.ts").MediaProbe,
    sessionId: string,
    urlSubstr: string,
    timeoutMs = 10_000
  ): Promise<import("../src/shared/protocol.ts").NetworkEntry> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const persisted = await mediaProbe.persistedFullEvidence(sessionId);
      const target = persisted.networkEntries.find((e) =>
        e.url.includes(urlSubstr)
      );
      if (
        target?.response?.bodyStatus === "captured" &&
        typeof target?.response?.body === "string"
      ) {
        return target;
      }
      if (
        target?.response?.bodyStatus === "unavailable" ||
        target?.response?.bodyStatus === "not-present" ||
        target?.response?.bodyStatus === "redacted"
      ) {
        throw new Error(
          `Network body capture failed with status: ${target.response.bodyStatus}`
        );
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`TIMEOUT waiting for network body captured: ${urlSubstr}`);
  }

  test("OPT-004: validates un-truncated network response body capture in Full mode, checks contrast against Standard mode truncation, ensures sensitive token redaction, and verifies ZIP export integrity", async ({
    context,
    extensionId,
    openActionPopup,
    waitForPopupClosed,
    activeTabId,
    mediaProbe,
    serverUrl,
  }) => {
    let targetPage = context.pages()[0];
    if (!targetPage) targetPage = await context.newPage();
    await targetPage.goto(serverUrl);
    await targetPage.bringToFront();
    await targetPage.waitForFunction(() => document.hasFocus(), undefined, {
      timeout: 2_000,
    });

    const targetTabId = await activeTabId();
    expect(targetTabId).toBeTruthy();

    // =========================================================================
    // Phase 1. Contrast Baseline: Standard Mode Truncation (R2)
    // =========================================================================
    logE2e("OPT-004 Phase 1: Testing Standard mode baseline truncation");
    const popupStd = await openActionPopup(targetPage);
    await popupStd.waitForSelector('[data-testid="record-panel"]');
    await popupStd.click("#toggle-options");
    await popupStd.waitForSelector("#advanced-options");

    // 默认档位为 standard
    expect(
      await popupStd.evaluate<string>(
        "document.querySelector('#response-bodies')?.value || ''"
      )
    ).toBe("standard");

    await popupStd.click('[data-testid="start-recording-btn"]');
    await popupStd.evaluate("window.close()").catch(() => undefined);
    await popupStd.dispose();
    await targetPage.bringToFront();
    await waitForPopupClosed();
    await targetPage.waitForFunction(() => document.hasFocus(), undefined, {
      timeout: 2_000,
    });

    const stdSession = await mediaProbe.waitForSession(targetTabId!);
    expect(stdSession.options.captureNetwork).toBe(true);
    expect(stdSession.options.captureNetworkBodies).toBe(true);
    expect(stdSession.options.captureFullResponseBody).toBe(false);
    expect(stdSession.options.maxResponseBodyBytes).toBe(2 * 1024 * 1024);

    // 触发大报文请求
    await targetPage.bringToFront();
    await targetPage.locator('[data-testid="test-large-fetch-btn"]').click();
    await expect(
      targetPage.locator('[data-testid="large-fetch-status"]')
    ).toContainText("Large Fetch 成功", { timeout: 10_000 });

    // 等待网络正文采集完成（避免在正文读取过程中过早关闭 Debugger 会话）
    const stdLargeEntry = await waitForNetworkBodyCaptured(
      mediaProbe,
      stdSession.id,
      "/api/large-json"
    );

    const stopButtonStd = targetPage.locator("#__wbr_stop_btn__");
    await expect(stopButtonStd).toBeVisible();
    await stopButtonStd.click();
    const stdExportDownload = await mediaProbe.waitForExportDownload();
    expect(stdExportDownload.state).toBe("complete");

    // 验证基线对照：在默认 Standard 模式下，大报文发生字段级截断且标记为 truncated: true
    expect(stdLargeEntry).toBeDefined();
    expect(stdLargeEntry.response?.bodyStatus).toBe("captured");
    expect(stdLargeEntry.response?.truncated).toBe(true);
    expect(stdLargeEntry.response?.originalByteLength).toBeGreaterThan(
      3 * 1024 * 1024
    );
    // 单个 JSON 字段被截断到 8192 字符上限，并附带 \n[TRUNCATED] 标识，保留正文体积收缩至 ~8KB
    expect(stdLargeEntry.response?.capturedByteLength).toBeLessThan(15 * 1024);
    expect(stdLargeEntry.response?.capturedByteLength).toBeGreaterThan(
      8 * 1024
    );
    const stdParsed = JSON.parse(stdLargeEntry.response?.body ?? "{}");
    expect(stdParsed.token).toBe("[REDACTED:token]");
    expect(stdParsed.largeText.slice(0, 8192)).toBe("x".repeat(8192));
    expect(stdParsed.largeText.endsWith("[TRUNCATED]")).toBe(true);
    expect(stdParsed.largeText.length).toBe(8192 + "\n[TRUNCATED]".length);

    // 验证 Standard 模式导出的 ZIP 中 session-data.js 亦完整标记 truncated: true，且独立正文文件完整存在
    expect(stdExportDownload.filename).toBeTruthy();
    expect(fs.existsSync(stdExportDownload.filename)).toBe(true);
    const stdZipBuffer = fs.readFileSync(stdExportDownload.filename);
    const stdUnzipped = unzipSync(new Uint8Array(stdZipBuffer));
    expect(stdUnzipped["manifest.json"]).toBeDefined();
    expect(stdUnzipped["data/session-data.js"]).toBeDefined();
    const stdSessionDataJs = strFromU8(stdUnzipped["data/session-data.js"]!);
    expect(stdSessionDataJs).toContain('"truncated": true');
    expect(stdSessionDataJs).not.toContain("secret-token-e2e-opt004");

    const stdBodyFileKey = `network/body-${stdLargeEntry.id}.txt`;
    expect(stdUnzipped[stdBodyFileKey]).toBeDefined();
    const stdUnzippedBodyStr = strFromU8(stdUnzipped[stdBodyFileKey]!);
    expect(stdUnzippedBodyStr).toBe(stdLargeEntry.response?.body);
    const stdUnzippedParsed = JSON.parse(stdUnzippedBodyStr);
    expect(stdUnzippedParsed.token).toBe("[REDACTED:token]");
    expect(stdUnzippedParsed.largeText.endsWith("[TRUNCATED]")).toBe(true);
    expect(stdUnzippedParsed.largeText.slice(0, 8192)).toBe("x".repeat(8192));

    const stdManifestContent = JSON.parse(
      strFromU8(stdUnzipped["manifest.json"]!)
    ) as ExportManifest;
    const stdIntegrity = await verifyExportIntegrity(
      stdManifestContent,
      stdUnzipped
    );
    expect(stdIntegrity.valid).toBe(true);
    expect(stdIntegrity.invalidFiles).toEqual([]);
    expect(stdIntegrity.missingFiles).toEqual([]);
    logE2e("OPT-004 Phase 1: Standard mode baseline assertions passed");

    // 等待首个录制彻底释放
    const cleanupDeadline = Date.now() + 3_000;
    while (Date.now() < cleanupDeadline) {
      if (!(await mediaProbe.activeSession())) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(await mediaProbe.activeSession()).toBeUndefined();

    // =========================================================================
    // Phase 2. Core Verification: Full Mode Zero-Truncation (R3)
    // =========================================================================
    logE2e("OPT-004 Phase 2: Testing Full mode zero-truncation capture");
    await targetPage.goto(serverUrl);
    await targetPage.bringToFront();
    await targetPage.waitForFunction(() => document.hasFocus(), undefined, {
      timeout: 2_000,
    });

    const popupFull = await openActionPopup(targetPage);
    await popupFull.waitForSelector('[data-testid="record-panel"]');
    await popupFull.click("#toggle-options");
    await popupFull.waitForSelector("#advanced-options");

    // 选中 full 模式
    await popupFull.selectOptionByKeys("#response-bodies", "full");
    expect(
      await popupFull.evaluate<string>(
        "document.querySelector('#response-bodies')?.value || ''"
      )
    ).toBe("full");

    await popupFull.click('[data-testid="start-recording-btn"]');
    await popupFull.evaluate("window.close()").catch(() => undefined);
    await popupFull.dispose();
    await targetPage.bringToFront();
    await waitForPopupClosed();
    await targetPage.waitForFunction(() => document.hasFocus(), undefined, {
      timeout: 2_000,
    });

    const fullSession = await mediaProbe.waitForSession(targetTabId!);
    expect(fullSession.options.captureNetwork).toBe(true);
    expect(fullSession.options.captureNetworkBodies).toBe(true);
    // 1. session.options.captureFullResponseBody 记录为 true
    expect(fullSession.options.captureFullResponseBody).toBe(true);

    // 触发大报文请求
    await targetPage.bringToFront();
    await targetPage.locator('[data-testid="test-large-fetch-btn"]').click();
    await expect(
      targetPage.locator('[data-testid="large-fetch-status"]')
    ).toContainText("Large Fetch 成功", { timeout: 10_000 });

    // 等待 Full 模式下大报文正文完整入库
    const fullLargeEntry = await waitForNetworkBodyCaptured(
      mediaProbe,
      fullSession.id,
      "/api/large-json"
    );

    const stopButtonFull = targetPage.locator("#__wbr_stop_btn__");
    await expect(stopButtonFull).toBeVisible();
    await stopButtonFull.click();

    // 轮询等待本次 Full 录制的独立导出下载完成
    const fullDownloadDeadline = Date.now() + 15_000;
    let fullExportDownload:
      { filename: string; state: string; totalBytes?: number } | undefined;
    while (Date.now() < fullDownloadDeadline) {
      const latest = await mediaProbe.latestExportDownload();
      if (
        latest &&
        latest.state === "complete" &&
        latest.filename !== stdExportDownload.filename
      ) {
        fullExportDownload = latest;
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!fullExportDownload) {
      throw new Error(
        "TIMEOUT: Full mode export download not found or filename matched standard mode export"
      );
    }
    expect(fullExportDownload.state).toBe("complete");

    // 预览页打开与 IndexedDB 校验
    const previewPage = await context.newPage();
    await previewPage.goto(
      `chrome-extension://${extensionId}/preview.html?sessionId=${fullSession.id}`
    );
    await previewPage.waitForLoadState("domcontentloaded");

    const fullPersisted = await mediaProbe.persistedFullEvidence(
      fullSession.id
    );
    const previewLargeEntry = fullPersisted.networkEntries.find((e) =>
      e.url.includes("/api/large-json")
    );
    expect(previewLargeEntry).toBeDefined();
    expect(previewLargeEntry!.response?.bodyStatus).toBe("captured");
    // 2. 响应正文完整采集（>3MB），truncated 为 false 且无 [TRUNCATED] 后缀
    expect(previewLargeEntry!.response?.truncated).toBe(false);
    expect(previewLargeEntry!.response?.capturedByteLength).toBeGreaterThan(
      3 * 1024 * 1024
    );
    expect(previewLargeEntry!.response?.originalByteLength).toBeGreaterThan(
      3 * 1024 * 1024
    );
    expect(previewLargeEntry!.response?.body?.endsWith("[TRUNCATED]")).toBe(
      false
    );

    // 3. 3MB+ 的 largeText 字段保持完整且可解析
    const fullParsed = JSON.parse(previewLargeEntry!.response?.body ?? "{}");
    expect(fullParsed.largeText.length).toBeGreaterThan(3 * 1024 * 1024);
    expect(fullParsed.largeText).toBe(
      "x".repeat(Math.round(3.35 * 1024 * 1024))
    );
    expect(fullParsed.largeText.endsWith("[TRUNCATED]")).toBe(false);

    // 4. 敏感字段 token 安全脱敏为 [REDACTED:token]
    expect(fullParsed.token).toBe("[REDACTED:token]");

    // 在 Preview 页面自身上下文中直接读取 IndexedDB 验证
    const idbEvidence = await previewPage.evaluate(async (sid) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open("web-bug-recorder");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      try {
        const tx = db.transaction("networkEntries", "readonly");
        const store = tx.objectStore("networkEntries");
        const idx = store.index("sessionId");
        const entries = await new Promise<any[]>((resolve, reject) => {
          const req = idx.getAll(sid);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        const target = entries.find((e: any) =>
          e.url?.includes("/api/large-json")
        );
        const parsed = JSON.parse(target?.response?.body ?? "{}");
        return {
          found: Boolean(target),
          truncated: target?.response?.truncated,
          capturedByteLength: target?.response?.capturedByteLength,
          bodyLength: target?.response?.body?.length,
          hasRedactedToken: parsed.token === "[REDACTED:token]",
          hasRawToken: target?.response?.body?.includes(
            "secret-token-e2e-opt004"
          ),
          largeTextLength:
            typeof parsed.largeText === "string" ? parsed.largeText.length : 0,
          largeTextTruncated: Boolean(
            parsed.largeText?.endsWith("[TRUNCATED]")
          ),
        };
      } finally {
        db.close();
      }
    }, fullSession.id);

    expect(idbEvidence.found).toBe(true);
    expect(idbEvidence.truncated).toBe(false);
    expect(idbEvidence.capturedByteLength).toBeGreaterThan(3 * 1024 * 1024);
    expect(idbEvidence.bodyLength).toBeGreaterThan(3 * 1024 * 1024);
    expect(idbEvidence.hasRedactedToken).toBe(true);
    expect(idbEvidence.hasRawToken).toBe(false);
    expect(idbEvidence.largeTextLength).toBeGreaterThan(3 * 1024 * 1024);
    expect(idbEvidence.largeTextTruncated).toBe(false);
    logE2e("OPT-004 Phase 2: Full mode zero-truncation and IDB check passed");

    // =========================================================================
    // Phase 3. Export Artifact Integrity (R4)
    // =========================================================================
    logE2e("OPT-004 Phase 3: Verifying exported ZIP package integrity");
    expect(fullExportDownload.filename).toBeTruthy();
    expect(fs.existsSync(fullExportDownload.filename)).toBe(true);
    const zipBuffer = fs.readFileSync(fullExportDownload.filename);
    expect(zipBuffer.byteLength).toBeGreaterThan(0);

    const unzipped = unzipSync(new Uint8Array(zipBuffer));
    expect(unzipped["manifest.json"]).toBeDefined();
    expect(unzipped["data/session-data.js"]).toBeDefined();

    // 导出的 ZIP 归档包含完整未截断的大报文正文文件 network/body-${fullLargeEntry.id}.txt
    const bodyFileKey = `network/body-${fullLargeEntry!.id}.txt`;
    expect(unzipped[bodyFileKey]).toBeDefined();
    const unzippedBodyStr = strFromU8(unzipped[bodyFileKey]!);

    // 与持久化预览数据一致，且大于 3MB，无截断
    expect(unzippedBodyStr).toBe(fullLargeEntry!.response?.body);
    expect(unzippedBodyStr.length).toBeGreaterThan(3 * 1024 * 1024);
    expect(unzippedBodyStr.endsWith("[TRUNCATED]")).toBe(false);

    const unzippedParsed = JSON.parse(unzippedBodyStr);
    expect(unzippedParsed.token).toBe("[REDACTED:token]");
    expect(unzippedParsed.largeText.length).toBeGreaterThan(3 * 1024 * 1024);
    expect(unzippedParsed.largeText).toBe(fullParsed.largeText);
    expect(unzippedParsed.largeText.endsWith("[TRUNCATED]")).toBe(false);

    // 校验 session-data.js 中的引用与元数据
    const sessionDataJs = strFromU8(unzipped["data/session-data.js"]!);
    expect(sessionDataJs).toContain(`"bodyPath": "${bodyFileKey}"`);
    expect(sessionDataJs).toContain('"truncated": false');
    expect(sessionDataJs).not.toContain("secret-token-e2e-opt004");
    expect(unzippedBodyStr).not.toContain("secret-token-e2e-opt004");

    // 校验 ZIP Manifest 完整性
    const manifestContent = JSON.parse(
      strFromU8(unzipped["manifest.json"]!)
    ) as ExportManifest;
    const integrity = await verifyExportIntegrity(manifestContent, unzipped);
    expect(integrity.valid).toBe(true);
    expect(integrity.invalidFiles).toEqual([]);
    expect(integrity.missingFiles).toEqual([]);

    expect(await mediaProbe.activeSession()).toBeUndefined();
    expect(await mediaProbe.getBadgeText(targetTabId!)).toBe("");
    logE2e("OPT-004 all assertions passed successfully");
  });
});
