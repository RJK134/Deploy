import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useRoute } from "wouter";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ProviderIcon, providerLabel } from "@/components/provider-icon";
import { StateBadge } from "@/pages/projects";
import {
  GitBranch, ExternalLink, Copy, Check, RefreshCw, AlertTriangle,
  Sparkles, Plug, Zap, Eye, Share2, Activity, ArrowRight,
} from "lucide-react";

type EnvKey = "test" | "demo" | "deploy";
type EnvState =
  | "not_configured" | "blocked" | "configuring" | "deploying"
  | "live_ready" | "live_failed" | "dry_run_validated" | "unknown";

interface DashboardBlocker { code: string; message: string; remediation: string }
interface DashboardLink {
  kind: "app" | "alias" | "inspector" | "provider-dashboard" | "resource-dashboard";
  label: string; url: string;
  source: "vercel" | "railway" | "neon" | "supabase" | "prisma" | "github";
  real: boolean;
}
interface ResourceSummary {
  id: number; provider: string; resourceType: string; name: string;
  externalId: string | null; status: string; url: string | null;
  dashboardUrl: string | null; metadata: Record<string, unknown>;
  errorMessage: string | null; updatedAt: number;
}
interface EnvironmentCard {
  environment: EnvKey;
  label: string;
  state: EnvState;
  mode: "dry-run" | "live" | null;
  latestRun: { id: number; status: string; createdAt: number; startedAt: number | null; finishedAt: number | null; notes: string | null } | null;
  hostingProvider: "vercel" | "railway" | null;
  databaseProviders: Array<"neon" | "prisma" | "supabase" | "railway">;
  appUrl: string | null;
  inspectorUrl: string | null;
  resources: ResourceSummary[];
  steps: Array<{ id: number; order: number; provider: string; action: string; label: string; status: string; blockerCode: string | null; blockerMessage: string | null; remediation: string | null; metadata: Record<string, unknown>; finishedAt: number | null }>;
  blockers: DashboardBlocker[];
  share: {
    shareable: boolean; url: string | null; accessMode: "public" | "client" | "private" | "unknown";
    clientNote: string | null; lastVerifiedAt: number | null; source: "vercel" | "railway" | null;
  };
  links: DashboardLink[];
  logSummary: string[];
  lastCheckedAt: number | null;
}
interface ProjectDashboard {
  project: {
    id: number; name: string; repo: string; framework: string; rootDir: string;
    accessMode: string; sourceProvider: string; sourceBranch: string | null;
    sourceDefaultBranch: string | null; sourceUrl: string | null; createdAt: number;
  };
  readiness: {
    deployopsLive: boolean;
    providerConnections: Record<string, { source: "connection" | "env" | null; ready: boolean }>;
  };
  lastRun: { id: number; environment: string; status: string; mode: string; createdAt: number } | null;
  environments: EnvironmentCard[];
  blockers: DashboardBlocker[];
}

function fmtAgo(ts: number | null | undefined) {
  if (!ts) return "—";
  const d = (Date.now() - ts) / 1000;
  if (d < 60) return `${Math.round(d)}s ago`;
  if (d < 3600) return `${Math.round(d / 60)}m ago`;
  if (d < 86400) return `${Math.round(d / 3600)}h ago`;
  return `${Math.round(d / 86400)}d ago`;
}

