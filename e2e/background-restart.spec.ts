import { type Worker } from "@playwright/test";
import { test, expect } from "./fixtures/extension.ts";

function logE2e(message: string, details?: unknown): void {
  const suffix = details === undefined ? "" : ` ${JSON.stringify(details)}`;
  console.log(
    `[Bug Lens E2E][${new Date().toISOString()}] ${message}${suffix}`
  );
}

test.describe("Bug Lens background Service Worker 重启恢复", () => {
  test("BG-RESTART-001: 录制中 SW 重启后会话不丢、可继续录制并正常停止", async ({
    context,
    openActionPopup,
    waitForPopupClosed,
    activeTabId,
    serverUrl,
  }) => {
    test.setTimeout(180_000);
    context.on("console", (message) => {
      logE2e(`Browser console.${message.type()}`, {
        url: message.page()?.url() ?? "extension-worker-or-popup",
        text: message.text(),
      });
    });

    // 1. 打开测试网页并聚焦
    let targetPage = context.pages()[0];
    if (!targetPage) targetPage = await context.newPage();
    await targetPage.goto(serverUrl);
    await targetPage.bringToFront();
    await targetPage.waitForFunction(() => document.hasFocus(), undefined, {
      timeout: 2_000,
    });
    const targetTabId = await activeTabId();
    expect(targetTabId).toBeTruthy();
    logE2e("Target page ready", { targetTabId });

    // 2. 打开 Popup 启动录制
    const popup = await openActionPopup(targetPage);
    await popup.waitForSelector('[data-testid="record-panel"]');
    await popup.click('[data-testid="start-recording-btn"]');
    await popup.evaluate("window.close()").catch(() => undefined);
    await waitForPopupClosed();

    // 3. 等待录制挂件出现（会话进入 RECORDING）
    await targetPage.waitForSelector('[data-testid="recording-widget"]', {
      timeout: 10_000,
    });
    const statusBefore = await context
      .serviceWorkers()[0]
      .evaluate(async () => {
        const response = await chrome.runtime.sendMessage({
          protocolVersion: 3,
          messageId: "e2e-status-before",
          type: "session/status",
          sentAt: Date.now(),
        });
        return response;
      });
    expect(statusBefore.ok).toBe(true);
    expect(statusBefore.session).toBeTruthy();
    const sessionId = statusBefore.session.id;
    logE2e("Recording session established", { sessionId });

    // 4. 用 CDP ServiceWorker.stopWorker 强制终止 SW，模拟浏览器回收后台 SW
    const browserCdp = await context.browser()!.newBrowserCDPSession();
    await browserCdp.send("ServiceWorker.enable" as never);
    const versions = (await browserCdp.send(
      "ServiceWorker.getWorkerVersions" as never
    )) as {
      versions: Array<{ versionId: string; scriptURL: string }>;
    };
    const target = versions.versions.find((v) =>
      v.scriptURL.includes("background")
    );
    expect(target, "应找到 background SW 版本").toBeTruthy();
    logE2e("Stopping background Service Worker", {
      versionId: target!.versionId,
    });
    await browserCdp.send(
      "ServiceWorker.stopWorker" as never,
      {
        versionId: target!.versionId,
      } as never
    );
    await browserCdp.detach().catch(() => undefined);
    logE2e("Service Worker stop command issued");

    // 5. 等待新的 Service Worker 就绪（bootstrapRuntimeState 自动恢复会话）
    let workerAfter: Worker | undefined;
    await test.step("等待 SW 重启完成", async () => {
      const deadline = Date.now() + 40_000;
      while (Date.now() < deadline) {
        const candidates = context
          .serviceWorkers()
          .filter((w) => w.url().startsWith("chrome-extension://"));
        if (candidates.length > 0) {
          workerAfter = candidates[candidates.length - 1];
          try {
            const ready = await workerAfter.evaluate(async () => {
              const response = await chrome.runtime.sendMessage({
                protocolVersion: 3,
                messageId: "e2e-status-after",
                type: "session/status",
                sentAt: Date.now(),
              });
              return response;
            });
            if (ready?.ok) return;
          } catch {
            // SW 仍在重启中
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      throw new Error("SW 重启后 40s 内未就绪");
    });

    // 6. 断言：同一会话仍存在且处于录制状态
    const statusAfter = await workerAfter!.evaluate(async () => {
      const response = await chrome.runtime.sendMessage({
        protocolVersion: 3,
        messageId: "e2e-status-after2",
        type: "session/status",
        sentAt: Date.now(),
      });
      return response;
    });
    expect(statusAfter.ok).toBe(true);
    expect(statusAfter.session).toBeTruthy();
    expect(statusAfter.session.id).toBe(sessionId);
    logE2e("Session survived SW restart", {
      status: statusAfter.session.status,
    });

    // 7. 页面录制挂件应恢复（content script 重新握手）
    await targetPage.waitForSelector('[data-testid="recording-widget"]', {
      timeout: 10_000,
    });
    logE2e("Recording widget reconnected after restart");

    // 8. 会话可正常停止并产出历史记录
    const stopPopup = await openActionPopup(targetPage);
    await stopPopup.waitForSelector(
      '[data-testid="stop-recording-btn"]',
      10_000
    );
    await stopPopup.click('[data-testid="stop-recording-btn"]');
    await stopPopup.evaluate("window.close()").catch(() => undefined);
    await waitForPopupClosed();

    const list = await workerAfter!.evaluate(async () => {
      const response = await chrome.runtime.sendMessage({
        protocolVersion: 3,
        messageId: "e2e-list",
        type: "session/list",
        sentAt: Date.now(),
      });
      return response;
    });
    expect(list.ok).toBe(true);
    expect(
      list.sessions.some((entry: { session?: { id: string }; id?: string }) => {
        const id = entry.session?.id ?? entry.id;
        return id === sessionId;
      })
    ).toBe(true);
    logE2e("Stopped session listed in history", { sessionId });
  });
});
