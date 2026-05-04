import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Database, FileCode, Globe2, KeyRound, ServerCog, Workflow,
  Check, Circle, RotateCcw, BookOpen,
} from "lucide-react";

interface MigrationPlan {
  backend: { backend: "sqlite" | "postgres"; url: string; source: string; liveCapable: boolean };
  live: boolean;
  steps: Array<{
    id: string;
    title: string;
    description: string;
    commands: string[];
  }>;
}

const STEP_ICONS: Record<string, any> = {
  "neon-create": Database,
  "branch-envs": Workflow,
  "schema-push": FileCode,
  "vercel-link": Globe2,
  "env-vars": KeyRound,
  "install-pg": ServerCog,
  "deploy": Globe2,
  "validate": Check,
  "rollback": RotateCcw,
};

export default function MigrationPage() {
  const plan = useQuery<MigrationPlan>({ queryKey: ["/api/migration/plan"] });
  const [done, setDone] = useState<Record<string, boolean>>({});

  function toggle(id: string) {
    setDone((prev) => ({ ...prev, [id]: !prev[id] }));
  }
  function reset() {
    setDone({});
  }

  const completed = Object.values(done).filter(Boolean).length;
  const total = plan.data?.steps.length ?? 0;

  return (
    <PageShell
      eyebrow="Operations"
      title="Migration plan"
      description="Move DeployOps Console from local SQLite to Vercel + Neon Postgres. Each step is idempotent — check it off as you go. Progress is tracked in-memory for this session only."
      actions={
        <Button variant="outline" size="sm" onClick={reset} data-testid="button-migration-reset">
          <RotateCcw className="h-4 w-4 mr-1.5" /> Reset checklist
        </Button>
      }
    >
      <Card className="mb-6" data-testid="card-migration-summary">
        <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-3">
            <Database className="h-4 w-4 text-primary" />
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Active backend</div>
              <div className="font-mono">{plan.data?.backend.backend ?? "…"} <span className="text-muted-foreground">({plan.data?.backend.url})</span></div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={plan.data?.backend.backend === "postgres" ? "default" : "outline"}>
              {plan.data?.backend.backend === "postgres" ? "production-ready" : "local mode"}
            </Badge>
            <Badge variant="outline" className="font-mono text-[10px]" data-testid="badge-progress">
              {completed} / {total} steps complete
            </Badge>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {plan.isLoading ? Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-32 w-full" />)
          : plan.data?.steps.map((step, idx) => {
              const Icon = STEP_ICONS[step.id] ?? FileCode;
              const isDone = !!done[step.id];
              return (
                <Card key={step.id} className={isDone ? "opacity-70" : ""} data-testid={`card-step-${step.id}`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <button
                          onClick={() => toggle(step.id)}
                          aria-label={isDone ? "Mark incomplete" : "Mark complete"}
                          className={`h-6 w-6 mt-0.5 rounded-full border flex items-center justify-center transition ${
                            isDone
                              ? "bg-primary border-primary text-primary-foreground"
                              : "border-border hover-elevate"
                          }`}
                          data-testid={`button-toggle-${step.id}`}
                        >
                          {isDone ? <Check className="h-3.5 w-3.5" /> : <Circle className="h-3 w-3 text-muted-foreground" />}
                        </button>
                        <div className="min-w-0">
                          <CardTitle className="text-sm flex items-center gap-2">
                            <Icon className="h-4 w-4 text-primary" />
                            <span>Step {idx + 1}: {step.title}</span>
                          </CardTitle>
                          <p className="mt-1 text-xs text-muted-foreground max-w-2xl">{step.description}</p>
                        </div>
                      </div>
                      {isDone && (
                        <Badge variant="default" className="text-[10px]" data-testid={`badge-done-${step.id}`}>done</Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <pre
                      className="rounded-md border border-border bg-[#0c1220] dark:bg-[#06090f] text-[#cdd6e0] p-3 text-[11px] font-mono overflow-x-auto"
                      data-testid={`commands-${step.id}`}
                    >
{step.commands.map((c) => `$ ${c}`).join("\n")}
                    </pre>
                  </CardContent>
                </Card>
              );
            })}
      </div>

      <Card className="mt-8" data-testid="card-migration-docs">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-primary" /> Operational caveats
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-2">
          <p>· Vercel's filesystem is ephemeral — running with SQLite on Vercel will lose data between cold starts. Neon (or Vercel Postgres / Prisma Postgres) is required for production.</p>
          <p>· Use the pooled Neon connection string for runtime; reserve the direct connection for migrations only.</p>
          <p>· The application's Drizzle queries are dialect-portable for the operations used here. JSON-as-text columns round-trip cleanly because the application parses JSON itself.</p>
          <p>· After cutover, verify <span className="font-mono">/api/system</span> reports <span className="font-mono">backend: "postgres"</span>. The Production Architecture page surfaces the same field.</p>
          <p>· Rollback is reversible: clear DATABASE_URL on the deploy and the app falls back to SQLite. Restore from a Neon branch snapshot if you need point-in-time data recovery.</p>
        </CardContent>
      </Card>
    </PageShell>
  );
}
