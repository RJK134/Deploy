import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Boxes, Clock, ExternalLink, Layers } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { RunStatusPill } from "@/components/run-status-pill";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { getRun } from "@/lib/db/runs";
import { durationSeconds, relativeTime } from "@/lib/format/relative-time";
import { STAGE_SPECS } from "@/lib/pipeline/stages";
import { cn } from "@/lib/utils";

import { advanceStageAction, autoAdvanceAction } from "../actions";
import { AdvanceButtons } from "./_components/advance-buttons";

export const dynamic = "force-dynamic";

interface PageProps {
  params: { id: string };
}

export default async function RunDetailPage({ params }: PageProps) {
  const run = await getRun(params.id);
  if (!run) notFound();

  const isTerminal =
    run.status === "succeeded" ||
    run.status === "failed" ||
    run.status === "cancelled";

  return (
    <PageShell
      eyebrow={
        <Link
          href="/runs"
          className="inline-flex items-center gap-1 hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden />
          Runs
        </Link>
      }
      title={`Run ${run.id.slice(0, 8)}`}
      description={`${run.environment} · ${run.mode === "dry_run" ? "dry-run" : "live"} · ${run.projectSlug ?? "(unknown project)"}`}
      actions={
        <AdvanceButtons
          runId={run.id}
          advanceAction={advanceStageAction}
          autoAdvanceAction={autoAdvanceAction}
          disabled={isTerminal}
          disabledReason={
            isTerminal
              ? `Run is ${run.status}. Create a new run from /runs/new.`
              : undefined
          }
        />
      }
    >
      <section
        aria-label="Run summary"
        className="grid grid-cols-1 gap-4 lg:grid-cols-3"
      >
        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <RunStatusPill status={run.status} />
            <p className="text-xs text-muted-foreground">
              Created {relativeTime(run.createdAt)} by {run.triggeredBy ?? "—"}
            </p>
            {run.startedAt ? (
              <p className="text-xs text-muted-foreground">
                Duration {durationSeconds(run.startedAt, run.finishedAt)}
              </p>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Project</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="flex items-center gap-1.5 font-mono text-sm">
              <Boxes className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              {run.projectSlug ?? "—"}
            </p>
            {run.plan ? (
              <Link
                href={`https://github.com/${run.plan.project.githubOwner}/${run.plan.project.githubRepo}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                Open on GitHub
                <ExternalLink className="h-3 w-3" aria-hidden />
              </Link>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Blueprint</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm">{run.plan?.blueprintName ?? "—"}</p>
            <code className="font-mono text-[10px] text-muted-foreground">
              {run.plan?.blueprintSlug ?? "—"}
            </code>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Layers className="h-3 w-3" aria-hidden />
              Framework: {run.plan?.framework ?? "—"}
            </p>
          </CardContent>
        </Card>
      </section>

      <section aria-label="Stage timeline">
        <Card>
          <CardHeader>
            <CardTitle>Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3">
              {run.stages.map((s) => {
                const spec = STAGE_SPECS[s.kind];
                return (
                  <li key={s.id}>
                    <div
                      className={cn(
                        "rounded-lg border border-border bg-card p-4",
                        s.status === "running" && "border-amber-500/40",
                        s.status === "succeeded" && "border-primary/30",
                        s.status === "failed" && "border-destructive/40",
                      )}
                    >
                      <header className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">
                          {String(s.sequence).padStart(2, "0")}
                        </span>
                        <span className="font-medium">{spec.label}</span>
                        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                          {s.kind}
                        </code>
                        <RunStatusPill status={s.status} className="ml-auto" />
                      </header>
                      {s.startedAt ? (
                        <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Clock className="h-3 w-3" aria-hidden />
                          {durationSeconds(s.startedAt, s.finishedAt)}
                        </p>
                      ) : null}
                      {s.logText ? (
                        <>
                          <Separator className="my-3" />
                          <pre className="overflow-x-auto rounded-md bg-muted/40 p-3 font-mono text-[11px] leading-5 text-foreground/90">
                            {s.logText}
                          </pre>
                        </>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>
      </section>

      {run.plan ? (
        <section aria-label="Resolved plan">
          <Card>
            <CardHeader>
              <CardTitle>Resolved plan</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-xs">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Predicted
                  </h3>
                  <p>
                    Branch:{" "}
                    <code className="font-mono">
                      {run.plan.predicted.branchName}
                    </code>
                  </p>
                  <p>
                    URL:{" "}
                    <code className="font-mono">
                      https://{run.plan.predicted.deployHost}
                    </code>
                  </p>
                </div>
                <div>
                  <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Commands
                  </h3>
                  {Object.entries(run.plan.commands).map(([k, v]) =>
                    v ? (
                      <p key={k}>
                        <span className="text-muted-foreground">{k}: </span>
                        <code className="font-mono">{v}</code>
                      </p>
                    ) : null,
                  )}
                </div>
              </div>
              <Separator />
              <div>
                <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Env vars
                </h3>
                <table className="mt-2 w-full border-separate border-spacing-y-1">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      <th className="text-left">Key</th>
                      <th className="text-left">Source</th>
                      <th className="text-left">Resolved</th>
                    </tr>
                  </thead>
                  <tbody>
                    {run.plan.envVars.map((env) => (
                      <tr key={env.key}>
                        <td>
                          <code className="font-mono">{env.key}</code>
                        </td>
                        <td>
                          <Badge
                            variant="outline"
                            className="font-mono text-[10px]"
                          >
                            {env.source}
                          </Badge>
                        </td>
                        <td className="text-muted-foreground">
                          {env.value ? (
                            <code className="font-mono">
                              {env.value.length > 60
                                ? env.value.slice(0, 60) + "…"
                                : env.value}
                            </code>
                          ) : (
                            <span>{env.note}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </section>
      ) : null}
    </PageShell>
  );
}
