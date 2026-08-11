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
 * triggerScreenshotInTab 的链路；--e2e 构建已预授权 http/https host 权限）。
 * viewportDataUrl 由 Playwright CDP 截取，规避 captureVisibleTab 对
 * <all_urls>/activeTab 权限的要求。
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

/**
 * 截图 overlay 使用 closed shadow DOM，页面侧 JS 无法穿透。ShadowProbe 通过
 * CDP 的 DOM/Runtime 域读取 closed shadow 内部状态（画布指纹、工具栏按钮、
 * 文本输入框），并用真实坐标驱动 Playwright 鼠标点击内部按钮。
 */
class ShadowProbe {
  constructor(
    private readonly cdp: import("@playwright/test").CDPSession,
    private readonly page: import("@playwright/test").Page
  ) {}

  async init(): Promise<void> {
    await this.cdp.send("DOM.enable");
    await this.cdp.send("Runtime.enable");
  }

  /** 解析简单选择器：tag / .class / [attr="value"] 的组合 */
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

  /**
   * 通过 DOM.getDocument(depth:-1, pierce:true) 遍历完整 DOM 树（含 closed
   * shadow roots），返回所有匹配元素的 nodeId。
   */
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

  private async resolveObjectId(selector: string): Promise<string | null> {
    const ids = await this.findAllNodeIds(selector);
    if (!ids.length) return null;
    const node = (await this.cdp.send("DOM.resolveNode", {
      nodeId: ids[0],
    })) as { object: { objectId: string } };
    return node.object.objectId;
  }

  private async callOn<T>(selector: string, fn: string): Promise<T | null> {
    const objectId = await this.resolveObjectId(selector);
    if (!objectId) return null;
    const result = (await this.cdp.send("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration: fn,
      returnByValue: true,
    })) as { result: { value?: T } };
    return result.result.value ?? null;
  }

  /** 读取批注画布 dataURL 指纹（批注增删/移动会改变内容） */
  canvasFingerprint(): Promise<string | null> {
    return this.callOn<string>(
      "canvas.canvas-layer",
      "function () { try { return this.toDataURL(); } catch (e) { return String(e); } }"
    );
  }

  /** 工具栏工具按钮是否处于激活态 */
  async toolActive(tool: string): Promise<boolean> {
    const v = await this.callOn<boolean>(
      `button[data-tool="${tool}"]`,
      "function () { return this.classList.contains('active'); }"
    );
    return v === true;
  }

  /** 元素在页面（视口）坐标系中的中心点 */
  async elementCenter(
    selector: string
  ): Promise<{ x: number; y: number } | null> {
    const r = await this.callOn<{
      left: number;
      top: number;
      width: number;
      height: number;
    }>(
      selector,
      "function () { const r = this.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; }"
    );
    if (!r) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  /** 真实鼠标点击 closed shadow 内元素（工具栏按钮等） */
  async click(selector: string): Promise<void> {
    const c = await this.elementCenter(selector);
    if (!c) throw new Error(`closed-shadow element not found: ${selector}`);
    await this.page.mouse.click(c.x, c.y);
  }

  /** closed shadow 内匹配选择器的元素数量（如文本输入框） */
  async count(selector: string): Promise<number> {
    const ids = await this.findAllNodeIds(selector);
    return ids.length;
  }
}

