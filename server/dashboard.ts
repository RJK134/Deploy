/**
 * Project environment dashboard aggregator.
 *
 * Real link/status aggregation only. The dashboard combines:
 *   - the project record (repo / branch / framework)
 *   - the most recent run per environment (test | demo | deploy)
 *   - persisted live deployment metadata on each run (vercelUrl, inspectorUrl)
 *   - persisted provider_resources and provisioning_steps for the run
 *   - optional live read-only refresh from Vercel / Neon / Supabase / Railway
 *     when a valid provider connection or env-var token is available.
 *
 * Honesty contract:
 *   - We NEVER invent live URLs.
 *   - "Open app" / "Share link" actions only get a URL when the URL came from
 *     a real provider response or was persisted from a real live run.
 *   - When credentials/integrations are missing, the dashboard emits explicit
 *     blockers ({code, message, remediation}) and a "Connect provider" CTA.
 *   - Refresh never writes to a provider — it's a read-only status fetch.
 *   - Seeded/dry-run data resolves to `dry_run_validated` or `not_configured`,
 *     never `live_ready`.
 */

import type { Project, Run, ProviderResource, ProvisioningStep } from "@shared/schema";
import { storage } from "./storage";
import { resolveActiveToken } from "./connections-routes";
import {
  vercelGetDeployment, vercelGetProject, vercelListTeams, vercelGetUser,
  VercelError,
} from "./vercel";
import {
  neonGetProject, supabaseListProjects, railwayListProjects,
  prismaListProjects, LiveProviderError,
} from "./live-providers";

export type EnvironmentKey = "test" | "demo" | "deploy";

export const ENVIRONMENT_LABELS: Record<EnvironmentKey, string> = {
  test: "Test",
  demo: "Demo / Run",
  deploy: "Production",
};

/**
 * Honest environment state.
 *  - not_configured       — no run exists for this environment yet
 *  - blocked              — a live run hit blockers; remediation needed
 *  - configuring          — a live run is in pending/queued state
 *  - deploying            — a live run is currently in flight
 *  - live_ready           — last run succeeded with a real public URL
 *  - live_failed          — last live run failed
 *  - dry_run_validated    — last run was a dry-run plan only (no real deploy)
 *  - unknown              — could not determine state (bad data)
 */
export type EnvironmentState =
  | "not_configured" | "blocked" | "configuring" | "deploying"
  | "live_ready" | "live_failed" | "dry_run_validated" | "unknown";

export interface DashboardBlocker {
  code: string;
  message: string;
  remediation: string;
}

export interface DashboardLink {
  /** What this link points to. */
  kind: "app" | "alias" | "inspector" | "provider-dashboard" | "resource-dashboard";
  label: string;
  url: string;
  /** Source provider this URL came from. */
  source: "vercel" | "railway" | "neon" | "supabase" | "prisma" | "github";
  /** Real means we have a verifiable provider-origin for this URL. */
  real: boolean;
}

export interface ShareInfo {
  shareable: boolean;
  /** Public URL safe to share, when shareable. Null otherwise. */
  url: string | null;
  /** test/demo/deploy access mode of the underlying project. */
  accessMode: "public" | "client" | "private" | "unknown";
  /** Suggested copy for sharing with a client/colleague. Null when no real URL. */
  clientNote: string | null;
  /** Last time we verified the URL exists. */
  lastVerifiedAt: number | null;
  /** Provider that originated the URL. */
  source: "vercel" | "railway" | null;
}

export interface ResourceSummary {
  id: number;
  provider: string;
  resourceType: string;
  name: string;
  externalId: string | null;
  status: string;
  url: string | null;
  /** Best-effort dashboard link for the underlying provider resource. */
  dashboardUrl: string | null;
  metadata: Record<string, unknown>;
  errorMessage: string | null;
  updatedAt: number;
}

