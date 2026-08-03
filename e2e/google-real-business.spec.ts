import { test, expect } from "./fixtures/extension.ts";
import type { InteractionRecord } from "../src/shared/protocol.ts";

function logE2e(message: string, details?: unknown): void {
  const suffix = details === undefined ? "" : ` ${JSON.stringify(details)}`;
  console.log(
    `[Bug Lens E2E Real Business][${new Date().toISOString()}] ${message}${suffix}`
  );
}

test.describe("Bug Lens 真实用户 Google 业务流 E2E 测试 (包 4c41242b 还原)", () => {
  test("REAL-BUS-001: 还原真实 Google 搜索的全套 8 步交互流程与 Preview 卡片展示", async ({
    context,
    extensionId,
    openActionPopup,
    mediaProbe,
  }) => {
    const googleUrl = "https://www.google.com/webhp";

    let targetPage = context.pages()[0];
    if (!targetPage) targetPage = await context.newPage();

    logE2e("Navigating to real Google homepage", { url: googleUrl });
    try {
      await targetPage.goto(googleUrl, {
        waitUntil: "domcontentloaded",
        timeout: 20_000,
      });
    } catch (err) {
      logE2e("Navigation warning, continuing test", { error: String(err) });
    }

    await targetPage.bringToFront();
    await targetPage.waitForTimeout(1000);

    // 打开 Action Popup 启动录制
    const startPopup = await openActionPopup(targetPage);
    await startPopup.waitForSelector('[data-testid="record-panel"]');

    const targetTabId = await startPopup.evaluate<number | undefined>(
      "(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id)()"
    );
    expect(targetTabId).toBeTruthy();

    await startPopup.click('[data-testid="start-recording-btn"]');
    logE2e("Recording started on real Google page", { targetTabId });
    await startPopup.dispose();

    // 给予充裕的等待时间 (15s)，适应真实网络环境
    const session = await mediaProbe.waitForSession(targetTabId!, 15_000);
    await mediaProbe.waitForActive(session.id, targetTabId!, 15_000);
    logE2e("Recording session active", { sessionId: session.id });

    await targetPage.bringToFront();
    await targetPage.waitForTimeout(500);

    // ─── 还原 Zip 包 4c41242b 中的 8 步真实用户交互链条 ───

    // Step 1: 点击 Google Logo / SVG 元素
    const logo = targetPage.locator("svg, img[alt='Google']").first();
    if (await logo.isVisible()) {
      await logo.click({ force: true }).catch(() => undefined);
      logE2e("Step 1: Clicked Google logo/SVG");
      await targetPage.waitForTimeout(400);
    }

    // Step 2: 点击搜索框 textarea[name='q'] (#APjFqb)
    const searchInput = targetPage
      .locator('textarea[name="q"], #APjFqb')
      .first();
    await searchInput.click({ force: true });
    logE2e("Step 2: Clicked search textarea");
    await targetPage.waitForTimeout(400);

    // Step 3: 输入文字 "你好呀，今天是雨天" (与证据包 4c41242b 完全相同)
    const searchText = "你好呀，今天是雨天";
    await searchInput.fill(searchText);
    logE2e("Step 3: Inputted search text", { text: searchText });
    await targetPage.waitForTimeout(600);

    // Step 4: 按下 Enter 键
    await searchInput.press("Enter");
    logE2e("Step 4: Pressed Enter to submit search");
    await targetPage.waitForTimeout(2500);

    // Step 5: 点击搜索结果区域 (如 #rcnt)
    const resultContainer = targetPage.locator("#rcnt, #search, main").first();
    if (await resultContainer.isVisible()) {
      await resultContainer.click({ force: true }).catch(() => undefined);
      logE2e("Step 6: Clicked search results container");
    }
    await targetPage.waitForTimeout(400);

    // Step 6 & 7: 触发快捷键按键组合 (如 ControlOrMeta+r)
    await targetPage.keyboard.press("ControlOrMeta+r").catch(() => undefined);
    logE2e("Step 7/8: Dispatched Meta+R keyboard shortcut");
    await targetPage.waitForTimeout(1000);

    // ─── 停止录制并打开 Preview 页面 ───
    const stopButton = targetPage.locator("#__wbr_stop_btn__");
    await expect(stopButton).toBeVisible();

    const previewPagePromise = context.waitForEvent("page", {
      predicate: (page) =>
        page.url().startsWith(`chrome-extension://${extensionId}/preview.html`),
      timeout: 15_000,
    });

    await stopButton.click();
    const previewPage = await previewPagePromise;
    await previewPage.waitForLoadState("domcontentloaded");
    logE2e("Preview page opened successfully");

    // 读取并验证数据库落盘的全套证据
    const evidence = await mediaProbe.persistedFullEvidence(session.id);
    logE2e("Evidences collected", {
      interactionCount: evidence.interactions.length,
      kinds: evidence.interactions.map((i: InteractionRecord) => i.kind),
    });

    expect(evidence.interactions.length).toBeGreaterThan(0);

    // 验证包含目标搜索词的输入记录或包含 Enter 的 keydown 记录
    const hasSearchInput = evidence.interactions.some(
      (i: InteractionRecord) =>
        i.metadata?.value?.includes("你好呀") ||
        i.metadata?.valueLength === 9 ||
        (i.kind === "keydown" && i.metadata?.key === "Enter")
    );
    expect(hasSearchInput).toBe(true);

    // 在 Preview DOM UI 页面上验证聚合卡片与标题展现
    await previewPage.waitForSelector(".grouped-card", { timeout: 10_000 });
    const cardTitle = await previewPage
      .locator(".grouped-card .top strong")
      .first()
      .textContent();
    logE2e("Preview grouped card title rendered", { cardTitle });

    expect(cardTitle).toBeTruthy();
    logE2e("REAL-BUS-001 passed successfully!");
  });
});
