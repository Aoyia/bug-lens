import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { PreviewController } from "../src/preview/preview-controller.ts";
import type { EvidencePackageSnapshot } from "../src/preview/evidence-package.ts";
import { bindTicketPreviewModal } from "../src/preview/ticket-preview-modal.ts";
import { setUserLanguagePreference } from "../src/shared/i18n.ts";
import type {
  ConsoleEntry,
  InteractionRecord,
  RecordingSession,
} from "../src/shared/protocol.ts";

const zhDict = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "src/_locales/zh_CN/messages.json"),
    "utf8"
  )
) as Record<string, { message: string }>;

// ─── 轻量 DOM Mock（支持解析 buildTicketHtml 输出的嵌套标签与 querySelector）───

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function toCamel(attr: string): string {
  return attr
    .slice(5)
    .replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
}

class MockClassList {
  private set = new Set<string>();
  constructor(private readonly el: MockElement) {}
  syncFromAttr(val: string) {
    this.set = new Set(val.split(/\s+/).filter(Boolean));
  }
  add(...names: string[]) {
    for (const n of names)
      for (const p of n.split(/\s+/).filter(Boolean)) this.set.add(p);
  }
  remove(...names: string[]) {
    for (const n of names) this.set.delete(n);
  }
  toggle(name: string, force?: boolean) {
    if (force === undefined) {
      if (this.set.has(name)) this.set.delete(name);
      else this.set.add(name);
    } else if (force) this.set.add(name);
    else this.set.delete(name);
  }
  contains(name: string) {
    return this.set.has(name);
  }
}

class MockTextNode {
  parentNode: MockElement | null = null;
  constructor(public textContent: string) {}
}

type MockChild = MockElement | MockTextNode;

