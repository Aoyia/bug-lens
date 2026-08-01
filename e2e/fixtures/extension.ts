import { test as base, chromium, type BrowserContext, type CDPSession, type Page, type Worker } from "@playwright/test";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import http from "node:http";
import { browserAppNameFromExecutable, createNativeShortcutDriver, parseChromeShortcut, type ActionShortcut, type NativeShortcutDriver } from "./native-shortcut.ts";
import { MediaProbe } from "./media-probe.ts";
import { attachToPopupTarget, type CdpPopup } from "./cdp-popup.ts";

const pathToExtension = fs.realpathSync(path.resolve(process.cwd(), "dist"));

function envMilliseconds(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

const slowMoMs = envMilliseconds("E2E_SLOW_MO_MS", process.env.CI ? 0 : 250);

function logE2e(message: string, details?: unknown): void {
  const suffix = details === undefined ? "" : ` ${JSON.stringify(details)}`;
  console.log(`[Bug Lens E2E][${new Date().toISOString()}] ${message}${suffix}`);
}

type ActiveTab = { id?: number; url?: string; title?: string };

export type ExtensionFixtures = {
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
  actionShortcut: ActionShortcut;
  nativeShortcutDriver: NativeShortcutDriver;
  openActionPopup: (targetPage: Page) => Promise<CdpPopup>;
  mediaProbe: MediaProbe;
  serverUrl: string;
};

async function activeTab(serviceWorker: Worker): Promise<ActiveTab | undefined> {
  return serviceWorker.evaluate(async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    return tab ? { id: tab.id, url: tab.url, title: tab.title } : undefined;
  });
}

export const test = base.extend<ExtensionFixtures>({
  serverUrl: async ({}, use) => {
    const mockHtmlPath = path.resolve(process.cwd(), "e2e/fixtures/mock-page.html");
    const server = http.createServer((req, res) => {
      if (req.url === "/api/todo") {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ id: 1, title: "Bug Lens E2E", completed: false }));
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(fs.readFileSync(mockHtmlPath));
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };
    logE2e("Mock server started", { port: address.port });
    await use(`http://127.0.0.1:${address.port}/mock-page.html`);
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  },

  context: async ({}, use) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "playwright-chrome-user-data-"));
    logE2e("Launching Chrome for Testing", { slowMoMs, profile: tmpDir });
    const context = await chromium.launchPersistentContext(tmpDir, {
      headless: false,
      slowMo: slowMoMs,
      viewport: null,
      args: [
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`,
        "--allow-file-access-from-files",
        "--no-first-run",
        "--no-default-browser-check",
        "--window-size=1280,900"
      ]
    });

    logE2e("Chrome launched", { pages: context.pages().length });

    await use(context);
    logE2e("Closing Chrome test context");
    await context.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  },

  serviceWorker: async ({ context }, use) => {
    const existing = context.serviceWorkers().find((worker) => worker.url().startsWith("chrome-extension://"));
    const serviceWorker = existing ?? await context.waitForEvent("serviceworker", {
      predicate: (worker) => worker.url().startsWith("chrome-extension://"),
      timeout: 10_000
    });
    logE2e("Extension Service Worker ready", { url: serviceWorker.url() });
    await use(serviceWorker);
  },

  extensionId: async ({ serviceWorker }, use) => {
    const extensionId = new URL(serviceWorker.url()).host;
    if (!extensionId) throw new Error("EXTENSION_ID_MISSING: 无法从 Service Worker URL 提取扩展 ID");
    await use(extensionId);
  },

  actionShortcut: async ({ serviceWorker }, use) => {
    const commands = await serviceWorker.evaluate(async () => chrome.commands.getAll());
    const command = commands.find((entry) => entry.name === "_execute_action");
    if (!command) throw new Error("ACTION_COMMAND_MISSING: 构建产物未声明 _execute_action");
    if (!command.shortcut) throw new Error("ACTION_SHORTCUT_UNBOUND: Chrome 未绑定 _execute_action 快捷键");
    logE2e("Resolved extension action shortcut", { shortcut: command.shortcut });
    await use(parseChromeShortcut(command.shortcut));
  },

  nativeShortcutDriver: async ({ actionShortcut }, use) => {
    void actionShortcut;
    const browserAppName = browserAppNameFromExecutable(chromium.executablePath());
    const driver = createNativeShortcutDriver(browserAppName);
    await driver.preflight();
    logE2e("Native shortcut driver ready", { browserAppName });
    await use(driver);
  },

  openActionPopup: async ({ context, serviceWorker, extensionId, actionShortcut, nativeShortcutDriver }, use) => {
    const popupUrl = `chrome-extension://${extensionId}/popup.html`;
    const browser = context.browser();
    if (!browser) throw new Error("BROWSER_CDP_UNAVAILABLE: 未找到 Playwright Browser");
    const browserCdp = await browser.newBrowserCDPSession();
    const open = async (targetPage: Page): Promise<CdpPopup> => {
      if (targetPage.isClosed()) throw new Error("TARGET_TAB_MISSING: 目标页面已经关闭");
      await targetPage.bringToFront();
      await targetPage.waitForFunction(() => document.hasFocus(), undefined, { timeout: 2_000 });

      const target = await activeTab(serviceWorker);
      const targetUrl = new URL(targetPage.url());
      if (!target?.id || !target.url) throw new Error("TARGET_TAB_MISSING: Chrome 没有活动标签页");
      const chromeUrl = new URL(target.url);
      if (chromeUrl.origin !== targetUrl.origin || chromeUrl.pathname !== targetUrl.pathname) {
        throw new Error(`TARGET_TAB_MISMATCH: Playwright=${targetPage.url()} Chrome=${target.url}`);
      }

      const existing = context.pages().find((page) => !page.isClosed() && page.url() === popupUrl);
      if (existing) throw new Error("ACTION_POPUP_TARGET_INVALID: 快捷键发送前已有未关闭的 Popup");

      try {
        logE2e("Sending native extension shortcut", { shortcut: actionShortcut.raw, targetTabId: target.id, targetUrl: target.url });
        await nativeShortcutDriver.press(actionShortcut);
      } catch (error) {
        throw error;
      }
      const popup = await attachToPopupTarget(browserCdp, popupUrl);
      logE2e("Attached to real Action Popup", { url: popup.url });
      return popup;
    };
    try {
      await use(open);
    } finally {
      await browserCdp.detach().catch(() => undefined);
    }
  },

  mediaProbe: async ({ context, serviceWorker }, use) => {
    await use(new MediaProbe(context, serviceWorker));
  }
});

export { expect } from "@playwright/test";
