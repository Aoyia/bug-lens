import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { PreviewPageShell } from "../src/preview/page-shell.ts";
import {
  WORKSPACE_SPLIT_STORAGE_KEY,
  bindWorkspaceResizer,
  computeWorkspaceSplitRatio,
} from "../src/preview/workspace-resizer.ts";

type ListenerMap = Record<string, Array<(event: any) => void>>;

function createMockDOM(options?: {
  containerWidth?: number;
  leftWidth?: number;
}) {
  const containerWidth = options?.containerWidth ?? 1200;
  const leftWidth = options?.leftWidth ?? 458;

  const createStyle = () => {
    const props = new Map<string, string>();
    return {
      cursor: "",
      userSelect: "",
      cssText: "",
      setProperty(name: string, value: string) {
        props.set(name, value);
      },
      getPropertyValue(name: string) {
        return props.get(name) ?? "";
      },
      removeProperty(name: string) {
        props.delete(name);
      },
    };
  };

  const createClassList = (initial: string[] = []) => {
    const classes = new Set<string>(initial);
    return {
      add(...items: string[]) {
        items.forEach((item) => classes.add(item));
      },
      remove(...items: string[]) {
        items.forEach((item) => classes.delete(item));
      },
      contains(item: string) {
        return classes.has(item);
      },
    };
  };

  const makeEl = (
    tagName: string,
    classes: string[] = [],
    attrs: Record<string, string> = {}
  ) => {
    const listeners: ListenerMap = {};
    const children: any[] = [];
    const el: any = {
      tagName: tagName.toUpperCase(),
      style: createStyle(),
      classList: createClassList(classes),
      attributes: { ...attrs },
      children,
      removed: false,
      setAttribute(name: string, value: string) {
        this.attributes[name] = value;
      },
      getAttribute(name: string) {
        return this.attributes[name] ?? null;
      },
      appendChild(child: any) {
        children.push(child);
        return child;
      },
      remove() {
        this.removed = true;
        const idx = body.children.indexOf(this);
        if (idx >= 0) body.children.splice(idx, 1);
      },
      addEventListener(type: string, fn: (event: any) => void) {
        if (!listeners[type]) listeners[type] = [];
        listeners[type].push(fn);
      },
      removeEventListener(type: string, fn: (event: any) => void) {
        if (!listeners[type]) return;
        listeners[type] = listeners[type].filter((item) => item !== fn);
      },
      dispatchEvent(event: any) {
        const list = [...(listeners[event.type] ?? [])];
        list.forEach((fn) => fn(event));
        return true;
      },
      listenerCount(type: string) {
        return listeners[type]?.length ?? 0;
      },
    };
    return el;
  };

  const body = makeEl("body");
  const documentElement = makeEl("html", [], { lang: "zh-CN" });
  const meta = makeEl("truncated-text", ["muted"], { id: "meta" });
  meta.textContent = "";

  const workspace = makeEl("main", ["zen-workspace"]);
  workspace.getBoundingClientRect = () => ({ width: containerWidth });

  const leftPanel = makeEl("div", ["zen-left-panel"]);
  leftPanel.getBoundingClientRect = () => ({ width: leftWidth });

  const rightPanel = makeEl("div", ["zen-right-panel"]);
  rightPanel.getBoundingClientRect = () => ({
    width: Math.max(0, containerWidth - leftWidth - 5),
  });

  const resizer = makeEl("div", ["zen-workspace-resizer"], {
    id: "workspace-resizer",
    role: "separator",
    "aria-orientation": "vertical",
    "aria-valuemin": "20",
    "aria-valuemax": "80",
    "aria-valuenow": "38",
    tabindex: "0",
  });
  let capturedPointerId: number | null = null;
  resizer.setPointerCapture = (id: number) => {
    capturedPointerId = id;
  };
  resizer.releasePointerCapture = (id: number) => {
    if (capturedPointerId === id) capturedPointerId = null;
  };
  resizer.getCapturedPointerId = () => capturedPointerId;

  const docListeners: ListenerMap = {};
  const doc: any = {
    body,
    documentElement,
    createElement(tag: string) {
      return makeEl(tag);
    },
    getElementById(id: string) {
      if (id === "workspace-resizer") return resizer;
      if (id === "meta") return meta;
      return null;
    },
    querySelector(selector: string) {
      if (selector === ".zen-workspace") return workspace;
      if (selector === "#workspace-resizer") return resizer;
      if (selector === ".zen-left-panel") return leftPanel;
      if (selector === ".zen-right-panel") return rightPanel;
      if (selector === "#meta") return meta;
      return null;
    },
    querySelectorAll() {
      return [];
    },
    addEventListener(type: string, fn: (event: any) => void) {
      if (!docListeners[type]) docListeners[type] = [];
      docListeners[type].push(fn);
    },
    removeEventListener(type: string, fn: (event: any) => void) {
      if (!docListeners[type]) return;
      docListeners[type] = docListeners[type].filter((item) => item !== fn);
    },
    dispatchEvent(event: any) {
      const list = [...(docListeners[event.type] ?? [])];
      list.forEach((fn) => fn(event));
      return true;
    },
    listenerCount(type: string) {
      return docListeners[type]?.length ?? 0;
    },
  };

  return { doc, body, workspace, leftPanel, rightPanel, resizer, meta };
}

function createMemoryStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
  };
}

test("computeWorkspaceSplitRatio 边界钳制：左侧不低于 260px、右侧不低于 320px", () => {
  // 1000px 容器，5px 分隔栏 -> 可用 995px -> 左最小 260px，左最大 995-320=675px
  const tooNarrowLeft = computeWorkspaceSplitRatio({
    containerWidth: 1000,
    desiredLeftPx: 100,
  });
  assert.equal(tooNarrowLeft.leftPx, 260);
  assert.equal(tooNarrowLeft.ratio, 0.26);
  assert.equal(tooNarrowLeft.leftPct, 26);

  const tooWideLeft = computeWorkspaceSplitRatio({
    containerWidth: 1000,
    desiredLeftPx: 900,
  });
  assert.equal(tooWideLeft.leftPx, 675);
  assert.equal(tooWideLeft.ratio, 0.675);
  assert.equal(tooWideLeft.leftPct, 67.5);

  const normal = computeWorkspaceSplitRatio({
    containerWidth: 1200,
    desiredLeftPx: 480,
  });
  assert.equal(normal.leftPx, 480);
  assert.equal(normal.ratio, 0.4);
  assert.equal(normal.leftPct, 40);
});

test("computeWorkspaceSplitRatio 窄容器与异常尺寸安全降级防负/防溢出", () => {
  // 容器宽度不足 260 + 320 + 5 = 585px
  const narrowMin = computeWorkspaceSplitRatio({
    containerWidth: 400,
    desiredLeftPx: -50,
  });
  assert.ok(narrowMin.leftPx > 0 && narrowMin.leftPx < 395);
  assert.equal(narrowMin.leftPx, 395 * 0.2);
  assert.ok(narrowMin.ratio > 0 && narrowMin.ratio < 1);

  const narrowMax = computeWorkspaceSplitRatio({
    containerWidth: 400,
    desiredLeftPx: 999,
  });
  assert.equal(narrowMax.leftPx, 395 * 0.8);
  assert.ok(narrowMax.ratio > 0 && narrowMax.ratio < 1);

  const zeroContainer = computeWorkspaceSplitRatio({
    containerWidth: 0,
    desiredLeftPx: 300,
  });
  assert.equal(zeroContainer.ratio, 0.382);
  assert.equal(zeroContainer.leftPct, 38.2);
  assert.equal(zeroContainer.leftPx, 0);
});

