import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  filterNetworkEntries,
  selectActiveNetworkId,
} from "../src/preview/network-filter.ts";

import type { NetworkEntry } from "../src/shared/protocol.ts";

const mockNetworkEntries: NetworkEntry[] = [
  {
    id: "n1",
    createdAt: 1000,
    method: "GET",
    url: "https://api.example.com/v1/users?page=1",
    status: 200,
  },
  {
    id: "n2",
    createdAt: 2000,
    method: "POST",
    url: "https://api.example.com/v1/users",
    status: 201,
  },
  {
    id: "n3",
    createdAt: 3000,
    method: "GET",
    url: "https://cdn.example.com/assets/app.js",
    status: 304,
  },
  {
    id: "n4",
    createdAt: 4000,
    method: "DELETE",
    url: "https://api.example.com/v1/users/42",
    status: 404,
  },
  {
    id: "n5",
    createdAt: 5000,
    method: "POST",
    url: "https://analytics.example.com/collect",
    status: 500,
  },
];

test("NetworkTab - 5项搜索、大小写忽略、自动重选与空状态测试", () => {
  // 1. 按 URL (忽略大小写) 搜索
  const searchLower = filterNetworkEntries(mockNetworkEntries, "USERS");
  assert.equal(searchLower.length, 3);
  assert.deepEqual(
    searchLower.map((e) => e.id),
    ["n1", "n2", "n4"]
  );

  const searchUpper = filterNetworkEntries(mockNetworkEntries, "analytics");
  assert.equal(searchUpper.length, 1);
  assert.equal(searchUpper[0].id, "n5");

  // 2. 计数文本逻辑校验
  const countText = `共 ${searchLower.length} 条`;
  assert.equal(countText, "共 3 条");

  // 3. 选中项排除后自动重选逻辑
  // 初始选中 n1
  let currentSelectedId: string | null = "n1";
  // 排除 n1 后剩余 [n2, n3, n4, n5]
  const remainingAfterN1 = mockNetworkEntries.filter((e) => e.id !== "n1");
  currentSelectedId = selectActiveNetworkId(remainingAfterN1, "n1");
  assert.equal(
    currentSelectedId,
    "n5",
    "排除当前选中项后应自动重选最后一个有效项 (列表翻转展现的首位)"
  );

  // 若全部排除空列表
  const emptyList: NetworkEntry[] = [];
  currentSelectedId = selectActiveNetworkId(emptyList, "n5");
  assert.equal(currentSelectedId, null, "列表为空时 selectedId 为 null");

  // 4. 无匹配记录
  const noMatch = filterNetworkEntries(
    mockNetworkEntries,
    "non-existent-domain.org"
  );
  assert.equal(noMatch.length, 0);

  // 5. 搜索和方法筛选组合生效
  const postUsers = filterNetworkEntries(mockNetworkEntries, "users", "POST");
  assert.equal(postUsers.length, 1);
  assert.equal(postUsers[0].id, "n2");
});

test("NetworkTab 复制代码片段反馈必须走 i18n（禁止硬编码中文）", () => {
  const networkTabCode = readFileSync(
    resolve(process.cwd(), "src/components/preview/NetworkTab.tsx"),
    "utf8"
  );
  const zhDict = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "src/_locales/zh_CN/messages.json"),
      "utf8"
    )
  );
  const enDict = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "src/_locales/en/messages.json"),
      "utf8"
    )
  );

  // 复制反馈（按钮文案 + toast）必须走 t()，不得残留硬编码中文字面量
  for (const hardcoded of ["已复制", "代码片段已成功复制到剪贴板"]) {
    assert.ok(
      !networkTabCode.includes(hardcoded),
      `NetworkTab 不得硬编码 '${hardcoded}'，应通过 i18n 提供`
    );
  }

  // 反馈文案必须使用带 $LABEL$ 占位符的通用 key（snippet 目标不止 cURL）
  assert.ok(
    networkTabCode.includes('t("snippetCopied"'),
    "按钮反馈应使用 snippetCopied key"
  );
  assert.ok(
    networkTabCode.includes('t("snippetCopiedNotify"'),
    "toast 反馈应使用 snippetCopiedNotify key"
  );

  // 新 key 必须在双语言 bundle 中齐全，且 en 文案不得混入中文
  for (const key of ["snippetCopied", "snippetCopiedNotify"]) {
    assert.ok(
      key in zhDict,
      `i18n key '${key}' used in NetworkTab.tsx is missing in zh_CN/messages.json`
    );
    assert.ok(
      key in enDict,
      `i18n key '${key}' used in NetworkTab.tsx is missing in en/messages.json`
    );
    assert.ok(
      !/[\u4e00-\u9fff]/.test(enDict[key].message),
      `en bundle 的 '${key}' 不得包含中文字符`
    );
  }

  // 中文 toast 文案应保留 "已复制 $LABEL$ 代码片段" 语义（而非退化为 cURL 专用）
  assert.ok(
    zhDict.snippetCopied.message.includes("$LABEL$"),
    "zh snippetCopied 应包含 $LABEL$ 占位符"
  );
  assert.ok(
    zhDict.snippetCopiedNotify.message.includes("$LABEL$"),
    "zh snippetCopiedNotify 应包含 $LABEL$ 占位符"
  );
});
