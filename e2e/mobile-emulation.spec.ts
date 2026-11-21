import { unzipSync } from "fflate";
import fs from "node:fs";
import {
  type BrowserContext,
  type CDPSession,
  type Locator,
  type Page,
  type Worker,
} from "@playwright/test";
import {
  test as baseTest,
  expect,
  safeUrlForLog,
} from "./fixtures/extension.ts";

const test = baseTest.extend({
  nativeShortcutDriver: async ({ context }, use) => {
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
    } catch {}

    const { execFile } = await import("node:child_process");

    const driver = {
      preflight: async () => ({
        platform: process.platform,
        browserAppName: "Google Chrome for Testing",
      }),
      press: async () => {
        if (browserPid) {
          const jxa = `ObjC.import("AppKit"); var app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(${browserPid}); if (app && !app.isNil()) { app.activateWithOptions($.NSApplicationActivateIgnoringOtherApps); }`;
          await new Promise<void>((resolve) => {
            execFile(
              "/usr/bin/osascript",
              ["-l", "JavaScript", "-e", jxa],
              () => resolve()
            );
          });
        }
        const script = [
          'tell application "System Events"',
          "  delay 0.2",
          '  keystroke "y" using {shift down, command down}',
          "  return name of first application process whose frontmost is true",
          "end tell",
        ].join("\n");
        const focusedWindow = await new Promise<string>((resolve, reject) => {
          execFile(
            "/usr/bin/osascript",
            ["-e", script],
            { timeout: 15_000 },
            (err, stdout) => {
              if (err) reject(err);
              else resolve(stdout.trim());
            }
          );
        });
        return {
          platform: process.platform,
          browserAppName: "Google Chrome for Testing",
          focusedWindow,
          sentAtEpochMs: Date.now(),
        };
      },
    };
    await use(driver);
  },
});

function logE2e(message: string, details?: unknown): void {
  const suffix = details === undefined ? "" : ` ${JSON.stringify(details)}`;
  console.log(
    `[Bug Lens E2E][${new Date().toISOString()}] ${message}${suffix}`
  );
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

type RectBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function assertInsideViewport(
  box: RectBox | null,
  vw: number,
  vh: number,
  label: string
): void {
  expect(box, `${label} boundingBox should exist`).toBeTruthy();
  expect(box!.width, `${label} width > 0`).toBeGreaterThan(0);
  expect(box!.height, `${label} height > 0`).toBeGreaterThan(0);
  expect(box!.x, `${label} left >= 0`).toBeGreaterThanOrEqual(-0.5);
  expect(box!.y, `${label} top >= 0`).toBeGreaterThanOrEqual(-0.5);
  expect(box!.x + box!.width, `${label} right <= ${vw}`).toBeLessThanOrEqual(
    vw + 0.5
  );
  expect(box!.y + box!.height, `${label} bottom <= ${vh}`).toBeLessThanOrEqual(
    vh + 0.5
  );
}

async function assertLocatorInsideViewport(
  locator: Locator,
  vw: number,
  vh: number,
  label: string
): Promise<RectBox> {
  await expect(locator, `${label} should be visible`).toBeVisible();
  const box = await locator.boundingBox();
  assertInsideViewport(box, vw, vh, label);
  return box!;
}

/** 开启 Chrome DevTools 移动端模拟（375x667, DPR=3, mobile=true, 触控事件） */
async function enableMobileEmulation(
  cdp: CDPSession,
  width = 375,
  height = 667,
  deviceScaleFactor = 3
): Promise<void> {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor,
    mobile: true,
  });
  await cdp.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 5,
  });
  await cdp.send("Emulation.setEmitTouchEventsForMouse", {
    enabled: true,
  });
}

/** 通过 CDP Input.dispatchTouchEvent 发送真实触控点击（触发 pointerType: "touch" 与 touchstart/touchend/click） */
async function touchTap(cdp: CDPSession, x: number, y: number): Promise<void> {
  const rx = Math.round(x);
  const ry = Math.round(y);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: rx, y: ry, id: 0 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
}

/** 通过 CDP Input.dispatchTouchEvent 发送真实触控拖拽 */
async function touchDrag(
  cdp: CDPSession,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  steps = 8
): Promise<void> {
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: Math.round(x1), y: Math.round(y1), id: 0 }],
  });
  for (let i = 1; i <= steps; i++) {
    const cx = Math.round(x1 + ((x2 - x1) * i) / steps);
    const cy = Math.round(y1 + ((y2 - y1) * i) / steps);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: cx, y: cy, id: 0 }],
    });
    await delay(16);
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
}

async function tapLocator(cdp: CDPSession, locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  if (!box) throw new Error("tapLocator: missing boundingBox");
  await touchTap(cdp, box.x + box.width / 2, box.y + box.height / 2);
}

/** 为测试 HTML 注入 mobile viewport meta 并消除宿主页面自身横向撑宽，使 layout viewport 真实为 375px */
async function installResponsiveViewportMeta(page: Page): Promise<void> {
  await page.route("**/*.html*", async (route) => {
    const response = await route.fetch();
    const html = await response.text();
    const mobileHead =
      '<head><meta name="viewport" content="width=device-width, initial-scale=1.0" /><style>html,body{max-width:100vw!important;overflow-x:hidden!important;} .card div{flex-wrap:wrap!important;max-width:100%!important;} input{max-width:100%!important;box-sizing:border-box!important;}</style>';
    const injected = html.includes('name="viewport"')
      ? html
      : html.replace("<head>", mobileHead);
    await route.fulfill({ response, body: injected });
  });
}

async function triggerScreenshotOverlay(
  serviceWorker: Worker,
  tabId: number,
  viewportDataUrl: string
): Promise<void> {
  await serviceWorker.evaluate(
    async ({ tabId, viewportDataUrl }) => {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js", "screenshot-overlay.js"],
      });
      await chrome.tabs.sendMessage(tabId, {
        type: "TRIGGER_SCREENSHOT_OVERLAY",
        viewportDataUrl,
      });
    },
    { tabId, viewportDataUrl }
  );
}

async function captureViewportDataUrl(cdp: CDPSession): Promise<string> {
  const result = (await cdp.send("Page.captureScreenshot", {
    format: "png",
  })) as { data: string };
  return `data:image/png;base64,${result.data}`;
}

