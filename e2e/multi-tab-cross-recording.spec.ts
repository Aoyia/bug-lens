import { test, expect } from "./fixtures/extension.ts";
import fs from "node:fs";
import { unzipSync } from "fflate";

test.describe("跨标签页/跨网页联动录制端到端测试 (Multi-Tab Cross-Recording)", () => {
  test("MULTI-TAB-001: 先操作后台标签页，再切到前台标签页操作，挂件全自动同步并在前台完成导出", async ({
    context,
    openActionPopup,
    mediaProbe,
    serviceWorker,
    serverUrl,
    extensionId,
  }) => {
    // 1. 打开 Tab 1：后台管理系统
    const adminUrl = serverUrl.replace("mock-page.html", "admin-page.html");
    let adminPage = context.pages()[0];
    if (!adminPage) adminPage = await context.newPage();
    await adminPage.goto(adminUrl);
    await adminPage.bringToFront();

    // 2. 唤起 Popup 启动录制
    const popup = await openActionPopup(adminPage);
    await popup.waitForSelector('[data-testid="record-panel"]');

    const adminTabId = await popup.evaluate<number | undefined>(
      "(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id)()"
    );
    expect(adminTabId).toBeTruthy();

    await popup.click('[data-testid="start-recording-btn"]');
    await popup.dispose();

    const session = await mediaProbe.waitForSession(adminTabId!, 10_000);
    await mediaProbe.waitForActive(session.id, adminTabId!, 10_000);

    // 3. 在后台页面（Tab 1）执行配置操作：点击测试按钮与文本输入
    await adminPage.bringToFront();
    const adminClickBtn = adminPage.locator('[data-testid="test-click-btn"]');
    await expect(adminClickBtn).toBeVisible({ timeout: 5000 });
    await adminClickBtn.click();
    await adminPage.waitForTimeout(300);

    const adminTextInput = adminPage.locator('[data-testid="test-text-input"]');
    await adminTextInput.fill("后台参数配置已下发");
    await adminTextInput.press("Enter");
    await adminPage.waitForTimeout(500);

    // 4. 打开 Tab 2：前台商城/客户端验证页面，并激活焦点
    const clientUrl = serverUrl.replace("mock-page.html", "client-page.html");
    const clientPage = await context.newPage();
    await clientPage.goto(clientUrl);
    await clientPage.bringToFront();
    await clientPage.waitForTimeout(800);

    // 关键验证 1：前台页面激活后，MultiTabManager 必须全自动纳管 Tab 2 并挂载录制挂件！
    const clientStopBtn = clientPage.locator("#__wbr_stop_btn__");
    await expect(clientStopBtn).toBeVisible({ timeout: 8000 });

    // 5. 在前台页面（Tab 2）执行验证操作：点击按钮触发前台交互与网络请求
    const clientClickBtn = clientPage.locator('[data-testid="test-click-btn"]');
    await expect(clientClickBtn).toBeVisible();
    await clientClickBtn.click();
    await clientPage.waitForTimeout(300);

    // 关键验证 2：密集高频连续点击（验证突破 Chrome 每秒 2 次 captureVisibleTab 配额机制）
    for (let i = 0; i < 3; i++) {
      await clientClickBtn.click();
      await clientPage.waitForTimeout(80);
    }
    await clientPage.waitForTimeout(300);

    const clientTextInput = clientPage.locator(
      '[data-testid="test-text-input"]'
    );
    await clientTextInput.fill("前台商城已成功读取新数据");
    await clientTextInput.press("Enter");
    await clientPage.waitForTimeout(800);

    // 关键验证 3：直接在前台页面（Tab 2）的悬浮挂件上点击停止按钮完成导出！
    await clientStopBtn.click();

    // 6. 验证导出下载产物完整性
    const exportedDownload = await mediaProbe.waitForExportDownload(20_000);
    expect(exportedDownload.state).toBe("complete");
    expect(exportedDownload.totalBytes ?? 0).toBeGreaterThan(0);

    // 7. 深入验证证据包：既包含后台操作，也包含前台操作！
    const fullEvidence = await mediaProbe.persistedFullEvidence(session.id);
    expect(fullEvidence.interactions.length).toBeGreaterThanOrEqual(7);

    // 关键断言：跨标签页及高频密集点击下所有截图必须全量 captured，不可有 unavailable
    const unavailableCount = fullEvidence.interactions.filter(
      (it) => it.screenshot?.status === "unavailable"
    ).length;
    expect(unavailableCount).toBe(0);

    const urls = fullEvidence.interactions.map((i) => i.page.url);
    const hasAdminPage = urls.some((u) => u.includes("admin-page.html"));
    const hasClientPage = urls.some((u) => u.includes("client-page.html"));

    expect(hasAdminPage).toBe(true);
    expect(hasClientPage).toBe(true);

    // 验证物理 ZIP 包
    if (exportedDownload.filename && fs.existsSync(exportedDownload.filename)) {
      const zipBuffer = fs.readFileSync(exportedDownload.filename);
      const unzipped = unzipSync(new Uint8Array(zipBuffer));
      const zipFiles = Object.keys(unzipped);

      expect(zipFiles).toContain("manifest.json");
      expect(zipFiles).toContain("data/session-data.js");
      expect(
        zipFiles.some(
          (f) => f === "media/recording.webm" || f === "media/recording.mp4"
        )
      ).toBe(true);

      const sessionDataCode = new TextDecoder().decode(
        unzipped["data/session-data.js"]
      );
      expect(sessionDataCode).toContain("admin-page.html");
      expect(sessionDataCode).toContain("client-page.html");
    }

    // 8. 核心验证：在预览页面中，即便切过 Tab，初始标签页的录像必须 100% 正常挂载与播放！
    const previewPage = await context.newPage();
    await previewPage.goto(
      `chrome-extension://${extensionId}/preview.html?sessionId=${session.id}`
    );
    await previewPage.waitForLoadState("domcontentloaded");

    const videoLocator = previewPage.locator("#video");
    const videoEmptyLocator = previewPage.locator("#video-empty");

    // 视频播放器必须成功显示，且空白占位必须隐藏
    await expect(videoLocator).toBeVisible({ timeout: 10000 });
    await expect(videoEmptyLocator).toBeHidden();

    // 验证视频已具备可播放时长
    const videoDuration = await videoLocator.evaluate((v: HTMLVideoElement) => {
      return new Promise<number>((resolve) => {
        if (v.duration && !isNaN(v.duration)) {
          resolve(v.duration);
        } else {
          v.addEventListener("loadedmetadata", () => resolve(v.duration), {
            once: true,
          });
        }
      });
    });
    expect(videoDuration).toBeGreaterThan(0);
  });

  test("MULTI-TAB-002: 真实超链接 target='_blank' 派生新标签页并双向往返切换流转", async ({
    context,
    openActionPopup,
    mediaProbe,
    serviceWorker,
    serverUrl,
    extensionId,
  }) => {
    // 1. 打开 Tab 1：发起来源页面
    const sourceUrl = serverUrl.replace("mock-page.html", "source-page.html");
    let sourcePage = context.pages()[0];
    if (!sourcePage) sourcePage = await context.newPage();
    await sourcePage.goto(sourceUrl);
    await sourcePage.bringToFront();

    // 2. 启动录制
    const popup = await openActionPopup(sourcePage);
    await popup.waitForSelector('[data-testid="record-panel"]');
    const sourceTabId = await popup.evaluate<number | undefined>(
      "(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id)()"
    );
    expect(sourceTabId).toBeTruthy();

    await popup.click('[data-testid="start-recording-btn"]');
    await popup.dispose();

    const session = await mediaProbe.waitForSession(sourceTabId!, 10_000);
    await mediaProbe.waitForActive(session.id, sourceTabId!, 10_000);

    // 3. 在 Tab 1 执行初次交互
    const clickBtn = sourcePage.locator('[data-testid="test-click-btn"]');
    await clickBtn.click();
    await sourcePage.waitForTimeout(300);

    // 4. 在 Tab 1 动态注入包含 target="_blank" 的真实超链接并点击，模拟真实网页事件派生开页
    const targetUrl = serverUrl.replace(
      "mock-page.html",
      "derived-target.html"
    );
    const [derivedPage] = await Promise.all([
      context.waitForEvent("page"),
      sourcePage.evaluate((url) => {
        const link = document.createElement("a");
        link.id = "real-derived-link";
        link.href = url;
        link.target = "_blank";
        link.textContent = "打开真实派生页";
        document.body.appendChild(link);
        link.click();
      }, targetUrl),
    ]);

    await derivedPage.waitForLoadState("domcontentloaded");
    await derivedPage.bringToFront();
    await derivedPage.waitForTimeout(800);

    // 验证 Tab 2 自动纳管并挂载录制挂件
    const derivedStopBtn = derivedPage.locator("#__wbr_stop_btn__");
    await expect(derivedStopBtn).toBeVisible({ timeout: 8000 });

    // 5. 在 Tab 2 执行交互
    const derivedClickBtn = derivedPage.locator(
      '[data-testid="test-click-btn"]'
    );
    await derivedClickBtn.click();
    await derivedPage.waitForTimeout(300);

    // 6. 核心往返：从 Tab 2 再次切回 Tab 1！
    await sourcePage.bringToFront();
    await sourcePage.waitForTimeout(500);

    // 验证切回后 Tab 1 上的挂件依然正常可见，且能继续交互
    const sourceStopBtn = sourcePage.locator("#__wbr_stop_btn__");
    await expect(sourceStopBtn).toBeVisible({ timeout: 5000 });
    await clickBtn.click();
    await sourcePage.waitForTimeout(400);

    // 7. 在 Tab 1 上点击结束并导出
    await sourceStopBtn.click();

    // 8. 验证导出产物
    const exportedDownload = await mediaProbe.waitForExportDownload(20_000);
    expect(exportedDownload.state).toBe("complete");

    const fullEvidence = await mediaProbe.persistedFullEvidence(session.id);
    expect(fullEvidence.interactions.length).toBeGreaterThanOrEqual(3);

    // 验证截图无 unavailable
    const unavailableCount = fullEvidence.interactions.filter(
      (it) => it.screenshot?.status === "unavailable"
    ).length;
    expect(unavailableCount).toBe(0);

    // 验证既包含 Tab 1 也包含 Tab 2
    const urls = fullEvidence.interactions.map((i) => i.page.url);
    expect(urls.some((u) => u.includes("source-page.html"))).toBe(true);
    expect(urls.some((u) => u.includes("derived-target.html"))).toBe(true);

    // 验证物理 ZIP
    if (exportedDownload.filename && fs.existsSync(exportedDownload.filename)) {
      const zipBuffer = fs.readFileSync(exportedDownload.filename);
      const unzipped = unzipSync(new Uint8Array(zipBuffer));
      const zipFiles = Object.keys(unzipped);

      expect(zipFiles).toContain("manifest.json");
      expect(zipFiles).toContain("data/session-data.js");
      expect(
        zipFiles.some(
          (f) => f === "media/recording.webm" || f === "media/recording.mp4"
        )
      ).toBe(true);
    }
  });
});
