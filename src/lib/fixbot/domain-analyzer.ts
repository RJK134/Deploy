import "server-only";

import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { recordAudit } from "@/lib/db/audit";
import { draftRemediation } from "@/lib/db/remediations";
import { fixbotIncidents, fixbotMonitors } from "@/lib/db/schema";
import { probeJson } from "@/lib/providers/probe";

import {
  classifyDomain,
  type VercelDomainLite,
} from "./classifiers";
import { getProjectRow, getVerifiedCredential } from "./credentials";
import { bumpReport, ZERO_REPORT, type AnalyzerReport } from "./types";

interface DomainMonitorConfig {
  /** When set, overrides project.customDomain. Useful for env-specific domains. */
  domain?: string;
}

function asDomainArray(value: unknown): VercelDomainLite[] {
  if (!value || typeof value !== "object") return [];
  const detail = value as Record<string, unknown>;
  if (Array.isArray(detail.domains)) return detail.domains as VercelDomainLite[];
  return [];
}

export async function runDomainMonitorChecks(args: {
  actor: string;
}): Promise<AnalyzerReport> {
  const monitors = await db
    .select()
    .from(fixbotMonitors)
    .where(eq(fixbotMonitors.kind, "domain"));

  const report: AnalyzerReport = { ...ZERO_REPORT };
  if (monitors.length === 0) return report;

  const token = await getVerifiedCredential("vercel");
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
    if (!project || !project.vercelProjectId) {
      await db
        .update(fixbotMonitors)
        .set({ status: "warning", lastCheckedAt: sql`now()` })
        .where(eq(fixbotMonitors.id, monitor.id));
      bumpReport(report, "warning");
      continue;
    }

    const cfg: DomainMonitorConfig =
      typeof monitor.config === "object" && monitor.config !== null
        ? (monitor.config as DomainMonitorConfig)
        : {};
    const desired =
      typeof cfg.domain === "string" && cfg.domain.length > 0
        ? cfg.domain
        : project.customDomain;

    const url = new URL(
      `https://api.vercel.com/v9/projects/${encodeURIComponent(project.vercelProjectId)}/domains`,
    );
    if (project.vercelTeamId) url.searchParams.set("teamId", project.vercelTeamId);
    const probe = await probeJson(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
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

    const attached = asDomainArray(probe.detail);
    const { status: nextStatus, reason, verified } = classifyDomain(
      desired,
      attached,
    );
    const previousStatus = monitor.status;

    await db
      .update(fixbotMonitors)
      .set({ status: nextStatus, lastCheckedAt: sql`now()` })
      .where(eq(fixbotMonitors.id, monitor.id));
    bumpReport(report, nextStatus);

    if (nextStatus === "down" && previousStatus !== "down") {
      const isAttached = verified !== false ? false : Boolean(
        attached.find((d) => d.name === desired),
      );
      const [incident] = await db
        .insert(fixbotIncidents)
        .values({
          monitorId: monitor.id,
          projectId: monitor.projectId,
          title: `Domain ${isAttached ? "verification" : "attachment"} pending: ${desired}`,
          summary: reason,
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
          kind: "domain",
          domain: desired,
          attached: isAttached,
          verified,
        },
      });
      await draftRemediation({
        incidentId: incident.id,
        action: isAttached ? "domain.verify" : "domain.attach",
        description: isAttached
          ? `Add the DNS record Vercel is expecting for '${desired}' (check the Vercel domain settings for the exact record). Re-run the monitor once propagated.`
          : `Attach '${desired}' to Vercel project ${project.vercelProjectId} via /access or the Vercel dashboard, then add the DNS record Vercel returns.`,
        payload: {
          provider: "vercel",
          vercelProjectId: project.vercelProjectId,
          domain: desired,
          attached: isAttached,
          verified,
        },
        autonomy: "approval-required",
        actor: args.actor,
      });
    }
  }

  await recordAudit({
    actor: args.actor,
    action: "fixbot.domain-checks.completed",
    target: null,
    metadata: { ...report },
  });

  return report;
}