/** 生成指定像素宽高的合法 PNG data URL（用于验证 DPR=3 与 2x 位图比例差异） */
async function createSolidPngDataUrl(
  page: Page,
  width: number,
  height: number
): Promise<string> {
  return page.evaluate(
    ({ width, height }) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#f4f5f7";
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = "#165dff";
      ctx.fillRect(20, 200, 120, 80);
      return canvas.toDataURL("image/png");
    },
    { width, height }
  );
}

/** 解析 PNG / JPEG 字节头真实宽高 */
function parseImageDimensions(bytes: Uint8Array): {
  width: number;
  height: number;
} | null {
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return {
      width: view.getUint32(16, false),
      height: view.getUint32(20, false),
    };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 3 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
      if (offset >= bytes.length) break;
      const marker = bytes[offset];
      offset += 1;
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x00) continue;
      if (offset + 1 >= bytes.length) break;
      const segLen = (bytes[offset]! << 8) | bytes[offset + 1]!;
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      ) {
        if (offset + 7 <= bytes.length) {
          return {
            height: (bytes[offset + 3]! << 8) | bytes[offset + 4]!,
            width: (bytes[offset + 5]! << 8) | bytes[offset + 6]!,
          };
        }
        break;
      }
      offset += segLen;
    }
  }
  return null;
}

class MobileShadowProbe {
  constructor(
    private readonly cdp: CDPSession,
    private readonly touchCdp: CDPSession
  ) {}

  async init(): Promise<void> {
    await this.cdp.send("DOM.enable");
    await this.cdp.send("Runtime.enable");
  }

  private parseSelector(selector: string): {
    tag: string | null;
    cls: string | null;
    attrName: string | null;
    attrValue: string | null;
  } {
    const m = selector.match(
      /^([a-z-]+)?(?:\.([a-z0-9_-]+))?(?:\[([a-z-]+)="([^"]+)"\])?$/
    );
    if (!m) throw new Error(`unsupported shadow selector: ${selector}`);
    const [, tag, cls, attrName, attrValue] = m;
    return {
      tag: tag ?? null,
      cls: cls ?? null,
      attrName: attrName ?? null,
      attrValue: attrValue ?? null,
    };
  }

  private nodeMatches(
    node: Record<string, any>,
    sel: {
      tag: string | null;
      cls: string | null;
      attrName: string | null;
      attrValue: string | null;
    }
  ): boolean {
    const name = String(node.nodeName ?? "").toLowerCase();
    if (sel.tag && name !== sel.tag) return false;
    const attrs = (node.attributes as string[] | undefined) ?? [];
    const attrMap = new Map<string, string>();
    for (let i = 0; i + 1 < attrs.length; i += 2) {
      attrMap.set(String(attrs[i]).toLowerCase(), String(attrs[i + 1]));
    }
    if (
      sel.cls &&
      !(attrMap.get("class") ?? "").split(/\s+/).includes(sel.cls)
    ) {
      return false;
    }
    if (
      sel.attrName &&
      attrMap.get(sel.attrName.toLowerCase()) !== sel.attrValue
    ) {
      return false;
    }
    return true;
  }

  private async findAllNodeIds(selector: string): Promise<number[]> {
    const sel = this.parseSelector(selector);
    const doc = (await this.cdp.send("DOM.getDocument", {
      depth: -1,
      pierce: true,
    })) as { root: Record<string, any> };
    const matches: number[] = [];
    const stack: Record<string, any>[] = [doc.root];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (node.nodeType === 1 && this.nodeMatches(node, sel)) {
        matches.push(node.nodeId as number);
      }
      if (node.children) {
        for (const child of node.children) stack.push(child);
      }
      const shadows = node.shadowRoots as Record<string, any>[] | undefined;
      if (shadows) {
        for (const shadow of shadows) {
          if (shadow.children) {
            for (const child of shadow.children) stack.push(child);
          }
        }
      }
    }
    return matches;
  }

  private async getRectsByNodeIds(nodeIds: number[]): Promise<RectBox[]> {
    const rects: RectBox[] = [];
    for (const nodeId of nodeIds) {
      const resolved = (await this.cdp.send("DOM.resolveNode", {
        nodeId,
      })) as { object?: { objectId?: string } };
      const objectId = resolved.object?.objectId;
      if (!objectId) continue;
      const result = (await this.cdp.send("Runtime.callFunctionOn", {
        objectId,
        functionDeclaration:
          "function () { const s = getComputedStyle(this); if (s.display === 'none' || s.visibility === 'hidden') return null; const r = this.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; }",
        returnByValue: true,
      })) as { result: { value?: RectBox | null } };
      if (result.result.value) rects.push(result.result.value);
    }
    return rects;
  }

  async getRect(selector: string): Promise<RectBox | null> {
    const ids = await this.findAllNodeIds(selector);
    if (!ids.length) return null;
    const rects = await this.getRectsByNodeIds([ids[0]!]);
    return rects[0] ?? null;
  }

  async getToolbarButtonRects(): Promise<RectBox[]> {
    const doc = (await this.cdp.send("DOM.getDocument", {
      depth: -1,
      pierce: true,
    })) as { root: Record<string, any> };
    const sel = this.parseSelector("div.toolbar");
    const stack: Record<string, any>[] = [doc.root];
    let toolbarNode: Record<string, any> | null = null;
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (node.nodeType === 1 && this.nodeMatches(node, sel)) {
        toolbarNode = node;
        break;
      }
      for (const child of node.children ?? []) stack.push(child);
      for (const shadow of node.shadowRoots ?? []) {
        for (const child of shadow.children ?? []) stack.push(child);
      }
    }
    if (!toolbarNode) return [];
    const buttonIds: number[] = [];
    for (const child of toolbarNode.children ?? []) {
      if (String(child.nodeName ?? "").toLowerCase() === "button") {
        buttonIds.push(child.nodeId as number);
      }
    }
    return this.getRectsByNodeIds(buttonIds);
  }

  async canvasFingerprint(): Promise<string | null> {
    const ids = await this.findAllNodeIds("canvas.canvas-layer");
    if (!ids.length) return null;
    const resolved = (await this.cdp.send("DOM.resolveNode", {
      nodeId: ids[0],
    })) as { object: { objectId: string } };
    const result = (await this.cdp.send("Runtime.callFunctionOn", {
      objectId: resolved.object.objectId,
      functionDeclaration:
        "function () { try { return this.toDataURL(); } catch (e) { return String(e); } }",
      returnByValue: true,
    })) as { result: { value?: string } };
    return result.result.value ?? null;
  }

  async click(selector: string): Promise<void> {
    const r = await this.getRect(selector);
    if (!r) throw new Error(`closed-shadow element not found: ${selector}`);
    await touchTap(this.touchCdp, r.x + r.width / 2, r.y + r.height / 2);
  }
}

