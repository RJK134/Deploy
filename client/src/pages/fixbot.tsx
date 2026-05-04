import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/status-pill";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Activity, AlertTriangle, GitPullRequest, RefreshCcw, Terminal, Wrench,
  ShieldAlert, ShieldCheck, ChevronRight, History, Stethoscope, Zap, Mail,
} from "lucide-react";
import { cn } from "@/lib/utils";

type AutonomyLevel = "diagnose-only" | "prepare-fix" | "approval-required" | "safe-auto-fix";

interface IncidentLite {
  id: number;
  title: string;
  category: string;
  severity: string;
  status: string;
  autonomy: AutonomyLevel;
  summary: string;
  signals: string[];
  detectedAt: number;
  diagnosesCount: number;
  remediationsCount: number;
  topConfidence: number;
}

interface IncidentDetail {
  incident: IncidentLite & { signals: string[] };
  diagnoses: Array<{
    id: number;
    rootCause: string;
    evidence: string[];
    confidence: number;
    recommendation: string;
    createdAt: number;
  }>;
  remediations: Array<{
    id: number;
    action: string;
    title: string;
    description: string;
    status: string;
    approvalRequired: boolean;
    payload: Record<string, unknown>;
    log: string;
    completedAt: number | null;
  }>;
  audits: Array<{
    id: number;
    actor: string;
    event: string;
    detail: string;
    mode: string;
    createdAt: number;
  }>;
}

interface HealthCheck {
  id: number;
  key: string;
  name: string;
  kind: string;
  target: string;
  status: string;
  lastDetail: string;
  lastObservedAt: number | null;
}

