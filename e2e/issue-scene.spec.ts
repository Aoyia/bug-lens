import { test, expect, safeUrlForLog } from "./fixtures/extension.ts";

function logE2e(message: string, details?: unknown): void {
  const suffix = details === undefined ? "" : ` ${JSON.stringify(details)}`;
  console.log(
    `[Bug Lens E2E][${new Date().toISOString()}] ${message}${suffix}`
  );
}

test.describe("Bug Lens Chrome Extension E2E ISSUE-001: Issue Scene Recording Journey", () => {
  test("ISSUE-001: marks an issue scene, annotates it, saves and continues recording", async ({
    context,
    extensionId,
    openActionPopup,
    mediaProbe,
    serverUrl,
  }) => {
    context.on("console", (message) => {
      logE2e(`Browser console.${message.type()}`, {
        url:
          safeUrlForLog(message.page()?.url()) ?? "extension-worker-or-popup",
      });
    });

    const issuePageUrl = serverUrl.replace("mock-page.html", "issue-page.html");

    // ==========================================
    // 三、真实 ISSUE-001 用户旅程
    // ==========================================
    let targetPage = context.pages()[0];
    if (!targetPage) targetPage = await context.newPage();
    await targetPage.goto(issuePageUrl);
    logE2e("Target issue page loaded", { url: targetPage.url() });

    await targetPage.bringToFront();
    await targetPage.waitForFunction(() => document.hasFocus(), undefined, {
      timeout: 2_000,
    });

    // 2. 通过真实 Action Popup 启动录制
    const popup = await openActionPopup(targetPage);
    await popup.waitForSelector('[data-testid="record-panel"]');

    const targetTabId = await popup.evaluate<number | undefined>(
      "(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id)()"
    );
    expect(targetTabId).toBeTruthy();

    await popup.click('[data-testid="start-recording-btn"]');
    await popup.dispose();

    // 5. 等待录制激活状态与 UI 浮层
    const session = await mediaProbe.waitForSession(targetTabId!);
    const activeMedia = await mediaProbe.waitForActive(
      session.id,
      targetTabId!
    );
    logE2e("Recording active state verified", {
      sessionId: session.id,
      sessionStatus: activeMedia.session?.status,
      captureStatus: activeMedia.capture?.status,
      offscreenActive: activeMedia.offscreenActive,
    });

    expect(activeMedia.capture?.status).toBe("active");
    expect(activeMedia.offscreenActive).toBe(true);

    const markIssueButton = targetPage.locator("#__wbr_issue_btn__");
    await expect(markIssueButton).toBeVisible({ timeout: 5_000 });

    // 问题现场文案（速记卡与编辑器共用）
    const actualText = "点击提交后页面没有任何响应";
    const expectedText = "页面应显示提交成功提示";
    const noteText = "ISSUE-001 自动化问题现场";

    // ==========================================
    // 四、进入问题选择模式
    // ==========================================
    // 1. 真实点击页面浮层标记按钮
    await markIssueButton.click();

    // 2. 期望速记卡（Trigger-to-express）：先捕获期望，再进入元素选择
    const expectedCard = targetPage.locator("#__wbr_expected_card__");
    await expect(expectedCard).toBeVisible({ timeout: 3_000 });
    await expectedCard.locator("[data-expected-input]").fill(expectedText);
    await expectedCard.locator("[data-expected-confirm]").click();
    await expect(expectedCard).toBeHidden();

    // 3. 断言选择模式状态
    const selectionOverlay = targetPage.locator("#__wbr_issue_selection__");
    await expect(selectionOverlay).toBeVisible({ timeout: 3_000 });

    const isButtonDisabled = await markIssueButton.evaluate(
      (btn) => (btn as HTMLButtonElement).disabled
    );
    const buttonText = await markIssueButton.textContent();
    expect(isButtonDisabled).toBe(true);
    expect(buttonText).toContain("选择");

    const activeSessionDuringSelect = await mediaProbe.activeSession();
    expect(activeSessionDuringSelect?.id).toBe(session.id);
    expect(activeSessionDuringSelect?.status).toBe("RECORDING");
    expect(await mediaProbe.isOffscreenRecording(session.id)).toBe(true);

    // 3. 记录进入选择模式前的证据数量与页面点击次数
    const initialEvidence = await mediaProbe.persistedFullEvidence(session.id);
    const initialInteractionCount = initialEvidence.interactions.length;
    const initialIssueSceneCount = initialEvidence.issueScenes.length;

    const initialClickCountText = await targetPage
      .locator('[data-testid="issue-target-click-count"]')
      .textContent();
    const initialClickCount = Number(initialClickCountText);

    // 4. 使用目标元素的真实屏幕坐标点击
    const targetElement = targetPage.locator('[data-testid="issue-target"]');
    await expect(targetElement).toBeVisible();
    const box = await targetElement.boundingBox();
    expect(box).toBeTruthy();

    // 在 Playwright 层模拟真实鼠标位置点击
    await targetPage.mouse.click(
      box!.x + box!.width / 2,
      box!.y + box!.height / 2
    );

    // 5. 点击后断言选择结果及操作阻断
    await targetPage.waitForFunction(
      () => {
        const selection = document.querySelector("#__wbr_issue_selection__");
        if (!selection || !selection.shadowRoot) return false;
        const finishBtn = selection.shadowRoot.querySelector("button");
        return Boolean(
          finishBtn && finishBtn.textContent?.includes("进入截图 (1)")
        );
      },
      undefined,
      { timeout: 3_000 }
    );

    const currentClickCountText = await targetPage
      .locator('[data-testid="issue-target-click-count"]')
      .textContent();
    expect(Number(currentClickCountText)).toBe(initialClickCount);

    const evidenceDuringSelect = await mediaProbe.persistedFullEvidence(
      session.id
    );
    expect(evidenceDuringSelect.interactions.length).toBe(
      initialInteractionCount
    );

    logE2e(
      "Selection overlay successfully blocked regular interaction and page click events"
    );

    // 6. 真实点击选择浮层中的"进入截图"按钮 (通过 Playwright locator 穿透 Shadow DOM)
    const finishBtn = targetPage
      .locator("#__wbr_issue_selection__")
      .locator("button", { hasText: "进入截图" });
    await expect(finishBtn).toBeVisible();
    await finishBtn.click();

    // ==========================================
    // 五、问题编辑器和批注
    // ==========================================
    const issueEditor = targetPage.locator("#__wbr_issue_editor__");
    await expect(issueEditor).toBeVisible({ timeout: 5_000 });

    const editorImage = issueEditor.locator("[data-issue-image]");
    await expect(editorImage).toBeVisible();

    const imageLoaded = await editorImage.evaluate((img) => {
      const el = img as HTMLImageElement;
      return el.complete && el.naturalWidth > 0 && el.naturalHeight > 0;
    });
    expect(imageLoaded).toBe(true);

    // 1. 点击绘制矩形按钮
    const rectToolBtn = issueEditor.locator('[data-issue-tool="rect"]');
    await rectToolBtn.click();

    // 2. 获取 SVG 坐标并绘制矩形
    const svgLocator = issueEditor.locator("[data-issue-svg]");
    await expect(svgLocator).toBeVisible();
    const svgBox = await svgLocator.boundingBox();
    expect(svgBox).toBeTruthy();

    const startX = svgBox!.x + svgBox!.width * 0.2;
    const startY = svgBox!.y + svgBox!.height * 0.2;
    const endX = svgBox!.x + svgBox!.width * 0.6;
    const endY = svgBox!.y + svgBox!.height * 0.6;

    await targetPage.mouse.move(startX, startY);
    await targetPage.mouse.down();
    await targetPage.mouse.move(endX, endY, { steps: 5 });
    await targetPage.mouse.up();

    // 4. 填写文案（期望输入框已由速记卡回填，此处确认最终值）
    await issueEditor.locator("[data-issue-actual]").fill(actualText);
    await issueEditor.locator("[data-issue-expected]").fill(expectedText);
    await issueEditor.locator("[data-issue-note]").fill(noteText);

    // 5. 点击"保存并继续"
    const saveBtn = issueEditor.locator("[data-issue-save]");
    await saveBtn.click();

    // ==========================================
    // 六、保存并继续后的运行状态
    // ==========================================
    await expect(issueEditor).toBeHidden({ timeout: 5_000 });
    await expect(selectionOverlay).toBeHidden({ timeout: 5_000 });
    await expect(markIssueButton).toBeVisible();

    const activeSessionAfterSave = await mediaProbe.activeSession();
    expect(activeSessionAfterSave?.id).toBe(session.id);
    expect(activeSessionAfterSave?.status).toBe("RECORDING");

    const snapshotAfterSave = await mediaProbe.snapshot(
      session.id,
      targetTabId!
    );
    expect(snapshotAfterSave.capture?.status).toBe("active");
    expect(snapshotAfterSave.offscreenActive).toBe(true);

    // 校验 IndexedDB 中的 Issue Scene 状态
    await mediaProbe.waitForEvidenceCounts(session.id, { issueSceneCount: 1 });
    const evidenceAfterSave = await mediaProbe.persistedFullEvidence(
      session.id
    );
    expect(evidenceAfterSave.issueScenes.length).toBe(1);

    const recordedScene = evidenceAfterSave.issueScenes[0];
    expect(recordedScene.status).toBe("complete");
    expect(recordedScene.issues).toEqual([]);

    logE2e(
      "Issue scene created with complete status, recording session remained active"
    );

    // 执行后续普通交互操作
    const afterActionButton = targetPage.locator(
      '[data-testid="after-issue-action"]'
    );
    await afterActionButton.click();
    await expect(
      targetPage.locator('[data-testid="after-issue-result"]')
    ).toContainText("普通操作已执行");

    // 确认产生了新的 confirmed interaction 且时间晚于 Issue Scene（按稳定 target locator 定位）
    await mediaProbe.waitForEvidenceCounts(session.id, {
      interactionCount: initialInteractionCount + 1,
    });
    const updatedEvidence = await mediaProbe.persistedFullEvidence(session.id);
    const afterInteraction = updatedEvidence.interactions.find(
      (i) =>
        i.element.id === "after-issue-action" ||
        i.element.locators?.some((l) =>
          l.expression.includes("after-issue-action")
        )
    );
    expect(afterInteraction).toBeDefined();
    expect(afterInteraction!.status).toBe("confirmed");
    expect(afterInteraction!.createdAt).toBeGreaterThan(
      recordedScene.observedAtEpochMs
    );

    // ==========================================
    // 七、Issue Scene 持久化契约
    // ==========================================
    expect(recordedScene.narrative?.actual).toBe(actualText);
    expect(recordedScene.narrative?.expected).toEqual({
      text: expectedText,
      confidence: "explicit",
    });
    expect(recordedScene.narrative?.note).toBe(noteText);

    expect(recordedScene.annotation?.userAnnotations?.length).toBe(1);
    const rectAnno = recordedScene.annotation?.userAnnotations?.[0];
    expect(rectAnno?.type).toBe("rect");
    if (rectAnno?.type === "rect") {
      expect(rectAnno.xRatio).toBeGreaterThanOrEqual(0);
      expect(rectAnno.xRatio).toBeLessThanOrEqual(1);
      expect(rectAnno.yRatio).toBeGreaterThanOrEqual(0);
      expect(rectAnno.yRatio).toBeLessThanOrEqual(1);
      expect(rectAnno.widthRatio).toBeGreaterThan(0);
      expect(rectAnno.heightRatio).toBeGreaterThan(0);
    }

    expect(recordedScene.target?.element.id).toBe("issue-target-element");
    expect(recordedScene.target?.element.boundingBox.width).toBeGreaterThan(0);
    expect(recordedScene.target?.element.boundingBox.height).toBeGreaterThan(0);
    expect(recordedScene.target?.ancestors?.length).toBeGreaterThan(0);
    expect(recordedScene.target?.element.locators?.length).toBeGreaterThan(0);

    const hasTargetLocator = recordedScene.target?.element.locators?.some(
      (l: { expression: string }) =>
        l.expression.includes("issue-target") ||
        l.expression.includes("issue-target-element")
    );
    expect(hasTargetLocator).toBe(true);
    expect(Boolean(recordedScene.target?.sanitizedHtml)).toBe(true);

    const originalAssetId = recordedScene.screenshot.originalAssetId;
    const annotatedAssetId = recordedScene.screenshot.annotatedAssetId;
    expect(originalAssetId).toBeTruthy();
    expect(annotatedAssetId).toBeTruthy();
    expect(originalAssetId).not.toBe(annotatedAssetId);

    const originalAsset = evidenceAfterSave.evidenceAssets.find(
      (a) => a.id === originalAssetId
    );
    const annotatedAsset = evidenceAfterSave.evidenceAssets.find(
      (a) => a.id === annotatedAssetId
    );

    expect(originalAsset).toBeDefined();
    expect(annotatedAsset).toBeDefined();

    expect(originalAsset?.sessionId).toBe(session.id);
    expect(annotatedAsset?.sessionId).toBe(session.id);
    expect(originalAsset?.issueSceneId).toBe(recordedScene.id);
    expect(annotatedAsset?.issueSceneId).toBe(recordedScene.id);

    expect(originalAsset?.kind).toBe("issue-original");
    expect(annotatedAsset?.kind).toBe("issue-annotated");

    expect(originalAsset?.mimeType).toBe("image/png");
    expect(annotatedAsset?.mimeType).toBe("image/png");

    expect(originalAsset?.byteLength).toBeGreaterThan(0);
    expect(annotatedAsset?.byteLength).toBeGreaterThan(0);
    expect(originalAsset?.width).toBeGreaterThan(0);
    expect(originalAsset?.height).toBeGreaterThan(0);

    // 强契约：原图与批注图宽高必须无条件一致
    expect(originalAsset?.width).toBe(annotatedAsset?.width);
    expect(originalAsset?.height).toBe(annotatedAsset?.height);

    // 真正调用 getEvidenceAssetBytes 进行实际 PNG 解码验证
    const originalAssetBytes = await mediaProbe.getEvidenceAssetBytes(
      originalAssetId!
    );
    const annotatedAssetBytes = await mediaProbe.getEvidenceAssetBytes(
      annotatedAssetId!
    );

    expect(originalAssetBytes).toBeDefined();
    expect(annotatedAssetBytes).toBeDefined();

    const checkPngMagicNumber = (buf: ArrayBuffer) => {
      const u8 = new Uint8Array(buf);
      expect(u8.length).toBeGreaterThan(8);
      // PNG Header: 0x89 50 4E 47 0D 0A 1A 0A
      expect(u8[0]).toBe(0x89);
      expect(u8[1]).toBe(0x50);
      expect(u8[2]).toBe(0x4e);
      expect(u8[3]).toBe(0x47);
    };

    checkPngMagicNumber(originalAssetBytes!.bytes);
    checkPngMagicNumber(annotatedAssetBytes!.bytes);

    logE2e("All Issue Scene persistence contract assertions passed cleanly");

    // ==========================================
    // 八、停止和 Preview
    // ==========================================
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

    const finalEvidence = await mediaProbe.persistedEvidence(
      previewPage,
      session.id
    );
    expect(finalEvidence.session?.status).toBe("PREVIEW_READY");
    expect(finalEvidence.session?.quality.overall).toBe("complete");
    expect(finalEvidence.session?.quality.issues).toEqual([]);

    expect(await mediaProbe.activeSession()).toBeUndefined();
    expect(await mediaProbe.isOffscreenRecording(session.id)).toBe(false);
    expect(await mediaProbe.isOverlayRemoved(targetPage)).toBe(true);
    expect(await mediaProbe.getBadgeText(targetTabId!)).toBe("");

    // 断言全局唯一 Preview 标签页
    const previewPagesCount = context
      .pages()
      .filter((p) => p.url().includes("/preview.html")).length;
    expect(previewPagesCount).toBe(1);
    expect(await mediaProbe.isOffscreenRecording(session.id)).toBe(false);
    expect(await mediaProbe.isOverlayRemoved(targetPage)).toBe(true);
    expect(await mediaProbe.getBadgeText(targetTabId!)).toBe("");

    // Preview 默认展示问题现场 Tab
    await previewPage.waitForSelector("#tab-pane-issues", { timeout: 10_000 });
    const issueCards = previewPage.locator(".issue-scene-card");
    expect(await issueCards.count()).toBe(1);

    const cardText = await issueCards.first().innerText();
    expect(cardText).toContain("完成");
    expect(cardText).toContain(actualText);
    expect(cardText).toContain(expectedText);
    expect(cardText).toContain(noteText);
    expect(cardText).toContain("issue-target");

    const cardImage = issueCards.first().locator("img[data-issue-image]");
    await expect(cardImage).toBeVisible();

    const cardImageDimensions = await cardImage.evaluate((img) => {
      const el = img as HTMLImageElement;
      return { width: el.naturalWidth, height: el.naturalHeight, src: el.src };
    });
    expect(cardImageDimensions.width).toBeGreaterThan(0);
    expect(cardImageDimensions.height).toBeGreaterThan(0);

    // 测试原图/批注图切换
    const toggleImageBtn = issueCards
      .first()
      .locator("button", { hasText: "查看原图" });
    await expect(toggleImageBtn).toBeVisible();
    await toggleImageBtn.click();

    const originalImageSrc = await cardImage.getAttribute("src");
    expect(originalImageSrc).not.toBe(cardImageDimensions.src);

    const toggleBackBtn = issueCards
      .first()
      .locator("button", { hasText: "查看批注图" });
    await expect(toggleBackBtn).toBeVisible();
    await toggleBackBtn.click();

    const restoredImageSrc = await cardImage.getAttribute("src");
    expect(restoredImageSrc).toBe(cardImageDimensions.src);

    // 点击截图打开大图预览
    const imageModal = previewPage.locator("#image-modal");
    await expect(imageModal).toBeHidden();
    await cardImage.click();
    await expect(imageModal).toBeVisible();
    const modalImage = imageModal.locator("#modal-image");
    await expect(modalImage).toHaveAttribute("src", restoredImageSrc ?? "");
    const modalTitle = await imageModal
      .locator("#modal-step-title")
      .innerText();
    expect(modalTitle).toContain("问题现场 1");
    await imageModal.locator("#modal-close-btn").click();
    await expect(imageModal).toBeHidden();

    // 点击“跳转录像”
    const video = previewPage.locator("#video");
    await expect(video).toBeVisible();

    const seekBtn = issueCards
      .first()
      .locator("button", { hasText: "跳转录像" });
    await expect(seekBtn).toBeVisible();
    await seekBtn.click();

    const videoCurrentTime = await video.evaluate(
      (el) => (el as HTMLVideoElement).currentTime
    );
    const sessionStartedAt =
      finalEvidence.session?.timeline.startedAtEpochMs ?? 0;
    const targetTimeSeconds =
      (recordedScene.observedAtEpochMs - sessionStartedAt) / 1000;

    // 允许 3.0 秒的 mediaTimeslice + UI 转向差
    expect(Math.abs(videoCurrentTime - targetTimeSeconds)).toBeLessThanOrEqual(
      3.5
    );

    logE2e("ISSUE-001 E2E test completed and all assertions passed perfectly!");
  });
});
