/**
 * Popup「历史记录」视图的搜索框聚焦契约（纯函数，便于单测）。
 *
 * 第一性原理：主操作控件优先——历史视图的核心任务是检索会话，搜索框是
 * 该视图唯一的主输入控件，视图进入时焦点应直接落在主控件上，让用户的
 * 第一次击键即产生结果（浏览器历史页、命令面板、Spotlight 等一律在
 * 打开时聚焦输入框）。此前进入历史视图后，焦点悬停在已被隐藏
 * （display:none）的历史图标按钮上，浏览器把焦点退回 body——要开始搜索
 * 必须先手动点击搜索框（或按 Tab 过去），这是可零成本消除的多余一步。
 *
 * 与 popup-escape 的两段式语义互补：Escape 契约以「焦点在搜索框且有关键词」
 * 作为第一下清空搜索的判定，自动聚焦让该状态成为进入历史视图的自然默认态，
 * 输入 → Escape 清空 → Escape 返回，全程键盘可达。
 */
export type HistorySearchFocusOptions = {
  /** 当前视图；仅历史视图才聚焦（录制视图是根层，不抢占焦点） */
  currentView: "record" | "history";
  /** 解析搜索框 DOM 节点；返回 null 表示尚未就绪，静默跳过 */
  getSearchInput(): HTMLElement | null;
};

/**
 * 进入历史视图时把焦点交给搜索框。
 * @returns 是否执行了聚焦（视图不匹配或输入框缺失时返回 false）
 */
export function focusHistorySearchOnEntry({
  currentView,
  getSearchInput,
}: HistorySearchFocusOptions): boolean {
  if (currentView !== "history") return false;
  const searchInput = getSearchInput();
  if (!searchInput) return false;
  searchInput.focus();
  return true;
}
