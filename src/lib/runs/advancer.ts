import "server-only";

import {
  getRun,
  markRunFinished,
  markRunStarted,
  markStageRunning,
  nextPendingStage,
  updateStageOutcome,
} from "@/lib/db/runs";
import { recordAudit } from "@/lib/db/audit";

import { simulateStage } from "./dryrun";

export interface AdvanceResult {
  advanced: boolean;
  runStatus: "pending" | "running" | "succeeded" | "failed" | "cancelled";
  /** The stage that just transitioned, if any. */
  stage?: {
    id: string;
    kind: string;
    status: "running" | "succeeded" | "failed" | "skipped";
    logTail: string;
  };
  /** Reason the call didn't advance, when `advanced` is false. */
  reason?: string;
}

/**
 * Advance the run by exactly one pending stage. Idempotent: re-calling
 * after the run finishes is a no-op that returns the terminal status.
 */
export async function advanceRunOne(
  runId: string,
  actor: string,
): Promise<AdvanceResult> {
  const run = await getRun(runId);
  if (!run) throw new Error("run not found");
  if (!run.plan) {
    throw new Error("run has no plan_json; cannot simulate stages");
  }
  if (run.status === "succeeded" || run.status === "failed" || run.status === "cancelled") {
    return { advanced: false, runStatus: run.status, reason: "run already terminal" };
  }

  const stage = await nextPendingStage(runId);
  if (!stage) {
    // No pending stages: close out the run.
    const anyFailed = run.stages.some((s) => s.status === "failed");
    const finalStatus = anyFailed ? "failed" : "succeeded";
    await markRunFinished(runId, finalStatus);
    await recordAudit({
      actor,
      action: anyFailed ? "run.failed" : "run.succeeded",
      target: runId,
    });
    return { advanced: false, runStatus: finalStatus, reason: "no pending stages" };
  }

  if (run.status === "pending") {
    await markRunStarted(runId);
  }

  await markStageRunning(stage.id);
  const sim = simulateStage(stage.kind, run.plan);
  const log = sim.logLines.join("\n");
  await updateStageOutcome({
    stageId: stage.id,
    status: "succeeded",
    logText: log,
    output: sim.output,
  });

  await recordAudit({
    actor,
    action: "stage.advanced",
    target: runId,
    metadata: { stageId: stage.id, kind: stage.kind, status: "succeeded" },
  });

  return {
    advanced: true,
    runStatus: "running",
    stage: {
      id: stage.id,
      kind: stage.kind,
      status: "succeeded",
      logTail: log.split("\n").slice(-2).join("\n"),
    },
  };
}

/**
 * Walk a run to completion in dry-run mode. Caps at 32 iterations to
 * avoid runaway loops on a malformed blueprint.
 */
export async function autoAdvanceRun(
  runId: string,
  actor: string,
): Promise<AdvanceResult> {
  let last: AdvanceResult = {
    advanced: false,
    runStatus: "pending",
  };
  for (let i = 0; i < 32; i++) {
    last = await advanceRunOne(runId, actor);
    if (!last.advanced) return last;
  }
  return last;
}
