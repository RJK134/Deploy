import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ProviderIcon, providerLabel } from "@/components/provider-icon";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Sparkles, Check, ChevronRight, ChevronLeft, Eye, EyeOff,
  FlaskConical, AlertTriangle, ExternalLink, ShieldAlert,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  GithubRepoPicker, type GhRepoSummary, type DetectionResult,
} from "@/components/github-repo-picker";

type Env = "test" | "demo" | "deploy";

const ENV_DESCRIPTION: Record<Env, string> = {
  test: "Ephemeral, branched per PR. No public traffic. Smoke tests only.",
  demo: "Long-lived, password-protected. For client showcases and walkthroughs.",
  deploy: "Production. Stable domain, full smoke + health checks.",
};

interface DetectionExtras {
  detection: DetectionResult;
  framework: string;
  buildCommand: string;
  outputDir: string;
  needsDatabase: boolean;
  ormDetected: string | null;
  envExample: string[];
  blueprintSlug: string | null;
  recommendedProviders: string[];
}

function deriveExtras(d: DetectionResult): DetectionExtras {
  const fwMap: Record<string, string> = {
    "nextjs": "nextjs", "vite-react": "static", "react": "static", "static": "static",
    "node": "node", "express": "node", "astro": "astro", "svelte": "static",
    "fastapi": "node", "python": "node", "unknown": "node",
  };
  return {
    detection: d,
    framework: fwMap[d.framework] ?? "node",
    buildCommand: d.buildCommand ?? (d.framework === "nextjs" ? "next build" : "npm run build"),
    outputDir: d.outputDir ?? (d.framework === "nextjs" ? ".next" : "dist"),
    needsDatabase: d.prisma.present || d.recommendedProviders.includes("neon"),
    ormDetected: d.prisma.present ? "prisma" : null,
    envExample: d.envSuggestions,
    blueprintSlug: d.blueprintRecommendation,
    recommendedProviders: d.recommendedProviders,
  };
}

