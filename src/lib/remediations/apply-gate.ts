/**
 * Pure helpers for the remediation apply path. Decision logic that doesn't
 * touch the DB or fetch lives here so it can be unit-tested without mocks.
 */

import type { AutonomyLevel } from "@/lib/db/schema";
import { canRunRemediationAction } from "@/lib/fixbot/autonomy";

export type RemediationAction =
  | "probe.retry"
  | "deploy.retry"
  | "workflow.rerun"
  | "env.add"
  | "domain.attach"
  | "domain.verify";

export const KNOWN_ACTIONS: ReadonlyArray<RemediationAction> = [
  "probe.retry",
  "deploy.retry",
  "workflow.rerun",
  "env.add",
  "domain.attach",
  "domain.verify",
];

export function isKnownAction(value: string): value is RemediationAction {
  return (KNOWN_ACTIONS as readonly string[]).includes(value);
}

export interface ApplyGateResult {
  allowed: boolean;
  reason: string;
}

/**
 * Top-level allow check. Combines:
 *   - the incident's autonomy level (via canRunRemediationAction(..., 'apply'))
 *   - the global DEPLOYOPS_LIVE kill switch for actions that mutate provider state
 *   - the remediation row's current status (only 'draft' is applyable)
 */
export function checkApplyGate(args: {
  action: RemediationAction;
  autonomy: AutonomyLevel;
  liveModeOn: boolean;
  currentStatus: string;
}): ApplyGateResult {
  if (args.currentStatus !== "draft") {
    return {
      allowed: false,
      reason: `remediation status is '${args.currentStatus}', not 'draft'`,
    };
  }
  const autonomy = canRunRemediationAction(args.autonomy, "apply");
  if (!autonomy.allowed) return autonomy;
  if (mutatesProviders(args.action) && !args.liveModeOn) {
    return {
      allowed: false,
      reason:
        "DEPLOYOPS_LIVE=0 — apply for this action would mutate a provider; flip the env flag first",
    };
  }
  return { allowed: true, reason: "all gates open" };
}

/**
 * Actions that hit a provider mutation endpoint. Apply path refuses these
 * in dry-run global state even if the autonomy level otherwise permits.
 */
export function mutatesProviders(action: RemediationAction): boolean {
  switch (action) {
    case "probe.retry":
      return false; // re-probe is a GET
    case "env.add":
      return false; // manual-instructions only; no auto-POST
    case "deploy.retry":
    case "workflow.rerun":
    case "domain.attach":
    case "domain.verify":
      return true;
  }
}
