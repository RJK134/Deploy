import {
  CircleDot,
  Code,
  Database,
  GitBranch,
  Layers,
  PackageOpen,
  SkipForward,
} from "lucide-react";

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
import { STAGE_SPECS } from "@/lib/pipeline/stages";

export const dynamic = "force-dynamic";

export default async function BlueprintsPage() {
  const blueprints = await listBlueprints();

  return (
    <PageShell
      eyebrow="Library"
      title="Blueprints"
      description="Declarative deploy recipes. Each blueprint binds a framework to a set of stages, env-var resolutions, and commands. Built-ins are seeded on first load."
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {blueprints.map((bp) => {
          const def = bp.definition;
          const enabledStages = def.stages.filter((s) => !s.defaultSkip);
          const skippedStages = def.stages.filter((s) => s.defaultSkip);
          return (
            <Card key={bp.id}>
              <CardHeader className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-xs">{bp.name}</CardTitle>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {def.framework}
                  </Badge>
                </div>
                <p className="text-sm text-foreground/90">{def.description}</p>
                <code className="font-mono text-[10px] text-muted-foreground">
                  slug: {bp.slug}
                </code>
              </CardHeader>
              <CardContent className="space-y-4">
                <Separator />
                <section className="space-y-2">
                  <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Stages
                  </h3>
                  <ul className="space-y-1.5 text-xs">
                    {enabledStages.map((s) => (
                      <li
                        key={s.kind}
                        className="flex items-start gap-2 text-foreground"
                      >
                        <CircleDot
                          className="mt-0.5 h-3 w-3 shrink-0 text-primary"
                          aria-hidden
                        />
                        <div>
                          <span className="font-medium">
                            {STAGE_SPECS[s.kind].label}
                          </span>
                          <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                            {s.kind}
                          </span>
                        </div>
                      </li>
                    ))}
                    {skippedStages.map((s) => (
                      <li
                        key={s.kind}
                        className="flex items-start gap-2 text-muted-foreground line-through decoration-muted-foreground/50"
                      >
                        <SkipForward
                          className="mt-0.5 h-3 w-3 shrink-0 no-underline"
                          aria-hidden
                        />
                        <div>
                          <span>{STAGE_SPECS[s.kind].label}</span>
                          <span className="ml-1 font-mono text-[10px]">
                            {s.kind}
                          </span>
                          <span className="ml-2 text-[10px] uppercase tracking-wide no-underline">
                            skipped by default
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>

                <Separator />

                <section className="space-y-2">
                  <h3 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <Layers className="h-3 w-3" aria-hidden />
                    Env vars
                  </h3>
                  {def.envVars.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No environment variables required.
                    </p>
                  ) : (
                    <ul className="space-y-1 text-xs">
                      {def.envVars.map((env) => (
                        <li
                          key={env.key}
                          className="flex items-center justify-between gap-2"
                        >
                          <code className="font-mono text-foreground">
                            {env.key}
                          </code>
                          <Badge
                            variant="outline"
                            className="font-mono text-[10px]"
                          >
                            {env.source}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <Separator />

                <section className="space-y-2">
                  <h3 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <Code className="h-3 w-3" aria-hidden />
                    Commands
                  </h3>
                  <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                    {def.commands.install ? (
                      <>
                        <dt className="text-muted-foreground">install</dt>
                        <dd className="font-mono text-foreground">
                          {def.commands.install}
                        </dd>
                      </>
                    ) : null}
                    {def.commands.build ? (
                      <>
                        <dt className="text-muted-foreground">build</dt>
                        <dd className="font-mono text-foreground">
                          {def.commands.build}
                        </dd>
                      </>
                    ) : null}
                    {def.commands.start ? (
                      <>
                        <dt className="text-muted-foreground">start</dt>
                        <dd className="font-mono text-foreground">
                          {def.commands.start}
                        </dd>
                      </>
                    ) : null}
                    {def.commands.migrate ? (
                      <>
                        <dt className="text-muted-foreground">migrate</dt>
                        <dd className="font-mono text-foreground">
                          {def.commands.migrate}
                        </dd>
                      </>
                    ) : null}
                  </dl>
                </section>

                {def.envVars.some((e) => e.source === "neon_url") ? (
                  <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Database className="h-3 w-3" aria-hidden />
                    Requires Neon — DB stages are active.
                  </p>
                ) : (
                  <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <PackageOpen className="h-3 w-3" aria-hidden />
                    No database dependency.
                  </p>
                )}
                <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <GitBranch className="h-3 w-3" aria-hidden />
                  Vercel preset:{" "}
                  <code className="font-mono">{def.vercelPreset}</code>
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </PageShell>
  );
}