test("指针拖拽 (pointerdown -> pointermove -> pointerup) 更新 CSS 变量、类名、遮罩与持久化", () => {
  const { doc, body, workspace, resizer } = createMockDOM({
    containerWidth: 1000,
    leftWidth: 400,
  });
  const storage = createMemoryStorage();
  const cleanup = bindWorkspaceResizer(doc as unknown as Document, { storage });

  // 右键点击不应触发拖拽
  resizer.dispatchEvent({
    type: "pointerdown",
    button: 2,
    clientX: 400,
    pointerId: 1,
  });
  assert.equal(resizer.classList.contains("dragging"), false);

  // 左键开始拖拽
  resizer.dispatchEvent({
    type: "pointerdown",
    button: 0,
    clientX: 400,
    pointerId: 7,
    preventDefault() {},
  });
  assert.equal(resizer.classList.contains("dragging"), true);
  assert.equal(resizer.getCapturedPointerId(), 7);
  assert.equal(body.style.userSelect, "none");
  assert.equal(body.style.cursor, "col-resize");
  assert.equal(
    body.children.length,
    1,
    "应挂载全屏 dragOverlay 防 <video> 吞事件"
  );
  assert.ok(body.children[0].style.cssText.includes("z-index:9999"));

  // 向右拖动 120px -> 400 + 120 = 520px (52%)
  doc.dispatchEvent({ type: "pointermove", clientX: 520 });
  assert.equal(workspace.style.getPropertyValue("--zen-workspace-left"), "52%");
  assert.equal(workspace.classList.contains("zen-workspace--resized"), true);
  assert.equal(resizer.getAttribute("aria-valuenow"), "52");

  // 拖到极右端 -> 钳制到 1000 - 5 - 320 = 675px (67.5%)
  doc.dispatchEvent({ type: "pointermove", clientX: 950 });
  assert.equal(
    workspace.style.getPropertyValue("--zen-workspace-left"),
    "67.5%"
  );
  assert.equal(resizer.getAttribute("aria-valuenow"), "68");

  // 松手结束拖拽：清理遮罩、恢复 body 样式并持久化
  doc.dispatchEvent({ type: "pointerup" });
  assert.equal(resizer.classList.contains("dragging"), false);
  assert.equal(resizer.getCapturedPointerId(), null);
  assert.equal(body.children.length, 0, "dragOverlay 应被移除");
  assert.equal(body.style.userSelect, "");
  assert.equal(body.style.cursor, "");
  assert.equal(doc.listenerCount("pointermove"), 0);
  assert.equal(doc.listenerCount("pointerup"), 0);
  assert.equal(storage.getItem(WORKSPACE_SPLIT_STORAGE_KEY), "0.6750");

  cleanup();
});

test("pointercancel 中止拖拽应干净清理遮罩与监听器", () => {
  const { doc, body, resizer } = createMockDOM({
    containerWidth: 1000,
    leftWidth: 400,
  });
  const storage = createMemoryStorage();
  const cleanup = bindWorkspaceResizer(doc as unknown as Document, { storage });

  resizer.dispatchEvent({
    type: "pointerdown",
    button: 0,
    clientX: 400,
    pointerId: 3,
  });
  doc.dispatchEvent({ type: "pointermove", clientX: 500 });
  doc.dispatchEvent({ type: "pointercancel" });

  assert.equal(resizer.classList.contains("dragging"), false);
  assert.equal(body.children.length, 0);
  assert.equal(doc.listenerCount("pointermove"), 0);
  assert.equal(doc.listenerCount("pointercancel"), 0);
  assert.equal(
    storage.getItem(WORKSPACE_SPLIT_STORAGE_KEY),
    null,
    "取消拖拽不应写入持久化"
  );

  cleanup();
});

test("dblclick 重置为默认比例并清除持久化", () => {
  const { doc, workspace, resizer } = createMockDOM({
    containerWidth: 1000,
    leftWidth: 500,
  });
  const storage = createMemoryStorage({
    [WORKSPACE_SPLIT_STORAGE_KEY]: "0.5000",
  });
  const cleanup = bindWorkspaceResizer(doc as unknown as Document, { storage });

  // 初始化应自动恢复 50%
  assert.equal(workspace.style.getPropertyValue("--zen-workspace-left"), "50%");
  assert.equal(workspace.classList.contains("zen-workspace--resized"), true);
  assert.equal(resizer.getAttribute("aria-valuenow"), "50");

  // 双击重置
  resizer.dispatchEvent({ type: "dblclick" });
  assert.equal(workspace.style.getPropertyValue("--zen-workspace-left"), "");
  assert.equal(workspace.classList.contains("zen-workspace--resized"), false);
  assert.equal(resizer.getAttribute("aria-valuenow"), "38");
  assert.equal(storage.getItem(WORKSPACE_SPLIT_STORAGE_KEY), null);

  cleanup();
});

