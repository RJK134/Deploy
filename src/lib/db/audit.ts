import "server-only";

import { desc, lt, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema";

export interface AuditEntry {
  actor: string;
  action: string;
  target?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface AuditRow {
  id: string;
  actor: string;
  action: string;
  target: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export async function recordAudit(entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    actor: entry.actor,
    action: entry.action,
    target: entry.target ?? null,
    metadataJson: entry.metadata ?? null,
  });
}

export async function listAudit(args: {
  limit?: number;
  before?: Date;
} = {}): Promise<AuditRow[]> {
  const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
  const where = args.before ? lt(auditLog.createdAt, args.before) : undefined;
  const query = db
    .select({
      id: auditLog.id,
      actor: auditLog.actor,
      action: auditLog.action,
      target: auditLog.target,
      metadata: auditLog.metadataJson,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);
  const rows = where ? await query.where(where) : await query;
  return rows.map((r) => ({
    id: r.id,
    actor: r.actor,
    action: r.action,
    target: r.target,
    metadata: isPlainObject(r.metadata) ? r.metadata : null,
    createdAt: r.createdAt,
  }));
}

export async function countAudit(): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(auditLog);
  return rows[0]?.count ?? 0;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
