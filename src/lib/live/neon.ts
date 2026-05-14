import { probeJson } from "@/lib/providers/probe";

import {
  notImplementedLiveOutcome,
  type LiveStageContext,
  type StageOutcome,
} from "./types";

const NEON_HEADERS = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/json",
});

export async function liveDbProvision(
  ctx: LiveStageContext,
): Promise<StageOutcome> {
  const projectId = ctx.providerIds.neonProjectId;
  if (!projectId) {
    return notImplementedLiveOutcome(
      "project.neonProjectId is not set; cannot provision a branch without a Neon project to target.",
      { plan: ctx.plan.project.slug },
    );
  }
  const probe = await probeJson(
    `https://console.neon.tech/api/v2/projects/${encodeURIComponent(projectId)}/branches`,
    { headers: NEON_HEADERS(ctx.credentials.neon) },
  );
  if (!probe.ok) {
    return {
      status: "failed",
      logLines: [
        `GET /projects/${projectId}/branches failed: ${probe.message}`,
      ],
      output: { status: probe.status },
      error: { provider: "neon", projectId, message: probe.message },
    };
  }
  const detail = probe.detail ?? {};
  const branchesArr = Array.isArray(detail.branches) ? detail.branches : [];
  const target = ctx.plan.predicted.branchName;
  const existing = branchesArr.find(
    (b: unknown) =>
      typeof b === "object" &&
      b !== null &&
      "name" in b &&
      (b as { name: unknown }).name === target,
  );
  return {
    status: "succeeded",
    logLines: [
      `Authenticated to Neon project ${projectId}.`,
      `Found ${branchesArr.length} existing branch${branchesArr.length === 1 ? "" : "es"}.`,
      existing
        ? `Branch '${target}' already exists; would re-use it for this environment.`
        : `Branch '${target}' does not exist yet; would create it.`,
      "(live: validated project access; branch creation deferred until Session 7)",
    ],
    output: {
      projectId,
      existingBranchCount: branchesArr.length,
      targetBranchName: target,
      targetBranchExists: Boolean(existing),
    },
  };
}

export async function liveDbMigrate(
  ctx: LiveStageContext,
): Promise<StageOutcome> {
  // db.migrate requires a shell environment (running pnpm db:push / prisma
  // migrate deploy) — not feasible from a serverless function. We surface
  // the command the operator (or a future GitHub Actions runner) should run.
  return {
    status: "succeeded",
    logLines: [
      "Live migration runner is not executable from the serverless app.",
      `When the CI workflow runs the deploy job it will execute: ${ctx.plan.commands.migrate ?? "(none configured)"}.`,
      "Tracking the command so the operator can replay manually if needed.",
    ],
    output: {
      migrateCommand: ctx.plan.commands.migrate ?? null,
      executedHere: false,
      deferredTo: "github-actions",
    },
  };
}
