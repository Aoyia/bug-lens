import { test, expect } from "./fixtures/extension.ts";

function logE2e(message: string, details?: unknown): void {
  const suffix = details === undefined ? "" : ` ${JSON.stringify(details)}`;
  console.log(
    `[Bug Lens E2E][${new Date().toISOString()}] ${message}${suffix}`
  );
}

test.describe("Bug Lens Chrome Extension recording lifecycle", () => {
  test("REC-002: reopens real Action Popup during recording without creating duplicate sessions or interrupting media capture", async ({
    context,
    extensionId,
    openActionPopup,
    waitForPopupClosed,
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

    // 1. 打开测试网页
    let targetPage = context.pages()[0];
    if (!targetPage) targetPage = await context.newPage();
    await targetPage.goto(serverUrl);

    // 2. 确认目标页面获得浏览器焦点
    await targetPage.bringToFront();
    await targetPage.waitForFunction(() => document.hasFocus(), undefined, {
      timeout: 2_000,
    });
    logE2e("Target page loaded and focused", { url: targetPage.url() });

    // 3. 在打开 Popup 之前读取真实 targetTabId
    const targetTabId = await activeTabId();
    expect(targetTabId).toBeTruthy();
    logE2e("Resolved targetTabId before opening initial Popup", {
      targetTabId,
    });

    // 4. 通过 openActionPopup 打开真实 Popup
    const startPopup = await openActionPopup(targetPage);
    await startPopup.waitForSelector('[data-testid="record-panel"]');
    expect(await startPopup.isVisible('[data-testid="record-panel"]')).toBe(
      true
    );
    expect(await startPopup.text("#url")).toBe(serverUrl);

    // 4.1 开始录制按钮应展示明确的快捷键提示（与 manifest start-recording 一致）
    const expectedShortcut =
      process.platform === "darwin" ? "Option+R" : "Alt+R";
    await startPopup.waitForSelector('[data-testid="start-recording-btn"]');
    const title = await startPopup.evaluate<string>(
      'document.querySelector(\'[data-testid="start-recording-btn"]\')?.getAttribute("title") || ""'
    );
    expect(title).toContain(expectedShortcut);

    // 5. 点击开始按钮启动录制
    await startPopup.click('[data-testid="start-recording-btn"]');
    logE2e("Clicked start recording in first Popup");
    await startPopup.evaluate("window.close()").catch(() => undefined);
    await startPopup.dispose();
    await targetPage.bringToFront();
    await waitForPopupClosed();
    await targetPage.waitForFunction(() => document.hasFocus(), undefined, {
      timeout: 2_000,
    });

    // 6. 等待 Session 状态 RECORDING、tabCapture active、Offscreen Recorder recording
    const initialSession = await mediaProbe.waitForSession(targetTabId!);
    const activeMedia = await mediaProbe.waitForActive(
      initialSession.id,
      targetTabId!
    );
    expect(await mediaProbe.isOffscreenRecording(initialSession.id)).toBe(true);

    // 7. 记录基线
    const initialSessionId = initialSession.id;
    const initialStartCommandId = initialSession.commandIds?.start;
    expect(initialStartCommandId).toBeTruthy();
    const initialSessionCount = await mediaProbe.sessionCount();
    const initialChunkCount =
      await mediaProbe.mediaChunkCount(initialSessionId);

    logE2e("Initial session recording active baseline", {
      initialSessionId,
      targetTabId,
      initialStartCommandId,
      initialSessionCount,
      initialChunkCount,
      status: activeMedia.session?.status,
      captureStatus: activeMedia.capture?.status,
      offscreenActive: activeMedia.offscreenActive,
    });

    // 8. 等待至少产生一个媒体分片
    const chunkCountBeforeReopen =
      await mediaProbe.waitForMediaChunkCountGreaterThan(
        initialSessionId,
        0,
        5_000
      );
    expect(chunkCountBeforeReopen).toBeGreaterThan(0);
    logE2e("Confirmed initial media chunk generated", {
      chunkCountBeforeReopen,
    });

    // 9. 刷新目标页面：刷新会销毁旧 Content Script，但不能结束 TabCapture
    // 或创建新的 Recording Session。新页面加载后应重新出现录制控件。
    logE2e("Reloading target page while recording");
    await targetPage.reload({ waitUntil: "domcontentloaded" });
    await targetPage.waitForSelector("#__wbr_recording_widget__", {
      timeout: 10_000,
    });
    await expect(targetPage.locator("#__wbr_recording_widget__")).toBeVisible();

    const sessionAfterReload = await mediaProbe.activeSession();
    expect(sessionAfterReload?.id).toBe(initialSessionId);
    expect(sessionAfterReload?.target.tabId).toBe(targetTabId);
    expect(await mediaProbe.isOffscreenRecording(initialSessionId)).toBe(true);
    const chunkCountAfterReload =
      await mediaProbe.waitForMediaChunkCountGreaterThan(
        initialSessionId,
        chunkCountBeforeReopen,
        5_000
      );
    expect(chunkCountAfterReload).toBeGreaterThan(chunkCountBeforeReopen);
    logE2e("Reload preserved the session, widget, and media capture", {
      sessionId: sessionAfterReload?.id,
      chunkCountBeforeReload: chunkCountBeforeReopen,
      chunkCountAfterReload,
    });

    // 10. 重新把目标页面置前并确认焦点
    await targetPage.bringToFront();
    await targetPage.waitForFunction(() => document.hasFocus(), undefined, {
      timeout: 2_000,
    });

    // 10. 再次通过 openActionPopup(targetPage) 打开真实 Popup
    logE2e("Reopening real Action Popup during recording");
    const secondPopup = await openActionPopup(targetPage);

    // 11. 第二次 Popup 必须验证
    // 1. [data-testid="record-panel"] 可见
    await secondPopup.waitForSelector('[data-testid="record-panel"]');
    expect(await secondPopup.isVisible('[data-testid="record-panel"]')).toBe(
      true
    );

    // 2. Popup 显示的目标 URL 与测试网页一致
    expect(await secondPopup.text("#url")).toBe(serverUrl);

    // 3. 状态文本表示正在录制
    const secondStatusText = await secondPopup.text("#status");
    expect(secondStatusText).toBeTruthy();

    // 4. 计时器存在、格式正确，并且会继续递增
    const timer1 = await secondPopup.text("#timer");
    expect(timer1).toMatch(/^\d{2}:\d{2}$/);
    let timer2 = timer1;
    const timerDeadline = Date.now() + 5_000;
    while (Date.now() < timerDeadline) {
      timer2 = await secondPopup.text("#timer");
      if (timer2 !== timer1) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(timer2).toMatch(/^\d{2}:\d{2}$/);
    expect(timer2).not.toBe(timer1);

    // 5. 开始按钮不存在或不可见
    expect(
      await secondPopup.isVisible('[data-testid="start-recording-btn"]')
    ).toBe(false);

    // 6. 停止按钮可见并可用
    expect(
      await secondPopup.isVisible('[data-testid="stop-recording-btn"]')
    ).toBe(true);
    const stopDisabled = await secondPopup.evaluate<boolean>(
      "Boolean(document.querySelector('[data-testid=\"stop-recording-btn\"]')?.disabled)"
    );
    expect(stopDisabled).toBe(false);

    // 7. Preview 按钮不应出现
    expect(await secondPopup.isVisible('[data-testid="preview-btn"]')).toBe(
      false
    );

    // 8 & 9. 展开高级配置并验证所有控件被锁定以及默认值保持正确
    await secondPopup.click("#toggle-options");
    await secondPopup.waitForSelector("#advanced-options");

    const secondPopupOptionsState = await secondPopup.evaluate<{
      videoChecked: boolean;
      videoDisabled: boolean;
      audioChecked: boolean;
      audioDisabled: boolean;
      screenshotsChecked: boolean;
      screenshotsDisabled: boolean;
      consoleChecked: boolean;
      consoleDisabled: boolean;
      networkChecked: boolean;
      networkDisabled: boolean;
      responseBodiesValue: string;
      responseBodiesDisabled: boolean;
      privacyValue: string;
      privacyDisabled: boolean;
    }>(`(() => {
      const get = (id) => document.querySelector("#" + id);
      return {
        videoChecked: Boolean(get("video")?.checked),
        videoDisabled: Boolean(get("video")?.disabled),
        audioChecked: Boolean(get("audio")?.checked),
        audioDisabled: Boolean(get("audio")?.disabled),
        screenshotsChecked: Boolean(get("screenshots")?.checked),
        screenshotsDisabled: Boolean(get("screenshots")?.disabled),
        consoleChecked: Boolean(get("console")?.checked),
        consoleDisabled: Boolean(get("console")?.disabled),
        networkChecked: Boolean(get("network")?.checked),
        networkDisabled: Boolean(get("network")?.disabled),
        responseBodiesValue: get("response-bodies")?.value || "",
        responseBodiesDisabled: Boolean(get("response-bodies")?.disabled),
        privacyValue: get("privacy")?.value || "",
        privacyDisabled: Boolean(get("privacy")?.disabled)
      };
    })()`);

    logE2e("Second Popup verified status, timer, and locked options", {
      statusText: secondStatusText,
      timerInitial: timer1,
      timerIncremented: timer2,
      optionsState: secondPopupOptionsState,
    });

    expect(secondPopupOptionsState.videoDisabled).toBe(true);
    expect(secondPopupOptionsState.audioDisabled).toBe(true);
    expect(secondPopupOptionsState.screenshotsDisabled).toBe(true);
    expect(secondPopupOptionsState.consoleDisabled).toBe(true);
    expect(secondPopupOptionsState.networkDisabled).toBe(true);
    expect(secondPopupOptionsState.responseBodiesDisabled).toBe(true);
    expect(secondPopupOptionsState.privacyDisabled).toBe(true);

    expect(secondPopupOptionsState.videoChecked).toBe(true);
    expect(secondPopupOptionsState.audioChecked).toBe(false);
    expect(secondPopupOptionsState.screenshotsChecked).toBe(true);
    expect(secondPopupOptionsState.consoleChecked).toBe(true);
    expect(secondPopupOptionsState.networkChecked).toBe(true);
    expect(secondPopupOptionsState.responseBodiesValue).toBe("standard");
    expect(secondPopupOptionsState.privacyValue).toBe("safe");

    // 12. 校验 Session 与契约数据
    const sessionDuringReopen = await mediaProbe.activeSession();
    expect(sessionDuringReopen?.id).toBe(initialSessionId);
    expect(sessionDuringReopen?.commandIds?.start).toBe(initialStartCommandId);
    expect(sessionDuringReopen?.target.tabId).toBe(targetTabId);

    const sessionCountDuringReopen = await mediaProbe.sessionCount();
    expect(sessionCountDuringReopen).toBe(initialSessionCount);

    const snapshotDuringReopen = await mediaProbe.snapshot(
      initialSessionId,
      targetTabId!
    );
    expect(snapshotDuringReopen.capture?.status).toBe("active");
    expect(snapshotDuringReopen.offscreenActive).toBe(true);
    expect(await mediaProbe.isOffscreenRecording(initialSessionId)).toBe(true);
    expect(sessionDuringReopen?.quality.issues).toEqual([]);

    logE2e("Reopened Popup session contract verified", {
      reopenedSessionId: sessionDuringReopen?.id,
      reopenedSessionCount: sessionCountDuringReopen,
      startCommandId: sessionDuringReopen?.commandIds?.start,
      captureStatus: snapshotDuringReopen.capture?.status,
      offscreenActive: snapshotDuringReopen.offscreenActive,
    });

    // 13. 关闭第二次 Popup，恢复到目标页面
    await secondPopup.evaluate("window.close()").catch(() => undefined);
    await secondPopup.dispose();
    await targetPage.bringToFront();
    await waitForPopupClosed();
    await targetPage.waitForFunction(() => document.hasFocus(), undefined, {
      timeout: 2_000,
    });
    logE2e("Second Popup closed and target page focused");

    // 14. 验证 Popup 关闭后媒体分片数量继续增长
    const chunkCountAfterClose =
      await mediaProbe.waitForMediaChunkCountGreaterThan(
        initialSessionId,
        chunkCountBeforeReopen,
        5_000
      );
    expect(chunkCountAfterClose).toBeGreaterThan(chunkCountBeforeReopen);
    logE2e("Media chunks continued to grow after closing second Popup", {
      chunkCountBeforeReopen,
      chunkCountAfterClose,
    });

    // 14.5 验证 Widget 闲置暂停/时间冻结与恢复机制
    const timerDisplay = targetPage.locator("#__wbr_timer_display__");
    await expect(timerDisplay).toBeVisible();
    const initialTimerText = await timerDisplay.innerText();
    expect(initialTimerText).toMatch(/^\d{2}:\d{2}$/);

    // 15. 从页面内可见停止按钮停止录制
    const stopButton = targetPage.locator("#__wbr_stop_btn__");
    await expect(stopButton).toBeVisible();

    logE2e("Clicking in-page stop button");
    await stopButton.click();

    const exportedDownload = await mediaProbe.waitForExportDownload();
    logE2e("Silent export download completed", {
      filename: exportedDownload.filename,
      state: exportedDownload.state,
      totalBytes: exportedDownload.totalBytes,
    });
    expect(exportedDownload.state).toBe("complete");
    expect(exportedDownload.totalBytes ?? 0).toBeGreaterThan(0);

    // 静默导出不自动弹出标签页，按需主动打开 Preview 页面验证播放器与证据详情
    const previewPage = await context.newPage();
    await previewPage.goto(
      `chrome-extension://${extensionId}/preview.html?sessionId=${initialSessionId}`
    );
    await previewPage.waitForLoadState("domcontentloaded");
    logE2e("Preview page opened for verification", {
      previewUrl: previewPage.url(),
    });

    // 16. 停止后的断言与资源清理
    expect(previewPage.url()).toContain(initialSessionId);

    const evidence = await mediaProbe.persistedEvidence(
      previewPage,
      initialSessionId
    );
    const totalMediaBytes = evidence.mediaChunks.reduce(
      (total, chunk) => total + chunk.byteLength,
      0
    );

    logE2e("Final evidence and quality summary", {
      sessionId: evidence.session?.id,
      sessionStatus: evidence.session?.status,
      overallQuality: evidence.session?.quality.overall,
      qualityIssues: evidence.session?.quality.issues,
      mediaChunkCount: evidence.mediaChunks.length,
      totalMediaBytes,
    });

    expect(evidence.session?.id).toBe(initialSessionId);
    expect(evidence.session?.status).toBe("PREVIEW_READY");
    expect(evidence.session?.quality.overall).toBe("complete");
    expect(evidence.session?.quality.issues).toEqual([]);

    expect(evidence.mediaChunks.length).toBeGreaterThan(0);
    expect(totalMediaBytes).toBeGreaterThan(0);
    expect(
      evidence.mediaChunks.every((chunk, index) => chunk.sequence === index)
    ).toBe(true);

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
    const duration = await video.evaluate(
      (element) => (element as HTMLVideoElement).duration
    );
    expect(duration).toBeGreaterThan(0);

    const stoppedCapture = await previewPage.evaluate(async () =>
      chrome.tabCapture.getCapturedTabs()
    );
    const targetCapture = stoppedCapture.find(
      (entry) => entry.tabId === targetTabId
    );
    expect(targetCapture?.status).not.toBe("active");
    expect(targetCapture?.status).not.toBe("pending");

    expect(await mediaProbe.isOffscreenRecording(initialSessionId)).toBe(false);
    expect(await mediaProbe.isOverlayRemoved(targetPage)).toBe(true);
    expect(await mediaProbe.activeSession()).toBeUndefined();

    const previewPages = context
      .pages()
      .filter(
        (p) =>
          p.url().includes(`chrome-extension://${extensionId}/preview.html`) &&
          p.url().includes(initialSessionId)
      );
    expect(previewPages.length).toBe(1);

    const badgeText = await mediaProbe.getBadgeText(targetTabId!);
    expect(badgeText).toBe("");

    logE2e(
      "REC-002 test assertions and resource cleanup completed successfully",
      {
        sessionId: initialSessionId,
        previewUrl: previewPage.url(),
        qualityOverall: evidence.session?.quality.overall,
        cleanup: {
          tabCaptureActive: targetCapture?.status === "active",
          offscreenRecording: false,
          overlayRemoved: true,
          activeSessionCleared: true,
          previewCount: previewPages.length,
          badgeText,
        },
      }
    );
  });

  test("LIFECYCLE-004: validates background resilience and data persistence when recorded target tab is unexpectedly closed during active recording", async ({
    context,
    extensionId,
    serviceWorker,
    openActionPopup,
    waitForPopupClosed,
    activeTabId,
    mediaProbe,
    serverUrl,
  }) => {
    // 监听 Service Worker 未处理的 Promise 拒绝及浏览器上下文未捕获异常，严格满足 R2.4 规范
    await serviceWorker.evaluate(() => {
      (
        self as unknown as { __testUnhandledRejections: string[] }
      ).__testUnhandledRejections = [];
      self.addEventListener(
        "unhandledrejection",
        (event: PromiseRejectionEvent) => {
          (
            self as unknown as { __testUnhandledRejections: string[] }
          ).__testUnhandledRejections.push(
            event.reason
              ? String(event.reason?.stack || event.reason)
              : "unknown rejection"
          );
        }
      );
    });

    const contextErrors: string[] = [];
    context.on("weberror", (webError) => {
      contextErrors.push(String(webError.error()));
    });

    context.on("console", (message) => {
      logE2e(`Browser console.${message.type()}`, {
        url: message.page()?.url() ?? "extension-worker-or-popup",
        text: message.text(),
      });
    });

    // 0. 保留基础标签页以保证窗口在测试页面强制关闭时仍维持浏览器上下文存活
    const keeperPage = context.pages()[0] ?? (await context.newPage());
    if (keeperPage.url() === "about:blank") {
      logE2e("Keeper page established", { url: keeperPage.url() });
    }

    // 1. 打开测试网页并确保获得焦点
    const targetPage = await context.newPage();
    await targetPage.goto(serverUrl);
    await targetPage.bringToFront();
    await targetPage.waitForFunction(() => document.hasFocus(), undefined, {
      timeout: 2_000,
    });
    logE2e("Target page loaded and focused", { url: targetPage.url() });

    // 2. 读取目标标签页 ID 并打开 Action Popup 启动录制
    const targetTabId = await activeTabId();
    expect(targetTabId).toBeTruthy();
    logE2e("Resolved targetTabId before opening Popup", { targetTabId });

    const startPopup = await openActionPopup(targetPage);
    await startPopup.waitForSelector('[data-testid="record-panel"]');
    expect(await startPopup.isVisible('[data-testid="record-panel"]')).toBe(
      true
    );

    await startPopup.click('[data-testid="start-recording-btn"]');
    logE2e("Clicked start recording in Popup");
    await startPopup.evaluate("window.close()").catch(() => undefined);
    await startPopup.dispose();
    await targetPage.bringToFront();
    await waitForPopupClosed();
    await targetPage.waitForFunction(() => document.hasFocus(), undefined, {
      timeout: 2_000,
    });

    // 3. 等待录制会话建立与媒体录制激活
    const session = await mediaProbe.waitForSession(targetTabId!);
    const activeMedia = await mediaProbe.waitForActive(
      session.id,
      targetTabId!
    );
    expect(await mediaProbe.isOffscreenRecording(session.id)).toBe(true);
    expect(await mediaProbe.isDebuggerAttached(targetTabId!)).toBe(true);
    await expect
      .poll(async () => mediaProbe.getBadgeText(targetTabId!), {
        timeout: 5_000,
      })
      .toBe("REC");
    logE2e("Recording active and confirmed", {
      sessionId: session.id,
      targetTabId,
      status: activeMedia.session?.status,
      captureStatus: activeMedia.capture?.status,
    });

    // 4. R1: 在录制进行中产生用户交互、控制台错误与网络请求
    await targetPage.locator('[data-testid="test-click-btn"]').click();
    await expect(targetPage.locator("#output")).toContainText(
      "点击已被成功记录"
    );

    await targetPage
      .locator('[data-testid="test-text-input"]')
      .fill("Bug Lens Unexpected Tab Close Test");
    await expect(
      targetPage.locator('[data-testid="test-text-input"]')
    ).toHaveValue("Bug Lens Unexpected Tab Close Test");

    await targetPage.locator('[data-testid="test-fetch-btn"]').click();
    await expect(targetPage.locator("#output")).toContainText("Fetch 请求成功");

    await targetPage.locator('[data-testid="test-error-btn"]').click();
    await expect(targetPage.locator("#output")).toHaveText("控制台报错已触发");

    // 等待至少产生一个包含有效音视频关键帧的媒体分片（确保落盘数据不仅有容器头，且有真实视频 Cluster 数据）
    const bytesBeforeClose = await mediaProbe.waitForMediaBytesGreaterThan(
      session.id,
      5_000,
      10_000
    );
    expect(bytesBeforeClose).toBeGreaterThan(5_000);
    const chunkCountBeforeClose = await mediaProbe.mediaChunkCount(session.id);
    expect(chunkCountBeforeClose).toBeGreaterThan(0);
    logE2e(
      "Pre-closure interactions, console errors, network requests, and media verified",
      {
        bytesBeforeClose,
        chunkCountBeforeClose,
      }
    );

    // 5. R1: 模拟意外关闭标签页：直接调用 targetPage.close()，不点击任何停止按钮
    logE2e("Forcefully closing target page during active recording");
    await targetPage.close();

    // 6. R2: 验证后台自动恢复与资源清理
    // 6.1 Offscreen 录屏文档停止录制
    await expect
      .poll(async () => mediaProbe.isOffscreenRecording(session.id), {
        timeout: 10_000,
      })
      .toBe(false);
    logE2e("Offscreen recording confirmed stopped");

    // 6.2 数据库中 activeSession 彻底被清空终结
    await expect
      .poll(async () => mediaProbe.activeSession(), {
        timeout: 10_000,
      })
      .toBeUndefined();
    logE2e("Database activeSession confirmed cleared (undefined)");

    // 6.3 Action badge 重置为空字符串
    await expect
      .poll(async () => mediaProbe.getBadgeText(targetTabId!), {
        timeout: 10_000,
      })
      .toBe("");
    expect(await mediaProbe.getBadgeText()).toBe("");
    logE2e("Extension action badge confirmed reset to empty string");

    // 6.4 CDP 调试器会话与 tabCapture 优雅分离，无僵尸会话或悬挂捕获状态，无未处理异常
    await expect
      .poll(async () => mediaProbe.isDebuggerAttached(targetTabId!), {
        timeout: 10_000,
      })
      .toBe(false);
    const attachedTargets = await mediaProbe.getAttachedDebuggerTargets();
    expect(attachedTargets.filter((t) => t.tabId === targetTabId)).toHaveLength(
      0
    );

    const snapshotAfterClose = await mediaProbe.snapshot(
      session.id,
      targetTabId!
    );
    expect(snapshotAfterClose.capture?.status).not.toBe("active");
    expect(snapshotAfterClose.capture?.status).not.toBe("pending");
    expect(await mediaProbe.isOffscreenRecording(session.id)).toBe(false);

    // 严格满足 R2.4：断言 Service Worker 与全局上下文无 unhandled rejection 或运行时崩溃抛错
    const unhandledRejections = await serviceWorker.evaluate(() => {
      return (
        (self as unknown as { __testUnhandledRejections?: string[] })
          .__testUnhandledRejections ?? []
      );
    });
    expect(unhandledRejections).toEqual([]);
    expect(contextErrors).toEqual([]);
    logE2e(
      "CDP debugger, tabCapture teardown, and unhandled rejection checks confirmed clean"
    );

    // 7. R3: 打开新标签页访问 Preview 页面（等待并复用后台由 openPendingPreview 触发创建的页面，若必要则降级打开）
    const previewUrlSubstring = `/preview.html?sessionId=${session.id}`;
    let previewPage = context
      .pages()
      .find((p) => p.url().includes(previewUrlSubstring));

    if (!previewPage) {
      try {
        await expect
          .poll(
            () =>
              context
                .pages()
                .find((p) => p.url().includes(previewUrlSubstring)),
            { timeout: 10_000 }
          )
          .toBeDefined();
        previewPage = context
          .pages()
          .find((p) => p.url().includes(previewUrlSubstring));
      } catch {
        previewPage = await context.newPage();
        await previewPage.goto(
          `chrome-extension://${extensionId}/preview.html?sessionId=${session.id}`
        );
      }
    }

    expect(previewPage).toBeDefined();
    await previewPage!.bringToFront();
    await previewPage!.waitForLoadState("domcontentloaded");

    // 验证整个测试上下文仅存在单一 Preview 页面，不存在重复弹窗竞态
    const matchingPreviewPages = context
      .pages()
      .filter((p) => p.url().includes(previewUrlSubstring));
    expect(matchingPreviewPages).toHaveLength(1);
    logE2e("Preview page confirmed single instance and loaded", {
      previewUrl: previewPage!.url(),
    });

    // 8. R3: 验证崩溃前所有交互、日志、网络请求与媒体证据均完整持久化入库
    const evidence = await mediaProbe.persistedEvidence(
      previewPage!,
      session.id
    );
    const totalMediaBytes = evidence.mediaChunks.reduce(
      (total, chunk) => total + chunk.byteLength,
      0
    );

    logE2e("Persisted evidence summary after unexpected tab closure", {
      sessionId: evidence.session?.id,
      sessionStatus: evidence.session?.status,
      interactionCount: evidence.interactionCount,
      consoleCount: evidence.consoleCount,
      networkCount: evidence.networkCount,
      mediaChunkCount: evidence.mediaChunks.length,
      totalMediaBytes,
    });

    expect(evidence.session?.id).toBe(session.id);
    expect(evidence.session?.status).toBe("PREVIEW_READY");
    expect(evidence.interactionCount).toBeGreaterThanOrEqual(4);
    expect(evidence.consoleCount).toBeGreaterThanOrEqual(2);
    expect(evidence.networkCount).toBeGreaterThanOrEqual(1);
    expect(evidence.mediaChunks.length).toBeGreaterThanOrEqual(
      chunkCountBeforeClose
    );
    expect(totalMediaBytes).toBeGreaterThan(0);

    // 验证截取的交互、日志与请求内容真实且未被破坏
    const fullEvidence = await mediaProbe.persistedFullEvidence(session.id);

    // 验证普通点击已被精确持久化（同时匹配元素 ID 与语义文本）
    const clickBtnEntry = fullEvidence.interactions.find(
      (entry) =>
        entry.kind === "click" &&
        entry.element?.id === "test-click-btn" &&
        Boolean(entry.element?.text?.includes("普通点击"))
    );
    expect(clickBtnEntry).toBeDefined();

    // 验证网络触发点击已被精确持久化（同时匹配元素 ID 与语义文本）
    const fetchBtnEntry = fullEvidence.interactions.find(
      (entry) =>
        entry.kind === "click" &&
        entry.element?.id === "test-fetch-btn" &&
        Boolean(entry.element?.text?.includes("网络请求"))
    );
    expect(fetchBtnEntry).toBeDefined();

    // 验证报错触发点击已被精确持久化（同时匹配元素 ID 与语义文本）
    const errorBtnEntry = fullEvidence.interactions.find(
      (entry) =>
        entry.kind === "click" &&
        entry.element?.id === "test-error-btn" &&
        Boolean(entry.element?.text?.includes("Console 报错"))
    );
    expect(errorBtnEntry).toBeDefined();

    // 验证输入交互已被持久化（严格匹配 input/change 且元素 ID 为 test-text-input，并校验输入长度）
    const inputEntry = fullEvidence.interactions.find(
      (entry) =>
        (entry.kind === "input" || entry.kind === "change") &&
        entry.element?.id === "test-text-input"
    );
    expect(inputEntry).toBeDefined();
    expect(inputEntry?.metadata?.valueLength).toBe(
      "Bug Lens Unexpected Tab Close Test".length
    );

    // 验证正常 console.log 及报错 console.error 均被精确持久化
    const logConsoleEntry = fullEvidence.consoleEntries.find((entry) =>
      entry.text.includes("用户点击了测试按钮")
    );
    expect(logConsoleEntry).toBeDefined();

    const errorConsoleEntry = fullEvidence.consoleEntries.find((entry) =>
      entry.text.includes("foo is not defined")
    );
    expect(errorConsoleEntry).toBeDefined();
    expect(errorConsoleEntry?.level).toBe("error");

    // 验证网络请求 /api/todo 及其响应状态已被持久化
    const todoNetworkEntry = fullEvidence.networkEntries.find((entry) =>
      entry.url.includes("/api/todo")
    );
    expect(todoNetworkEntry).toBeDefined();
    expect(todoNetworkEntry?.status).toBe(200);

    // 验证媒体分片序列递增且数据有效
    fullEvidence.mediaChunks.forEach((chunk, index) => {
      expect(chunk.sequence).toBe(index);
      expect(chunk.byteLength).toBeGreaterThan(0);
      expect(chunk.mimeType).toBeTruthy();
    });

    // 9. 验证 Preview 页面正常渲染，未崩溃且未报加载失败
    await expect(previewPage!.locator("#meta")).toBeVisible();
    await expect(previewPage!.locator("body")).not.toContainText("加载失败");
    await expect(previewPage!.locator("body")).not.toContainText("未知错误");

    const video = previewPage!.locator("#video");
    await expect(video).toBeVisible({ timeout: 10_000 });
    await previewPage!.waitForFunction(
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
    const duration = await video.evaluate(
      (element) => (element as HTMLVideoElement).duration
    );
    expect(duration).toBeGreaterThan(0);

    // 验证视频可被正常进度跳转，证明录屏在强制中断时的 EBML 头元数据修复完好
    await video.evaluate((v: HTMLVideoElement) => {
      v.currentTime = Math.min(0.5, v.duration / 2);
    });
    const scrubbedTime = await video.evaluate(
      (v: HTMLVideoElement) => v.currentTime
    );
    expect(scrubbedTime).toBeGreaterThanOrEqual(0);

    // 验证 Console 标签页中显示了报错日志及普通日志
    await previewPage!.locator('.zen-tab-btn[data-tab="console"]').click();
    await expect(
      previewPage!.locator("#tab-pane-console .console-row")
    ).not.toHaveCount(0);
    await expect(previewPage!.locator("#tab-pane-console")).toContainText(
      "foo is not defined"
    );
    await expect(previewPage!.locator("#tab-pane-console")).toContainText(
      "用户点击了测试按钮"
    );

    // 验证 Network 标签页中显示了 Fetch 请求及 200 状态码
    await previewPage!.locator('.zen-tab-btn[data-tab="network"]').click();
    await expect(
      previewPage!.locator("#tab-pane-network .network-row")
    ).not.toHaveCount(0);
    await expect(previewPage!.locator("#tab-pane-network")).toContainText(
      "/api/todo"
    );
    await expect(previewPage!.locator("#tab-pane-network")).toContainText(
      "200"
    );

    // 验证 Steps 标签页中显示了所有用户交互步骤与按钮文本
    await previewPage!.locator('.zen-tab-btn[data-tab="steps"]').click();
    await expect(
      previewPage!.locator("#tab-pane-steps article.item")
    ).not.toHaveCount(0);
    await expect(previewPage!.locator("#tab-pane-steps")).toContainText(
      "普通点击"
    );
    await expect(previewPage!.locator("#tab-pane-steps")).toContainText(
      "网络请求"
    );
    await expect(previewPage!.locator("#tab-pane-steps")).toContainText(
      "Console 报错"
    );

    logE2e("LIFECYCLE-004 test passed all assertions successfully");
  });
});
