import type { ConsoleEntry } from "../shared/protocol.ts";

export function matchesConsoleEntry(
  entry: ConsoleEntry,
  levelFilter: string,
  normalizedQuery: string
): boolean {
  const level = (entry.level || "log").toLowerCase();
  if (levelFilter !== "all") {
    if (levelFilter === "error") {
      if (level !== "error") return false;
    } else if (levelFilter === "warning") {
      if (level !== "warn" && level !== "warning") return false;
    } else if (levelFilter === "info") {
      if (level !== "info") return false;
    } else if (levelFilter === "debug") {
      if (level !== "debug" && level !== "log") return false;
    } else {
      return false;
    }
  }
  if (!normalizedQuery) return true;
  return (
    Boolean(entry.text && entry.text.toLowerCase().includes(normalizedQuery)) ||
    Boolean(
      entry.source && entry.source.toLowerCase().includes(normalizedQuery)
    ) ||
    Boolean(entry.url && entry.url.toLowerCase().includes(normalizedQuery)) ||
    Boolean(
      entry.frameId && entry.frameId.toLowerCase().includes(normalizedQuery)
    ) ||
    level.includes(normalizedQuery)
  );
}

export function filterConsoleEntries(
  entries: ConsoleEntry[],
  levelFilter: string,
  searchQuery: string
): ConsoleEntry[] {
  const query = searchQuery.trim().toLowerCase();
  if (levelFilter === "all" && !query) {
    return entries.slice();
  }
  return entries.filter((entry) =>
    matchesConsoleEntry(entry, levelFilter, query)
  );
}
