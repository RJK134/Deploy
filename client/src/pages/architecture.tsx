import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import {
  Cloud, Database, Globe2, Github, ServerCog, Workflow, ArrowRight,
  ShieldCheck, Boxes, KeyRound,
} from "lucide-react";

interface SystemInfo {
  db: { backend: "sqlite" | "postgres"; driver: string; url: string; source: string; liveCapable: boolean };
  liveEnabled: boolean;
  providerModes: Record<string, boolean>;
  runtime: { node: string; platform: string; env: string; host: string };
  vercelReady: boolean;
  databaseUrlPresent: boolean;
}

interface Architecture {
  db: SystemInfo["db"];
  live: boolean;
  vercelDetected: boolean;
  layers: Array<{ id: string; label: string; detail: string }>;
  flows: Array<{ from: string; to: string; label: string }>;
  envVars: Array<{ key: string; required: boolean; source: string; note: string }>;
}

const layerIcon: Record<string, any> = {
  edge: Globe2, app: ServerCog, data: Database, storage: Boxes,
  github: Github, providers: Workflow,
};

export default function ArchitecturePage() {
  const sys = useQuery<SystemInfo>({ queryKey: ["/api/system"] });
  const arch = useQuery<Architecture>({ queryKey: ["/api/architecture"] });

  return (
    <PageShell
      eyebrow="Operations"
      title="Production architecture"
      description="The control-plane shape DeployOps Console runs in when deployed: Vercel for the app/API, Neon Postgres for state, GitHub as source of truth, and the provider-adapter mesh that drives Test/Demo/Deploy."
    >
      {/* runtime banner */}
      <Card className="mb-6" data-testid="card-runtime">
        <CardContent className="p-4 flex flex-wrap gap-x-8 gap-y-3 items-center text-xs">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Database backend</div>
            <div className="flex items-center gap-2">
              <Badge variant={sys.data?.db.backend === "postgres" ? "default" : "outline"} data-testid={`badge-backend-${sys.data?.db.backend}`}>
                {sys.data?.db.backend ?? "…"}
              </Badge>
              <span className="text-muted-foreground font-mono">{sys.data?.db.url}</span>
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Live mode</div>
            <Badge variant={sys.data?.liveEnabled ? "default" : "outline"} data-testid="badge-live-mode">
              {sys.data?.liveEnabled ? "ENABLED" : "DRY-RUN"}
            </Badge>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Host</div>
            <Badge variant="outline" className="font-mono text-[10px]" data-testid="badge-host">
              {sys.data?.runtime.host ?? "…"} · {sys.data?.runtime.env}
            </Badge>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">DATABASE_URL</div>
            <Badge variant={sys.data?.databaseUrlPresent ? "default" : "outline"} data-testid="badge-database-url">
              {sys.data?.databaseUrlPresent ? "set" : "not set (sqlite)"}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* layered diagram */}
      <Card className="mb-6" data-testid="card-architecture-diagram">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Cloud className="h-4 w-4 text-primary" /> Production control plane
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {arch.isLoading
            ? <Skeleton className="h-72 w-full" />
            : (
              <div className="rounded-lg border border-border bg-card/30 p-4 lg:p-6 grid-bg">
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-3 mb-3">
                  <ArchNode id="edge"   label="Vercel Edge"          sub="CDN · TLS · routing" data-testid="node-edge" />
                  <Arrow label="HTTP" />
                  <ArchNode id="app"    label="Vercel Serverless"    sub="Express handler · API + SPA" data-testid="node-app" />
                  <Arrow label="SQL" />
                  <ArchNode id="data"   label="Neon Postgres"        sub="branch per env · DATABASE_URL" data-testid="node-data" />
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-3 mt-3">
                  <ArchNode id="github" label="GitHub source"        sub="repos · PRs · workflows" data-testid="node-github" />
                  <Arrow label="adapters" />
                  <ArchNode id="providers" label="Provider adapters" sub="github · vercel · neon · prisma · railway" data-testid="node-providers" />
                  <Arrow label="dry-run by default" />
                  <ArchNode id="storage" label="Run state"           sub="runs · stages · audit logs" data-testid="node-storage" />
                </div>
              </div>
            )}
          <p className="text-xs text-muted-foreground">
            Requests land at the Vercel edge, hit the Express handler that the build emits, and read/write through the Neon-backed data layer. Provider adapters never mutate external systems unless live mode is on AND the per-provider mode toggle is flipped.
          </p>
        </CardContent>
      </Card>

      {/* layer details */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
        {arch.data?.layers.map((l) => {
          const Icon = layerIcon[l.id] ?? Boxes;
          return (
            <Card key={l.id} data-testid={`card-layer-${l.id}`}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Icon className="h-4 w-4 text-primary" /> {l.label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">{l.detail}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* env vars */}
      <Card className="mb-6" data-testid="card-env-vars">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" /> Environment variables
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2">Var</th>
                  <th className="text-left px-3 py-2">Required</th>
                  <th className="text-left px-3 py-2">Source</th>
                  <th className="text-left px-3 py-2">Notes</th>
                </tr>
              </thead>
              <tbody>
                {arch.data?.envVars.map((v) => (
                  <tr key={v.key} className="border-t border-border" data-testid={`row-envvar-${v.key.toLowerCase()}`}>
                    <td className="px-3 py-2 font-mono">{v.key}</td>
                    <td className="px-3 py-2">
                      <Badge variant={v.required ? "default" : "outline"} className="text-[10px]">
                        {v.required ? "required" : "optional"}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{v.source}</td>
                    <td className="px-3 py-2 text-muted-foreground">{v.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* CTA to migration plan */}
      <Card data-testid="card-migration-cta">
        <CardContent className="p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="h-5 w-5 text-primary mt-0.5" />
            <div>
              <div className="text-sm font-medium">Ready to move off SQLite?</div>
              <p className="text-xs text-muted-foreground mt-1 max-w-xl">
                The Migration Plan page walks through provisioning Neon, wiring DATABASE_URL, applying the schema, and validating the cutover step by step.
              </p>
            </div>
          </div>
          <Link href="/migration" data-testid="link-migration-plan" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
            Open migration plan <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </CardContent>
      </Card>
    </PageShell>
  );
}

function ArchNode({ id, label, sub, "data-testid": testid }: { id: string; label: string; sub: string; "data-testid"?: string }) {
  const Icon = layerIcon[id] ?? Boxes;
  return (
    <div className="rounded-md border border-border bg-background/80 px-3 py-3 text-center" data-testid={testid}>
      <Icon className="h-5 w-5 mx-auto text-primary mb-1" />
      <div className="text-xs font-medium">{label}</div>
      <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>
    </div>
  );
}

function Arrow({ label }: { label: string }) {
  return (
    <div className="hidden lg:flex items-center justify-center text-muted-foreground" aria-hidden>
      <div className="text-[10px] font-mono uppercase tracking-wider mr-1.5">{label}</div>
      <ArrowRight className="h-4 w-4" />
    </div>
  );
}
