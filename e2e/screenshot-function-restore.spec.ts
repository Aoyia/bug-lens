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

/**
 * 在目标标签页内注入 content.js 并触发截图 overlay（复刻 background
 * triggerScreenshotInTab 的链路）。每次调用都会重新执行 executeScript，
 * 即复现「重复注入」场景——正是截图后残留拦截器 bug 的触发条件。
 */
async function triggerScreenshotOverlay(
  serviceWorker: import("@playwright/test").Worker,
  tabId: number,
  viewportDataUrl: string
): Promise<void> {
  await serviceWorker.evaluate(
    async ({ tabId, viewportDataUrl }) => {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"],
      });
      await chrome.tabs.sendMessage(tabId, {
        type: "TRIGGER_SCREENSHOT_OVERLAY",
        viewportDataUrl,
      });
    },
    { tabId, viewportDataUrl }
  );
}

/** 通过 CDP 截取目标页面视口，返回 PNG data URL */
async function captureViewportDataUrl(
  context: import("@playwright/test").BrowserContext,
  page: import("@playwright/test").Page
): Promise<string> {
  const cdp = await context.newCDPSession(page);
  try {
    const result = (await cdp.send("Page.captureScreenshot", {
      format: "png",
    })) as { data: string };
    return `data:image/png;base64,${result.data}`;
  } finally {
    await cdp.detach().catch(() => undefined);
  }
}

/** 统一准备：加载目标页并确保窗口聚焦 */
async function openPage(
  context: import("@playwright/test").BrowserContext,
  serverUrl: string
): Promise<import("@playwright/test").Page> {
  let page = context.pages()[0];
  if (!page) page = await context.newPage();
  await page.goto(serverUrl);
  await page.bringToFront();
  await page.waitForFunction(() => document.hasFocus(), undefined, {
    timeout: 2_000,
  });
  return page;
}

/** 触发截图 overlay 并等待显示，返回 host locator */
async function triggerAndOpenScreenshot(
  context: import("@playwright/test").BrowserContext,
  serviceWorker: import("@playwright/test").Worker,
  page: import("@playwright/test").Page
): Promise<import("@playwright/test").Locator> {
  const tabId = await serviceWorker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    return tab?.id;
  });
  expect(tabId).toBeTruthy();
  const viewportDataUrl = await captureViewportDataUrl(context, page);
  await triggerScreenshotOverlay(serviceWorker, tabId!, viewportDataUrl);
  const host = page.locator("#bug-lens-screenshot-host");
  await expect(host).toBeVisible({ timeout: 5_000 });
  return host;
}

const refreshShortcut = process.platform === "darwin" ? "Meta+r" : "Control+r";

