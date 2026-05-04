import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ProviderIcon, providerLabel } from "@/components/provider-icon";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Sparkles, GitBranch, Check, ChevronRight, ChevronLeft, Eye, EyeOff,
  ShieldCheck, FlaskConical,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { Project } from "@shared/schema";

type Env = "test" | "demo" | "deploy";

const ENV_DESCRIPTION: Record<Env, string> = {
  test: "Ephemeral, branched per PR. No public traffic. Smoke tests only.",
  demo: "Long-lived, password-protected. For client showcases and walkthroughs.",
  deploy: "Production. Stable domain, full smoke + health checks.",
};

export default function Wizard() {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [step, setStep] = useState(0);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [environment, setEnvironment] = useState<Env>("test");
  const [blueprintSlug, setBlueprintSlug] = useState<string>("next-prisma-neon-vercel");
  const [providers, setProviders] = useState<string[]>(["github", "vercel", "neon", "prisma"]);
  const [revealValues, setRevealValues] = useState(false);
  const [liveMode, setLiveMode] = useState(false);

  const projectsQ = useQuery<Project[]>({ queryKey: ["/api/projects"] });
  const blueprintsQ = useQuery<any[]>({ queryKey: ["/api/blueprints"] });

  const project = useMemo(() => projectsQ.data?.find((p) => p.id === projectId) ?? null, [projectsQ.data, projectId]);
  const blueprint = useMemo(() => blueprintsQ.data?.find((b) => b.slug === blueprintSlug) ?? null, [blueprintsQ.data, blueprintSlug]);

  /* Auto-select blueprint based on project framework */
  useEffect(() => {
    if (!project || !blueprintsQ.data) return;
    const candidate = blueprintsQ.data.find((b) => b.framework === project.framework);
    if (candidate) {
      setBlueprintSlug(candidate.slug);
      setProviders(candidate.providers);
    }
  }, [project?.id, blueprintsQ.data]);

  /* env preview */
  const envPreview = useQuery<any[]>({
    queryKey: ["/api/preview/env", project?.framework, providers.join(",")],
    enabled: !!project,
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/preview/env", {
        framework: project?.framework, providers,
      });
      return res.json();
    },
  });

  /* yaml preview */
  const ciPreview = useQuery<string>({
    queryKey: ["/api/preview/ci", project?.framework, providers.join(",")],
    enabled: !!project,
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/preview/ci", {
        framework: project?.framework, providers,
      });
      return res.text();
    },
  });

  const createRun = useMutation({
    mutationFn: async () => {
      const envVars = (envPreview.data ?? []).map((e) => ({
        key: e.key,
        value: e.source === "generated" ? "dop_•••••••••••••••" : `<from ${e.source}>`,
        source: e.source,
      }));
      const res = await apiRequest("POST", "/api/runs", {
        projectId,
        environment,
        mode: liveMode ? "live" : "dry-run",
        providers,
        envVars,
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/runs"] });
      toast({
        title: "Run created",
        description: `Pipeline queued in ${liveMode ? "LIVE" : "dry-run"} mode. Advance the stages on the run page.`,
      });
      navigate(`/runs/${data.id}`);
    },
  });

  const steps = ["Project", "Environment", "Blueprint", "Providers", "Review"];
  const canNext =
    (step === 0 && !!projectId) ||
    (step === 1 && !!environment) ||
    (step === 2 && !!blueprintSlug) ||
    (step === 3 && providers.length > 0) ||
    step === 4;

  return (
    <PageShell
      eyebrow="Wizard"
      title="New deployment"
      description="Five guided steps. We pre-fill almost everything from the repo and your blueprint."
      actions={
        <div className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-1.5">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Mode</span>
          <Switch
            checked={liveMode}
            onCheckedChange={setLiveMode}
            data-testid="switch-live-mode"
          />
          <span className={cn("text-xs font-mono", liveMode ? "text-primary" : "text-muted-foreground")}>
            {liveMode ? "LIVE" : "DRY-RUN"}
          </span>
        </div>
      }
    >
      {/* Stepper */}
      <ol className="mb-6 flex items-center gap-2 text-xs flex-wrap">
        {steps.map((s, i) => (
          <li key={s} className="flex items-center gap-2">
            <button
              onClick={() => setStep(i)}
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 transition-colors",
                i === step
                  ? "border-primary text-primary bg-primary/10"
                  : i < step
                  ? "border-border text-muted-foreground hover-elevate"
                  : "border-dashed border-border text-muted-foreground/60",
              )}
              data-testid={`step-${i}`}
            >
              <span className="font-mono">{String(i + 1).padStart(2, "0")}</span>
              {s}
            </button>
            {i < steps.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground/50" />}
          </li>
        ))}
      </ol>

      <Card>
        <CardContent className="p-6">
          {step === 0 && (
            <StepProject
              loading={projectsQ.isLoading}
              projects={projectsQ.data ?? []}
              selectedId={projectId}
              onSelect={setProjectId}
            />
          )}
          {step === 1 && <StepEnvironment value={environment} onChange={setEnvironment} />}
          {step === 2 && (
            <StepBlueprint
              loading={blueprintsQ.isLoading}
              blueprints={blueprintsQ.data ?? []}
              selectedSlug={blueprintSlug}
              onSelect={(slug) => {
                setBlueprintSlug(slug);
                const bp = blueprintsQ.data?.find((b) => b.slug === slug);
                if (bp) setProviders(bp.providers);
              }}
            />
          )}
          {step === 3 && (
            <StepProviders
              value={providers}
              onChange={setProviders}
              recommended={blueprint?.providers ?? []}
            />
          )}
          {step === 4 && (
            <StepReview
              project={project}
              environment={environment}
              blueprint={blueprint}
              providers={providers}
              envPreview={envPreview.data ?? []}
              ci={ciPreview.data ?? ""}
              revealValues={revealValues}
              setRevealValues={setRevealValues}
              liveMode={liveMode}
            />
          )}
        </CardContent>
      </Card>

      <div className="mt-4 flex items-center justify-between">
        <Button
          variant="outline"
          disabled={step === 0}
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          data-testid="button-back"
          className="gap-2"
        >
          <ChevronLeft className="h-4 w-4" /> Back
        </Button>

        {step < 4 ? (
          <Button onClick={() => setStep((s) => s + 1)} disabled={!canNext} data-testid="button-next" className="gap-2">
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            onClick={() => createRun.mutate()}
            disabled={!projectId || createRun.isPending}
            className="gap-2"
            data-testid="button-run"
          >
            {createRun.isPending ? "Queueing…" : (liveMode ? <>Run live <Sparkles className="h-4 w-4" /></> : <>Run dry-run <FlaskConical className="h-4 w-4" /></>)}
          </Button>
        )}
      </div>
    </PageShell>
  );
}

