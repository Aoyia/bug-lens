import type { NetworkEntry } from "../shared/protocol.ts";

export function matchesNetworkEntry(
  entry: NetworkEntry,
  normalizedQuery: string,
  normalizedMethod = "all"
): boolean {
  if (
    normalizedMethod !== "all" &&
    (entry.method || "GET").toLowerCase() !== normalizedMethod
  ) {
    return false;
  }
  if (!normalizedQuery) return true;
  return (
    entry.url.toLowerCase().includes(normalizedQuery) ||
    Boolean(entry.documentUrl?.toLowerCase().includes(normalizedQuery)) ||
    Boolean(entry.frameId?.toLowerCase().includes(normalizedQuery))
  );
}

export function filterNetworkEntries(
  entries: NetworkEntry[],
  searchQuery: string,
  methodFilter = "all"
): NetworkEntry[] {
  const query = searchQuery.trim().toLowerCase();
  const normalizedMethod = methodFilter.toLowerCase();
  if (normalizedMethod === "all" && !query) {
    return entries.slice();
  }
  return entries.filter((entry) =>
    matchesNetworkEntry(entry, query, normalizedMethod)
  );
}

export function selectActiveNetworkId(
  entries: NetworkEntry[],
  selectedId: string | null
): string | null {
  if (entries.length > 0 && !entries.some((entry) => entry.id === selectedId)) {
    return entries[entries.length - 1]!.id;
  } else if (entries.length === 0) {
    return null;
  }
  return selectedId;
}