test.describe("Bug Lens Chrome Extension E2E MOBILE-EMULATION: Chrome DevTools 移动端模拟全链路验证", () => {
  test("MOBILE-001: RecordingWidget 在移动仿真下为贴边胶囊：轻点侧边菜单、拖拽左右磁吸、一键换边、横屏/320 重钳制、底部保护区零遮挡及宿主 isMac 识别", async ({
    context,
    openActionPopup,
    mediaProbe,
    serverUrl,
  }) => {
    let targetPage = context.pages()[0];
    if (!targetPage) targetPage = await context.newPage();

    const cdp = await context.newCDPSession(targetPage);
    await enableMobileEmulation(cdp, 375, 667, 3);
    await installResponsiveViewportMeta(targetPage);
    // 伪装页面 navigator.platform 为 Android，验证后台 runtime/host-platform 仍返回真实宿主平台
    await cdp.send("Emulation.setUserAgentOverride", {
      userAgent:
        "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
      platform: "Linux armv8l",
    });

    await targetPage.goto(serverUrl);
    await targetPage.bringToFront();
    await targetPage
      .waitForFunction(() => document.hasFocus(), undefined, { timeout: 2_000 })
      .catch(() => undefined);

    // 验证 Chrome 移动端模拟环境真实生效 + 真实触控事件触发
    const envCheck = await targetPage.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
      dpr: window.devicePixelRatio,
      coarseOrNoHover: window.matchMedia("(hover: none), (pointer: coarse)")
        .matches,
      maxTouchPoints: navigator.maxTouchPoints,
      platform: navigator.platform,
    }));
    expect(envCheck.width).toBe(375);
    expect(envCheck.height).toBe(667);
    expect(envCheck.dpr).toBe(3);
    expect(envCheck.coarseOrNoHover).toBe(true);
    expect(envCheck.maxTouchPoints).toBeGreaterThanOrEqual(5);
    expect(envCheck.platform).toBe("Linux armv8l");

    await targetPage.evaluate(() => {
      const w = window as any;
      w.__touchObserved = 0;
      w.__pointerTouchObserved = 0;
      window.addEventListener("touchstart", () => {
        w.__touchObserved += 1;
      });
      window.addEventListener("pointerdown", (e: PointerEvent) => {
        if (e.pointerType === "touch") w.__pointerTouchObserved += 1;
      });
    });
    await touchTap(cdp, 40, 40);
    const touchProbe = await targetPage.evaluate(() => ({
      touchObserved: (window as any).__touchObserved,
      pointerTouchObserved: (window as any).__pointerTouchObserved,
    }));
    expect(touchProbe.touchObserved).toBeGreaterThan(0);
    expect(touchProbe.pointerTouchObserved).toBeGreaterThan(0);

    // 启动录制
    const popup = await openActionPopup(targetPage);
    await popup.waitForSelector('[data-testid="record-panel"]');
    const targetTabId = await popup.evaluate<number | undefined>(
      "(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id)()"
    );
    expect(targetTabId).toBeTruthy();
    await popup.click('[data-testid="start-recording-btn"]');
    await popup.dispose();

    const session = await mediaProbe.waitForSession(targetTabId!);
    await mediaProbe.waitForActive(session.id, targetTabId!);

    const widget = targetPage.locator("#__wbr_recording_widget__");
    await expect(widget).toBeVisible({ timeout: 5_000 });
    await expect(widget).toHaveAttribute("data-wbr-mobile-mode", "true");

    // 引导气泡（若出现）：移动态紧凑、在视口内、不压底部 76px 保护区
    const bubble = targetPage.locator("#__wbr_widget_bubble__");
    if ((await bubble.count()) > 0) {
      const bubbleBox = await assertLocatorInsideViewport(
        bubble,
        375,
        667,
        "widget-bubble"
      );
      expect(bubbleBox.width).toBeLessThanOrEqual(240.5);
      expect(bubbleBox.y + bubbleBox.height).toBeLessThanOrEqual(
        667 - 76 + 0.5
      );
      await tapLocator(cdp, bubble.locator(".__wbr_bubble_got_it__"));
      await expect(bubble).toBeHidden({ timeout: 2_000 });
    }

    // 默认态：右缘贴边胶囊，不自动折叠，底部 76px 保护区 0 遮挡，PC 折叠按钮不可见
    const pillBox = await assertLocatorInsideViewport(
      widget,
      375,
      667,
      "mobile pill"
    );
    expect(pillBox.height).toBeLessThanOrEqual(34);
    expect(pillBox.width).toBeLessThanOrEqual(90);
    expect(pillBox.x + pillBox.width).toBeGreaterThanOrEqual(375 - 0.5);
    expect(pillBox.y + pillBox.height).toBeLessThanOrEqual(667 - 76 + 0.5);
    expect(pillBox.y).toBeGreaterThanOrEqual(56 - 0.5);
    await expect(widget).toHaveAttribute("data-wbr-edge", "right");
    await expect(
      targetPage.locator("#__wbr_collapse_toggle_btn__")
    ).toBeHidden();
    await expect(targetPage.locator("#__wbr_issue_btn__")).toBeHidden();

    // 轻点胶囊 -> 侧边轻量紧凑菜单（方案 A）：宽 148~168、高 125~145、内侧贴边、不越界、不压底部 76px、4 项 24~26px 轻量操作项
    await tapLocator(cdp, widget);
    const menu = targetPage.locator("#__wbr_mobile_menu__");
    await expect(menu).toBeVisible({ timeout: 2_000 });
    const menuBox = await assertLocatorInsideViewport(
      menu,
      375,
      667,
      "mobile menu"
    );
    expect(menuBox.width).toBeGreaterThanOrEqual(147.5);
    expect(menuBox.width).toBeLessThanOrEqual(168);
    expect(menuBox.height).toBeGreaterThanOrEqual(130);
    expect(menuBox.height).toBeLessThanOrEqual(165);
    expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(667 - 76 + 0.5);
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(pillBox.x - 5);
    const expectedShortcut = process.platform === "darwin" ? "⌥S" : "Alt+S";
    await expect(targetPage.locator("#__wbr_mobile_issue_btn__")).toContainText(
      expectedShortcut
    );
    for (const id of [
      "#__wbr_mobile_issue_btn__",
      "#__wbr_mobile_ticket_btn__",
      "#__wbr_mobile_stop_btn__",
      "#__wbr_mobile_discard_btn__",
    ]) {
      const b = await assertLocatorInsideViewport(
        targetPage.locator(id),
        375,
        667,
        `menu ${id}`
      );
      expect(b.height).toBeGreaterThanOrEqual(23);
      expect(b.height).toBeLessThanOrEqual(27);
    }

    // 菜单内一键换边：右 -> 左，菜单仍在视口内且不压底部保护区
    await tapLocator(cdp, targetPage.locator("#__wbr_mobile_dock_btn__"));
    await expect(widget).toHaveAttribute("data-wbr-edge", "left");
    const leftPillBox = await assertLocatorInsideViewport(
      widget,
      375,
      667,
      "left-docked pill"
    );
    expect(leftPillBox.x).toBeLessThanOrEqual(0.5);
    const leftMenuBox = await assertLocatorInsideViewport(
      menu,
      375,
      667,
      "left-docked menu"
    );
    expect(leftMenuBox.x).toBeGreaterThanOrEqual(
      leftPillBox.x + leftPillBox.width + 5
    );

    // Esc 收起菜单（Light Dismiss）
    await targetPage.keyboard.press("Escape");
    await expect(menu).toBeHidden({ timeout: 2_000 });

    // 全胶囊拖拽：>=6px 进入拖拽，松手磁吸最近边缘
    const beforeDrag = await widget.boundingBox();
    expect(beforeDrag).toBeTruthy();
    await touchDrag(
      cdp,
      beforeDrag!.x + beforeDrag!.width / 2,
      beforeDrag!.y + beforeDrag!.height / 2,
      330,
      beforeDrag!.y - 120,
      8
    );
    await delay(300);
    await expect(widget).toHaveAttribute("data-wbr-edge", "right");
    const afterDragRight = await assertLocatorInsideViewport(
      widget,
      375,
      667,
      "dragged pill (right)"
    );
    expect(afterDragRight.x + afterDragRight.width).toBeGreaterThanOrEqual(
      375 - 0.5
    );
    expect(Math.abs(afterDragRight.y - beforeDrag!.y)).toBeGreaterThan(20);
    await expect(menu).toBeHidden();
    await touchDrag(
      cdp,
      afterDragRight.x + afterDragRight.width / 2,
      afterDragRight.y + afterDragRight.height / 2,
      50,
      afterDragRight.y + 20,
      8
    );
    await delay(300);
    await expect(widget).toHaveAttribute("data-wbr-edge", "left");

    // 横屏 667x375：仍为贴边胶囊，不越界，不压底部保护区
    await enableMobileEmulation(cdp, 667, 375, 3);
    await delay(300);
    await expect(widget).toHaveAttribute("data-wbr-mobile-mode", "true");
    const landscapeBox = await assertLocatorInsideViewport(
      widget,
      667,
      375,
      "landscape pill"
    );
    expect(landscapeBox.y + landscapeBox.height).toBeLessThanOrEqual(
      375 - 76 + 0.5
    );

    // 切回竖屏
    await enableMobileEmulation(cdp, 375, 667, 3);
    await delay(250);
    await assertLocatorInsideViewport(widget, 375, 667, "portrait restored");

    // 极限窄屏 320x568：胶囊不折行不越界；展开菜单后仍在视口内
    await enableMobileEmulation(cdp, 320, 568, 2);
    await delay(300);
    const narrowBox = await assertLocatorInsideViewport(
      widget,
      320,
      568,
      "narrow pill"
    );
    expect(narrowBox.height).toBeLessThanOrEqual(34);
    expect(narrowBox.y + narrowBox.height).toBeLessThanOrEqual(568 - 76 + 0.5);
    await tapLocator(cdp, widget);
    await assertLocatorInsideViewport(menu, 320, 568, "narrow menu");
    await expect(menu).toBeVisible();

    // 关闭菜单
    await targetPage.keyboard.press("Escape");
    await expect(menu).toBeHidden({ timeout: 2_000 });

    // 切回 PC 桌面端 (1280x800)：彻底清除移动端 inline 贴边坐标，恢复右下角默认定位与 PC 桌面形态
    await cdp.send("Emulation.clearDeviceMetricsOverride");
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
    await cdp.send("Emulation.setEmitTouchEventsForMouse", { enabled: false });
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await delay(500);

    await expect(widget).not.toHaveAttribute("data-wbr-mobile-mode");
    await expect(widget).not.toHaveAttribute("data-wbr-edge");
    await expect(targetPage.locator("#__wbr_mobile_menu__")).toBeHidden();
    await expect(
      targetPage.locator("#__wbr_collapse_toggle_btn__")
    ).toBeHidden();

    // PC 挂件恢复到右下角 (right: 24px, bottom: 24px)
    const pcBox = await widget.boundingBox();
    expect(pcBox).toBeTruthy();
    expect(pcBox!.x + pcBox!.width).toBeGreaterThanOrEqual(1280 - 60);
    expect(pcBox!.y + pcBox!.height).toBeGreaterThanOrEqual(800 - 80);

    // 切回移动仿真模式 (375x667) 继续收尾
    await enableMobileEmulation(cdp, 375, 667, 3);
    await delay(300);
    await expect(widget).toHaveAttribute("data-wbr-mobile-mode", "true");
    await tapLocator(cdp, widget);
    await expect(menu).toBeVisible();

    // 菜单内丢弃（3s 二次确认）清理现场
    const menuDiscard = targetPage.locator("#__wbr_mobile_discard_btn__");
    await tapLocator(cdp, menuDiscard);
    await delay(100);
    await tapLocator(cdp, menuDiscard);
    await expect(widget).toBeHidden({ timeout: 5_000 });
    await cdp.detach().catch(() => undefined);
    logE2e("MOBILE-001 passed");
  });

  test("MOBILE-002: ScreenshotOverlay 在 375x667 触控模拟下左边缘窄选区工具栏不飞出、可矩形批注并按真实缩放比例裁剪导出", async ({
    context,
    serviceWorker,
    serverUrl,
  }) => {
    let page = context.pages()[0];
    if (!page) page = await context.newPage();

    const cdp = await context.newCDPSession(page);
    await enableMobileEmulation(cdp, 375, 667, 3);
    await installResponsiveViewportMeta(page);

    await page.goto(serverUrl);
    await page.bringToFront();
    await page
      .waitForFunction(() => document.hasFocus(), undefined, { timeout: 2_000 })
      .catch(() => undefined);

    const tabId = await serviceWorker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      return tab?.id;
    });
    expect(tabId).toBeTruthy();

    // 1) 验证 DPR=3 真实截屏比例 + 左边缘窄选区与矩形批注导出
    const viewportDataUrl = await captureViewportDataUrl(cdp);
    const pngBase64 = viewportDataUrl.split(",")[1]!;
    const rawDims = parseImageDimensions(
      new Uint8Array(Buffer.from(pngBase64, "base64"))
    );
    expect(rawDims).toBeTruthy();
    expect(rawDims!.width).toBe(375 * 3);
    expect(rawDims!.height).toBe(667 * 3);

    await triggerScreenshotOverlay(serviceWorker, tabId!, viewportDataUrl);
    const host = page.locator("#bug-lens-screenshot-host");
    await expect(host).toBeVisible({ timeout: 5_000 });

    const probeCdp = await context.newCDPSession(page);
    const probe = new MobileShadowProbe(probeCdp, cdp);
    await probe.init();

    // 初始全屏预选状态：工具栏和全部按钮必须在 [0, 375] x [0, 667] 内
    const initialToolbar = await probe.getRect("div.toolbar");
    assertInsideViewport(initialToolbar, 375, 667, "initial toolbar");
    const initialButtons = await probe.getToolbarButtonRects();
    expect(initialButtons.length).toBeGreaterThanOrEqual(10);
    for (const [idx, btnRect] of initialButtons.entries()) {
      assertInsideViewport(btnRect, 375, 667, `initial toolbar btn #${idx}`);
    }

    // 触控/指针在左边缘拉取窄选区 (x: 10..90, y: 120..260, 宽 80px)
    await touchDrag(cdp, 10, 120, 90, 260, 8);
    await delay(150);

    const selBox = await probe.getRect("div.selection-box");
    expect(selBox).toBeTruthy();
    expect(selBox!.x).toBeLessThanOrEqual(15);
    expect(selBox!.width).toBeGreaterThanOrEqual(75);
    expect(selBox!.width).toBeLessThanOrEqual(90);

    // 释手后放大镜必须隐藏（避免盖住工具栏）
    expect(
      await probe.getRect("div.magnifier-box"),
      "magnifier hidden after release"
    ).toBeNull();

    // 核心断言：窄选区靠左时，工具栏左右边界必须全部位于 [0, 375] 内未飞出左屏外
    const narrowToolbar = await probe.getRect("div.toolbar");
    assertInsideViewport(
      narrowToolbar,
      375,
      667,
      "left-edge narrow selection toolbar"
    );
    const narrowButtons = await probe.getToolbarButtonRects();
    expect(narrowButtons.length).toBe(initialButtons.length);
    for (const [idx, btnRect] of narrowButtons.entries()) {
      assertInsideViewport(
        btnRect,
        375,
        667,
        `narrow selection toolbar btn #${idx}`
      );
    }

    // 在窄选区内切换到 rect 工具并绘制矩形批注
    const f0 = await probe.canvasFingerprint();
    expect(f0).toBeTruthy();
    await probe.click('button[data-tool="rect"]');
    await touchDrag(cdp, 20, 140, 80, 230, 6);
    await delay(100);
    const f1 = await probe.canvasFingerprint();
    expect(f1).not.toBe(f0);

    // 确认导出并校验 ZIP 中 screenshot.jpg 真实尺寸（80px * 3 DPR = 240px）
    const downloadPromise = page.waitForEvent("download");
    await probe.click('button[data-action="confirm"]');
    await expect(host).toBeHidden({ timeout: 5_000 });

    const toast = page.locator("#__wbr_screenshot_toast__");
    await expect(toast).toBeAttached({ timeout: 5_000 });
    const toastBox = await toast.boundingBox();
    assertInsideViewport(toastBox, 375, 667, "screenshot toast");

    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    const unzipped = unzipSync(new Uint8Array(fs.readFileSync(downloadPath!)));
    const shotBytes = unzipped["screenshot.jpg"];
    expect(shotBytes).toBeDefined();
    const shotDims = parseImageDimensions(shotBytes!);
    expect(shotDims).toBeTruthy();
    // .selection-box 默认 content-box 且带 2px 边框，实际选区逻辑宽为 selBox.width - 4
    const logicalSelWidth = Math.max(1, selBox!.width - 4);
    expect(
      Math.abs(shotDims!.width - Math.round(logicalSelWidth * 3))
    ).toBeLessThanOrEqual(3);

    // 2) 验证 DPR=3 模拟下传入 2x 宿主截图 (750x1334) 时，按 imgWidth / vpWidth = 2 正确裁剪
    // 重新加载页面避免同一页面短时间连续两次 <a download> 触发浏览器多文件下载拦截
    await page.goto(serverUrl);
    await page.bringToFront();
    const mismatch2xDataUrl = await createSolidPngDataUrl(page, 750, 1334);
    await triggerScreenshotOverlay(serviceWorker, tabId!, mismatch2xDataUrl);
    await expect(host).toBeVisible({ timeout: 5_000 });

    await touchDrag(cdp, 10, 120, 90, 260, 8);
    await delay(120);

    // 拖动 SE 手柄到底边：放大镜不溢底、不采样自身宿主；移回原位释手后放大镜隐藏
    const seHandle = await probe.getRect('div[data-handle="se"]');
    expect(seHandle).toBeTruthy();
    const seX = Math.round(seHandle!.x + seHandle!.width / 2);
    const seY = Math.round(seHandle!.y + seHandle!.height / 2);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: seX, y: seY, id: 0 }],
    });
    await delay(30);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: seX, y: 640, id: 0 }],
    });
    await delay(120);
    const magBottom = await probe.getRect("div.magnifier-box");
    expect(magBottom, "magnifier visible while dragging handle").toBeTruthy();
    expect(magBottom!.y + magBottom!.height).toBeLessThanOrEqual(667 + 0.5);
    expect(magBottom!.x + magBottom!.width).toBeLessThanOrEqual(375 + 0.5);
    expect(magBottom!.y).toBeGreaterThanOrEqual(-0.5);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: seX, y: seY, id: 0 }],
    });
    await delay(80);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await delay(150);
    expect(
      await probe.getRect("div.magnifier-box"),
      "magnifier hidden after handle release"
    ).toBeNull();

    const mismatchDownloadPromise = page.waitForEvent("download");
    await probe.click('button[data-action="confirm"]');
    await expect(host).toBeHidden({ timeout: 5_000 });

    const mismatchDownload = await mismatchDownloadPromise;
    const mismatchPath = await mismatchDownload.path();
    const mismatchZip = unzipSync(
      new Uint8Array(fs.readFileSync(mismatchPath!))
    );
    const mismatchDims = parseImageDimensions(mismatchZip["screenshot.jpg"]!);
    expect(mismatchDims).toBeTruthy();
    // 80px 选区在 750x1334 (2x) 位图上应导出 ~160px 宽，而非错误按 DPR=3 乘出 240px
    expect(mismatchDims!.width).toBeGreaterThanOrEqual(156);
    expect(mismatchDims!.width).toBeLessThanOrEqual(166);
    expect(mismatchDims!.height).toBeGreaterThanOrEqual(276);
    expect(mismatchDims!.height).toBeLessThanOrEqual(286);

    await probeCdp.detach().catch(() => undefined);
    await cdp.detach().catch(() => undefined);
    logE2e("MOBILE-002 passed");
  });

  test("MOBILE-003: 375x667 移动端模拟下 SelectionOverlay 提示条与 IssueEditor 工具栏/控制卡片不越界且可保存问题现场", async ({
    context,
    openActionPopup,
    mediaProbe,
    serverUrl,
  }) => {
    const issuePageUrl = serverUrl.replace("mock-page.html", "issue-page.html");
    let targetPage = context.pages()[0];
    if (!targetPage) targetPage = await context.newPage();

    const cdp = await context.newCDPSession(targetPage);
    await enableMobileEmulation(cdp, 375, 667, 3);
    await installResponsiveViewportMeta(targetPage);

    await targetPage.goto(issuePageUrl);
    await targetPage.bringToFront();
    await targetPage
      .waitForFunction(() => document.hasFocus(), undefined, { timeout: 2_000 })
      .catch(() => undefined);

    const popup = await openActionPopup(targetPage);
    await popup.waitForSelector('[data-testid="record-panel"]');
    const targetTabId = await popup.evaluate<number | undefined>(
      "(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id)()"
    );
    expect(targetTabId).toBeTruthy();
    await popup.click('[data-testid="start-recording-btn"]');
    await popup.dispose();

    const session = await mediaProbe.waitForSession(targetTabId!);
    await mediaProbe.waitForActive(session.id, targetTabId!);

    const bubble = targetPage.locator("#__wbr_widget_bubble__");
    if ((await bubble.count()) > 0) {
      await tapLocator(cdp, bubble.locator(".__wbr_bubble_got_it__"));
      await expect(bubble).toBeHidden({ timeout: 2_000 });
    }

    // 页面注入长占位以便验证选择遮罩下的滚动放行
    await targetPage.evaluate(() => {
      const spacer = document.createElement("div");
      spacer.setAttribute("data-e2e-spacer", "true");
      spacer.style.cssText = "height:3000px;width:1px;";
      document.body.appendChild(spacer);
    });

    const widget = targetPage.locator("#__wbr_recording_widget__");
    await expect(widget).toBeVisible({ timeout: 5_000 });
    await expect(widget).toHaveAttribute("data-wbr-mobile-mode", "true");
    await tapLocator(cdp, widget);
    const issueBtn = targetPage.locator("#__wbr_mobile_issue_btn__");
    await expect(issueBtn).toBeVisible({ timeout: 3_000 });
    await tapLocator(cdp, issueBtn);

    // 进入子流程：录制胶囊与菜单必须隐身，不占底部
    await expect(widget).toBeHidden({ timeout: 2_000 });
    await expect(targetPage.locator("#__wbr_mobile_menu__")).toBeHidden();

    // 1) 期望速记卡在 375x667 内
    const expectedCard = targetPage.locator("#__wbr_expected_card__");
    await assertLocatorInsideViewport(expectedCard, 375, 667, "expected card");
    const expectedInput = expectedCard.locator("[data-expected-input]");
    await assertLocatorInsideViewport(
      expectedInput,
      375,
      667,
      "expected card input"
    );
    const expectedText = "移动端应显示提交成功提示";
    await expectedInput.fill(expectedText);
    const expectedConfirm = expectedCard.locator("[data-expected-confirm]");
    await assertLocatorInsideViewport(
      expectedConfirm,
      375,
      667,
      "expected card confirm"
    );
    await tapLocator(cdp, expectedConfirm);
    await expect(expectedCard).toBeHidden();

    // 2) SelectionOverlay 提示条与内部操作按钮在 375x667 内不溢出
    const selectionOverlay = targetPage.locator("#__wbr_issue_selection__");
    await expect(selectionOverlay).toBeVisible({ timeout: 3_000 });

    const hintRects = await targetPage.evaluate(() => {
      const host = document.querySelector("#__wbr_issue_selection__");
      const shadow = host?.shadowRoot;
      if (!shadow) return null;
      const hint = Array.from(shadow.children).find(
        (el) => el.querySelectorAll("button").length >= 3
      ) as HTMLElement | undefined;
      if (!hint) return null;
      const hr = hint.getBoundingClientRect();
      const buttons = Array.from(hint.querySelectorAll("button")).map((b) => {
        const br = b.getBoundingClientRect();
        return {
          text: b.textContent ?? "",
          x: br.left,
          y: br.top,
          width: br.width,
          height: br.height,
        };
      });
      return {
        hint: { x: hr.left, y: hr.top, width: hr.width, height: hr.height },
        buttons,
      };
    });
    expect(hintRects).toBeTruthy();
    assertInsideViewport(hintRects!.hint, 375, 667, "SelectionOverlay hint");
    for (const btn of hintRects!.buttons) {
      assertInsideViewport(btn, 375, 667, `SelectionOverlay btn ${btn.text}`);
    }
    // 移动态默认贴底（释放顶部导航区），单行紧凑
    expect(hintRects!.hint.y).toBeGreaterThan(667 / 2);
    expect(hintRects!.hint.y + hintRects!.hint.height).toBeGreaterThanOrEqual(
      667 - 20
    );
    expect(hintRects!.hint.height).toBeLessThanOrEqual(48);
    await expect(widget).toBeHidden();

    // 滚轮放行：选择遮罩期间仍可用滚轮滚动页面
    const scrollBefore = await targetPage.evaluate(() => window.scrollY);
    await targetPage.mouse.move(180, 200);
    await targetPage.mouse.wheel(0, 300);
    await delay(300);
    const scrollAfterWheel = await targetPage.evaluate(() => window.scrollY);
    expect(scrollAfterWheel).toBeGreaterThan(scrollBefore);
    await targetPage.evaluate(() => window.scrollTo(0, 0));
    await delay(150);

    // 一键换位 ⇅：贴底 -> 贴顶 -> 贴底
    const flipPos = async () =>
      targetPage.evaluate(() => {
        const host = document.querySelector("#__wbr_issue_selection__");
        const flip = Array.from(
          host!.shadowRoot!.querySelectorAll("button")
        ).find((b) => b.textContent?.trim() === "⇅");
        const hint = flip?.closest("div")?.parentElement as HTMLElement | null;
        const fr = flip?.getBoundingClientRect();
        return {
          flipX: fr ? fr.left + fr.width / 2 : 0,
          flipY: fr ? fr.top + fr.height / 2 : 0,
          hintTop: hint ? hint.getBoundingClientRect().top : -1,
        };
      });
    const flip1 = await flipPos();
    expect(flip1.hintTop).toBeGreaterThan(667 / 2);
    await touchTap(cdp, flip1.flipX, flip1.flipY);
    await delay(250);
    const flip2 = await flipPos();
    expect(flip2.hintTop).toBeLessThan(60);
    await touchTap(cdp, flip2.flipX, flip2.flipY);
    await delay(250);
    expect((await flipPos()).hintTop).toBeGreaterThan(667 / 2);

    // 触控点击目标元素（无 hover 提前预览）
    const targetEl = targetPage.locator('[data-testid="issue-target"]');
    await targetEl.scrollIntoViewIfNeeded();
    const targetBox = await targetEl.boundingBox();
    expect(targetBox).toBeTruthy();
    await touchTap(
      cdp,
      targetBox!.x + targetBox!.width / 2,
      targetBox!.y + targetBox!.height / 2
    );

    await targetPage.waitForFunction(
      () => {
        const selection = document.querySelector("#__wbr_issue_selection__");
        const finishBtn = Array.from(
          selection?.shadowRoot?.querySelectorAll("button") ?? []
        ).find((b) => b.textContent?.includes("(1)"));
        return Boolean(finishBtn);
      },
      undefined,
      { timeout: 3_000 }
    );
    expect(
      Number(
        await targetPage
          .locator('[data-testid="issue-target-click-count"]')
          .textContent()
      )
    ).toBe(0);

    // 选区联动滚屏：高亮框位置随页面滚动同步，滚出视口外设为 display: none，滚回恢复 display: block
    const getSelectedBoxDisplay = async () =>
      targetPage.evaluate(() => {
        const host = document.querySelector("#__wbr_issue_selection__");
        const removeBtn = host?.shadowRoot?.querySelector(
          ".wbr-selection-remove-btn"
        );
        const box = removeBtn?.parentElement as HTMLElement | null;
        return box ? box.style.display : null;
      });
    expect(await getSelectedBoxDisplay()).not.toBe("none");

    // 向上滚动页面使已选目标完全移出视口顶部
    await targetPage.mouse.move(180, 200);
    await targetPage.mouse.wheel(0, 600);
    await delay(300);
    expect(await getSelectedBoxDisplay()).toBe("none");

    // 滚回原位，高亮框自动恢复显示
    await targetPage.evaluate(() => window.scrollTo(0, 0));
    await delay(300);
    expect(await getSelectedBoxDisplay()).toBe("block");

    // 点击进入截图编辑器
    const finishBtn = selectionOverlay.locator("button", {
      hasText: "(1)",
    });
    await tapLocator(cdp, finishBtn);

    // 3) IssueEditor 在 375x667 下的工具栏、控制卡片、输入框与按钮全在 [0, 375] 内
    const issueEditor = targetPage.locator("#__wbr_issue_editor__");
    await expect(issueEditor).toBeVisible({ timeout: 5_000 });
    const issueImage = issueEditor.locator("[data-issue-image]");
    await expect(issueImage).toBeVisible();

    // 严密断言：底图宽高比必须紧密贴合移动端视口 (375/667 ≈ 0.562)，根绝 16:9 带空白横图
    await targetPage.waitForFunction(() => {
      const img = document.querySelector(
        "#__wbr_issue_editor__ [data-issue-image]"
      ) as HTMLImageElement | null;
      return Boolean(
        img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0
      );
    });
    const imageNaturalMetrics = await targetPage.evaluate(() => {
      const img = document.querySelector(
        "#__wbr_issue_editor__ [data-issue-image]"
      ) as HTMLImageElement;
      return {
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        aspectRatio: img.naturalWidth / img.naturalHeight,
      };
    });
    const expectedRatio = 375 / 667;
    expect(
      Math.abs(imageNaturalMetrics.aspectRatio - expectedRatio),
      `image natural aspect ratio (${imageNaturalMetrics.aspectRatio}) should match viewport ratio (${expectedRatio})`
    ).toBeLessThan(0.08);

    // 严密断言：[data-issue-canvas]、[data-issue-image] 与 [data-issue-svg] 渲染宽高紧密贴合（差值 <= 3px），消除上下黑边与标注层漂移
    const renderBoxes = await targetPage.evaluate(() => {
      const canvas = document.querySelector(
        "#__wbr_issue_editor__ [data-issue-canvas]"
      )!;
      const img = document.querySelector(
        "#__wbr_issue_editor__ [data-issue-image]"
      )!;
      const svg = document.querySelector(
        "#__wbr_issue_editor__ [data-issue-svg]"
      )!;
      const cr = canvas.getBoundingClientRect();
      const ir = img.getBoundingClientRect();
      const sr = svg.getBoundingClientRect();
      return {
        canvas: { width: cr.width, height: cr.height },
        image: { width: ir.width, height: ir.height },
        svg: { width: sr.width, height: sr.height },
      };
    });
    expect(
      Math.abs(renderBoxes.canvas.width - renderBoxes.image.width)
    ).toBeLessThanOrEqual(3);
    expect(
      Math.abs(renderBoxes.canvas.height - renderBoxes.image.height)
    ).toBeLessThanOrEqual(3);
    expect(
      Math.abs(renderBoxes.svg.width - renderBoxes.image.width)
    ).toBeLessThanOrEqual(3);
    expect(
      Math.abs(renderBoxes.svg.height - renderBoxes.image.height)
    ).toBeLessThanOrEqual(3);

    const toolbar = issueEditor.locator(".toolbar");
    await assertLocatorInsideViewport(toolbar, 375, 667, "IssueEditor toolbar");
    const toolbarBtns = toolbar.locator("button");
    const toolbarBtnCount = await toolbarBtns.count();
    expect(toolbarBtnCount).toBeGreaterThanOrEqual(8);
    for (let i = 0; i < toolbarBtnCount; i++) {
      await assertLocatorInsideViewport(
        toolbarBtns.nth(i),
        375,
        667,
        `IssueEditor toolbar btn #${i}`
      );
    }

    const controlCard = issueEditor.locator("[data-issue-control-card]");
    const controlCardBox = await assertLocatorInsideViewport(
      controlCard,
      375,
      667,
      "IssueEditor control card"
    );
    // 三段式：控制卡与截图画布重叠面积 = 0，且贴底；编辑器期间无录制胶囊
    const canvasBox = await issueEditor
      .locator("[data-issue-canvas]")
      .boundingBox();
    expect(canvasBox).toBeTruthy();
    const overlapW = Math.max(
      0,
      Math.min(
        canvasBox!.x + canvasBox!.width,
        controlCardBox.x + controlCardBox.width
      ) - Math.max(canvasBox!.x, controlCardBox.x)
    );
    const overlapH = Math.max(
      0,
      Math.min(
        canvasBox!.y + canvasBox!.height,
        controlCardBox.y + controlCardBox.height
      ) - Math.max(canvasBox!.y, controlCardBox.y)
    );
    expect(overlapW * overlapH, "card/canvas overlap px²").toBe(0);
    expect(controlCardBox.y + controlCardBox.height).toBeGreaterThanOrEqual(
      667 - 16
    );
    await expect(widget).toBeHidden();

    const actualInput = issueEditor.locator("[data-issue-actual]");
    const actualBox = await assertLocatorInsideViewport(
      actualInput,
      375,
      667,
      "IssueEditor actual input"
    );
    // 确保输入框在窄屏下未被动作按钮挤成极窄条
    expect(actualBox.width).toBeGreaterThanOrEqual(140);

    await assertLocatorInsideViewport(
      issueEditor.locator("[data-issue-save]"),
      375,
      667,
      "IssueEditor save btn"
    );
    await assertLocatorInsideViewport(
      issueEditor.locator("[data-issue-save-stop]"),
      375,
      667,
      "IssueEditor save-stop btn"
    );

    // 横屏切换下校验 IssueEditor 控制卡片与工具栏重钳制不跑出屏幕
    await enableMobileEmulation(cdp, 667, 375, 3);
    await delay(200);
    await assertLocatorInsideViewport(
      toolbar,
      667,
      375,
      "IssueEditor toolbar landscape"
    );
    await assertLocatorInsideViewport(
      controlCard,
      667,
      375,
      "IssueEditor control card landscape"
    );
    await enableMobileEmulation(cdp, 375, 667, 3);
    await delay(200);
    await assertLocatorInsideViewport(
      controlCard,
      375,
      667,
      "IssueEditor control card portrait restored"
    );

    // 文本批注：靠右边缘点击，输入框不得向右溢出视口
    await tapLocator(cdp, issueEditor.locator('[data-issue-tool="text"]'));
    const svgForText = await issueEditor
      .locator("[data-issue-svg]")
      .boundingBox();
    expect(svgForText).toBeTruthy();
    await touchTap(
      cdp,
      svgForText!.x + svgForText!.width - 6,
      svgForText!.y + svgForText!.height * 0.3
    );
    await delay(250);
    const textInputBox = await targetPage.evaluate(() => {
      const ed = document.querySelector("#__wbr_issue_editor__");
      const inputs = Array.from(ed!.querySelectorAll("input")).filter(
        (i) => !i.hasAttribute("data-issue-actual")
      );
      const ti = inputs[inputs.length - 1];
      if (!ti) return null;
      const r = ti.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    });
    expect(textInputBox, "text annotation input").toBeTruthy();
    assertInsideViewport(textInputBox, 375, 667, "text annotation input");
    await targetPage.keyboard.press("Escape");
    await delay(150);

    // 绘制矩形批注、填写实际现象并保存问题现场
    await tapLocator(cdp, issueEditor.locator('[data-issue-tool="rect"]'));
    const svgLocator = issueEditor.locator("[data-issue-svg]");
    const svgBox = await svgLocator.boundingBox();
    expect(svgBox).toBeTruthy();
    await touchDrag(
      cdp,
      svgBox!.x + svgBox!.width * 0.2,
      svgBox!.y + svgBox!.height * 0.2,
      svgBox!.x + svgBox!.width * 0.6,
      svgBox!.y + svgBox!.height * 0.6,
      5
    );

    const actualText = "窄屏点击后按钮无反应";
    await actualInput.fill(actualText);
    await tapLocator(cdp, issueEditor.locator("[data-issue-save]"));

    await expect(issueEditor).toBeHidden({ timeout: 5_000 });
    await expect(selectionOverlay).toBeHidden({ timeout: 5_000 });
    // 子流程结束：录制胶囊恢复
    await expect(widget).toBeVisible({ timeout: 3_000 });

    await mediaProbe.waitForEvidenceCounts(session.id, { issueSceneCount: 1 });
    const evidence = await mediaProbe.persistedFullEvidence(session.id);
    expect(evidence.issueScenes.length).toBe(1);
    expect(evidence.issueScenes[0]!.status).toBe("complete");
    expect(evidence.issueScenes[0]!.narrative?.actual).toBe(actualText);
    expect(evidence.issueScenes[0]!.narrative?.expected?.text).toBe(
      expectedText
    );
    expect(evidence.issueScenes[0]!.annotation?.userAnnotations?.length).toBe(
      1
    );

    // 清理录制会话
    await tapLocator(cdp, widget);
    const menuDiscardBtn = targetPage.locator("#__wbr_mobile_discard_btn__");
    await tapLocator(cdp, menuDiscardBtn);
    await delay(100);
    await tapLocator(cdp, menuDiscardBtn);
    await expect(widget).toBeHidden({ timeout: 5_000 });
    await cdp.detach().catch(() => undefined);
    logE2e("MOBILE-003 passed");
  });
});
