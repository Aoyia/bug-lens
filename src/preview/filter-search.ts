/**
 * 调试工作区过滤输入框的 Esc 清空契约。
 *
 * 第一性原理：Console / Network 面板是类 DevTools 的调试工作区，用户
 * 反复「输入查询 → 更换查询 / 回到全部」是最高频操作。Chrome DevTools、
 * VS Code 等调试工具中「过滤框按 Esc 一键清空」是通用肌肉记忆，而当前
 * 过滤框（type="text"，无原生清除按钮）没有任何快捷清空手段。
 *
 * 安全边界：仅在存在查询词（非空白）时拦截 Esc；空查询时完全放行，
 * 不改变 Esc 的既有行为，也不影响未来可能新增的全局 Esc 能力。
 *
 * @param event         键盘事件（仅用到 key / preventDefault / stopPropagation）
 * @param searchQuery   当前查询词
 * @param setSearchQuery 清空回调（由受控组件直接 setState 驱动输入框清空，
 *                       焦点保持在输入框上，用户可直接继续输入新查询）
 */
export function handleFilterEscape(
  event: { key: string; preventDefault(): void; stopPropagation(): void },
  searchQuery: string,
  setSearchQuery: (query: string) => void
): void {
  if (event.key !== "Escape" || !searchQuery.trim()) return;
  event.preventDefault();
  event.stopPropagation();
  setSearchQuery("");
}
