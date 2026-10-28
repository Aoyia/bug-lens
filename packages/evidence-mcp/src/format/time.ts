export function formatRelativeTime(ms?: number): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "—";
  const sign = ms >= 0 ? "+" : "-";
  const absSec = Math.abs(ms) / 1000;
  return `${sign}${absSec.toFixed(1)}s`;
}

export function formatDuration(ms?: number): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}