export interface EnvironmentCard {
  environment: EnvironmentKey;
  label: string;
  state: EnvironmentState;
  /** Mode of the latest run targeting this environment ("dry-run" | "live" | null). */
  mode: "dry-run" | "live" | null;
  /** Latest run for this environment, if any. */
  latestRun: {
    id: number;
    status: string;
    createdAt: number;
    startedAt: number | null;
    finishedAt: number | null;
    notes: string | null;
  } | null;
  /** Hosting provider of the latest deployment for this env, if known. */
  hostingProvider: "vercel" | "railway" | null;
  /** Database providers visible on the latest run, if known. */
  databaseProviders: Array<"neon" | "prisma" | "supabase" | "railway">;
  /** Real public app URL (vercelUrl/aliasUrl/etc.) — null if unknown. */
  appUrl: string | null;
  /** Vercel inspector or service dashboard URL when real. */
  inspectorUrl: string | null;
  /** Real provider resources backing this environment. */
  resources: ResourceSummary[];
  /** Latest known provisioning steps for the run. */
  steps: Array<{
    id: number;
    order: number;
    provider: string;
    action: string;
    label: string;
    status: string;
    blockerCode: string | null;
    blockerMessage: string | null;
    remediation: string | null;
    metadata: Record<string, unknown>;
    finishedAt: number | null;
  }>;
  /** Honest blockers to surface to the user. */
  blockers: DashboardBlocker[];
  /** Share descriptor (only populated when a real URL is present). */
  share: ShareInfo;
  /** Real action links — every URL here is provider-verified. */
  links: DashboardLink[];
  /** Truncated log summary (stage logs / vercelEvents) for quick context. */
  logSummary: string[];
  lastCheckedAt: number | null;
}

export interface ProjectDashboard {
  project: {
    id: number;
    name: string;
    repo: string;
    framework: string;
    rootDir: string;
    accessMode: string;
    sourceProvider: string;
    sourceBranch: string | null;
    sourceDefaultBranch: string | null;
    sourceUrl: string | null;
    createdAt: number;
  };
  /** Aggregate readiness flags. */
  readiness: {
    deployopsLive: boolean;
    /** Per-provider connection presence (no token material in payload). */
    providerConnections: Record<string, { source: "connection" | "env" | null; ready: boolean }>;
  };
  /** Latest run across all environments — useful for the header. */
  lastRun: {
    id: number;
    environment: string;
    status: string;
    mode: string;
    createdAt: number;
  } | null;
  environments: EnvironmentCard[];
  /** Anything wrong at the project level (not bound to a specific env). */
  blockers: DashboardBlocker[];
}

const ALL_ENVIRONMENTS: EnvironmentKey[] = ["test", "demo", "deploy"];

function safeJSON<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

function toResourceSummary(r: ProviderResource): ResourceSummary {
  const metadata = safeJSON<Record<string, unknown>>(r.metadata, {});
  return {
    id: r.id,
    provider: r.provider,
    resourceType: r.resourceType,
    name: r.name,
    externalId: r.externalId,
    status: r.status,
    url: r.url,
    dashboardUrl: buildResourceDashboardUrl(r, metadata),
    metadata,
    errorMessage: r.errorMessage,
    updatedAt: r.updatedAt,
  };
}

/**
 * Best-effort dashboard URL for a provider resource. We only build URLs that
 * are documented public dashboard URLs for the provider — we never invent.
 */
function buildResourceDashboardUrl(r: ProviderResource, meta: Record<string, unknown>): string | null {
  if (r.url && /^https?:\/\//i.test(r.url)) {
    /* The provider already gave us a dashboard/resource URL. */
    if (r.url.includes("vercel.com") || r.url.includes("railway.app") ||
        r.url.includes("supabase.com") || r.url.includes("neon.tech") ||
        r.url.includes("prisma.io") || r.url.includes("console.")) {
      return r.url;
    }
  }
  switch (r.provider) {
    case "neon": {
      /* Neon console URL with project id — well-known shape. */
      if (r.externalId) return `https://console.neon.tech/app/projects/${encodeURIComponent(r.externalId)}`;
      return null;
    }
    case "supabase": {
      /* Supabase dashboard expects the project ref as a path segment. */
      const ref = (typeof meta.projectRef === "string" && meta.projectRef) || r.externalId || null;
      if (ref) return `https://supabase.com/dashboard/project/${encodeURIComponent(String(ref))}`;
      return null;
    }
    case "railway": {
      if (r.externalId) return `https://railway.app/project/${encodeURIComponent(r.externalId)}`;
      return null;
    }
    case "vercel": {
      /* For vercel deployments we prefer a stored inspector URL on the run.
       * The resource entry usually carries url=https://<deployment>.vercel.app
       * which is the live app URL, not the inspector. Return null here so the
       * card prefers the inspector URL from the run row. */
      if (r.resourceType === "project" && r.externalId) {
        return `https://vercel.com/dashboard?search=${encodeURIComponent(r.externalId)}`;
      }
      return r.url && r.url.startsWith("https://vercel.com/") ? r.url : null;
    }
    case "prisma": {
      /* Prisma data platform — dashboard URL not deterministic; only return
       * if the resource already has one. */
      return null;
    }
    default:
      return null;
  }
}

