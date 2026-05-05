import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ProviderIcon } from "@/components/provider-icon";
import { CheckCircle2, AlertTriangle, ShieldAlert, Lock, Plug, Activity } from "lucide-react";

interface ReadinessProvider {
  provider: string;
  label: string;
  status: string;
  authMethod: string;
  liveMode: boolean;
  scopes: string[];
  missingScopes: string[];
  errors: string[];
  blockers: string[];
  liveReady: boolean;
}

interface ReadinessPayload {
  ok: true;
  summary: {
    liveEnabled: boolean;
    encryptionConfigured: boolean;
    keyFingerprint: string | null;
    githubOauthEnabled: boolean;
    readyProviders: number;
    totalProviders: number;
    liveDeployBlocked: boolean;
  };
  providers: ReadinessProvider[];
  globalBlockers: string[];
}

export default function ReadinessPage() {
  const q = useQuery<ReadinessPayload>({ queryKey: ["/api/live/readiness"] });
  const data = q.data;

  return (
    <PageShell
      eyebrow="Operations"
      title="Live Readiness"
      description="Everything that must be true before DeployOps can run live actions. Each blocker links back to the relevant configuration step."
    >
      {q.isLoading || !data ? (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Top summary */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <SummaryTile
              icon={<Activity className="h-4 w-4" />}
              label="Global"
              value={data.summary.liveEnabled ? "DEPLOYOPS_LIVE = 1" : "DEPLOYOPS_LIVE not set"}
              ok={data.summary.liveEnabled}
              testid="tile-live-enabled"
            />
            <SummaryTile
              icon={<Lock className="h-4 w-4" />}
              label="Encryption"
              value={data.summary.encryptionConfigured ? `key ${data.summary.keyFingerprint}` : "no key configured"}
              ok={data.summary.encryptionConfigured}
              testid="tile-encryption"
            />
            <SummaryTile
              icon={<Plug className="h-4 w-4" />}
              label="Providers ready"
              value={`${data.summary.readyProviders}/${data.summary.totalProviders}`}
              ok={data.summary.readyProviders > 0}
              testid="tile-providers-ready"
            />
            <SummaryTile
              icon={<ShieldAlert className="h-4 w-4" />}
              label="Live deploys"
              value={data.summary.liveDeployBlocked ? "BLOCKED" : "permitted"}
              ok={!data.summary.liveDeployBlocked}
              testid="tile-deploys-allowed"
            />
          </div>

          {data.globalBlockers.length > 0 && (
            <Card className="border-amber-500/40" data-testid="card-global-blockers">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" /> Global blockers
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-xs">
                  {data.globalBlockers.map((b, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 text-[11px] text-muted-foreground">
                  Configure these on the server (env vars), then refresh.
                </div>
              </CardContent>
            </Card>
          )}

          <Card data-testid="card-providers-readiness">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Provider readiness</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.providers.map((p) => <ProviderRow key={p.provider} p={p} />)}
              <div className="text-[11px] text-muted-foreground pt-2 border-t border-border">
                Need to fix something? <Link href="/providers" className="underline">Open Connection Center →</Link>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </PageShell>
  );
}

function SummaryTile({ icon, label, value, ok, testid }: { icon: React.ReactNode; label: string; value: string; ok: boolean; testid: string }) {
  return (
    <Card data-testid={testid}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
          {icon} {label}
        </div>
        <div className={`mt-2 text-sm font-mono ${ok ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
          {ok ? <CheckCircle2 className="inline h-4 w-4 mr-1" /> : <AlertTriangle className="inline h-4 w-4 mr-1" />}
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

function ProviderRow({ p }: { p: ReadinessProvider }) {
  return (
    <div className="rounded-md border border-border p-3" data-testid={`readiness-row-${p.provider}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <ProviderIcon provider={p.provider} className="h-4 w-4" />
          <span className="text-sm font-medium">{p.label}</span>
          <Badge variant="outline" className={`text-[10px] font-mono ${p.liveReady ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400" : "border-amber-500/40 text-amber-600 dark:text-amber-400"}`} data-testid={`readiness-status-${p.provider}`}>
            {p.liveReady ? "ready" : "blocked"}
          </Badge>
          <Badge variant="outline" className="text-[10px] font-mono">{p.status}</Badge>
          <Badge variant="outline" className="text-[10px] font-mono">{p.authMethod}</Badge>
          <Badge variant="outline" className="text-[10px] font-mono">{p.liveMode ? "live" : "dry-run"}</Badge>
        </div>
      </div>
      {p.blockers.length > 0 && (
        <ul className="mt-2 text-[11px] text-amber-700 dark:text-amber-400 space-y-0.5" data-testid={`readiness-blockers-${p.provider}`}>
          {p.blockers.map((b, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      )}
      {p.scopes.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {p.scopes.map((s) => (
            <Badge key={s} variant="outline" className="text-[9px] font-mono">{s}</Badge>
          ))}
        </div>
      )}
    </div>
  );
}