class MockElement {
  tagName: string;
  children: MockChild[] = [];
  parentNode: MockElement | null = null;
  attrs = new Map<string, string>();
  dataset: Record<string, string | undefined>;
  classList: MockClassList;
  style: Record<string, string> = {};
  hidden = false;
  value = "";
  placeholder = "";
  rows = 1;
  type = "";
  src = "";
  alt = "";
  isContentEditable = false;
  scrollTop = 0;
  private listeners = new Map<string, Array<(e: any) => void>>();

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
    this.classList = new MockClassList(this);
    const self = this;
    this.dataset = new Proxy(
      {},
      {
        get(_t, prop: string) {
          const kebab = prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
          return self.attrs.get(`data-${kebab}`);
        },
        set(_t, prop: string, val: string) {
          const kebab = prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
          self.attrs.set(`data-${kebab}`, String(val));
          return true;
        },
      }
    );
  }

  get id(): string {
    return this.attrs.get("id") ?? "";
  }
  set id(v: string) {
    this.attrs.set("id", v);
  }

  set className(v: string) {
    this.attrs.set("class", v);
    this.classList.syncFromAttr(v);
  }
  get className(): string {
    return this.attrs.get("class") ?? "";
  }

  setAttribute(k: string, v: string) {
    this.attrs.set(k, v);
    if (k === "class") this.classList.syncFromAttr(v);
    if (k === "src") this.src = v;
    if (k === "alt") this.alt = v;
  }
  getAttribute(k: string): string | null {
    return this.attrs.get(k) ?? null;
  }

  private detach(node: MockChild) {
    if (node.parentNode) {
      const idx = node.parentNode.children.indexOf(node);
      if (idx >= 0) node.parentNode.children.splice(idx, 1);
    }
  }

  appendChild(node: MockChild) {
    this.detach(node);
    node.parentNode = this;
    this.children.push(node);
    return node;
  }

  insertBefore(newNode: MockChild, refNode: MockChild | null) {
    this.detach(newNode);
    newNode.parentNode = this;
    if (!refNode) {
      this.children.push(newNode);
      return newNode;
    }
    const idx = this.children.indexOf(refNode);
    if (idx >= 0) this.children.splice(idx, 0, newNode);
    else this.children.push(newNode);
    return newNode;
  }

  after(newNode: MockChild) {
    if (!this.parentNode) return;
    newNode.parentNode = this.parentNode;
    const idx = this.parentNode.children.indexOf(this);
    this.parentNode.children.splice(idx + 1, 0, newNode);
  }

  replaceWith(newNode: MockChild) {
    if (!this.parentNode) return;
    newNode.parentNode = this.parentNode;
    const idx = this.parentNode.children.indexOf(this);
    if (idx >= 0) this.parentNode.children.splice(idx, 1, newNode);
    this.parentNode = null;
  }

  get textContent(): string {
    return this.children
      .map((c) => (c instanceof MockTextNode ? c.textContent : c.textContent))
      .join("");
  }
  set textContent(v: string) {
    this.children = [new MockTextNode(v)];
  }

  set innerHTML(html: string) {
    this.children = [];
    parseHtmlInto(html, this);
  }

  matches(selector: string): boolean {
    let s = selector.trim();
    const tagMatch = s.match(/^[a-zA-Z0-9_-]+/);
    if (tagMatch) {
      if (this.tagName.toLowerCase() !== tagMatch[0].toLowerCase())
        return false;
      s = s.slice(tagMatch[0].length);
    }
    for (const m of s.matchAll(/\.([a-zA-Z0-9_-]+)/g)) {
      if (!this.classList.contains(m[1])) return false;
    }
    for (const m of s.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)) {
      const val = this.attrs.get(m[1]);
      if (val === undefined) return false;
      if (m[2] !== undefined && val !== m[2]) return false;
    }
    return true;
  }

  querySelectorAll<T = MockElement>(selector: string): T[] {
    const out: T[] = [];
    const visit = (node: MockElement) => {
      for (const ch of node.children) {
        if (ch instanceof MockElement) {
          if (ch.matches(selector)) out.push(ch as unknown as T);
          visit(ch);
        }
      }
    };
    visit(this);
    return out;
  }

  querySelector<T = MockElement>(selector: string): T | null {
    return this.querySelectorAll<T>(selector)[0] ?? null;
  }

  closest<T = MockElement>(selector: string): T | null {
    let cur: MockElement | null = this;
    while (cur) {
      if (cur.matches(selector)) return cur as unknown as T;
      cur = cur.parentNode;
    }
    return null;
  }

  addEventListener(type: string, fn: (e: any) => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, fn: (e: any) => void) {
    const list = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      list.filter((item) => item !== fn)
    );
  }

  dispatch(type: string, extra: Record<string, any> = {}) {
    const event = {
      type,
      target: this,
      preventDefault() {},
      stopPropagation() {},
      ...extra,
    };
    for (const fn of this.listeners.get(type) ?? []) {
      fn(event);
    }
    return event;
  }

  click() {
    this.dispatch("click");
  }
  focus() {}
  select() {}
  getBoundingClientRect() {
    return { height: 400 };
  }
}

function parseHtmlInto(html: string, root: MockElement) {
  const stack: MockElement[] = [root];
  const tokenRe = /<(\/?)([a-zA-Z0-9]+)([^>]*?)(\/?)>|([^<]+)/g;
  const voidTags = new Set(["img", "br", "hr", "input"]);
  for (const m of html.matchAll(tokenRe)) {
    const parent = stack[stack.length - 1];
    if (m[5] !== undefined) {
      parent.appendChild(new MockTextNode(decodeEntities(m[5])));
      continue;
    }
    const isClose = m[1] === "/";
    const tag = m[2].toLowerCase();
    const rawAttrs = m[3] ?? "";
    const selfClose = m[4] === "/" || voidTags.has(tag);
    if (isClose) {
      if (
        stack.length > 1 &&
        stack[stack.length - 1].tagName.toLowerCase() === tag
      ) {
        stack.pop();
      }
      continue;
    }
    const el = new MockElement(tag);
    for (const a of rawAttrs.matchAll(/([a-zA-Z0-9:-]+)(?:="([^"]*)")?/g)) {
      el.setAttribute(a[1], decodeEntities(a[2] ?? ""));
      if (a[1].startsWith("data-")) {
        void toCamel(a[1]);
      }
    }
    parent.appendChild(el);
    if (!selfClose) stack.push(el);
  }
}