export default function Wizard() {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [step, setStep] = useState(0);
  const [selectedRepo, setSelectedRepo] = useState<GhRepoSummary | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [detection, setDetection] = useState<DetectionResult | null>(null);

  const [environment, setEnvironment] = useState<Env>("test");
  const [blueprintSlug, setBlueprintSlug] = useState<string>("next-prisma-neon-vercel");
  const [providers, setProviders] = useState<string[]>(["github", "vercel", "neon", "prisma"]);
  const [revealValues, setRevealValues] = useState(false);
  const [liveMode, setLiveMode] = useState(false);

  const blueprintsQ = useQuery<any[]>({ queryKey: ["/api/blueprints"] });

  const extras = useMemo<DetectionExtras | null>(
    () => (detection ? deriveExtras(detection) : null),
    [detection],
  );

  const blueprint = useMemo(
    () => blueprintsQ.data?.find((b) => b.slug === blueprintSlug) ?? null,
    [blueprintsQ.data, blueprintSlug],
  );

  /* When detection arrives, pre-populate blueprint + providers from detection. */
  useEffect(() => {
    if (!extras || !blueprintsQ.data) return;
    if (extras.blueprintSlug) {
      const candidate = blueprintsQ.data.find((b) => b.slug === extras.blueprintSlug);
      if (candidate) {
        setBlueprintSlug(candidate.slug);
        setProviders(candidate.providers);
        return;
      }
    }
    const byFw = blueprintsQ.data.find((b) => b.framework === extras.framework);
    if (byFw) {
      setBlueprintSlug(byFw.slug);
      setProviders(byFw.providers);
    } else if (extras.recommendedProviders.length > 0) {
      setProviders(extras.recommendedProviders);
    }
  }, [extras, blueprintsQ.data]);

  /* When repo changes default branch, pre-set the branch. */
  useEffect(() => {
    if (selectedRepo && !selectedBranch) setSelectedBranch(selectedRepo.defaultBranch);
  }, [selectedRepo, selectedBranch]);

  /* env preview — works with or without a project (uses framework + providers). */
  const envPreview = useQuery<any[]>({
    queryKey: ["/api/preview/env", extras?.framework, providers.join(",")],
    enabled: !!extras,
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/preview/env", {
        framework: extras?.framework, providers,
      });
      return res.json();
    },
  });

  const ciPreview = useQuery<string>({
    queryKey: ["/api/preview/ci", extras?.framework, providers.join(",")],
    enabled: !!extras,
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/preview/ci", {
        framework: extras?.framework, providers,
      });
      return res.text();
    },
  });

  /**
   * Live readiness preflight. Runs only when the user opts into live mode +
   * has a real GitHub repo selected. Hits the read-only readiness endpoint
   * so we can render the blocker list before the user clicks Run live.
   */
  const livePreflight = useQuery<any>({
    queryKey: ["/api/live/vercel/preflight", selectedRepo?.fullName, selectedBranch],
    enabled: !!liveMode && !!selectedRepo && !!selectedBranch && providers.includes("vercel"),
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/live/vercel/preflight?repo=${encodeURIComponent(selectedRepo!.fullName)}&branch=${encodeURIComponent(selectedBranch!)}&name=${encodeURIComponent(selectedRepo!.name)}`,
      );
      return res.json();
    },
    refetchInterval: false,
  });

  /* Project name derives from repo name. */
  const projectName = selectedRepo?.name ?? "—";

  const createRun = useMutation({
    mutationFn: async () => {
      if (!selectedRepo || !selectedBranch || !extras) throw new Error("repo + branch required");
      /* persist a project from the live repo selection. */
      const projectBody = {
        name: selectedRepo.name,
        repo: selectedRepo.fullName,
        framework: extras.framework,
        buildCommand: extras.buildCommand,
        outputDir: extras.outputDir,
        rootDir: ".",
        needsDatabase: extras.needsDatabase,
        ormDetected: extras.ormDetected,
        envExample: extras.envExample,
        accessMode: "private",
        sourceProvider: "github",
        sourceBranch: selectedBranch,
        sourceUrl: selectedRepo.url,
        sourceDefaultBranch: selectedRepo.defaultBranch,
        sourceVisibility: selectedRepo.private ? "private" : "public",
        sourceLanguage: selectedRepo.language ?? null,
        sourceUpdatedAt: selectedRepo.updatedAt ? new Date(selectedRepo.updatedAt).getTime() : null,
        detectedConfig: extras.detection,
      };
      const projRes = await apiRequest("POST", "/api/projects", projectBody);
      const project = await projRes.json();

      const envVars = (envPreview.data ?? []).map((e: any) => ({
        key: e.key,
        value: e.source === "generated" ? "dop_•••••••••••••••" : `<from ${e.source}>`,
        source: e.source,
      }));
      const res = await apiRequest("POST", "/api/runs", {
        projectId: project.id,
        environment,
        mode: liveMode ? "live" : "dry-run",
        providers,
        envVars,
      });
      const runResp = await res.json();
      /* Live runs require an explicit start-live POST to actually contact
       * Vercel. The wizard does NOT trigger that automatically — the user
       * confirms on the run detail page. This keeps the wizard's Run
       * button safely non-mutating from the provider's POV. */
      return runResp;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/runs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({
        title: liveMode ? "Live run created — confirm on the run page" : "Dry-run plan created",
        description: liveMode
          ? "Run is queued in LIVE mode. Open the run page and click 'Start live deployment' to actually contact Vercel."
          : "Pipeline queued in dry-run mode. Advance stages to see the plan.",
      });
      navigate(`/runs/${data.id}`);
    },
    onError: (err: any) => {
      toast({
        title: "Could not start run",
        description: String(err?.message ?? err),
        variant: "destructive",
      });
    },
  });

  const steps = ["Repository", "Environment", "Blueprint", "Providers", "Review"];
  const canNext =
    (step === 0 && !!selectedRepo && !!selectedBranch && !!detection) ||
    (step === 1 && !!environment) ||
    (step === 2 && !!blueprintSlug) ||
    (step === 3 && providers.length > 0) ||
    step === 4;

  return (
    <PageShell
      eyebrow="Wizard"
      title="New deployment"
      description="Five guided steps. We pre-fill almost everything from the live repo and your blueprint."
      actions={
        <div className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-1.5">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Mode</span>
          <Switch
            checked={liveMode}
            onCheckedChange={setLiveMode}
            data-testid="switch-live-mode"
          />
          <span className={cn("text-xs font-mono", liveMode ? "text-primary" : "text-muted-foreground")}>
            {liveMode ? "LIVE DEPLOY" : "DRY-RUN PLAN"}
          </span>
        </div>
      }
    >
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
            <StepRepository
              selectedRepo={selectedRepo}
              selectedBranch={selectedBranch}
              onSelectRepo={(r) => {
                setSelectedRepo(r);
                setSelectedBranch(r.defaultBranch);
                setDetection(null);
              }}
              onSelectBranch={(b) => { setSelectedBranch(b); setDetection(null); }}
              onDetected={setDetection}
            />
          )}
          {step === 1 && <StepEnvironment value={environment} onChange={setEnvironment} />}
          {step === 2 && (
            <StepBlueprint
              loading={blueprintsQ.isLoading}
              blueprints={blueprintsQ.data ?? []}
              selectedSlug={blueprintSlug}
              recommended={extras?.blueprintSlug ?? null}
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
              recommended={blueprint?.providers ?? extras?.recommendedProviders ?? []}
            />
          )}
          {step === 4 && (
            <StepReview
              projectName={projectName}
              repoFullName={selectedRepo?.fullName ?? "—"}
              branch={selectedBranch ?? "—"}
              extras={extras}
              environment={environment}
              blueprint={blueprint}
              providers={providers}
              envPreview={envPreview.data ?? []}
              ci={ciPreview.data ?? ""}
              revealValues={revealValues}
              setRevealValues={setRevealValues}
              liveMode={liveMode}
              setLiveMode={setLiveMode}
              livePreflight={livePreflight.data ?? null}
              livePreflightLoading={livePreflight.isLoading}
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
            disabled={!selectedRepo || !selectedBranch || !detection || createRun.isPending}
            className="gap-2"
            data-testid="button-run"
          >
            {createRun.isPending
              ? "Queueing…"
              : liveMode
                ? <>Queue live run <Sparkles className="h-4 w-4" /></>
                : <>Run dry-run plan <FlaskConical className="h-4 w-4" /></>}
          </Button>
        )}
      </div>
    </PageShell>
  );
}

function StepRepository({
  selectedRepo, selectedBranch, onSelectRepo, onSelectBranch, onDetected,
}: {
  selectedRepo: GhRepoSummary | null;
  selectedBranch: string | null;
  onSelectRepo: (r: GhRepoSummary) => void;
  onSelectBranch: (b: string) => void;
  onDetected: (d: DetectionResult | null) => void;
}) {
  return (
    <div>
      <CardHeader className="px-0 pt-0">
        <CardTitle className="text-sm">Step 1 — choose a live GitHub repository</CardTitle>
      </CardHeader>
      <p className="text-sm text-muted-foreground mb-4">
        Pulled live from <code className="font-mono text-foreground">/user/repos</code> via the authenticated <code className="font-mono text-foreground">gh</code> CLI.
        Your token never leaves the server. After you pick a branch, we'll inspect the repo and pre-fill build, providers, and env vars.
      </p>
      <GithubRepoPicker
        selectedRepoFullName={selectedRepo?.fullName ?? null}
        selectedBranch={selectedBranch}
        onSelectRepo={onSelectRepo}
        onSelectBranch={onSelectBranch}
        onDetected={onDetected}
      />
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
  loading, blueprints, selectedSlug, recommended, onSelect,
}: {
  loading: boolean; blueprints: any[]; selectedSlug: string;
  recommended: string | null; onSelect: (s: string) => void;
}) {
  return (
    <div>
      <CardHeader className="px-0 pt-0">
        <CardTitle className="text-sm">Step 3 — choose a blueprint</CardTitle>
      </CardHeader>
      <p className="text-sm text-muted-foreground mb-4">
        Blueprints are pre-wired stacks. {recommended && <>We've highlighted the one that matches your repo's framework.</>}
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
                    {recommended === b.slug && <Badge className="text-[10px]" data-testid={`badge-detected-${b.slug}`}>auto-detected</Badge>}
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
        We pre-selected the providers your blueprint and detected stack need. Toggle any optional provider on or off.
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
                    {p === "railway" ? "Optional. Manual CLI fallback." : isRecommended ? "Recommended for this stack." : "Optional"}
                  </div>
                </div>
              </div>
              <Switch
                checked={on}
                onCheckedChange={(checked) => {
                  if (checked) onChange(Array.from(new Set([...value, p])));
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
  projectName, repoFullName, branch, extras, environment, blueprint, providers,
  envPreview, ci, revealValues, setRevealValues, liveMode, setLiveMode,
  livePreflight, livePreflightLoading,
}: any) {
  const blockers: Array<{ code: string; message: string; remediation: string }> =
    Array.isArray(livePreflight?.blockers) ? livePreflight.blockers : [];
  const liveReady = !!livePreflight?.ready;
  const matched = livePreflight?.matchedProject ?? null;
  return (
    <div className="space-y-6">
      <CardHeader className="px-0 pt-0">
        <CardTitle className="text-sm">Step 5 — review automation plan</CardTitle>
      </CardHeader>

      {/* Mode selector — prominent and unambiguous. Dry-run is the default. */}
      <div className="rounded-lg border border-border bg-card/40 p-4">
        <div className="flex items-start gap-4">
          <button
            onClick={() => setLiveMode?.(false)}
            className={cn(
              "flex-1 rounded-lg border p-4 text-left transition-colors",
              !liveMode ? "border-primary bg-primary/5" : "border-border hover-elevate",
            )}
            data-testid="option-mode-dry-run"
          >
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <FlaskConical className="h-4 w-4" />
                <span className="text-sm font-semibold">Dry-run plan</span>
              </div>
              {!liveMode && <Check className="h-4 w-4 text-primary" />}
            </div>
            <p className="text-xs text-muted-foreground">
              Validates the plan against your repo. <strong>No provider mutations, no Vercel deployment.</strong>
              Final state is <code className="font-mono">validated_dry_run</code> — never <code className="font-mono">succeeded</code>.
            </p>
          </button>
          <button
            onClick={() => setLiveMode?.(true)}
            className={cn(
              "flex-1 rounded-lg border p-4 text-left transition-colors",
              liveMode ? "border-primary bg-primary/5" : "border-border hover-elevate",
            )}
            data-testid="option-mode-live"
          >
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                <span className="text-sm font-semibold">Live deploy</span>
              </div>
              {liveMode && <Check className="h-4 w-4 text-primary" />}
            </div>
            <p className="text-xs text-muted-foreground">
              Triggers a real Vercel deployment for <code className="font-mono">{repoFullName}@{branch}</code>.
              Run reaches <code className="font-mono">live_succeeded</code> only when Vercel reports ready with a public URL.
            </p>
          </button>
        </div>

        {/* Live readiness panel — only when live is selected. */}
        {liveMode && (
          <div className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
            <div className="flex items-start gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-500 mt-0.5" />
              <div className="flex-1">
                <div className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                  Live deployment readiness
                </div>
                {livePreflightLoading && (
                  <p className="text-xs text-muted-foreground mt-1">Checking gates…</p>
                )}
                {!livePreflightLoading && livePreflight && (
                  <div className="mt-1 space-y-2">
                    <div className="flex items-center gap-2 text-[11px]">
                      <Badge variant={liveReady ? "default" : "outline"} className="text-[10px]">
                        {liveReady ? "READY" : `${blockers.length} blocker${blockers.length === 1 ? "" : "s"}`}
                      </Badge>
                      {livePreflight.tokenSource && (
                        <span className="font-mono text-muted-foreground">
                          token: {livePreflight.tokenSource}
                        </span>
                      )}
                      {livePreflight.account?.username && (
                        <span className="font-mono text-muted-foreground">
                          vercel as: {livePreflight.account.username}
                        </span>
                      )}
                      {matched && (
                        <span className="font-mono text-muted-foreground">
                          project: {matched.name}
                        </span>
                      )}
                    </div>
                    {!liveReady && (
                      <ul className="space-y-1.5 text-xs">
                        {blockers.map((b) => (
                          <li key={b.code} className="rounded border border-border bg-card px-2 py-1.5" data-testid={`blocker-${b.code}`}>
                            <div className="flex items-center gap-2">
                              <AlertTriangle className="h-3 w-3 text-amber-500" />
                              <span className="font-mono text-[10px] text-amber-700 dark:text-amber-400">{b.code}</span>
                            </div>
                            <div className="text-foreground/80 mt-0.5">{b.message}</div>
                            <div className="text-muted-foreground text-[11px] mt-0.5">→ {b.remediation}</div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                {!liveMode && (
                  <p className="text-xs text-muted-foreground mt-1">Toggle live deploy to see readiness gates.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="space-y-2 lg:col-span-1">
          <KV k="Project" v={projectName} testid="kv-project" />
          <KV k="Repo" v={repoFullName} mono testid="kv-repo" />
          <KV k="Branch" v={branch} mono testid="kv-branch" />
          <KV k="Framework" v={extras?.framework ?? "—"} mono testid="kv-framework" />
          <KV k="Environment" v={environment} mono upper testid="kv-env" />
          <KV k="Blueprint" v={blueprint?.name ?? "—"} testid="kv-blueprint" />
          <KV k="Build cmd" v={extras?.buildCommand ?? "—"} mono testid="kv-build" />
          <KV k="Output dir" v={extras?.outputDir ?? "—"} mono testid="kv-output" />
          <KV k="Mode" v={liveMode ? "LIVE" : "DRY-RUN"} mono testid="kv-mode" />
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
              {liveMode
                ? <Check_ ok={liveReady} label={liveReady ? "Live deploy ready — Vercel call will fire on confirmation." : "Live deploy blocked — clear the readiness blockers above."} />
                : <Check_ ok label="Mode is DRY-RUN — no provider mutations will occur." />}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

function KV({ k, v, mono, upper, testid }: { k: string; v: string; mono?: boolean; upper?: boolean; testid?: string }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 bg-card/40" data-testid={testid}>
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