export default function ProjectDashboard() {
  const [match, params] = useRoute<{ id: string }>("/projects/:id");
  const projectId = match ? Number(params!.id) : NaN;

  const dash = useQuery<{ ok: boolean; dashboard: ProjectDashboard }>({
    queryKey: [`/api/projects/${projectId}/dashboard`],
    enabled: Number.isFinite(projectId),
  });

  if (!match) return null;

  if (dash.isLoading) {
    return (
      <PageShell eyebrow="Workspace" title="Project dashboard">
        <Skeleton className="h-32 w-full mb-6" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-72 w-full" />)}
        </div>
      </PageShell>
    );
  }
  if (dash.error || !dash.data?.ok) {
    return (
      <PageShell eyebrow="Workspace" title="Project dashboard">
        <Card data-testid="dashboard-error">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Could not load this project dashboard. <Link href="/projects" className="text-primary hover:underline">Back to projects</Link>.
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  const d = dash.data.dashboard;
  return (
    <PageShell
      eyebrow="Workspace"
      title={d.project.name}
      description="Real-link environment dashboard. Open the live app, share a verified preview link, or jump to the provider's own dashboard. Buttons only appear when a real provider deployment or resource exists."
      actions={
        <div className="flex items-center gap-2">
          <Link href="/wizard">
            <Button variant="outline" data-testid="button-new-deploy" className="gap-2">
              <Sparkles className="h-4 w-4" /> New deployment
            </Button>
          </Link>
        </div>
      }
    >
      <ProjectHeader dashboard={d} />

      {d.blockers.length > 0 && (
        <Card className="mb-4 border-amber-500/40" data-testid="project-blockers">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" /> Project-level blockers
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {d.blockers.map((b, i) => (
              <BlockerRow key={i} blocker={b} testId={`project-blocker-${i}`} />
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6" data-testid="environment-cards">
        {d.environments.map((env) => (
          <EnvironmentSection key={env.environment} env={env} projectId={d.project.id} />
        ))}
      </div>

      <SharePanel dashboard={d} />
    </PageShell>
  );
}

function ProjectHeader({ dashboard }: { dashboard: ProjectDashboard }) {
  const p = dashboard.project;
  const liveProviders = Object.entries(dashboard.readiness.providerConnections)
    .filter(([, v]) => v.ready)
    .map(([k]) => k);
  return (
    <Card className="mb-6" data-testid="project-header">
      <CardContent className="py-5">
        <div className="flex flex-wrap items-start gap-4 justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-lg font-semibold">{p.name}</h2>
              <Badge variant="outline" className="font-mono text-[10px] uppercase">{p.framework}</Badge>
              <Badge variant="outline" className="font-mono text-[10px] uppercase">{p.accessMode}</Badge>
            </div>
            <div className="text-[12px] font-mono text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="inline-flex items-center gap-1">
                <GitBranch className="h-3 w-3" /> {p.repo}
              </span>
              {p.sourceBranch && <span>@ {p.sourceBranch}</span>}
              {p.sourceUrl && (
                <a
                  href={p.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-1"
                  data-testid="link-source-repo"
                >
                  <ExternalLink className="h-3 w-3" /> open repo
                </a>
              )}
            </div>
            {dashboard.lastRun && (
              <div className="mt-2 text-[12px] text-muted-foreground">
                Last run:{" "}
                <Link href={`/runs/${dashboard.lastRun.id}`} className="text-primary hover:underline" data-testid="link-last-run">
                  #{dashboard.lastRun.id} → {dashboard.lastRun.environment} ({dashboard.lastRun.mode})
                </Link>{" "}
                · {fmtAgo(dashboard.lastRun.createdAt)}
              </div>
            )}
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0">
            <div className="flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Live</span>
              <Badge
                variant="outline"
                className={`font-mono text-[10px] ${dashboard.readiness.deployopsLive ? "text-emerald-500 border-emerald-500/40 bg-emerald-500/10" : "text-muted-foreground"}`}
                data-testid="badge-deployops-live"
              >
                {dashboard.readiness.deployopsLive ? "DEPLOYOPS_LIVE=1" : "dry-run gate"}
              </Badge>
            </div>
            <div className="flex flex-wrap justify-end gap-1 max-w-[280px]">
              {Object.keys(dashboard.readiness.providerConnections).map((k) => {
                const v = dashboard.readiness.providerConnections[k];
                return (
                  <Badge
                    key={k}
                    variant="outline"
                    className={`font-mono text-[10px] gap-1 ${v.ready ? "text-emerald-500 border-emerald-500/40" : "text-muted-foreground"}`}
                    data-testid={`provider-readiness-${k}`}
                    title={v.source ? `via ${v.source}` : "no token"}
                  >
                    <ProviderIcon provider={k as any} className="h-3 w-3" />
                    {providerLabel(k as any)}
                  </Badge>
                );
              })}
            </div>
            {liveProviders.length === 0 && (
              <Link href="/providers" className="text-[11px] text-primary hover:underline inline-flex items-center gap-1" data-testid="link-connect-providers">
                <Plug className="h-3 w-3" /> Connect providers
              </Link>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function EnvironmentSection({ env, projectId }: { env: EnvironmentCard; projectId: number }) {
  const [copied, setCopied] = useState(false);
  const refresh = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/environments/${env.environment}/refresh-status`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/dashboard`] });
    },
  });

  const copy = (url: string) => {
    navigator.clipboard.writeText(url).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Card data-testid={`env-card-${env.environment}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm flex items-center gap-2">
            {env.label}
          </CardTitle>
          <StateBadge state={env.state} />
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground flex items-center gap-2">
          {env.hostingProvider ? (
            <span className="inline-flex items-center gap-1">
              <ProviderIcon provider={env.hostingProvider} className="h-3 w-3" /> {providerLabel(env.hostingProvider)}
            </span>
          ) : (
            <span className="italic">no host</span>
          )}
          {env.databaseProviders.length > 0 && (
            <>
              <span>·</span>
              <span className="inline-flex items-center gap-1">
                {env.databaseProviders.map((p) => (
                  <span key={p} className="inline-flex items-center gap-0.5">
                    <ProviderIcon provider={p as any} className="h-3 w-3" /> {p}
                  </span>
                ))}
              </span>
            </>
          )}
          {env.mode && (
            <Badge variant="outline" className="font-mono text-[10px] uppercase ml-auto">
              {env.mode}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Real action buttons — only when real URLs exist. */}
        <div className="space-y-1.5">
          {env.appUrl ? (
            <div className="flex items-center gap-1.5">
              <a
                href={env.appUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1"
                data-testid={`button-open-app-${env.environment}`}
              >
                <Button size="sm" className="w-full justify-start gap-2">
                  <Eye className="h-3.5 w-3.5" /> Open {env.label}
                </Button>
              </a>
              <Button
                size="icon"
                variant="outline"
                className="h-8 w-8 shrink-0"
                onClick={() => copy(env.appUrl!)}
                title="Copy share link"
                data-testid={`button-copy-link-${env.environment}`}
              >
                {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
          ) : (
            <div className="text-[11px] text-muted-foreground italic" data-testid={`no-real-url-${env.environment}`}>
              No real public URL yet — open/share will appear after a successful live deployment.
            </div>
          )}
          {env.inspectorUrl && (
            <a
              href={env.inspectorUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-testid={`button-inspector-${env.environment}`}
            >
              <Button size="sm" variant="outline" className="w-full justify-start gap-2">
                <ExternalLink className="h-3.5 w-3.5" /> Open Vercel inspector
              </Button>
            </a>
          )}
          {env.links
            .filter((l) => l.kind === "resource-dashboard" && l.url !== env.inspectorUrl)
            .slice(0, 4)
            .map((l, i) => (
              <a
                key={`${l.url}-${i}`}
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                data-testid={`link-resource-${env.environment}-${i}`}
              >
                <Button size="sm" variant="outline" className="w-full justify-start gap-2">
                  <ExternalLink className="h-3.5 w-3.5" /> {l.label}
                </Button>
              </a>
            ))}
        </div>

        {/* Status / metadata */}
        <div className="rounded-md border border-border bg-card/40 px-3 py-2 text-[11px] space-y-1">
          <div className="flex justify-between text-muted-foreground">
            <span>Latest run</span>
            <span>{env.latestRun
              ? <Link href={`/runs/${env.latestRun.id}`} className="text-primary hover:underline" data-testid={`link-run-${env.environment}`}>#{env.latestRun.id}</Link>
              : "—"}</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>Last checked</span>
            <span>{fmtAgo(env.lastCheckedAt)}</span>
          </div>
          {env.latestRun?.notes && (
            <div className="text-muted-foreground italic truncate" title={env.latestRun.notes}>
              {env.latestRun.notes}
            </div>
          )}
        </div>

        {/* Blockers */}
        {env.blockers.length > 0 && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-[11px] space-y-2" data-testid={`blockers-${env.environment}`}>
            <div className="flex items-center gap-1 text-amber-500 font-medium">
              <AlertTriangle className="h-3 w-3" /> Blockers ({env.blockers.length})
            </div>
            {env.blockers.slice(0, 4).map((b, i) => (
              <BlockerRow key={i} blocker={b} testId={`env-blocker-${env.environment}-${i}`} compact />
            ))}
          </div>
        )}

        {/* Logs */}
        {env.logSummary.length > 0 && (
          <details className="text-[11px]" data-testid={`logs-${env.environment}`}>
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
              <Activity className="h-3 w-3" /> Recent log lines ({env.logSummary.length})
            </summary>
            <div className="mt-1 space-y-1 font-mono text-[10px] text-muted-foreground bg-muted/40 rounded-md p-2 max-h-32 overflow-auto">
              {env.logSummary.map((line, i) => (
                <div key={i} className="truncate" title={line}>{line}</div>
              ))}
            </div>
          </details>
        )}

        {/* Action row: refresh + start deploy */}
        <div className="flex items-center gap-2 pt-1">
          <Button
            size="sm"
            variant="outline"
            className="flex-1 gap-1"
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending}
            data-testid={`button-refresh-${env.environment}`}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refresh.isPending ? "animate-spin" : ""}`} />
            {refresh.isPending ? "Refreshing…" : "Refresh status"}
          </Button>
          {env.state === "not_configured" || env.state === "blocked" || env.state === "live_failed" ? (
            <Link href="/wizard" className="flex-1">
              <Button size="sm" variant="default" className="w-full gap-1" data-testid={`button-configure-${env.environment}`}>
                <Sparkles className="h-3.5 w-3.5" /> Configure
              </Button>
            </Link>
          ) : env.latestRun ? (
            <Link href={`/runs/${env.latestRun.id}`} className="flex-1">
              <Button size="sm" variant="ghost" className="w-full gap-1" data-testid={`button-open-run-${env.environment}`}>
                Open run <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function BlockerRow({ blocker, testId, compact }: { blocker: DashboardBlocker; testId: string; compact?: boolean }) {
  return (
    <div className="text-[11px] space-y-0.5" data-testid={testId}>
      <div className="flex items-start gap-2">
        <Badge variant="outline" className="font-mono text-[10px] uppercase shrink-0">
          {blocker.code}
        </Badge>
        <span className={compact ? "text-foreground" : "text-foreground"}>{blocker.message}</span>
      </div>
      {blocker.remediation && (
        <div className="text-muted-foreground pl-1">→ {blocker.remediation}</div>
      )}
    </div>
  );
}

function SharePanel({ dashboard }: { dashboard: ProjectDashboard }) {
  const [copiedEnv, setCopiedEnv] = useState<EnvKey | null>(null);
  const shareable = dashboard.environments.filter((e) => e.share.shareable && e.share.url);

  const copy = (env: EnvKey, url: string) => {
    navigator.clipboard.writeText(url).catch(() => {});
    setCopiedEnv(env);
    setTimeout(() => setCopiedEnv(null), 1500);
  };

  return (
    <Card data-testid="share-panel">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Share2 className="h-4 w-4 text-primary" /> Share with colleagues / clients
        </CardTitle>
      </CardHeader>
      <CardContent>
        {shareable.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">
            No real share links yet. After a successful live deployment, this panel will show the verified URL plus
            a client-friendly note that respects the project's access mode.
          </p>
        ) : (
          <div className="space-y-3">
            {shareable.map((env) => (
              <div
                key={env.environment}
                className="rounded-md border border-border bg-card/40 px-3 py-3"
                data-testid={`share-row-${env.environment}`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <Badge variant="outline" className="font-mono text-[10px] uppercase">{env.label}</Badge>
                  <span className="text-[10px] text-muted-foreground">verified {fmtAgo(env.share.lastVerifiedAt)} · via {env.share.source}</span>
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-[11px] font-mono truncate">{env.share.url}</code>
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-7 w-7"
                    onClick={() => copy(env.environment, env.share.url!)}
                    data-testid={`share-copy-${env.environment}`}
                  >
                    {copiedEnv === env.environment ? <Check className="h-3 w-3 text-primary" /> : <Copy className="h-3 w-3" />}
                  </Button>
                </div>
                {env.share.clientNote && (
                  <p className="mt-2 text-[11px] text-muted-foreground italic">{env.share.clientNote}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
