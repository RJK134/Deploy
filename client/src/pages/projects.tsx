import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Box, GitBranch, ArrowRight, ExternalLink, Sparkles, AlertTriangle,
  CheckCircle2, CircleDashed, Loader2,
} from "lucide-react";

type EnvKey = "test" | "demo" | "deploy";

type EnvState =
  | "not_configured" | "blocked" | "configuring" | "deploying"
  | "live_ready" | "live_failed" | "dry_run_validated" | "unknown";

interface ProjectListEntry {
  id: number;
  name: string;
  repo: string;
  framework: string;
  accessMode: string;
  sourceBranch: string | null;
  sourceDefaultBranch: string | null;
  states: Record<EnvKey, EnvState>;
  urls: Record<EnvKey, string | null>;
  latestRunIds: Record<EnvKey, number | null>;
  lastUpdated: number;
}

function fmtAgo(ts: number | null | undefined) {
  if (!ts) return "—";
  const d = (Date.now() - ts) / 1000;
  if (d < 60) return `${Math.round(d)}s ago`;
  if (d < 3600) return `${Math.round(d / 60)}m ago`;
  if (d < 86400) return `${Math.round(d / 3600)}h ago`;
  return `${Math.round(d / 86400)}d ago`;
}

const ENV_LABELS: Record<EnvKey, string> = {
  test: "Test",
  demo: "Demo / Run",
  deploy: "Production",
};

export default function Projects() {
  const list = useQuery<{ ok: boolean; projects: ProjectListEntry[] }>({
    queryKey: ["/api/projects-dashboard"],
  });

  return (
    <PageShell
      eyebrow="Workspace"
      title="Projects"
      description="A real-link dashboard per project. Open the Test, Demo/Run, or Production version of a product when a real provider deployment exists. Otherwise, follow the listed blockers to wire it up."
      actions={
        <Link href="/wizard">
          <Button data-testid="button-new-project" className="gap-2">
            <Sparkles className="h-4 w-4" /> New deployment
          </Button>
        </Link>
      }
    >
      {list.isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-44 w-full" />
          ))}
        </div>
      ) : (list.data?.projects?.length ?? 0) === 0 ? (
        <Card data-testid="empty-projects">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No projects yet. <Link href="/wizard" className="text-primary hover:underline">Start a deployment</Link>.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {list.data?.projects?.map((p) => (
            <ProjectCard key={p.id} entry={p} />
          ))}
        </div>
      )}
    </PageShell>
  );
}

function ProjectCard({ entry }: { entry: ProjectListEntry }) {
  return (
    <Card data-testid={`project-card-${entry.id}`}>
      <CardHeader className="flex flex-row items-start justify-between gap-2 pb-3">
        <div className="min-w-0">
          <CardTitle className="text-sm flex items-center gap-2">
            <Box className="h-4 w-4 text-primary" />
            <Link href={`/projects/${entry.id}`} className="hover:underline" data-testid={`link-project-${entry.id}`}>
              {entry.name}
            </Link>
          </CardTitle>
          <div className="mt-1 text-[11px] font-mono text-muted-foreground flex items-center gap-1">
            <GitBranch className="h-3 w-3" /> {entry.repo}
            {entry.sourceBranch ? (
              <span className="ml-2">@ {entry.sourceBranch}</span>
            ) : entry.sourceDefaultBranch ? (
              <span className="ml-2">@ {entry.sourceDefaultBranch}</span>
            ) : null}
          </div>
        </div>
        <Badge variant="outline" className="font-mono text-[10px] uppercase shrink-0">
          {entry.framework}
        </Badge>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-2">
          {(["test", "demo", "deploy"] as EnvKey[]).map((env) => (
            <EnvSummary key={env} env={env} entry={entry} />
          ))}
        </div>
        <div className="mt-3 pt-3 border-t border-border flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Updated {fmtAgo(entry.lastUpdated)}</span>
          <Link
            href={`/projects/${entry.id}`}
            className="text-primary hover:underline inline-flex items-center gap-1"
            data-testid={`link-open-dashboard-${entry.id}`}
          >
            Open dashboard <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function EnvSummary({ env, entry }: { env: EnvKey; entry: ProjectListEntry }) {
  const state = entry.states[env];
  const url = entry.urls[env];
  return (
    <div
      className="rounded-md border border-border bg-card/40 px-2.5 py-2"
      data-testid={`env-summary-${entry.id}-${env}`}
    >
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{ENV_LABELS[env]}</div>
      <div className="mt-1 flex items-center gap-1.5">
        <StateBadge state={state} />
      </div>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-[11px] font-mono text-primary hover:underline truncate w-full"
          data-testid={`env-url-${entry.id}-${env}`}
          title={url}
        >
          <ExternalLink className="h-3 w-3 shrink-0" />
          <span className="truncate">{url.replace(/^https?:\/\//, "")}</span>
        </a>
      ) : (
        <div className="mt-2 text-[11px] text-muted-foreground italic">no real link</div>
      )}
    </div>
  );
}

export function StateBadge({ state }: { state: EnvState }) {
  const map: Record<EnvState, { label: string; tone: string; icon: any }> = {
    live_ready:        { label: "live ready",        tone: "text-emerald-500 bg-emerald-500/10 border-emerald-500/30", icon: CheckCircle2 },
    deploying:         { label: "deploying",         tone: "text-primary bg-primary/10 border-primary/30 [&_svg]:animate-spin", icon: Loader2 },
    configuring:       { label: "configuring",       tone: "text-primary bg-primary/10 border-primary/30", icon: Loader2 },
    blocked:           { label: "blocked",           tone: "text-amber-500 bg-amber-500/10 border-amber-500/30", icon: AlertTriangle },
    live_failed:       { label: "live failed",       tone: "text-destructive bg-destructive/10 border-destructive/30", icon: AlertTriangle },
    dry_run_validated: { label: "dry-run validated", tone: "text-muted-foreground bg-muted/40 border-border", icon: CircleDashed },
    not_configured:    { label: "not configured",    tone: "text-muted-foreground bg-muted/40 border-dashed border-border", icon: CircleDashed },
    unknown:           { label: "unknown",           tone: "text-muted-foreground bg-muted/40 border-border", icon: CircleDashed },
  };
  const m = map[state];
  const Icon = m.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide ${m.tone}`}
      data-testid={`state-${state}`}
    >
      <Icon className="h-3 w-3" />
      {m.label}
    </span>
  );
}
