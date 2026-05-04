import { useQuery, useMutation } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Globe2, Lock, Users, Copy, Check } from "lucide-react";
import { useState } from "react";
import type { Project } from "@shared/schema";

const ACCESS_MODES = [
  { key: "public",  icon: Globe2, label: "Public",  blurb: "Anyone with the URL can view. No login. Best for marketing or open content." },
  { key: "client",  icon: Users,  label: "Client",  blurb: "Password-protected demo. Magic-link invites. Best for client showcases." },
  { key: "private", icon: Lock,   label: "Private", blurb: "Only invited team members. SSO recommended. Best for internal tools." },
];

export default function Access() {
  const projects = useQuery<Project[]>({ queryKey: ["/api/projects"] });

  return (
    <PageShell
      eyebrow="Operations"
      title="Access & domains"
      description="Decide who can reach each environment. Public for traffic. Client for demos. Private for staff."
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
                  <ProjectAccessRow project={p} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* invitation checklist */}
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

function ProjectAccessRow({ project }: { project: Project }) {
  const [copied, setCopied] = useState<string | null>(null);
  const update = useMutation({
    mutationFn: async (mode: string) => {
      const res = await apiRequest("PATCH", `/api/projects/${project.id}`, { accessMode: mode });
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/projects"] }),
  });

  const urls = {
    test: `https://${project.name}-test.vercel.app`,
    demo: `https://${project.name}-demo.vercel.app`,
    deploy: `https://${project.name}.app`,
  } as const;

  function copy(env: keyof typeof urls) {
    navigator.clipboard.writeText(urls[env]).catch(() => {});
    setCopied(env);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium">{project.name}</div>
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
        {(["test", "demo", "deploy"] as const).map((env) => (
          <div key={env} className="flex items-center gap-2 rounded-md border border-border bg-card/40 px-3 py-2">
            <Badge variant="outline" className="font-mono text-[10px] uppercase">{env}</Badge>
            <code className="text-[11px] font-mono truncate flex-1">{urls[env]}</code>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => copy(env)} data-testid={`button-copy-${project.id}-${env}`}>
              {copied === env ? <Check className="h-3 w-3 text-primary" /> : <Copy className="h-3 w-3" />}
            </Button>
          </div>
        ))}
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
