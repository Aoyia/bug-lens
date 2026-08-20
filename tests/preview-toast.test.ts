import assert from "node:assert/strict";
import test from "node:test";
import { PreviewPageShell } from "../src/preview/page-shell.ts";

/**
 * PreviewPageShell.notify 的展示时长契约：
 * Toast 承诺展示 2.5s；连续通知必须重置隐藏计时，否则旧通知的定时器
 * 会提前截断最新一条（复现路径：预览页快速连续复制步骤/定位器/curl 片段）。
 */
test("PreviewPageShell.notify 连续调用会重置隐藏定时器，不被旧通知提前关闭", () => {
  // ── 假定时器：捕获 setTimeout/clearTimeout，便于手动推进 ──
  const pendingTimers: Array<{ id: number; fn: () => void }> = [];
  let nextTimerId = 1;
  const fakeWindow = {
    setTimeout: (fn: () => void) => {
      const id = nextTimerId++;
      pendingTimers.push({ id, fn });
      return id;
    },
    clearTimeout: (id: number) => {
      const idx = pendingTimers.findIndex((t) => t.id === id);
      if (idx >= 0) pendingTimers.splice(idx, 1);
    },
  };
  const globalScope = globalThis as Record<string, unknown>;
  const prevWindow = globalScope.window;
  globalScope.window = fakeWindow;

  // ── 最小 DOM mock：只需 #toast-message，其余元素按缺失处理 ──
  const toast = { textContent: "", hidden: true };
  const doc = {
    querySelector: (selector: string) =>
      selector === "#toast-message" ? toast : null,
    querySelectorAll: () => [],
    addEventListener: () => {},
  } as unknown as Document;

  try {
    const shell = new PreviewPageShell(doc, () => {});

    shell.notify("第一条通知");
    assert.equal(pendingTimers.length, 1, "首条通知应挂载一个隐藏定时器");

    shell.notify("第二条通知");
    assert.equal(toast.textContent, "第二条通知", "应展示最新通知文案");
    assert.equal(toast.hidden, false, "通知应处于可见状态");
    assert.equal(
      pendingTimers.length,
      1,
      "旧通知的隐藏定时器应被清理，只保留最新一条"
    );

    // 推进最新定时器：到点时 Toast 才隐藏（模拟定时器到点后自然消亡）
    const timer = pendingTimers[0]!;
    pendingTimers.splice(0, 1);
    timer.fn();
    assert.equal(toast.hidden, true, "最新通知展示满 2.5s 后应隐藏");

    // 定时器到点后再来新通知：应重新挂载一条新定时器，不残留旧逻辑
    shell.notify("第三条通知");
    assert.equal(toast.textContent, "第三条通知");
    assert.equal(pendingTimers.length, 1, "后续通知应重新挂载隐藏定时器");
  } finally {
    globalScope.window = prevWindow;
  }
});

test("PreviewPageShell.notify 单次通知按 4.0s 展示后隐藏，且支持换行/结构化分层", () => {
  const pendingTimers: Array<{ id: number; fn: () => void }> = [];
  let nextTimerId = 1;
  const fakeWindow = {
    setTimeout: (fn: () => void) => {
      const id = nextTimerId++;
      pendingTimers.push({ id, fn });
      return id;
    },
    clearTimeout: (id: number) => {
      const idx = pendingTimers.findIndex((t) => t.id === id);
      if (idx >= 0) pendingTimers.splice(idx, 1);
    },
  };
  const globalScope = globalThis as Record<string, unknown>;
  const prevWindow = globalScope.window;
  globalScope.window = fakeWindow;

  const toast = {
    textContent: "",
    innerHTML: "",
    hidden: true,
    addEventListener: () => {},
  };
  const doc = {
    querySelector: (selector: string) =>
      selector === "#toast-message" ? toast : null,
    querySelectorAll: () => [],
    addEventListener: () => {},
  } as unknown as Document;

  try {
    const shell = new PreviewPageShell(doc, () => {});
    shell.notify("首行标题\n次行副标题");
    assert.equal(toast.hidden, false);
    assert.ok(toast.innerHTML.includes("首行标题"));
    assert.ok(toast.innerHTML.includes("次行副标题"));
    assert.equal(pendingTimers.length, 1);

    pendingTimers[0]!.fn();
    assert.equal(toast.hidden, true);
  } finally {
    globalScope.window = prevWindow;
  }
});

test("PreviewPageShell.notify 支持 aiPromptCopied 双行提示", () => {
  const pendingTimers: Array<{ id: number; fn: () => void }> = [];
  let nextTimerId = 1;
  const fakeWindow = {
    setTimeout: (fn: () => void) => {
      const id = nextTimerId++;
      pendingTimers.push({ id, fn });
      return id;
    },
    clearTimeout: (id: number) => {
      const idx = pendingTimers.findIndex((t) => t.id === id);
      if (idx >= 0) pendingTimers.splice(idx, 1);
    },
  };
  const globalScope = globalThis as Record<string, unknown>;
  const prevWindow = globalScope.window;
  globalScope.window = fakeWindow;

  const toast = {
    textContent: "",
    innerHTML: "",
    hidden: true,
    addEventListener: () => {},
  };
  const doc = {
    querySelector: (selector: string) =>
      selector === "#toast-message" ? toast : null,
    querySelectorAll: () => [],
    addEventListener: () => {},
  } as unknown as Document;

  try {
    const shell = new PreviewPageShell(doc, () => {});
    shell.notify(
      "AI Prompt 已复制\n直接在 Cursor / Claude 中按 ⌘V 粘贴即可排查"
    );
    assert.equal(toast.hidden, false);
    assert.ok(toast.innerHTML.includes("AI Prompt 已复制"));
    assert.ok(toast.innerHTML.includes("toast-kbd"));
  } finally {
    globalScope.window = prevWindow;
  }
});
