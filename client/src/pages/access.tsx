import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Globe2, Lock, Users, Copy, Check, ExternalLink, ArrowRight } from "lucide-react";
import { useState } from "react";
import type { Project } from "@shared/schema";

const ACCESS_MODES = [
  { key: "public",  icon: Globe2, label: "Public",  blurb: "Anyone with the URL can view. No login. Best for marketing or open content." },
  { key: "client",  icon: Users,  label: "Client",  blurb: "Password-protected demo. Magic-link invites. Best for client showcases." },
  { key: "private", icon: Lock,   label: "Private", blurb: "Only invited team members. SSO recommended. Best for internal tools." },
];

type EnvKey = "test" | "demo" | "deploy";

interface ProjectListEntry {
  id: number;
  name: string;
  repo: string;
  framework: string;
  accessMode: string;
  sourceBranch: string | null;
  sourceDefaultBranch: string | null;
  states: Record<EnvKey, string>;
  urls: Record<EnvKey, string | null>;
  latestRunIds: Record<EnvKey, number | null>;
  lastUpdated: number;
}

const ENV_LABELS: Record<EnvKey, string> = {
  test: "Test",
  demo: "Demo / Run",
  deploy: "Production",
};

export default function Access() {
  const projects = useQuery<Project[]>({ queryKey: ["/api/projects"] });
  const dashboard = useQuery<{ ok: boolean; projects: ProjectListEntry[] }>({
    queryKey: ["/api/projects-dashboard"],
  });

  const dashByProjectId = new Map<number, ProjectListEntry>(
    (dashboard.data?.projects ?? []).map((p) => [p.id, p]),
  );

  return (
    <PageShell
      eyebrow="Operations"
      title="Access & domains"
      description="Decide who can reach each environment. Public for traffic. Client for demos. Private for staff. Real share links appear only after a successful live deployment."
    >
      {/* legend */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        {ACCESS_MODES.map(({ key, icon: Icon, label, blurb }) => (
          <Card key={key} data-testid={`legend-${key}`}>
            <CardContent className="py-4">
              <div className="flex items-center gap-2 text-sm font-semibold mb-1">
                <Icon className="h-4 w-4 text-primary" /> {label}
              </div>
              <p className="text-xs text-muted-foreground">{blurb}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Project access</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {projects.isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : (
            <ul>
              {projects.data?.map((p) => (
                <li key={p.id} className="border-t border-border first:border-t-0 px-4 py-4" data-testid={`row-access-${p.id}`}>
                  <ProjectAccessRow project={p} dashboardEntry={dashByProjectId.get(p.id)} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Authorization checklist</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="text-xs space-y-2">
            <Step done label="GitHub: collaborator role added or org membership confirmed." />
            <Step done label="Vercel: project transferred to the workspace team scope." />
            <Step label="DNS: CNAME for the demo subdomain pointing to cname.vercel-dns.com." />
            <Step label="Demo password rotated for the upcoming environment." />
            <Step label="Smoke test executed on the demo URL." />
          </ul>
        </CardContent>
      </Card>
    </PageShell>
  );
}

function ProjectAccessRow({ project, dashboardEntry }: { project: Project; dashboardEntry?: ProjectListEntry }) {
  const [copied, setCopied] = useState<string | null>(null);
  const update = useMutation({
    mutationFn: async (mode: string) => {
      const res = await apiRequest("PATCH", `/api/projects/${project.id}`, { accessMode: mode });
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/projects"] }),
  });

  function copy(url: string, key: string) {
    navigator.clipboard.writeText(url).catch(() => {});
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href={`/projects/${project.id}`} className="text-sm font-medium hover:underline" data-testid={`link-access-project-${project.id}`}>
            {project.name}
          </Link>
          <div className="text-[11px] font-mono text-muted-foreground">{project.repo}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Access</span>
          <div className="inline-flex rounded-md border border-border overflow-hidden">
            {ACCESS_MODES.map((m) => {
              const active = project.accessMode === m.key;
              return (
                <button
                  key={m.key}
                  onClick={() => update.mutate(m.key)}
                  className={`px-3 py-1.5 text-xs ${active ? "bg-primary/15 text-primary" : "text-muted-foreground hover-elevate"}`}
                  data-testid={`access-${project.id}-${m.key}`}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {(["test", "demo", "deploy"] as EnvKey[]).map((env) => {
          const url = dashboardEntry?.urls[env] ?? null;
          const state = dashboardEntry?.states[env] ?? "not_configured";
          const key = `${project.id}-${env}`;
          return (
            <div key={env} className="flex items-center gap-2 rounded-md border border-border bg-card/40 px-3 py-2" data-testid={`access-env-${project.id}-${env}`}>
              <Badge variant="outline" className="font-mono text-[10px] uppercase shrink-0">{ENV_LABELS[env]}</Badge>
              {url ? (
                <>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] font-mono truncate flex-1 text-primary hover:underline inline-flex items-center gap-1"
                    title={url}
                    data-testid={`access-url-${project.id}-${env}`}
                  >
                    <ExternalLink className="h-3 w-3 shrink-0" />
                    <span className="truncate">{url.replace(/^https?:\/\//, "")}</span>
                  </a>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => copy(url, key)} data-testid={`button-copy-${project.id}-${env}`}>
                    {copied === key ? <Check className="h-3 w-3 text-primary" /> : <Copy className="h-3 w-3" />}
                  </Button>
                </>
              ) : (
                <span className="text-[11px] text-muted-foreground italic flex-1" data-testid={`access-no-url-${project.id}-${env}`}>
                  no real URL · {state.replace(/_/g, " ")}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div>
        <Link
          href={`/projects/${project.id}`}
          className="text-[11px] text-primary hover:underline inline-flex items-center gap-1"
          data-testid={`link-access-dashboard-${project.id}`}
        >
          Open project dashboard <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}

function Step({ done, label }: { done?: boolean; label: string }) {
  return (
    <li className="flex items-start gap-2">
      <span className={`mt-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full border ${done ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-500" : "border-border text-muted-foreground"}`}>
        {done ? <Check className="h-2.5 w-2.5" /> : <span className="block h-1 w-1 rounded-full bg-current" />}
      </span>
      <span className={done ? "" : "text-muted-foreground"}>{label}</span>
    </li>
  );
}
