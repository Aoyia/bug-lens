import type { NetworkEntry } from "../shared/protocol.ts";

export function filterNetworkEntries(entries: NetworkEntry[], searchQuery: string, methodFilter = "all"): NetworkEntry[] {
  const query = searchQuery.trim().toLowerCase();
  return entries.filter((entry) => {
    const methodMatches = methodFilter === "all" || (entry.method || "GET").toLowerCase() === methodFilter.toLowerCase();
    const queryMatches = !query || entry.url.toLowerCase().includes(query);
    return methodMatches && queryMatches;
  });
}

export function selectActiveNetworkId(entries: NetworkEntry[], selectedId: string | null): string | null {
  if (entries.length > 0 && !entries.some((entry) => entry.id === selectedId)) {
    return entries[entries.length - 1]!.id;
  } else if (entries.length === 0) {
    return null;
  }
  return selectedId;
}
