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
import { isLiveMode } from "@/lib/env";
import { listBlueprints } from "@/lib/db/blueprints";
import { listCredentials } from "@/lib/db/credentials";
import { listProjects } from "@/lib/db/projects";

import { createDryRunAction } from "../actions";
import { NewRunForm } from "./_components/new-run-form";

export const dynamic = "force-dynamic";

export default async function NewRunPage() {
  const [projects, blueprints, credentials] = await Promise.all([
    listProjects(),
    listBlueprints(),
    listCredentials(),
  ]);

  let liveModeAllowed = isLiveMode;
  let liveModeBlockedReason: string | undefined;
  if (!isLiveMode) {
    liveModeBlockedReason = "DEPLOYOPS_LIVE=0 in the server env. Set to 1 in Vercel and redeploy to enable.";
  } else {
    const required = ["github_pat", "vercel", "neon"] as const;
    const unverified = required.filter(
      (k) =>
        credentials.find((c) => c.kind === k)?.connectionState !== "verified",
    );
    if (unverified.length > 0) {
      liveModeAllowed = false;
      liveModeBlockedReason = `Live mode blocked: providers not verified — ${unverified.join(", ")}. Verify each on /providers first.`;
    }
  }

  return (
    <PageShell
      eyebrow="Workspace"
      title="New deploy"
      description="Create a run for any combination of project, blueprint, and environment. Dry-run is the default; live mode unlocks when DEPLOYOPS_LIVE=1 and all three providers are verified."
    >
      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>Run plan</CardTitle>
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
            liveModeAllowed={liveModeAllowed}
            liveModeBlockedReason={liveModeBlockedReason}
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
