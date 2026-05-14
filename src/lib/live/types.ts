import type { RunPlan } from "@/lib/runs/planner";
import type { StageKind, StageStatus } from "@/lib/pipeline/stages";

/**
 * Unified outcome shape returned by both the dry-run simulator and the live
 * adapters. The run advancer reads `status` to decide whether to flip the
 * stage row to 'succeeded' or 'failed'.
 */
export interface StageOutcome {
  status: StageStatus;
  logLines: string[];
  output: Record<string, unknown>;
  error?: Record<string, unknown> | null;
}

export interface ProjectProviderIds {
  vercelProjectId: string | null;
  vercelTeamId: string | null;
  neonProjectId: string | null;
}

export interface LiveStageContext {
  plan: RunPlan;
  providerIds: ProjectProviderIds;
  credentials: {
    github: string;
    vercel: string;
    neon: string;
  };
}

export type LiveStageRunner = (ctx: LiveStageContext) => Promise<StageOutcome>;

export function notImplementedLiveOutcome(
  reason: string,
  context: Record<string, unknown> = {},
): StageOutcome {
  return {
    status: "failed",
    logLines: [
      "Live execution declined this stage.",
      `Reason: ${reason}`,
      "Re-run as dry-run to continue verifying the pipeline, or address the precondition and retry.",
    ],
    output: { liveExecuted: false, ...context },
    error: { reason },
  };
}

/**
 * Stages that succeed without making provider mutations even in live mode.
 * env.resolve is pure; smoke.test makes only an unauthenticated GET.
 */
export const NON_MUTATING_STAGE_KINDS: ReadonlySet<StageKind> = new Set([
  "env.resolve",
  "smoke.test",
]);
