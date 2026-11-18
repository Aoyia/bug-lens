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
import { execFileSync } from "node:child_process";
import {
  browserAppNameFromExecutable,
  createNativeShortcutDriver,
  isExtensionPagePopupDriver,
  nativeShortcutSkipReason,
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
import { withOsInteractionLock } from "./os-mutex.ts";

const pathToExtension = fs.realpathSync(path.resolve(process.cwd(), "dist"));

function envMilliseconds(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

const slowMoMs = envMilliseconds("E2E_SLOW_MO_MS", 0);
let hasCompletedShortcutPreflight = false;

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
  getAppUrl: (
    framework: "vue2" | "vue3" | "react" | "react19",
    mode: "dev" | "prod"
  ) => string;
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

/** 从 manifest 已绑定的 _execute_action 命令解析真实快捷键（仅 native 驱动需要）。 */
async function resolveActionShortcut(
  serviceWorker: Worker
): Promise<ActionShortcut> {
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
  return parseChromeShortcut(command.shortcut);
}

/** 解析浏览器主进程 PID，供 System Events 精确定位测试实例（仅 native 驱动需要）。 */
async function resolveBrowserPid(
  context: BrowserContext
): Promise<number | undefined> {
  try {
    const browser = context.browser();
    if (!browser) return undefined;
    const cdp = await browser.newBrowserCDPSession();
    const info = (await cdp.send("SystemInfo.getProcessInfo")) as {
      processInfo: Array<{ type: string; id: number }>;
    };
    const proc = info.processInfo.find((p) => p.type === "browser");
    await cdp.detach();
    return proc?.id;
  } catch {
    // 忽略 CDP 获取 PID 失败，安全回退到进程名查找
    return undefined;
  }
}

/**
 * 构造 native（System Events 物理快捷键）驱动并在进程内只做一次预检。
 * openActionPopup 的 native 分支与 nativeShortcutDriver fixture 共用同一套语义。
 */
async function createBrowserNativeShortcutDriver(
  context: BrowserContext
): Promise<NativeShortcutDriver> {
  const browserAppName = browserAppNameFromExecutable(
    chromium.executablePath()
  );
  const browserPid = await resolveBrowserPid(context);
  const driver = createNativeShortcutDriver(browserAppName, browserPid);
  if (!hasCompletedShortcutPreflight) {
    await driver.preflight();
    hasCompletedShortcutPreflight = true;
  }
  logE2e("Native shortcut driver ready", { browserAppName, browserPid });
  return driver;
}

/**
 * 扩展内 popup 驱动：由 service worker 调用 chrome.action.openPopup()，
 * 由浏览器创建**真实的 Action Popup 窗口**（不是新标签页），因此
 * chrome.tabs.query({active:true,currentWindow:true}) 仍指向目标标签页，
 * 且完全不需要 macOS 辅助功能权限。
 */
async function openRealActionPopup(serviceWorker: Worker): Promise<void> {
  const result = await serviceWorker.evaluate(async () => {
    const action = chrome.action as unknown as {
      openPopup?: () => Promise<void>;
    };
    if (typeof action.openPopup !== "function")
      return { ok: false, error: "ACTION_OPENPOPUP_UNAVAILABLE" };
    try {
      await action.openPopup();
      return { ok: true, error: "" };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  });
  if (!result.ok) throw new Error(`ACTION_POPUP_OPEN_FAILED: ${result.error}`);
}

const LARGE_JSON_PAYLOAD = JSON.stringify({
  token: "secret-token-e2e-opt004",
  largeText: "x".repeat(Math.round(3.35 * 1024 * 1024)),
  status: "ok",
});

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
    const appsDistDir = path.resolve(process.cwd(), "e2e/fixtures/apps/dist");
    const requiredTargets = [
      "vue2-dev/bundle.js",
      "vue2-prod/bundle.js",
      "vue3-dev/bundle.js",
      "vue3-prod/bundle.js",
      "react-dev/bundle.js",
      "react-prod/bundle.js",
      "react19-dev/bundle.js",
      "react19-prod/bundle.js",
    ];
    const isMissingAny = requiredTargets.some(
      (target) => !fs.existsSync(path.resolve(appsDistDir, target))
    );
    if (isMissingAny) {
      try {
        execFileSync(
          process.execPath,
          [path.resolve(process.cwd(), "scripts/build-fixture-apps.mjs")],
          { stdio: "pipe" }
        );
      } catch (e) {
        console.error("Auto-building fixture apps failed:", e);
      }
    }
    const server = http.createServer((req, res) => {
      const parsedUrl = new URL(
        req.url || "/",
        `http://${req.headers.host || "127.0.0.1"}`
      );
      const pathname = parsedUrl.pathname;

      if (pathname === "/api/large-json") {
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store, no-cache, must-revalidate",
        });
        res.end(LARGE_JSON_PAYLOAD);
        return;
      }
      if (pathname === "/api/todo") {
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
        });
        res.end(JSON.stringify({ id: 1, title: "E2E Task", completed: false }));
        return;
      }
      if (pathname === "/api/preview/success") {
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
      if (pathname === "/api/preview/failure") {
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
      if (pathname.startsWith("/api/privacy-test")) {
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
      if (pathname === "/api/iframe-child-data") {
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
        });
        res.end(
          JSON.stringify({
            status: "ok",
            message: "child data loaded",
            timestamp: Date.now(),
          })
        );
        return;
      }
      if (pathname.startsWith("/iframe-host.html")) {
        const iframeHostPath = path.resolve(
          process.cwd(),
          "e2e/fixtures/iframe-host.html"
        );
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(fs.readFileSync(iframeHostPath));
        return;
      }
      if (pathname.startsWith("/iframe-child.html")) {
        const iframeChildPath = path.resolve(
          process.cwd(),
          "e2e/fixtures/iframe-child.html"
        );
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(fs.readFileSync(iframeChildPath));
        return;
      }
      if (pathname.startsWith("/privacy-page.html")) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(fs.readFileSync(privacyHtmlPath));
        return;
      }
      if (pathname.startsWith("/issue-page.html")) {
        const issueHtmlPath = path.resolve(
          process.cwd(),
          "e2e/fixtures/issue-page.html"
        );
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(fs.readFileSync(issueHtmlPath));
        return;
      }
      if (pathname.startsWith("/preview-page.html")) {
        const previewHtmlPath = path.resolve(
          process.cwd(),
          "e2e/fixtures/preview-page.html"
        );
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(fs.readFileSync(previewHtmlPath));
        return;
      }
      if (pathname.startsWith("/apps/")) {
        const match = pathname.match(/^\/apps\/([^/]+)\/([^/]+)(?:\/(.*))?$/);
        if (!match) {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          res.end(`Invalid fixture app path: ${pathname}`);
          return;
        }

        const [, framework, mode, rawFile] = match;
        const targetDir = path.resolve(
          process.cwd(),
          "e2e/fixtures/apps/dist",
          `${framework}-${mode}`
        );
        const decodedFile = rawFile ? decodeURIComponent(rawFile) : "";
        const fileToServe =
          decodedFile && decodedFile.length > 0 ? decodedFile : "index.html";
        const resolvedPath = path.resolve(targetDir, fileToServe);
        const safeTargetPrefix = targetDir.endsWith(path.sep)
          ? targetDir
          : targetDir + path.sep;

        if (
          !resolvedPath.startsWith(safeTargetPrefix) &&
          resolvedPath !== targetDir
        ) {
          res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Forbidden");
          return;
        }

        if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
          const ext = path.extname(resolvedPath);
          let contentType = "application/octet-stream";
          if (ext === ".html") contentType = "text/html; charset=utf-8";
          else if (ext === ".js")
            contentType = "application/javascript; charset=utf-8";
          else if (ext === ".css") contentType = "text/css; charset=utf-8";
          else if (ext === ".json" || ext === ".map")
            contentType = "application/json; charset=utf-8";

          res.writeHead(200, {
            "Content-Type": contentType,
            "Access-Control-Allow-Origin": "*",
          });
          res.end(fs.readFileSync(resolvedPath));
          return;
        } else {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          res.end(`Fixture app file not found: ${pathname}`);
          return;
        }
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(fs.readFileSync(mockHtmlPath));
    });

    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve)
    );
    const address = server.address() as { port: number };
    logE2e("Mock server started", { port: address.port });
    try {
      await use(`http://127.0.0.1:${address.port}/mock-page.html`);
    } finally {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },

  getAppUrl: async ({ serverUrl }, use) => {
    const origin = new URL(serverUrl).origin;
    await use(
      (
        framework: "vue2" | "vue3" | "react" | "react19",
        mode: "dev" | "prod"
      ) => {
        return `${origin}/apps/${framework}/${mode}/index.html`;
      }
    );
  },

  context: async ({}, use) => {
    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "playwright-chrome-user-data-")
    );
    logE2e("Launching Chrome for Testing", { slowMoMs, profile: tmpDir });
    const windowPosition = process.env.E2E_WINDOW_POSITION ?? "0,0";
    const windowSize = process.env.E2E_WINDOW_SIZE ?? "1280,900";
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
        `--window-position=${windowPosition}`,
        `--window-size=${windowSize}`,
      ],
    });

    context.on("page", (page) => {
      if (page.url().includes("aoyia.github.io/bug-lens")) {
        page.close().catch(() => {});
      }
    });
    for (const page of context.pages()) {
      if (page.url().includes("aoyia.github.io/bug-lens")) {
        await page.close().catch(() => {});
      }
    }

    await context.addInitScript(() => {
      let memoryClipboard = "";
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        try {
          const cb = navigator.clipboard as any;
          if (!cb.__bugLensPlaywrightHookInstalled) {
            const origRead = cb.readText?.bind(cb);
            cb.readText = async () => {
              if (
                typeof window !== "undefined" &&
                (window as any).__BUG_LENS_VIRTUAL_CLIPBOARD__ !== undefined
              ) {
                return (window as any).__BUG_LENS_VIRTUAL_CLIPBOARD__;
              }
              if (memoryClipboard) return memoryClipboard;
              return origRead ? await origRead() : "";
            };
            cb.writeText = async (text: string) => {
              memoryClipboard = String(text);
              if (typeof window !== "undefined") {
                (window as any).__BUG_LENS_VIRTUAL_CLIPBOARD__ =
                  memoryClipboard;
              }
            };
            cb.write = async (items: ClipboardItem[]) => {
              for (const item of items) {
                if (item.types?.includes("text/plain")) {
                  const blob = await item.getType("text/plain");
                  memoryClipboard = await blob.text();
                  if (typeof window !== "undefined") {
                    (window as any).__BUG_LENS_VIRTUAL_CLIPBOARD__ =
                      memoryClipboard;
                  }
                  break;
                }
              }
            };
            cb.__bugLensPlaywrightHookInstalled = true;
          }
        } catch {}
      }
    });

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
    await serviceWorker.evaluate(async () => {
      await chrome.storage.local.set({
        skipOnboardingGuide: true,
      });
    });
    logE2e("Pre-configured E2E storage: install onboarding page bypassed");
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
    await use(await resolveActionShortcut(serviceWorker));
  },

  nativeShortcutDriver: async ({ context }, use) => {
    // 显式跳过（extension-page 驱动 / 跳过辅助功能预检）时，依赖系统级按键模拟的用例
    // 在此精确跳过，而不是在 preflight() 里抛权限错误，也不是伪装成通过。
    const skipReason = nativeShortcutSkipReason();
    if (skipReason) test.skip(true, skipReason);
    await use(await createBrowserNativeShortcutDriver(context));
  },

  nativeSaveDialogDriver: async ({ context }, use) => {
    const browserAppName = browserAppNameFromExecutable(
      chromium.executablePath()
    );
    let browserPid: number | undefined;
    try {
      const browser = context.browser();
      if (browser) {
        const cdp = await browser.newBrowserCDPSession();
        const info = (await cdp.send("SystemInfo.getProcessInfo")) as {
          processInfo: Array<{ type: string; id: number }>;
        };
        const proc = info.processInfo.find((p) => p.type === "browser");
        browserPid = proc?.id;
        await cdp.detach();
      }
    } catch {
      // 回退
    }
    const driver = createNativeSaveDialogDriver(browserAppName, browserPid);
    logE2e("Native save dialog driver ready", { browserAppName, browserPid });
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

  openActionPopup: async ({ context, serviceWorker, extensionId }, use) => {
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

      return withOsInteractionLock(
        async () => {
          await targetPage.bringToFront();
          if (isExtensionPagePopupDriver()) {
            // extension-page 驱动只需要「目标页是该窗口的活动标签页」（bringToFront 已保证），
            // 不要求窗口拿到 OS 键盘焦点；hasFocus 仅作为尽力而为的稳定等待。
            await targetPage
              .waitForFunction(() => document.hasFocus(), undefined, {
                timeout: 2_000,
              })
              .catch(() => undefined);
          } else {
            await targetPage.waitForFunction(
              () => document.hasFocus(),
              undefined,
              {
                timeout: 2_000,
              }
            );
          }

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
              "ACTION_POPUP_TARGET_INVALID: Popup 打开前已有未关闭的 Popup"
            );

          // 业务核心契约：这里必须打开浏览器的**真实 Action Popup 窗口**，
          // 严禁用 context.newPage() 打开 popup.html 当作 tab 伪造：
          // 扩展页作为 tab 时 chrome.tabs.query({active:true,currentWindow:true})
          // 会指向 popup 自身的 tab，与录制目标标签页不一致（已实测确认）。
          let popup: CdpPopup;
          if (isExtensionPagePopupDriver()) {
            // extension-page：service worker 侧 chrome.action.openPopup()，
            // 不需要系统级按键，因此不依赖 macOS 辅助功能权限。
            logE2e("Opening real Action Popup via chrome.action.openPopup()", {
              targetTabId: target.id,
              targetUrl: safeUrlForLog(target.url),
            });
            await openRealActionPopup(serviceWorker);
            try {
              popup = await attachToPopupTarget(browserCdp, popupUrl, 5_000);
            } catch {
              logE2e("Retrying chrome.action.openPopup once for popup attach");
              await targetPage.bringToFront();
              await new Promise((resolve) => setTimeout(resolve, 300));
              await openRealActionPopup(serviceWorker);
              popup = await attachToPopupTarget(browserCdp, popupUrl, 5_000);
            }
          } else {
            // native：保留原有 System Events 物理快捷键路径（需要辅助功能权限）。
            // 缺少权限时精确跳过，而不是把“未执行”伪装成通过。
            const skipReason = nativeShortcutSkipReason();
            if (skipReason) test.skip(true, skipReason);
            const nativeShortcutDriver =
              await createBrowserNativeShortcutDriver(context);
            const actionShortcut = await resolveActionShortcut(serviceWorker);

            logE2e("Sending native extension shortcut", {
              shortcut: actionShortcut.raw,
              targetTabId: target.id,
              targetUrl: safeUrlForLog(target.url),
            });
            const diag = await nativeShortcutDriver.press(actionShortcut);
            logE2e("Native extension shortcut sent", {
              focusedWindow: diag.focusedWindow?.trim(),
            });

            try {
              popup = await attachToPopupTarget(browserCdp, popupUrl, 2_000);
            } catch {
              // 若 2s 内未捕获到 Action Popup（例如冷启窗口 Cocoa 焦点首次绑定偶发抖动），显式重新置顶并物理重试一次系统级原生快捷键
              logE2e("Retrying native shortcut once for action popup attach");
              await targetPage.bringToFront();
              await new Promise((resolve) => setTimeout(resolve, 300));
              await nativeShortcutDriver.press(actionShortcut);
              popup = await attachToPopupTarget(browserCdp, popupUrl, 5_000);
            }
          }
          logE2e("Attached to real Action Popup", { url: popup.url });
          return popup;
        },
        { label: "openActionPopup" }
      );
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
