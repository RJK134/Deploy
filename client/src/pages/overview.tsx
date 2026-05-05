import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/status-pill";
import { ProviderIcon, providerLabel } from "@/components/provider-icon";
import {
  Sparkles, ArrowRight, Box, GitBranch, ServerCog, Activity, Globe2,
} from "lucide-react";
import type { Provider, Project, Run } from "@shared/schema";

function fmtAgo(ts: number | null | undefined) {
  if (!ts) return "—";
  const d = (Date.now() - ts) / 1000;
  if (d < 60) return `${Math.round(d)}s ago`;
  if (d < 3600) return `${Math.round(d / 60)}m ago`;
  if (d < 86400) return `${Math.round(d / 3600)}h ago`;
  return `${Math.round(d / 86400)}d ago`;
}

export default function Overview() {
  const providers = useQuery<Provider[]>({ queryKey: ["/api/providers"] });
  const projects = useQuery<Project[]>({ queryKey: ["/api/projects"] });
  const runs = useQuery<Run[]>({ queryKey: ["/api/runs"] });

  /* KPI counts treat dry-run validation and live success separately so the
   * overview never implies a dry-run plan was a real deployment. Legacy
   * `succeeded` rows are bucketed into dry-run (they only ever came from
   * seed data; real successful deploys write `live_succeeded`). */
  const liveSucceeded = runs.data?.filter((r) => r.status === "live_succeeded").length ?? 0;
  const dryRunValidated = runs.data?.filter((r) => r.status === "validated_dry_run" || r.status === "succeeded" || r.status === "planned").length ?? 0;
  const running = runs.data?.filter((r) => r.status === "running" || r.status === "live_running" || r.status === "live_pending").length ?? 0;
  const failed = runs.data?.filter((r) => r.status === "failed" || r.status === "live_failed").length ?? 0;
  const blocked = runs.data?.filter((r) => r.status === "live_blocked").length ?? 0;

  /* Active env counts only environments that actually have at least one
   * deployed run. Showing a hardcoded "3 · test · demo · deploy" was
   * misleading when the deploy column was empty. */
  const envsWithRuns = new Set<string>();
  for (const r of runs.data ?? []) envsWithRuns.add(r.environment);
  const liveDeployedEnvs = new Set<string>();
  for (const r of runs.data ?? []) {
    if (r.status === "live_succeeded") liveDeployedEnvs.add(r.environment);
  }
  const envOrder = ["test", "demo", "deploy"] as const;
  const activeEnvList = envOrder.filter((e) => envsWithRuns.has(e));
  const activeEnvSub = activeEnvList.length === 0
    ? "no runs yet"
    : `${activeEnvList.join(" · ")}${liveDeployedEnvs.size === 0 ? " (dry-run only)" : ` · ${liveDeployedEnvs.size} live`}`;

  return (
    <PageShell
      eyebrow="Workspace"
      title="Overview"
      description="One console for shipping GitHub builds across Test, Demo, and Deploy environments. Provider health and recent runs at a glance."
      actions={
        <Link href="/wizard">
          <Button data-testid="button-new-deploy" className="gap-2">
            <Sparkles className="h-4 w-4" /> New deployment
          </Button>
        </Link>
      }
    >
      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <Kpi icon={<Box className="h-4 w-4" />} label="Projects" value={projects.data?.length ?? 0} loading={projects.isLoading} />
        <Kpi icon={<Activity className="h-4 w-4" />} label="Runs · 7d" value={runs.data?.length ?? 0} loading={runs.isLoading} sub={`${liveSucceeded} live · ${dryRunValidated} dry-run · ${running} running · ${failed} failed${blocked ? ` · ${blocked} blocked` : ""}`} />
        <Kpi icon={<ServerCog className="h-4 w-4" />} label="Providers · live"
          value={`${providers.data?.filter((p) => p.status === "connected" || p.status === "live_ready").length ?? 0}/${providers.data?.length ?? 0}`}
          sub={(() => {
            const demo = providers.data?.filter((p) => p.status === "demo").length ?? 0;
            const off  = providers.data?.filter((p) => p.status === "disconnected").length ?? 0;
            const parts: string[] = [];
            if (demo) parts.push(`${demo} demo`);
            if (off)  parts.push(`${off} not connected`);
            return parts.join(" · ") || "all live";
          })()}
          loading={providers.isLoading} />
        <Kpi icon={<Globe2 className="h-4 w-4" />} label="Active env"
          value={activeEnvList.length}
          sub={activeEnvSub}
          loading={runs.isLoading} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Provider health */}
        <Card className="xl:col-span-1" data-testid="card-providers">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-sm">Provider health</CardTitle>
            <Link href="/providers" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
              Manage <ArrowRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {providers.isLoading
              ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)
              : providers.data?.map((p) => (
                  <div key={p.key} className="rounded-md border border-border bg-card/40 px-3 py-2.5"
                       data-testid={`row-provider-${p.key}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <ProviderIcon provider={p.key} className="h-4 w-4 shrink-0 text-foreground/80" />
                        <span className="text-sm font-medium">{providerLabel(p.key)}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <StatusPill status={p.status as any} />
                        <Badge variant="outline" className="font-mono text-[10px]">{p.mode}</Badge>
                      </div>
                    </div>
                  </div>
                ))}
          </CardContent>
        </Card>

        {/* Environment readiness matrix */}
        <Card className="xl:col-span-2" data-testid="card-env-matrix">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-sm">Environment readiness</CardTitle>
            <div className="flex items-center gap-2">
              <Link href="/projects" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1" data-testid="link-projects-dashboard">
                Project dashboards <ArrowRight className="h-3 w-3" />
              </Link>
              <Badge variant="outline" className="font-mono text-[10px]">DRY-RUN by default</Badge>
            </div>
          </CardHeader>
          <CardContent>
            {projects.isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm tabular-nums">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Project</th>
                      <th className="px-3 py-2 font-medium">Repo</th>
                      <th className="px-3 py-2 font-medium">Test</th>
                      <th className="px-3 py-2 font-medium">Demo</th>
                      <th className="px-3 py-2 font-medium">Deploy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projects.data?.map((p) => {
                      const projectRuns = runs.data?.filter((r) => r.projectId === p.id) ?? [];
                      return (
                        <tr key={p.id} className="border-t border-border/60 hover:bg-card/40 transition-colors"
                            data-testid={`row-project-${p.id}`}>
                          <td className="px-3 py-3">
                            <Link href={`/projects/${p.id}`} className="font-medium hover:underline" data-testid={`link-project-dashboard-${p.id}`}>
                              {p.name}
                            </Link>
                            <div className="text-[11px] text-muted-foreground">{p.framework}</div>
                          </td>
                          <td className="px-3 py-3 font-mono text-xs text-muted-foreground">
                            <span className="inline-flex items-center gap-1">
                              <GitBranch className="h-3 w-3" /> {p.repo}
                            </span>
                          </td>
                          {(["test", "demo", "deploy"] as const).map((env) => {
                            const r = projectRuns.find((x) => x.environment === env);
                            return (
                              <td key={env} className="px-3 py-3 whitespace-nowrap min-w-[140px]">
                                {r ? (
                                  <Link href={`/runs/${r.id}`} className="inline-flex items-center gap-2 whitespace-nowrap">
                                    <StatusPill status={r.status as any} />
                                    <span className="text-[11px] text-muted-foreground">{fmtAgo(r.createdAt)}</span>
                                  </Link>
                                ) : (
                                  <span className="text-[11px] text-muted-foreground/70 italic whitespace-nowrap">not deployed</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent runs */}
      <Card className="mt-6" data-testid="card-recent-runs">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-sm">Recent runs</CardTitle>
          <Link href="/runs" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            All runs <ArrowRight className="h-3 w-3" />
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          {runs.isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : (runs.data?.length ?? 0) === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No runs yet. <Link href="/wizard" className="text-primary hover:underline">Start a deployment.</Link>
            </div>
          ) : (
            <ul>
              {runs.data?.slice(0, 6).map((r) => {
                const project = projects.data?.find((p) => p.id === r.projectId);
                return (
                  <li key={r.id} className="border-t border-border first:border-t-0">
                    <Link href={`/runs/${r.id}`} className="flex items-center justify-between px-4 py-3 hover-elevate" data-testid={`link-run-${r.id}`}>
                        <div className="flex items-center gap-4 min-w-0">
                          <StatusPill status={r.status as any} />
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">
                              {project?.name ?? "—"} <span className="text-muted-foreground">→ {r.environment}</span>
                            </div>
                            <div className="text-[11px] text-muted-foreground font-mono">
                              run #{r.id} · {(r as any).providers.length} providers · {r.mode}
                            </div>
                          </div>
                        </div>
                        <div className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                          {fmtAgo(r.createdAt)}
                        </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}

function Kpi({
  icon, label, value, sub, loading,
}: { icon: React.ReactNode; label: string; value: number | string; sub?: string; loading: boolean }) {
  return (
    <Card data-testid={`kpi-${String(label).toLowerCase().replace(/\W+/g, "-")}`}>
      <CardContent className="py-4">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
          {icon} {label}
        </div>
        {loading ? (
          <Skeleton className="h-7 w-16 mt-2" />
        ) : (
          <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
        )}
        {sub && <div className="text-[11px] text-muted-foreground mt-1 font-mono">{sub}</div>}
      </CardContent>
    </Card>
  );
}
