import { test, expect } from "./fixtures/extension.ts";

test.describe("Progressive Quick Export Guide E2E", () => {
  test("GUIDE-001: Stage 1 opens hydrated preview, shows upgrade banner on 3rd unedited export, and switches to Stage 2 silent export", async ({
    context,
    extensionId,
    openActionPopup,
    mediaProbe,
    serverUrl,
  }) => {
    let targetPage = context.pages()[0];
    if (!targetPage) targetPage = await context.newPage();
    await targetPage.goto(serverUrl);

    // 第 1 次录制（默认第一阶段：导出并打开预览，不展示推荐横幅）
    const popup1 = await openActionPopup(targetPage);
    await popup1.waitForSelector('[data-testid="record-panel"]');
    const targetTabId = await popup1.evaluate<number | undefined>(
      "(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id)()"
    );
    expect(targetTabId).toBeTruthy();
    await popup1.click('[data-testid="start-recording-btn"]');
    await popup1.dispose();

    const sess1 = await mediaProbe.waitForSession(targetTabId!);
    await mediaProbe.waitForActive(sess1.id, targetTabId!);
    await targetPage.bringToFront();
    await targetPage.locator('[data-testid="test-click-btn"]').click();
    await mediaProbe.waitForMediaChunkCountGreaterThan(sess1.id, 0, 5_000);

    await targetPage.locator("#__wbr_stop_btn__").click();
    const download1 = await mediaProbe.waitForExportDownload(20_000);
    expect(download1.state).toBe("complete");

    // 应自动打开预览页，URL 已剥离 fromStopExport，ExportArtifact 已预回填，且横幅隐藏
    await expect
      .poll(
        () =>
          context
            .pages()
            .find((p) =>
              p.url().includes(`/preview.html?sessionId=${sess1.id}`)
            ),
        { timeout: 10_000 }
      )
      .toBeDefined();
    const preview1 = context
      .pages()
      .find((p) => p.url().includes(`/preview.html?sessionId=${sess1.id}`))!;
    await preview1.waitForLoadState("domcontentloaded");
    await expect
      .poll(() => preview1.url(), { timeout: 5_000 })
      .not.toContain("fromStopExport=1");
    await expect(preview1.locator("#ai-status")).toContainText(
      /(下载完成|Download complete|已下载)/i,
      { timeout: 5_000 }
    );
    await preview1.locator("#toggle-ai-drawer").click();
    await expect(preview1.locator("#copy-ai-path")).toBeVisible({
      timeout: 5_000,
    });
    await expect(preview1.locator("#quick-export-upgrade-banner")).toBeHidden();
    await preview1.close();

    // 模拟用户已完成第 2 次未编辑导出，即将进入第 3 次导出
    await mediaProbe.evaluateWorker(async () => {
      await chrome.storage.local.set({
        "quick-export-guide-state": {
          stage1ExportCount: 2,
          consecutiveUneditedCount: 1,
          lastStopExportSessionId: "prev-unedited-session",
          lastStopExportEdited: false,
          status: "idle",
          dismissCount: 0,
          stage2OnboardingToastCount: 0,
        },
      });
    }, undefined);

    // 第 3 次录制并结束 -> 触发 strong 信号推荐横幅
    await targetPage.bringToFront();
    const popup2 = await openActionPopup(targetPage);
    await popup2.waitForSelector('[data-testid="record-panel"]');
    await popup2.click('[data-testid="start-recording-btn"]');
    await popup2.dispose();

    const sess2 = await mediaProbe.waitForSession(targetTabId!);
    await mediaProbe.waitForActive(sess2.id, targetTabId!);
    await targetPage.bringToFront();
    await targetPage.locator('[data-testid="test-click-btn"]').click();
    await mediaProbe.waitForMediaChunkCountGreaterThan(sess2.id, 0, 5_000);

    await targetPage.locator("#__wbr_stop_btn__").click();
    const download2 = await mediaProbe.waitForExportDownload(20_000);
    expect(download2.state).toBe("complete");

    await expect
      .poll(
        () =>
          context
            .pages()
            .find((p) =>
              p.url().includes(`/preview.html?sessionId=${sess2.id}`)
            ),
        { timeout: 10_000 }
      )
      .toBeDefined();
    const preview2 = context
      .pages()
      .find((p) => p.url().includes(`/preview.html?sessionId=${sess2.id}`))!;
    await preview2.waitForLoadState("domcontentloaded");

    const upgradeBanner = preview2.locator("#quick-export-upgrade-banner");
    await expect(upgradeBanner).toBeVisible({ timeout: 5_000 });

    // 点击「开启直接导出」升级到第二阶段
    await preview2.locator("#quick-export-enable-btn").click();
    await expect(upgradeBanner).toBeHidden();

    await expect
      .poll(
        async () =>
          mediaProbe.evaluateWorker(async () => {
            const stored = await chrome.storage.local.get("app-settings");
            return (
              stored?.["app-settings"] as {
                workflow?: { stopAction?: string };
              }
            )?.workflow?.stopAction;
          }, undefined),
        { timeout: 5_000 }
      )
      .toBe("silentExport");
    await preview2.close();

    // 第二阶段：再次录制并结束，停留在当前页弹出 Toast，不再自动打开预览页
    await targetPage.bringToFront();
    const popup3 = await openActionPopup(targetPage);
    await popup3.waitForSelector('[data-testid="record-panel"]');
    await popup3.click('[data-testid="start-recording-btn"]');
    await popup3.dispose();

    const sess3 = await mediaProbe.waitForSession(targetTabId!);
    await mediaProbe.waitForActive(sess3.id, targetTabId!);
    await targetPage.bringToFront();
    await targetPage.locator('[data-testid="test-click-btn"]').click();
    await mediaProbe.waitForMediaChunkCountGreaterThan(sess3.id, 0, 5_000);

    await targetPage.locator("#__wbr_stop_btn__").click();
    const download3 = await mediaProbe.waitForExportDownload(20_000);
    expect(download3.state).toBe("complete");

    await expect(targetPage.locator("#__wbr_toast__")).toBeVisible({
      timeout: 5_000,
    });
    await targetPage.waitForTimeout(800);
    const openPreviewTabs = context
      .pages()
      .filter((p) =>
        p.url().includes(`chrome-extension://${extensionId}/preview.html`)
      );
    expect(openPreviewTabs.length).toBe(0);
  });

  test("GUIDE-002: Preview page hydrates ExportArtifact, strips fromStopExport, tracks edits, and upgrades stopAction via banner", async ({
    context,
    extensionId,
    mediaProbe,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/preview.html`);
    await page.waitForLoadState("domcontentloaded");

    // 写入 3 个会话与已完成的 ExportArtifact（无需录屏和系统快捷键权限）
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open("web-bug-recorder", 7);
        req.onupgradeneeded = () => {
          const database = req.result;
          const tx = req.transaction!;
          const ensureStore = (
            name: string,
            keyPath: string,
            indexes: Array<{ name: string; keyPath: string | string[] }> = []
          ) => {
            const store = database.objectStoreNames.contains(name)
              ? tx.objectStore(name)
              : database.createObjectStore(name, { keyPath });
            for (const index of indexes) {
              if (!store.indexNames.contains(index.name)) {
                store.createIndex(index.name, index.keyPath);
              }
            }
          };
          ensureStore("control", "key");
          ensureStore("sessions", "id", [
            { name: "status", keyPath: "status" },
          ]);
          ensureStore("interactions", "id", [
            { name: "sessionId", keyPath: "sessionId" },
          ]);
          ensureStore("consoleEntries", "id", [
            { name: "sessionId", keyPath: "sessionId" },
          ]);
          ensureStore("networkEntries", "id", [
            { name: "sessionId", keyPath: "sessionId" },
          ]);
          ensureStore("mediaChunks", "id", [
            { name: "sessionId", keyPath: "sessionId" },
            { name: "sessionIdSequence", keyPath: ["sessionId", "sequence"] },
          ]);
          ensureStore("exportSelections", "sessionId");
          ensureStore("exportArtifacts", "sessionId");
          ensureStore("issueScenes", "id", [
            { name: "sessionId", keyPath: "sessionId" },
            {
              name: "sessionIdObservedAt",
              keyPath: ["sessionId", "observedAtEpochMs"],
            },
          ]);
          ensureStore("evidenceAssets", "id", [
            { name: "sessionId", keyPath: "sessionId" },
            { name: "issueSceneId", keyPath: "issueSceneId" },
          ]);
          ensureStore("frameworkStates", "id", [
            { name: "sessionId", keyPath: "sessionId" },
            {
              name: "sessionIdCapturedAt",
              keyPath: ["sessionId", "capturedAtEpochMs"],
            },
          ]);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });

      const now = Date.now();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(
          ["sessions", "interactions", "exportArtifacts"],
          "readwrite"
        );
        for (const id of ["guide-s1", "guide-s2", "guide-s3"]) {
          tx.objectStore("sessions").put({
            id,
            schemaVersion: 2,
            extensionVersion: "0.7.43",
            status: "PREVIEW_READY",
            target: {
              tabId: 1,
              initialUrl: "http://127.0.0.1/guide",
              initialTitle: `Guide Session ${id}`,
            },
            options: {
              captureVideo: false,
              captureAudio: false,
              captureScreenshots: false,
              captureConsole: false,
              captureNetwork: false,
              privacyMode: "safe",
            },
            timeline: {
              createdAtEpochMs: now - 5000,
              startedAtEpochMs: now - 4000,
              stoppedAtEpochMs: now - 1000,
              durationMs: 3000,
            },
            quality: {
              interactionCount: 1,
              confirmedInteractionCount: 1,
              primaryScreenshotCount: 0,
              fallbackScreenshotCount: 0,
              unavailableScreenshotCount: 1,
              consoleEntryCount: 0,
              networkEntryCount: 0,
              overall: "complete",
              issues: [],
            },
            nonce: "guide-nonce",
          });
          tx.objectStore("interactions").put({
            id: `${id}-int-1`,
            sessionId: id,
            kind: "click",
            status: "confirmed",
            createdAt: now - 3000,
            confirmedAt: now - 2950,
            page: {
              url: "http://127.0.0.1/guide",
              title: `Guide Session ${id}`,
              frameId: 0,
            },
            input: { pointerType: "mouse", button: 0, isTrusted: true },
            coordinates: {
              clientX: 10,
              clientY: 10,
              pageX: 10,
              pageY: 10,
              scrollX: 0,
              scrollY: 0,
              devicePixelRatio: 1,
              viewport: { width: 1280, height: 720 },
            },
            element: { tagName: "button", text: "Submit" },
            screenshot: { status: "unavailable" },
          });
          tx.objectStore("exportArtifacts").put({
            sessionId: id,
            downloadId: 101,
            state: "complete",
            filename: `/tmp/${id}.zip`,
            updatedAtEpochMs: now,
          });
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    });

    // 第 1 次从 stop-export 打开：URL 应剥离参数、ExportArtifact 回填、横幅隐藏
    await page.goto(
      `chrome-extension://${extensionId}/preview.html?sessionId=guide-s1&fromStopExport=1&exportMode=ai`
    );
    await expect
      .poll(() => page.url(), { timeout: 5_000 })
      .not.toContain("fromStopExport=1");
    await page.locator("#toggle-ai-drawer").click();
    await expect(page.locator("#copy-ai-path")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("#ai-path")).toContainText("/tmp/guide-s1.zip");
    await expect(page.locator("#quick-export-upgrade-banner")).toBeHidden();

    // 刷新同页面：幂等不计数
    await page.reload();
    await expect(page.locator("#quick-export-upgrade-banner")).toBeHidden();

    // 第 2 次打开：仍未达到 3 次，横幅保持隐藏
    await page.goto(
      `chrome-extension://${extensionId}/preview.html?sessionId=guide-s2&fromStopExport=1&exportMode=ai`
    );
    await expect
      .poll(() => page.url(), { timeout: 5_000 })
      .not.toContain("fromStopExport=1");
    await expect(page.locator("#quick-export-upgrade-banner")).toBeHidden();

    // 第 3 次打开：连续 2 次零编辑 -> 触发 strong 信号推荐横幅
    await page.goto(
      `chrome-extension://${extensionId}/preview.html?sessionId=guide-s3&fromStopExport=1&exportMode=ai`
    );
    await expect
      .poll(() => page.url(), { timeout: 5_000 })
      .not.toContain("fromStopExport=1");
    const banner = page.locator("#quick-export-upgrade-banner");
    await expect(banner).toBeVisible({ timeout: 5_000 });

    // 点击「开启直接导出」：隐藏横幅并持久化 stopAction = silentExport
    await page.locator("#quick-export-enable-btn").click();
    await expect(banner).toBeHidden();
    await expect
      .poll(
        async () =>
          mediaProbe.evaluateWorker(async () => {
            const stored = await chrome.storage.local.get("app-settings");
            return (
              stored?.["app-settings"] as {
                workflow?: { stopAction?: string };
              }
            )?.workflow?.stopAction;
          }, undefined),
        { timeout: 5_000 }
      )
      .toBe("silentExport");

    // 校验 Options 页回显已同步切换为「直接导出 ZIP（不打开预览）」
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForSelector(".segmented-control");
    const stopActionBtns = page
      .locator(".segmented-control")
      .nth(1)
      .locator(".segmented-btn");
    await expect(stopActionBtns.nth(1)).toHaveClass(/active/);
  });
});
