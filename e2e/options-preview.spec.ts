import { test, expect } from "./fixtures/extension.ts";

test.describe("Options Page 仿 Chrome 设置页方案 1 验证", () => {
  test("OPTIONS-001: 验证贯穿顶栏与居中工作台在 2560 超宽屏及常规视口下的端庄对称性", async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();

    // 1. 设置为 2560x1440 真实 2K/超宽屏视口
    await page.setViewportSize({ width: 2560, height: 1440 });
    const optionsUrl = `chrome-extension://${extensionId}/options.html`;
    await page.goto(optionsUrl);

    await page.waitForSelector(".options-topbar");
    await page.waitForSelector(".topbar-search-input");
    await page.waitForSelector(".options-center-container");
    await page.waitForSelector(".options-sidebar");
    await page.waitForSelector(".options-main-container");

    // 截图保存 2560x1440 超宽屏工作流视图
    await page.screenshot({
      path: "/Users/zhijian/.gemini/antigravity/brain/5980b46e-310e-4e07-8504-73adbb198f0e/chrome-style-2560x1440-workflow.png",
    });

    // 2. 切换到 AI 定制页并检验分段胶囊控件与自绘 CustomSelect 下拉控件
    await page.click('button.nav-item:has-text("AI 与导出定制")');
    await page.waitForSelector(".custom-select-trigger");

    // 点击 CustomSelect 下拉按钮打开浮层菜单
    await page.click(".custom-select-trigger");
    await page.waitForSelector(".custom-select-dropdown");
    await page.waitForTimeout(200);
    await page.locator(".settings-card").screenshot({
      path: "/Users/zhijian/.gemini/antigravity/brain/5980b46e-310e-4e07-8504-73adbb198f0e/custom-select-dropdown-open.png",
    });

    // 选择 "Cursor"
    await page.click('.custom-select-option:has-text("Cursor")');
    await expect(page.locator(".custom-select-trigger span")).toHaveText(
      "Cursor"
    );

    await page.waitForSelector(".segmented-control");
    const segmentedButtons = page.locator(".segmented-control .segmented-btn");
    await expect(segmentedButtons).toHaveCount(3);
    await expect(segmentedButtons.nth(0)).toHaveClass(/active/);

    // 点击切换到 "English"
    await segmentedButtons.nth(2).click();
    await expect(segmentedButtons.nth(2)).toHaveClass(/active/);
    await expect(segmentedButtons.nth(0)).not.toHaveClass(/active/);
    await page.waitForTimeout(300);

    // 截图保存 AI 定制页分段胶囊效果
    await page.screenshot({
      path: "/Users/zhijian/.gemini/antigravity/brain/5980b46e-310e-4e07-8504-73adbb198f0e/segmented-control-ai-tab.png",
    });
    await page.locator(".settings-card").screenshot({
      path: "/Users/zhijian/.gemini/antigravity/brain/5980b46e-310e-4e07-8504-73adbb198f0e/segmented-control-card.png",
    });

    // 切换回 "跟随系统"
    await segmentedButtons.nth(0).click();
    await expect(segmentedButtons.nth(0)).toHaveClass(/active/);
    await expect(segmentedButtons.nth(2)).not.toHaveClass(/active/);
    await page.waitForTimeout(300);

    await page.locator(".settings-card").screenshot({
      path: "/Users/zhijian/.gemini/antigravity/brain/5980b46e-310e-4e07-8504-73adbb198f0e/segmented-control-card-default.png",
    });

    await page.waitForSelector(".inline-prompt-preview-wrap");

    // 点击展开 Prompt 预览
    await page.click(".btn-inline-toggle");
    await page.waitForSelector(".inline-prompt-preview-box");

    // 截图保存 2560x1440 超宽屏 AI 定制展开视图（检验是否居中平衡、彻底消灭大片死白）
    await page.screenshot({
      path: "/Users/zhijian/.gemini/antigravity/brain/5980b46e-310e-4e07-8504-73adbb198f0e/chrome-style-2560x1440-ai-expanded.png",
    });

    // 3. 测试 1920x1080 视口
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.screenshot({
      path: "/Users/zhijian/.gemini/antigravity/brain/5980b46e-310e-4e07-8504-73adbb198f0e/chrome-style-1920x1080.png",
    });

    // 4. 测试搜索框输入
    await page.fill(".topbar-search-input", "Prompt");
    await page.screenshot({
      path: "/Users/zhijian/.gemini/antigravity/brain/5980b46e-310e-4e07-8504-73adbb198f0e/chrome-style-search.png",
    });

    console.log("Chrome-style options test and screenshots completed!");
  });
});