/** 统一 e2e 准备：加载目标页、安装网页泄漏监听、触发截图 overlay 并等待显示 */
async function setupScreenshotOverlay(
  context: import("@playwright/test").BrowserContext,
  serviceWorker: import("@playwright/test").Worker,
  serverUrl: string,
  monitorTypes: string[] = [
    "mousedown",
    "mousemove",
    "mouseup",
    "click",
    "dblclick",
    "contextmenu",
    "keydown",
    "keyup",
  ]
): Promise<{
  page: import("@playwright/test").Page;
  host: import("@playwright/test").Locator;
  probe: ShadowProbe;
  leakCount: () => Promise<number>;
}> {
  let page = context.pages()[0];
  if (!page) page = await context.newPage();
  await page.goto(serverUrl);
  await page.bringToFront();
  await page.waitForFunction(() => document.hasFocus(), undefined, {
    timeout: 2_000,
  });

  await page.evaluate((types) => {
    const w = window as any;
    w.__bugLensLeakCount = 0;
    w.__bugLensLeakTypes = [] as string[];
    const bump = (e: Event) => {
      w.__bugLensLeakCount += 1;
      w.__bugLensLeakTypes.push(e.type);
    };
    for (const type of types) {
      w.addEventListener(type, bump);
    }
  }, monitorTypes);

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

  const probe = new ShadowProbe(await context.newCDPSession(page), page);
  await probe.init();
  return {
    page,
    host,
    probe,
    leakCount: () => page.evaluate(() => (window as any).__bugLensLeakCount),
  };
}

test.describe("Bug Lens Chrome Extension E2E SCREENSHOT-001: 截图 Overlay 交互与事件隔离", () => {
  test("SCREENSHOT-001: 触发截图 overlay、拉框交互、事件不泄漏给网页、Ctrl+C 确认导出", async ({
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
    context.on("download", (download) => {
      logE2e("Screenshot export download observed (ignored)", {
        url: safeUrlForLog(download.url()),
      });
    });

    let targetPage = context.pages()[0];
    if (!targetPage) targetPage = await context.newPage();
    await targetPage.goto(serverUrl);
    await targetPage.bringToFront();
    await targetPage.waitForFunction(() => document.hasFocus(), undefined, {
      timeout: 2_000,
    });
    logE2e("Target page loaded", { url: safeUrlForLog(targetPage.url()) });

    // 页面注入“泄漏计数”监听器：模拟网页自身的全局事件监听（bubble 阶段）
    await targetPage.evaluate(() => {
      const w = window as any;
      w.__bugLensLeakCount = 0;
      w.__bugLensLeakTypes = [] as string[];
      const bump = (e: Event) => {
        w.__bugLensLeakCount += 1;
        w.__bugLensLeakTypes.push(e.type);
      };
      for (const type of [
        "mousedown",
        "mousemove",
        "mouseup",
        "click",
        "dblclick",
        "contextmenu",
        "keydown",
        "keyup",
      ]) {
        w.addEventListener(type, bump);
      }
    });

    // 获取活动标签页 id 并触发截图 overlay
    const tabId = await serviceWorker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      return tab?.id;
    });
    expect(tabId).toBeTruthy();
    const viewportDataUrl = await captureViewportDataUrl(context, targetPage);
    await triggerScreenshotOverlay(serviceWorker, tabId!, viewportDataUrl);

    const host = targetPage.locator("#bug-lens-screenshot-host");
    await expect(host).toBeVisible({ timeout: 5_000 });
    logE2e("Screenshot overlay appeared", { tabId });

    // 1) 拉框交互：视口内拖拽建立选区
    await targetPage.mouse.move(300, 300);
    await targetPage.mouse.down();
    await targetPage.mouse.move(800, 500, { steps: 8 });
    await targetPage.mouse.up();

    // 2) overlay 上的单击 / 双击 / 右键
    await targetPage.mouse.click(400, 400);
    await targetPage.mouse.dblclick(500, 420);
    await targetPage.mouse.click(600, 440, { button: "right" });

    // 3) 键盘按键（普通字母 / Tab / 方向键——网页常见全局快捷键）
    await targetPage.keyboard.press("a");
    await targetPage.keyboard.press("Tab");
    await targetPage.keyboard.press("ArrowDown");
    await targetPage.keyboard.press("j");

    await delay(300);

    // 4) 核心断言：网页不应收到任何泄漏事件
    const leak = await targetPage.evaluate(
      () => (window as any).__bugLensLeakCount
    );
    const leakTypes = await targetPage.evaluate(
      () => (window as any).__bugLensLeakTypes
    );
    logE2e("Page leak counters", { leak, leakTypes });
    expect(leak).toBe(0);

    // 5) Ctrl+C “确认导出”快捷键已移除：overlay 应保持激活，且事件不泄漏
    await targetPage.keyboard.press(
      process.platform === "darwin" ? "Meta+c" : "Control+c"
    );
    await delay(300);
    await expect(host).toBeVisible({ timeout: 2_000 });
    logE2e("Ctrl+C no longer confirms screenshot; overlay stays active");

    const leakAfter = await targetPage.evaluate(
      () => (window as any).__bugLensLeakCount
    );
    expect(leakAfter).toBe(0);

    // 6) Esc 取消收尾 → overlay 销毁
    await targetPage.keyboard.press("Escape");
    await expect(host).toBeHidden({ timeout: 5_000 });
    logE2e("Overlay closed via Escape");
  });

  test("SCREENSHOT-002: Esc 取消截图，overlay 销毁且事件不外泄", async ({
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

    let targetPage = context.pages()[0];
    if (!targetPage) targetPage = await context.newPage();
    await targetPage.goto(serverUrl);
    await targetPage.bringToFront();
    await targetPage.waitForFunction(() => document.hasFocus(), undefined, {
      timeout: 2_000,
    });

    await targetPage.evaluate(() => {
      const w = window as any;
      w.__bugLensLeakCount = 0;
      const bump = () => {
        w.__bugLensLeakCount += 1;
      };
      for (const type of ["mousedown", "mouseup", "keydown", "contextmenu"]) {
        w.addEventListener(type, bump);
      }
    });

    const tabId = await serviceWorker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      return tab?.id;
    });
    expect(tabId).toBeTruthy();
    const viewportDataUrl = await captureViewportDataUrl(context, targetPage);
    await triggerScreenshotOverlay(serviceWorker, tabId!, viewportDataUrl);

    const host = targetPage.locator("#bug-lens-screenshot-host");
    await expect(host).toBeVisible({ timeout: 5_000 });

    // 在 overlay 上点击 + 按 Esc 取消
    await targetPage.mouse.click(200, 200);
    await targetPage.keyboard.press("Escape");
    await expect(host).toBeHidden({ timeout: 5_000 });
    logE2e("Screenshot cancelled via Escape, overlay closed");

    const leak = await targetPage.evaluate(
      () => (window as any).__bugLensLeakCount
    );
    expect(leak).toBe(0);
  });
});

