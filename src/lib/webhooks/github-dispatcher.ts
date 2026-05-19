import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { getBlueprintById } from "@/lib/db/blueprints";
import { recordAudit } from "@/lib/db/audit";
import { createRun } from "@/lib/db/runs";
import { projects } from "@/lib/db/schema";
import { planRun } from "@/lib/runs/planner";

interface PushPayload {
  ref?: string;
  repository?: {
    owner?: { login?: string; name?: string };
    name?: string;
    default_branch?: string;
  };
  pusher?: { name?: string; email?: string };
}

function looksLikePushPayload(value: unknown): value is PushPayload {
  return typeof value === "object" && value !== null && "repository" in value;
}

export interface DispatchResult {
  ignored: boolean;
  reason?: string;
  runId?: string;
  projectId?: string;
}

/**
 * On a GitHub `push` event, find the matching project and create a dry-run
 * for the default environment ('test'). Returns ignored=true when:
 *   - the event isn't a push
 *   - the repository can't be matched to a project
 *   - the pushed ref isn't the project's default branch
 *   - the project has no blueprint bound
 *
 * Live runs are never auto-created — the operator has to opt in explicitly
 * on /runs/new.
 */
export async function dispatchGithubWebhook(args: {
  eventType: string;
  payload: unknown;
  webhookEventId: string;
}): Promise<DispatchResult> {
  if (args.eventType !== "push") {
    return { ignored: true, reason: `event-type:${args.eventType}` };
  }
  if (!looksLikePushPayload(args.payload)) {
    return { ignored: true, reason: "payload-shape" };
  }
  const repo = args.payload.repository;
  if (!repo) return { ignored: true, reason: "missing-repository" };

  const owner = repo.owner?.login ?? repo.owner?.name;
  const name = repo.name;
  if (!owner || !name) {
    return { ignored: true, reason: "missing-owner-or-repo" };
  }
  const slug = `${owner.toLowerCase()}/${name.toLowerCase()}`;

  const rows = await db
    .select()
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  if (rows.length === 0) {
    return { ignored: true, reason: "project-not-tracked" };
  }
  const project = rows[0];

  if (!project.blueprintId) {
    return {
      ignored: true,
      reason: "project-has-no-blueprint",
      projectId: project.id,
    };
  }

  // Match the pushed ref against the project's default branch.
  const expectedRef = `refs/heads/${project.defaultBranch ?? repo.default_branch ?? "main"}`;
  if (args.payload.ref !== expectedRef) {
    return {
      ignored: true,
      reason: `ref-mismatch:${args.payload.ref}`,
      projectId: project.id,
    };
  }

  const blueprint = await getBlueprintById(project.blueprintId);
  if (!blueprint) {
    return {
      ignored: true,
      reason: "blueprint-missing",
      projectId: project.id,
    };
  }

  const actor =
    args.payload.pusher?.email ??
    (args.payload.pusher?.name
      ? `github:${args.payload.pusher.name}`
      : "github-webhook");

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
    environment: "test",
  });

  const runId = await createRun({
    projectId: project.id,
    environment: "test",
    mode: "dry_run",
    plan,
    plannedStages: plan.stages,
    actor,
  });

  await recordAudit({
    actor,
    action: "run.auto-created",
    target: runId,
    metadata: {
      source: "github-webhook",
      webhookEventId: args.webhookEventId,
      slug: project.slug,
      ref: args.payload.ref,
    },
  });

  return { ignored: false, runId, projectId: project.id };
}
