import "server-only";

import { eq, sql } from "drizzle-orm";

import { getBlueprintById } from "@/lib/db/blueprints";
import { db } from "@/lib/db/client";
import { recordAudit } from "@/lib/db/audit";
import { draftRemediation } from "@/lib/db/remediations";
import { fixbotIncidents, fixbotMonitors } from "@/lib/db/schema";
import { probeJson } from "@/lib/providers/probe";

import { classifyEnvKeys, type EnvTarget } from "./classifiers";
import { getProjectRow, getVerifiedCredential } from "./credentials";
import { bumpReport, ZERO_REPORT, type AnalyzerReport } from "./types";

interface EnvMonitorConfig {
  target?: EnvTarget;
  /** When set, overrides the blueprint's env-var manifest. */
  requiredKeys?: string[];
}

interface VercelEnvVar {
  key?: string;
  target?: string[];
}

function asEnvArray(value: unknown): VercelEnvVar[] {
  if (!value || typeof value !== "object") return [];
  const detail = value as Record<string, unknown>;
  if (Array.isArray(detail.envs)) return detail.envs as VercelEnvVar[];
  if (Array.isArray(detail)) return detail as VercelEnvVar[];
  return [];
}

function asTarget(value: unknown): EnvTarget {
  if (
    typeof value === "string" &&
    (value === "production" || value === "preview" || value === "development")
  ) {
    return value;
  }
  return "production";
}

export async function runEnvMonitorChecks(args: {
  actor: string;
}): Promise<AnalyzerReport> {
  const monitors = await db
    .select()
    .from(fixbotMonitors)
    .where(eq(fixbotMonitors.kind, "env"));

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

    const cfg: EnvMonitorConfig =
      typeof monitor.config === "object" && monitor.config !== null
        ? (monitor.config as EnvMonitorConfig)
        : {};
    const target = asTarget(cfg.target);

    // Resolve required keys: explicit list wins; otherwise pull from the
    // project's blueprint env-var manifest.
    let requiredKeys: string[] = [];
    if (Array.isArray(cfg.requiredKeys) && cfg.requiredKeys.length > 0) {
      requiredKeys = cfg.requiredKeys.filter(
        (k): k is string => typeof k === "string" && k.length > 0,
      );
    } else if (project.blueprintId) {
      const bp = await getBlueprintById(project.blueprintId);
      if (bp) requiredKeys = bp.definition.envVars.map((v) => v.key);
    }

    if (requiredKeys.length === 0) {
      await db
        .update(fixbotMonitors)
        .set({ status: "warning", lastCheckedAt: sql`now()` })
        .where(eq(fixbotMonitors.id, monitor.id));
      bumpReport(report, "warning");
      continue;
    }

    const url = new URL(
      `https://api.vercel.com/v10/projects/${encodeURIComponent(project.vercelProjectId)}/env`,
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

    const envs = asEnvArray(probe.detail);
    const presentKeys = new Set(
      envs
        .filter((e) => {
          if (!e.target) return true;
          return Array.isArray(e.target) && e.target.includes(target);
        })
        .map((e) => e.key)
        .filter((k): k is string => typeof k === "string"),
    );
    const { status: nextStatus, missingKeys } = classifyEnvKeys(
      requiredKeys,
      presentKeys,
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
          title: `Missing env vars on ${project.slug} (${target})`,
          summary: `Vercel project ${project.vercelProjectId} is missing ${missingKeys.length} required env var${missingKeys.length === 1 ? "" : "s"}: ${missingKeys.join(", ")}.`,
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
          kind: "env",
          target,
          missingKeys,
        },
      });
      await draftRemediation({
        incidentId: incident.id,
        action: "env.add",
        description: `Add ${missingKeys.length} env var${missingKeys.length === 1 ? "" : "s"} to the Vercel project for the '${target}' target: ${missingKeys.join(", ")}.`,
        payload: {
          provider: "vercel",
          vercelProjectId: project.vercelProjectId,
          target,
          missingKeys,
        },
        autonomy: "approval-required",
        actor: args.actor,
      });
    }
  }

  await recordAudit({
    actor: args.actor,
    action: "fixbot.env-checks.completed",
    target: null,
    metadata: { ...report },
  });

  return report;
}