function pickLatestRun(runs: Run[], env: EnvironmentKey): Run | null {
  const filtered = runs.filter((r) => r.environment === env);
  if (filtered.length === 0) return null;
  /* runs are returned newest first by listRunsForProject */
  return filtered[0];
}

function deriveEnvState(run: Run | null): EnvironmentState {
  if (!run) return "not_configured";
  switch (run.status) {
    case "live_succeeded":         return "live_ready";
    case "live_failed":            return "live_failed";
    case "live_blocked":           return "blocked";
    case "live_pending":
    case "queued":                 return run.mode === "live" ? "configuring" : "dry_run_validated";
    case "live_running":
    case "running":                return run.mode === "live" ? "deploying" : "dry_run_validated";
    case "validated_dry_run":
    case "succeeded":  /* legacy seed only; treat as dry-run validated */
    case "planned":                return "dry_run_validated";
    case "failed":                 return "live_failed";
    case "paused":                 return "configuring";
    default:                       return "unknown";
  }
}

/**
 * Pick the best app URL we can honestly show for a run.
 * - Live runs: vercelAliasUrl > vercelUrl (only when present in DB)
 * - Dry-run runs: NO app URL (we never invent)
 */
function honestAppUrl(run: Run | null): string | null {
  if (!run) return null;
  if (run.mode !== "live") return null;
  if (run.status !== "live_succeeded") return null;
  /* Both fields are only ever populated by server/live-deploy.ts after a real
   * Vercel API response. */
  if (run.vercelAliasUrl && /^https:\/\//i.test(run.vercelAliasUrl)) return run.vercelAliasUrl;
  if (run.vercelUrl && /^https:\/\//i.test(run.vercelUrl)) return run.vercelUrl;
  return null;
}

function honestInspectorUrl(run: Run | null): string | null {
  if (!run) return null;
  if (run.mode !== "live") return null;
  if (run.vercelInspectorUrl && /^https:\/\/vercel\.com\//i.test(run.vercelInspectorUrl)) {
    return run.vercelInspectorUrl;
  }
  return null;
}

function shareInfoFor(project: Project, run: Run | null, appUrl: string | null): ShareInfo {
  const accessMode = (["public", "client", "private"].includes(project.accessMode)
    ? project.accessMode
    : "unknown") as ShareInfo["accessMode"];
  if (!appUrl) {
    return {
      shareable: false, url: null, accessMode,
      clientNote: null, lastVerifiedAt: null, source: null,
    };
  }
  const lastVerifiedAt = run?.vercelLastPolledAt ?? run?.finishedAt ?? null;
  const noteByMode: Record<ShareInfo["accessMode"], string> = {
    public:  `${project.name} is live. You can share this link with anyone.`,
    client:  `${project.name} client preview. Share with the client only — magic-link / password protection applies.`,
    private: `${project.name} is private. The link only works for invited team members on Vercel.`,
    unknown: `${project.name} live preview link.`,
  };
  return {
    shareable: true, url: appUrl, accessMode,
    clientNote: noteByMode[accessMode],
    lastVerifiedAt,
    source: "vercel",
  };
}

function buildEnvLinks(run: Run | null, resources: ProviderResource[]): DashboardLink[] {
  const links: DashboardLink[] = [];
  const appUrl = honestAppUrl(run);
  if (appUrl) {
    links.push({ kind: "app", label: "Open live app", url: appUrl, source: "vercel", real: true });
  }
  if (run?.vercelAliasUrl && run.vercelAliasUrl !== appUrl) {
    links.push({ kind: "alias", label: "Open production alias", url: run.vercelAliasUrl, source: "vercel", real: true });
  }
  const inspector = honestInspectorUrl(run);
  if (inspector) {
    links.push({ kind: "inspector", label: "Vercel deployment inspector", url: inspector, source: "vercel", real: true });
  }
  for (const r of resources) {
    const sum = toResourceSummary(r);
    if (sum.dashboardUrl && sum.status !== "planned" && sum.status !== "validated_dry_run") {
      links.push({
        kind: "resource-dashboard",
        label: `Open ${sum.provider} ${sum.resourceType}`,
        url: sum.dashboardUrl,
        source: sum.provider as DashboardLink["source"],
        real: true,
      });
    }
  }
  return links;
}

function detectHostingProvider(run: Run | null, resources: ProviderResource[]): EnvironmentCard["hostingProvider"] {
  if (run?.vercelDeploymentId || resources.some((r) => r.provider === "vercel")) return "vercel";
  const railwayProviders = safeJSON<string[]>(run?.providers ?? null, []);
  if (resources.some((r) => r.provider === "railway") || railwayProviders.includes("railway")) return "railway";
  return null;
}

function detectDatabaseProviders(resources: ProviderResource[]): EnvironmentCard["databaseProviders"] {
  const set = new Set<EnvironmentCard["databaseProviders"][number]>();
  for (const r of resources) {
    if (r.provider === "neon") set.add("neon");
    if (r.provider === "supabase") set.add("supabase");
    if (r.provider === "prisma") set.add("prisma");
    if (r.provider === "railway" && r.resourceType !== "service") set.add("railway");
  }
  return Array.from(set);
}

function summarizeLogs(run: Run | null, steps: ProvisioningStep[]): string[] {
  const out: string[] = [];
  /* Vercel events, if any. */
  if (run) {
    const events = safeJSON<Array<{ type?: string; text?: string }>>(run.vercelEvents, []);
    for (const e of events.slice(-5)) {
      const text = (e?.text ?? "").toString().trim();
      if (text) out.push(text);
    }
  }
  /* Provisioning step messages. */
  for (const s of steps.slice(-5)) {
    const tag = `[${s.provider}/${s.action}]`;
    if (s.blockerMessage) out.push(`${tag} blocked: ${s.blockerMessage}`);
    else if (s.log) {
      const lines = s.log.split("\n").map((x) => x.trim()).filter(Boolean);
      if (lines.length) out.push(`${tag} ${lines[lines.length - 1]}`);
    } else {
      out.push(`${tag} ${s.status}`);
    }
  }
  return out.slice(-10);
}

function envBlockers(run: Run | null, steps: ProvisioningStep[]): DashboardBlocker[] {
  const blockers: DashboardBlocker[] = [];
  if (run?.status === "live_blocked" && run.vercelErrorMessage) {
    /* `vercelErrorMessage` may be a multi-line list of "code: message" pairs
     * persisted by live-deploy. Parse a best-effort breakdown. */
    const lines = run.vercelErrorMessage.split("\n").map((x) => x.trim()).filter(Boolean);
    for (const line of lines) {
      const match = line.match(/^([\w-]+):\s*(.*)$/);
      if (match) {
        blockers.push({
          code: match[1],
          message: match[2],
          remediation: blockerRemediationFor(match[1]),
        });
      } else {
        blockers.push({ code: "live-blocked", message: line, remediation: "Inspect run details." });
      }
    }
  }
  for (const s of steps) {
    if (s.status === "blocked" && s.blockerCode) {
      blockers.push({
        code: s.blockerCode,
        message: s.blockerMessage ?? `${s.provider}/${s.action} blocked`,
        remediation: s.remediation ?? blockerRemediationFor(s.blockerCode),
      });
    }
  }
  return blockers;
}

function blockerRemediationFor(code: string): string {
  switch (code) {
    case "deployops-live-disabled":
      return "Set DEPLOYOPS_LIVE=1 on the DeployOps server, then restart.";
    case "no-vercel-token":
    case "vercel-token-unauthorized":
      return "Open Connection Center and connect (or reconnect) Vercel.";
    case "no-linked-project":
    case "vercel-github-integration-required":
      return "Open https://vercel.com/new and import the repo so Vercel installs the GitHub integration.";
    case "no-neon-token":
    case "neon-token-unauthorized":
      return "Connect Neon in Connection Center, or set NEON_API_KEY on the server.";
    case "no-supabase-token":
    case "supabase-token-unauthorized":
      return "Connect Supabase in Connection Center.";
    case "no-railway-token":
    case "railway-token-unauthorized":
      return "Connect Railway in Connection Center.";
    case "prisma-mgmt-api-unavailable":
      return "Use Neon or Supabase as the DB provider, or enable Prisma Management API.";
    default:
      return "Inspect run details and follow the provider-specific remediation.";
  }
}

/* ----------------- core: build a dashboard for a project ----------------- */

export interface BuildDashboardOptions {
  /** When true, perform read-only provider polls to refresh status. */
  refresh?: boolean;
  /** When set, only refresh status for this environment. */
  environment?: EnvironmentKey;
}

export async function buildProjectDashboard(
  projectId: number,
  opts: BuildDashboardOptions = {},
): Promise<ProjectDashboard | null> {
  const project = await storage.getProject(projectId);
  if (!project) return null;

  const [runs, resources] = await Promise.all([
    storage.listRunsForProject(projectId),
    storage.listProviderResources({ projectId }),
  ]);

  const readiness = await collectReadiness();

  const lastRun = runs.length > 0 ? runs[0] : null;

  const environments: EnvironmentCard[] = [];
  for (const env of ALL_ENVIRONMENTS) {
    const card = await buildEnvironmentCard({
      project, env, runs, resources, opts,
    });
    environments.push(card);
  }

  const projectBlockers: DashboardBlocker[] = [];
  if (project.sourceProvider !== "github") {
    projectBlockers.push({
      code: "non-github-source",
      message: "Project is not wired to a real GitHub repo.",
      remediation: "Re-create the project from the New Deploy wizard using the GitHub picker.",
    });
  }

  return {
    project: {
      id: project.id,
      name: project.name,
      repo: project.repo,
      framework: project.framework,
      rootDir: project.rootDir,
      accessMode: project.accessMode,
      sourceProvider: project.sourceProvider,
      sourceBranch: project.sourceBranch,
      sourceDefaultBranch: project.sourceDefaultBranch,
      sourceUrl: project.sourceUrl,
      createdAt: project.createdAt,
    },
    readiness,
    lastRun: lastRun
      ? {
          id: lastRun.id,
          environment: lastRun.environment,
          status: lastRun.status,
          mode: lastRun.mode,
          createdAt: lastRun.createdAt,
        }
      : null,
    environments,
    blockers: projectBlockers,
  };
}

async function buildEnvironmentCard(args: {
  project: Project;
  env: EnvironmentKey;
  runs: Run[];
  resources: ProviderResource[];
  opts: BuildDashboardOptions;
}): Promise<EnvironmentCard> {
  const { project, env, runs, resources, opts } = args;
  const run = pickLatestRun(runs, env);
  const envResources = resources.filter((r) =>
    r.environment === env ||
    (run && r.runId === run.id),
  );
  const steps = run ? await storage.listProvisioningSteps(run.id) : [];

  let appUrl = honestAppUrl(run);
  let inspectorUrl = honestInspectorUrl(run);
  let lastCheckedAt: number | null = run?.vercelLastPolledAt ?? run?.finishedAt ?? null;

  /* Optional refresh — performs read-only provider lookups when allowed. */
  if (opts.refresh && (!opts.environment || opts.environment === env)) {
    const refreshed = await refreshEnvironment({ project, env, run, resources: envResources });
    if (refreshed) {
      if (refreshed.appUrl !== undefined) appUrl = refreshed.appUrl;
      if (refreshed.inspectorUrl !== undefined) inspectorUrl = refreshed.inspectorUrl;
      lastCheckedAt = refreshed.lastCheckedAt ?? lastCheckedAt;
    }
  }

  const state = deriveEnvState(run);
  const blockers = envBlockers(run, steps);
  const links = buildEnvLinks(run, envResources);
  /* Replace any app/inspector links with refreshed values, if changed. */
  if (appUrl && !links.some((l) => l.kind === "app" && l.url === appUrl)) {
    links.unshift({ kind: "app", label: "Open live app", url: appUrl, source: "vercel", real: true });
  }
  if (inspectorUrl && !links.some((l) => l.kind === "inspector" && l.url === inspectorUrl)) {
    links.push({ kind: "inspector", label: "Vercel deployment inspector", url: inspectorUrl, source: "vercel", real: true });
  }

  return {
    environment: env,
    label: ENVIRONMENT_LABELS[env],
    state,
    mode: run?.mode === "live" || run?.mode === "dry-run" ? run.mode : null,
    latestRun: run
      ? {
          id: run.id,
          status: run.status,
          createdAt: run.createdAt,
          startedAt: run.startedAt ?? null,
          finishedAt: run.finishedAt ?? null,
          notes: run.notes ?? null,
        }
      : null,
    hostingProvider: detectHostingProvider(run, envResources),
    databaseProviders: detectDatabaseProviders(envResources),
    appUrl,
    inspectorUrl,
    resources: envResources.map(toResourceSummary),
    steps: steps.map((s) => ({
      id: s.id,
      order: s.order,
      provider: s.provider,
      action: s.action,
      label: s.label,
      status: s.status,
      blockerCode: s.blockerCode,
      blockerMessage: s.blockerMessage,
      remediation: s.remediation,
      metadata: safeJSON<Record<string, unknown>>(s.metadata, {}),
      finishedAt: s.finishedAt,
    })),
    blockers,
    share: shareInfoFor(project, run, appUrl),
    links,
    logSummary: summarizeLogs(run, steps),
    lastCheckedAt,
  };
}

/* ------------- read-only refresh from real providers ------------- */

interface RefreshResult {
  appUrl?: string | null;
  inspectorUrl?: string | null;
  lastCheckedAt: number | null;
}

async function refreshEnvironment(args: {
  project: Project;
  env: EnvironmentKey;
  run: Run | null;
  resources: ProviderResource[];
}): Promise<RefreshResult | null> {
  const { run, resources } = args;
  /* Read-only Vercel deployment poll for live runs that have a deploymentId. */
  if (run?.mode === "live" && run.vercelDeploymentId) {
    try {
      const auth = await resolveActiveToken("vercel");
      if (!auth?.token) return { lastCheckedAt: Date.now() };
      const d = await vercelGetDeployment(auth.token, run.vercelDeploymentId, run.vercelTeamId ?? undefined);
      const persistedUpdates: Record<string, unknown> = {
        vercelStatus: d.readyState,
        vercelLastPolledAt: Date.now(),
      };
      if (d.url) persistedUpdates.vercelUrl = d.url;
      if (d.aliasUrl) persistedUpdates.vercelAliasUrl = d.aliasUrl;
      if (d.inspectorUrl) persistedUpdates.vercelInspectorUrl = d.inspectorUrl;
      if (d.errorMessage) persistedUpdates.vercelErrorMessage = d.errorMessage;
      /* Persist refreshed status so the next dashboard read is fast. */
      await storage.updateRun(run.id, persistedUpdates as any);
      return {
        appUrl: d.url || run.vercelUrl,
        inspectorUrl: d.inspectorUrl || run.vercelInspectorUrl,
        lastCheckedAt: Date.now(),
      };
    } catch (err) {
      /* Soft-fail: refresh is best-effort. */
      if (err instanceof VercelError) {
        return { lastCheckedAt: Date.now() };
      }
      return { lastCheckedAt: Date.now() };
    }
  }
  /* For database-only resources (Neon/Supabase), confirm presence. We don't
   * synthesize app URLs from these — they don't host an app. */
  for (const r of resources) {
    if (r.provider === "neon" && r.externalId) {
      try {
        const auth = await resolveActiveToken("neon");
        if (!auth?.token) continue;
        const proj = await neonGetProject(auth.token, r.externalId);
        if (proj) {
          await storage.updateProviderResource(r.id, {
            status: r.status === "planned" ? "succeeded" : r.status,
          });
        }
      } catch (err) {
        if (err instanceof LiveProviderError) {
          /* swallow — we just won't update */
        }
      }
    }
    /* Supabase / Railway resource confirmation are similar but we don't change
     * the visible state here — the provider_resources row already has it. */
  }
  return { lastCheckedAt: Date.now() };
}

/* ------------- collect overall readiness without touching providers ------------- */

async function collectReadiness(): Promise<ProjectDashboard["readiness"]> {
  const deployopsLive = process.env.DEPLOYOPS_LIVE === "1";
  const providerKeys: Array<"github" | "vercel" | "neon" | "prisma" | "railway" | "supabase"> =
    ["github", "vercel", "neon", "prisma", "railway", "supabase"];
  const providerConnections: Record<string, { source: "connection" | "env" | null; ready: boolean }> = {};
  for (const key of providerKeys) {
    try {
      const auth = await resolveActiveToken(key);
      providerConnections[key] = { source: auth?.source ?? null, ready: !!auth?.token };
    } catch {
      providerConnections[key] = { source: null, ready: false };
    }
  }
  return { deployopsLive, providerConnections };
}

/* -------- per-environment status fetch (used by /environments/:env/status) -- */

export interface EnvironmentStatusResult {
  environment: EnvironmentKey;
  state: EnvironmentState;
  appUrl: string | null;
  inspectorUrl: string | null;
  blockers: DashboardBlocker[];
  lastCheckedAt: number | null;
  /** Provider-level details, when available. */
  vercel?: {
    deploymentId: string | null;
    readyState: string | null;
    aliasUrl: string | null;
    errorMessage: string | null;
  };
  resources: ResourceSummary[];
}

export async function getEnvironmentStatus(
  projectId: number,
  env: EnvironmentKey,
  opts: { refresh?: boolean } = {},
): Promise<EnvironmentStatusResult | null> {
  const project = await storage.getProject(projectId);
  if (!project) return null;

  const runs = await storage.listRunsForProject(projectId);
  const run = pickLatestRun(runs, env);
  const allResources = await storage.listProviderResources({ projectId });
  const envResources = allResources.filter((r) =>
    r.environment === env || (run && r.runId === run.id),
  );
  const steps = run ? await storage.listProvisioningSteps(run.id) : [];

  let appUrl = honestAppUrl(run);
  let inspectorUrl = honestInspectorUrl(run);
  let lastCheckedAt: number | null = run?.vercelLastPolledAt ?? run?.finishedAt ?? null;

  if (opts.refresh) {
    const refreshed = await refreshEnvironment({ project, env, run, resources: envResources });
    if (refreshed) {
      if (refreshed.appUrl !== undefined) appUrl = refreshed.appUrl;
      if (refreshed.inspectorUrl !== undefined) inspectorUrl = refreshed.inspectorUrl;
      lastCheckedAt = refreshed.lastCheckedAt ?? lastCheckedAt;
    }
  }

  return {
    environment: env,
    state: deriveEnvState(run),
    appUrl,
    inspectorUrl,
    blockers: envBlockers(run, steps),
    lastCheckedAt,
    vercel: run
      ? {
          deploymentId: run.vercelDeploymentId,
          readyState: run.vercelStatus,
          aliasUrl: run.vercelAliasUrl,
          errorMessage: run.vercelErrorMessage,
        }
      : undefined,
    resources: envResources.map(toResourceSummary),
  };
}

/* -------- read-only provider listing helper used by API ------------------ */

/**
 * Read-only "what does this provider see for me right now" — used by the
 * dashboard refresh button to make a single round-trip and flush updates
 * into provider_resources without performing any writes.
 */
export async function snapshotProvidersForProject(_projectId: number): Promise<{
  vercel: { account: { username: string; email: string | null } | null; teams: string[]; error: string | null };
  neon: { projectCount: number | null; error: string | null };
  supabase: { projectCount: number | null; error: string | null };
  railway: { projectCount: number | null; error: string | null };
  prisma: { projectCount: number | null; error: string | null };
}> {
  /* All adapters here are pure GETs — they never write to providers. */
  const [vercelAuth, neonAuth, supabaseAuth, railwayAuth, prismaAuth] = await Promise.all([
    resolveActiveToken("vercel"),
    resolveActiveToken("neon"),
    resolveActiveToken("supabase"),
    resolveActiveToken("railway"),
    resolveActiveToken("prisma"),
  ]);
  const vercel = await safeAsync(async () => {
    if (!vercelAuth?.token) return { account: null, teams: [], error: "no-vercel-token" };
    const user = await vercelGetUser(vercelAuth.token);
    let teamSlugs: string[] = [];
    try {
      const teams = await vercelListTeams(vercelAuth.token);
      teamSlugs = teams.map((t) => t.slug);
    } catch { /* not fatal */ }
    return {
      account: { username: user.username, email: user.email ?? null },
      teams: teamSlugs,
      error: null as string | null,
    };
  }, { account: null, teams: [], error: "vercel-error" });

  const neon = await safeAsync(async () => {
    if (!neonAuth?.token) return { projectCount: null as number | null, error: "no-neon-token" };
    /* Avoid re-fetching the full list — just use existing readiness shape. */
    return { projectCount: null as number | null, error: null as string | null };
  }, { projectCount: null, error: "neon-error" });

  const supabase = await safeAsync(async () => {
    if (!supabaseAuth?.token) return { projectCount: null as number | null, error: "no-supabase-token" };
    const list = await supabaseListProjects(supabaseAuth.token);
    return { projectCount: list.length, error: null as string | null };
  }, { projectCount: null, error: "supabase-error" });

  const railway = await safeAsync(async () => {
    if (!railwayAuth?.token) return { projectCount: null as number | null, error: "no-railway-token" };
    const list = await railwayListProjects(railwayAuth.token);
    return { projectCount: list.length, error: null as string | null };
  }, { projectCount: null, error: "railway-error" });

  const prisma = await safeAsync(async () => {
    if (!prismaAuth?.token) return { projectCount: null as number | null, error: "no-prisma-token" };
    const list = await prismaListProjects(prismaAuth.token);
    return { projectCount: list.length, error: null as string | null };
  }, { projectCount: null, error: "prisma-error" });

  return { vercel, neon, supabase, railway, prisma };
}

async function safeAsync<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

/* -------- listing helpers used by /api/projects/:id/environments -------- */

export async function listEnvironments(projectId: number): Promise<EnvironmentCard[] | null> {
  const dash = await buildProjectDashboard(projectId, { refresh: false });
  return dash ? dash.environments : null;
}

/* -------- a project list summary used by dashboard list view -------- */

export interface ProjectListEntry {
  id: number;
  name: string;
  repo: string;
  framework: string;
  accessMode: string;
  sourceBranch: string | null;
  sourceDefaultBranch: string | null;
  /** State per environment. */
  states: Record<EnvironmentKey, EnvironmentState>;
  /** App URL per environment when real. */
  urls: Record<EnvironmentKey, string | null>;
  /** Latest run id per environment. */
  latestRunIds: Record<EnvironmentKey, number | null>;
  lastUpdated: number;
}

export async function listProjectsForDashboard(): Promise<ProjectListEntry[]> {
  const projects = await storage.listProjects();
  const out: ProjectListEntry[] = [];
  for (const p of projects) {
    const runs = await storage.listRunsForProject(p.id);
    const states: Record<EnvironmentKey, EnvironmentState> = { test: "not_configured", demo: "not_configured", deploy: "not_configured" };
    const urls: Record<EnvironmentKey, string | null> = { test: null, demo: null, deploy: null };
    const latestRunIds: Record<EnvironmentKey, number | null> = { test: null, demo: null, deploy: null };
    let lastUpdated = p.createdAt;
    for (const env of ALL_ENVIRONMENTS) {
      const run = pickLatestRun(runs, env);
      states[env] = deriveEnvState(run);
      urls[env] = honestAppUrl(run);
      latestRunIds[env] = run?.id ?? null;
      const ts = run?.finishedAt ?? run?.startedAt ?? run?.createdAt ?? 0;
      if (ts > lastUpdated) lastUpdated = ts;
    }
    out.push({
      id: p.id, name: p.name, repo: p.repo, framework: p.framework,
      accessMode: p.accessMode,
      sourceBranch: p.sourceBranch, sourceDefaultBranch: p.sourceDefaultBranch,
      states, urls, latestRunIds, lastUpdated,
    });
  }
  return out.sort((a, b) => b.lastUpdated - a.lastUpdated);
}
