import { test, expect } from "./fixtures/extension.ts";
import fs from "node:fs";
import { unzipSync } from "fflate";

test.describe("跨标签页生命周期与极端边界测试 (Multi-Tab Lifecycle Edge)", () => {
  test("LIFECYCLE-001: 初始主标签页中途关闭，副标签页提升并成功封包", async ({
    context,
    openActionPopup,
    mediaProbe,
    serviceWorker,
    serverUrl,
    extensionId,
  }) => {
    // 1. 打开 Tab 1 启动录制并等待 2.5 秒（保证产生初始 Tab 的有效媒体分片）
    const tab1Url = serverUrl.replace("mock-page.html", "tab1-admin.html");
    let tab1Page = context.pages()[0];
    if (!tab1Page) tab1Page = await context.newPage();
    await tab1Page.goto(tab1Url);
    await tab1Page.bringToFront();

    const popup = await openActionPopup(tab1Page);
    await popup.waitForSelector('[data-testid="record-panel"]');
    const tab1Id = await popup.evaluate<number | undefined>(
      "(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id)()"
    );
    expect(tab1Id).toBeTruthy();

    await popup.click('[data-testid="start-recording-btn"]');
    await popup.dispose();

    const session = await mediaProbe.waitForSession(tab1Id!, 10_000);
    await mediaProbe.waitForActive(session.id, tab1Id!, 10_000);

    const tab1ClickBtn = tab1Page.locator('[data-testid="test-click-btn"]');
    await tab1ClickBtn.click();
    // 等待 2.5 秒，保证媒体切片落盘
    await tab1Page.waitForTimeout(2500);

    // 2. 打开 Tab 2 并聚焦
    const tab2Url = serverUrl.replace("mock-page.html", "tab2-client.html");
    const tab2Page = await context.newPage();
    await tab2Page.goto(tab2Url);
    await tab2Page.bringToFront();
    await tab2Page.waitForTimeout(800);

    const tab2StopBtn = tab2Page.locator("#__wbr_stop_btn__");
    await expect(tab2StopBtn).toBeVisible({ timeout: 8000 });

    const tab2ClickBtn = tab2Page.locator('[data-testid="test-click-btn"]');
    await tab2ClickBtn.click();
    await tab2Page.waitForTimeout(300);

    // 3. 关键动作：直接彻底关闭初始主标签页 Tab 1！
    await tab1Page.close();
    await tab2Page.waitForTimeout(600);

    // 4. 验证 Tab 2 顺利晋升为主标签页，挂件持续存活且未崩溃
    await expect(tab2StopBtn).toBeVisible({ timeout: 5000 });
    const tab2TextInput = tab2Page.locator('[data-testid="test-text-input"]');
    await tab2TextInput.fill("主页关闭后副页接管操作");
    await tab2TextInput.press("Enter");
    await tab2Page.waitForTimeout(500);

    // 5. 在 Tab 2 上点击结束录制并导出
    await tab2StopBtn.click();

    // 6. 验证导出产物完整性
    const exportedDownload = await mediaProbe.waitForExportDownload(20_000);
    expect(exportedDownload.state).toBe("complete");

    const fullEvidence = await mediaProbe.persistedFullEvidence(session.id);
    expect(fullEvidence.interactions.length).toBeGreaterThanOrEqual(3);

    // 验证 Tab 1 录制产生的媒体资产依然完整保存在 ZIP 中
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

      const mediaEntry =
        unzipped["media/recording.webm"] || unzipped["media/recording.mp4"];
      expect(mediaEntry.byteLength).toBeGreaterThan(0);
    }

    // 7. 验证预览页能正常播放 Tab 1 在关闭前录下的媒体视频
    const previewPage = await context.newPage();
    await previewPage.goto(
      `chrome-extension://${extensionId}/preview.html?sessionId=${session.id}`
    );
    await previewPage.waitForLoadState("domcontentloaded");

    const videoLocator = previewPage.locator("#video");
    await expect(videoLocator).toBeVisible({ timeout: 10000 });
    await expect(previewPage.locator("#video-empty")).toBeHidden();

    const videoDuration = await videoLocator.evaluate<number>((v: HTMLVideoElement) => {
      return new Promise((resolve) => {
        if (v.duration && !isNaN(v.duration)) {
          resolve(v.duration);
        } else {
          v.addEventListener("loadedmetadata", () => resolve(v.duration), { once: true });
        }
      });
    });
    expect(videoDuration).toBeGreaterThan(0);
  });

  test("LIFECYCLE-002: 所有受纳管标签页相继关闭时触发自动优雅收口", async ({
    context,
    openActionPopup,
    mediaProbe,
    serviceWorker,
    serverUrl,
  }) => {
    // 1. 打开 Tab 1 并启动录制
    const tab1Url = serverUrl.replace("mock-page.html", "auto-close-1.html");
    let tab1Page = context.pages()[0];
    if (!tab1Page) tab1Page = await context.newPage();
    await tab1Page.goto(tab1Url);
    await tab1Page.bringToFront();

    const popup = await openActionPopup(tab1Page);
    await popup.waitForSelector('[data-testid="record-panel"]');
    const tab1Id = await popup.evaluate<number | undefined>(
      "(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id)()"
    );
    expect(tab1Id).toBeTruthy();

    await popup.click('[data-testid="start-recording-btn"]');
    await popup.dispose();

    const session = await mediaProbe.waitForSession(tab1Id!, 10_000);
    await mediaProbe.waitForActive(session.id, tab1Id!, 10_000);

    // 2. 打开 Tab 2 并聚焦
    const tab2Url = serverUrl.replace("mock-page.html", "auto-close-2.html");
    const tab2Page = await context.newPage();
    await tab2Page.goto(tab2Url);
    await tab2Page.bringToFront();
    await tab2Page.waitForTimeout(800);

    await expect(tab2Page.locator("#__wbr_stop_btn__")).toBeVisible({ timeout: 8000 });

    // 3. 不点击任何停止按钮，相继关闭所有受纳管标签页
    await tab2Page.close();
    await tab1Page.close();

    // 4. 等待后台自动触发 onAllTabsClosed 优雅收口
    const finalSession = await mediaProbe.waitForSessionStatus(
      session.id,
      "PREVIEW_READY",
      15_000
    );
    expect(finalSession.status).toBe("PREVIEW_READY");
    expect(await mediaProbe.activeSession()).toBeUndefined();
  });

  test("LIFECYCLE-003: 录制中访问特权/内嵌页面时的静默旁路与返回恢复", async ({
    context,
    openActionPopup,
    mediaProbe,
    serviceWorker,
    serverUrl,
    extensionId,
  }) => {
    // 1. 打开常规网页 Tab 1 启动录制
    const tab1Url = serverUrl.replace("mock-page.html", "privileged-test.html");
    let tab1Page = context.pages()[0];
    if (!tab1Page) tab1Page = await context.newPage();
    await tab1Page.goto(tab1Url);
    await tab1Page.bringToFront();

    const popup = await openActionPopup(tab1Page);
    await popup.waitForSelector('[data-testid="record-panel"]');
    const tab1Id = await popup.evaluate<number | undefined>(
      "(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id)()"
    );
    expect(tab1Id).toBeTruthy();

    await popup.click('[data-testid="start-recording-btn"]');
    await popup.dispose();

    const session = await mediaProbe.waitForSession(tab1Id!, 10_000);
    await mediaProbe.waitForActive(session.id, tab1Id!, 10_000);

    // 2. 切到一个插件内部设置页 (chrome-extension://.../options.html)
    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);
    await optionsPage.bringToFront();
    await optionsPage.waitForTimeout(800);

    // 3. 切回常规网页 Tab 1
    await tab1Page.bringToFront();
    await tab1Page.waitForTimeout(500);

    // 4. 验证 Tab 1 挂件持续正常运作，执行交互并正常停止导出
    const clickBtn = tab1Page.locator('[data-testid="test-click-btn"]');
    await clickBtn.click();
    await tab1Page.waitForTimeout(300);

    const stopBtn = tab1Page.locator("#__wbr_stop_btn__");
    await expect(stopBtn).toBeVisible({ timeout: 5000 });
    await stopBtn.click();

    const exportedDownload = await mediaProbe.waitForExportDownload(20_000);
    expect(exportedDownload.state).toBe("complete");
    expect(exportedDownload.totalBytes ?? 0).toBeGreaterThan(0);
  });
});
