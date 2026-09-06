import { test, expect, safeUrlForLog } from "./fixtures/extension.ts";
import path from "node:path";
import fs from "node:fs";
import { unzipSync, strFromU8 } from "fflate";

function logE2e(message: string, details?: unknown): void {
  const suffix = details === undefined ? "" : ` ${JSON.stringify(details)}`;
  console.log(
    `[Bug Lens E2E Matrix][${new Date().toISOString()}] ${message}${suffix}`
  );
}

/**
 * 截取目标页面视口，返回 PNG data URL
 */
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
 * 在目标标签页内注入 content.js 并触发截图 overlay
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

/**
 * Closed Shadow DOM CDP 穿透探测器，用于点击工具栏按钮
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

  async click(selector: string): Promise<void> {
    const c = await this.elementCenter(selector);
    if (!c) throw new Error(`closed-shadow element not found: ${selector}`);
    await this.page.mouse.click(c.x, c.y);
  }

  async dispose(): Promise<void> {
    await this.cdp.detach().catch(() => undefined);
  }
}

/**
 * 驱动单个框架场景的端到端截图导出与 ZIP 捕获
 */
async function captureAndExportScenario(
  framework: "vue2" | "vue3" | "react",
  mode: "dev" | "prod",
  {
    context,
    serviceWorker,
    getAppUrl,
  }: {
    context: import("@playwright/test").BrowserContext;
    serviceWorker: import("@playwright/test").Worker;
    getAppUrl: (
      framework: "vue2" | "vue3" | "react",
      mode: "dev" | "prod"
    ) => string;
  }
): Promise<{
  unzipped: Record<string, Uint8Array>;
  domJson: any;
  envJson: any;
  aiPromptText: string;
}> {
  const scenarioTag = `${framework}-${mode}`;
  logE2e(`Starting scenario: ${scenarioTag}`);

  let page = context.pages()[0];
  if (!page) page = await context.newPage();
  const appUrl = getAppUrl(framework, mode);
  await page.goto(appUrl);
  await page.bringToFront();
  await page
    .waitForFunction(() => document.hasFocus(), undefined, { timeout: 3_000 })
    .catch(() => undefined);

  // 1. 等待真实测试工程挂载就绪
  await page.waitForSelector('[data-testid="app-root"]', { timeout: 5_000 });
  const todoItems = page.locator('[data-testid="todo-item"]');
  await expect(todoItems.first()).toBeVisible({ timeout: 5_000 });

  // 2. 获取目标 Tab ID
  const tabId = await serviceWorker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    return tab?.id;
  });
  expect(tabId).toBeTruthy();

  // 3. 准备拦截下载事件
  const downloadPromise = page.waitForEvent("download", { timeout: 25_000 });

  // 4. 捕获视口并唤起截图 Overlay
  const viewportDataUrl = await captureViewportDataUrl(context, page);
  await triggerScreenshotOverlay(serviceWorker, tabId!, viewportDataUrl);

  const host = page.locator("#bug-lens-screenshot-host");
  await expect(host).toBeVisible({ timeout: 5_000 });

  // 5. 交互拉框：定位到首个 todo-item 并框选它
  const firstItem = todoItems.first();
  const box = (await firstItem.boundingBox())!;
  expect(box).toBeTruthy();

  const selX1 = Math.max(0, Math.floor(box.x - 20));
  const selY1 = Math.max(0, Math.floor(box.y - 20));
  const selX2 = Math.floor(box.x + box.width + 20);
  const selY2 = Math.floor(box.y + box.height + 40);

  // 拖拽建立选区
  await page.mouse.move(selX1, selY1);
  await page.mouse.down();
  await page.mouse.move(selX2, selY2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);

  // 6. 切换至矩形批注工具并在 todo-item 上绘制矩形标注（覆盖面积 > 50%，形成 Anchor）
  const probe = new ShadowProbe(await context.newCDPSession(page), page);
  await probe.init();
  try {
    await probe.click('button[data-tool="rect"]');
    await page.waitForTimeout(150);

    await page.mouse.move(box.x + 5, box.y + 5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 5, box.y + box.height - 5, {
      steps: 5,
    });
    await page.mouse.up();
    await page.waitForTimeout(200);
  } finally {
    await probe.dispose();
  }

  // 7. 按 Enter 键确认导出
  await page.keyboard.press("Enter");

  // 8. 捕获并解压 ZIP 产物
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  logE2e(`ZIP downloaded for ${scenarioTag}`, { downloadPath });

  const zipBuffer = fs.readFileSync(downloadPath!);
  const unzipped = unzipSync(new Uint8Array(zipBuffer));

  // 基础必要文件存在性校验
  expect(unzipped["dom-context.json"]).toBeDefined();
  expect(unzipped["environment.json"]).toBeDefined();
  expect(unzipped["ai-prompt.md"]).toBeDefined();

  const domJson = JSON.parse(strFromU8(unzipped["dom-context.json"]));
  const envJson = JSON.parse(strFromU8(unzipped["environment.json"]));
  const aiPromptText = strFromU8(unzipped["ai-prompt.md"]);

  return { unzipped, domJson, envJson, aiPromptText };
}