class MockDocument {
  elements = new Map<string, MockElement>();
  listeners = new Map<string, Array<(e: any) => void>>();
  createElement(tag: string) {
    return new MockElement(tag);
  }
  getElementById(id: string) {
    return this.elements.get(id) ?? null;
  }
  register(id: string, tag = "div", className = "") {
    const el = new MockElement(tag);
    el.id = id;
    if (className) el.className = className;
    this.elements.set(id, el);
    return el;
  }
  addEventListener(type: string, fn: (e: any) => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, fn: (e: any) => void) {
    const list = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      list.filter((item) => item !== fn)
    );
  }
  dispatchKey(extra: Record<string, any>) {
    const event = {
      type: "keydown",
      preventDefault() {},
      stopPropagation() {},
      ...extra,
    };
    for (const fn of this.listeners.get("keydown") ?? []) {
      fn(event);
    }
  }
}

function setupModalFixture(opts?: { preExcludeSteps?: boolean }) {
  const doc = new MockDocument();
  const modal = doc.register("ticket-modal");
  modal.hidden = true;
  const content = new MockElement("div");
  content.className = "ticket-modal-content";
  const body = new MockElement("div");
  body.className = "ticket-modal-body";
  modal.appendChild(content);
  content.appendChild(body);

  const previewBtn = doc.register("preview-ticket-btn", "button");
  doc.register("ticket-modal-close", "button");
  doc.register("ticket-modal-close-btn", "button");
  const tabRich = doc.register("ticket-tab-rich", "button");
  const tabPlain = doc.register("ticket-tab-plain", "button");
  const richView = doc.register("ticket-rich-view", "div");
  const plainView = doc.register("ticket-plain-view", "pre");
  const summary = doc.register("ticket-modal-summary", "div");
  const copyBtn = doc.register("ticket-modal-copy-btn", "button");
  const createBtn = doc.register("ticket-modal-create-btn", "button");
  const imageModal = doc.register("image-modal", "div");
  imageModal.hidden = true;

  const interactions: InteractionRecord[] = [
    {
      id: "click-focus",
      sessionId: "s",
      kind: "click",
      status: "confirmed",
      createdAt: 1000,
      page: { url: "https://example.com", title: "Page", frameId: 0 },
      input: { pointerType: "mouse", button: 0, isTrusted: true },
      coordinates: {} as any,
      element: { tagName: "INPUT", id: "name", classNames: [] } as any,
      screenshot: { status: "captured" },
    },
    {
      id: "input-name",
      sessionId: "s",
      kind: "input",
      status: "confirmed",
      createdAt: 1500,
      page: { url: "https://example.com", title: "Page", frameId: 0 },
      input: { pointerType: "mouse", button: 0, isTrusted: true },
      coordinates: {} as any,
      element: {
        tagName: "INPUT",
        id: "name",
        classNames: [],
        text: "Name",
      } as any,
      screenshot: { status: "captured" },
    },
    {
      id: "click-submit",
      sessionId: "s",
      kind: "click",
      status: "confirmed",
      createdAt: 3000,
      page: { url: "https://example.com", title: "Page", frameId: 0 },
      input: { pointerType: "mouse", button: 0, isTrusted: true },
      coordinates: {} as any,
      element: { tagName: "BUTTON", classNames: [], text: "Save" } as any,
      screenshot: { status: "captured" },
    },
  ];
  const consoleEntries: ConsoleEntry[] = [
    {
      id: "err-1",
      sessionId: "s",
      createdAt: 2000,
      level: "error",
      text: "Boom <error>",
    } as ConsoleEntry,
  ];
  const imgBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

  const controller = new PreviewController();
  if (opts?.preExcludeSteps) {
    // 模拟刷新页面后加载：excluded > 0，但 canUndo === false
    controller.loadSelection({
      sessionId: "s",
      excludedInteractionIds: interactions.map((i) => i.id),
      updatedAtEpochMs: 1,
    });
  }

  const getSnapshot = (): EvidencePackageSnapshot => {
    const included = controller.includedInteractions(interactions);
    const includedIds = new Set(included.map((i) => i.id));
    return {
      session: {
        id: "s-12345678",
        schemaVersion: 2,
        extensionVersion: "0.7.41",
        status: "PREVIEW_READY",
        target: {
          tabId: 1,
          initialUrl: "https://example.com",
          initialTitle: "Page",
        },
        options: { privacyMode: "safe" },
        timeline: {
          createdAtEpochMs: 1000,
          startedAtEpochMs: 1000,
          durationMs: 5000,
        },
        quality: { overall: "complete", issues: [] },
        nonce: "n",
      } as any,
      interactions: included,
      consoleEntries: controller.includedConsoleEntries(consoleEntries),
      networkEntries: [],
      interactionAssets: [
        {
          interactionId: "click-submit",
          bytes: imgBytes,
          mimeType: "image/png",
          width: 800,
          height: 600,
        },
      ].filter(
        (a) =>
          includedIds.has(a.interactionId) &&
          !controller.isScreenshotExcluded(a.interactionId)
      ),
      excluded: {
        interaction: controller.excludedCount("interaction"),
        console: controller.excludedCount("console"),
        network: 0,
      },
      ticketCuration: controller.ticketCuration(),
      hasMedia: false,
    };
  };

  const notifications: string[] = [];
  const cleanup = bindTicketPreviewModal({
    root: doc as unknown as Document,
    getPackageSnapshot: getSnapshot,
    getArtifactFilename: () => "report.zip",
    notify: (m) => notifications.push(m),
    openImageViewer: () => {},
    exportTicketZip: () => {},
    curation: {
      excludeInteractions: async (ids) =>
        controller.excludeMany("interaction", ids),
      excludeScreenshot: async (id) => controller.excludeScreenshot(id),
      excludeScreenshots: async (ids) => controller.excludeScreenshots(ids),
      excludeDiagnostic: async (kind, id) => controller.exclude(kind, id),
      setStepDescription: async (id, desc) =>
        controller.setStepDescription(id, desc),
      setTicketNarrative: async (patch, defaults) =>
        controller.setTicketNarrative(patch, defaults),
      restoreSteps: async () => controller.restore("interaction"),
      undo: async () => controller.undo(),
      redo: async () => controller.redo(),
      resetAll: async () => controller.resetTicketCuration(),
      canUndo: () => controller.canUndo,
      canRedo: () => controller.canRedo,
      hasAnyCuration: () => controller.hasAnyCuration(),
    },
  });

  return {
    doc,
    modal,
    previewBtn,
    tabRich,
    tabPlain,
    richView,
    plainView,
    summary,
    copyBtn,
    createBtn,
    imageModal,
    controller,
    notifications,
    cleanup,
  };
}

