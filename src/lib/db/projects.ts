import "server-only";

import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { recordAudit } from "@/lib/db/audit";
import {
  ACCESS_MODES,
  projects,
  type AccessMode,
} from "@/lib/db/schema";
import { normaliseCustomDomain } from "@/lib/format/domain";

export interface ProjectView {
  id: string;
  slug: string;
  githubOwner: string;
  githubRepo: string;
  blueprintId: string | null;
  defaultBranch: string | null;
  framework: string | null;
  accessMode: AccessMode;
  customDomain: string | null;
  vercelProjectId: string | null;
  vercelTeamId: string | null;
  neonProjectId: string | null;
  createdAt: Date;
}

export { ACCESS_MODES, type AccessMode };

function slugFor(owner: string, repo: string): string {
  return `${owner.toLowerCase()}/${repo.toLowerCase()}`;
}

const projectColumns = {
  id: projects.id,
  slug: projects.slug,
  githubOwner: projects.githubOwner,
  githubRepo: projects.githubRepo,
  blueprintId: projects.blueprintId,
  defaultBranch: projects.defaultBranch,
  framework: projects.framework,
  accessMode: projects.accessMode,
  customDomain: projects.customDomain,
  vercelProjectId: projects.vercelProjectId,
  vercelTeamId: projects.vercelTeamId,
  neonProjectId: projects.neonProjectId,
  createdAt: projects.createdAt,
} as const;

export async function setProjectProviderIds(args: {
  projectId: string;
  vercelProjectId: string | null;
  vercelTeamId: string | null;
  neonProjectId: string | null;
  actor: string;
}): Promise<void> {
  const norm = (v: string | null) => {
    if (!v) return null;
    const trimmed = v.trim();
    return trimmed === "" ? null : trimmed;
  };
  const rows = await db
    .update(projects)
    .set({
      vercelProjectId: norm(args.vercelProjectId),
      vercelTeamId: norm(args.vercelTeamId),
      neonProjectId: norm(args.neonProjectId),
    })
    .where(eq(projects.id, args.projectId))
    .returning({ slug: projects.slug });
  if (rows.length === 0) throw new Error("project not found");
  await recordAudit({
    actor: args.actor,
    action: "project.providerIds.set",
    target: rows[0].slug,
    metadata: {
      vercelProjectId: norm(args.vercelProjectId),
      vercelTeamId: norm(args.vercelTeamId),
      neonProjectId: norm(args.neonProjectId),
    },
  });
}

export async function listProjects(): Promise<ProjectView[]> {
  return db.select(projectColumns).from(projects).orderBy(projects.createdAt);
}

export async function getProjectById(
  id: string,
): Promise<ProjectView | null> {
  const rows = await db
    .select(projectColumns)
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function countProjects(): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projects);
  return rows[0]?.count ?? 0;
}

export async function addProject(args: {
  owner: string;
  repo: string;
  defaultBranch?: string | null;
  framework?: string | null;
  blueprintId?: string | null;
  actor: string;
}): Promise<ProjectView> {
  const owner = args.owner.trim();
  const repo = args.repo.trim();
  if (!owner || !repo) throw new Error("owner and repo are required");
  const slug = slugFor(owner, repo);

  const inserted = await db
    .insert(projects)
    .values({
      slug,
      githubOwner: owner,
      githubRepo: repo,
      defaultBranch: args.defaultBranch ?? null,
      framework: args.framework ?? null,
      blueprintId: args.blueprintId ?? null,
    })
    .onConflictDoUpdate({
      target: projects.slug,
      set: {
        githubOwner: sql`excluded.github_owner`,
        githubRepo: sql`excluded.github_repo`,
        defaultBranch: sql`excluded.default_branch`,
      },
    })
    .returning(projectColumns);

  const row = inserted[0];
  await recordAudit({
    actor: args.actor,
    action: "project.added",
    target: row.slug,
  });
  return row;
}

export async function setProjectAccess(args: {
  projectId: string;
  accessMode: AccessMode;
  customDomain: string | null;
  actor: string;
}): Promise<void> {
  const domainValue = normaliseCustomDomain(args.customDomain);
  const rows = await db
    .update(projects)
    .set({
      accessMode: args.accessMode,
      customDomain: domainValue,
    })
    .where(eq(projects.id, args.projectId))
    .returning({ slug: projects.slug });
  if (rows.length === 0) throw new Error("project not found");
  await recordAudit({
    actor: args.actor,
    action: "project.access.set",
    target: rows[0].slug,
    metadata: { accessMode: args.accessMode, customDomain: domainValue },
  });
}

export async function setProjectBlueprint(args: {
  projectId: string;
  blueprintId: string | null;
  actor: string;
}): Promise<void> {
  const rows = await db
    .update(projects)
    .set({ blueprintId: args.blueprintId })
    .where(eq(projects.id, args.projectId))
    .returning({ slug: projects.slug });
  if (rows.length === 0) throw new Error("project not found");
  await recordAudit({
    actor: args.actor,
    action: args.blueprintId ? "project.blueprint.set" : "project.blueprint.cleared",
    target: rows[0].slug,
    metadata: args.blueprintId ? { blueprintId: args.blueprintId } : null,
  });
}

export async function deleteProjectById(
  id: string,
  actor: string,
): Promise<void> {
  const rows = await db
    .delete(projects)
    .where(eq(projects.id, id))
    .returning({ slug: projects.slug });
  if (rows.length === 0) return;
  await recordAudit({
    actor,
    action: "project.removed",
    target: rows[0].slug,
  });
}
