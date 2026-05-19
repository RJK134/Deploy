import "server-only";

import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { recordAudit } from "@/lib/db/audit";
import { fixbotIncidents, fixbotMonitors } from "@/lib/db/schema";
import { probeJson } from "@/lib/providers/probe";

import { bumpReport, ZERO_REPORT, type AnalyzerReport } from "./types";

interface HttpMonitorConfig {
  url?: unknown;
  expectedStatus?: unknown;
  expectedBodyContains?: unknown;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Walk every `kind='http'` monitor row and probe its configured URL.
 * Updates monitor.status and opens an incident when a monitor flips from
 * non-down to down. Idempotent: an open incident isn't re-opened, but the
 * monitor row's status is always refreshed.
 */
export async function runHttpMonitorChecks(args: {
  actor: string;
}): Promise<AnalyzerReport> {
  const monitors = await db
    .select()
    .from(fixbotMonitors)
    .where(eq(fixbotMonitors.kind, "http"));

  const report: AnalyzerReport = { ...ZERO_REPORT };

  for (const monitor of monitors) {
    const cfg: HttpMonitorConfig =
      typeof monitor.config === "object" && monitor.config !== null
        ? (monitor.config as HttpMonitorConfig)
        : {};
    const url = asString(cfg.url);
    const expectedStatus = asNumber(cfg.expectedStatus) ?? 200;
    const expectedBody = asString(cfg.expectedBodyContains);

    if (!url) {
      await db
        .update(fixbotMonitors)
        .set({ status: "warning", lastCheckedAt: sql`now()` })
        .where(eq(fixbotMonitors.id, monitor.id));
      bumpReport(report, "warning");
      continue;
    }

    const previousStatus = monitor.status;
    const res = await probeJson(url, { headers: {} });
    let nextStatus: "healthy" | "warning" | "down" = "healthy";
    let reason = "";
    if (!res.ok) {
      nextStatus = "down";
      reason = `${res.status} ${res.message}`;
    } else if (res.status !== expectedStatus) {
      nextStatus = "warning";
      reason = `status ${res.status} (expected ${expectedStatus})`;
    } else if (
      expectedBody &&
      typeof res.detail === "object" &&
      JSON.stringify(res.detail).indexOf(expectedBody) === -1
    ) {
      nextStatus = "warning";
      reason = `response body missing '${expectedBody}'`;
    }

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
          title: `HTTP monitor '${monitor.label}' is down`,
          summary: `Probe failed: ${reason || "no detail"}. URL: ${url}.`,
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
          reason: reason || null,
          url,
          kind: "http",
        },
      });
    }
  }

  await recordAudit({
    actor: args.actor,
    action: "fixbot.http-checks.completed",
    target: null,
    metadata: { ...report },
  });

  return report;
}
