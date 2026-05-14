import Link from "next/link";
import { ExternalLink, EyeOff, Globe, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { listProjects } from "@/lib/db/projects";
import type { AccessMode } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

import { updateProjectAccessAction } from "./actions";
import { AccessForm } from "./_components/access-form";

export const dynamic = "force-dynamic";

const ACCESS_META: Record<
  AccessMode,
  { label: string; icon: LucideIcon; className: string; blurb: string }
> = {
  public: {
    label: "Public",
    icon: Globe,
    className: "border-primary/40 text-primary",
    blurb: "Anyone with the URL can view the deployed app.",
  },
  client: {
    label: "Client",
    icon: Users,
    className: "border-amber-500/40 text-amber-600 dark:text-amber-400",
    blurb:
      "Shared with a specific client. Vercel password protection is enabled by the live adapter (Session 6).",
  },
  private: {
    label: "Private",
    icon: EyeOff,
    className: "border-border text-muted-foreground",
    blurb: "Only the operator can view the deployment.",
  },
};

export default async function AccessPage() {
  const projects = await listProjects();

  return (
    <PageShell
      eyebrow="Operations"
      title="Access & domains"
      description="Per-project access mode and the custom domain that Session 6's live adapter will attach to the Vercel deployment. Changes here only update DeployOps metadata in dry-run mode."
    >
      {projects.length === 0 ? (
        <Card className="max-w-3xl">
          <CardContent className="flex items-center justify-between gap-3 py-6">
            <p className="text-sm text-muted-foreground">
              No projects yet. Connect a repo on the Projects page first.
            </p>
            <Button asChild variant="outline" size="sm">
              <Link href="/projects">Go to Projects</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {projects.map((p) => {
          const meta = ACCESS_META[p.accessMode];
          const Icon = meta.icon;
          const previewHost =
            p.customDomain ??
            `${p.githubRepo.toLowerCase()}-deploy.vercel.app`;
          return (
            <Card key={p.id}>
              <CardHeader className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-xs">{p.slug}</CardTitle>
                  <Badge
                    variant="outline"
                    className={cn(
                      "gap-1 font-mono text-[10px] uppercase",
                      meta.className,
                    )}
                  >
                    <Icon className="h-3 w-3" aria-hidden />
                    {meta.label}
                  </Badge>
                </div>
                <p className="text-sm text-foreground/90">{meta.blurb}</p>
              </CardHeader>
              <CardContent className="space-y-3">
                <Separator />
                <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                  <dt className="text-muted-foreground">GitHub</dt>
                  <dd>
                    <Link
                      href={`https://github.com/${p.githubOwner}/${p.githubRepo}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-mono hover:underline"
                    >
                      {p.slug}
                      <ExternalLink className="h-3 w-3" aria-hidden />
                    </Link>
                  </dd>
                  <dt className="text-muted-foreground">Preview host</dt>
                  <dd className="font-mono">{previewHost}</dd>
                  {p.customDomain ? (
                    <>
                      <dt className="text-muted-foreground">Custom domain</dt>
                      <dd className="font-mono">{p.customDomain}</dd>
                    </>
                  ) : null}
                </dl>
                <Separator />
                <AccessForm
                  action={updateProjectAccessAction}
                  projectId={p.id}
                  currentAccessMode={p.accessMode}
                  currentCustomDomain={p.customDomain}
                />
              </CardContent>
            </Card>
          );
        })}
      </div>
    </PageShell>
  );
}
