import { useState, useMemo } from "preact/hooks";

/**
 * Reusable search-filter + count text pattern extracted from
 * ConsoleTab, NetworkTab (and potentially StreamTab).
 *
 * Each of those components independently implemented:
 *   const [searchQuery, setSearchQuery] = useState("");
 *   const filtered = list.filter(matchFn);
 *   const countText = query ? `匹配 N / M 条` : `共 M 条`;
 *
 * This hook unifies that pattern.
 *
 * @param list     — The full list of items to filter
 * @param filterFn — A predicate receiving (item, lowercasedQuery) → boolean.
 *                    Only called when query is non-empty.
 */
export function useFilteredList<T>(
  list: T[],
  filterFn: (item: T, query: string) => boolean
) {
  const [searchQuery, setSearchQuery] = useState("");

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return list.filter((item) => filterFn(item, q));
  }, [list, searchQuery, filterFn]);

  const countText = useMemo(() => {
    return searchQuery.trim()
      ? `匹配 ${filtered.length} / ${list.length} 条`
      : `共 ${list.length} 条`;
  }, [filtered.length, list.length, searchQuery]);

  return { searchQuery, setSearchQuery, filtered, countText };
}
