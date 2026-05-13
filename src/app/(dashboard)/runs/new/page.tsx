import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listBlueprints } from "@/lib/db/blueprints";
import { listProjects } from "@/lib/db/projects";

import { createDryRunAction } from "../actions";
import { NewRunForm } from "./_components/new-run-form";

export const dynamic = "force-dynamic";

export default async function NewRunPage() {
  const [projects, blueprints] = await Promise.all([
    listProjects(),
    listBlueprints(),
  ]);

  return (
    <PageShell
      eyebrow="Workspace"
      title="New deploy"
      description="Create a dry-run for any combination of project, blueprint, and environment. The run materialises one row per stage and you can step through it on the next screen."
    >
      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>Dry-run plan</CardTitle>
        </CardHeader>
        <CardContent>
          <NewRunForm
            action={createDryRunAction}
            projects={projects.map((p) => ({
              id: p.id,
              slug: p.slug,
              defaultBlueprintId: p.blueprintId,
            }))}
            blueprints={blueprints.map((b) => ({
              id: b.id,
              slug: b.slug,
              name: b.name,
            }))}
          />
        </CardContent>
      </Card>

      {projects.length === 0 ? (
        <Card className="max-w-3xl">
          <CardContent className="flex items-center justify-between gap-3 py-4">
            <p className="text-sm text-muted-foreground">
              No projects yet. Connect a repo first.
            </p>
            <Button asChild variant="outline" size="sm">
              <Link href="/projects">
                Go to Projects
                <ChevronRight className="h-4 w-4" aria-hidden />
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </PageShell>
  );
}
