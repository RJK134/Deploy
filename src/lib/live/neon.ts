import { probeJson } from "@/lib/providers/probe";

import {
  notImplementedLiveOutcome,
  type LiveStageContext,
  type StageOutcome,
} from "./types";

const NEON_HEADERS = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/json",
  "Content-Type": "application/json",
});

/**
 * Create a Neon branch named `${environment}-${repo}` if it doesn't already
 * exist. Idempotent: returns the existing branch when found, posts otherwise.
 */
export async function liveDbProvision(
  ctx: LiveStageContext,
): Promise<StageOutcome> {
  const projectId = ctx.providerIds.neonProjectId;
  if (!projectId) {
    return notImplementedLiveOutcome(
      "project.neonProjectId is not set; cannot provision a branch without a Neon project to target. Edit the project on /projects and paste the Neon project id.",
      { plan: ctx.plan.project.slug },
    );
  }

  const listRes = await probeJson(
    `https://console.neon.tech/api/v2/projects/${encodeURIComponent(projectId)}/branches`,
    { headers: NEON_HEADERS(ctx.credentials.neon) },
  );
  if (!listRes.ok) {
    return {
      status: "failed",
      logLines: [
        `GET /projects/${projectId}/branches failed: ${listRes.message}`,
      ],
      output: { status: listRes.status },
      error: { provider: "neon", projectId, message: listRes.message },
    };
  }

  const detail = listRes.detail ?? {};
  const branchesArr = Array.isArray(detail.branches) ? detail.branches : [];
  const targetName = ctx.plan.predicted.branchName;
  const existing = branchesArr.find(
    (b: unknown) =>
      typeof b === "object" &&
      b !== null &&
      "name" in b &&
      (b as { name: unknown }).name === targetName,
  ) as { id?: string; name?: string } | undefined;

  if (existing) {
    return {
      status: "succeeded",
      logLines: [
        `Branch '${targetName}' already exists (id=${existing.id ?? "unknown"}); re-using.`,
        "No POST sent — idempotent reuse path.",
      ],
      output: {
        projectId,
        branchId: existing.id ?? null,
        branchName: targetName,
        created: false,
      },
    };
  }

  // Create the branch.
  const createRes = await probeJson(
    `https://console.neon.tech/api/v2/projects/${encodeURIComponent(projectId)}/branches`,
    {
      method: "POST",
      headers: NEON_HEADERS(ctx.credentials.neon),
      body: JSON.stringify({
        branch: { name: targetName },
        endpoints: [{ type: "read_write" }],
      }),
    },
  );

  if (!createRes.ok) {
    return {
      status: "failed",
      logLines: [
        `POST /projects/${projectId}/branches failed: ${createRes.message}`,
      ],
      output: { status: createRes.status, branchName: targetName },
      error: {
        provider: "neon",
        projectId,
        branchName: targetName,
        message: createRes.message,
      },
    };
  }

  const created = createRes.detail ?? {};
  const newBranch =
    typeof created.branch === "object" && created.branch !== null
      ? (created.branch as { id?: string; name?: string })
      : {};

  return {
    status: "succeeded",
    logLines: [
      `Created Neon branch '${targetName}' (id=${newBranch.id ?? "unknown"}).`,
      `Provisioned read_write endpoint; pooled URL available on the Neon dashboard.`,
    ],
    output: {
      projectId,
      branchId: newBranch.id ?? null,
      branchName: targetName,
      created: true,
    },
  };
}

/**
 * db.migrate still can't run in a serverless function (no shell, no Postgres
 * client baked in). We surface the migrate command and the resolved pooled
 * URL placeholder so the operator (or a future GitHub Actions runner) can
 * replay it.
 */
export async function liveDbMigrate(
  ctx: LiveStageContext,
): Promise<StageOutcome> {
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