test("keydown 方向键、Shift 加速键与 Home/End 正确调整与钳制", () => {
  const { doc, workspace, resizer } = createMockDOM({
    containerWidth: 1000,
    leftWidth: 400,
  });
  const storage = createMemoryStorage();
  const cleanup = bindWorkspaceResizer(doc as unknown as Document, { storage });

  let prevented = 0;
  // ArrowRight +2% -> 42%
  resizer.dispatchEvent({
    type: "keydown",
    key: "ArrowRight",
    shiftKey: false,
    preventDefault: () => {
      prevented += 1;
    },
  });
  assert.equal(prevented, 1);
  assert.equal(workspace.style.getPropertyValue("--zen-workspace-left"), "42%");
  assert.equal(resizer.getAttribute("aria-valuenow"), "42");
  assert.equal(storage.getItem(WORKSPACE_SPLIT_STORAGE_KEY), "0.4200");

  // Shift + ArrowLeft -5% -> 37%
  resizer.dispatchEvent({
    type: "keydown",
    key: "ArrowLeft",
    shiftKey: true,
    preventDefault: () => {
      prevented += 1;
    },
  });
  assert.equal(prevented, 2);
  assert.equal(workspace.style.getPropertyValue("--zen-workspace-left"), "37%");

  // Home -> 最小合法左宽 260px -> 26%
  resizer.dispatchEvent({
    type: "keydown",
    key: "Home",
    preventDefault: () => {
      prevented += 1;
    },
  });
  assert.equal(workspace.style.getPropertyValue("--zen-workspace-left"), "26%");
  assert.equal(resizer.getAttribute("aria-valuenow"), "26");

  // End -> 最大合法左宽 675px -> 67.5%
  resizer.dispatchEvent({
    type: "keydown",
    key: "End",
    preventDefault: () => {
      prevented += 1;
    },
  });
  assert.equal(
    workspace.style.getPropertyValue("--zen-workspace-left"),
    "67.5%"
  );
  assert.equal(resizer.getAttribute("aria-valuenow"), "68");

  // 无关按键不应被拦截
  resizer.dispatchEvent({
    type: "keydown",
    key: "Tab",
    preventDefault: () => {
      prevented += 1;
    },
  });
  assert.equal(prevented, 4);

  cleanup();
});

test("localStorage 抛出 SecurityError 时安全降级不崩溃", () => {
  const { doc, workspace, resizer } = createMockDOM({
    containerWidth: 1000,
    leftWidth: 400,
  });
  const throwingStorage = {
    get length() {
      return 0;
    },
    clear() {},
    key() {
      return null;
    },
    getItem() {
      throw new DOMException("Access denied", "SecurityError");
    },
    setItem() {
      throw new DOMException("Access denied", "SecurityError");
    },
    removeItem() {
      throw new DOMException("Access denied", "SecurityError");
    },
  } as unknown as Storage;

  const cleanup = bindWorkspaceResizer(doc as unknown as Document, {
    storage: throwingStorage,
  });

  resizer.dispatchEvent({
    type: "pointerdown",
    button: 0,
    clientX: 400,
    pointerId: 1,
  });
  doc.dispatchEvent({ type: "pointermove", clientX: 460 });
  doc.dispatchEvent({ type: "pointerup" });
  assert.equal(workspace.style.getPropertyValue("--zen-workspace-left"), "46%");

  resizer.dispatchEvent({ type: "dblclick" });
  assert.equal(workspace.style.getPropertyValue("--zen-workspace-left"), "");

  cleanup();
});

test("在最小 mock 下初始化 PreviewPageShell 不抛出异常", () => {
  const globalScope = globalThis as Record<string, unknown>;
  const prevWindow = globalScope.window;
  globalScope.window = {
    setTimeout: () => 1,
    clearTimeout: () => {},
  };

  const minimalDoc = {
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
  } as unknown as Document;

  try {
    const shell = new PreviewPageShell(minimalDoc, () => {});
    assert.equal(shell.activeTab, "issues");
    shell.destroy();
  } finally {
    globalScope.window = prevWindow;
  }
});

test("preview/index.html 与 report/index.html 均包含 #workspace-resizer 且双语字典齐全", () => {
  for (const htmlPath of [
    "src/entrypoints/preview/index.html",
    "src/entrypoints/report/index.html",
  ]) {
    const html = readFileSync(resolve(process.cwd(), htmlPath), "utf8");
    const leftIdx = html.indexOf('class="zen-left-panel"');
    const resizerIdx = html.indexOf('id="workspace-resizer"');
    const rightIdx = html.indexOf('class="zen-right-panel"');

    assert.ok(leftIdx > 0, `${htmlPath} 缺少 .zen-left-panel`);
    assert.ok(resizerIdx > leftIdx, `${htmlPath} 缺少 #workspace-resizer`);
    assert.ok(
      rightIdx > resizerIdx,
      `${htmlPath} 中 #workspace-resizer 应位于左右面板之间`
    );
    assert.match(html, /role="separator"/);
    assert.match(html, /data-i18n-title="workspaceResizerTitle"/);
  }

  const zhDict = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "src/_locales/zh_CN/messages.json"),
      "utf8"
    )
  ) as Record<string, { message: string }>;
  const enDict = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "src/_locales/en/messages.json"),
      "utf8"
    )
  ) as Record<string, { message: string }>;

  assert.ok(zhDict.workspaceResizerTitle?.message.trim().length > 0);
  assert.ok(enDict.workspaceResizerTitle?.message.trim().length > 0);
  assert.ok(
    !/[\u4e00-\u9fff]/.test(enDict.workspaceResizerTitle.message),
    "en workspaceResizerTitle 不得混入中文"
  );
});

