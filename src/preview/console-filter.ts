import type { ConsoleEntry } from "../shared/protocol.ts";

export function filterConsoleEntries(entries: ConsoleEntry[], levelFilter: string, searchQuery: string): ConsoleEntry[] {
  const query = searchQuery.trim().toLowerCase();
  return entries.filter((entry) => {
    const level = (entry.level || "log").toLowerCase();
    if (levelFilter === "error" && level !== "error") return false;
    if (levelFilter === "warning" && level !== "warn" && level !== "warning") return false;
    if (levelFilter === "info" && level !== "info") return false;
    if (levelFilter === "debug" && level !== "debug" && level !== "log") return false;
    if (levelFilter !== "all" && !["error", "warning", "info", "debug"].includes(levelFilter)) return false;
    return !query || [entry.text, entry.source, level].some((value) => (value || "").toLowerCase().includes(query));
  });
}
