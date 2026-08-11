import { expect } from "@playwright/test";
import { test, safeUrlForLog } from "./fixtures/extension.ts";
import { parseChromeShortcut } from "./fixtures/native-shortcut.ts";

function logE2e(message: string, details?: unknown): void {
  const suffix = details === undefined ? "" : ` ${JSON.stringify(details)}`;
  console.log(
    `[Bug Lens E2E][${new Date().toISOString()}] ${message}${suffix}`
  );
}

test.describe("Bug Lens Chrome Extension E2E SHORTCUT-001: Global Shortcut One-Click Recording", () => {
  test("SHORTCUT-001: start-recording command directly starts recording on the active tab with environment info", async ({
    context,
    serviceWorker,
    activeTabId,
    mediaProbe,
    serverUrl,
    nativeShortcutDriver,
  }) => {
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    // 1. manifest 声明了 start-recording 命令且已绑定快捷键
    const commands = await serviceWorker.evaluate(async () =>
      chrome.commands.getAll()
    );
    const startCommand = commands.find(
      (entry) => entry.name === "start-recording"
    );
    expect(
      startCommand,
      "start-recording command must be declared"
    ).toBeTruthy();
    expect(
      startCommand?.shortcut,
      "start-recording shortcut must be bound by Chrome"
    ).toBeTruthy();
    logE2e("Resolved start-recording shortcut", {
      shortcut: startCommand!.shortcut,
    });

    let targetPage = context.pages()[0];
    if (!targetPage) targetPage = await context.newPage();
    await targetPage.goto(serverUrl);
    await targetPage.bringToFront();
    await targetPage.waitForFunction(() => document.hasFocus(), undefined, {
      timeout: 2_000,
    });

    const targetTabId = await activeTabId();
    expect(targetTabId).toBeTruthy();

    const baselineSessionCount = await mediaProbe.sessionCount();
    logE2e("Initial state", { targetTabId, baselineSessionCount });

    // 2. 通过全局快捷键直接启动录制（不打开 Popup、无任何二次确认弹窗）
    const shortcutRaw = startCommand!.shortcut as string;
    await nativeShortcutDriver.press(parseChromeShortcut(shortcutRaw));

    const session = await mediaProbe.waitForSession(targetTabId!, 10_000);
    expect(session.status).toBe("RECORDING");
    // 快捷键录制使用安全默认选项（首次无历史选项时）
    expect(session.options.captureVideo).toBe(true);
    expect(session.options.captureConsole).toBe(true);
    expect(session.options.captureNetwork).toBe(true);
    expect(session.options.privacyMode).toBe("safe");

    // 3. 环境信息自动附带，无需用户手动填写
    expect(session.target.environment).toBeTruthy();
    expect(session.target.environment?.userAgent).toContain("Mozilla");
    expect(session.target.environment?.screenWidth).toBeGreaterThan(0);
    expect(session.target.environment?.viewportWidth).toBeGreaterThan(0);

    const sessionCountAfterStart = await mediaProbe.sessionCount();
    expect(sessionCountAfterStart).toBe(baselineSessionCount + 1);

    logE2e("Shortcut recording started", {
      sessionId: session.id,
      shortcut: startCommand!.shortcut,
      environment: session.target.environment
        ? {
            screen: `${session.target.environment.screenWidth}x${session.target.environment.screenHeight}`,
            browser: session.target.environment.userAgent,
          }
        : undefined,
    });

    // 4. 通过页面内的录制挂件停止录制，验证全链路闭合。
    //    自 0b55d10 起挂件停止改为非静默：停止完成后打开预览页，
    //    active-session 由 openPendingPreview 的 updateSessionAndClearActive 原子清理，
    //    因此状态断言按 sessionId 查询（activeSession() 此时已正确返回 undefined）。
    await targetPage.bringToFront();
    const stopButton = targetPage.locator("#__wbr_stop_btn__");
    await expect(stopButton).toBeVisible({ timeout: 5_000 });
    const previewPagePromise = context.waitForEvent("page", {
      predicate: (page) => page.url().includes("preview.html"),
      timeout: 10_000,
    });
    await stopButton.click();
    const previewPage = await previewPagePromise;
    expect(previewPage.url()).toContain(session.id);
    logE2e("Preview opened after widget stop", {
      previewUrl: previewPage.url(),
    });
    await expect
      .poll(async () => (await mediaProbe.getSession(session.id))?.status, {
        timeout: 10_000,
      })
      .toBe("PREVIEW_READY");
    logE2e("Shortcut recording stopped cleanly", {
      sessionId: session.id,
      stopSource: "recording-widget",
    });
  });
});
