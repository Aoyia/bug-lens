import { useState, useMemo } from "preact/hooks";
import { t } from "../shared/i18n.ts";

/**
 * 可复用的搜索过滤 + 计数文本模式，抽取自
 * ConsoleTab、NetworkTab（未来可能还有 StreamTab）。
 *
 * 这些组件此前各自独立实现了同一套逻辑：
 *   const [searchQuery, setSearchQuery] = useState("");
 *   const filtered = list.filter(matchFn);
 *   const countText = query ? `匹配 N / M 条` : `共 M 条`;
 *
 * 本 hook 统一了该模式。
 *
 * @param list     — 待过滤的完整条目列表
 * @param filterFn — 接收 (item, lowercasedQuery) → boolean 的谓词。
 *                   仅在查询词非空时被调用。
 */
export function useFilteredList<T>(
  list: T[],
  filterFn: (item: T, query: string) => boolean
) {
  const [searchQuery, setSearchQuery] = useState("");

  // 查询词转小写后统一传给 filterFn；空查询时 q 为空串，由 filterFn 自行放行全部条目
  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return list.filter((item) => filterFn(item, q));
  }, [list, searchQuery, filterFn]);

  // 有查询时显示"匹配 N / M 条"（N 为过滤后条数），否则显示"共 M 条"（全量）
  const countText = useMemo(() => {
    return searchQuery.trim()
      ? t("matchingCount", [String(filtered.length), String(list.length)])
      : t("totalCount", String(list.length));
  }, [filtered.length, list.length, searchQuery]);

  return { searchQuery, setSearchQuery, filtered, countText };
}
