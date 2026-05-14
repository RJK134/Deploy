export type CheckStatus = "ok" | "warn" | "fail";

export interface CheckResult {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  /** When status is not 'ok', what action clears it. */
  hint?: string;
}

export function summariseReadiness(results: CheckResult[]): {
  ok: number;
  warn: number;
  fail: number;
  blocking: boolean;
} {
  const counts = { ok: 0, warn: 0, fail: 0 };
  for (const r of results) counts[r.status]++;
  return { ...counts, blocking: counts.fail > 0 };
}
