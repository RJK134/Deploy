import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/status-pill";
import { Badge } from "@/components/ui/badge";
import { Sparkles, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Project } from "@shared/schema";

function fmtAgo(ts: number | null | undefined) {
  if (!ts) return "—";
  const d = (Date.now() - ts) / 1000;
  if (d < 60) return `${Math.round(d)}s ago`;
  if (d < 3600) return `${Math.round(d / 60)}m ago`;
  if (d < 86400) return `${Math.round(d / 3600)}h ago`;
  return `${Math.round(d / 86400)}d ago`;
}

export default function Runs() {
  const runs = useQuery<any[]>({ queryKey: ["/api/runs"] });
  const projects = useQuery<Project[]>({ queryKey: ["/api/projects"] });

  return (
    <PageShell
      eyebrow="Runs"
      title="Pipeline runs"
      description="Every orchestrated deployment. Click a row to see the stage-by-stage breakdown and logs."
      actions={
        <Link href="/wizard">
          <Button data-testid="button-new-run" className="gap-2">
            <Sparkles className="h-4 w-4" /> New deployment
          </Button>
        </Link>
      }
    >
      <Card>
        <CardContent className="p-0">
          {runs.isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : (runs.data?.length ?? 0) === 0 ? (
            <div className="p-12 text-center">
              <div className="text-sm font-medium">No runs yet</div>
              <p className="text-xs text-muted-foreground mt-1">Start your first deployment from the wizard.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                    <th className="px-4 py-3 font-medium">Run</th>
                    <th className="px-4 py-3 font-medium">Project</th>
                    <th className="px-4 py-3 font-medium">Env</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Mode</th>
                    <th className="px-4 py-3 font-medium">Providers</th>
                    <th className="px-4 py-3 font-medium tabular-nums">Started</th>
                    <th className="px-4 py-3 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {runs.data?.map((r) => {
                    const proj = projects.data?.find((p) => p.id === r.projectId);
                    return (
                      <tr key={r.id} className="border-b border-border last:border-b-0 hover:bg-card/40 transition-colors" data-testid={`row-run-${r.id}`}>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">#{r.id}</td>
                        <td className="px-4 py-3"><div className="font-medium">{proj?.name ?? "—"}</div></td>
                        <td className="px-4 py-3 text-xs font-mono uppercase">{r.environment}</td>
                        <td className="px-4 py-3"><StatusPill status={r.status} /></td>
                        <td className="px-4 py-3">
                          <Badge
                            variant={r.mode === "live" ? "default" : "outline"}
                            className="font-mono text-[10px]"
                            data-testid={`mode-${r.id}`}
                          >
                            {r.mode === "live" ? "LIVE DEPLOY" : "DRY-RUN PLAN"}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-xs font-mono text-muted-foreground">{(r.providers ?? []).join(" · ")}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground tabular-nums">{fmtAgo(r.createdAt)}</td>
                        <td className="px-4 py-3 text-right">
                          <Link href={`/runs/${r.id}`} className="text-xs text-primary hover:text-primary/80 inline-flex items-center gap-1">
                            Open <ArrowRight className="h-3 w-3" />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