const flushMicrotasks = () => new Promise((r) => setTimeout(r, 0));

test("ticket-preview-modal: 删除步骤/报错/移除截图/⌘Z撤回与剪贴板净化", async () => {
  await setUserLanguagePreference("zh-CN");
  const prevWin = (globalThis as any).window;
  const prevClipboardItem = (globalThis as any).ClipboardItem;
  const prevNav = (globalThis as any).navigator;
  const copiedItems: Array<Record<string, Blob>> = [];
  (globalThis as any).window = {
    setTimeout,
    clearTimeout,
    matchMedia: () => ({ matches: true }),
    __WEB_BUG_REPORT_I18N__: { locale: "zh-CN", dict: zhDict },
  };
  (globalThis as any).ClipboardItem = class {
    constructor(public map: Record<string, Blob>) {}
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      platform: "MacIntel",
      clipboard: {
        write: async (items: Array<{ map: Record<string, Blob> }>) => {
          copiedItems.push(items[0].map);
        },
      },
    },
  });

  const fx = setupModalFixture();
  try {
    fx.previewBtn.click();
    assert.equal(fx.modal.hidden, false);
    assert.equal(
      fx.richView.querySelectorAll('[data-ticket-block="step"]').length,
      2
    );
    assert.ok(fx.richView.querySelector(".ticket-image-actions"));
    assert.match(fx.summary.textContent, /^2 步 · 1 图/);

    // 校验极简纯图标工具栏与图片精简文案
    const step1Buttons = fx.richView
      .querySelectorAll('[data-ticket-block="step"]')[0]
      .querySelectorAll(".ticket-block-btn");
    assert.equal(step1Buttons[0].textContent, "");
    assert.equal(step1Buttons[0].getAttribute("title"), "编辑");
    assert.equal(step1Buttons[0].getAttribute("aria-label"), "编辑");
    assert.equal(step1Buttons[1].textContent, "");
    assert.equal(step1Buttons[1].getAttribute("title"), "删除");
    assert.equal(step1Buttons[1].getAttribute("aria-label"), "删除");

    const imgRemoveBtn = fx.richView.querySelector(".ticket-image-remove-btn")!;
    const imgCopyBtn = fx.richView.querySelector(".ticket-image-copy-btn")!;
    assert.equal(imgRemoveBtn.querySelector("span")?.textContent, "移除");
    assert.equal(imgCopyBtn.querySelector("span")?.textContent, "复制");
    assert.equal(imgCopyBtn.getAttribute("title"), "复制图片");

    const initialErrBtn = fx.richView
      .querySelector('[data-ticket-block="console"]')!
      .querySelector(".ticket-block-btn")!;
    assert.equal(initialErrBtn.textContent, "");
    assert.equal(initialErrBtn.getAttribute("title"), "移除");

    // 1. 删除第 1 步（合并步骤）：click-focus 与 input-name 一起排除
    const step1 = fx.richView.querySelectorAll('[data-ticket-block="step"]')[0];
    const delBtn = step1.querySelectorAll(".ticket-block-btn")[1];
    delBtn.click();
    await flushMicrotasks();
    assert.equal(
      fx.richView.querySelectorAll('[data-ticket-block="step"]').length,
      1
    );
    assert.equal(fx.controller.excludedCount("interaction"), 2);

    const footerCurationBtns = fx.summary.querySelectorAll(
      ".ticket-curation-btn"
    );
    assert.equal(footerCurationBtns.length, 2);
    assert.equal(footerCurationBtns[0].textContent, "");
    assert.equal(footerCurationBtns[0].getAttribute("title"), "撤回 (⌘Z)");
    assert.equal(footerCurationBtns[1].textContent, "");
    assert.equal(footerCurationBtns[1].getAttribute("title"), "重置草稿");

    // 2. 移除剩余步骤的截图，文字保留
    const removeImgBtn = fx.richView.querySelector(".ticket-image-remove-btn")!;
    removeImgBtn.click();
    await flushMicrotasks();
    assert.equal(fx.richView.querySelectorAll("img").length, 0);
    assert.equal(
      fx.richView.querySelectorAll('[data-ticket-block="step"]').length,
      1
    );

    // 3. 删除控制台报错
    const errBlock = fx.richView.querySelector(
      '[data-ticket-block="console"]'
    )!;
    errBlock.querySelector(".ticket-block-btn")!.click();
    await flushMicrotasks();
    assert.equal(
      fx.richView.querySelectorAll('[data-ticket-block="console"]').length,
      0
    );

    // 4. 按 ⌘Z 撤回最后一步（恢复控制台报错），之前删除的步骤不反弹
    fx.doc.dispatchKey({ key: "z", metaKey: true });
    await flushMicrotasks();
    assert.equal(
      fx.richView.querySelectorAll('[data-ticket-block="console"]').length,
      1
    );
    assert.equal(
      fx.richView.querySelectorAll('[data-ticket-block="step"]').length,
      1
    );

    // 5. 内联编辑：进入编辑态给宿主添加 is-editing、支持取消与点击✓确认保存（含保存脉冲动效），IME 回车不提前提交
    const stepHost = fx.richView.querySelector('[data-ticket-block="step"]')!;
    const slot = fx.richView.querySelector('[data-ticket-slot="step-desc"]')!;
    slot.click();
    assert.equal(stepHost.classList.contains("is-editing"), true);
    assert.ok(fx.richView.querySelector(".ticket-inline-editor"));
    const cancelBtn = fx.richView.querySelector(".ticket-inline-cancel")!;
    cancelBtn.click();
    assert.equal(stepHost.classList.contains("is-editing"), false);
    assert.equal(fx.richView.querySelector(".ticket-inline-editor"), null);

    // 再次点击编辑并点 ✓ 确认保存，验证持久化、Markdown 同步与保存成功动效
    fx.richView.querySelector('[data-ticket-slot="step-desc"]')!.click();
    const editor2 = fx.richView.querySelector(".ticket-inline-input")!;
    editor2.value = "点击提交按钮";
    fx.richView.querySelector(".ticket-inline-confirm")!.click();
    await flushMicrotasks();
    assert.equal(
      fx.controller.ticketCuration().customStepDescriptions["click-submit"],
      "点击提交按钮"
    );
    assert.ok(fx.plainView.textContent.includes("1. 点击提交按钮"));
    assert.ok(fx.richView.querySelector(".ticket-slot-just-saved"));

    // 再次编辑：IME 组字回车不提交；编辑态直接点复制可同步拿到新文案且剪贴板无辅助按钮
    fx.richView.querySelector('[data-ticket-slot="step-desc"]')!.click();
    const editor = fx.richView.querySelector(".ticket-inline-input")!;
    editor.value = "点击保存并提交表单";
    editor.dispatch("keydown", { key: "Enter", isComposing: true });
    // 仍在编辑态，未提前提交
    assert.ok(fx.richView.querySelector(".ticket-inline-input"));

    // 不等 blur，直接点击“复制工单内容”
    fx.copyBtn.click();
    await flushMicrotasks();
    assert.equal(copiedItems.length, 1);
    const copiedHtml = await copiedItems[0]["text/html"].text();
    const copiedText = await copiedItems[0]["text/plain"].text();
    assert.ok(copiedHtml.includes("点击保存并提交表单"));
    assert.ok(copiedText.includes("1. 点击保存并提交表单"));
    assert.ok(!copiedHtml.includes("ticket-block-btn"));
    assert.ok(!copiedHtml.includes("ticket-inline-input"));
    assert.ok(!copiedHtml.includes("ticket-inline-editor"));
    assert.ok(!copiedHtml.includes("ticket-add-expected-btn"));

    // 6. 大图查看器打开时，Escape 与 ⌘Z 不影响工单弹窗
    fx.imageModal.hidden = false;
    fx.doc.dispatchKey({ key: "z", metaKey: true });
    fx.doc.dispatchKey({ key: "Escape" });
    await flushMicrotasks();
    assert.equal(fx.modal.hidden, false);
    assert.equal(
      fx.richView.querySelectorAll('[data-ticket-block="console"]').length,
      1
    );
  } finally {
    fx.cleanup();
    (globalThis as any).window = prevWin;
    (globalThis as any).ClipboardItem = prevClipboardItem;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: prevNav,
    });
  }
});

