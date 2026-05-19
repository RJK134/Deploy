import "server-only";

import { asc, desc, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { recordAudit } from "@/lib/db/audit";
import {
  fixbotDiagnoses,
  fixbotIncidents,
  fixbotMonitors,
  fixbotRemediations,
  projects,
  type AutonomyLevel,
  type IncidentStatus,
  type MonitorKind,
  type MonitorStatus,
} from "@/lib/db/schema";

export interface MonitorRow {
  id: string;
  projectId: string | null;
  projectSlug: string | null;
  kind: MonitorKind;
  label: string;
  config: Record<string, unknown>;
  status: MonitorStatus;
  lastCheckedAt: Date | null;
  createdAt: Date;
}

export interface IncidentRow {
  id: string;
  monitorId: string | null;
  projectId: string | null;
  projectSlug: string | null;
  title: string;
  summary: string | null;
  status: IncidentStatus;
  autonomy: AutonomyLevel;
  openedAt: Date;
  resolvedAt: Date | null;
}

export interface DiagnosisRow {
  id: string;
  incidentId: string;
  rootCause: string;
  evidence: Record<string, unknown> | null;
  confidence: "low" | "medium" | "high";
  createdAt: Date;
}

export interface RemediationRow {
  id: string;
  incidentId: string;
  action: string;
  description: string;
  payload: Record<string, unknown> | null;
  approvalRequired: boolean;
  status: "draft" | "queued" | "applied" | "failed" | "dismissed";
  appliedAt: Date | null;
  createdAt: Date;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

export async function listMonitors(): Promise<MonitorRow[]> {
  const rows = await db
    .select({
      id: fixbotMonitors.id,
      projectId: fixbotMonitors.projectId,
      projectSlug: projects.slug,
      kind: fixbotMonitors.kind,
      label: fixbotMonitors.label,
      config: fixbotMonitors.config,
      status: fixbotMonitors.status,
      lastCheckedAt: fixbotMonitors.lastCheckedAt,
      createdAt: fixbotMonitors.createdAt,
    })
    .from(fixbotMonitors)
    .leftJoin(projects, eq(projects.id, fixbotMonitors.projectId))
    .orderBy(asc(fixbotMonitors.createdAt));
  return rows.map((r) => ({
    ...r,
    config: asRecord(r.config) ?? {},
  })) as MonitorRow[];
}

export async function listIncidents(limit = 50): Promise<IncidentRow[]> {
  const rows = await db
    .select({
      id: fixbotIncidents.id,
      monitorId: fixbotIncidents.monitorId,
      projectId: fixbotIncidents.projectId,
      projectSlug: projects.slug,
      title: fixbotIncidents.title,
      summary: fixbotIncidents.summary,
      status: fixbotIncidents.status,
      autonomy: fixbotIncidents.autonomy,
      openedAt: fixbotIncidents.openedAt,
      resolvedAt: fixbotIncidents.resolvedAt,
    })
    .from(fixbotIncidents)
    .leftJoin(projects, eq(projects.id, fixbotIncidents.projectId))
    .orderBy(desc(fixbotIncidents.openedAt))
    .limit(Math.min(Math.max(limit, 1), 200));
  return rows as IncidentRow[];
}

export async function countIncidents(): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(fixbotIncidents);
  return rows[0]?.count ?? 0;
}

export async function getIncident(id: string): Promise<
  | (IncidentRow & {
      diagnoses: DiagnosisRow[];
      remediations: RemediationRow[];
    })
  | null
> {
  const rows = await db
    .select({
      id: fixbotIncidents.id,
      monitorId: fixbotIncidents.monitorId,
      projectId: fixbotIncidents.projectId,
      projectSlug: projects.slug,
      title: fixbotIncidents.title,
      summary: fixbotIncidents.summary,
      status: fixbotIncidents.status,
      autonomy: fixbotIncidents.autonomy,
      openedAt: fixbotIncidents.openedAt,
      resolvedAt: fixbotIncidents.resolvedAt,
    })
    .from(fixbotIncidents)
    .leftJoin(projects, eq(projects.id, fixbotIncidents.projectId))
    .where(eq(fixbotIncidents.id, id))
    .limit(1);
  if (rows.length === 0) return null;
  const incident = rows[0] as IncidentRow;
  const [diagnoses, remediations] = await Promise.all([
    db
      .select()
      .from(fixbotDiagnoses)
      .where(eq(fixbotDiagnoses.incidentId, id))
      .orderBy(asc(fixbotDiagnoses.createdAt)),
    db
      .select()
      .from(fixbotRemediations)
      .where(eq(fixbotRemediations.incidentId, id))
      .orderBy(asc(fixbotRemediations.createdAt)),
  ]);
  return {
    ...incident,
    diagnoses: diagnoses.map((d) => ({
      id: d.id,
      incidentId: d.incidentId,
      rootCause: d.rootCause,
      evidence: asRecord(d.evidence),
      confidence: d.confidence as "low" | "medium" | "high",
      createdAt: d.createdAt,
    })),
    remediations: remediations.map((r) => ({
      id: r.id,
      incidentId: r.incidentId,
      action: r.action,
      description: r.description,
      payload: asRecord(r.payloadJson),
      approvalRequired: r.approvalRequired,
      status: r.status as RemediationRow["status"],
      appliedAt: r.appliedAt,
      createdAt: r.createdAt,
    })),
  };
}

export async function openIncident(args: {
  projectId: string | null;
  monitorId: string | null;
  title: string;
  summary: string | null;
  autonomy: AutonomyLevel;
  actor: string;
}): Promise<string> {
  const [row] = await db
    .insert(fixbotIncidents)
    .values({
      projectId: args.projectId,
      monitorId: args.monitorId,
      title: args.title,
      summary: args.summary,
      status: "open",
      autonomy: args.autonomy,
    })
    .returning({ id: fixbotIncidents.id });
  await recordAudit({
    actor: args.actor,
    action: "incident.opened",
    target: row.id,
    metadata: { title: args.title, autonomy: args.autonomy },
  });
  return row.id;
}

export async function dismissIncident(
  id: string,
  actor: string,
): Promise<void> {
  const rows = await db
    .update(fixbotIncidents)
    .set({ status: "dismissed", resolvedAt: sql`now()` })
    .where(eq(fixbotIncidents.id, id))
    .returning({ id: fixbotIncidents.id });
  if (rows.length === 0) throw new Error("incident not found");
  await recordAudit({
    actor,
    action: "incident.dismissed",
    target: id,
  });
}

export async function resolveIncident(
  id: string,
  actor: string,
  note: string | null = null,
): Promise<void> {
  const rows = await db
    .update(fixbotIncidents)
    .set({ status: "resolved", resolvedAt: sql`now()` })
    .where(eq(fixbotIncidents.id, id))
    .returning({ id: fixbotIncidents.id });
  if (rows.length === 0) throw new Error("incident not found");
  await recordAudit({
    actor,
    action: "incident.resolved",
    target: id,
    metadata: note ? { note } : null,
  });
}

export interface CreateMonitorArgs {
  projectId: string | null;
  kind: MonitorKind;
  label: string;
  config: Record<string, unknown>;
  actor: string;
}

export async function createMonitor(args: CreateMonitorArgs): Promise<string> {
  const [row] = await db
    .insert(fixbotMonitors)
    .values({
      projectId: args.projectId,
      kind: args.kind,
      label: args.label,
      config: args.config,
      status: "unknown",
    })
    .returning({ id: fixbotMonitors.id });
  await recordAudit({
    actor: args.actor,
    action: "monitor.created",
    target: row.id,
    metadata: {
      kind: args.kind,
      label: args.label,
      projectId: args.projectId,
    },
  });
  return row.id;
}

export async function deleteMonitor(
  id: string,
  actor: string,
): Promise<void> {
  const rows = await db
    .delete(fixbotMonitors)
    .where(eq(fixbotMonitors.id, id))
    .returning({ id: fixbotMonitors.id, label: fixbotMonitors.label });
  if (rows.length === 0) throw new Error("monitor not found");
  await recordAudit({
    actor,
    action: "monitor.deleted",
    target: id,
    metadata: { label: rows[0].label },
  });
}
