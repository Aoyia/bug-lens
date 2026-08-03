import {
  test as base,
  chromium,
  type BrowserContext,
  type CDPSession,
  type Page,
  type Worker,
} from "@playwright/test";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import http from "node:http";
import {
  browserAppNameFromExecutable,
  createNativeShortcutDriver,
  parseChromeShortcut,
  type ActionShortcut,
  type NativeShortcutDriver,
} from "./native-shortcut.ts";
import { MediaProbe } from "./media-probe.ts";
import { attachToPopupTarget, type CdpPopup } from "./cdp-popup.ts";
import {
  createNativeSaveDialogDriver,
  type NativeSaveDialogDriver,
} from "./native-save-dialog.ts";

const pathToExtension = fs.realpathSync(path.resolve(process.cwd(), "dist"));

function envMilliseconds(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

const slowMoMs = envMilliseconds("E2E_SLOW_MO_MS", process.env.CI ? 0 : 250);

export function safeUrlForLog(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return `${parsed.origin}${parsed.pathname}`;
    }
    return url.split("?")[0];
  } catch {
    return url.split("?")[0];
  }
}

function logE2e(message: string, details?: unknown): void {
  const suffix = details === undefined ? "" : ` ${JSON.stringify(details)}`;
  console.log(
    `[Bug Lens E2E][${new Date().toISOString()}] ${message}${suffix}`
  );
}

type ActiveTab = { id?: number; url?: string; title?: string };

export type ExtensionFixtures = {
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
  actionShortcut: ActionShortcut;
  nativeShortcutDriver: NativeShortcutDriver;
  nativeSaveDialogDriver: NativeSaveDialogDriver;
  isolatedDownloadDir: string;
  openActionPopup: (targetPage: Page) => Promise<CdpPopup>;
  waitForPopupClosed: (timeoutMs?: number) => Promise<void>;
  activeTabId: () => Promise<number | undefined>;
  mediaProbe: MediaProbe;
  serverUrl: string;
};

async function activeTab(
  serviceWorker: Worker
): Promise<ActiveTab | undefined> {
  return serviceWorker.evaluate(async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    return tab ? { id: tab.id, url: tab.url, title: tab.title } : undefined;
  });
}

