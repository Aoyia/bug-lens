import { test, expect } from "./fixtures/extension.ts";
import type { InteractionRecord } from "../src/shared/protocol.ts";

function logE2e(message: string, details?: unknown): void {
  const suffix = details === undefined ? "" : ` ${JSON.stringify(details)}`;
  console.log(`[Bug Lens E2E][${new Date().toISOString()}] ${message}${suffix}`);
}

test.describe("Input merge — 连续输入合并为单条交互", () => {
  test("INPUT-MERGE-001: 快速连续键盘输入合并为 1 条 input 交互", async ({
    context,
    extensionId,
    openActionPopup,
    mediaProbe,
    serverUrl
  }) => {
    let targetPage = context.pages()[0];
    if (!targetPage) targetPage = await context.newPage();
    await targetPage.goto(serverUrl);
    logE2e("Target page loaded", { url: targetPage.url() });

    // 开始录制
    const startPopup = await openActionPopup(targetPage);
    await startPopup.waitForSelector('[data-testid="record-panel"]');
    const targetTabId = await startPopup.evaluate<number | undefined>(
      "(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id)()"
    );
    expect(targetTabId).toBeTruthy();
    await startPopup.click('[data-testid="start-recording-btn"]');
    logE2e("Recording started");
    await startPopup.dispose();

    const session = await mediaProbe.waitForSession(targetTabId!);
    await mediaProbe.waitForActive(session.id, targetTabId!);
    logE2e("Recording active", { sessionId: session.id });

    await targetPage.bringToFront();
    await targetPage.waitForFunction(() => document.hasFocus(), undefined, { timeout: 2_000 });

    // 快速输入一段文字（Playwright type 会逐字符触发 keydown/input 事件）
    const textInput = targetPage.locator('[data-testid="test-text-input"]');
    await textInput.click();
    await targetPage.waitForTimeout(300);
    await textInput.pressSequentially("hello world", { delay: 30 });
    logE2e("Typed 'hello world' into text input");

    // 等待 idle 超时（1500ms）+ 余量
    await targetPage.waitForTimeout(2500);

    // 停止录制
    const stopButton = targetPage.locator("#__wbr_stop_btn__");
    await expect(stopButton).toBeVisible();
    const previewPagePromise = context.waitForEvent("page", {
      predicate: (page) => page.url().startsWith(`chrome-extension://${extensionId}/preview.html`),
      timeout: 10_000
    });
    await stopButton.click();
    const previewPage = await previewPagePromise;
    await previewPage.waitForLoadState("domcontentloaded");
    logE2e("Preview page opened");

    // 读取完整证据
    const evidence = await mediaProbe.persistedFullEvidence(session.id);
    const inputInteractions = evidence.interactions.filter(
      (i: InteractionRecord) => i.kind === "input" && (i.element as { id?: string }).id === "test-text-input"
    );
    logE2e("Input interactions for text input", {
      count: inputInteractions.length,
      details: inputInteractions.map((i: InteractionRecord) => ({
        id: i.id,
        valueLength: i.metadata?.valueLength,
        inputEventCount: i.metadata?.inputEventCount
      }))
    });

    // 核心断言：连续输入应合并为 1 条 input 交互
    expect(inputInteractions.length).toBe(1);

    // 合并后的记录应包含最终值长度
    const merged = inputInteractions[0];
    expect(merged.metadata?.valueLength).toBe(11); // "hello world".length

    // inputEventCount 应大于 1（因为 11 个字符 = 11 个 input 事件被合并）
    expect(merged.metadata?.inputEventCount).toBeGreaterThan(1);
    logE2e("INPUT-MERGE-001 passed");
  });

  test("INPUT-MERGE-002: 输入后按 Enter 产生 [input, keydown] 两条交互", async ({
    context,
    extensionId,
    openActionPopup,
    mediaProbe,
    serverUrl
  }) => {
    let targetPage = context.pages()[0];
    if (!targetPage) targetPage = await context.newPage();
    await targetPage.goto(serverUrl);

    const startPopup = await openActionPopup(targetPage);
    await startPopup.waitForSelector('[data-testid="record-panel"]');
    const targetTabId = await startPopup.evaluate<number | undefined>(
      "(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id)()"
    );
    expect(targetTabId).toBeTruthy();
    await startPopup.click('[data-testid="start-recording-btn"]');
    await startPopup.dispose();

    const session = await mediaProbe.waitForSession(targetTabId!);
    await mediaProbe.waitForActive(session.id, targetTabId!);

    await targetPage.bringToFront();
    await targetPage.waitForFunction(() => document.hasFocus(), undefined, { timeout: 2_000 });

    // 输入文字 + 按 Enter
    const textInput = targetPage.locator('[data-testid="test-text-input"]');
    await textInput.click();
    await targetPage.waitForTimeout(300);
    await textInput.pressSequentially("test", { delay: 30 });
    await targetPage.waitForTimeout(100);
    await textInput.press("Enter");
    logE2e("Typed 'test' + Enter");

    await targetPage.waitForTimeout(2500);

    // 停止录制
    const stopButton = targetPage.locator("#__wbr_stop_btn__");
    await expect(stopButton).toBeVisible();
    const previewPagePromise = context.waitForEvent("page", {
      predicate: (page) => page.url().startsWith(`chrome-extension://${extensionId}/preview.html`),
      timeout: 10_000
    });
    await stopButton.click();
    const previewPage = await previewPagePromise;
    await previewPage.waitForLoadState("domcontentloaded");

    const evidence = await mediaProbe.persistedFullEvidence(session.id);

    // 找到目标元素上的所有交互，按时间排序
    const targetInteractions = evidence.interactions.filter(
      (i: InteractionRecord) =>
        (i.kind === "input" || i.kind === "keydown") &&
        (i.element as { id?: string }).id === "test-text-input"
    ).sort((a: InteractionRecord, b: InteractionRecord) => a.createdAt - b.createdAt);
    logE2e("Target interactions", {
      count: targetInteractions.length,
      kinds: targetInteractions.map((i: InteractionRecord) => i.kind)
    });

    // 核心断言：应该恰好有 2 条交互——先 input 后 keydown
    const kinds = targetInteractions.map((i: InteractionRecord) => i.kind);
    expect(kinds).toContain("input");
    expect(kinds).toContain("keydown");

    // input 应在 keydown 之前
    const inputIndex = kinds.indexOf("input");
    const keydownIndex = kinds.indexOf("keydown");
    expect(inputIndex).toBeLessThan(keydownIndex);

    // input 数量应为 1（合并）
    const inputCount = kinds.filter((k) => k === "input").length;
    expect(inputCount).toBe(1);

    // Enter keydown 的 metadata.key 应为 "Enter"
    const enterInteraction = targetInteractions.find((i: InteractionRecord) => i.kind === "keydown");
    expect(enterInteraction?.metadata?.key).toBe("Enter");

    logE2e("INPUT-MERGE-002 passed");
  });

  test("INPUT-MERGE-003: 长按按键产生 repeat 序列时，应合并为 1 条包含 repeatCount 的 keydown 交互", async ({
    context,
    extensionId,
    openActionPopup,
    mediaProbe,
    serverUrl
  }) => {
    let targetPage = context.pages()[0];
    if (!targetPage) targetPage = await context.newPage();
    await targetPage.goto(serverUrl);

    const startPopup = await openActionPopup(targetPage);
    await startPopup.waitForSelector('[data-testid="record-panel"]');
    const targetTabId = await startPopup.evaluate<number | undefined>(
      "(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id)()"
    );
    expect(targetTabId).toBeTruthy();
    await startPopup.click('[data-testid="start-recording-btn"]');
    await startPopup.dispose();

    const session = await mediaProbe.waitForSession(targetTabId!);
    await mediaProbe.waitForActive(session.id, targetTabId!);

    await targetPage.bringToFront();
    await targetPage.waitForFunction(() => document.hasFocus(), undefined, { timeout: 2_000 });

    // 聚焦输入框并模拟长按 (repeat=true) 的键盘事件序列
    const textInput = targetPage.locator('[data-testid="test-text-input"]');
    await textInput.click();
    await targetPage.waitForTimeout(300);

    // 使用 CDP 发送真实的按键事件 (isTrusted: true) 模拟长按
    const client = await targetPage.context().newCDPSession(targetPage);
    // non-repeat
    await client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowDown", code: "ArrowDown", autoRepeat: false });
    // 5 次 repeat
    for (let i = 0; i < 5; i++) {
      await targetPage.waitForTimeout(50);
      await client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowDown", code: "ArrowDown", autoRepeat: true });
    }
    // keyup
    await client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowDown", code: "ArrowDown" });
    await client.detach();
    logE2e("Dispatched repeat keydown sequence for ArrowDown via CDP");

    // 等待 merge 逻辑的超时 (500ms) + 额外余量
    await targetPage.waitForTimeout(1500);

    // 停止录制
    const stopButton = targetPage.locator("#__wbr_stop_btn__");
    await expect(stopButton).toBeVisible();
    const previewPagePromise = context.waitForEvent("page", {
      predicate: (page) => page.url().startsWith(`chrome-extension://${extensionId}/preview.html`),
      timeout: 10_000
    });
    await stopButton.click();
    const previewPage = await previewPagePromise;
    await previewPage.waitForLoadState("domcontentloaded");

    const evidence = await mediaProbe.persistedFullEvidence(session.id);

    // 找到此元素的 ArrowDown keydown 交互
    const keydownInteractions = evidence.interactions.filter(
      (i: InteractionRecord) =>
        i.kind === "keydown" &&
        i.metadata?.key === "ArrowDown" &&
        (i.element as { id?: string }).id === "test-text-input"
    ).sort((a: InteractionRecord, b: InteractionRecord) => a.createdAt - b.createdAt);
    
    logE2e("ArrowDown interactions", {
      count: keydownInteractions.length,
      details: keydownInteractions.map((i: InteractionRecord) => ({
        id: i.id,
        repeatCount: i.metadata?.repeatCount
      }))
    });

    // 核心断言：1 次 non-repeat 立即发送，5 次 repeat 合并为 1 条，总共 2 条
    expect(keydownInteractions.length).toBe(2);

    // 第一条是 non-repeat
    expect(keydownInteractions[0].metadata?.repeat).toBe(false);

    // 第二条是合并的 repeat
    const merged = keydownInteractions[1];
    expect(merged.metadata?.repeat).toBe(true);
    expect(merged.metadata?.repeatCount).toBe(5);

    logE2e("INPUT-MERGE-003 passed");
  });
});
