import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { h } from "preact";
import render from "preact-render-to-string";
import { filterConsoleEntries } from "../src/preview/console-filter.ts";
import { ConsoleTab } from "../src/components/preview/ConsoleTab.tsx";

import type { ConsoleEntry } from "../src/shared/protocol.ts";

const mockConsoleEntries: ConsoleEntry[] = [
  {
    id: "c1",
    createdAt: 1000,
    level: "log",
    text: "Application initialized",
    source: "app.js",
  },
  {
    id: "c2",
    createdAt: 2000,
    level: "warn",
    text: "Deprecated API called",
    source: "util.js",
  },
  {
    id: "c3",
    createdAt: 3000,
    level: "warning",
    text: "Memory threshold high",
    source: "system.js",
  },
  {
    id: "c4",
    createdAt: 4000,
    level: "error",
    text: "Failed to fetch user data",
    source: "api.js",
  },
  {
    id: "c5",
    createdAt: 5000,
    level: "debug",
    text: "State updated: { count: 1 }",
    source: "store.js",
  },
  {
    id: "c6",
    createdAt: 6000,
    level: "info",
    text: "User logged in",
    source: "auth.js",
  },
];

test("ConsoleTab - 7项搜索与筛选组合行为测试", () => {
  // 1. 无搜索词、level=all 时展示全部记录
  const allRes = filterConsoleEntries(mockConsoleEntries, "all", "");
  assert.equal(allRes.length, 6);

  // 2. 输入搜索词后，只展示文本、source 或 level 匹配的记录
  const searchRes = filterConsoleEntries(mockConsoleEntries, "all", "user");
  assert.equal(searchRes.length, 2); // c4 ("user data") 和 c6 ("User logged in")
  assert.deepEqual(
    searchRes.map((e) => e.id),
    ["c4", "c6"]
  );

  const sourceRes = filterConsoleEntries(mockConsoleEntries, "all", "store.js");
  assert.equal(sourceRes.length, 1);
  assert.equal(sourceRes[0].id, "c5");

  // 3. level 筛选和搜索词必须同时生效
  const combinedRes = filterConsoleEntries(mockConsoleEntries, "error", "user");
  assert.equal(combinedRes.length, 1);
  assert.equal(combinedRes[0].id, "c4");

  // 4. warning 应兼容 warn 和 warning
  const warnRes = filterConsoleEntries(mockConsoleEntries, "warning", "");
  assert.equal(warnRes.length, 2);
  assert.deepEqual(
    warnRes.map((e) => e.id),
    ["c2", "c3"]
  );

  // 5. debug 应兼容 debug 和 log
  const debugRes = filterConsoleEntries(mockConsoleEntries, "debug", "");
  assert.equal(debugRes.length, 2);
  assert.deepEqual(
    debugRes.map((e) => e.id),
    ["c1", "c5"]
  );

  // 6. 计数文本逻辑断言
  const countTextAll = `匹配 ${allRes.length} / ${mockConsoleEntries.length} 条`;
  assert.equal(countTextAll, "匹配 6 / 6 条");

  const countTextFiltered = `匹配 ${combinedRes.length} / ${mockConsoleEntries.length} 条`;
  assert.equal(countTextFiltered, "匹配 1 / 6 条");

  // 7. 无匹配情况
  const emptyRes = filterConsoleEntries(
    mockConsoleEntries,
    "error",
    "nonexistent-keyword"
  );
  assert.equal(emptyRes.length, 0);
});

test("ConsoleTab 初始渲染不包含任何选中行", () => {
  const html = render(
    h(ConsoleTab, {
      snapshot: {
        session: undefined,
        all: mockConsoleEntries,
        included: mockConsoleEntries,
      },
      editable: false,
    })
  );
  // 行结构保留
  assert.match(html, /class="console-row console-row-log"/);
  assert.match(html, /class="console-row console-row-error"/);
  // 默认无选中态，避免误高亮（<option selected> 是 select 默认值，不在检查范围）
  assert.doesNotMatch(
    html,
    /console-row[^>]*\bselected\b/,
    "初始渲染的日志行不应出现 selected 选中态"
  );
});

test("ConsoleTab 行点击选中态 class 与样式规则存在（防 UI 回归）", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/components/preview/ConsoleTab.tsx"),
    "utf8"
  );
  // 点击行时应记录选中 id，并在行 class 上拼接 selected
  assert.ok(source.includes("setSelectedId"), "行点击应记录选中 id");
  assert.ok(
    source.includes('" selected"'),
    "选中行应拼接 selected class，提供点击反馈"
  );
  const css = readFileSync(
    resolve(process.cwd(), "src/entrypoints/preview/styles/console.css"),
    "utf8"
  );
  assert.ok(
    css.includes(".console-row.selected"),
    "console.css 应包含选中行高亮规则"
  );
});

test("Console 日志行可点击暗示与 Network 行保持一致（cursor: pointer）", () => {
  // Console 行点击会跳转视频到该日志时间点（ConsoleTab 行 onClick → onSeekVideo），
  // 且 hover 已有背景反馈暗示可交互；光标必须同步为 pointer，避免
  // "看着可点、光标无确认"的感知断裂（与 .network-row 及历史会话卡片同款契约）。
  const consoleCss = readFileSync(
    resolve(process.cwd(), "src/entrypoints/preview/styles/console.css"),
    "utf8"
  );
  const networkCss = readFileSync(
    resolve(process.cwd(), "src/entrypoints/preview/styles/network.css"),
    "utf8"
  );

  assert.ok(
    /\.console-row\s*\{[^}]*cursor:\s*pointer;/.test(consoleCss),
    ".console-row must declare cursor: pointer"
  );
  assert.ok(
    /\.network-row\s*\{[^}]*cursor:\s*pointer;/.test(networkCss),
    ".network-row cursor: pointer must exist as the reference"
  );
});

test("ConsoleTab 删除按钮应当具备可访问性 aria-label 属性", () => {
  const html = render(
    h(ConsoleTab, {
      snapshot: {
        session: undefined,
        all: mockConsoleEntries,
        included: mockConsoleEntries,
      },
      editable: true,
    })
  );
  assert.match(
    html,
    /aria-label="[^"]+"/,
    "ConsoleTab 可编辑模式下的删除按钮应包含 aria-label 属性"
  );
});