test("ticket-preview-modal: 刷新后步骤已删空（canUndo=false）仍提供恢复全部步骤入口", async () => {
  await setUserLanguagePreference("zh-CN");
  const prevWin = (globalThis as any).window;
  (globalThis as any).window = {
    setTimeout,
    clearTimeout,
    matchMedia: () => ({ matches: true }),
    __WEB_BUG_REPORT_I18N__: { locale: "zh-CN", dict: zhDict },
  };
  const fx = setupModalFixture({ preExcludeSteps: true });
  try {
    fx.previewBtn.click();
    const empty = fx.richView.querySelector('[data-ticket-empty="steps"]')!;
    assert.equal(empty.tagName, "P");
    const restoreBtn = empty.querySelector(".ticket-inline-link")!;
    assert.ok(restoreBtn.textContent.includes("恢复全部步骤"));
    restoreBtn.click();
    await flushMicrotasks();
    assert.equal(
      fx.richView.querySelectorAll('[data-ticket-block="step"]').length,
      2
    );
  } finally {
    fx.cleanup();
    (globalThis as any).window = prevWin;
  }
});

test("ticket-preview-modal: 异步保存串行排队不丢数据，编辑态直接提工单等待保存完成后再导出", async () => {
  await setUserLanguagePreference("zh-CN");
  const prevWin = (globalThis as any).window;
  const prevNav = (globalThis as any).navigator;
  const prevClipboardItem = (globalThis as any).ClipboardItem;
  const copiedHtmlList: string[] = [];

  (globalThis as any).window = {
    setTimeout,
    clearTimeout,
    matchMedia: () => ({ matches: true }),
    __WEB_BUG_REPORT_I18N__: { locale: "zh-CN", dict: zhDict },
  };
  (globalThis as any).ClipboardItem = class MockClipboardItem {
    items: Record<string, Blob>;
    constructor(items: Record<string, Blob>) {
      this.items = items;
    }
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      clipboard: {
        write: async (items: any[]) => {
          copiedHtmlList.push(await items[0].items["text/html"].text());
        },
      },
    },
  });

  const fx = setupModalFixture();
  const prevCreateDoc = fx.doc.createElement.bind(fx.doc);
  let exportCount = 0;
  let savedValues: string[] = [];
  let inFlightSaves = 0;
  let maxConcurrentSaves = 0;

  // 改用带延迟异步保存的自定义 modal 绑定，验证串行队列与提工单等待保存竞态
  fx.cleanup();
  const delayedCleanup = bindTicketPreviewModal({
    root: fx.doc as unknown as Document,
    getPackageSnapshot: () => ({
      session: {
        id: "s-12345678",
        schemaVersion: 2,
        extensionVersion: "0.7.41",
        status: "PREVIEW_READY",
        target: {
          tabId: 1,
          initialUrl: "https://example.com",
          initialTitle: "Page",
        },
        options: { privacyMode: "safe" },
        timeline: {
          createdAtEpochMs: 1000,
          startedAtEpochMs: 1000,
          durationMs: 5000,
        },
        quality: { overall: "complete", issues: [] },
        nonce: "n",
      } as any,
      interactions: fx.controller.includedInteractions([
        {
          id: "click-submit",
          sessionId: "s",
          kind: "click",
          status: "confirmed",
          createdAt: 3000,
          page: { url: "https://example.com", title: "Page", frameId: 0 },
          input: { pointerType: "mouse", button: 0, isTrusted: true },
          coordinates: {} as any,
          element: { tagName: "BUTTON", classNames: [], text: "Save" } as any,
          screenshot: { status: "captured" },
        },
      ]),
      consoleEntries: [],
      networkEntries: [],
      excluded: {
        interaction: fx.controller.excludedCount("interaction"),
        console: 0,
        network: 0,
      },
      ticketCuration: fx.controller.ticketCuration(),
      hasMedia: false,
    }),
    getArtifactFilename: () => "report.zip",
    notify: () => {},
    openImageViewer: () => {},
    exportTicketZip: () => {
      exportCount++;
    },
    curation: {
      excludeInteractions: async (ids) => {
        inFlightSaves++;
        maxConcurrentSaves = Math.max(maxConcurrentSaves, inFlightSaves);
        await new Promise((r) => setTimeout(r, 15));
        fx.controller.excludeMany("interaction", ids);
        inFlightSaves--;
      },
      excludeScreenshot: async () => {},
      excludeDiagnostic: async () => {},
      setStepDescription: async (id, desc) => {
        inFlightSaves++;
        maxConcurrentSaves = Math.max(maxConcurrentSaves, inFlightSaves);
        await new Promise((r) => setTimeout(r, 20));
        fx.controller.setStepDescription(id, desc);
        if (desc) savedValues.push(desc);
        inFlightSaves--;
      },
      setTicketNarrative: async (patch, defaults) =>
        fx.controller.setTicketNarrative(patch, defaults),
      restoreSteps: async () => fx.controller.restore("interaction"),
      undo: async () => fx.controller.undo(),
      redo: async () => fx.controller.redo(),
      resetAll: async () => fx.controller.resetTicketCuration(),
      canUndo: () => fx.controller.canUndo,
      canRedo: () => fx.controller.canRedo,
      hasAnyCuration: () => fx.controller.hasAnyCuration(),
    },
  });

  try {
    void prevCreateDoc;
    fx.previewBtn.click();
    fx.richView.querySelector('[data-ticket-slot="step-desc"]')!.click();
    const editor = fx.richView.querySelector(".ticket-inline-input")!;
    editor.value = "异步保存的新步骤文案";

    // 编辑态直接点「提工单并下载」，不先触发 blur
    fx.createBtn.click();
    await new Promise((r) => setTimeout(r, 60));

    assert.equal(maxConcurrentSaves, 1);
    assert.deepEqual(savedValues, ["异步保存的新步骤文案"]);
    assert.equal(exportCount, 1);
    assert.equal(fx.modal.hidden, true);
    assert.equal(copiedHtmlList.length, 1);
    assert.ok(copiedHtmlList[0].includes("异步保存的新步骤文案"));
  } finally {
    delayedCleanup();
    (globalThis as any).window = prevWin;
    (globalThis as any).ClipboardItem = prevClipboardItem;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: prevNav,
    });
  }
});
