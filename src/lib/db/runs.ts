import "server-only";

import { and, asc, desc, eq, gte, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { recordAudit } from "@/lib/db/audit";
import {
  projects,
  runs,
  stages as stagesTable,
} from "@/lib/db/schema";
import type { Environment, RunMode, RunStatus, StageKind, StageStatus } from "@/lib/pipeline/stages";
import { isRunPlan, type RunPlan } from "@/lib/runs/planner";

export interface RunListItem {
  id: string;
  projectId: string | null;
  projectSlug: string | null;
  environment: Environment;
  mode: RunMode;
  status: RunStatus;
  startedAt: Date | null;
  finishedAt: Date | null;
  triggeredBy: string | null;
  createdAt: Date;
}

export interface StageRow {
  id: string;
  runId: string;
  sequence: number;
  kind: StageKind;
  status: StageStatus;
  startedAt: Date | null;
  finishedAt: Date | null;
  logText: string;
  errorJson: unknown;
  outputJson: unknown;
}

export interface RunDetail {
  id: string;
  projectId: string | null;
  projectSlug: string | null;
  environment: Environment;
  mode: RunMode;
  status: RunStatus;
  plan: RunPlan | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  triggeredBy: string | null;
  createdAt: Date;
  stages: StageRow[];
}

interface PlannedStageInput {
  sequence: number;
  kind: StageKind;
  skipped: boolean;
}

export async function createRun(args: {
  projectId: string;
  environment: Environment;
  mode: RunMode;
  plan: RunPlan;
  plannedStages: PlannedStageInput[];
  actor: string;
}): Promise<string> {
  const { projectId, environment, mode, plan, plannedStages, actor } = args;

  const [run] = await db
    .insert(runs)
    .values({
      projectId,
      environment,
      mode,
      status: "pending",
      planJson: plan,
      triggeredBy: actor,
    })
    .returning({ id: runs.id });

  if (plannedStages.length > 0) {
    await db.insert(stagesTable).values(
      plannedStages.map((s) => ({
        runId: run.id,
        sequence: s.sequence,
        kind: s.kind,
        status: (s.skipped ? "skipped" : "pending") as StageStatus,
        logText: "",
      })),
    );
  }

  await recordAudit({
    actor,
    action: "run.created",
    target: run.id,
    metadata: {
      mode,
      environment,
      blueprintSlug: plan.blueprintSlug,
    },
  });

  return run.id;
}

/** @deprecated use createRun with mode: 'dry_run'. */
export const createDryRun = (
  args: Omit<Parameters<typeof createRun>[0], "mode">,
) => createRun({ ...args, mode: "dry_run" });

export async function listRuns(limit = 50): Promise<RunListItem[]> {
  const rows = await db
    .select({
      id: runs.id,
      projectId: runs.projectId,
      projectSlug: projects.slug,
      environment: runs.environment,
      mode: runs.mode,
      status: runs.status,
      startedAt: runs.startedAt,
      finishedAt: runs.finishedAt,
      triggeredBy: runs.triggeredBy,
      createdAt: runs.createdAt,
    })
    .from(runs)
    .leftJoin(projects, eq(projects.id, runs.projectId))
    .orderBy(desc(runs.createdAt))
    .limit(limit);
  return rows as RunListItem[];
}

export async function countRunsSince(date: Date): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(runs)
    .where(gte(runs.createdAt, date));
  return rows[0]?.count ?? 0;
}

export async function getRun(id: string): Promise<RunDetail | null> {
  const rows = await db
    .select({
      id: runs.id,
      projectId: runs.projectId,
      projectSlug: projects.slug,
      environment: runs.environment,
      mode: runs.mode,
      status: runs.status,
      planJson: runs.planJson,
      startedAt: runs.startedAt,
      finishedAt: runs.finishedAt,
      triggeredBy: runs.triggeredBy,
      createdAt: runs.createdAt,
    })
    .from(runs)
    .leftJoin(projects, eq(projects.id, runs.projectId))
    .where(eq(runs.id, id))
    .limit(1);
  if (rows.length === 0) return null;
  const row = rows[0];

  const stageRows = await db
    .select()
    .from(stagesTable)
    .where(eq(stagesTable.runId, id))
    .orderBy(asc(stagesTable.sequence));

  return {
    id: row.id,
    projectId: row.projectId,
    projectSlug: row.projectSlug,
    environment: row.environment as Environment,
    mode: row.mode as RunMode,
    status: row.status as RunStatus,
    plan: isRunPlan(row.planJson) ? row.planJson : null,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    triggeredBy: row.triggeredBy,
    createdAt: row.createdAt,
    stages: stageRows.map((s) => ({
      id: s.id,
      runId: s.runId,
      sequence: s.sequence,
      kind: s.kind as StageKind,
      status: s.status as StageStatus,
      startedAt: s.startedAt,
      finishedAt: s.finishedAt,
      logText: s.logText ?? "",
      errorJson: s.errorJson,
      outputJson: s.outputJson,
    })),
  };
}

/**
 * Find the next stage that should run next: the lowest-sequence row that is
 * in `pending` state. Skipped stages are bypassed by status filter.
 */
export async function nextPendingStage(runId: string): Promise<StageRow | null> {
  const rows = await db
    .select()
    .from(stagesTable)
    .where(
      and(eq(stagesTable.runId, runId), eq(stagesTable.status, "pending")),
    )
    .orderBy(asc(stagesTable.sequence))
    .limit(1);
  if (rows.length === 0) return null;
  const s = rows[0];
  return {
    id: s.id,
    runId: s.runId,
    sequence: s.sequence,
    kind: s.kind as StageKind,
    status: s.status as StageStatus,
    startedAt: s.startedAt,
    finishedAt: s.finishedAt,
    logText: s.logText ?? "",
    errorJson: s.errorJson,
    outputJson: s.outputJson,
  };
}

export async function markRunStarted(runId: string): Promise<void> {
  await db
    .update(runs)
    .set({ status: "running", startedAt: sql`coalesce(${runs.startedAt}, now())` })
    .where(eq(runs.id, runId));
}

export async function markRunFinished(
  runId: string,
  status: RunStatus,
): Promise<void> {
  await db
    .update(runs)
    .set({ status, finishedAt: sql`now()` })
    .where(eq(runs.id, runId));
}

export async function updateStageOutcome(args: {
  stageId: string;
  status: StageStatus;
  logText: string;
  output: Record<string, unknown>;
}): Promise<void> {
  await db
    .update(stagesTable)
    .set({
      status: args.status,
      finishedAt: sql`now()`,
      logText: args.logText,
      outputJson: args.output,
    })
    .where(eq(stagesTable.id, args.stageId));
}

export async function markStageRunning(stageId: string): Promise<void> {
  await db
    .update(stagesTable)
    .set({ status: "running", startedAt: sql`now()` })
    .where(eq(stagesTable.id, stageId));
}

export async function deleteRunsForProject(projectId: string): Promise<number> {
  // Cascade is declared at the schema level for stages; runs themselves do
  // not cascade from projects (FK is nullable). Returning the deleted count
  // for logging.
  const rows = await db
    .delete(runs)
    .where(eq(runs.projectId, projectId))
    .returning({ id: runs.id });
  return rows.length;
}