test.describe("Bug Lens Chrome Extension E2E MATRIX: 6 大前端框架正交测试矩阵", () => {
  test.setTimeout(90_000);

  // -------------------------------------------------------------
  // Scenario 1: Vue 2 Dev
  // -------------------------------------------------------------
  test("MATRIX-001 (vue2-dev): Vue 2 开发模式 - $options.__file 相对路径、Props 与 $data 解包及敏感键脱敏", async ({
    context,
    serviceWorker,
    getAppUrl,
  }) => {
    const { envJson, domJson, aiPromptText } = await captureAndExportScenario(
      "vue2",
      "dev",
      { context, serviceWorker, getAppUrl }
    );

    // 1. 协议双写对齐校验
    expect(envJson.frameworkComponentStates).toBeDefined();
    expect(envJson.vueComponentStates).toBeDefined();
    expect(envJson.frameworkComponentStates).toEqual(
      envJson.vueComponentStates
    );
    expect(Array.isArray(envJson.frameworkComponentStates)).toBe(true);
    expect(envJson.frameworkComponentStates.length).toBeGreaterThan(0);

    // 2. 源码物理相对路径提取校验 ($options.__file)
    const todoState = envJson.frameworkComponentStates.find(
      (s: any) =>
        s.componentFile === "src/components/TodoItem.vue" ||
        s.componentName?.includes("TodoItem")
    );
    expect(todoState).toBeDefined();
    expect(todoState.framework).toBe("vue");
    expect(todoState.componentFile).toBe("src/components/TodoItem.vue");

    // 3. dom-context.json 节点挂载 componentFile
    const hasTodoFileInDom =
      domJson.anchors?.some(
        (a: any) => a.componentFile === "src/components/TodoItem.vue"
      ) ||
      domJson.leaves?.some(
        (l: any) => l.componentFile === "src/components/TodoItem.vue"
      ) ||
      domJson.ancestors?.some(
        (anc: any) => anc.componentFile === "src/components/TodoItem.vue"
      );
    expect(hasTodoFileInDom).toBe(true);

    // 4. Props 与 $data 解包
    expect(todoState.props).toBeDefined();
    expect(todoState.props.title).toBeTruthy();
    expect(todoState.data).toBeDefined();
    expect(typeof todoState.data.clickCount).toBe("number");
    expect(todoState.data.internalNotes).toBe(
      "Internal private notes for Vue 2 item"
    );

    // 5. 敏感键安全脱敏校验
    expect(todoState.props.secretToken).toBe("[REDACTED_SENSITIVE_KEY]");
    expect(todoState.props.authPassword).toBe("[REDACTED_SENSITIVE_KEY]");
    expect(todoState.data.itemApiKey).toBe("[REDACTED_SENSITIVE_KEY]");
    expect(todoState.data.itemPassword).toBe("[REDACTED_SENSITIVE_KEY]");

    // 6. ai-prompt.md 包含「🎯 源码物理定位」与相对路径
    expect(aiPromptText).toContain("🎯 源码物理定位");
    expect(aiPromptText).toContain("src/components/TodoItem.vue");
  });

  // -------------------------------------------------------------
  // Scenario 2: Vue 2 Prod
  // -------------------------------------------------------------
  test("MATRIX-002 (vue2-prod): Vue 2 生产模式 - 平滑降级、保留组件树与组件名", async ({
    context,
    serviceWorker,
    getAppUrl,
  }) => {
    const { envJson, aiPromptText } = await captureAndExportScenario(
      "vue2",
      "prod",
      { context, serviceWorker, getAppUrl }
    );

    // 1. 协议双写对齐校验
    expect(envJson.frameworkComponentStates).toBeDefined();
    expect(envJson.vueComponentStates).toBeDefined();
    expect(envJson.frameworkComponentStates).toEqual(
      envJson.vueComponentStates
    );

    // 2. 生产模式保留组件名
    const allNames = envJson.frameworkComponentStates
      .flatMap((s: any) => [s.componentName, ...(s.componentPath || [])])
      .filter(Boolean);
    const hasTodoItemName = allNames.some((n: string) =>
      n.includes("TodoItem")
    );
    expect(hasTodoItemName).toBe(true);

    // 3. 生产模式组件状态与敏感字段脱敏校验
    const todoState = envJson.frameworkComponentStates.find((s: any) =>
      s.componentName?.includes("TodoItem")
    );
    expect(todoState).toBeDefined();
    expect(todoState.props).toBeDefined();
    expect(todoState.props.secretToken).toBe("[REDACTED_SENSITIVE_KEY]");
    expect(todoState.props.authPassword).toBe("[REDACTED_SENSITIVE_KEY]");
    if (todoState.data) {
      expect(todoState.data.itemApiKey).toBe("[REDACTED_SENSITIVE_KEY]");
      expect(todoState.data.itemPassword).toBe("[REDACTED_SENSITIVE_KEY]");
    }

    // 4. ai-prompt.md 包含「🎯 源码物理定位」生产降级指引
    expect(aiPromptText).toContain("🎯 源码物理定位");
    expect(aiPromptText).toMatch(
      /未捕获到物理源码路径|No physical source paths captured/
    );
  });

  // -------------------------------------------------------------
  // Scenario 3: Vue 3 Dev
  // -------------------------------------------------------------
  test("MATRIX-003 (vue3-dev): Vue 3 开发模式 - type.__file 相对路径、setupState 响应式变量解包及敏感配置脱敏", async ({
    context,
    serviceWorker,
    getAppUrl,
  }) => {
    const { envJson, domJson, aiPromptText } = await captureAndExportScenario(
      "vue3",
      "dev",
      { context, serviceWorker, getAppUrl }
    );

    // 1. 协议双写对齐校验
    expect(envJson.frameworkComponentStates).toBeDefined();
    expect(envJson.vueComponentStates).toBeDefined();
    expect(envJson.frameworkComponentStates).toEqual(
      envJson.vueComponentStates
    );

    // 2. 物理源码相对路径提取校验 (type.__file)
    const todoState = envJson.frameworkComponentStates.find(
      (s: any) =>
        s.componentFile === "src/components/TodoItem.vue" ||
        s.componentName?.includes("TodoItem")
    );
    expect(todoState).toBeDefined();
    expect(todoState.framework).toBe("vue");
    expect(todoState.componentFile).toBe("src/components/TodoItem.vue");

    // 3. dom-context.json 节点挂载 componentFile
    const hasTodoFileInDom =
      domJson.anchors?.some(
        (a: any) => a.componentFile === "src/components/TodoItem.vue"
      ) ||
      domJson.leaves?.some(
        (l: any) => l.componentFile === "src/components/TodoItem.vue"
      ) ||
      domJson.ancestors?.some(
        (anc: any) => anc.componentFile === "src/components/TodoItem.vue"
      );
    expect(hasTodoFileInDom).toBe(true);

    // 4. Props 与 setupState 响应式变量解包（无 instance.data 遮蔽）
    expect(todoState.props).toBeDefined();
    expect(todoState.props.title).toBeTruthy();
    expect(todoState.data).toBeDefined();
    expect(typeof todoState.data.clickCount).toBe("number");
    expect(todoState.data.internalNotes).toBe("Internal notes for Vue 3 item");

    // 5. 敏感键安全脱敏校验（包含嵌套 reactive 属性）
    expect(todoState.props.secretToken).toBe("[REDACTED_SENSITIVE_KEY]");
    expect(todoState.props.authPassword).toBe("[REDACTED_SENSITIVE_KEY]");
    expect(todoState.data.sensitiveConfig).toBeDefined();
    expect(todoState.data.sensitiveConfig.apiKey).toBe(
      "[REDACTED_SENSITIVE_KEY]"
    );
    expect(todoState.data.sensitiveConfig.token).toBe(
      "[REDACTED_SENSITIVE_KEY]"
    );
    expect(todoState.data.sensitiveConfig.password).toBe(
      "[REDACTED_SENSITIVE_KEY]"
    );

    // 6. ai-prompt.md 包含「🎯 源码物理定位」与相对路径
    expect(aiPromptText).toContain("🎯 源码物理定位");
    expect(aiPromptText).toContain("src/components/TodoItem.vue");
  });

  // -------------------------------------------------------------
  // Scenario 4: Vue 3 Prod
  // -------------------------------------------------------------
  test("MATRIX-004 (vue3-prod): Vue 3 生产模式 - 平滑降级、无源码路径与探针空状态优雅处理", async ({
    context,
    serviceWorker,
    getAppUrl,
  }) => {
    const { envJson, domJson, aiPromptText } = await captureAndExportScenario(
      "vue3",
      "prod",
      { context, serviceWorker, getAppUrl }
    );

    // 1. 验证 Vue 3 生产混淆环境下探针平滑降级（无内部组件实例暴露时状态为 undefined，保持协议双写一致）
    expect(envJson.frameworkComponentStates).toBeUndefined();
    expect(envJson.vueComponentStates).toBeUndefined();

    // 2. 验证 dom-context.json 成功生成且无虚假组件路径挂载
    expect(domJson).toBeDefined();
    const hasAnyComponentFileInDom =
      domJson.anchors?.some((a: any) => Boolean(a.componentFile)) ||
      domJson.leaves?.some((l: any) => Boolean(l.componentFile));
    expect(hasAnyComponentFileInDom).toBeFalsy();

    // 3. ai-prompt.md 包含「🎯 源码物理定位」生产降级指引
    expect(aiPromptText).toContain("🎯 源码物理定位");
    expect(aiPromptText).toMatch(
      /未捕获到物理源码路径|No physical source paths captured/
    );
  });

  // -------------------------------------------------------------
  // Scenario 5: React 18 Dev
  // -------------------------------------------------------------
  test("MATRIX-005 (react-dev): React 18 开发模式 - _debugSource 相对路径与代码行号、memoizedProps 与 useState Hooks 解包及脱敏", async ({
    context,
    serviceWorker,
    getAppUrl,
  }) => {
    const { envJson, domJson, aiPromptText } = await captureAndExportScenario(
      "react",
      "dev",
      { context, serviceWorker, getAppUrl }
    );

    // 1. 协议双写对齐校验
    expect(envJson.frameworkComponentStates).toBeDefined();
    expect(envJson.vueComponentStates).toBeDefined();
    expect(envJson.frameworkComponentStates).toEqual(
      envJson.vueComponentStates
    );

    // 2. 物理源码相对路径与行号提取校验 (_debugSource)
    const todoState = envJson.frameworkComponentStates.find(
      (s: any) =>
        s.componentFile === "src/components/TodoItem.jsx" ||
        s.componentName?.includes("TodoItem")
    );
    expect(todoState).toBeDefined();
    expect(todoState.framework).toBe("react");
    expect(todoState.componentFile).toBe("src/components/TodoItem.jsx");
    expect(typeof todoState.componentLine).toBe("number");
    expect(todoState.componentLine).toBeGreaterThan(0);

    // 3. dom-context.json 节点挂载 componentFile 与 componentLine
    const anchorWithLine = domJson.anchors?.find(
      (a: any) =>
        a.componentFile === "src/components/TodoItem.jsx" &&
        typeof a.componentLine === "number"
    );
    const leafWithLine = domJson.leaves?.find(
      (l: any) =>
        l.componentFile === "src/components/TodoItem.jsx" &&
        typeof l.componentLine === "number"
    );
    expect(anchorWithLine || leafWithLine).toBeDefined();

    // 4. memoizedProps 与 useState Hooks 链表遍历解包
    expect(todoState.props).toBeDefined();
    expect(todoState.props.title).toBeTruthy();
    expect(todoState.data).toBeDefined();
    expect(todoState.data.useState_0).toBe(0); // clickCount (number 保留未被误杀)
    expect(todoState.data.useState_1).toBe("Internal notes for React item"); // 常规字符串保留未被误杀

    // 5. 敏感字段安全脱敏校验 (Props 敏感键脱敏，Hooks 敏感字符串值严格脱敏)
    expect(todoState.props.secretToken).toBe("[REDACTED_SENSITIVE_KEY]");
    expect(todoState.props.authPassword).toBe("[REDACTED_SENSITIVE_KEY]");
    expect(todoState.data.useState_2).toBe("[REDACTED_SENSITIVE_KEY]"); // sensitiveToken hook state
    expect(todoState.data.useState_3).toBe("[REDACTED_SENSITIVE_KEY]"); // sensitivePassword hook state

    // 6. ai-prompt.md 包含「🎯 源码物理定位」及带行号的相对路径
    expect(aiPromptText).toContain("🎯 源码物理定位");
    expect(aiPromptText).toMatch(/src\/components\/TodoItem\.jsx:\d+/);
  });

  // -------------------------------------------------------------
  // Scenario 6: React 18 Prod
  // -------------------------------------------------------------
  test("MATRIX-006 (react-prod): React 18 生产混淆模式 - 保留小写压缩组件名（无正则误杀）与生产降级提示", async ({
    context,
    serviceWorker,
    getAppUrl,
  }) => {
    const { envJson, aiPromptText } = await captureAndExportScenario(
      "react",
      "prod",
      { context, serviceWorker, getAppUrl }
    );

    // 1. 协议双写对齐校验
    expect(envJson.frameworkComponentStates).toBeDefined();
    expect(envJson.vueComponentStates).toBeDefined();
    expect(envJson.frameworkComponentStates).toEqual(
      envJson.vueComponentStates
    );

    // 2. 生产混淆模式保留组件名（小写单字母等混淆名不被 /^[a-z]/ 正则过滤误杀）
    const allNames = envJson.frameworkComponentStates
      .flatMap((s: any) => [s.componentName, ...(s.componentPath || [])])
      .filter(Boolean);
    expect(allNames.length).toBeGreaterThan(0);
    const hasMinifiedName = allNames.some((n: string) => /^[a-z]/i.test(n));
    expect(hasMinifiedName).toBe(true);

    // 3. 生产混淆模式 Props 提取与敏感字段脱敏校验
    const compWithProps = envJson.frameworkComponentStates.find(
      (s: any) => s.props && (s.props.secretToken || s.props.authPassword)
    );
    expect(compWithProps).toBeDefined();
    expect(compWithProps.props.secretToken).toBe("[REDACTED_SENSITIVE_KEY]");
    expect(compWithProps.props.authPassword).toBe("[REDACTED_SENSITIVE_KEY]");
    if (compWithProps.data) {
      if (compWithProps.data.useState_2 !== undefined) {
        expect(compWithProps.data.useState_2).toBe("[REDACTED_SENSITIVE_KEY]");
      }
      if (compWithProps.data.useState_3 !== undefined) {
        expect(compWithProps.data.useState_3).toBe("[REDACTED_SENSITIVE_KEY]");
      }
    }

    // 4. ai-prompt.md 包含「🎯 源码物理定位」生产降级指引
    expect(aiPromptText).toContain("🎯 源码物理定位");
    expect(aiPromptText).toMatch(
      /未捕获到物理源码路径|No physical source paths captured/
    );
  });
});