export const test = base.extend<ExtensionFixtures>({
  serverUrl: async ({}, use) => {
    const mockHtmlPath = path.resolve(
      process.cwd(),
      "e2e/fixtures/mock-page.html"
    );
    const privacyHtmlPath = path.resolve(
      process.cwd(),
      "e2e/fixtures/privacy-page.html"
    );
    const server = http.createServer((req, res) => {
      if (req.url === "/api/todo") {
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
        });
        res.end(
          JSON.stringify({ id: 1, title: "Bug Lens E2E", completed: false })
        );
        return;
      }
      if (req.url === "/api/preview/success") {
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
        });
        res.end(
          JSON.stringify({
            status: "ok",
            marker: "[PREV-001 SUCCESS RESPONSE MARKER]",
          })
        );
        return;
      }
      if (req.url === "/api/preview/failure") {
        res.writeHead(500, {
          "Content-Type": "application/json; charset=utf-8",
        });
        res.end(
          JSON.stringify({
            error: "Internal Server Error",
            marker: "[PREV-001 FAILURE RESPONSE MARKER]",
          })
        );
        return;
      }
      if (req.url?.startsWith("/api/privacy-test")) {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", () => {
          try {
            const parsed = JSON.parse(body || "{}");
            res.writeHead(200, {
              "Content-Type": "application/json; charset=utf-8",
            });
            res.end(
              JSON.stringify({
                status: "ok",
                requestId: "req-privacy-12345",
                echoEmail: parsed.email ?? "",
                echoPassword: parsed.password ?? "",
                echoToken: parsed.token ?? "",
                echoApiKey: parsed.apiKey ?? "",
                echoSecret: parsed.nested?.secret ?? "",
              })
            );
          } catch {
            res.writeHead(400, {
              "Content-Type": "application/json; charset=utf-8",
            });
            res.end(JSON.stringify({ error: "Invalid JSON" }));
          }
        });
        return;
      }
      if (req.url?.startsWith("/privacy-page.html")) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(fs.readFileSync(privacyHtmlPath));
        return;
      }
      if (req.url?.startsWith("/issue-page.html")) {
        const issueHtmlPath = path.resolve(
          process.cwd(),
          "e2e/fixtures/issue-page.html"
        );
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(fs.readFileSync(issueHtmlPath));
        return;
      }
      if (req.url?.startsWith("/preview-page.html")) {
        const previewHtmlPath = path.resolve(
          process.cwd(),
          "e2e/fixtures/preview-page.html"
        );
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(fs.readFileSync(previewHtmlPath));
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(fs.readFileSync(mockHtmlPath));
    });

    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve)
    );
    const address = server.address() as { port: number };
    logE2e("Mock server started", { port: address.port });
    await use(`http://127.0.0.1:${address.port}/mock-page.html`);
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  },

  context: async ({}, use) => {
    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "playwright-chrome-user-data-")
    );
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
        "--window-size=1280,900",
      ],
    });

    logE2e("Chrome launched", { pages: context.pages().length });

    await use(context);
    logE2e("Closing Chrome test context");
    await context.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  },

  serviceWorker: async ({ context }, use) => {
    const existing = context
      .serviceWorkers()
      .find((worker) => worker.url().startsWith("chrome-extension://"));
    const serviceWorker =
      existing ??
      (await context.waitForEvent("serviceworker", {
        predicate: (worker) => worker.url().startsWith("chrome-extension://"),
        timeout: 10_000,
      }));
    logE2e("Extension Service Worker ready", { url: serviceWorker.url() });
    await use(serviceWorker);
  },

  extensionId: async ({ serviceWorker }, use) => {
    const extensionId = new URL(serviceWorker.url()).host;
    if (!extensionId)
      throw new Error(
        "EXTENSION_ID_MISSING: 无法从 Service Worker URL 提取扩展 ID"
      );
    await use(extensionId);
  },

  actionShortcut: async ({ serviceWorker }, use) => {
    const commands = await serviceWorker.evaluate(async () =>
      chrome.commands.getAll()
    );
    const command = commands.find((entry) => entry.name === "_execute_action");
    if (!command)
      throw new Error("ACTION_COMMAND_MISSING: 构建产物未声明 _execute_action");
    if (!command.shortcut)
      throw new Error(
        "ACTION_SHORTCUT_UNBOUND: Chrome 未绑定 _execute_action 快捷键"
      );
    logE2e("Resolved extension action shortcut", {
      shortcut: command.shortcut,
    });
    await use(parseChromeShortcut(command.shortcut));
  },

  nativeShortcutDriver: async ({ actionShortcut }, use) => {
    void actionShortcut;
    const browserAppName = browserAppNameFromExecutable(
      chromium.executablePath()
    );
    const driver = createNativeShortcutDriver(browserAppName);
    await driver.preflight();
    logE2e("Native shortcut driver ready", { browserAppName });
    await use(driver);
  },

  nativeSaveDialogDriver: async ({}, use) => {
    const browserAppName = browserAppNameFromExecutable(
      chromium.executablePath()
    );
    const driver = createNativeSaveDialogDriver(browserAppName);
    logE2e("Native save dialog driver ready", { browserAppName });
    await use(driver);
  },

  isolatedDownloadDir: async ({}, use) => {
    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "playwright-chrome-download-")
    );
    logE2e("Isolated download directory created", { tmpDir });
    await use(tmpDir);
    logE2e("Cleaning up isolated download directory", { tmpDir });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  },

  openActionPopup: async (
    {
      context,
      serviceWorker,
      extensionId,
      actionShortcut,
      nativeShortcutDriver,
    },
    use
  ) => {
    const popupUrl = `chrome-extension://${extensionId}/popup.html`;
    const browser = context.browser();
    if (!browser)
      throw new Error("BROWSER_CDP_UNAVAILABLE: 未找到 Playwright Browser");
    const browserCdp = await browser.newBrowserCDPSession();
    const popupTargetExists = async (): Promise<boolean> => {
      const result = (await browserCdp.send("Target.getTargets")) as {
        targetInfos: Array<{ url: string }>;
      };
      return result.targetInfos.some((entry) => entry.url === popupUrl);
    };
    const open = async (targetPage: Page): Promise<CdpPopup> => {
      if (targetPage.isClosed())
        throw new Error("TARGET_TAB_MISSING: 目标页面已经关闭");
      await targetPage.bringToFront();
      await targetPage.waitForFunction(() => document.hasFocus(), undefined, {
        timeout: 2_000,
      });

      const target = await activeTab(serviceWorker);
      const targetUrl = new URL(targetPage.url());
      if (!target?.id || !target.url)
        throw new Error("TARGET_TAB_MISSING: Chrome 没有活动标签页");
      const chromeUrl = new URL(target.url);
      if (
        chromeUrl.origin !== targetUrl.origin ||
        chromeUrl.pathname !== targetUrl.pathname
      ) {
        throw new Error(
          `TARGET_TAB_MISMATCH: Playwright=${safeUrlForLog(targetPage.url())} Chrome=${safeUrlForLog(target.url)}`
        );
      }

      if (await popupTargetExists())
        throw new Error(
          "ACTION_POPUP_TARGET_INVALID: 快捷键发送前已有未关闭的 Popup"
        );

      logE2e("Sending native extension shortcut", {
        shortcut: actionShortcut.raw,
        targetTabId: target.id,
        targetUrl: safeUrlForLog(target.url),
      });
      await nativeShortcutDriver.press(actionShortcut);

      let popup: CdpPopup;
      try {
        popup = await attachToPopupTarget(browserCdp, popupUrl, 8_000);
      } catch (error) {
        if (!String(error).includes("ACTION_POPUP_TARGET_TIMEOUT")) throw error;
        if (await popupTargetExists()) {
          throw new Error(
            `ACTION_POPUP_TARGET_INVALID: Popup target 已存在但无法附加。${String(error)}`
          );
        }

        await targetPage.bringToFront();
        await targetPage.waitForFunction(() => document.hasFocus(), undefined, {
          timeout: 2_000,
        });
        const retryTarget = await activeTab(serviceWorker);
        if (retryTarget?.id !== target.id || retryTarget.url !== target.url) {
          throw new Error(
            `TARGET_TAB_MISMATCH: 快捷键恢复前目标标签已变化。expected=${target.id}:${safeUrlForLog(target.url)} actual=${retryTarget?.id}:${safeUrlForLog(retryTarget?.url)}`
          );
        }

        logE2e(
          "Action Popup target was absent; retrying native shortcut once",
          {
            shortcut: actionShortcut.raw,
            targetTabId: retryTarget.id,
            targetUrl: safeUrlForLog(retryTarget.url),
          }
        );
        await nativeShortcutDriver.press(actionShortcut);
        popup = await attachToPopupTarget(browserCdp, popupUrl, 8_000);
      }
      logE2e("Attached to real Action Popup", { url: popup.url });
      return popup;
    };
    try {
      await use(open);
    } finally {
      await browserCdp.detach().catch(() => undefined);
    }
  },

  waitForPopupClosed: async ({ context, extensionId }, use) => {
    const popupUrl = `chrome-extension://${extensionId}/popup.html`;
    const browser = context.browser();
    if (!browser)
      throw new Error("BROWSER_CDP_UNAVAILABLE: 未找到 Playwright Browser");
    const browserCdp = await browser.newBrowserCDPSession();
    const waitForClosed = async (timeoutMs = 5_000): Promise<void> => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const result = (await browserCdp.send("Target.getTargets")) as {
          targetInfos: Array<{ url: string }>;
        };
        const exists = result.targetInfos.some(
          (entry) => entry.url === popupUrl
        );
        if (!exists) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(
        "ACTION_POPUP_CLOSE_TIMEOUT: Popup target 未能在预期时间内关闭"
      );
    };
    try {
      await use(waitForClosed);
    } finally {
      await browserCdp.detach().catch(() => undefined);
    }
  },

  activeTabId: async ({ serviceWorker }, use) => {
    await use(async () => (await activeTab(serviceWorker))?.id);
  },

  mediaProbe: async ({ context, serviceWorker }, use) => {
    await use(new MediaProbe(context, serviceWorker));
  },
});

export { expect } from "@playwright/test";
