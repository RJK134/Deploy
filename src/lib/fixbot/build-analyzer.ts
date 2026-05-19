import "server-only";

import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { recordAudit } from "@/lib/db/audit";
import { draftRemediation } from "@/lib/db/remediations";
import { fixbotIncidents, fixbotMonitors } from "@/lib/db/schema";
import { probeJson } from "@/lib/providers/probe";

import { classifyVercelState } from "./classifiers";
import { getProjectRow, getVerifiedCredential } from "./credentials";
import { bumpReport, ZERO_REPORT, type AnalyzerReport } from "./types";

interface BuildMonitorConfig {
  /** Vercel deployment state regarded as the down trigger. */
  failureStates?: string[];
  /** Optional: extra deployment count to inspect; default 1 (latest). */
  inspectCount?: number;
}

const DEFAULT_FAILURE_STATES = ["ERROR", "CANCELED"];

function vercelUrl(path: string, teamId: string | null): string {
  const url = new URL(`https://api.vercel.com${path}`);
  if (teamId) url.searchParams.set("teamId", teamId);
  return url.toString();
}

interface VercelDeploymentLite {
  uid?: string;
  url?: string;
  state?: string;
  readyState?: string;
  created?: number;
  target?: string;
}

function asDeploymentArray(value: unknown): VercelDeploymentLite[] {
  if (!value || typeof value !== "object") return [];
  const detail = value as Record<string, unknown>;
  if (Array.isArray(detail.deployments)) {
    return detail.deployments as VercelDeploymentLite[];
  }
  return [];
}


export async function runBuildMonitorChecks(args: {
  actor: string;
}): Promise<AnalyzerReport> {
  const monitors = await db
    .select()
    .from(fixbotMonitors)
    .where(eq(fixbotMonitors.kind, "build"));

  const report: AnalyzerReport = { ...ZERO_REPORT };
  if (monitors.length === 0) return report;

  const token = await getVerifiedCredential("vercel");
  if (!token) {
    // Skip all build monitors — analyzer needs a verified token.
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
    if (!project || !project.vercelProjectId) {
      await db
        .update(fixbotMonitors)
        .set({ status: "warning", lastCheckedAt: sql`now()` })
        .where(eq(fixbotMonitors.id, monitor.id));
      bumpReport(report, "warning");
      continue;
    }

    const cfg: BuildMonitorConfig =
      typeof monitor.config === "object" && monitor.config !== null
        ? (monitor.config as BuildMonitorConfig)
        : {};
    const failureStates =
      Array.isArray(cfg.failureStates) && cfg.failureStates.length > 0
        ? cfg.failureStates.filter((s): s is string => typeof s === "string")
        : DEFAULT_FAILURE_STATES;
    const limit =
      typeof cfg.inspectCount === "number" && cfg.inspectCount > 0
        ? Math.min(cfg.inspectCount, 5)
        : 1;

    const probe = await probeJson(
      vercelUrl(
        `/v6/deployments?projectId=${encodeURIComponent(project.vercelProjectId)}&limit=${limit}`,
        project.vercelTeamId,
      ),
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      },
    );

    if (!probe.ok) {
      await db
        .update(fixbotMonitors)
        .set({ status: "warning", lastCheckedAt: sql`now()` })
        .where(eq(fixbotMonitors.id, monitor.id));
      bumpReport(report, "warning");
      continue;
    }

    const deployments = asDeploymentArray(probe.detail);
    const latest = deployments[0];
    if (!latest) {
      await db
        .update(fixbotMonitors)
        .set({ status: "healthy", lastCheckedAt: sql`now()` })
        .where(eq(fixbotMonitors.id, monitor.id));
      bumpReport(report, "healthy");
      continue;
    }

    const state = latest.state ?? latest.readyState;
    const { status: nextStatus, reason } = classifyVercelState(state, failureStates);
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
          title: `Build failed: ${monitor.label}`,
          summary: `${reason}. Deployment id: ${latest.uid ?? "(unknown)"}.`,
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
          kind: "build",
          deploymentId: latest.uid ?? null,
          state: state ?? null,
        },
      });
      await draftRemediation({
        incidentId: incident.id,
        action: "deploy.retry",
        description: `Investigate Vercel deployment ${latest.uid ?? "(unknown)"} (${state ?? "unknown state"}) and trigger a fresh deploy from /runs/new with live mode enabled. Check the deployment logs in Vercel for the failure cause first.`,
        payload: {
          provider: "vercel",
          vercelProjectId: project.vercelProjectId,
          deploymentId: latest.uid ?? null,
          state: state ?? null,
        },
        autonomy: "approval-required",
        actor: args.actor,
      });
    }
  }

  await recordAudit({
    actor: args.actor,
    action: "fixbot.build-checks.completed",
    target: null,
    metadata: { ...report },
  });

  return report;
}
