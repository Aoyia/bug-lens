import { test, expect } from "./fixtures/extension.ts";

test.describe("Options Page 端到端自动化测试覆盖体系", () => {
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

    // 2. 切换到 AI 定制页并检验分段胶囊控件与自绘 CustomSelect 下拉控件
    await page.click(".sidebar-nav button.nav-item:nth-child(2)");
    await page.waitForSelector(".custom-select-trigger");

    // 点击 CustomSelect 下拉按钮打开浮层菜单
    await page.click(".custom-select-trigger");
    await page.waitForSelector(".custom-select-dropdown");
    await page.waitForTimeout(200);

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

    // 切换回 "跟随系统"
    await segmentedButtons.nth(0).click();
    await expect(segmentedButtons.nth(0)).toHaveClass(/active/);
    await expect(segmentedButtons.nth(2)).not.toHaveClass(/active/);
    await page.waitForTimeout(300);

    await page.waitForSelector(".inline-prompt-preview-wrap");

    // 点击展开 Prompt 预览
    await page.click(".btn-inline-toggle");
    await page.waitForSelector(".inline-prompt-preview-box");

    // 3. 测试 1920x1080 视口
    await page.setViewportSize({ width: 1920, height: 1080 });

    // 4. 测试搜索框输入
    await page.fill(".topbar-search-input", "Prompt");
    await expect(page.locator(".topbar-search-input")).toHaveValue("Prompt");
  });

  test("OPTIONS-002: 覆盖全部 6 个导航 Tab 完整切换与渲染无白屏", async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    const optionsUrl = `chrome-extension://${extensionId}/options.html`;
    await page.goto(optionsUrl);

    await page.waitForSelector(".options-topbar");
    await page.waitForSelector(".options-main-container");

    const navItems = page.locator(".sidebar-nav .nav-item");
    await expect(navItems).toHaveCount(6);

    // Tab 1: 常规工作流 (Workflow)
    await navItems.nth(0).click();
    await expect(navItems.nth(0)).toHaveClass(/active/);
    await expect(page.locator(".section-title")).toBeVisible();
    await expect(page.locator(".section-title")).toContainText(
      /(工作流偏好|Workflow)/
    );
    // 验证语言与停止后行为两个分段控件及两个开关
    await expect(page.locator(".segmented-control")).toHaveCount(2);
    await expect(page.locator(".switch")).toHaveCount(2);

    // Tab 2: AI 定制 (AI)
    await navItems.nth(1).click();
    await expect(navItems.nth(1)).toHaveClass(/active/);
    await expect(page.locator(".section-title")).toContainText(
      /(AI 与导出定制|AI & Export)/
    );
    await expect(page.locator(".custom-select-trigger")).toBeVisible();
    // 展开并验证下拉选项
    await page.click(".custom-select-trigger");
    await expect(page.locator(".custom-select-dropdown")).toBeVisible();
    await expect(page.locator(".custom-select-option")).toHaveCount(4);
    await page.click('.custom-select-option:has-text("Cursor")');
    await expect(page.locator(".textarea-input")).toBeVisible();
    // 展开 AI Prompt 模板预览
    await page.click(".btn-inline-toggle");
    await expect(page.locator(".inline-prompt-preview-box")).toBeVisible();
    await expect(page.locator(".inline-code-content")).toContainText("Cursor");

    // Tab 3: 录制默认项 (Recording)
    await navItems.nth(2).click();
    await expect(navItems.nth(2)).toHaveClass(/active/);
    await expect(page.locator(".section-title")).toContainText(
      /(默认录制通道|Default Streams)/
    );
    // 6 个开关（视频、音频、截图、控制台、网络、框架状态）
    await expect(page.locator(".switch")).toHaveCount(6);
    // 2 个分段选择器（响应体策略、脱敏模式）
    await expect(page.locator(".segmented-control")).toHaveCount(2);

    // Tab 4: 隐私保护 (Privacy)
    await navItems.nth(3).click();
    await expect(navItems.nth(3)).toHaveClass(/active/);
    await expect(page.locator(".section-title")).toContainText(
      /(安全与脱敏|Privacy & Security)/
    );
    await expect(page.locator("input.text-input")).toBeVisible();
    await expect(page.locator("textarea.textarea-input")).toBeVisible();

    // Tab 5: 存储与配额 (Storage)
    await navItems.nth(4).click();
    await expect(navItems.nth(4)).toHaveClass(/active/);
    await expect(page.locator(".section-title")).toContainText(
      /(存储与配额|Storage & Retention)/
    );
    // 3 个分段选择器（码率、保留期限、会话配额）与清空按钮
    await expect(page.locator(".segmented-control")).toHaveCount(3);
    await expect(page.locator("button.btn-danger")).toBeVisible();

    // Tab 6: 快捷键指南 (Shortcuts)
    await navItems.nth(5).click();
    await expect(navItems.nth(5)).toHaveClass(/active/);
    await expect(page.locator(".section-title")).toContainText(
      /(快捷键指南|Shortcuts)/
    );
    await expect(page.locator(".shortcut-badge")).toHaveCount(3);
    await expect(page.locator("button.btn-default")).toBeVisible();
  });

  test("OPTIONS-003: 配置修改触发自动保存、页面刷新 (reload) 持久化回显与闭环断言", async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    const optionsUrl = `chrome-extension://${extensionId}/options.html`;
    await page.goto(optionsUrl);

    await page.waitForSelector(".options-topbar");
    await page.waitForSelector(".options-main-container");

    const navItems = page.locator(".sidebar-nav .nav-item");

    // 1. 修改 Workflow Tab: 切换语言为 English，关闭 autoCopyPrompt 开关
    await navItems.nth(0).click();
    const langBtns = page
      .locator(".segmented-control")
      .nth(0)
      .locator(".segmented-btn");
    await langBtns.nth(2).click(); // 切换至 English
    await expect(page.locator(".save-status-badge")).toBeVisible({
      timeout: 5000,
    });

    // 点击切换第一个 switch (autoCopyPrompt)
    await page.locator(".switch .slider").nth(0).click();
    await expect(page.locator(".save-status-badge")).toBeVisible({
      timeout: 5000,
    });
    await expect(page.locator(".switch input").nth(0)).not.toBeChecked();

    // 2. 修改 AI Tab: 切换助手为 Claude Code，Prompt 语言切换为 English，填写排查指令
    await navItems.nth(1).click();
    await page.click(".custom-select-trigger");
    await page.click('.custom-select-option:has-text("Claude Code")');
    await expect(page.locator(".save-status-badge")).toBeVisible({
      timeout: 5000,
    });

    const aiPromptLangBtns = page
      .locator(".settings-card .segmented-control")
      .nth(0)
      .locator(".segmented-btn");
    await aiPromptLangBtns.nth(2).click(); // English
    await expect(page.locator(".save-status-badge")).toBeVisible({
      timeout: 5000,
    });

    const aiInstructionsTextarea = page.locator(
      ".settings-card textarea.textarea-input"
    );
    await aiInstructionsTextarea.fill(
      "Prioritize analyzing React Fiber mutations and network payloads."
    );
    await aiInstructionsTextarea.blur(); // 触发 commitTextSettings -> triggerAutoSave
    await expect(page.locator(".save-status-badge")).toBeVisible({
      timeout: 5000,
    });

    // 3. 修改 Recording Tab: 开启录音通道 (audio)，设置响应体为 full
    await navItems.nth(2).click();
    // 开启麦克风录制（第 2 个 switch）
    await page.locator(".switch .slider").nth(1).click();
    await expect(page.locator(".save-status-badge")).toBeVisible({
      timeout: 5000,
    });
    await expect(page.locator(".switch input").nth(1)).toBeChecked();

    // 响应体策略切换到第 3 项 (full / 完整保留)
    const responseBodyBtns = page
      .locator(".segmented-control")
      .nth(0)
      .locator(".segmented-btn");
    await responseBodyBtns.nth(2).click();
    await expect(page.locator(".save-status-badge")).toBeVisible({
      timeout: 5000,
    });

    // 4. 修改 Privacy Tab: 输入自定义敏感词与排除 URL
    await navItems.nth(3).click();
    const sensitiveInput = page.locator("input.text-input");
    await sensitiveInput.fill("e2e_auth_token, test_secret_key");
    await sensitiveInput.blur(); // 触发 commitTextSettings -> triggerAutoSave
    await expect(page.locator(".save-status-badge")).toBeVisible({
      timeout: 5000,
    });

    const excludeTextarea = page.locator("textarea.textarea-input");
    await excludeTextarea.fill(
      "*.internal-api.corp\nhttps://staging.test.local"
    );
    await excludeTextarea.blur(); // 触发 commitTextSettings
    await expect(page.locator(".save-status-badge")).toBeVisible({
      timeout: 5000,
    });

    // 5. 修改 Storage Tab: 保留天数改为 30 天，码率改为 quality (画质优先)
    await navItems.nth(4).click();
    // 码率第 3 项 (quality)
    const bitrateBtns = page
      .locator(".segmented-control")
      .nth(0)
      .locator(".segmented-btn");
    await bitrateBtns.nth(2).click();
    await expect(page.locator(".save-status-badge")).toBeVisible({
      timeout: 5000,
    });

    // 保留天数第 3 项 (30 天)
    const retentionBtns = page
      .locator(".segmented-control")
      .nth(1)
      .locator(".segmented-btn");
    await retentionBtns.nth(2).click();
    await expect(page.locator(".save-status-badge")).toBeVisible({
      timeout: 5000,
    });

    // 轮询 chrome.storage.local 真实数据，确保已完整落盘与镜像同步，避免固定 sleep 在极端 I/O 下的竞态
    await page.waitForFunction(async () => {
      const stored = (await chrome.storage.local.get([
        "app-settings",
        "last-recording-options",
      ])) as Record<string, any>;
      const app = stored["app-settings"];
      const rec = stored["last-recording-options"];
      return (
        app?.workflow?.language === "en-US" &&
        app?.workflow?.autoCopyPrompt === false &&
        app?.ai?.targetAssistant === "claude-code" &&
        app?.ai?.promptLanguage === "en-US" &&
        app?.ai?.customInstructions?.includes("React Fiber") &&
        app?.defaultRecording?.captureAudio === true &&
        app?.defaultRecording?.responseBodyPolicy === "full" &&
        app?.privacy?.customSensitiveKeys?.includes("e2e_auth_token") &&
        app?.storage?.retentionDays === 30 &&
        app?.storage?.compressionLevel === "quality" &&
        rec?.captureAudio === true &&
        rec?.captureFullResponseBody === true
      );
    });

    // 6. 执行真实页面刷新 reload
    await page.reload();
    await page.waitForSelector(".options-topbar");
    await page.waitForSelector(".options-main-container");

    const reloadedNavItems = page.locator(".sidebar-nav .nav-item");

    // 7. 逐项断言持久化回显
    // 7.1 Workflow 回显验证
    await reloadedNavItems.nth(0).click();
    const reloadedLangBtns = page
      .locator(".segmented-control")
      .nth(0)
      .locator(".segmented-btn");
    await expect(reloadedLangBtns.nth(2)).toHaveClass(/active/);
    await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
    await expect(page.locator(".switch input").nth(0)).not.toBeChecked();

    // 7.2 AI 回显验证
    await reloadedNavItems.nth(1).click();
    await expect(page.locator(".custom-select-trigger span")).toHaveText(
      "Claude Code"
    );
    const reloadedAiLangBtns = page
      .locator(".settings-card .segmented-control")
      .nth(0)
      .locator(".segmented-btn");
    await expect(reloadedAiLangBtns.nth(2)).toHaveClass(/active/);
    await expect(
      page.locator(".settings-card textarea.textarea-input")
    ).toHaveValue(
      "Prioritize analyzing React Fiber mutations and network payloads."
    );

    // 7.3 Recording 回显验证
    await reloadedNavItems.nth(2).click();
    await expect(page.locator(".switch input").nth(1)).toBeChecked();
    const reloadedResponseBodyBtns = page
      .locator(".segmented-control")
      .nth(0)
      .locator(".segmented-btn");
    await expect(reloadedResponseBodyBtns.nth(2)).toHaveClass(/active/);

    // 7.4 Privacy 回显验证
    await reloadedNavItems.nth(3).click();
    await expect(page.locator("input.text-input")).toHaveValue(
      "e2e_auth_token, test_secret_key"
    );
    await expect(page.locator("textarea.textarea-input")).toHaveValue(
      "*.internal-api.corp\nhttps://staging.test.local"
    );

    // 7.5 Storage 回显验证
    await reloadedNavItems.nth(4).click();
    const reloadedBitrateBtns = page
      .locator(".segmented-control")
      .nth(0)
      .locator(".segmented-btn");
    await expect(reloadedBitrateBtns.nth(2)).toHaveClass(/active/);
    const reloadedRetentionBtns = page
      .locator(".segmented-control")
      .nth(1)
      .locator(".segmented-btn");
    await expect(reloadedRetentionBtns.nth(2)).toHaveClass(/active/);
  });

  test("OPTIONS-004: 恢复默认设置与清空历史数据交互闭环断言", async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    const optionsUrl = `chrome-extension://${extensionId}/options.html`;
    await page.goto(optionsUrl);

    await page.waitForSelector(".options-topbar");
    await page.waitForSelector(".options-main-container");

    const navItems = page.locator(".sidebar-nav .nav-item");

    // 先做一些修改以确保非默认状态
    await navItems.nth(0).click();
    await page
      .locator(".segmented-control")
      .nth(0)
      .locator(".segmented-btn")
      .nth(2)
      .click(); // English
    await expect(page.locator(".save-status-badge")).toBeVisible({
      timeout: 5000,
    });

    await navItems.nth(2).click();
    await page.locator(".switch .slider").nth(1).click(); // 开启麦克风
    await expect(page.locator(".save-status-badge")).toBeVisible({
      timeout: 5000,
    });

    // 1. 测试“恢复默认设置”应用内模态弹窗：先取消，确认未被重置
    await page.click("button.btn-text-subtle");
    await expect(page.locator(".options-modal-card")).toBeVisible();
    await expect(page.locator("#confirm-dialog-title")).toContainText(
      /(恢复默认值|Reset to Defaults)/
    );
    // 点击取消按钮
    await page.click('[data-testid="modal-cancel-btn"]');
    await expect(page.locator(".options-modal-card")).not.toBeVisible();

    // 确认依然保持修改状态
    const langInStorage = await page.evaluate(async () => {
      const stored = (await chrome.storage.local.get("app-settings")) as Record<
        string,
        any
      >;
      return stored["app-settings"]?.workflow?.language;
    });
    expect(langInStorage).toBe("en-US");

    // 再次点击打开，点击确定执行恢复默认设置
    await page.click("button.btn-text-subtle");
    await expect(page.locator(".options-modal-card")).toBeVisible();
    await page.click('[data-testid="modal-confirm-btn"]');
    await expect(page.locator(".options-modal-card")).not.toBeVisible();
    await expect(page.locator(".save-status-badge")).toBeVisible({
      timeout: 5000,
    });

    // 轮询等待存储真实写入完成
    await page.waitForFunction(async () => {
      const stored = (await chrome.storage.local.get("app-settings")) as Record<
        string,
        any
      >;
      const app = stored["app-settings"];
      return (
        app?.workflow?.language === "auto" &&
        app?.workflow?.autoCopyPrompt === true &&
        app?.defaultRecording?.captureAudio === false &&
        app?.storage?.retentionDays === 14
      );
    });

    // 刷新验证已重置
    await page.reload();
    await page.waitForSelector(".options-topbar");

    const postResetNavItems = page.locator(".sidebar-nav .nav-item");

    // 语言重置为 auto (第 1 项 active)
    await postResetNavItems.nth(0).click();
    await expect(
      page.locator(".segmented-control").nth(0).locator(".segmented-btn").nth(0)
    ).toHaveClass(/active/);
    await expect(page.locator(".switch input").nth(0)).toBeChecked();

    // 录制项麦克风重置为关闭
    await postResetNavItems.nth(2).click();
    await expect(page.locator(".switch input").nth(1)).not.toBeChecked();

    // 存储项保留天数重置为 14 天 (第 2 项 active)
    await postResetNavItems.nth(4).click();
    await expect(
      page.locator(".segmented-control").nth(1).locator(".segmented-btn").nth(1)
    ).toHaveClass(/active/);

    // 2. 测试“清空历史数据”高危模态弹窗：按 Escape 或点击取消，确认不会触发清空
    await page.click("button.btn-danger");
    await expect(page.locator(".options-modal-card")).toBeVisible();
    await expect(page.locator(".options-modal-icon.danger")).toBeVisible();
    await expect(page.locator("#confirm-dialog-title")).toContainText(
      /(清空所有历史数据|Clear All Historical Data)/
    );

    // 测试键盘 Escape 键关闭弹窗
    await page.keyboard.press("Escape");
    await expect(page.locator(".options-modal-card")).not.toBeVisible();
    await expect(page.locator(".settings-card")).not.toContainText(
      /(本地历史数据已清空|Historical data cleared successfully)/
    );

    // 再次打开弹窗，点击确定执行真正清空
    await page.click("button.btn-danger");
    await expect(page.locator(".options-modal-card")).toBeVisible();
    await page.click('[data-testid="modal-confirm-btn"]');
    await expect(page.locator(".options-modal-card")).not.toBeVisible();

    // 断言操作完成反馈信息出现
    await expect(page.locator(".settings-card")).toContainText(
      /(本地历史数据已清空|Historical data cleared successfully)/,
      { timeout: 5000 }
    );
  });
});
