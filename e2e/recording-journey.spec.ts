import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "./fixtures/extension.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const mockPagePath = "file://" + path.resolve(__dirname, "./fixtures/mock-page.html");
const todoMvcUrl = "https://todomvc.com/examples/react/dist/";

test.describe("Bug Lens Chrome Extension E2E User Journey", () => {
  test("Extension binds active web tab, records user interactions, and generates preview report", async ({ context, extensionId, openPopup, serverUrl }) => {
    // 1. 启动 HTTP 测试目标页，在后台持续运行
    let targetPage = context.pages()[0];
    if (!targetPage) {
      targetPage = await context.newPage();
    }
    await targetPage.goto(serverUrl);
    await targetPage.bringToFront();
    await targetPage.waitForTimeout(1000);

    // 2. 打开专属 Popup UI 界面
    const popup = await openPopup();
    await popup.bringToFront();

    // 确保 Popup 界面加载完成
    const actionsContainer = popup.locator(".actions");
    await expect(actionsContainer).toBeVisible({ timeout: 10_000 });

    // 校验 Popup 已精准绑定后台运行的 HTTP 测试目标页（消除“无法读取标签页”）
    const titleElement = popup.locator("#title");
    await expect(titleElement).not.toHaveText("无法读取标签页", { timeout: 5000 });

    await popup.waitForTimeout(1500);

    const startBtn = popup.locator("#start");
    const previewBtn = popup.locator("#preview");

    // 3. 在 Popup 界面上点击开始录制
    if (await startBtn.isVisible()) {
      await startBtn.click();
    } else if (await previewBtn.isVisible()) {
      await previewBtn.click();
    }

    // 断言 Popup 中的录制状态成功切换为 Recording（出现停止按钮）
    const stopBtn = popup.locator("#stop");
    await expect(stopBtn).toBeVisible({ timeout: 10_000 });

    await popup.waitForTimeout(1500);

    // 4. 切回 targetPage，模拟真实用户点击交互与 Fetch 请求
    await targetPage.bringToFront();
    
    const mockClickBtn = targetPage.locator('[data-testid="test-click-btn"]');
    if (await mockClickBtn.isVisible().catch(() => false)) {
      await mockClickBtn.click();
      await targetPage.waitForTimeout(1000);
    }

    const mockFetchBtn = targetPage.locator('[data-testid="test-fetch-btn"]');
    if (await mockFetchBtn.isVisible().catch(() => false)) {
      await mockFetchBtn.click();
      await targetPage.waitForTimeout(1000);
    }

    const mockErrorBtn = targetPage.locator('[data-testid="test-error-btn"]');
    if (await mockErrorBtn.isVisible().catch(() => false)) {
      await mockErrorBtn.click();
      await targetPage.waitForTimeout(1000);
    }

    // 5. 切回 Popup，点击停止录制
    await popup.bringToFront();
    await expect(stopBtn).toBeVisible();
    await popup.waitForTimeout(1500);

    // 监听 Preview 分析报告页面跳出
    const previewPagePromise = context.waitForEvent("page", (page) => page.url().includes("preview.html"));
    await stopBtn.click();

    // 6. 验证 Preview 分析报告页面呈现
    const previewPage = await previewPagePromise;
    await previewPage.waitForLoadState("domcontentloaded");

    expect(previewPage.url()).toContain(`chrome-extension://${extensionId}/preview.html`);
    await expect(previewPage.locator("body")).toBeVisible();

    // 延长停顿 30 秒，方便细致查看 Preview 缺陷分析报告细节
    await previewPage.waitForTimeout(30_000);
  });
});
