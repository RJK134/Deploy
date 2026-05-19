import type { MonitorStatus } from "@/lib/db/schema";

export interface ProjectRow {
  id: string;
  slug: string;
  githubOwner: string;
  githubRepo: string;
  vercelProjectId: string | null;
  vercelTeamId: string | null;
  neonProjectId: string | null;
  defaultBranch: string | null;
}

export interface AnalyzerReport {
  scanned: number;
  healthy: number;
  warning: number;
  down: number;
  skipped: number;
  incidentsOpened: number;
}

export const ZERO_REPORT: AnalyzerReport = {
  scanned: 0,
  healthy: 0,
  warning: 0,
  down: 0,
  skipped: 0,
  incidentsOpened: 0,
};

export function bumpReport(
  report: AnalyzerReport,
  status: MonitorStatus | "skipped",
): void {
  report.scanned++;
  if (status === "healthy") report.healthy++;
  else if (status === "warning") report.warning++;
  else if (status === "down") report.down++;
  else report.skipped++;
}

export interface AnalyzerOutcome {
  status: MonitorStatus;
  reason: string;
}
