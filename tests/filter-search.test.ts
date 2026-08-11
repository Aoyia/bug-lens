import assert from "node:assert/strict";
import test from "node:test";
import { handleFilterEscape } from "../src/preview/filter-search.ts";

/**
 * 过滤输入框 Esc 清空契约：
 * 焦点在 Console / Network 过滤框且存在查询词时，按 Esc 一键清空并阻止
 * 事件继续传播（对齐 DevTools 肌肉记忆）；空查询或非 Esc 键时完全放行，
 * 不改变任何既有行为。
 */
function createFakeEvent() {
  let prevented = false;
  let stopped = false;
  return {
    event: {
      key: "",
      preventDefault: () => {
        prevented = true;
      },
      stopPropagation: () => {
        stopped = true;
      },
    },
    isPrevented: () => prevented,
    isStopped: () => stopped,
  };
}

test("过滤框有查询词时按 Esc：清空查询并阻止事件传播", () => {
  const { event, isPrevented, isStopped } = createFakeEvent();
  event.key = "Escape";
  let clearedQuery: string | undefined;
  handleFilterEscape(event, "users?page=1", (query) => {
    clearedQuery = query;
  });
  assert.equal(clearedQuery, "", "应调用 setSearchQuery 清空查询词");
  assert.equal(isPrevented(), true, "应阻止默认行为");
  assert.equal(isStopped(), true, "应阻止事件冒泡，避免误触其他 Esc 绑定");
});

test("过滤框为空查询时按 Esc：完全放行，不清空也不拦截", () => {
  const { event, isPrevented, isStopped } = createFakeEvent();
  event.key = "Escape";
  let clearedQuery: string | undefined = "unset";
  handleFilterEscape(event, "", (query) => {
    clearedQuery = query;
  });
  assert.equal(clearedQuery, "unset", "空查询不应触发清空回调");
  assert.equal(isPrevented(), false, "空查询不应阻止默认行为");
  assert.equal(isStopped(), false, "空查询不应阻止事件传播");
});

test("纯空白查询词按 Esc：同样放行（无实际查询内容，不拦截）", () => {
  const { event, isPrevented, isStopped } = createFakeEvent();
  event.key = "Escape";
  let clearedQuery: string | undefined = "unset";
  handleFilterEscape(event, "   ", (query) => {
    clearedQuery = query;
  });
  assert.equal(clearedQuery, "unset");
  assert.equal(isPrevented(), false);
  assert.equal(isStopped(), false);
});

test("有查询词但按下非 Esc 键：放行给输入框正常编辑", () => {
  const { event, isPrevented, isStopped } = createFakeEvent();
  event.key = "Enter";
  let clearedQuery: string | undefined = "unset";
  handleFilterEscape(event, "fetch error", (query) => {
    clearedQuery = query;
  });
  assert.equal(clearedQuery, "unset", "非 Esc 键不应清空查询");
  assert.equal(isPrevented(), false, "非 Esc 键不应阻止默认行为");
  assert.equal(isStopped(), false, "非 Esc 键不应阻止事件传播");
});
