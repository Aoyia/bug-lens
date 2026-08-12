import assert from "node:assert/strict";
import test from "node:test";
import { focusHistorySearchOnEntry } from "../src/popup/history-search-focus.ts";

/**
 * Popup「历史记录」视图的搜索框聚焦契约。
 *
 * 第一性原理：主操作控件优先——历史视图的核心任务是检索会话，搜索框是
 * 该视图唯一的主输入控件，视图进入时焦点应直接落在主控件上，让用户的
 * 第一次击键即产生结果（浏览器历史页、命令面板、Spotlight 等一律在
 * 打开时聚焦输入框）。此前进入历史视图后焦点悬停在已隐藏的图标按钮上、
 * 被浏览器退回 body，要搜索必须先手动点击搜索框，这是无成本可消除的
 * 多余一步。
 *
 * 与 popup-escape 的两段式语义互补：Escape 契约以「焦点在搜索框且有关键词」
 * 作为第一下清空搜索的判定，自动聚焦让该状态成为进入历史视图的自然默认态。
 */

function createFakeInput() {
  let focusCount = 0;
  return {
    focus() {
      focusCount++;
    },
    get focusCount() {
      return focusCount;
    },
  };
}

test("history-search-focus: 进入历史视图时把焦点交给搜索框", () => {
  const input = createFakeInput();
  const focused = focusHistorySearchOnEntry({
    currentView: "history",
    getSearchInput: () => input as unknown as HTMLElement,
  });
  assert.equal(focused, true, "历史视图下应执行聚焦并返回 true");
  assert.equal(input.focusCount, 1, "搜索框应恰好获得一次焦点");
});

test("history-search-focus: 录制视图（根层）不抢占焦点", () => {
  const input = createFakeInput();
  const focused = focusHistorySearchOnEntry({
    currentView: "record",
    getSearchInput: () => input as unknown as HTMLElement,
  });
  assert.equal(focused, false, "录制视图不应执行聚焦");
  assert.equal(input.focusCount, 0, "根层视图不得移动焦点");
});

test("history-search-focus: 搜索框尚未就绪时静默跳过（不抛错）", () => {
  const focused = focusHistorySearchOnEntry({
    currentView: "history",
    getSearchInput: () => null,
  });
  assert.equal(focused, false, "输入框缺失时返回 false 且不抛错");
});

test("history-search-focus: 每次进入历史视图都重新聚焦（重复进入不丢失）", () => {
  const input = createFakeInput();
  focusHistorySearchOnEntry({
    currentView: "history",
    getSearchInput: () => input as unknown as HTMLElement,
  });
  focusHistorySearchOnEntry({
    currentView: "history",
    getSearchInput: () => input as unknown as HTMLElement,
  });
  assert.equal(input.focusCount, 2, "每次进入历史视图都应重新聚焦搜索框");
});
