import "server-only";

import { db } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema";

export interface AuditEntry {
  actor: string;
  action: string;
  target?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function recordAudit(entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    actor: entry.actor,
    action: entry.action,
    target: entry.target ?? null,
    metadataJson: entry.metadata ?? null,
  });
}
