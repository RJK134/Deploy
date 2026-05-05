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
import { Play, FastForward, ArrowLeft, Terminal, Rocket, ExternalLink, AlertTriangle, ShieldAlert } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { Stage } from "@shared/schema";

export default function RunDetail() {
  const [, params] = useRoute("/runs/:id");
  const id = params?.id ? Number(params.id) : null;
  const [autoAdvance, setAutoAdvance] = useState(false);
  const { toast } = useToast();

  const { data, isLoading } = useQuery<{ run: any; stages: Stage[] }>({
    queryKey: ["/api/runs", id],
    enabled: id != null,
    refetchInterval: autoAdvance ? 800 : false,
  });

  const isLive = data?.run?.mode === "live";
  const liveStatus: string | undefined = data?.run?.status;
  const liveTerminal = liveStatus === "live_succeeded" || liveStatus === "live_failed" || liveStatus === "live_blocked";
  const livePolling = isLive && (liveStatus === "live_pending" || liveStatus === "live_running");

  /* Live status poll — server-driven, never simulated. */
  const liveStatusQ = useQuery<any>({
    queryKey: ["/api/runs", id, "live-status"],
    enabled: !!isLive && id != null,
    refetchInterval: livePolling ? 3000 : false,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/runs/${id}/live-status`);
      return res.json();
    },
  });

  /* Live provisioning steps + resources — populated by the orchestrator. */
  const liveStepsQ = useQuery<any>({
    queryKey: ["/api/live/runs", id, "steps"],
    enabled: id != null,
    refetchInterval: livePolling ? 3000 : false,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/live/runs/${id}/steps`);
      return res.json();
    },
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

  /**
   * Trigger a real Vercel deployment. Requires the explicit confirmation
   * phrase — sent as { confirm: "I UNDERSTAND" } — so an accidental click
   * cannot fire a real deploy.
   */
  const startLive = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/runs/${id}/start-live`, {
        confirm: "I UNDERSTAND",
      });
      const json = await res.json();
      if (!json.ok && json.status !== "live_running") throw new Error(json.message ?? "live start failed");
      return json;
    },
    onSuccess: (resp) => {
      queryClient.invalidateQueries({ queryKey: ["/api/runs", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/runs", id, "live-status"] });
      toast({
        title: resp.ok ? "Live deployment started" : "Live deployment blocked",
        description: resp.ok
          ? `Vercel deployment ${resp.deploymentId} created. Polling for completion.`
          : resp.blockers?.map((b: any) => b.message).join("; ") ?? resp.message,
        variant: resp.ok ? undefined : "destructive",
      });
    },
    onError: (err: any) => {
      toast({
        title: "Could not start live deployment",
        description: String(err?.message ?? err),
        variant: "destructive",
      });
    },
  });

  /* Auto-advance loop — dry-run only. Live runs poll via liveStatusQ. */
  useEffect(() => {
    if (!autoAdvance || !data) return;
    if (data.run?.mode === "live") {
      setAutoAdvance(false);
      return;
    }
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
          {isLive ? (
            <>
              <Button
                size="sm"
                onClick={() => {
                  if (!confirm(
                    "Confirm live deployment.\n\n" +
                    "This will trigger a REAL Vercel deployment for the selected repo and branch. " +
                    "It is not a simulation. Continue?",
                  )) return;
                  startLive.mutate();
                }}
                disabled={startLive.isPending || liveStatus === "live_running" || liveStatus === "live_succeeded"}
                className="gap-1"
                data-testid="button-start-live"
              >
                <Rocket className="h-3.5 w-3.5" />
                {liveStatus === "live_succeeded" ? "Live deploy ready" : liveStatus === "live_running" ? "Live deploy running" : "Start live deployment"}
              </Button>
              {run.vercelUrl && liveStatus === "live_succeeded" && (
                <a href={run.vercelUrl} target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" size="sm" className="gap-1" data-testid="button-open-live-app">
                    <ExternalLink className="h-3.5 w-3.5" /> Open live app
                  </Button>
                </a>
              )}
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
      }
    >
      {/* Run summary */}
      <Card className="mb-6">
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center gap-4">
            <StatusPill status={run.status} />
            {/* Mode badge — prominent. Distinguishes dry-run plans from live deploys. */}
            <Badge
              variant={isLive ? "default" : "outline"}
              className={cn("font-mono text-[10px]", isLive && "bg-primary text-primary-foreground")}
              data-testid="badge-mode"
            >
              {isLive ? "LIVE DEPLOY" : "DRY-RUN PLAN"}
            </Badge>
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
          {!isLive && (
            <p className="mt-3 text-[11px] text-muted-foreground border-t border-border pt-3">
              <strong>Dry-run plan only.</strong> No provider mutations are performed. Final state is{" "}
              <code className="font-mono">validated_dry_run</code> when stages pass.
              To actually deploy, create a new run with mode <code className="font-mono">live</code>.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Live Vercel deployment panel — only for live runs. */}
      {isLive && (
        <LiveVercelPanel
          run={run}
          live={liveStatusQ.data}
          loading={liveStatusQ.isLoading}
        />
      )}

      {/* Live provisioning steps and persisted external resources. */}
      <LiveProvisioningPanel data={liveStepsQ.data} loading={liveStepsQ.isLoading} />

      {/* Stages — hidden for live runs since they go through Vercel directly. */}
      {!isLive && (
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
      )}
    </PageShell>
  );
}

/* ---------------- Live Vercel deployment panel --------------------- */

function LiveVercelPanel({ run, live, loading }: { run: any; live: any; loading: boolean }) {
  const status: string = live?.status ?? run.status;
  const events: Array<{ type: string; text: string; createdAt: number | null }> =
    (live?.events ?? run.vercelEvents ?? []) as any[];
  const url: string | null = live?.vercelUrl ?? run.vercelUrl ?? null;
  const aliasUrl: string | null = live?.vercelAliasUrl ?? run.vercelAliasUrl ?? null;
  const inspectorUrl: string | null = live?.inspectorUrl ?? run.vercelInspectorUrl ?? null;
  const errorMessage: string | null = live?.errorMessage ?? run.vercelErrorMessage ?? null;
  const deploymentId: string | null = run.vercelDeploymentId ?? null;
  const projectName: string | null = run.vercelProjectName ?? null;
  const readyState: string | null = live?.vercelStatus ?? run.vercelStatus ?? null;

  const blocked = status === "live_blocked";
  const failed = status === "live_failed";
  const succeeded = status === "live_succeeded";
  const running = status === "live_running" || status === "live_pending";

  return (
    <Card className="mb-6">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Rocket className="h-4 w-4" />
          Live Vercel deployment
          <StatusPill status={status as any} className="ml-2" />
          {readyState && (
            <Badge variant="outline" className="ml-1 text-[10px] font-mono">
              vercel: {readyState}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading && !live && (
          <p className="text-xs text-muted-foreground">Loading live status…</p>
        )}

        {/* Blocker view */}
        {blocked && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 mb-3">
            <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 text-xs font-semibold mb-2">
              <ShieldAlert className="h-3.5 w-3.5" /> Live deployment blocked — clear the requirements below and retry.
            </div>
            <ul className="space-y-1.5 text-xs">
              {events.filter((e) => e.type === "blocker").map((e, i) => (
                <li key={i} className="rounded border border-border bg-card px-2 py-1.5 font-mono text-[11px]" data-testid={`blocker-row-${i}`}>
                  {e.text}
                </li>
              ))}
              {errorMessage && (
                <li className="rounded border border-border bg-card px-2 py-1.5 font-mono text-[11px] whitespace-pre-wrap">
                  {errorMessage}
                </li>
              )}
            </ul>
          </div>
        )}

        {/* Deployment metadata grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs font-mono mb-3">
          <KVRow label="Vercel project" value={projectName ?? "—"} testid="kv-vercel-project" />
          <KVRow label="Deployment ID" value={deploymentId ?? "—"} testid="kv-vercel-deployment-id" />
          <KVRow label="Ready state" value={readyState ?? "—"} testid="kv-vercel-ready-state" />
          <KVRow label="Polled at" value={live?.lastPolledAt ? new Date(live.lastPolledAt).toLocaleTimeString() : run.vercelLastPolledAt ? new Date(run.vercelLastPolledAt).toLocaleTimeString() : "—"} testid="kv-vercel-polled-at" />
          <KVRow
            label="Public URL"
            value={url ?? "—"}
            href={succeeded && url ? url : null}
            testid="kv-vercel-url"
          />
          <KVRow
            label="Inspector"
            value={inspectorUrl ?? "—"}
            href={inspectorUrl ?? null}
            testid="kv-vercel-inspector"
          />
        </div>

        {/* Open live app button — only when there's an actual ready URL. */}
        {succeeded && url && (
          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-block mb-3">
            <Button variant="default" size="sm" className="gap-1" data-testid="button-open-deployment">
              <ExternalLink className="h-3.5 w-3.5" /> Open live app
            </Button>
          </a>
        )}

        {failed && errorMessage && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 mb-3 text-xs">
            <div className="flex items-center gap-2 text-destructive font-semibold mb-1">
              <AlertTriangle className="h-3.5 w-3.5" /> Deployment failed
            </div>
            <div className="font-mono whitespace-pre-wrap text-[11px]">{errorMessage}</div>
          </div>
        )}

        {/* Real Vercel events log */}
        <div className="rounded-md border border-border bg-[#0c1220] dark:bg-[#06090f] text-[#cdd6e0]">
          <div className="border-b border-white/10 px-3 py-2 text-[11px] font-mono text-white/50 flex items-center justify-between">
            <span>vercel events · {events.length}</span>
            <span>{running ? "polling…" : status}</span>
          </div>
          <pre className="p-3 text-[12px] leading-relaxed font-mono overflow-x-auto max-h-[40vh] overflow-y-auto">
{events.length === 0
  ? "No events yet. Events arrive once Vercel returns deployment activity. None are synthesized."
  : events.map((e) => {
      const ts = e.createdAt ? new Date(e.createdAt).toISOString().slice(11, 19) : "         ";
      return `${ts} [${e.type}] ${e.text}`;
    }).join("\n")}
          </pre>
        </div>
      </CardContent>
    </Card>
  );
}

function LiveProvisioningPanel({ data, loading }: { data: any; loading: boolean }) {
  const steps: any[] = Array.isArray(data?.steps) ? data.steps : [];
  const resources: any[] = Array.isArray(data?.resources) ? data.resources : [];
  if (!loading && steps.length === 0 && resources.length === 0) return null;
  return (
    <Card className="mb-6" data-testid="card-live-provisioning">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <ShieldAlert className="h-4 w-4" /> Live provisioning
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && <Skeleton className="h-24 w-full" />}
        {!loading && steps.length > 0 && (
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Steps</div>
            <ul className="space-y-1.5 text-xs">
              {steps.map((s: any) => (
                <li key={s.id} className="flex items-start gap-2 rounded border border-border bg-card px-2 py-1.5" data-testid={`prov-step-${s.id}`}>
                  <Badge variant="outline" className={cn(
                    "text-[9px] font-mono uppercase",
                    s.status === "succeeded" && "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
                    s.status === "validated_dry_run" && "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
                    s.status === "blocked" && "border-amber-500/40 text-amber-600 dark:text-amber-400",
                    s.status === "failed" && "border-red-500/40 text-red-600 dark:text-red-400",
                  )}>
                    {s.status}
                  </Badge>
                  <ProviderIcon provider={s.provider} className="h-3.5 w-3.5 mt-0.5 text-muted-foreground" />
                  <div className="flex-1">
                    <div className="text-foreground/90">{s.label}</div>
                    {s.blockerCode && (
                      <div className="text-[10px] text-amber-600 dark:text-amber-400 font-mono mt-0.5">
                        {s.blockerCode}: {s.blockerMessage}
                      </div>
                    )}
                    {s.remediation && (
                      <div className="text-[10px] text-muted-foreground mt-0.5">→ {s.remediation}</div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        {!loading && resources.length > 0 && (
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Provider resources</div>
            <ul className="space-y-1.5 text-xs">
              {resources.map((r: any) => (
                <li key={r.id} className="flex items-center gap-2 rounded border border-border bg-card px-2 py-1.5" data-testid={`prov-res-${r.id}`}>
                  <ProviderIcon provider={r.provider} className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="font-mono text-[10px] text-muted-foreground">{r.resourceType}</span>
                  <span className="text-foreground/90 flex-1 truncate" title={r.name}>{r.name}</span>
                  {r.externalId && (
                    <span className="font-mono text-[10px] text-muted-foreground">{String(r.externalId).slice(0, 16)}</span>
                  )}
                  {r.url && (
                    <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-primary hover:underline">
                      open
                    </a>
                  )}
                  <Badge variant="outline" className={cn(
                    "text-[9px] font-mono uppercase",
                    r.status === "succeeded" && "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
                    r.status === "blocked" && "border-amber-500/40 text-amber-600 dark:text-amber-400",
                    r.status === "failed" && "border-red-500/40 text-red-600 dark:text-red-400",
                  )}>
                    {r.status}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function KVRow({ label, value, href, testid }: { label: string; value: string; href?: string | null; testid?: string }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border px-3 py-1.5 bg-card/40" data-testid={testid}>
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline truncate max-w-[60%]">
          {value}
        </a>
      ) : (
        <span className="text-xs truncate max-w-[60%]" title={value}>{value}</span>
      )}
    </div>
  );
}
