/**
 * Popup「历史记录」视图的 Escape 语义解析（纯函数，便于单测）。
 *
 * 第一性原理：全应用覆盖层/弹层均遵循「Escape 取消当前层」惯例
 * （问题编辑器、Playwright 弹窗、图片查看器、快捷键面板、选择浮层、
 * 确认框等）。历史视图是录制视图之下的子层（有返回按钮），若 Escape
 * 不被拦截会落到浏览器默认行为——直接关闭整个 popup，把「返回上一层」
 * 误判为「关闭弹窗」。本模块在 popup 内补齐该惯例。
 *
 * 语义（两段式，与 preview/filter-search.ts 的 handleFilterEscape 契约对齐）：
 * - 历史视图 + 焦点在搜索框且有关键词 → clear-search（第一下 Escape 清空搜索，
 *   焦点保持在输入框，用户可直接继续输入新查询）
 * - 历史视图 + 其余情况 → back-to-record（取消当前层）
 * - 录制视图（根层）或确认弹窗打开 → none（完全放行：根层保留浏览器
 *   默认的「Escape 关闭 popup」；确认弹窗由 bindConfirmDialogDismiss 自理，
 *   避免与弹窗监听器双重触发）
 */
export type PopupView = "record" | "history";

export interface PopupEscapeInput {
  view: PopupView;
  /** 自定义确认弹窗（清空历史等）是否打开 */
  modalOpen: boolean;
  /** 焦点是否在历史搜索框内 */
  searchFocused: boolean;
  /** 当前搜索关键词 */
  searchQuery: string;
}

export type PopupEscapeAction =
  { kind: "none" } | { kind: "clear-search" } | { kind: "back-to-record" };

export function resolvePopupEscape(input: PopupEscapeInput): PopupEscapeAction {
  const { view, modalOpen, searchFocused, searchQuery } = input;
  if (view !== "history" || modalOpen) return { kind: "none" };
  if (searchFocused && searchQuery.trim()) return { kind: "clear-search" };
  return { kind: "back-to-record" };
}
