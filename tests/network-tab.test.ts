import assert from "node:assert/strict";
import test from "node:test";
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
