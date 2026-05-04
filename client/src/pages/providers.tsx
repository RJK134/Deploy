import { useQuery, useMutation } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/status-pill";
import { ProviderIcon, providerLabel } from "@/components/provider-icon";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Provider } from "@shared/schema";
import { Code2, ShieldAlert } from "lucide-react";

const INSTRUCTIONS: Record<string, { title: string; steps: string[]; commands: string[] }> = {
  github: {
    title: "GitHub",
    steps: [
      "Already authorised in this workspace via the GitHub connector.",
      "Server-side commands run with bash api_credentials=[\"github\"].",
      "DeployOps reads repos, opens PRs, and triggers workflows. Live writes require flipping the mode switch.",
    ],
    commands: [
      "gh repo view org/repo --json defaultBranchRef,visibility",
      "gh pr create --base main --head deployops/setup --title 'DeployOps: add CI workflow'",
    ],
  },
  vercel: {
    title: "Vercel",
    steps: [
      "Connector exposes the Vercel CLI. We never expose VERCEL_TOKEN to the client.",
      "Project linking is idempotent — DeployOps will reuse an existing project if it matches.",
      "Live deploys disabled until you flip the per-provider mode switch.",
    ],
    commands: [
      "npx vercel link --yes --project marketing-site",
      "npx vercel env add DATABASE_URL preview",
      "npx vercel deploy --prebuilt",
    ],
  },
  neon: {
    title: "Neon Postgres",
    steps: [
      "Connected through the Pipedream Neon connector.",
      "Useful tools: execute-custom-query, find-row-custom-query, insert-row.",
      "Branching strategy: create one Postgres branch per environment from `main`.",
    ],
    commands: [
      "execute-custom-query { sql: \"SELECT version();\" }",
      "insert-row { schema: \"public\", table: \"deploy_log\", rowValues: { ... } }",
    ],
  },
  prisma: {
    title: "Prisma Postgres (Management API)",
    steps: [
      "Connector tools: list_projects, create_database, create_database_in_existing_project, create_database_connection_string, list_connection_strings, get_postgres_regions.",
      "Use one Prisma project per workspace, one database per environment.",
      "Connection strings are created per environment and rotated on demand.",
    ],
    commands: [
      "list_projects {}",
      "create_database_in_existing_project { projectId: \"prj_xxx\", region: \"us-east-1\", isDefault: false }",
      "create_database_connection_string { databaseId: \"db_xxx\", name: \"app\" }",
    ],
  },
  railway: {
    title: "Railway (manual fallback)",
    steps: [
      "No managed connector available. Provide a Railway API token in workspace secrets to enable.",
      "DeployOps will surface the exact CLI sequence to run from the sandbox terminal.",
      "Until then, Railway-bound stages remain manual.",
    ],
    commands: [
      "RAILWAY_TOKEN=•••• npx @railway/cli link",
      "RAILWAY_TOKEN=•••• npx @railway/cli up --service api-gateway-test",
    ],
  },
};

export default function Providers() {
  const providers = useQuery<Provider[]>({ queryKey: ["/api/providers"] });
  const { toast } = useToast();

  const setMode = useMutation({
    mutationFn: async ({ key, mode }: { key: string; mode: "live" | "dry-run" }) => {
      const res = await apiRequest("POST", `/api/providers/${key}/mode`, { mode });
      return res.json();
    },
    onSuccess: (p, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/providers"] });
      toast({
        title: `${providerLabel(vars.key)} → ${vars.mode}`,
        description: vars.mode === "live"
          ? "Live mode enabled — actual provider calls are now permitted from the orchestrator."
          : "Dry-run restored. Provider mutations disabled.",
      });
    },
  });

  return (
    <PageShell
      eyebrow="Operations"
      title="Providers"
      description="Connection state for every external service DeployOps can drive. Toggle a provider into live mode only when you're ready to run real commands."
    >
      {providers.isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-48 w-full" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {providers.data?.map((p) => {
            const meta = INSTRUCTIONS[p.key] ?? { title: p.name, steps: [], commands: [] };
            return (
              <Card key={p.key} data-testid={`provider-${p.key}`}>
                <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
                  <div>
                    <CardTitle className="text-sm flex items-center gap-2">
                      <ProviderIcon provider={p.key} className="h-4 w-4" /> {meta.title}
                    </CardTitle>
                    <div className="mt-1 flex items-center gap-2">
                      <StatusPill status={p.status as any} />
                      <Badge variant="outline" className="font-mono text-[10px]">{p.mode}</Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Live</span>
                    <Switch
                      checked={p.mode === "live"}
                      disabled={p.status !== "connected"}
                      onCheckedChange={(checked) => setMode.mutate({ key: p.key, mode: checked ? "live" : "dry-run" })}
                      data-testid={`switch-mode-${p.key}`}
                    />
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-xs text-muted-foreground">{p.notes}</p>

                  {meta.steps.length > 0 && (
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">How DeployOps uses this</div>
                      <ul className="space-y-1.5 text-xs">
                        {meta.steps.map((s, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-primary/70 shrink-0" />
                            <span className="text-foreground/90">{s}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {meta.commands.length > 0 && (
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 inline-flex items-center gap-1">
                        <Code2 className="h-3 w-3" /> Server-side invocation
                      </div>
                      <pre className="rounded-md border border-border bg-[#0c1220] dark:bg-[#06090f] text-[#cdd6e0] p-3 text-[11px] font-mono overflow-x-auto">
{meta.commands.map((c) => `$ ${c}`).join("\n")}
                      </pre>
                    </div>
                  )}

                  {p.status !== "connected" && (
                    <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                      <ShieldAlert className="h-3.5 w-3.5" />
                      No managed connector. Add credentials in workspace settings to enable live actions.
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}
