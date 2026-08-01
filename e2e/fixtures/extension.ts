import { test as base, chromium, type BrowserContext, type Page } from "@playwright/test";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import http from "node:http";

const pathToExtension = fs.realpathSync(path.resolve(process.cwd(), "dist"));

export type ExtensionFixtures = {
  context: BrowserContext;
  extensionId: string;
  popupPage: Page;
  openPopup: () => Promise<Page>;
  serverUrl: string;
};

export const test = base.extend<ExtensionFixtures>({
  serverUrl: async ({}, use) => {
    const mockHtmlPath = path.resolve(process.cwd(), "e2e/fixtures/mock-page.html");
    const server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(fs.readFileSync(mockHtmlPath));
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address() as { port: number };
    const url = `http://127.0.0.1:${address.port}/mock-page.html`;

    await use(url);

    server.closeAllConnections?.();
    server.close();
  },
  context: async ({}, use) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "playwright-chrome-user-data-"));
    const context = await chromium.launchPersistentContext(tmpDir, {
      headless: false,
      args: [
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`,
        "--allow-file-access-from-files",
        "--no-first-run",
        "--no-default-browser-check"
      ]
    });

    await use(context);
    await context.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  },

  extensionId: async ({ context }, use) => {
    // 1. 优先尝试 ServiceWorker
    let sw = context.serviceWorkers()[0];
    let id = sw?.url() ? sw.url().split("/")[2] : "";

    // 2. 若背景 ServiceWorker 未触发，打开独立标签页通过 chrome://extensions 提炼已许可 ID
    if (!id) {
      const page = await context.newPage();
      try {
        await page.goto("chrome://extensions", { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(500);

        // 确保 DevMode 开发者模式开关联通
        await page.evaluate(() => {
          try {
            const mgr = document.querySelector("extensions-manager");
            const toolbar = mgr?.shadowRoot?.querySelector("extensions-toolbar");
            const toggle = toolbar?.shadowRoot?.querySelector<HTMLElement>("#devMode");
            if (toggle && !toggle.hasAttribute("checked")) {
              toggle.click();
            }
          } catch {}
        });

        await page.waitForTimeout(600);

        // 提取已装载解压插件的真实 ID
        id = await page.evaluate(() => {
          try {
            const mgr = document.querySelector("extensions-manager") as any;
            const list = mgr?.shadowRoot?.querySelector("extensions-item-list") as any;
            const items = list?.shadowRoot?.querySelectorAll("extensions-item") as any;
            if (items && items.length > 0) {
              return items[0].id;
            }
          } catch {}
          return "";
        });
      } catch {
        // ignore
      } finally {
        await page.close().catch(() => undefined);
      }
    }

    if (!id) {
      // 兜底提取
      sw = await context.waitForEvent("serviceworker", { timeout: 3000 }).catch(() => undefined as any);
      if (sw?.url()) id = sw.url().split("/")[2];
    }

    if (!id) {
      throw new Error("无法提炼已装载插件的动态 Extension ID");
    }

    await use(id);
  },

  openPopup: async ({ context, extensionId }, use) => {
    const openPopupFn = async () => {
      const existingPopup = context.pages().find((p) => p.url().includes("popup.html"));
      if (existingPopup) return existingPopup;

      const page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/popup.html`);
      return page;
    };
    await use(openPopupFn);
  }
});

export { expect } from "@playwright/test";