test("离线报告 DOM 结构在无 Storage 与只读沙盒下可初始化、指针拖拽与键盘调整", () => {
  const reportHtml = readFileSync(
    resolve(process.cwd(), "src/entrypoints/report/index.html"),
    "utf8"
  );
  assert.match(reportHtml, /class="zen-workspace"/);
  assert.match(reportHtml, /class="zen-left-panel"/);
  assert.match(reportHtml, /id="workspace-resizer"/);
  assert.match(reportHtml, /class="zen-right-panel"/);

  const { doc, body, workspace, leftPanel, rightPanel, resizer } =
    createMockDOM({
      containerWidth: 1200,
      leftWidth: 458,
    });

  // 验证离线报告所需节点在 DOM 中就绪
  assert.equal(doc.querySelector(".zen-workspace"), workspace);
  assert.equal(doc.querySelector(".zen-left-panel"), leftPanel);
  assert.equal(doc.querySelector("#workspace-resizer"), resizer);
  assert.equal(doc.querySelector(".zen-right-panel"), rightPanel);

  // 1) storage: null（模拟无 Storage 环境）下平稳降级
  const cleanupNoStorage = bindWorkspaceResizer(doc as unknown as Document, {
    storage: null,
  });

  // 指针拖拽（pointerdown -> pointermove -> pointerup）
  resizer.dispatchEvent({
    type: "pointerdown",
    button: 0,
    clientX: 458,
    pointerId: 11,
    preventDefault() {},
  });
  assert.equal(resizer.classList.contains("dragging"), true);
  assert.equal(body.children.length, 1);

  doc.dispatchEvent({ type: "pointermove", clientX: 558 });
  // 458 + 100 = 558px / 1200px = 46.5%
  assert.equal(
    workspace.style.getPropertyValue("--zen-workspace-left"),
    "46.5%"
  );
  assert.equal(workspace.classList.contains("zen-workspace--resized"), true);
  assert.equal(resizer.getAttribute("aria-valuenow"), "47");

  doc.dispatchEvent({ type: "pointerup" });
  assert.equal(resizer.classList.contains("dragging"), false);
  assert.equal(body.children.length, 0);

  // 键盘方向键（ArrowRight +2% -> 48.5%, ArrowLeft -2% -> 46.5%）
  resizer.dispatchEvent({
    type: "keydown",
    key: "ArrowRight",
    shiftKey: false,
    preventDefault() {},
  });
  assert.equal(
    workspace.style.getPropertyValue("--zen-workspace-left"),
    "48.5%"
  );
  assert.equal(resizer.getAttribute("aria-valuenow"), "49");

  resizer.dispatchEvent({
    type: "keydown",
    key: "ArrowLeft",
    shiftKey: false,
    preventDefault() {},
  });
  assert.equal(
    workspace.style.getPropertyValue("--zen-workspace-left"),
    "46.5%"
  );
  assert.equal(resizer.getAttribute("aria-valuenow"), "47");
  cleanupNoStorage();

  // 2) 未传入 options.storage 且 globalThis.window.localStorage 缺失 / 只读抛出异常时平稳降级
  const globalScope = globalThis as Record<string, unknown>;
  const prevWindow = globalScope.window;
  const prevLocalStorage = globalScope.localStorage;
  try {
    globalScope.window = {
      get localStorage() {
        throw new DOMException("Sandbox access denied", "SecurityError");
      },
    };
    delete globalScope.localStorage;

    const cleanupSandboxed = bindWorkspaceResizer(doc as unknown as Document);
    resizer.dispatchEvent({
      type: "pointerdown",
      button: 0,
      clientX: 458,
      pointerId: 12,
      preventDefault() {},
    });
    doc.dispatchEvent({ type: "pointermove", clientX: 358 });
    doc.dispatchEvent({ type: "pointerup" });
    assert.equal(
      workspace.style.getPropertyValue("--zen-workspace-left"),
      "29.83%"
    );
    cleanupSandboxed();
  } finally {
    globalScope.window = prevWindow;
    if (prevLocalStorage !== undefined) {
      globalScope.localStorage = prevLocalStorage;
    }
  }
});

