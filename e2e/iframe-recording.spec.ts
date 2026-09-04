import { test, expect, safeUrlForLog } from "./fixtures/extension.ts";

function logE2e(message: string, details?: unknown): void {
  const suffix = details === undefined ? "" : ` ${JSON.stringify(details)}`;
  console.log(
    `[Bug Lens E2E][${new Date().toISOString()}] ${message}${suffix}`
  );
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

test.describe("Bug Lens Chrome Extension E2E IFRAME-001: Multi-Frame & Iframe Recording Journey", () => {
  test("IFRAME-001: records interactions across top frame and iframe, normalizes coordinates, captures CDP OOPIF logs/network, and displays frame badges in preview", async ({
    context,
    extensionId,
    openActionPopup,
    mediaProbe,
    serverUrl,
  }) => {
    const scenarioId = "IFRAME-001";
    const iframeHostUrl = serverUrl.replace(
      "mock-page.html",
      "iframe-host.html"
    );

    context.on("console", (message) => {
      logE2e(`Browser console.${message.type()}`, {
        url:
          safeUrlForLog(message.page()?.url()) ?? "extension-worker-or-popup",
        text: message.text(),
      });
    });

    // 1. 加载包含 iframe 的宿主测试页面
    let targetPage = context.pages()[0];
    if (!targetPage) targetPage = await context.newPage();
    await targetPage.goto(iframeHostUrl);
    logE2e(`${scenarioId}: Target iframe host page loaded`, {
      url: targetPage.url(),
    });

    await targetPage.bringToFront();
    await targetPage.waitForFunction(() => document.hasFocus(), undefined, {
      timeout: 2_000,
    });

    // 等待 iframe 加载就绪
    const childFrame = targetPage.frameLocator("#child-frame");
    await expect(childFrame.locator("#child-input")).toBeVisible({
      timeout: 5_000,
    });
    logE2e(`${scenarioId}: Child iframe confirmed loaded`);

    // 2. 通过真实 Action Popup 启动录制
    const popup = await openActionPopup(targetPage);
    await popup.waitForSelector('[data-testid="record-panel"]');

    const targetTabId = await popup.evaluate<number | undefined>(
      "(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id)()"
    );
    expect(targetTabId).toBeTruthy();

    await popup.click('[data-testid="start-recording-btn"]');
    await popup.dispose();

    // 3. 等待 Session 激活
    const session = await mediaProbe.waitForSession(targetTabId!);
    const activeMedia = await mediaProbe.waitForActive(
      session.id,
      targetTabId!
    );
    logE2e(`${scenarioId}: Recording started`, {
      sessionId: session.id,
      privacyMode: session.options.privacyMode,
    });

    expect(activeMedia.capture?.status).toBe("active");
    expect(activeMedia.offscreenActive).toBe(true);

    // 4. 验证 R1：Top-Centric 守卫——主页面挂载控制挂件，子 iframe 绝不重复挂载
    const topMarkIssueBtn = targetPage.locator("#__wbr_issue_btn__");
    await expect(topMarkIssueBtn).toBeVisible({ timeout: 5_000 });

    const childMarkIssueBtn = childFrame.locator("#__wbr_issue_btn__");
    await expect(childMarkIssueBtn).toHaveCount(0);
    logE2e(`${scenarioId}: Verified Top-Centric UI isolation`);

    // 5. 在主页面 Top Frame 执行交互
    await targetPage.fill("#host-input", "Top Frame 输入内容");
    await delay(300);
    await targetPage.click("#host-btn");
    await expect(targetPage.locator("#host-status")).toContainText(
      "主页面点击已被记录"
    );
    await delay(400);

    // 6. 在嵌入的子 iframe 中执行交互与网络/错误触发
    // (1) 子 iframe 输入
    await childFrame.locator("#child-input").fill("Child Frame 输入文字");
    await delay(300);

    // (2) 子 iframe 触发控制台报错
    await childFrame.locator("#child-error-btn").click();
    await expect(childFrame.locator("#child-status")).toContainText(
      "子 Frame 报错已触发"
    );
    await delay(350);

    // (3) 子 iframe 触发网络 API Fetch
    await childFrame.locator("#child-fetch-btn").click();
    await expect(childFrame.locator("#child-status")).toContainText(
      "子 Frame Fetch 成功"
    );
    await delay(350);

    // (4) 子 iframe 普通点击
    await childFrame.locator("#child-btn").click();
    await expect(childFrame.locator("#child-status")).toContainText(
      "子 Frame 点击成功"
    );
    await delay(400);

    // 7. 等待证据沉淀
    await mediaProbe.waitForEvidenceCounts(session.id, {
      interactionCount: 2,
      consoleCount: 2,
      networkCount: 1,
    });
    await mediaProbe.waitForMediaChunkCountGreaterThan(session.id, 0);

    logE2e(`${scenarioId}: All multi-frame evidence captured in target page`);

    // 8. 停止录制并导出
    const stopBtn = targetPage.locator("#__wbr_stop_btn__");
    await expect(stopBtn).toBeVisible();

    await stopBtn.click();
    const exportedDownload = await mediaProbe.waitForExportDownload();
    expect(exportedDownload.state).toBe("complete");

    // 9. 打开 Preview 页面并验证持久化证据
    const previewPage = await context.newPage();
    await previewPage.goto(
      `chrome-extension://${extensionId}/preview.html?sessionId=${session.id}`
    );
    await previewPage.waitForLoadState("domcontentloaded");

    const persisted = await mediaProbe.persistedFullEvidence(session.id);
    logE2e(`${scenarioId}: Persisted evidence inspection`, {
      interactionsCount: persisted.interactions.length,
      consoleCount: persisted.consoleEntries.length,
      networkCount: persisted.networkEntries.length,
    });

    // 10. 验证 R2 坐标归一化与 frameId 绑定
    const childInteractions = persisted.interactions.filter(
      (i) => i.page.frameId !== 0 && i.page.frameId !== undefined
    );
    expect(childInteractions.length).toBeGreaterThanOrEqual(1);

    const firstChildInteraction = childInteractions[0];
    logE2e(`${scenarioId}: Inspect child interaction coordinates`, {
      frameId: firstChildInteraction.page.frameId,
      coordinates: firstChildInteraction.coordinates,
    });
    expect(firstChildInteraction.coordinates.clientX).toBeGreaterThan(0);
    expect(firstChildInteraction.coordinates.clientY).toBeGreaterThan(0);
    // localX / localY 必须记录内部坐标
    expect(firstChildInteraction.coordinates.localX).toBeDefined();
    expect(firstChildInteraction.coordinates.localY).toBeDefined();

    // 11. 验证 R3 CDP OOPIF 控制台与网络穿透
    const childConsoleEntry = persisted.consoleEntries.find((c) =>
      c.text.includes("[E2E-IFRAME-CHILD-ERROR]")
    );
    expect(childConsoleEntry).toBeDefined();
    expect(childConsoleEntry?.frameId).toBeDefined();

    const childNetworkEntry = persisted.networkEntries.find((n) =>
      n.url.includes("/api/iframe-child-data")
    );
    expect(childNetworkEntry).toBeDefined();
    expect(childNetworkEntry?.frameId).toBeDefined();

    // 12. 验证 Preview 页面中的 Frame 徽章与过滤 UI
    // (1) Console Tab 校验
    await previewPage.locator('.zen-tab-btn[data-tab="console"]').click();
    const consolePane = previewPage.locator("#tab-pane-console");
    await expect(consolePane).toBeVisible();

    const childErrorRow = consolePane.locator(".console-row-error").first();
    await expect(childErrorRow).toBeVisible();
    await expect(childErrorRow.locator(".console-frame-badge")).toBeVisible();

    // (2) Network Tab 校验
    await previewPage.locator('.zen-tab-btn[data-tab="network"]').click();
    const networkPane = previewPage.locator("#tab-pane-network");
    await expect(networkPane).toBeVisible();

    const childNetRow = networkPane
      .locator(".network-row")
      .filter({ hasText: "/api/iframe-child-data" })
      .first();
    await expect(childNetRow).toBeVisible();
    await expect(childNetRow.locator(".network-frame-badge")).toBeVisible();

    logE2e(`${scenarioId}: All iframe recording assertions verified cleanly`);
  });
});
