"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { isLiveMode } from "@/lib/env";
import { getBlueprintById } from "@/lib/db/blueprints";
import { listCredentials } from "@/lib/db/credentials";
import { getProjectById } from "@/lib/db/projects";
import { createRun } from "@/lib/db/runs";
import {
  ENVIRONMENTS,
  type Environment,
  type RunMode,
} from "@/lib/pipeline/stages";
import { advanceRunOne, autoAdvanceRun } from "@/lib/runs/advancer";
import { planRun } from "@/lib/runs/planner";
import { requireActorEmail } from "@/lib/server-actor";

function assertEnvironment(value: FormDataEntryValue | null): Environment {
  if (typeof value !== "string") throw new Error("environment is required");
  if (!(ENVIRONMENTS as readonly string[]).includes(value)) {
    throw new Error(`unknown environment: ${value}`);
  }
  return value as Environment;
}

export async function createDryRunAction(formData: FormData): Promise<void> {
  const actor = await requireActorEmail();
  const projectId = formData.get("projectId");
  const blueprintId = formData.get("blueprintId");
  const environment = assertEnvironment(formData.get("environment"));
  const requestedLive = formData.get("liveMode") === "1";

  if (typeof projectId !== "string" || !projectId) {
    throw new Error("projectId is required");
  }
  if (typeof blueprintId !== "string" || !blueprintId) {
    throw new Error("blueprintId is required");
  }

  let mode: RunMode = "dry_run";
  if (requestedLive) {
    if (!isLiveMode) {
      throw new Error(
        "DEPLOYOPS_LIVE=0; live mode is disabled at the env level. Flip the env flag before creating a live run.",
      );
    }
    const credentials = await listCredentials();
    const required = ["github_pat", "vercel", "neon"] as const;
    const unverified = required.filter(
      (k) =>
        credentials.find((c) => c.kind === k)?.connectionState !== "verified",
    );
    if (unverified.length > 0) {
      throw new Error(
        `Live mode blocked: providers not verified — ${unverified.join(", ")}.`,
      );
    }
    mode = "live";
  }

  const [project, blueprint] = await Promise.all([
    getProjectById(projectId),
    getBlueprintById(blueprintId),
  ]);
  if (!project) throw new Error("project not found");
  if (!blueprint) throw new Error("blueprint not found");

  const plan = planRun({
    project: {
      id: project.id,
      slug: project.slug,
      githubOwner: project.githubOwner,
      githubRepo: project.githubRepo,
      defaultBranch: project.defaultBranch,
      customDomain: project.customDomain,
    },
    blueprint: blueprint.definition,
    environment,
  });

  const runId = await createRun({
    projectId: project.id,
    environment,
    mode,
    plan,
    plannedStages: plan.stages,
    actor,
  });

  revalidatePath("/runs");
  revalidatePath("/");
  redirect(`/runs/${runId}`);
}

export async function advanceStageAction(formData: FormData): Promise<void> {
  const runId = formData.get("runId");
  if (typeof runId !== "string" || !runId) {
    throw new Error("runId is required");
  }
  await advanceRunOne(runId, await requireActorEmail());
  revalidatePath(`/runs/${runId}`);
  revalidatePath("/runs");
  revalidatePath("/");
}

export async function autoAdvanceAction(formData: FormData): Promise<void> {
  const runId = formData.get("runId");
  if (typeof runId !== "string" || !runId) {
    throw new Error("runId is required");
  }
  await autoAdvanceRun(runId, await requireActorEmail());
  revalidatePath(`/runs/${runId}`);
  revalidatePath("/runs");
  revalidatePath("/");
}
