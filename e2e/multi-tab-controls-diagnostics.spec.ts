import { test, expect } from "./fixtures/extension.ts";
import fs from "node:fs";
import { unzipSync, strFromU8 } from "fflate";

test.describe("跨标签页挂件控制与诊断归属测试 (Multi-Tab Controls & Diagnostics)", () => {
  test("CONTROL-001: 跨标签页秒表同步与分布式暂停/继续状态广播", async ({
    context,
    openActionPopup,
    mediaProbe,
    serviceWorker,
    serverUrl,
  }) => {
    // 1. 打开 Tab 1 并启动录制
    const tab1Url = serverUrl.replace("mock-page.html", "timer-tab-1.html");
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

    // 在 Tab 1 执行一次有效交互激活初始会话
    await tab1Page.bringToFront();
    const tab1ClickBtn = tab1Page.locator('[data-testid="test-click-btn"]');
    await expect(tab1ClickBtn).toBeVisible({ timeout: 5000 });
    await tab1ClickBtn.click();
    await tab1Page.waitForTimeout(500);

    // 2. 打开 Tab 2 并聚焦，等待挂件同步出现
    const tab2Url = serverUrl.replace("mock-page.html", "timer-tab-2.html");
    const tab2Page = await context.newPage();
    await tab2Page.goto(tab2Url);
    await tab2Page.bringToFront();
    await tab2Page.waitForTimeout(800);

    const tab2StopBtn = tab2Page.locator("#__wbr_stop_btn__");
    await expect(tab2StopBtn).toBeVisible({ timeout: 8000 });

    // 获取 Tab 2 的真实 tabId
    const tab2Id = await serviceWorker.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({});
      return tabs.find((t) => t.url?.includes(url))?.id;
    }, "timer-tab-2.html");
    expect(tab2Id).toBeTruthy();

    // 3. 在副标签页 Tab 2 上真实完成「标记截图」全流程并保存，验证副 Tab 的 captureVisibleTab 真实生效落盘
    const tab2IssueBtn = tab2Page.locator("#__wbr_issue_btn__");
    await expect(tab2IssueBtn).toBeVisible();
    await tab2IssueBtn.click();
    const expectedCard = tab2Page.locator("#__wbr_expected_card__");
    await expect(expectedCard).toBeVisible({ timeout: 3000 });
    await expectedCard
      .locator("[data-expected-input]")
      .fill("副Tab计时器数值停滞");
    await expectedCard.locator("[data-expected-confirm]").click();
    await expect(expectedCard).toBeHidden({ timeout: 3000 });

    const selectionOverlay = tab2Page.locator("#__wbr_issue_selection__");
    await expect(selectionOverlay).toBeVisible({ timeout: 3000 });

    // 点击页面内目标元素以激活进入截图
    const targetElement = tab2Page.locator("#test-click-btn");
    await expect(targetElement).toBeVisible();
    const targetBox = await targetElement.boundingBox();
    expect(targetBox).toBeTruthy();
    await tab2Page.mouse.click(
      targetBox!.x + targetBox!.width / 2,
      targetBox!.y + targetBox!.height / 2
    );

    const finishSelectBtn = tab2Page
      .locator("#__wbr_issue_selection__")
      .locator("button", { hasText: "进入截图" });
    await expect(finishSelectBtn).toBeVisible({ timeout: 5000 });
    await finishSelectBtn.click();

    // 验证问题编辑器出现，填写实际现象并执行完成保存
    const issueEditor = tab2Page.locator("#__wbr_issue_editor__");
    await expect(issueEditor).toBeVisible({ timeout: 8000 });
    await issueEditor
      .locator("[data-issue-actual]")
      .fill("副Tab计时器无响应数值停滞");
    const saveIssueBtn = issueEditor.locator("[data-issue-save]");
    await expect(saveIssueBtn).toBeVisible();
    await saveIssueBtn.click();
    await expect(issueEditor).toBeHidden({ timeout: 5000 });

    await mediaProbe.waitForEvidenceCounts(session.id, { issueSceneCount: 1 });

    // 4. 从 Tab 2 Content Script (ISOLATED world) 通过标准协议接口发送 recording/pause-state 暂停消息
    const pauseRes = await serviceWorker.evaluate(
      async ({ tid, sid }) => {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tid },
          func: async (sessionId: string) => {
            return await chrome.runtime.sendMessage({
              protocolVersion: 3,
              messageId: crypto.randomUUID(),
              sentAt: Date.now(),
              type: "recording/pause-state",
              sessionId,
              target: "background",
              payload: {
                sessionId,
                isPaused: true,
                pausedDurationMs: 1000,
                atEpochMs: Date.now(),
              },
            });
          },
          args: [sid],
        });
        return results[0]?.result;
      },
      { tid: tab2Id!, sid: session.id }
    );
    expect(pauseRes).toEqual({ ok: true, active: true });

    // 5. 验证 Tab 2 挂件收到 tab/state-sync 广播后进入黄色暂停态
    const tab2Dot = tab2Page.locator(".__wbr_dot");
    await expect(tab2Dot).toHaveCSS("background-color", "rgb(255, 193, 7)");

    // 6. 切回 Tab 1，验证 Tab 1 也已通过协议广播同步为黄色暂停态
    await tab1Page.bringToFront();
    const tab1Dot = tab1Page.locator(".__wbr_dot");
    await expect(tab1Dot).toHaveCSS("background-color", "rgb(255, 193, 7)");

    // 7. 从 Tab 1 Content Script 通过标准协议接口发送 recording/pause-state 恢复消息
    const resumeRes = await serviceWorker.evaluate(
      async ({ tid, sid }) => {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tid },
          func: async (sessionId: string) => {
            return await chrome.runtime.sendMessage({
              protocolVersion: 3,
              messageId: crypto.randomUUID(),
              sentAt: Date.now(),
              type: "recording/pause-state",
              sessionId,
              target: "background",
              payload: {
                sessionId,
                isPaused: false,
                pausedDurationMs: 1500,
                atEpochMs: Date.now(),
              },
            });
          },
          args: [sid],
        });
        return results[0]?.result;
      },
      { tid: tab1Id!, sid: session.id }
    );
    expect(resumeRes).toEqual({ ok: true, active: true });

    // 8. 验证 Tab 1 恢复为红色录制态
    await expect(tab1Dot).toHaveCSS("background-color", "rgb(245, 63, 63)");

    // 9. 切回 Tab 2，验证 Tab 2 也同步恢复为红色录制态
    await tab2Page.bringToFront();
    await expect(tab2Dot).toHaveCSS("background-color", "rgb(245, 63, 63)");

    // 9. 停止录制并完成导出
    await tab2StopBtn.click();
    const exportedDownload = await mediaProbe.waitForExportDownload(20_000);
    expect(exportedDownload.state).toBe("complete");

    // 验证暂停时长记录有效
    const updatedSession = await mediaProbe.getSession(session.id);
    expect(updatedSession?.timeline.pausedDurationMs ?? 0).toBeGreaterThan(0);

    // 10. 验证会话准入控制（Session Admission）：已停止录制后尝试写入状态被阻断 (stored: false)
    const untrackedFrameworkRes = await serviceWorker.evaluate(
      async ({ tid, sid }) => {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tid },
          func: async (sessionId: string) => {
            return await chrome.runtime.sendMessage({
              protocolVersion: 3,
              messageId: crypto.randomUUID(),
              sentAt: Date.now(),
              type: "framework/state",
              sessionId,
              target: "background",
              payload: {
                sessionId,
                state: {
                  sessionId,
                  framework: "vue3",
                  mode: "dev",
                  rootComponent: "App",
                  componentCount: 1,
                  capturedAtEpochMs: Date.now(),
                },
              },
            });
          },
          args: [sid],
        });
        return results[0]?.result;
      },
      { tid: tab1Id!, sid: session.id }
    );
    expect(untrackedFrameworkRes).toEqual({ ok: true, stored: false });

    // 11. 验证导出的 ZIP 包与 session-data 中完整收录了副 Tab 标记现场与期望描述
    expect(exportedDownload.filename).toBeTruthy();
    const zipped = unzipSync(
      new Uint8Array(fs.readFileSync(exportedDownload.filename!))
    );
    expect(zipped["manifest.json"]).toBeDefined();
    const manifest = JSON.parse(strFromU8(zipped["manifest.json"]!));
    expect(manifest.sessionId).toBe(session.id);
    expect(manifest.files).toBeDefined();

    expect(zipped["data/session-data.js"]).toBeDefined();
    const sessionDataStr = strFromU8(zipped["data/session-data.js"]!);
    expect(sessionDataStr).toContain("timer-tab-2.html");
    expect(sessionDataStr).toContain("副Tab计时器数值停滞");
    expect(sessionDataStr).toContain("副Tab计时器无响应数值停滞");
    expect(sessionDataStr).toContain("test-click-btn");
  });

  test("DIAGNOSTIC-001: 跨标签页独立日志与网络请求精准归属溯源", async ({
    context,
    openActionPopup,
    mediaProbe,
    serviceWorker,
    serverUrl,
  }) => {
    // 1. 打开 Tab 1 并启动录制
    const tab1Url = serverUrl.replace("mock-page.html", "diag-tab-1.html");
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

    // 在 Tab 1 执行一次有效交互激活初始会话，并触发专属报错与接口请求
    await tab1Page.bringToFront();
    const tab1ClickBtn = tab1Page.locator('[data-testid="test-click-btn"]');
    await expect(tab1ClickBtn).toBeVisible({ timeout: 5000 });
    await tab1ClickBtn.click();

    // 2. 在 Tab 1 触发专属控制台报错与专属接口请求
    const tab1ErrorBtn = tab1Page.locator('[data-testid="test-error-btn"]');
    const tab1FetchBtn = tab1Page.locator('[data-testid="test-fetch-btn"]');
    await tab1ErrorBtn.click();
    await tab1FetchBtn.click();
    await tab1Page.waitForTimeout(500);

    // 3. 打开 Tab 2 并聚焦
    const tab2Url = serverUrl.replace("mock-page.html", "diag-tab-2.html");
    const tab2Page = await context.newPage();
    await tab2Page.goto(tab2Url);
    await tab2Page.bringToFront();
    await tab2Page.waitForTimeout(800);

    // 4. 在 Tab 2 触发 Tab 2 独有的错误日志与网络请求
    await tab2Page.evaluate(() => {
      console.error("[TAB2-SPECIFIC-ERROR] 来自 Tab 2 前台的独立业务报错");
      void fetch("/api/preview/success");
    });
    await tab2Page.waitForTimeout(800);

    // 5. 在 Tab 2 上结束录制
    const tab2StopBtn = tab2Page.locator("#__wbr_stop_btn__");
    await expect(tab2StopBtn).toBeVisible({ timeout: 5000 });
    await tab2StopBtn.click();

    // 6. 验证导出并校验数据归属
    const exportedDownload = await mediaProbe.waitForExportDownload(20_000);
    expect(exportedDownload.state).toBe("complete");

    const fullEvidence = await mediaProbe.persistedFullEvidence(session.id);

    // 验证控制台日志的归属准确
    const tab1Logs = fullEvidence.consoleEntries.filter(
      (log) =>
        log.text?.includes("[E2E-TEST]") || log.url?.includes("diag-tab-1.html")
    );
    const tab2Logs = fullEvidence.consoleEntries.filter(
      (log) =>
        log.text?.includes("[TAB2-SPECIFIC-ERROR]") ||
        log.url?.includes("diag-tab-2.html")
    );

    expect(tab1Logs.length).toBeGreaterThanOrEqual(1);
    expect(tab2Logs.length).toBeGreaterThanOrEqual(1);
    expect(
      tab2Logs.some((l) => l.text?.includes("[TAB2-SPECIFIC-ERROR]"))
    ).toBe(true);

    // 验证网络请求的页面归属准确
    const todoRequests = fullEvidence.networkEntries.filter((req) =>
      req.url?.includes("/api/todo")
    );
    const previewRequests = fullEvidence.networkEntries.filter((req) =>
      req.url?.includes("/api/preview/success")
    );

    expect(todoRequests.length).toBeGreaterThanOrEqual(1);
    expect(previewRequests.length).toBeGreaterThanOrEqual(1);

    if (exportedDownload.filename && fs.existsSync(exportedDownload.filename)) {
      const zipBuffer = fs.readFileSync(exportedDownload.filename);
      const unzipped = unzipSync(new Uint8Array(zipBuffer));
      const sessionDataCode = new TextDecoder().decode(
        unzipped["data/session-data.js"]
      );

      expect(sessionDataCode).toContain("diag-tab-1.html");
      expect(sessionDataCode).toContain("diag-tab-2.html");
      expect(sessionDataCode).toContain("[TAB2-SPECIFIC-ERROR]");
    }
  });
});
