import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PreviewPageShell } from "../src/preview/page-shell.ts";

/**
 * 预览页 / 离线报告的 Toast（#toast-message）是全页唯一的瞬时反馈通道：
 * 导出成功/失败、复制 AI 提示词 / 步骤 / cURL、图片下载等都靠它告知用户。
 * 但它此前没有 live region 语义，屏幕阅读器用户收不到任何播报。
 *
 * 本测试锁定两条契约：
 *   1. 两个入口 HTML 的 #toast-message 都是 polite live region
 *      （role="status" + aria-live="polite"，且不得 aria-hidden）。
 *   2. notify() 先取消 hidden 再写文案（对齐同页 privacy-badge 的顺序），
 *      保证 live region 先进入无障碍树再更新内容，播报才可靠。
 */

function readToastTag(entryHtml: string): string {
  const html = readFileSync(resolve(process.cwd(), entryHtml), "utf8");
  const idx = html.indexOf('id="toast-message"');
  assert.notEqual(idx, -1, `${entryHtml} 缺少 #toast-message 元素`);
  const start = html.lastIndexOf("<", idx);
  const end = html.indexOf(">", idx);
  assert.ok(
    start >= 0 && end > idx,
    `${entryHtml} 的 #toast-message 标签无法定位`
  );
  return html.slice(start, end + 1);
}

test("preview/index.html 的 #toast-message 是 polite live region", () => {
  const tag = readToastTag("src/entrypoints/preview/index.html");
  assert.match(tag, /role="status"/, "缺少 role=\"status\"");
  assert.match(tag, /aria-live="polite"/, "缺少 aria-live=\"polite\"");
  assert.doesNotMatch(tag, /aria-hidden="true"/, "live region 不得 aria-hidden");
});

test("report/index.html 的 #toast-message 是 polite live region", () => {
  const tag = readToastTag("src/entrypoints/report/index.html");
  assert.match(tag, /role="status"/, "缺少 role=\"status\"");
  assert.match(tag, /aria-live="polite"/, "缺少 aria-live=\"polite\"");
  assert.doesNotMatch(tag, /aria-hidden="true"/, "live region 不得 aria-hidden");
});

test("notify() 先取消 hidden 再写文案，保证 live region 播报可靠", () => {
  const ops: string[] = [];
  let hiddenValue = true;
  let textValue = "";
  const toast = {
    get hidden() {
      return hiddenValue;
    },
    set hidden(v: boolean) {
      hiddenValue = v;
      ops.push(`hidden=${v}`);
    },
    get textContent() {
      return textValue;
    },
    set textContent(v: string) {
      textValue = v;
      ops.push(`text=${v}`);
    },
  };

  const pendingTimers: Array<() => void> = [];
  const fakeWindow = {
    setTimeout: (fn: () => void) => {
      pendingTimers.push(fn);
      return pendingTimers.length;
    },
    clearTimeout: () => {},
  };
  const globalScope = globalThis as Record<string, unknown>;
  const prevWindow = globalScope.window;
  globalScope.window = fakeWindow;

  const doc = {
    querySelector: (selector: string) =>
      selector === "#toast-message" ? toast : null,
    querySelectorAll: () => [],
    addEventListener: () => {},
  } as unknown as Document;

  try {
    const shell = new PreviewPageShell(doc, () => {});
    shell.notify("导出完成");

    // 同步阶段只应发生两次写操作，且顺序必须是「先显示、后写文案」。
    assert.deepEqual(
      ops.slice(0, 2),
      ["hidden=false", "text=导出完成"],
      "必须先取消 hidden 再写入文案，否则 live region 播报不可靠"
    );
  } finally {
    globalScope.window = prevWindow;
  }
});
