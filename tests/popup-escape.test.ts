import assert from "node:assert/strict";
import test from "node:test";
import { resolvePopupEscape } from "../src/popup/popup-escape.ts";

/**
 * Popup「历史记录」视图的 Escape 语义契约。
 *
 * 第一性原理：全应用覆盖层/弹层均遵循「Escape 取消当前层」惯例
 * （问题编辑器、Playwright 弹窗、图片查看器、快捷键面板、选择浮层、
 * 确认框等），历史视图是录制视图之下的子层（有返回按钮），但此前
 * 未拦截的 Escape 会落到浏览器默认行为——直接关闭整个 popup，
 * 把「返回上一层」误判为「关闭弹窗」。
 *
 * 语义（两段式，与 handleFilterEscape 契约对齐）：
 * - 历史视图 + 焦点在搜索框且有关键词 → 清空搜索（不返回、不关弹窗）
 * - 历史视图 + 其余情况 → 返回录制视图（取消当前层）
 * - 录制视图（根层）或确认弹窗打开 → 完全放行（确认框自理 Escape）
 */
test("popup-escape: 录制视图按 Escape 完全放行（浏览器默认关闭 popup，符合根层语义）", () => {
  const action = resolvePopupEscape({
    view: "record",
    modalOpen: false,
    searchFocused: false,
    searchQuery: "",
  });
  assert.deepEqual(action, { kind: "none" }, "根层不应拦截 Escape");
});

test("popup-escape: 历史视图按 Escape 返回录制视图", () => {
  const action = resolvePopupEscape({
    view: "history",
    modalOpen: false,
    searchFocused: false,
    searchQuery: "",
  });
  assert.deepEqual(
    action,
    { kind: "back-to-record" },
    "历史视图（非搜索输入）Escape 应返回录制视图"
  );
});

test("popup-escape: 历史视图焦点在搜索框且有关键词时，第一下 Escape 清空搜索", () => {
  const action = resolvePopupEscape({
    view: "history",
    modalOpen: false,
    searchFocused: true,
    searchQuery: "bug",
  });
  assert.deepEqual(
    action,
    { kind: "clear-search" },
    "搜索框有词时第一下 Escape 应清空查询而不是返回"
  );
});

test("popup-escape: 搜索框纯空白查询词按 Escape 视为可返回（无实际查询内容）", () => {
  const action = resolvePopupEscape({
    view: "history",
    modalOpen: false,
    searchFocused: true,
    searchQuery: "   ",
  });
  assert.deepEqual(
    action,
    { kind: "back-to-record" },
    "空白查询词不构成搜索状态，Escape 应返回录制视图"
  );
});

test("popup-escape: 确认弹窗打开时完全放行（由 confirm-dialog 自理 Escape，避免双重触发）", () => {
  const action = resolvePopupEscape({
    view: "history",
    modalOpen: true,
    searchFocused: false,
    searchQuery: "",
  });
  assert.deepEqual(action, { kind: "none" }, "弹窗打开时不应拦截 Escape");
});
