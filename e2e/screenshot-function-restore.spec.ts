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

const refreshShortcut =
  process.platform === "darwin" ? "Meta+r" : "Control+r";

/**
 * 注入按键探针（bubble 阶段）。overlay 的拦截器注册在 window capture 阶段，
 * 若被吞掉（preventDefault + stopPropagation）则 bubble 阶段收不到事件；
 * 若放行则事件到达页面、且 defaultPrevented === false。
 * 返回探针快照读取函数。
 */
async function installKeyProbe(
  page: import("@playwright/test").Page
): Promise<() => Promise<{ total: number; refreshSeen: number; refreshDefaultPrevented: boolean | null }>> {
  await page.evaluate(() => {
    const w = window as any;
    w.__keyProbe = { total: 0, refreshSeen: 0, refreshDefaultPrevented: null };
    w.addEventListener(
      "keydown",
      (e: KeyboardEvent) => {
        w.__keyProbe.total += 1;
        if (e.key === "r" && (e.metaKey || e.ctrlKey)) {
          w.__keyProbe.refreshSeen += 1;
          w.__keyProbe.refreshDefaultPrevented = e.defaultPrevented;
        }
      },
      false
    );
  });
  return () =>
    page.evaluate(() => ({
      total: (window as any).__keyProbe.total as number,
      refreshSeen: (window as any).__keyProbe.refreshSeen as number,
      refreshDefaultPrevented:
        (window as any).__keyProbe.refreshDefaultPrevented as boolean | null,
    }));
}

/** 注入长滚动内容 + 网页事件泄漏监听（bubble 阶段） */
async function installScrollSpacerAndLeakProbe(
  page: import("@playwright/test").Page
): Promise<void> {
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
}

test.describe("Bug Lens Chrome Extension E2E SCREENSHOT-006: 截图后网页功能恢复", () => {
  test("SCREENSHOT-006-1: 截图激活期 Cmd/Ctrl+R 刷新快捷键放行（未被拦截）", async ({
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
    const readProbe = await installKeyProbe(page);

    // 基线：未激活截图时，刷新快捷键到达页面且未被 preventDefault
    await page.keyboard.press(refreshShortcut);
    await delay(150);
    let probe = await readProbe();
    expect(probe.refreshSeen, "基线：刷新快捷键应到达页面").toBe(1);
    expect(probe.refreshDefaultPrevented).toBe(false);

    // 截图激活期：刷新快捷键必须放行（P1）。
    // 若 handleKeyDown 兜底分支仍吞掉，事件不会到达 bubble 阶段。
    const host = await triggerAndOpenScreenshot(context, serviceWorker, page);
    await page.keyboard.press(refreshShortcut);
    await delay(150);
    probe = await readProbe();
    expect(
      probe.refreshSeen,
      "截图激活期刷新快捷键应到达页面（放行，未被吞掉）"
    ).toBe(2);
    expect(
      probe.refreshDefaultPrevented,
      "截图激活期刷新快捷键不应被 preventDefault"
    ).toBe(false);
    logE2e("Refresh shortcut passed through while screenshot active", {
      probe,
    });

    // 对比：普通按键在截图激活期被吞（bubble 阶段收不到）。
    // 注意 Meta+r 会产生 2 个 keydown（Meta 与 r），故对比 a 前后的 total。
    const beforePlainKey = (await readProbe()).total;
    await page.keyboard.press("a");
    await delay(150);
    probe = await readProbe();
    expect(
      probe.total,
      "普通按键应被截图拦截吞掉，不泄漏到页面"
    ).toBe(beforePlainKey);
    logE2e("Plain key still swallowed while screenshot active", {
      beforePlainKey,
      probe,
    });
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
    await installScrollSpacerAndLeakProbe(page);
    const readProbe = await installKeyProbe(page);

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

      // 截图激活期：普通按键不得泄漏到页面（拦截器仍生效）
      await page.keyboard.press("a");
      await delay(100);
      const duringLeak = await page.evaluate(
        () => (window as any).__bugLensLeakCount
      );
      expect(
        duringLeak,
        `第 ${i} 次截图激活期按键不应泄漏到页面`
      ).toBe(0);

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

    // 3) 刷新恢复：刷新快捷键重新到达页面且未被 preventDefault
    await page.keyboard.press(refreshShortcut);
    await delay(150);
    const probe = await readProbe();
    expect(
      probe.refreshDefaultPrevented,
      "截图后刷新快捷键应到达页面且未被 preventDefault"
    ).toBe(false);
    logE2e("Refresh restored after screenshots", { probe });
  });

  test("SCREENSHOT-006-3: 确认导出（Enter）后再次截图正常、滚动/按键/刷新恢复", async ({
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
    await installScrollSpacerAndLeakProbe(page);
    const readProbe = await installKeyProbe(page);

    // 触发截图 → Enter 非编辑态确认导出（onComplete 路径）
    const host = await triggerAndOpenScreenshot(context, serviceWorker, page);
    await page.keyboard.press("Enter");
    await expect(host).toBeHidden({ timeout: 5_000 });
    logE2e("Confirm via Enter; overlay closed");

    // 导出链路应触发下载（截图确认导出直出证据包）
    await expect
      .poll(() => downloadedUrl.length > 0, { timeout: 8_000 })
      .toBe(true);

    // onComplete 复位后应能再次触发截图且不叠加（若单例未复位/监听器泄漏，
    // 会复用一个已销毁的 overlay 或创建多个 host）
    const host2 = await triggerAndOpenScreenshot(context, serviceWorker, page);
    expect(await host2.count(), "再次截图应只有 1 个 overlay host").toBe(1);
    await page.keyboard.press("Escape");
    await expect(host2).toBeHidden({ timeout: 5_000 });

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
    await page.keyboard.press(refreshShortcut);
    await delay(150);
    const probe = await readProbe();
    expect(
      probe.refreshDefaultPrevented,
      "确认导出后刷新快捷键应到达页面且未被 preventDefault"
    ).toBe(false);
    logE2e("Refresh restored after confirm-export", { probe });
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