function StepProject({
  loading, projects, selectedId, onSelect,
}: { loading: boolean; projects: Project[]; selectedId: number | null; onSelect: (id: number) => void }) {
  return (
    <div>
      <CardHeader className="px-0 pt-0">
        <CardTitle className="text-sm">Step 1 — pick a repository</CardTitle>
      </CardHeader>
      <p className="text-sm text-muted-foreground mb-4">
        These are repos already imported into the workspace. Use <code className="font-mono text-foreground">gh repo list</code> in the sandbox to add more.
      </p>
      {loading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {projects.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => onSelect(p.id)}
                className={cn(
                  "w-full text-left rounded-lg border p-4 transition-colors",
                  selectedId === p.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover-elevate",
                )}
                data-testid={`option-project-${p.id}`}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="font-medium">{p.name}</div>
                  {selectedId === p.id && <Check className="h-4 w-4 text-primary" />}
                </div>
                <div className="text-[11px] font-mono text-muted-foreground inline-flex items-center gap-1">
                  <GitBranch className="h-3 w-3" /> {p.repo}
                </div>
                <div className="mt-3 flex gap-1.5 flex-wrap">
                  <Badge variant="outline" className="text-[10px] font-mono">{p.framework}</Badge>
                  {p.needsDatabase && <Badge variant="outline" className="text-[10px] font-mono">database</Badge>}
                  {p.ormDetected && <Badge variant="outline" className="text-[10px] font-mono">{p.ormDetected}</Badge>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6 rounded-md border border-dashed border-border bg-card/40 p-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-2 mb-1 text-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-primary" /> Auto-detect summary
        </div>
        We read <code className="font-mono">package.json</code>, <code className="font-mono">prisma/schema.prisma</code>, and <code className="font-mono">.env.example</code> via <code className="font-mono">gh</code> CLI, then suggest a build command, output dir, and required env vars. You can override anything in step 5.
      </div>
    </div>
  );
}

function StepEnvironment({ value, onChange }: { value: Env; onChange: (e: Env) => void }) {
  return (
    <div>
      <CardHeader className="px-0 pt-0">
        <CardTitle className="text-sm">Step 2 — target environment</CardTitle>
      </CardHeader>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {(["test", "demo", "deploy"] as Env[]).map((env) => (
          <button
            key={env}
            onClick={() => onChange(env)}
            className={cn(
              "rounded-lg border p-4 text-left transition-colors",
              value === env ? "border-primary bg-primary/5" : "border-border hover-elevate",
            )}
            data-testid={`option-env-${env}`}
          >
            <div className="flex items-center justify-between mb-1">
              <div className="text-sm font-semibold uppercase tracking-wide">{env}</div>
              {value === env && <Check className="h-4 w-4 text-primary" />}
            </div>
            <p className="text-xs text-muted-foreground">{ENV_DESCRIPTION[env]}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

function StepBlueprint({
  loading, blueprints, selectedSlug, onSelect,
}: { loading: boolean; blueprints: any[]; selectedSlug: string; onSelect: (s: string) => void }) {
  return (
    <div>
      <CardHeader className="px-0 pt-0">
        <CardTitle className="text-sm">Step 3 — choose a blueprint</CardTitle>
      </CardHeader>
      <p className="text-sm text-muted-foreground mb-4">
        Blueprints are pre-wired stacks. Pick one to skip provider configuration entirely — every default is editable.
      </p>
      {loading ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {blueprints.map((b) => (
            <li key={b.slug}>
              <button
                onClick={() => onSelect(b.slug)}
                className={cn(
                  "w-full text-left rounded-lg border p-4 transition-colors",
                  selectedSlug === b.slug ? "border-primary bg-primary/5" : "border-border hover-elevate",
                )}
                data-testid={`option-blueprint-${b.slug}`}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="font-medium">{b.name}</div>
                  <div className="flex items-center gap-2">
                    {b.recommended && <Badge variant="outline" className="text-[10px]">recommended</Badge>}
                    {selectedSlug === b.slug && <Check className="h-4 w-4 text-primary" />}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">{b.tagline}</p>
                <div className="mt-3 flex gap-1.5 flex-wrap">
                  {b.providers.map((p: string) => (
                    <Badge key={p} variant="outline" className="text-[10px] font-mono inline-flex items-center gap-1">
                      <ProviderIcon provider={p} className="h-3 w-3" /> {providerLabel(p)}
                    </Badge>
                  ))}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StepProviders({
  value, onChange, recommended,
}: { value: string[]; onChange: (v: string[]) => void; recommended: string[] }) {
  const all = ["github", "vercel", "neon", "prisma", "railway"];
  return (
    <div>
      <CardHeader className="px-0 pt-0">
        <CardTitle className="text-sm">Step 4 — providers</CardTitle>
      </CardHeader>
      <p className="text-sm text-muted-foreground mb-4">
        We pre-selected the providers your blueprint needs. Toggle any optional provider on or off.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {all.map((p) => {
          const on = value.includes(p);
          const isRecommended = recommended.includes(p);
          return (
            <label
              key={p}
              className={cn(
                "flex items-center justify-between rounded-lg border p-4 cursor-pointer",
                on ? "border-primary/60 bg-primary/5" : "border-border hover-elevate",
              )}
              data-testid={`provider-option-${p}`}
            >
              <div className="flex items-center gap-3">
                <ProviderIcon provider={p} className="h-5 w-5 text-foreground/80" />
                <div>
                  <div className="text-sm font-medium">{providerLabel(p)}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {p === "railway" ? "Optional. Manual CLI fallback." : isRecommended ? "Recommended for this blueprint." : "Optional"}
                  </div>
                </div>
              </div>
              <Switch
                checked={on}
                onCheckedChange={(checked) => {
                  if (checked) onChange([...new Set([...value, p])]);
                  else onChange(value.filter((x) => x !== p));
                }}
                data-testid={`switch-provider-${p}`}
              />
            </label>
          );
        })}
      </div>
    </div>
  );
}

function StepReview({
  project, environment, blueprint, providers, envPreview, ci,
  revealValues, setRevealValues, liveMode,
}: any) {
  return (
    <div className="space-y-6">
      <CardHeader className="px-0 pt-0">
        <CardTitle className="text-sm">Step 5 — review automation plan</CardTitle>
      </CardHeader>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="space-y-2 lg:col-span-1">
          <KV k="Project" v={project?.name ?? "—"} />
          <KV k="Repo" v={project?.repo ?? "—"} mono />
          <KV k="Environment" v={environment} mono upper />
          <KV k="Blueprint" v={blueprint?.name ?? "—"} />
          <KV k="Build cmd" v={project?.buildCommand ?? "—"} mono />
          <KV k="Output dir" v={project?.outputDir ?? "—"} mono />
          <KV k="Mode" v={liveMode ? "LIVE" : "DRY-RUN"} mono />
        </div>

        <div className="lg:col-span-2">
          <Tabs defaultValue="env">
            <TabsList>
              <TabsTrigger value="env" data-testid="tab-env">Env vars</TabsTrigger>
              <TabsTrigger value="ci" data-testid="tab-ci">CI workflow</TabsTrigger>
              <TabsTrigger value="checks" data-testid="tab-checks">Pre-flight</TabsTrigger>
            </TabsList>

            <TabsContent value="env" className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs text-muted-foreground">Resolved env vars · sources marked</div>
                <Button variant="ghost" size="sm" onClick={() => setRevealValues((x: boolean) => !x)} data-testid="button-reveal" className="gap-1 h-7">
                  {revealValues ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  {revealValues ? "Hide" : "Reveal"}
                </Button>
              </div>
              <div className="rounded-md border border-border overflow-hidden">
                <table className="w-full text-xs font-mono">
                  <thead className="bg-muted/40">
                    <tr className="text-left">
                      <th className="px-3 py-2">Key</th>
                      <th className="px-3 py-2">Source</th>
                      <th className="px-3 py-2">Value</th>
                      <th className="px-3 py-2">Required</th>
                    </tr>
                  </thead>
                  <tbody>
                    {envPreview.map((e: any) => (
                      <tr key={e.key} className="border-t border-border" data-testid={`row-env-${e.key}`}>
                        <td className="px-3 py-2">{e.key}</td>
                        <td className="px-3 py-2">
                          <Badge variant="outline" className="text-[10px]">{e.source}</Badge>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {revealValues ? `<from ${e.source}>` : "•••••••••••••"}
                        </td>
                        <td className="px-3 py-2">{e.required ? "yes" : "—"}</td>
                      </tr>
                    ))}
                    {envPreview.length === 0 && (
                      <tr><td className="px-3 py-3 text-muted-foreground" colSpan={4}>No env vars required.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </TabsContent>

            <TabsContent value="ci" className="mt-4">
              <div className="rounded-md border border-border overflow-hidden">
                <div className="flex items-center justify-between bg-muted/40 px-3 py-2 text-xs font-mono">
                  <span>.github/workflows/deployops.yml</span>
                  <Badge variant="outline" className="text-[10px]">generated</Badge>
                </div>
                <pre className="p-3 text-[11px] leading-relaxed font-mono overflow-x-auto bg-card text-foreground/90 max-h-80">
{ci || "Loading…"}
                </pre>
              </div>
            </TabsContent>

            <TabsContent value="checks" className="mt-4 space-y-2">
              <Check_ ok label="GitHub repo accessible (gh auth)" />
              <Check_ ok={providers.includes("vercel")} label="Vercel project link · npx vercel link" />
              <Check_ ok={providers.includes("neon")} label="Neon Postgres · branch per environment" />
              <Check_ ok={providers.includes("prisma")} label="Prisma management API · regions resolved" />
              <Check_ ok={!providers.includes("railway")} optional label="Railway · manual CLI fallback only" />
              <Check_ ok={!liveMode} label="Mode is DRY-RUN — no provider mutations will occur." />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

function KV({ k, v, mono, upper }: { k: string; v: string; mono?: boolean; upper?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 bg-card/40">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{k}</span>
      <span className={cn("text-xs", mono && "font-mono", upper && "uppercase")}>{v}</span>
    </div>
  );
}

function Check_({ ok, label, optional }: { ok: boolean; label: string; optional?: boolean }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={cn(
        "inline-flex h-5 w-5 items-center justify-center rounded-full",
        ok ? "bg-emerald-500/15 text-emerald-500" : optional ? "bg-muted text-muted-foreground" : "bg-amber-500/15 text-amber-500",
      )}>
        {ok ? <Check className="h-3 w-3" /> : "!"}
      </span>
      <span className={cn("text-muted-foreground", ok && "text-foreground")}>{label}</span>
    </div>
  );
}