test("重复调用 bindWorkspaceResizer 不会叠加监听器或导致键盘步进翻倍", () => {
  const { doc, body, workspace, resizer } = createMockDOM({
    containerWidth: 1000,
    leftWidth: 400,
  });
  const storage = createMemoryStorage();

  const cleanup1 = bindWorkspaceResizer(doc as unknown as Document, {
    storage,
  });
  const cleanup2 = bindWorkspaceResizer(doc as unknown as Document, {
    storage,
  });

  assert.equal(resizer.listenerCount("pointerdown"), 1);
  assert.equal(resizer.listenerCount("keydown"), 1);
  assert.equal(resizer.listenerCount("dblclick"), 1);

  // 单次 ArrowRight 应只步进 +2%（40% -> 42%），而非叠加为 +4%
  resizer.dispatchEvent({
    type: "keydown",
    key: "ArrowRight",
    shiftKey: false,
    preventDefault() {},
  });
  assert.equal(workspace.style.getPropertyValue("--zen-workspace-left"), "42%");

  // pointerdown 应仅挂载 1 个全屏拖拽遮罩
  resizer.dispatchEvent({
    type: "pointerdown",
    button: 0,
    clientX: 420,
    pointerId: 5,
    preventDefault() {},
  });
  assert.equal(body.children.length, 1);
  doc.dispatchEvent({ type: "pointerup" });

  // 旧 cleanup 不应破坏新绑定，最后由 cleanup2 完整卸载
  cleanup1();
  assert.equal(resizer.listenerCount("keydown"), 1);
  cleanup2();
  assert.equal(resizer.listenerCount("keydown"), 0);
  assert.equal(resizer.listenerCount("pointerdown"), 0);
});

test("离线报告入口 src/entrypoints/report/index.ts 引入并顶层调用 bindWorkspaceResizer，数据缺失时仍可拖拽", async () => {
  const reportEntryCode = readFileSync(
    resolve(process.cwd(), "src/entrypoints/report/index.ts"),
    "utf8"
  );
  assert.match(
    reportEntryCode,
    /import\s*\{\s*bindWorkspaceResizer\s*\}\s*from\s*["']\.\.\/\.\.\/preview\/workspace-resizer["']/
  );
  assert.match(reportEntryCode, /bindWorkspaceResizer\(document\)/);

  const { doc, body, workspace, resizer, meta } = createMockDOM({
    containerWidth: 1000,
    leftWidth: 400,
  });

  const globalScope = globalThis as Record<string, unknown>;
  const prevDocument = globalScope.document;
  const prevWindow = globalScope.window;
  const prevLocalStorage = globalScope.localStorage;

  try {
    globalScope.document = doc;
    globalScope.window = {};
    delete globalScope.localStorage;

    // 通过查询参数避免模块缓存干扰，真实执行 report/index.ts 顶层初始化（无报告数据降级分支）
    await import(`../src/entrypoints/report/index.ts?testRun=${Date.now()}`);

    assert.equal(meta.classList.contains("report-error"), true);
    assert.equal(resizer.listenerCount("pointerdown"), 1);
    assert.equal(resizer.listenerCount("keydown"), 1);

    // 即使数据缺失提示错误，分隔栏拖拽与键盘调整仍可用
    resizer.dispatchEvent({
      type: "pointerdown",
      button: 0,
      clientX: 400,
      pointerId: 1,
      preventDefault() {},
    });
    doc.dispatchEvent({ type: "pointermove", clientX: 500 });
    doc.dispatchEvent({ type: "pointerup" });
    assert.equal(
      workspace.style.getPropertyValue("--zen-workspace-left"),
      "50%"
    );
    assert.equal(body.children.length, 0);

    resizer.dispatchEvent({
      type: "keydown",
      key: "ArrowLeft",
      shiftKey: false,
      preventDefault() {},
    });
    assert.equal(
      workspace.style.getPropertyValue("--zen-workspace-left"),
      "48%"
    );
  } finally {
    globalScope.document = prevDocument;
    globalScope.window = prevWindow;
    if (prevLocalStorage !== undefined) {
      globalScope.localStorage = prevLocalStorage;
    }
  }
});
