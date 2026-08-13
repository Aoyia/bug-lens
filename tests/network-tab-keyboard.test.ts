import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { h } from "preact";
import render from "preact-render-to-string";
import { NetworkTab } from "../src/components/preview/NetworkTab.tsx";

import type { NetworkEntry } from "../src/shared/protocol.ts";

const entries: NetworkEntry[] = [
  {
    id: "n1",
    createdAt: 1000,
    method: "GET",
    url: "https://api.example.com/v1/users",
    status: 200,
  },
  {
    id: "n2",
    createdAt: 2000,
    method: "POST",
    url: "https://api.example.com/v1/users",
    status: 500,
  },
];

test("NetworkTab 请求行必须键盘可达（tabIndex=0）", () => {
  const html = render(
    h(NetworkTab, {
      snapshot: { session: undefined, all: entries, included: entries },
      editable: false,
    })
  );
  const rows = (html.match(/class="network-row/g) || []).length;
  assert.equal(rows, 2, "应渲染 2 行网络请求");

  const focusable = (html.match(/tabindex="0"/g) || []).length;
  assert.equal(
    focusable,
    2,
    "每行请求都应可聚焦（tabIndex=0），否则键盘无法逐个访问请求"
  );
});

test("NetworkTab 选中行通过 aria-current 暴露当前项（仅选中行）", () => {
  const html = render(
    h(NetworkTab, {
      snapshot: { session: undefined, all: entries, included: entries },
      editable: false,
    })
  );
  // 列表翻转后默认自动选中最后一条 n2，因此应恰好一行带 aria-current="true"
  const currentMatches = html.match(/aria-current="true"/g) || [];
  assert.equal(
    currentMatches.length,
    1,
    "仅当前选中的请求行应标记 aria-current=\"true\""
  );
});

test("NetworkTab 行键盘激活与点击共享同一选择处理器", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/components/preview/NetworkTab.tsx"),
    "utf8"
  );
  assert.ok(source.includes("onKeyDown"), "网络行应绑定键盘事件处理器");
  assert.ok(source.includes("tabIndex={0}"), "网络行应声明 tabIndex={0}");
  assert.ok(
    source.includes("aria-current"),
    "网络行应暴露 aria-current 当前态"
  );
  assert.match(
    source,
    /handleRowClick\(entry\.id,\s*entry\.createdAt\)/,
    "键盘激活应复用与 onClick 相同的 handleRowClick 选择处理器"
  );
});

test("network.css 为键盘聚焦提供可见样式", () => {
  const css = readFileSync(
    resolve(process.cwd(), "src/entrypoints/preview/styles/network.css"),
    "utf8"
  );
  assert.ok(
    /\.network-row:focus-visible/.test(css),
    "network.css 应包含 .network-row:focus-visible 焦点样式，避免键盘聚焦不可见"
  );
});
