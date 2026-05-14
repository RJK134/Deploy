import Link from "next/link";
import { ExternalLink, EyeOff, GitBranch, GitFork, Globe, Users } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { listBlueprints } from "@/lib/db/blueprints";
import { listCredentials } from "@/lib/db/credentials";
import { listProjects } from "@/lib/db/projects";

import {
  addProjectAction,
  removeProjectAction,
  setProjectBlueprintAction,
} from "./actions";
import { AddProjectForm } from "./_components/add-project-form";
import { BlueprintSelect } from "./_components/blueprint-select";
import { RemoveProjectButton } from "./_components/remove-project-button";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const [projects, credentials, blueprints] = await Promise.all([
    listProjects(),
    listCredentials(),
    listBlueprints(),
  ]);

  const blueprintOptions = blueprints.map((b) => ({
    id: b.id,
    slug: b.slug,
    name: b.name,
  }));
  const blueprintNameById = new Map(blueprints.map((b) => [b.id, b.name]));

  const gh = credentials.find((c) => c.kind === "github_pat");
  const ghVerified = gh?.connectionState === "verified";
  const addDisabled = !ghVerified;
  const disabledReason = ghVerified
    ? undefined
    : gh
      ? "Verify the GitHub PAT in the Connection Center before adding repos."
      : "Connect a GitHub PAT in the Connection Center, then verify it.";

  return (
    <PageShell
      eyebrow="Workspace"
      title="Projects"
      description="GitHub repos this console will deploy. Each project is identified by owner/repo; default branch is fetched from GitHub when a verified PAT is connected."
    >
      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>Add a project</CardTitle>
        </CardHeader>
        <CardContent>
          <AddProjectForm
            action={addProjectAction}
            disabled={addDisabled}
            disabledReason={disabledReason}
          />
        </CardContent>
      </Card>

      <Card className="max-w-3xl">
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle>Connected repos</CardTitle>
          <Badge variant="outline" className="font-mono text-[10px]">
            {projects.length} total
          </Badge>
        </CardHeader>
        <CardContent>
          {projects.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No projects yet. Add one above to get started — try
              <code className="ml-1 font-mono">RJK134/herm-platform</code> or
              <code className="ml-1 font-mono">RJK134/EquiSmile</code>.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {projects.map((p) => {
                const ghUrl = `https://github.com/${p.githubOwner}/${p.githubRepo}`;
                return (
                  <li
                    key={p.id}
                    className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <GitFork
                          className="h-3.5 w-3.5 text-muted-foreground"
                          aria-hidden
                        />
                        <Link
                          href={ghUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-sm hover:underline"
                        >
                          {p.slug}
                        </Link>
                        <ExternalLink
                          className="h-3 w-3 text-muted-foreground"
                          aria-hidden
                        />
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        {p.defaultBranch ? (
                          <span className="inline-flex items-center gap-1">
                            <GitBranch className="h-3 w-3" aria-hidden />
                            <span className="font-mono">{p.defaultBranch}</span>
                          </span>
                        ) : (
                          <span>default branch unknown</span>
                        )}
                        <span className="inline-flex items-center gap-1">
                          {p.accessMode === "public" ? (
                            <Globe className="h-3 w-3" aria-hidden />
                          ) : p.accessMode === "client" ? (
                            <Users className="h-3 w-3" aria-hidden />
                          ) : (
                            <EyeOff className="h-3 w-3" aria-hidden />
                          )}
                          {p.accessMode}
                        </span>
                        {p.blueprintId &&
                        blueprintNameById.has(p.blueprintId) ? (
                          <span className="inline-flex items-center gap-1">
                            blueprint:{" "}
                            <code className="font-mono text-foreground">
                              {blueprintNameById.get(p.blueprintId)}
                            </code>
                          </span>
                        ) : (
                          <span>no blueprint bound</span>
                        )}
                        <span>
                          added{" "}
                          <time dateTime={p.createdAt.toISOString()}>
                            {p.createdAt.toISOString().slice(0, 10)}
                          </time>
                        </span>
                      </div>
                      <BlueprintSelect
                        action={setProjectBlueprintAction}
                        projectId={p.id}
                        current={p.blueprintId}
                        options={blueprintOptions}
                      />
                    </div>
                    <RemoveProjectButton
                      action={removeProjectAction}
                      id={p.id}
                      slug={p.slug}
                    />
                  </li>
                );
              })}
            </ul>
          )}
          {projects.length > 0 ? (
            <>
              <Separator className="my-4" />
              <p className="text-xs text-muted-foreground">
                Removing a project here doesn&rsquo;t tear down anything on
                GitHub, Vercel, or Neon. It only removes the project from
                DeployOps.
              </p>
            </>
          ) : null}
        </CardContent>
      </Card>
    </PageShell>
  );
}
