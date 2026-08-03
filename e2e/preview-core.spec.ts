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

test.describe("Bug Lens Chrome Extension E2E PREV-001: Preview Core Browsing & Timeline Seeking", () => {
  test("PREV-001: complete evidence recording, metrics, video player, 5 view tabs, filtering, seeking and teardown", async ({
    context,
    extensionId,
    openActionPopup,
    mediaProbe,
    serverUrl,
  }) => {
    const scenarioId = "PREV-001";
    const previewPageUrl = serverUrl.replace(
      "mock-page.html",
      "preview-page.html"
    );

    context.on("console", (message) => {
      logE2e(`Browser console.${message.type()}`, {
        url:
          safeUrlForLog(message.page()?.url()) ?? "extension-worker-or-popup",
      });
    });

    // ==========================================
    // 三、生成完整 Preview 证据
    // ==========================================
    let targetPage = context.pages()[0];
    if (!targetPage) targetPage = await context.newPage();
    await targetPage.goto(previewPageUrl);
    logE2e(`${scenarioId}: Target preview page loaded`, {
      url: targetPage.url(),
    });

    await targetPage.bringToFront();
    await targetPage.waitForFunction(() => document.hasFocus(), undefined, {
      timeout: 2_000,
    });

    // 1. 通过真实 Action Popup 启动默认 Safe 模式录制
    const popup = await openActionPopup(targetPage);
    await popup.waitForSelector('[data-testid="record-panel"]');

    const targetTabId = await popup.evaluate<number | undefined>(
      "(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id)()"
    );
    expect(targetTabId).toBeTruthy();

    await popup.click('[data-testid="start-recording-btn"]');
    await popup.dispose();

    // 2. 等待 Session 激活
    const session = await mediaProbe.waitForSession(targetTabId!);
    const activeMedia = await mediaProbe.waitForActive(
      session.id,
      targetTabId!
    );
    logE2e(`${scenarioId}: Recording started`, {
      sessionId: session.id,
      privacyMode: session.options.privacyMode,
      video: session.options.captureVideo,
      screenshots: session.options.captureScreenshots,
    });

    expect(activeMedia.capture?.status).toBe("active");
    expect(activeMedia.offscreenActive).toBe(true);

    const markIssueButton = targetPage.locator("#__wbr_issue_btn__");
    await expect(markIssueButton).toBeVisible({ timeout: 5_000 });

    // 3. 按顺序执行受控测试动作：
    // (1) 普通点击
    await targetPage.click('[data-testid="normal-btn"]');
    await expect(
      targetPage.locator('[data-testid="action-status"]')
    ).toHaveText("普通点击 1 完成");
    await delay(400);

    // (2) 创建一条完整 Issue Scene
    await markIssueButton.click();
    const selectionOverlay = targetPage.locator("#__wbr_issue_selection__");
    await expect(selectionOverlay).toBeVisible({ timeout: 3_000 });

    const targetElement = targetPage.locator('[data-testid="issue-target"]');
    const box = await targetElement.boundingBox();
    expect(box).toBeTruthy();
    await targetPage.mouse.click(
      box!.x + box!.width / 2,
      box!.y + box!.height / 2
    );

    const finishBtn = targetPage
      .locator("#__wbr_issue_selection__")
      .locator("button", { hasText: "完成截图" });
    await expect(finishBtn).toBeVisible({ timeout: 3_000 });
    await finishBtn.click();

    const issueEditor = targetPage.locator("#__wbr_issue_editor__");
    await expect(issueEditor).toBeVisible({ timeout: 5_000 });

    await issueEditor.locator('[data-issue-tool="rect"]').click();
    const svgLocator = issueEditor.locator("[data-issue-svg]");
    const svgBox = await svgLocator.boundingBox();
    expect(svgBox).toBeTruthy();

    await targetPage.mouse.move(
      svgBox!.x + svgBox!.width * 0.2,
      svgBox!.y + svgBox!.height * 0.2
    );
    await targetPage.mouse.down();
    await targetPage.mouse.move(
      svgBox!.x + svgBox!.width * 0.6,
      svgBox!.y + svgBox!.height * 0.6,
      { steps: 5 }
    );
    await targetPage.mouse.up();

    await issueEditor.locator("[data-issue-toggle-more]").click();
    await expect(issueEditor.locator("[data-issue-details-box]")).toBeVisible();

    const actualText = "PREV-001 实际缺陷描述";
    const expectedText = "PREV-001 预期行为说明";
    const noteText = "PREV-001 自动化测试补充备注";

    await issueEditor.locator("[data-issue-actual]").fill(actualText);
    await issueEditor.locator("[data-issue-expected]").fill(expectedText);
    await issueEditor.locator("[data-issue-note]").fill(noteText);

    await issueEditor.locator("[data-issue-save]").click();
    await expect(issueEditor).toBeHidden({ timeout: 5_000 });
    await delay(400);

    // (3) 保存继续后再执行一个普通点击
    const afterActionButton = targetPage.locator(
      '[data-testid="after-issue-action"]'
    );
    await afterActionButton.click();
    await expect(
      targetPage.locator('[data-testid="after-issue-result"]')
    ).toHaveText("普通操作已执行");
    await delay(400);

    // (4) 产生 log、warning、error 三种 Console 证据
    await targetPage.click('[data-testid="btn-console-log"]');
    await targetPage.click('[data-testid="btn-console-warn"]');
    await targetPage.click('[data-testid="btn-console-error"]');

    // (5) 请求 200 成功接口
    await targetPage.click('[data-testid="btn-net-success"]');
    await expect(
      targetPage.locator('[data-testid="action-status"]')
    ).toContainText("Success Net 完成");

    // (6) 请求 500 失败接口
    await targetPage.click('[data-testid="btn-net-failure"]');
    await expect(
      targetPage.locator('[data-testid="action-status"]')
    ).toContainText("Failure Net 500");

    // 等待所有证据及媒体分片落盘
    await mediaProbe.waitForEvidenceCounts(session.id, {
      interactionCount: 2,
      issueSceneCount: 1,
      consoleCount: 3,
      networkCount: 2,
    });
    await mediaProbe.waitForMediaChunkCountGreaterThan(session.id, 0);

    logE2e(
      `${scenarioId}: All target evidence captured cleanly in target page`
    );

    // (7) 从页面浮层停止前，确保目标页在最前且聚焦，防止失焦产生 VISIBLE_TAB_NOT_ACTIVE
    await targetPage.bringToFront();
    await targetPage
      .waitForFunction(() => document.hasFocus(), undefined, { timeout: 2_000 })
      .catch(() => undefined);

    const stopBtn = targetPage.locator("#__wbr_stop_btn__");
    await expect(stopBtn).toBeVisible();

    const previewPagePromise = context.waitForEvent("page", {
      predicate: (page) =>
        page.url().startsWith(`chrome-extension://${extensionId}/preview.html`),
      timeout: 10_000,
    });
    await stopBtn.click();
    const previewPage = await previewPagePromise;
    await previewPage.waitForLoadState("domcontentloaded");
    await previewPage.bringToFront();

    // 读取持久化证据作为唯一基准
    const persisted = await mediaProbe.persistedFullEvidence(session.id);
    logE2e(`${scenarioId}: Read baseline persisted evidence`, {
      sessionId: session.id,
      interactionsCount: persisted.interactions.length,
      consoleCount: persisted.consoleEntries.length,
      networkCount: persisted.networkEntries.length,
      issueSceneCount: persisted.issueScenes.length,
      mediaChunksCount: persisted.mediaChunks.length,
    });

    logE2e(`${scenarioId}: Quality issues inspect`, {
      overall: persisted.session?.quality.overall,
      issues: persisted.session?.quality.issues,
    });
    expect(persisted.session?.status).toBe("PREVIEW_READY");
    expect(persisted.session?.quality.overall).toBe("complete");

    // ==========================================
    // 四、Preview 顶部与 Metrics 验证
    // ==========================================
    await previewPage.waitForSelector(".zen-app-frame", { timeout: 10_000 });

    const titleText = await previewPage.locator("#title").innerText();
    expect(titleText).toBe(persisted.session?.target.initialTitle);

    await previewPage.waitForSelector("#meta", { timeout: 5_000 });
    await expect(previewPage.locator("#meta")).toContainText(
      persisted.session?.target.initialUrl ?? "http",
      { timeout: 5_000 }
    );
    await expect(previewPage.locator("#meta")).toHaveText(/\d+\s*秒|时长未知/, {
      timeout: 5_000,
    });

    const includedInteractions = persisted.interactions.filter(
      (i) => i.status === "confirmed"
    );
    const capturedScreenshots = includedInteractions.filter(
      (i) => i.screenshot.status === "captured"
    );

    await previewPage.waitForSelector("#metrics .metric", { timeout: 5_000 });

    const metricSteps = await previewPage
      .locator(".metric-steps strong")
      .innerText();
    const metricDeleted = await previewPage
      .locator(".metric-deleted strong")
      .innerText();
    const metricScreenshots = await previewPage
      .locator(".metric-screenshots strong")
      .innerText();
    const metricConsole = await previewPage
      .locator(".metric-console strong")
      .innerText();
    const metricNetwork = await previewPage
      .locator(".metric-network strong")
      .innerText();
    const metricIssues = await previewPage
      .locator(".metric-issues strong")
      .innerText();

    expect(Number(metricSteps)).toBe(includedInteractions.length);
    expect(Number(metricDeleted)).toBe(0);
    expect(Number(metricScreenshots)).toBe(capturedScreenshots.length);
    expect(Number(metricConsole)).toBe(persisted.consoleEntries.length);
    expect(Number(metricNetwork)).toBe(persisted.networkEntries.length);
    expect(Number(metricIssues)).toBe(1);

    logE2e(`${scenarioId}: Header and metrics exact assertions passed`);

    // ==========================================
    // 五、视频播放器控制与 Seekbar 操作
    // ==========================================
    const video = previewPage.locator("#video");
    await expect(video).toBeVisible({ timeout: 10_000 });

    const isVideoLoaded = await video.evaluate((v: HTMLVideoElement) => {
      return v.readyState >= 1 && v.duration > 0 && isFinite(v.duration);
    });
    expect(isVideoLoaded).toBe(true);

    const playPauseBtn = previewPage.locator("#play-pause-btn");
    await expect(playPauseBtn).toBeVisible();

    // 1. 点击播放按钮
    await playPauseBtn.click();
    await previewPage.waitForFunction(
      () => {
        const v = document.querySelector("#video") as HTMLVideoElement;
        return v && !v.paused;
      },
      undefined,
      { timeout: 3_000 }
    );

    const initialTime = await video.evaluate(
      (v: HTMLVideoElement) => v.currentTime
    );
    await delay(300);
    const updatedTime = await video.evaluate(
      (v: HTMLVideoElement) => v.currentTime
    );
    expect(updatedTime).toBeGreaterThan(initialTime);

    // 2. 再次点击暂停
    await playPauseBtn.click();
    await previewPage.waitForFunction(
      () => {
        const v = document.querySelector("#video") as HTMLVideoElement;
        return v && v.paused;
      },
      undefined,
      { timeout: 3_000 }
    );

    // 3. 真实鼠标点击 Seekbar ~50% 位置
    const seekbar = previewPage.locator("#zen-seekbar-container");
    await expect(seekbar).toBeVisible();
    const seekbarBox = await seekbar.boundingBox();
    expect(seekbarBox).toBeTruthy();

    const midX = seekbarBox!.x + seekbarBox!.width * 0.5;
    const midY = seekbarBox!.y + seekbarBox!.height * 0.5;

    await previewPage.mouse.click(midX, midY);
    await delay(200);

    const duration = await video.evaluate((v: HTMLVideoElement) => v.duration);
    const seekedTime = await video.evaluate(
      (v: HTMLVideoElement) => v.currentTime
    );
    expect(Math.abs(seekedTime - duration * 0.5)).toBeLessThanOrEqual(
      duration * 0.15 + 0.5
    );

    const timeTextDisplayed = await previewPage
      .locator("#video-time-text")
      .innerText();
    expect(timeTextDisplayed).not.toBe("00:00 / 00:00");

    logE2e(
      `${scenarioId}: Video player controls and seekbar interaction verified`
    );

    // ==========================================
    // 六、五个 Preview 视图切换
    // ==========================================
    const tabs = [
      { key: "issues", paneId: "tab-pane-issues" },
      { key: "steps", paneId: "tab-pane-steps" },
      { key: "console", paneId: "tab-pane-console" },
      { key: "network", paneId: "tab-pane-network" },
      { key: "stream", paneId: "tab-pane-stream" },
    ];

    for (const item of tabs) {
      const tabBtn = previewPage.locator(
        `.zen-tab-btn[data-tab="${item.key}"]`
      );
      await tabBtn.click();

      await expect(tabBtn).toHaveClass(/active/);
      const targetPane = previewPage.locator(`#${item.paneId}`);
      await expect(targetPane).toBeVisible();

      for (const other of tabs) {
        if (other.key !== item.key) {
          await expect(previewPage.locator(`#${other.paneId}`)).toBeHidden();
        }
      }
    }

    logE2e(
      `${scenarioId}: All 5 tabs active and visibility switching verified`
    );

    // ==========================================
    // 七、问题现场视图与时间跳转
    // ==========================================
    await previewPage.locator('.zen-tab-btn[data-tab="issues"]').click();
    const issueCards = previewPage.locator(
      "#tab-pane-issues .issue-scene-card"
    );
    expect(await issueCards.count()).toBe(1);

    const card = issueCards.first();
    const cardText = await card.innerText();
    expect(cardText).toContain("完成");
    expect(cardText).toContain(actualText);
    expect(cardText).toContain(expectedText);
    expect(cardText).toContain(noteText);
    expect(cardText).toContain("issue-target");

    // 检查原图/批注图可切换
    const cardImg = card.locator("img[data-issue-image]");
    await expect(cardImg).toBeVisible();

    const initialImgSrc = await cardImg.getAttribute("src");
    const toggleBtn = card.locator("button", { hasText: "查看原图" });
    if (await toggleBtn.isVisible()) {
      await toggleBtn.click();
      const toggledSrc = await cardImg.getAttribute("src");
      expect(toggledSrc).not.toBe(initialImgSrc);
      const toggleBackBtn = card.locator("button", { hasText: "查看批注图" });
      await toggleBackBtn.click();
      expect(await cardImg.getAttribute("src")).toBe(initialImgSrc);
    }

    // 点击“跳转录像”
    const sceneSeekBtn = card.locator("button", { hasText: "跳转录像" });
    await expect(sceneSeekBtn).toBeVisible();
    await sceneSeekBtn.click();

    const videoTimeAfterSceneSeek = await video.evaluate(
      (v: HTMLVideoElement) => v.currentTime
    );
    const sessionStartedAt = persisted.session?.timeline.startedAtEpochMs ?? 0;
    const targetSceneTime =
      (persisted.issueScenes[0]!.observedAtEpochMs - sessionStartedAt) / 1000;
    expect(
      Math.abs(videoTimeAfterSceneSeek - targetSceneTime)
    ).toBeLessThanOrEqual(3.5);

    logE2e(`${scenarioId}: Issue Scene view and video seek verified`);

    // ==========================================
    // 八、交互步骤视图
    // ==========================================
    await previewPage.locator('.zen-tab-btn[data-tab="steps"]').click();
    const stepArticles = previewPage.locator("#tab-pane-steps article.item");
    expect(await stepArticles.count()).toBe(includedInteractions.length);

    // 步骤顺序按 createdAt 排列
    for (let idx = 0; idx < includedInteractions.length; idx += 1) {
      const stepItem = stepArticles.nth(idx);
      await expect(stepItem).toBeVisible();
      const targetText = await stepItem.locator("strong").innerText();
      expect(targetText.length).toBeGreaterThan(0);
    }

    // 点击一个步骤的时间跳转
    const firstStep = stepArticles.first();
    await firstStep.click();
    const videoTimeAfterStepSeek = await video.evaluate(
      (v: HTMLVideoElement) => v.currentTime
    );
    const firstInteractionTime =
      (includedInteractions[0]!.createdAt - sessionStartedAt) / 1000;
    expect(
      Math.abs(videoTimeAfterStepSeek - firstInteractionTime)
    ).toBeLessThanOrEqual(3.5);

    logE2e(`${scenarioId}: Interactions tab listing and time seek verified`);

    // ==========================================
    // 九、Console 过滤与搜索
    // ==========================================
    await previewPage.locator('.zen-tab-btn[data-tab="console"]').click();
    await previewPage.waitForSelector("#tab-pane-console .console-row", {
      timeout: 5_000,
    });

    const consoleRows = previewPage.locator("#tab-pane-console .console-row");
    expect(await consoleRows.count()).toBe(persisted.consoleEntries.length);

    // 1. 选择 error 级别筛选
    const levelSelect = previewPage.locator(
      "#tab-pane-console .panel-filter-select"
    );
    await expect(levelSelect).toBeVisible({ timeout: 5_000 });
    await levelSelect.selectOption("error");

    await previewPage.waitForFunction(
      () => {
        const rows = Array.from(
          document.querySelectorAll("#tab-pane-console .console-row")
        );
        return (
          rows.length > 0 &&
          rows.every((r) => r.classList.contains("console-row-error"))
        );
      },
      undefined,
      { timeout: 3_000 }
    );

    const countTextAfterErrorFilter = await previewPage
      .locator("#tab-pane-console .panel-filter-count")
      .innerText();
    expect(countTextAfterErrorFilter).toContain("匹配");

    // 2. 文本搜索唯一 error marker
    const consoleSearchInput = previewPage.locator(
      "#tab-pane-console .panel-search-input"
    );
    await consoleSearchInput.fill("[PREV-001 ERROR]");
    await expect(
      previewPage.locator("#tab-pane-console .console-row")
    ).toHaveCount(1);

    // 3. 搜索无关文本显示明确空态
    await consoleSearchInput.fill("NonExistentConsoleMarker999");
    await expect(previewPage.locator("#tab-pane-console .empty")).toContainText(
      "未找到匹配的 Console 日志"
    );

    // 4. 清空搜索并恢复 all level
    await consoleSearchInput.fill("");
    await levelSelect.selectOption("all");
    await expect(
      previewPage.locator("#tab-pane-console .console-row")
    ).toHaveCount(persisted.consoleEntries.length);

    // 5. 点击目标 Console Error 行跳转视频时间
    const errorConsoleRow = previewPage
      .locator("#tab-pane-console .console-row-error")
      .first();
    await errorConsoleRow.click();

    const targetErrorConsoleEntry = persisted.consoleEntries.find(
      (c) => (c.level || "").toLowerCase() === "error"
    );
    expect(targetErrorConsoleEntry).toBeDefined();
    const videoTimeAfterConsoleSeek = await video.evaluate(
      (v: HTMLVideoElement) => v.currentTime
    );
    const targetConsoleTime =
      (targetErrorConsoleEntry!.createdAt - sessionStartedAt) / 1000;
    expect(
      Math.abs(videoTimeAfterConsoleSeek - targetConsoleTime)
    ).toBeLessThanOrEqual(3.5);

    logE2e(`${scenarioId}: Console tab filtering, search and seek verified`);

    // ==========================================
    // 十、Network 列表、筛选与详情
    // ==========================================
    await previewPage.locator('.zen-tab-btn[data-tab="network"]').click();
    await previewPage.waitForSelector("#tab-pane-network .network-row", {
      timeout: 5_000,
    });

    const initialNetworkRows = previewPage.locator(
      "#tab-pane-network .network-row"
    );
    expect(await initialNetworkRows.count()).toBe(
      persisted.networkEntries.length
    );

    // 1. 在 Network 搜索框中输入失败接口路径
    const netSearchInput = previewPage.locator(
      "#tab-pane-network .panel-search-input"
    );
    await netSearchInput.fill("/api/preview/failure");

    await previewPage.waitForFunction(
      () => {
        const rows = document.querySelectorAll(
          "#tab-pane-network .network-row"
        );
        return rows.length === 1 && rows[0]?.classList.contains("status-error");
      },
      undefined,
      { timeout: 3_000 }
    );

    const countTextAfterNetFilter = await previewPage
      .locator("#tab-pane-network .panel-filter-count")
      .innerText();
    expect(countTextAfterNetFilter).toContain("匹配");

    // 2. 点击目标 500 网络行展开详情
    const failureNetRow = previewPage
      .locator("#tab-pane-network .network-row[data-network-id]")
      .first();
    await failureNetRow.click();

    const detailPanel = previewPage.locator(".network-detail-panel");
    await expect(detailPanel).toBeVisible();

    const detailHtml = await detailPanel.innerHTML();
    expect(detailHtml).toContain("/api/preview/failure");
    expect(detailHtml).toContain("响应头");
    expect(detailHtml).toContain("[PREV-001 FAILURE RESPONSE MARKER]");

    // 3. 点击 Network 行跳转视频时间
    const targetFailureNetwork = persisted.networkEntries.find((n) =>
      n.url.includes("/api/preview/failure")
    );
    expect(targetFailureNetwork).toBeDefined();
    const videoTimeAfterNetSeek = await video.evaluate(
      (v: HTMLVideoElement) => v.currentTime
    );
    const targetNetTime =
      (targetFailureNetwork!.createdAt - sessionStartedAt) / 1000;
    expect(Math.abs(videoTimeAfterNetSeek - targetNetTime)).toBeLessThanOrEqual(
      3.5
    );

    // 4. 清空搜索
    await netSearchInput.fill("");
    await expect(
      previewPage.locator("#tab-pane-network .network-row")
    ).toHaveCount(persisted.networkEntries.length);

    logE2e(`${scenarioId}: Network tab search, detail panel and seek verified`);

    // ==========================================
    // 十一、全景瀑布流
    // ==========================================
    await previewPage.locator('.zen-tab-btn[data-tab="stream"]').click();
    await previewPage.waitForSelector("#tab-pane-stream .stream-node", {
      timeout: 5_000,
    });

    const totalNodesCount =
      persisted.interactions.filter((i) => i.status === "confirmed").length +
      persisted.consoleEntries.length +
      persisted.networkEntries.length;

    const streamNodes = previewPage.locator("#tab-pane-stream .stream-node");
    expect(await streamNodes.count()).toBe(totalNodesCount);

    // 验证 timestamp 严格按非递减排列
    const timestamps = await streamNodes.evaluateAll((nodes) =>
      nodes.map((n) => Number(n.getAttribute("data-timestamp")))
    );
    for (let i = 1; i < timestamps.length; i += 1) {
      expect(timestamps[i]!).toBeGreaterThanOrEqual(timestamps[i - 1]!);
    }

    // 打开“仅看错误与异常”
    await previewPage
      .getByLabel("仅看错误与异常")
      .evaluate((el: Element) => (el as HTMLInputElement).click());

    // 应该只保留 console error/warn 和 network 500
    await previewPage.waitForFunction(
      (total) => {
        const nodes = document.querySelectorAll(
          "#tab-pane-stream .stream-node"
        );
        return nodes.length > 0 && nodes.length < total;
      },
      totalNodesCount,
      { timeout: 3_000 }
    );

    const filteredNodesCount = await streamNodes.count();
    expect(filteredNodesCount).toBeGreaterThan(0);
    expect(filteredNodesCount).toBeLessThan(totalNodesCount);

    // 取消勾选恢复全部
    await previewPage
      .getByLabel("仅看错误与异常")
      .evaluate((el: Element) => (el as HTMLInputElement).click());
    await expect(streamNodes).toHaveCount(totalNodesCount);

    // 点击节点测试 active class 与跳转
    const firstConsoleErrorNode = previewPage
      .locator('#tab-pane-stream .stream-node[data-node-id^="console-"]')
      .first();
    await firstConsoleErrorNode.click();
    await expect(firstConsoleErrorNode).toHaveClass(/active/);

    logE2e(
      `${scenarioId}: Timeline stream tab ordering, error-only filtering and seek verified`
    );

    // ==========================================
    // 十二、状态与资源清理
    // ==========================================
    const persistedAfterFinish = await mediaProbe.persistedEvidence(session.id);
    expect(persistedAfterFinish.session?.status).toBe("PREVIEW_READY");
    expect(persistedAfterFinish.session?.quality.overall).toBe("complete");
    expect(persistedAfterFinish.session?.quality.issues).toEqual([]);

    expect(persisted.issueScenes.length).toBe(1);
    expect(await mediaProbe.activeSession()).toBeUndefined();
    expect(await mediaProbe.isOffscreenRecording(session.id)).toBe(false);
    expect(await mediaProbe.isOverlayRemoved(targetPage)).toBe(true);
    expect(await mediaProbe.getBadgeText(targetTabId!)).toBe("");

    const totalPreviewPages = context
      .pages()
      .filter((p) => p.url().includes("/preview.html")).length;
    expect(totalPreviewPages).toBe(1);

    logE2e(`${scenarioId}: All PREV-001 assertions completely passed cleanly!`);
  });
});
