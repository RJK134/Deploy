export function relativeTime(date: Date | null | undefined): string {
  if (!date) return "—";
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  if (seconds < 86400 * 7) return `${Math.round(seconds / 86400)}d ago`;
  return date.toISOString().slice(0, 10);
}

export function durationSeconds(
  start: Date | null | undefined,
  end: Date | null | undefined,
): string {
  if (!start) return "—";
  const finish = end ?? new Date();
  const ms = finish.getTime() - start.getTime();
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s - m * 60);
  return `${m}m ${r}s`;
}