const AUTONOMY_LABELS: Record<AutonomyLevel, { label: string; tone: string; description: string }> = {
  "diagnose-only":     { label: "diagnose only",     tone: "bg-muted/40 text-foreground border-border",                 description: "Fix Bot reports root cause but won't propose any change." },
  "prepare-fix":       { label: "prepare fix",       tone: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30", description: "Fix Bot drafts a fix (PR body, env diff, migration) but never opens it." },
  "approval-required": { label: "approval required", tone: "bg-primary/10 text-primary border-primary/30",              description: "Drafts and queues remediations. A human must approve before anything runs." },
  "safe-auto-fix":     { label: "safe auto-fix",     tone: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30",  description: "Reserved for low-risk, idempotent fixes (e.g. attach a domain). Other changes still require approval." },
};

const ACTION_ICON: Record<string, any> = {
  "open-pr": GitPullRequest,
  "create-issue": Mail,
  "retry-deploy": RefreshCcw,
  "update-env": Wrench,
  "run-migration": Terminal,
  "rollback": History,
  "escalate": ShieldAlert,
};

function fmtAgo(ts: number | null | undefined) {
  if (!ts) return "—";
  const d = (Date.now() - ts) / 1000;
  if (d < 60) return `${Math.round(d)}s ago`;
  if (d < 3600) return `${Math.round(d / 60)}m ago`;
  if (d < 86400) return `${Math.round(d / 3600)}h ago`;
  return `${Math.round(d / 86400)}d ago`;
}

function severityTone(s: string) {
  if (s === "critical") return "bg-destructive/10 text-destructive border-destructive/30";
  if (s === "warning")  return "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30";
  return "bg-muted/40 text-muted-foreground border-border";
}

function statusToPill(s: string): any {
  if (s === "open" || s === "diagnosing") return "running";
  if (s === "fix-ready" || s === "approved") return "paused";
  if (s === "resolved") return "succeeded";
  if (s === "escalated") return "failed";
  return "pending";
}

function healthTone(s: string) {
  if (s === "ok")      return "bg-emerald-500/10 text-emerald-500 border-emerald-500/30";
  if (s === "warning") return "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30";
  if (s === "down")    return "bg-destructive/10 text-destructive border-destructive/30";
  return "bg-muted/40 text-muted-foreground border-border";
}

export default function FixBotPage() {
  const incidents = useQuery<IncidentLite[]>({ queryKey: ["/api/fixbot/incidents"] });
  const checks = useQuery<HealthCheck[]>({ queryKey: ["/api/fixbot/health"] });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tab, setTab] = useState<"incidents" | "monitors" | "audit">("incidents");
  const { toast } = useToast();

  const detail = useQuery<IncidentDetail>({
    queryKey: ["/api/fixbot/incidents", selectedId],
    enabled: selectedId != null,
  });

  const probe = useMutation({
    mutationFn: async (key: string) => {
      const res = await apiRequest("POST", `/api/fixbot/health/${key}/probe`, {});
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/fixbot/health"] }),
  });

  const diagnose = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/fixbot/incidents/${id}/diagnose`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fixbot/incidents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/fixbot/incidents", selectedId] });
      toast({ title: "Diagnosis added", description: "Fix Bot has analyzed the latest signals (dry-run)." });
    },
  });

  const setAutonomy = useMutation({
    mutationFn: async ({ id, autonomy }: { id: number; autonomy: AutonomyLevel }) => {
      const res = await apiRequest("POST", `/api/fixbot/incidents/${id}/autonomy`, { autonomy });
      return res.json();
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/fixbot/incidents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/fixbot/incidents", selectedId] });
      toast({ title: "Autonomy updated", description: `${vars.autonomy}` });
    },
  });

  const approve = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/fixbot/remediations/${id}/approve`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fixbot/incidents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/fixbot/incidents", selectedId] });
      toast({ title: "Remediation approved", description: "Ready to apply (still dry-run by default)." });
    },
  });

  const dismiss = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/fixbot/remediations/${id}/dismiss`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fixbot/incidents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/fixbot/incidents", selectedId] });
    },
  });

  const apply = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/fixbot/remediations/${id}/apply`, {});
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/fixbot/incidents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/fixbot/incidents", selectedId] });
      toast({
        title: data.effective === "applied" ? "Applied (live)" : data.effective === "blocked" ? "Blocked" : "Simulated",
        description: data.reason ?? "See the remediation log for output.",
      });
    },
  });

  const open = incidents.data?.filter((i) => i.status !== "resolved").length ?? 0;
  const critical = incidents.data?.filter((i) => i.severity === "critical").length ?? 0;
  const downChecks = checks.data?.filter((c) => c.status === "down").length ?? 0;

  return (
    <PageShell
      eyebrow="Reliability"
      title="Fix Bot"
      description="Continuous health monitors, automatic diagnoses, and approval-gated fixes for managed deployments. Every action defaults to a dry-run simulation."
      actions={
        <Badge variant="outline" className="font-mono text-[10px]" data-testid="badge-fixbot-mode">DRY-RUN</Badge>
      }
    >
      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Kpi icon={<AlertTriangle className="h-4 w-4" />} label="Open incidents" value={open} testId="kpi-open" />
        <Kpi icon={<ShieldAlert className="h-4 w-4" />}   label="Critical"        value={critical} testId="kpi-critical" />
        <Kpi icon={<Activity className="h-4 w-4" />}      label="Monitors down"   value={downChecks} testId="kpi-down" />
        <Kpi icon={<ShieldCheck className="h-4 w-4" />}   label="Live fixes"      value="0" sub="approval gated" testId="kpi-live" />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="mb-4">
        <TabsList data-testid="tabs-fixbot">
          <TabsTrigger value="incidents" data-testid="tab-incidents">Incidents</TabsTrigger>
          <TabsTrigger value="monitors"  data-testid="tab-monitors">Health monitors</TabsTrigger>
          <TabsTrigger value="audit"     data-testid="tab-audit">Audit</TabsTrigger>
        </TabsList>

        {/* INCIDENTS */}
        <TabsContent value="incidents" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,360px)_1fr] gap-4">
            <Card data-testid="card-incident-list">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Detected incidents</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {incidents.isLoading ? (
                  <div className="p-3 space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
                ) : (incidents.data ?? []).length === 0 ? (
                  <div className="p-6 text-center text-xs text-muted-foreground">No incidents. All systems quiet.</div>
                ) : (
                  <ul className="divide-y divide-border">
                    {incidents.data?.map((i) => (
                      <li key={i.id}>
                        <button
                          onClick={() => setSelectedId(i.id)}
                          className={cn(
                            "w-full text-left px-3 py-3 hover-elevate transition flex items-start gap-2",
                            selectedId === i.id && "bg-muted/50"
                          )}
                          data-testid={`row-incident-${i.id}`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 mb-1">
                              <Badge variant="outline" className={cn("text-[10px]", severityTone(i.severity))}>{i.severity}</Badge>
                              <Badge variant="outline" className="text-[10px] font-mono">{i.category}</Badge>
                            </div>
                            <div className="text-sm font-medium truncate">{i.title}</div>
                            <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                              <StatusPill status={statusToPill(i.status)} className="text-[10px]" />
                              <span>{fmtAgo(i.detectedAt)}</span>
                              {i.topConfidence > 0 && <span>· {i.topConfidence}% confident</span>}
                            </div>
                          </div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground mt-1 shrink-0" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <div className="min-w-0">
              {selectedId == null ? (
                <Card data-testid="card-incident-empty">
                  <CardContent className="p-12 text-center text-sm text-muted-foreground">
                    Select an incident to inspect diagnoses and proposed fixes.
                  </CardContent>
                </Card>
              ) : detail.isLoading || !detail.data ? (
                <Skeleton className="h-96 w-full" />
              ) : (
                <IncidentDetailView
                  data={detail.data}
                  onDiagnose={() => diagnose.mutate(selectedId!)}
                  onAutonomy={(a) => setAutonomy.mutate({ id: selectedId!, autonomy: a })}
                  onApprove={(rid) => approve.mutate(rid)}
                  onDismiss={(rid) => dismiss.mutate(rid)}
                  onApply={(rid) => apply.mutate(rid)}
                  applyPending={apply.isPending}
                />
              )}
            </div>
          </div>
        </TabsContent>

        {/* HEALTH MONITORS */}
        <TabsContent value="monitors" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {checks.isLoading ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-32" />) :
              checks.data?.map((c) => (
                <Card key={c.id} data-testid={`card-check-${c.key}`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <CardTitle className="text-sm">{c.name}</CardTitle>
                        <div className="text-[10px] mt-1 text-muted-foreground font-mono truncate">{c.target}</div>
                      </div>
                      <Badge variant="outline" className={cn("text-[10px]", healthTone(c.status))} data-testid={`badge-health-${c.key}`}>
                        {c.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="text-xs text-muted-foreground mb-3">{c.lastDetail || "—"}</div>
                    <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                      <span>kind: <span className="font-mono">{c.kind}</span></span>
                      <span>{fmtAgo(c.lastObservedAt)}</span>
                    </div>
                    <Button
                      variant="outline" size="sm" className="mt-3 w-full"
                      onClick={() => probe.mutate(c.key)}
                      disabled={probe.isPending}
                      data-testid={`button-probe-${c.key}`}
                    >
                      <RefreshCcw className="h-3.5 w-3.5 mr-1.5" /> Probe now
                    </Button>
                  </CardContent>
                </Card>
              ))}
          </div>
        </TabsContent>

        {/* AUDIT */}
        <TabsContent value="audit" className="mt-4">
          <AuditView incidents={incidents.data ?? []} />
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}

function Kpi({ icon, label, value, sub, testId }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub?: string; testId: string }) {
  return (
    <Card data-testid={testId}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
          {icon} {label}
        </div>
        <div className="mt-1 text-xl font-semibold">{value}</div>
        {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function IncidentDetailView({
  data, onDiagnose, onAutonomy, onApprove, onDismiss, onApply, applyPending,
}: {
  data: IncidentDetail;
  onDiagnose: () => void;
  onAutonomy: (a: AutonomyLevel) => void;
  onApprove: (rid: number) => void;
  onDismiss: (rid: number) => void;
  onApply: (rid: number) => void;
  applyPending: boolean;
}) {
  const inc = data.incident;
  const aMeta = AUTONOMY_LABELS[inc.autonomy] ?? AUTONOMY_LABELS["approval-required"];
  return (
    <div className="space-y-4">
      <Card data-testid={`card-incident-${inc.id}`}>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 mb-2">
                <Badge variant="outline" className={cn("text-[10px]", severityTone(inc.severity))}>{inc.severity}</Badge>
                <Badge variant="outline" className="text-[10px] font-mono">{inc.category}</Badge>
                <StatusPill status={statusToPill(inc.status)} className="text-[10px]" />
              </div>
              <CardTitle className="text-base">{inc.title}</CardTitle>
              <p className="mt-2 text-xs text-muted-foreground max-w-2xl">{inc.summary}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={onDiagnose} data-testid="button-diagnose">
                <Stethoscope className="h-3.5 w-3.5 mr-1.5" /> Re-diagnose
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
              <Zap className="h-3 w-3" /> Autonomy level
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Select
                value={inc.autonomy}
                onValueChange={(v) => onAutonomy(v as AutonomyLevel)}
              >
                <SelectTrigger className="w-[200px] h-8 text-xs" data-testid="select-autonomy">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(AUTONOMY_LABELS) as AutonomyLevel[]).map((k) => (
                    <SelectItem key={k} value={k} data-testid={`option-autonomy-${k}`}>
                      {AUTONOMY_LABELS[k].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Badge variant="outline" className={cn("text-[10px]", aMeta.tone)}>{aMeta.label}</Badge>
              <span className="text-[11px] text-muted-foreground">{aMeta.description}</span>
            </div>
          </div>
          {inc.signals.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                <Terminal className="h-3 w-3" /> Signals
              </div>
              <pre className="rounded-md border border-border bg-[#0c1220] dark:bg-[#06090f] text-[#cdd6e0] p-3 text-[11px] font-mono overflow-x-auto">
{inc.signals.map((s) => s).join("\n")}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>

      {/* DIAGNOSES */}
      <Card data-testid="card-diagnoses">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Stethoscope className="h-4 w-4 text-primary" /> Diagnoses ({data.diagnoses.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.diagnoses.length === 0 && (
            <div className="text-xs text-muted-foreground">
              No diagnosis yet. Click <span className="font-mono">Re-diagnose</span> to run Fix Bot's analyzer.
            </div>
          )}
          {data.diagnoses.map((d) => (
            <div key={d.id} className="rounded-md border border-border bg-card/40 p-3" data-testid={`row-diagnosis-${d.id}`}>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="text-xs font-medium">{d.rootCause}</div>
                <Badge variant={d.confidence >= 80 ? "default" : "outline"} className="text-[10px] font-mono shrink-0" data-testid={`badge-confidence-${d.id}`}>
                  {d.confidence}% conf
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mb-2">{d.recommendation}</p>
              {d.evidence.length > 0 && (
                <ul className="space-y-1 mt-1.5">
                  {d.evidence.map((e, i) => (
                    <li key={i} className="text-[11px] font-mono text-muted-foreground flex gap-2">
                      <span className="text-primary/60">›</span><span>{e}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="text-[10px] text-muted-foreground mt-2">{fmtAgo(d.createdAt)}</div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* REMEDIATIONS */}
      <Card data-testid="card-remediations">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Wrench className="h-4 w-4 text-primary" /> Suggested fixes ({data.remediations.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.remediations.map((r) => {
            const Icon = ACTION_ICON[r.action] ?? Wrench;
            return (
              <div key={r.id} className="rounded-md border border-border bg-card/40 p-3" data-testid={`row-remediation-${r.id}`}>
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="flex items-start gap-2 min-w-0">
                    <Icon className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <Badge variant="outline" className="text-[10px] font-mono">{r.action}</Badge>
                        <Badge variant={r.status === "applied" || r.status === "approved" ? "default" : "outline"} className="text-[10px]" data-testid={`badge-rem-status-${r.id}`}>
                          {r.status}
                        </Badge>
                        {r.approvalRequired && r.status !== "applied" && r.status !== "dismissed" && (
                          <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30">
                            approval required
                          </Badge>
                        )}
                      </div>
                      <div className="text-sm font-medium">{r.title}</div>
                      <p className="text-xs text-muted-foreground mt-1">{r.description}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {r.status === "proposed" && r.approvalRequired && (
                      <Button size="sm" variant="outline" onClick={() => onApprove(r.id)} data-testid={`button-approve-${r.id}`}>
                        Approve
                      </Button>
                    )}
                    {r.status !== "applied" && r.status !== "dismissed" && (
                      <Button size="sm" onClick={() => onApply(r.id)} disabled={applyPending} data-testid={`button-apply-${r.id}`}>
                        {r.action === "open-pr" ? "Open PR (dry-run)" :
                         r.action === "retry-deploy" ? "Retry deploy (dry-run)" :
                         r.action === "update-env" ? "Update env (dry-run)" :
                         r.action === "run-migration" ? "Prepare migration (dry-run)" :
                         r.action === "escalate" ? "Escalate (dry-run)" :
                         "Apply (dry-run)"}
                      </Button>
                    )}
                    {r.status !== "dismissed" && r.status !== "applied" && (
                      <Button size="sm" variant="ghost" onClick={() => onDismiss(r.id)} data-testid={`button-dismiss-${r.id}`}>
                        Dismiss
                      </Button>
                    )}
                  </div>
                </div>
                {r.log && (
                  <pre className="mt-3 rounded-md border border-border bg-[#0c1220] dark:bg-[#06090f] text-[#cdd6e0] p-3 text-[11px] font-mono overflow-x-auto" data-testid={`log-rem-${r.id}`}>
{r.log}
                  </pre>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* AUDIT for incident */}
      <Card data-testid="card-incident-audit">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <History className="h-4 w-4 text-primary" /> Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.audits.length === 0 ? (
            <div className="text-xs text-muted-foreground">No activity yet.</div>
          ) : (
            <ul className="space-y-1.5 text-xs">
              {data.audits.map((a) => (
                <li key={a.id} className="flex items-start gap-2" data-testid={`audit-${a.id}`}>
                  <Badge variant="outline" className="font-mono text-[10px] shrink-0">{a.event}</Badge>
                  <span className="text-foreground/80">{a.detail}</span>
                  <span className="ml-auto text-muted-foreground text-[10px] shrink-0">{a.actor} · {fmtAgo(a.createdAt)} · {a.mode}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AuditView({ incidents }: { incidents: IncidentLite[] }) {
  /* Combined activity across all incidents — uses per-incident detail fetch.
   * For demo simplicity, we just summarize. Full activity is on each incident. */
  return (
    <Card data-testid="card-global-audit">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <History className="h-4 w-4 text-primary" /> Recent incidents
        </CardTitle>
      </CardHeader>
      <CardContent>
        {incidents.length === 0 ? (
          <div className="text-xs text-muted-foreground">No incidents yet.</div>
        ) : (
          <ul className="space-y-2 text-xs">
            {incidents.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 border-b border-border last:border-0 pb-2" data-testid={`audit-row-${i.id}`}>
                <div className="flex items-center gap-2 min-w-0">
                  <Badge variant="outline" className={cn("text-[10px]", severityTone(i.severity))}>{i.severity}</Badge>
                  <span className="truncate">{i.title}</span>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground shrink-0">
                  <span className="font-mono">{i.category}</span>
                  <span>{fmtAgo(i.detectedAt)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