test.describe("Bug Lens Chrome Extension E2E SCREENSHOT-003: 截图批注（绘制/切换/拖拽/删除/撤销/清空）", () => {
  test("rect/arrow/privacy 批注绘制、工具切换、命中拖拽、Delete 删除、undo、clear", async ({
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

    const { page, host, probe, leakCount } = await setupScreenshotOverlay(
      context,
      serviceWorker,
      serverUrl
    );
    logE2e("Screenshot overlay ready for annotation tests");

    // 拉框建立选区 (300,300)→(800,500)
    await page.mouse.move(300, 300);
    await page.mouse.down();
    await page.mouse.move(800, 500, { steps: 8 });
    await page.mouse.up();

    // 初始画布指纹（含遮罩+选区镂空，无批注）
    const f0 = await probe.canvasFingerprint();
    expect(f0).toBeTruthy();

    // ---- 1) rect 批注 ----
    await probe.click('button[data-tool="rect"]');
    expect(await probe.toolActive("rect")).toBe(true);
    await page.mouse.move(350, 340);
    await page.mouse.down();
    await page.mouse.move(480, 420, { steps: 5 });
    await page.mouse.up();
    const f1 = await probe.canvasFingerprint();
    expect(f1).not.toBe(f0);
    logE2e("rect annotation drawn", { changed: f1 !== f0 });

    // ---- 2) arrow 批注 ----
    await probe.click('button[data-tool="arrow"]');
    expect(await probe.toolActive("arrow")).toBe(true);
    await page.mouse.move(400, 460);
    await page.mouse.down();
    await page.mouse.move(620, 470, { steps: 5 });
    await page.mouse.up();
    const f2 = await probe.canvasFingerprint();
    expect(f2).not.toBe(f1);
    logE2e("arrow annotation drawn");

    // ---- 3) privacy 批注 ----
    await probe.click('button[data-tool="privacy"]');
    expect(await probe.toolActive("privacy")).toBe(true);
    await page.mouse.move(500, 340);
    await page.mouse.down();
    await page.mouse.move(600, 420, { steps: 5 });
    await page.mouse.up();
    const f3 = await probe.canvasFingerprint();
    expect(f3).not.toBe(f2);
    logE2e("privacy annotation drawn");

    // ---- 4) Ctrl+Z 撤销（移除最后一个 privacy）----
    await page.keyboard.press("Control+z");
    await delay(200);
    const f4 = await probe.canvasFingerprint();
    expect(f4).not.toBe(f3);
    logE2e("undo removed last annotation");

    // ---- 5) 命中 rect 批注并拖拽平移 ----
    await page.mouse.move(400, 380);
    await page.mouse.down();
    await page.mouse.move(440, 420, { steps: 5 });
    await page.mouse.up();
    const f5 = await probe.canvasFingerprint();
    expect(f5).not.toBe(f4);
    logE2e("annotation dragged/moved");

    // ---- 6) Delete 删除选中的 rect 批注 ----
    await page.keyboard.press("Delete");
    await delay(200);
    const f6 = await probe.canvasFingerprint();
    expect(f6).not.toBe(f5);
    logE2e("selected annotation deleted via Delete key");

    // ---- 7) clear 一键清空（移除残余 arrow）----
    await probe.click('button[data-action="clear"]');
    await delay(200);
    const f7 = await probe.canvasFingerprint();
    expect(f7).not.toBe(f6);
    logE2e("clear wiped all annotations");

    // ---- 8) 全流程鼠标/键盘事件零泄漏 ----
    expect(await leakCount()).toBe(0);

    await page.keyboard.press("Escape");
    await expect(host).toBeHidden({ timeout: 5_000 });
  });

  test("text 空输入关闭后，切换其他批注工具绘制恢复正常（回归）", async ({
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

    const { page, host, probe, leakCount } = await setupScreenshotOverlay(
      context,
      serviceWorker,
      serverUrl
    );

    // 拉框建立选区 (300,300)→(800,500)
    await page.mouse.move(300, 300);
    await page.mouse.down();
    await page.mouse.move(800, 500, { steps: 8 });
    await page.mouse.up();
    const f0 = await probe.canvasFingerprint();
    expect(f0).toBeTruthy();

    // ---- 1) rect 批注（基线）----
    await probe.click('button[data-tool="rect"]');
    await page.mouse.move(340, 330);
    await page.mouse.down();
    await page.mouse.move(420, 390, { steps: 5 });
    await page.mouse.up();
    const f1 = await probe.canvasFingerprint();
    expect(f1).not.toBe(f0);
    logE2e("baseline rect annotation drawn");

    // ---- 2) text 工具点击创建（空）输入框 ----
    await probe.click('button[data-tool="text"]');
    await page.mouse.click(470, 460);
    await delay(200);
    expect(await probe.count(".inline-text-input")).toBe(1);
    logE2e("empty inline text input spawned");

    // ---- 3) 不输入文字，点击画布空白处关闭输入框（路径1：画布空白 blur）----
    await page.mouse.click(620, 460);
    await delay(200);
    expect(await probe.count(".inline-text-input")).toBe(0);
    logE2e("empty text input dismissed by canvas blank click");

    // ---- 4) 切回 rect 绘制 → 必须正常提交（核心断言：修复前残留 editing-text 阻塞绘制）----
    await probe.click('button[data-tool="rect"]');
    await delay(200);
    expect(await probe.toolActive("rect")).toBe(true);
    await page.mouse.move(450, 330);
    await page.mouse.down();
    await page.mouse.move(560, 400, { steps: 5 });
    await page.mouse.up();
    await delay(200);
    const f2 = await probe.canvasFingerprint();
    expect(f2).not.toBe(f1);
    expect(await probe.count(".inline-text-input")).toBe(0);
    logE2e("rect annotation drawn after canvas-blank dismissal");

    // ---- 5) 再次 text 点击创建空输入框 ----
    await probe.click('button[data-tool="text"]');
    await page.mouse.click(600, 460);
    await delay(200);
    expect(await probe.count(".inline-text-input")).toBe(1);

    // ---- 6) 不输入文字，直接点击 rect 工具按钮（路径2：切换工具关闭）----
    await probe.click('button[data-tool="rect"]');
    await delay(300);
    expect(await probe.count(".inline-text-input")).toBe(0);
    expect(await probe.toolActive("rect")).toBe(true);
    logE2e("empty text input dismissed by switching tool");

    // ---- 7) 继续绘制 rect → 正常提交 ----
    await page.mouse.move(620, 330);
    await page.mouse.down();
    await page.mouse.move(700, 390, { steps: 4 });
    await page.mouse.up();
    await delay(200);
    const f3 = await probe.canvasFingerprint();
    expect(f3).not.toBe(f2);
    expect(await probe.count(".inline-text-input")).toBe(0);
    logE2e("rect annotation drawn after tool-switch dismissal");

    // ---- 8) 全流程零泄漏 + 收尾 ----
    const leakTypes = await page.evaluate(
      () => (window as any).__bugLensLeakTypes
    );
    logE2e("Page leak types before dismiss", {
      count: leakTypes.length,
      leakTypes,
    });
    expect(await leakCount()).toBe(0);
    await page.keyboard.press("Escape");
    await expect(host).toBeHidden({ timeout: 5_000 });
  });

  test("text 编辑态按 Esc：取消文本输入而非取消整个截图（回归）", async ({
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

    const { page, host, probe, leakCount } = await setupScreenshotOverlay(
      context,
      serviceWorker,
      serverUrl
    );

    // 拉框建立选区
    await page.mouse.move(300, 300);
    await page.mouse.down();
    await page.mouse.move(800, 500, { steps: 8 });
    await page.mouse.up();

    // 1) text 工具点击创建输入框
    await probe.click('button[data-tool="text"]');
    await page.mouse.click(420, 380);
    await delay(200);
    expect(await probe.count(".inline-text-input")).toBe(1);

    // 2) 编辑态按 Esc → 输入框关闭，overlay 保留（修复前会误取消整个截图）
    await page.keyboard.press("Escape");
    await delay(300);
    expect(await probe.count(".inline-text-input")).toBe(0);
    await expect(host).toBeVisible({ timeout: 2_000 });
    logE2e("Esc closed text input while overlay stays active");

    // 3) 切换 rect 绘制正常（编辑态退出后未阻塞后续绘制）
    await probe.click('button[data-tool="rect"]');
    await page.mouse.move(350, 340);
    await page.mouse.down();
    await page.mouse.move(480, 420, { steps: 5 });
    await page.mouse.up();
    await delay(200);
    expect(await probe.count(".inline-text-input")).toBe(0);

    // 4) 收尾：非编辑态 Esc 仍取消截图（既有契约）
    await page.keyboard.press("Escape");
    await expect(host).toBeHidden({ timeout: 5_000 });
    // 修复点：取消瞬间的 keyup 也应被一次性 capture 监听吞掉，不泄漏到页面
    expect(await leakCount()).toBe(0);
  });
});

test.describe("Bug Lens Chrome Extension E2E SCREENSHOT-004: 截图文本批注（创建/提交/二次编辑）", () => {
  test("text 批注创建、输入提交、双击进入二次编辑", async ({
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

    const { page, host, probe, leakCount } = await setupScreenshotOverlay(
      context,
      serviceWorker,
      serverUrl
    );

    // 拉框建立选区
    await page.mouse.move(300, 300);
    await page.mouse.down();
    await page.mouse.move(800, 500, { steps: 8 });
    await page.mouse.up();

    const f0 = await probe.canvasFingerprint();
    expect(f0).toBeTruthy();

    // ---- 1) 切换 text 工具并点击选区创建输入框 ----
    await probe.click('button[data-tool="text"]');
    expect(await probe.toolActive("text")).toBe(true);
    // 工具切换（无文本输入）阶段事件应零泄漏
    expect(await leakCount()).toBe(0);

    await page.mouse.click(420, 420);
    await delay(200);
    expect(await probe.count(".inline-text-input")).toBe(1);
    logE2e("inline text input spawned");

    // ---- 2) 输入文本 ----
    await page.keyboard.type("Bug Lens Text");
    await delay(100);

    // ---- 3) 点击 rect 工具按钮：blur 提交文本批注并切换工具 ----
    // 状态机拒绝"编辑中开启绘制"的转移：点击按钮仅触发 blur 提交，不残留空白输入框。
    await probe.click('button[data-tool="rect"]');
    await delay(300);
    await page.keyboard.press("Tab");
    await delay(150);
    expect(await probe.count(".inline-text-input")).toBe(0);
    expect(await probe.toolActive("rect")).toBe(true);
    const f1 = await probe.canvasFingerprint();
    expect(f1).not.toBe(f0);
    logE2e("text annotation committed and rendered");

    // ---- 4) 单击文本批注（仅选中，不进入编辑）；双击才进入编辑 ----
    await page.mouse.click(430, 430);
    await delay(150);
    expect(await probe.count(".inline-text-input")).toBe(0);
    logE2e("single click selects text annotation without editing");
    await page.mouse.dblclick(430, 430);
    await delay(200);
    expect(await probe.count(".inline-text-input")).toBe(1);
    logE2e("text annotation re-edit spawned");

    // ---- 5) 修改文本并提交 ----
    await page.keyboard.type(" v2");
    await probe.click('button[data-tool="rect"]');
    await delay(300);
    expect(await probe.count(".inline-text-input")).toBe(0);
    const f2 = await probe.canvasFingerprint();
    expect(f2).not.toBe(f1);
    logE2e("text annotation updated");

    await page.keyboard.press("Escape");
    await expect(host).toBeHidden({ timeout: 5_000 });
  });
});

test.describe("Bug Lens Chrome Extension E2E SCREENSHOT-005: 截图确认导出全链路", () => {
  test("点击确认导出按钮，触发截图打包/Toast提示并自动销毁 Overlay", async ({
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
      logE2e("Screenshot export download triggered", {
        url: safeUrlForLog(downloadedUrl),
      });
    });

    const { page, host, probe, leakCount } = await setupScreenshotOverlay(
      context,
      serviceWorker,
      serverUrl
    );

    // 1) 拉框建立选区
    await page.mouse.move(300, 300);
    await page.mouse.down();
    await page.mouse.move(800, 500, { steps: 8 });
    await page.mouse.up();

    // 2) 绘制矩形批注
    await probe.click('button[data-tool="rect"]');
    await page.mouse.move(350, 340);
    await page.mouse.down();
    await page.mouse.move(480, 420, { steps: 5 });
    await page.mouse.up();

    // 3) 点击 confirm 确认导出按钮
    await probe.click('button[data-action="confirm"]');
    logE2e("Confirm button clicked");

    // 4) 校验 Overlay 隐藏与销毁
    await expect(host).toBeHidden({ timeout: 5_000 });
    logE2e("Overlay closed after confirmation");

    // 5) 校验网页上弹出 Toast 提示框
    const toast = page.locator(".bug-lens-toast-box");
    await expect(toast).toBeVisible({ timeout: 3_000 });
    logE2e("Toast visible on page");

    // 6) 全流程无事件泄漏
    expect(await leakCount()).toBe(0);
  });
});
