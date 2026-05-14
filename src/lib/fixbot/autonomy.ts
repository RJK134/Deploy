import type { AutonomyLevel } from "@/lib/db/schema";

export type RemediationAction =
  | "diagnose"
  | "prepare"
  | "queue"
  | "apply";

export interface AutonomyDecision {
  allowed: boolean;
  reason: string;
}

/**
 * Decide whether a remediation action is allowed at the incident's autonomy
 * level. Pure function so it's easy to unit-test.
 *
 * Rules:
 * - diagnose-only:       only `diagnose` (the analyzer can write a diagnosis)
 * - prepare-fix:         diagnose + prepare (draft remediations; no queue/apply)
 * - approval-required:   diagnose + prepare + queue (apply needs human OK)
 * - safe-auto-fix:       all four (reserved for idempotent low-risk fixes)
 */
export function canRunRemediationAction(
  level: AutonomyLevel,
  action: RemediationAction,
): AutonomyDecision {
  switch (level) {
    case "diagnose-only":
      return action === "diagnose"
        ? { allowed: true, reason: "diagnose-only autonomy" }
        : {
            allowed: false,
            reason:
              "incident autonomy is diagnose-only; remediations cannot be drafted or applied",
          };
    case "prepare-fix":
      if (action === "diagnose" || action === "prepare") {
        return { allowed: true, reason: "prepare-fix autonomy" };
      }
      return {
        allowed: false,
        reason: "prepare-fix autonomy can draft but not queue or apply",
      };
    case "approval-required":
      if (action === "apply") {
        return {
          allowed: false,
          reason:
            "apply requires explicit operator approval before flipping to safe-auto-fix",
        };
      }
      return { allowed: true, reason: "approval-required autonomy" };
    case "safe-auto-fix":
      return { allowed: true, reason: "safe-auto-fix autonomy" };
  }
}

export const AUTONOMY_BLURB: Record<AutonomyLevel, string> = {
  "diagnose-only":
    "Records a root cause and evidence. Will never draft or apply a remediation.",
  "prepare-fix":
    "Drafts remediations (PR body, env diff) but never queues or applies them.",
  "approval-required":
    "Drafts and queues. A human approval is required before any apply.",
  "safe-auto-fix":
    "Reserved for idempotent low-risk fixes (e.g. re-attach domain).",
};
