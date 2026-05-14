import "server-only";

import { isLiveMode } from "@/lib/env";
import { recordAudit } from "@/lib/db/audit";
import {
  getCredentialPlaintext,
  listCredentials,
} from "@/lib/db/credentials";
import { getProjectById } from "@/lib/db/projects";
import {
  getRun,
  markRunFinished,
  markRunStarted,
  markStageRunning,
  nextPendingStage,
  updateStageOutcome,
} from "@/lib/db/runs";
import { executeStageLive } from "@/lib/live/dispatch";
import type { StageOutcome } from "@/lib/live/types";

import { simulateStage } from "./dryrun";

export interface AdvanceResult {
  advanced: boolean;
  runStatus: "pending" | "running" | "succeeded" | "failed" | "cancelled";
  stage?: {
    id: string;
    kind: string;
    status: "running" | "succeeded" | "failed" | "skipped";
    logTail: string;
  };
  reason?: string;
}

async function loadLiveContextOrThrow(projectId: string | null): Promise<{
  providerIds: {
    vercelProjectId: string | null;
    vercelTeamId: string | null;
    neonProjectId: string | null;
  };
  credentials: { github: string; vercel: string; neon: string };
}> {
  if (!isLiveMode) {
    throw new Error(
      "live mode is gated by DEPLOYOPS_LIVE=1; this run is marked live but the env flag is off",
    );
  }
  if (!projectId) {
    throw new Error("live run requires a project");
  }
  const credentials = await listCredentials();
  const required = ["github_pat", "vercel", "neon"] as const;
  const unverified = required.filter(
    (k) => credentials.find((c) => c.kind === k)?.connectionState !== "verified",
  );
  if (unverified.length > 0) {
    throw new Error(
      `live run blocked: providers not verified — ${unverified.join(", ")}`,
    );
  }
  const project = await getProjectById(projectId);
  if (!project) throw new Error("project not found for live run");
  const [github, vercel, neon] = await Promise.all([
    getCredentialPlaintext("github_pat"),
    getCredentialPlaintext("vercel"),
    getCredentialPlaintext("neon"),
  ]);
  if (!github || !vercel || !neon) {
    throw new Error("live run blocked: missing decrypted credential");
  }
  return {
    providerIds: {
      vercelProjectId: project.vercelProjectId,
      vercelTeamId: project.vercelTeamId,
      neonProjectId: project.neonProjectId,
    },
    credentials: { github, vercel, neon },
  };
}

export async function advanceRunOne(
  runId: string,
  actor: string,
): Promise<AdvanceResult> {
  const run = await getRun(runId);
  if (!run) throw new Error("run not found");
  if (!run.plan) {
    throw new Error("run has no plan_json; cannot simulate stages");
  }
  if (
    run.status === "succeeded" ||
    run.status === "failed" ||
    run.status === "cancelled"
  ) {
    return {
      advanced: false,
      runStatus: run.status,
      reason: "run already terminal",
    };
  }

  const stage = await nextPendingStage(runId);
  if (!stage) {
    const anyFailed = run.stages.some((s) => s.status === "failed");
    const finalStatus = anyFailed ? "failed" : "succeeded";
    await markRunFinished(runId, finalStatus);
    await recordAudit({
      actor,
      action: anyFailed ? "run.failed" : "run.succeeded",
      target: runId,
    });
    return {
      advanced: false,
      runStatus: finalStatus,
      reason: "no pending stages",
    };
  }

  if (run.status === "pending") {
    await markRunStarted(runId);
  }

  await markStageRunning(stage.id);

  let outcome: StageOutcome;
  try {
    if (run.mode === "live") {
      const liveCtx = await loadLiveContextOrThrow(run.projectId);
      outcome = await executeStageLive(stage.kind, {
        plan: run.plan,
        providerIds: liveCtx.providerIds,
        credentials: liveCtx.credentials,
      });
    } else {
      const sim = simulateStage(stage.kind, run.plan);
      outcome = {
        status: "succeeded",
        logLines: sim.logLines,
        output: sim.output,
      };
    }
  } catch (err) {
    outcome = {
      status: "failed",
      logLines: [
        "Stage advancer threw before reaching the provider.",
        err instanceof Error ? err.message : String(err),
      ],
      output: { stageKind: stage.kind },
      error: {
        message: err instanceof Error ? err.message : "unknown",
      },
    };
  }

  const log = outcome.logLines.join("\n");
  await updateStageOutcome({
    stageId: stage.id,
    status: outcome.status,
    logText: log,
    output: outcome.output,
  });

  await recordAudit({
    actor,
    action: "stage.advanced",
    target: runId,
    metadata: {
      stageId: stage.id,
      kind: stage.kind,
      status: outcome.status,
      mode: run.mode,
    },
  });

  type FinalStageStatus = "running" | "succeeded" | "failed" | "skipped";
  const stageStatus: FinalStageStatus =
    outcome.status === "succeeded" ||
    outcome.status === "failed" ||
    outcome.status === "skipped"
      ? outcome.status
      : "running";

  return {
    advanced: true,
    runStatus: outcome.status === "failed" ? "failed" : "running",
    stage: {
      id: stage.id,
      kind: stage.kind,
      status: stageStatus,
      logTail: log.split("\n").slice(-2).join("\n"),
    },
  };
}

/**
 * Walk a run to completion. Stops on the first failed stage so the operator
 * can investigate before retrying. Caps at 32 iterations as a safety net.
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
    if (last.stage?.status === "failed") return last;
  }
  return last;
}
