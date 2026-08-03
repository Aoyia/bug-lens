import assert from "node:assert/strict";
import test from "node:test";
import { filterConsoleEntries } from "../src/preview/console-filter.ts";

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
