import "server-only";

import { db } from "@/lib/db/client";
import { recordAudit } from "@/lib/db/audit";
import { fixbotRemediations } from "@/lib/db/schema";
import { canRunRemediationAction } from "@/lib/fixbot/autonomy";
import type { AutonomyLevel } from "@/lib/db/schema";

export interface DraftRemediationArgs {
  incidentId: string;
  /** Verb identifying the kind of fix, e.g. 'env.add', 'deploy.retry'. */
  action: string;
  /** Human-readable description shown on the incident detail page. */
  description: string;
  /** Structured fix payload (env-var list, deployment id, etc.). */
  payload?: Record<string, unknown> | null;
  /** Autonomy level of the incident; controls whether drafting is allowed. */
  autonomy: AutonomyLevel;
  /** Audit-log actor (usually 'cron:monitors'). */
  actor: string;
}

export interface DraftResult {
  remediationId: string | null;
  skipped: boolean;
  reason?: string;
}

/**
 * Draft a remediation against an incident. Respects the incident's autonomy
 * level via canRunRemediationAction('prepare') — `diagnose-only` incidents
 * never get a drafted remediation.
 *
 * Drafts always start as `status='draft'` + `approvalRequired=true`. The
 * operator has to explicitly apply via the incident detail page; this
 * function does NOT apply remediations.
 */
export async function draftRemediation(
  args: DraftRemediationArgs,
): Promise<DraftResult> {
  const gate = canRunRemediationAction(args.autonomy, "prepare");
  if (!gate.allowed) {
    return { remediationId: null, skipped: true, reason: gate.reason };
  }
  const [row] = await db
    .insert(fixbotRemediations)
    .values({
      incidentId: args.incidentId,
      action: args.action,
      description: args.description,
      payloadJson: args.payload ?? null,
      approvalRequired: true,
      status: "draft",
    })
    .returning({ id: fixbotRemediations.id });
  await recordAudit({
    actor: args.actor,
    action: "remediation.drafted",
    target: row.id,
    metadata: {
      incidentId: args.incidentId,
      action: args.action,
    },
  });
  return { remediationId: row.id, skipped: false };
}
