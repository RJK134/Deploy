import "server-only";

import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { recordAudit } from "@/lib/db/audit";
import { fixbotIncidents, fixbotMonitors } from "@/lib/db/schema";
import { probeJson } from "@/lib/providers/probe";

import { classifyActionsRun } from "./classifiers";
import { getProjectRow, getVerifiedCredential } from "./credentials";
import { bumpReport, ZERO_REPORT, type AnalyzerReport } from "./types";

interface WorkflowMonitorConfig {
  /** Optional: workflow file path or id, e.g. 'deployops.yml'. Empty = all workflows. */
  workflowId?: string;
  /** Optional: branch filter, default project.defaultBranch. */
  branch?: string;
  /** Conclusions treated as 'down' triggers. */
  failureConclusions?: string[];
}

interface ActionsRun {
  id?: number;
  status?: string;
  conclusion?: string | null;
  html_url?: string;
  head_branch?: string;
  name?: string;
  created_at?: string;
}

const DEFAULT_FAILURES = ["failure", "timed_out", "startup_failure"];

function asRunArray(value: unknown): ActionsRun[] {
  if (!value || typeof value !== "object") return [];
  const detail = value as Record<string, unknown>;
  if (Array.isArray(detail.workflow_runs)) {
    return detail.workflow_runs as ActionsRun[];
  }
  return [];
}


export async function runWorkflowMonitorChecks(args: {
  actor: string;
}): Promise<AnalyzerReport> {
  const monitors = await db
    .select()
    .from(fixbotMonitors)
    .where(eq(fixbotMonitors.kind, "workflow"));

  const report: AnalyzerReport = { ...ZERO_REPORT };
  if (monitors.length === 0) return report;

  const token = await getVerifiedCredential("github_pat");
  if (!token) {
    for (const m of monitors) {
      await db
        .update(fixbotMonitors)
        .set({ status: "unknown", lastCheckedAt: sql`now()` })
        .where(eq(fixbotMonitors.id, m.id));
      bumpReport(report, "skipped");
    }
    return report;
  }

  for (const monitor of monitors) {
    if (!monitor.projectId) {
      await db
        .update(fixbotMonitors)
        .set({ status: "warning", lastCheckedAt: sql`now()` })
        .where(eq(fixbotMonitors.id, monitor.id));
      bumpReport(report, "warning");
      continue;
    }
    const project = await getProjectRow(monitor.projectId);
    if (!project) {
      await db
        .update(fixbotMonitors)
        .set({ status: "warning", lastCheckedAt: sql`now()` })
        .where(eq(fixbotMonitors.id, monitor.id));
      bumpReport(report, "warning");
      continue;
    }

    const cfg: WorkflowMonitorConfig =
      typeof monitor.config === "object" && monitor.config !== null
        ? (monitor.config as WorkflowMonitorConfig)
        : {};
    const failureConclusions =
      Array.isArray(cfg.failureConclusions) &&
      cfg.failureConclusions.length > 0
        ? cfg.failureConclusions.filter(
            (s): s is string => typeof s === "string",
          )
        : DEFAULT_FAILURES;
    const branch =
      typeof cfg.branch === "string" && cfg.branch.length > 0
        ? cfg.branch
        : (project.defaultBranch ?? "main");

    const pathRoot = `/repos/${encodeURIComponent(project.githubOwner)}/${encodeURIComponent(project.githubRepo)}/actions`;
    const path = cfg.workflowId
      ? `${pathRoot}/workflows/${encodeURIComponent(cfg.workflowId)}/runs`
      : `${pathRoot}/runs`;
    const url = new URL(`https://api.github.com${path}`);
    url.searchParams.set("branch", branch);
    url.searchParams.set("per_page", "1");

    const probe = await probeJson(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "deployops-console",
      },
    });

    if (!probe.ok) {
      await db
        .update(fixbotMonitors)
        .set({ status: "warning", lastCheckedAt: sql`now()` })
        .where(eq(fixbotMonitors.id, monitor.id));
      bumpReport(report, "warning");
      continue;
    }

    const runs = asRunArray(probe.detail);
    const latest = runs[0];
    const { status: nextStatus, reason } = classifyActionsRun(
      latest,
      failureConclusions,
    );
    const previousStatus = monitor.status;

    await db
      .update(fixbotMonitors)
      .set({ status: nextStatus, lastCheckedAt: sql`now()` })
      .where(eq(fixbotMonitors.id, monitor.id));
    bumpReport(report, nextStatus);

    if (nextStatus === "down" && previousStatus !== "down") {
      const [incident] = await db
        .insert(fixbotIncidents)
        .values({
          monitorId: monitor.id,
          projectId: monitor.projectId,
          title: `Workflow failed: ${monitor.label}`,
          summary: `${reason}. ${latest?.html_url ? `Run: ${latest.html_url}` : ""}`.trim(),
          status: "open",
          autonomy: "approval-required",
        })
        .returning({ id: fixbotIncidents.id });
      report.incidentsOpened++;
      await recordAudit({
        actor: args.actor,
        action: "incident.opened",
        target: incident.id,
        metadata: {
          monitorId: monitor.id,
          monitorLabel: monitor.label,
          kind: "workflow",
          runId: latest?.id ?? null,
          conclusion: latest?.conclusion ?? null,
          htmlUrl: latest?.html_url ?? null,
        },
      });
    }
  }

  await recordAudit({
    actor: args.actor,
    action: "fixbot.workflow-checks.completed",
    target: null,
    metadata: { ...report },
  });

  return report;
}
