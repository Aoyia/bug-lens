import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { h } from "preact";
import render from "preact-render-to-string";
import { ConsoleTab } from "../src/components/preview/ConsoleTab.tsx";

import type { ConsoleEntry } from "../src/shared/protocol.ts";

const entries: ConsoleEntry[] = [
  {
    id: "c1",
    createdAt: 1000,
    level: "error",
    text: "Uncaught TypeError",
    source: "app.js",
  },
  {
    id: "c2",
    createdAt: 2000,
    level: "log",
    text: "mounted",
    source: "app.js",
  },
];

test("ConsoleTab 日志行必须键盘可达（tabIndex=0）", () => {
  const html = render(
    h(ConsoleTab, {
      snapshot: { session: undefined, all: entries, included: entries },
      editable: false,
    })
  );
  const rows = (html.match(/class="console-row /g) || []).length;
  assert.equal(rows, 2, "应渲染 2 行日志");

  const focusable = (html.match(/tabindex="0"/g) || []).length;
  assert.equal(
    focusable,
    2,
    "每行日志都应可聚焦（tabIndex=0），否则键盘无法逐个访问日志并 seek 视频"
  );
});

test("ConsoleTab 行键盘激活与点击共享同一选择处理器", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/components/preview/ConsoleTab.tsx"),
    "utf8"
  );
  assert.ok(source.includes("onKeyDown"), "日志行应绑定键盘事件处理器");
  assert.ok(source.includes("tabIndex={0}"), "日志行应声明 tabIndex={0}");
  assert.ok(source.includes("aria-current"), "日志行应暴露 aria-current 当前态");
  assert.match(
    source,
    /handleRowClick\(entry\.id,\s*entry\.createdAt\)/,
    "键盘激活应复用与 onClick 相同的 handleRowClick 选择处理器"
  );
});

test("ConsoleTab 键盘激活不劫持内嵌删除按钮的 Enter", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/components/preview/ConsoleTab.tsx"),
    "utf8"
  );
  // 行内删除按钮是独立可交互控件：聚焦删除按钮按 Enter 应走按钮自身 delete
  // 语义，而非冒泡触发行的 seek 选择。行 onKeyDown 必须跳过源自内嵌按钮的按键。
  assert.match(
    source,
    /closest\(["']button/,
    "行键盘处理器应跳过源自内嵌按钮的按键事件，避免 Enter 误触 seek 而吞掉删除"
  );
});

test("console.css 为键盘聚焦提供可见样式", () => {
  const css = readFileSync(
    resolve(process.cwd(), "src/entrypoints/preview/styles/console.css"),
    "utf8"
  );
  assert.ok(
    /\.console-row:focus-visible/.test(css),
    "console.css 应包含 .console-row:focus-visible 焦点样式，避免键盘聚焦不可见"
  );
});