test.describe("Bug Lens Chrome Extension E2E SCREENSHOT-006: 截图后网页功能恢复", () => {
  test("SCREENSHOT-006-1: 截图激活期 Cmd/Ctrl+R 放行刷新，页面重载并销毁 overlay", async ({
    context,
    serviceWorker,
    serverUrl,
  }) => {
    context.on("console", (message) => {
      logE2e(`Browser console.${message.type()}`, {
        url:
          safeUrlForLog(message.page()?.url()) ?? "extension-worker-or-popup",
        text: message.text().slice(0, 200),
      });
    });

    const page = await openPage(context, serverUrl);
    const host = await triggerAndOpenScreenshot(context, serviceWorker, page);
    logE2e("Screenshot overlay active, pressing refresh shortcut");

    // P1: 刷新快捷键必须放行（不再被 handleKeyDown 兜底分支吞掉）——
    // 页面重载后 DOM 重建，overlay 随之销毁。
    const nav = page.waitForEvent("framenavigated");
    await page.keyboard.press(refreshShortcut);
    await nav;
    await expect(host).toBeHidden({ timeout: 5_000 });
    logE2e("Refresh shortcut reloaded page; overlay destroyed");
  });

  test("SCREENSHOT-006-2: 连续三次截图并退出后，滚动/按键/刷新均恢复正常（无残留拦截器）", async ({
    context,
    serviceWorker,
    serverUrl,
  }) => {
    context.on("console", (message) => {
      logE2e(`Browser console.${message.type()}`, {
        url:
          safeUrlForLog(message.page()?.url()) ?? "extension-worker-or-popup",
        text: message.text().slice(0, 200),
      });
    });

    const page = await openPage(context, serverUrl);

    // 注入长滚动内容 + 网页事件泄漏监听（bubble 阶段）
    await page.evaluate(() => {
      const el = document.createElement("div");
      el.id = "scroll-spacer";
      el.style.height = "4000px";
      document.body.appendChild(el);
      const w = window as any;
      w.__bugLensLeakCount = 0;
      w.__bugLensLeakTypes = [] as string[];
      const bump = (e: Event) => {
        w.__bugLensLeakCount += 1;
        w.__bugLensLeakTypes.push(e.type);
      };
      for (const t of ["keydown", "mousedown", "click", "contextmenu"]) {
        w.addEventListener(t, bump);
      }
    });

    // 连续 3 次「触发截图 → 确认只有一个 overlay → Esc 退出」。
    // 修复前每次注入都会累积一个 onMessage 监听器、且旧 overlay 的
    // window 拦截器在 DOM 被移除后残留；修复后必须全程只有 1 个 host。
    for (let i = 1; i <= 3; i++) {
      const host = await triggerAndOpenScreenshot(context, serviceWorker, page);
      expect(
        await host.count(),
        `第 ${i} 次截图应只存在 1 个 overlay host（幂等，不叠加）`
      ).toBe(1);
      logE2e(`Screenshot #${i} opened`, { hostCount: await host.count() });

      // P0 直接证据：重复注入后 window 幂等标志必须保持置位，
      // 否则说明 listener 又累积了（下次注入会再注册一个）。
      const listenerFlag = await page.evaluate(
        () => (window as any).__WEB_BUG_RECORDER_SCREENSHOT_LISTENER__ === true
      );
      expect(listenerFlag, `第 ${i} 次注入后 window 幂等标志应保持 true`).toBe(
        true
      );

      await page.keyboard.press("Escape");
      await expect(host).toBeHidden({ timeout: 5_000 });
      logE2e(`Screenshot #${i} closed`);
    }

    // 归零泄漏计数，开始验证截图后网页功能恢复
    await page.evaluate(() => {
      (window as any).__bugLensLeakCount = 0;
    });

    // 1) 滚动恢复：wheel 能正常滚动页面（残留 handlePreventScroll 会吞掉 wheel）
    const beforeY = await page.evaluate(() => window.scrollY);
    await page.mouse.wheel(0, 600);
    await delay(300);
    const afterY = await page.evaluate(() => window.scrollY);
    expect(afterY).toBeGreaterThan(beforeY);
    logE2e("Page scroll restored after screenshots", { beforeY, afterY });

    // 2) 按键恢复：keydown 重新到达网页（残留 capture 拦截器会 preventDefault + stopPropagation）
    await page.keyboard.press("a");
    await delay(150);
    const keyLeak = await page.evaluate(
      () => (window as any).__bugLensLeakCount
    );
    expect(keyLeak).toBeGreaterThan(0);
    logE2e("Keydown reaches page again after screenshots", { keyLeak });

    // 3) 刷新恢复：Cmd/Ctrl+R 触发页面重载（残留拦截器会吞掉快捷键）
    const nav = page.waitForEvent("framenavigated");
    await page.keyboard.press(refreshShortcut);
    await nav;
    logE2e("Refresh restored after screenshots");
  });

  test("SCREENSHOT-006-3: 确认导出（onComplete 复位）后网页功能恢复", async ({
    context,
    serviceWorker,
    serverUrl,
  }) => {
    context.on("console", (message) => {
      logE2e(`Browser console.${message.type()}`, {
        url:
          safeUrlForLog(message.page()?.url()) ?? "extension-worker-or-popup",
        text: message.text().slice(0, 200),
      });
    });

    let downloadedUrl = "";
    context.on("download", (download) => {
      downloadedUrl = download.url();
      logE2e("Screenshot export download observed", {
        url: safeUrlForLog(downloadedUrl),
      });
    });

    const page = await openPage(context, serverUrl);

    // 注入长滚动内容 + 网页事件泄漏监听
    await page.evaluate(() => {
      const el = document.createElement("div");
      el.id = "scroll-spacer";
      el.style.height = "4000px";
      document.body.appendChild(el);
      const w = window as any;
      w.__bugLensLeakCount = 0;
      const bump = () => {
        w.__bugLensLeakCount += 1;
      };
      for (const t of ["keydown", "mousedown", "click", "contextmenu"]) {
        w.addEventListener(t, bump);
      }
    });

    // 触发截图 → Enter 非编辑态确认导出（onComplete 路径）
    const host = await triggerAndOpenScreenshot(context, serviceWorker, page);
    await page.keyboard.press("Enter");
    await expect(host).toBeHidden({ timeout: 5_000 });
    logE2e("Confirm via Enter; overlay closed");

    // onComplete 必须复位 window 单例，否则下次截图会复用一个已销毁的 overlay
    const overlayReset = await page.evaluate(
      () => (window as any).__WEB_BUG_RECORDER_SCREENSHOT_OVERLAY__ === null
    );
    expect(
      overlayReset,
      "onComplete 后 window.__WEB_BUG_RECORDER_SCREENSHOT_OVERLAY__ 应复位为 null"
    ).toBe(true);

    // 导出链路应触发下载（截图确认导出直出证据包）
    await expect
      .poll(() => downloadedUrl.length > 0, { timeout: 8_000 })
      .toBe(true);

    // 滚动恢复
    const beforeY = await page.evaluate(() => window.scrollY);
    await page.mouse.wheel(0, 600);
    await delay(300);
    const afterY = await page.evaluate(() => window.scrollY);
    expect(afterY).toBeGreaterThan(beforeY);
    logE2e("Scroll restored after confirm-export", { beforeY, afterY });

    // 按键恢复
    await page.keyboard.press("a");
    await delay(150);
    const keyLeak = await page.evaluate(
      () => (window as any).__bugLensLeakCount
    );
    expect(keyLeak).toBeGreaterThan(0);
    logE2e("Keydown reaches page again after confirm-export", { keyLeak });

    // 刷新恢复
    const nav = page.waitForEvent("framenavigated");
    await page.keyboard.press(refreshShortcut);
    await nav;
    logE2e("Refresh restored after confirm-export");
  });

  test("SCREENSHOT-006-4: 截图激活期间滚动冻结（设计契约），退出后恢复", async ({
    context,
    serviceWorker,
    serverUrl,
  }) => {
    context.on("console", (message) => {
      logE2e(`Browser console.${message.type()}`, {
        url:
          safeUrlForLog(message.page()?.url()) ?? "extension-worker-or-popup",
        text: message.text().slice(0, 200),
      });
    });

    const page = await openPage(context, serverUrl);

    // 注入长滚动内容
    await page.evaluate(() => {
      const el = document.createElement("div");
      el.id = "scroll-spacer";
      el.style.height = "4000px";
      document.body.appendChild(el);
    });

    // 截图激活期间：wheel 应被冻结（视口快照，滚动会导致背景错位）
    const host = await triggerAndOpenScreenshot(context, serviceWorker, page);
    const beforeY = await page.evaluate(() => window.scrollY);
    await page.mouse.wheel(0, 600);
    await delay(300);
    const duringY = await page.evaluate(() => window.scrollY);
    expect(duringY, "截图激活期间滚动必须被冻结").toBe(beforeY);
    logE2e("Scroll frozen while screenshot active", { beforeY, duringY });

    // Esc 退出后：滚动恢复
    await page.keyboard.press("Escape");
    await expect(host).toBeHidden({ timeout: 5_000 });
    await page.mouse.wheel(0, 600);
    await delay(300);
    const afterY = await page.evaluate(() => window.scrollY);
    expect(afterY, "退出截图后滚动应恢复").toBeGreaterThan(beforeY);
    logE2e("Scroll restored after exit", { beforeY, afterY });
  });
});
