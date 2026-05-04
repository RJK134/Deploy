import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useRoute } from "wouter";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/status-pill";
import { ProviderIcon, providerLabel } from "@/components/provider-icon";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Play, FastForward, ArrowLeft, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Stage } from "@shared/schema";

export default function RunDetail() {
  const [, params] = useRoute("/runs/:id");
  const id = params?.id ? Number(params.id) : null;
  const [autoAdvance, setAutoAdvance] = useState(false);

  const { data, isLoading } = useQuery<{ run: any; stages: Stage[] }>({
    queryKey: ["/api/runs", id],
    enabled: id != null,
    refetchInterval: autoAdvance ? 800 : false,
  });

  const advance = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/runs/${id}/advance`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/runs", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/runs"] });
    },
  });

  /* Auto-advance loop */
  useEffect(() => {
    if (!autoAdvance || !data) return;
    const pending = data.stages.find((s) => s.status === "pending" || s.status === "running");
    if (!pending) {
      setAutoAdvance(false);
      return;
    }
    const t = setTimeout(() => advance.mutate(), 600);
    return () => clearTimeout(t);
  }, [autoAdvance, data]);

  if (isLoading) {
    return (
      <PageShell title="Run" eyebrow="Run">
        <Skeleton className="h-64 w-full" />
      </PageShell>
    );
  }

  if (!data) {
    return (
      <PageShell title="Run not found" eyebrow="Run">
        <p className="text-sm text-muted-foreground">This run does not exist.</p>
      </PageShell>
    );
  }

  const { run, stages } = data;
  const allDone = stages.every((s) => ["succeeded", "failed", "skipped"].includes(s.status));

  return (
    <PageShell
      eyebrow={`Run #${run.id}`}
      title={`${run.environment.toUpperCase()} deployment`}
      description={run.notes ?? ""}
      actions={
        <div className="flex items-center gap-2">
          <Link href="/runs">
            <Button variant="ghost" size="sm" className="gap-1" data-testid="button-back-runs">
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </Button>
          </Link>
          <Button
            variant="outline"
            size="sm"
            onClick={() => advance.mutate()}
            disabled={allDone || advance.isPending}
            className="gap-1"
            data-testid="button-advance"
          >
            <Play className="h-3.5 w-3.5" /> Advance one stage
          </Button>
          <Button
            size="sm"
            onClick={() => setAutoAdvance((x) => !x)}
            disabled={allDone}
            className="gap-1"
            data-testid="button-auto-advance"
          >
            <FastForward className="h-3.5 w-3.5" /> {autoAdvance ? "Pause" : "Auto-advance"}
          </Button>
        </div>
      }
    >
      {/* Run summary */}
      <Card className="mb-6">
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center gap-4">
            <StatusPill status={run.status} />
            <Badge variant="outline" className="font-mono text-[10px]">{run.mode}</Badge>
            <span className="text-xs text-muted-foreground font-mono">env / <span className="text-foreground uppercase">{run.environment}</span></span>
            <span className="text-xs text-muted-foreground">·</span>
            <div className="flex items-center gap-2">
              {run.providers.map((p: string) => (
                <span key={p} className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <ProviderIcon provider={p} className="h-3.5 w-3.5" />
                  {providerLabel(p)}
                </span>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stages */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-2">
          <h2 className="text-sm font-semibold mb-3">Pipeline</h2>
          <ol className="space-y-2">
            {stages.map((s, idx) => (
              <li
                key={s.id}
                className={cn(
                  "rounded-lg border bg-card p-3 transition-colors",
                  s.status === "running" && "border-primary/60 glow-mint",
                  s.status === "succeeded" && "border-border",
                  s.status === "failed" && "border-destructive/60",
                )}
                data-testid={`stage-${s.key}`}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
                      {String(idx + 1).padStart(2, "0")}
                    </span>
                    <div className="text-sm font-medium">{s.label}</div>
                  </div>
                  <StatusPill status={s.status as any} />
                </div>
                <p className="text-[11px] text-muted-foreground pl-6">{s.description}</p>
                {s.provider && (
                  <div className="mt-2 pl-6 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                    <ProviderIcon provider={s.provider} className="h-3 w-3" /> {providerLabel(s.provider)}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </div>

        {/* Logs */}
        <div className="lg:col-span-3">
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Terminal className="h-4 w-4" /> Stage logs
          </h2>
          <div className="rounded-lg border border-border bg-[#0c1220] dark:bg-[#06090f] text-[#cdd6e0]">
            <div className="border-b border-white/10 px-3 py-2 text-[11px] font-mono text-white/50 flex items-center justify-between">
              <span>deployops/{run.id}</span>
              <span>{run.mode === "live" ? "LIVE" : "DRY-RUN"}</span>
            </div>
            <pre className="p-3 text-[12px] leading-relaxed font-mono overflow-x-auto max-h-[60vh] overflow-y-auto">
{stages.map((s) =>
  `┌── ${s.label} · ${s.status}${s.provider ? ` · ${s.provider}` : ""}\n` +
  (s.log ? s.log.split("\n").map((l) => "│  " + l).join("\n") + "\n" : "│  (no output yet)\n") +
  "└──\n"
).join("\n")}
            </pre>
          </div>

          {/* env vars resolved */}
          <Card className="mt-4">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Resolved env vars</CardTitle>
            </CardHeader>
            <CardContent>
              {run.envVars.length === 0 ? (
                <p className="text-xs text-muted-foreground">None resolved.</p>
              ) : (
                <ul className="space-y-1.5 font-mono text-xs">
                  {run.envVars.map((e: any) => (
                    <li key={e.key} className="flex items-center justify-between border-b border-dashed border-border/50 pb-1.5">
                      <span>{e.key}</span>
                      <span className="text-muted-foreground">
                        <Badge variant="outline" className="text-[10px] mr-2">{e.source}</Badge>
                        {e.value}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </PageShell>
  );
}
