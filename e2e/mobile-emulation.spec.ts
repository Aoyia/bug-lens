import { unzipSync } from "fflate";
import fs from "node:fs";
import type {
  BrowserContext,
  CDPSession,
  Locator,
  Page,
  Worker,
} from "@playwright/test";
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
  test("MOBILE-001: RecordingWidget 在 375x667 触控模拟下不自动折叠、按钮全可见、可折叠/拖拽、横屏重钳制及宿主 isMac 识别", async ({
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

    // 若弹出引导气泡，校验其在 375x667 内并关闭后再开始 1600ms 不自动折叠验证
    const bubble = targetPage.locator("#__wbr_widget_bubble__");
    if ((await bubble.count()) > 0) {
      await assertLocatorInsideViewport(bubble, 375, 667, "widget-bubble");
      await tapLocator(cdp, bubble.locator(".__wbr_bubble_got_it__"));
      await expect(bubble).toBeHidden({ timeout: 2_000 });
    }

    // 确认 >1600ms 后仍未自动折叠
    await delay(1750);
    const collapsedAfterWait = await widget.evaluate((el) =>
      el.classList.contains("__wbr_collapsed__")
    );
    expect(collapsedAfterWait).toBe(false);

    // 校验宿主真实平台 isMac 穿透 Android UA 模拟生效
    const expectedShortcut = process.platform === "darwin" ? "⌥S" : "Alt+S";
    await expect(targetPage.locator("#__wbr_issue_btn__")).toContainText(
      expectedShortcut
    );

    // 校验 375x667 下挂件及全体按钮均不越界且无零宽裁切
    const allWidgetIds = [
      "#__wbr_recording_widget__",
      "#__wbr_issue_btn__",
      "#__wbr_ticket_btn__",
      "#__wbr_stop_btn__",
      "#__wbr_discard_btn__",
      "#__wbr_collapse_toggle_btn__",
    ];
    for (const id of allWidgetIds) {
      await assertLocatorInsideViewport(
        targetPage.locator(id),
        375,
        667,
        `375x667 ${id}`
      );
    }

    // 点击折叠开关 -> 折叠胶囊态，仅 stop 与展开开关可见且在视口内
    const toggleBtn = targetPage.locator("#__wbr_collapse_toggle_btn__");
    await tapLocator(cdp, toggleBtn);
    await expect(widget).toHaveClass(/__wbr_collapsed__/);
    await expect(targetPage.locator("#__wbr_issue_btn__")).toBeHidden();
    await assertLocatorInsideViewport(widget, 375, 667, "collapsed widget");
    await assertLocatorInsideViewport(
      targetPage.locator("#__wbr_stop_btn__"),
      375,
      667,
      "collapsed stop btn"
    );
    await assertLocatorInsideViewport(
      toggleBtn,
      375,
      667,
      "collapsed toggle btn"
    );

    // 再次点击折叠开关 -> 恢复完整操作态
    await tapLocator(cdp, toggleBtn);
    await expect(widget).not.toHaveClass(/__wbr_collapsed__/);
    for (const id of allWidgetIds) {
      await assertLocatorInsideViewport(
        targetPage.locator(id),
        375,
        667,
        `expanded ${id}`
      );
    }

    // 触控/Pointer 拖拽移动挂件
    const dragHandle = targetPage.locator(".__wbr_drag_handle");
    const beforeWidgetBox = await widget.boundingBox();
    const handleBox = await dragHandle.boundingBox();
    expect(beforeWidgetBox).toBeTruthy();
    expect(handleBox).toBeTruthy();

    const startX = handleBox!.x + handleBox!.width / 2;
    const startY = handleBox!.y + handleBox!.height / 2;
    await touchDrag(
      cdp,
      startX,
      startY,
      startX - 40,
      Math.max(40, startY - 180),
      8
    );
    await delay(150);

    const afterDragBox = await widget.boundingBox();
    assertInsideViewport(afterDragBox, 375, 667, "dragged widget 375x667");
    expect(Math.abs(afterDragBox!.y - beforeWidgetBox!.y)).toBeGreaterThan(20);

    // 切换横屏 667x375 并校验重钳制不越界
    await enableMobileEmulation(cdp, 667, 375, 3);
    await delay(250);
    for (const id of allWidgetIds) {
      await assertLocatorInsideViewport(
        targetPage.locator(id),
        667,
        375,
        `landscape 667x375 ${id}`
      );
    }

    // 切回竖屏 375x667 再次确认不越界
    await enableMobileEmulation(cdp, 375, 667, 3);
    await delay(200);
    await assertLocatorInsideViewport(widget, 375, 667, "portrait restored");

    // 极限窄屏 320x568 校验挂件与全体按钮仍不越界
    await enableMobileEmulation(cdp, 320, 568, 2);
    await delay(250);
    for (const id of allWidgetIds) {
      await assertLocatorInsideViewport(
        targetPage.locator(id),
        320,
        568,
        `narrow 320x568 ${id}`
      );
    }

    // 放弃录制清理现场
    const discardBtn = targetPage.locator("#__wbr_discard_btn__");
    await tapLocator(cdp, discardBtn);
    await delay(100);
    await tapLocator(cdp, discardBtn);
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

    const issueBtn = targetPage.locator("#__wbr_issue_btn__");
    await expect(issueBtn).toBeVisible({ timeout: 5_000 });
    await tapLocator(cdp, issueBtn);

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
        (el) => el.querySelectorAll("button").length === 3
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
        const finishBtn = selection?.shadowRoot?.querySelector("button");
        return Boolean(finishBtn?.textContent?.includes("(1)"));
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

    // 点击进入截图编辑器
    const finishBtn = selectionOverlay.locator("button", {
      hasText: "(1)",
    });
    await tapLocator(cdp, finishBtn);

    // 3) IssueEditor 在 375x667 下的工具栏、控制卡片、输入框与按钮全在 [0, 375] 内
    const issueEditor = targetPage.locator("#__wbr_issue_editor__");
    await expect(issueEditor).toBeVisible({ timeout: 5_000 });
    await expect(issueEditor.locator("[data-issue-image]")).toBeVisible();

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
    await assertLocatorInsideViewport(
      controlCard,
      375,
      667,
      "IssueEditor control card"
    );

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
    await expect(issueBtn).toBeVisible();

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
    const discardBtn = targetPage.locator("#__wbr_discard_btn__");
    await tapLocator(cdp, discardBtn);
    await delay(100);
    await tapLocator(cdp, discardBtn);
    await expect(targetPage.locator("#__wbr_recording_widget__")).toBeHidden({
      timeout: 5_000,
    });
    await cdp.detach().catch(() => undefined);
    logE2e("MOBILE-003 passed");
  });
});
