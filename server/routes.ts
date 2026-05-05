import type { Express, Request, Response } from "express";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { storage } from "./storage";
import { dbInfo } from "./db";
import {
  insertProjectSchema, insertRunSchema, insertBlueprintSchema,
  insertIncidentSchema, insertRemediationSchema,
  type InsertStage, type InsertAuditLog, type Incident, type Remediation,
} from "@shared/schema";
import {
  githubScan, githubGenerateCi, vercelDeploy, vercelDomain,
  neonProvision, prismaMigrate, railwayManual, smokeTest,
} from "./providers";
import {
  fixbotDiagnose, fixbotGitHubAction, fixbotVercelAction, fixbotNeonAction,
  fixbotPrismaAction, fixbotSmokeTest, fixbotEscalate, type ApplyContext,
} from "./fixbot";
import {
  ghViewer, ghListRepos, ghListBranches, ghDetectConfig, GhError,
  withGitHubToken,
  type GhRepoSummary,
} from "./github";
import { registerConnectionRoutes, resolveActiveToken } from "./connections-routes";
import {
  startLiveVercelDeploy, pollLiveVercelDeploy, checkLiveVercelReadiness,
} from "./live-deploy";
import {
  preflightPlan, executePlan, type DatabaseProvider, type HostingProvider,
} from "./live-provisioning";
import {
  neonReadiness, prismaReadiness, railwayReadiness, supabaseReadiness,
} from "./live-providers";
import {
  buildProjectDashboard, listEnvironments, getEnvironmentStatus,
  listProjectsForDashboard, snapshotProvidersForProject,
  ENVIRONMENT_LABELS, type EnvironmentKey,
} from "./dashboard";

/* Helper: parse JSON columns safely */
function parseJSON<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

const STAGE_PLAN = [
  { key: "scan",    label: "Scan repository",      description: "Read package.json, detect framework + ORM, parse .env.example.", provider: "github" },
  { key: "env",     label: "Resolve env vars",      description: "Cross-reference required env vars with provider outputs and existing secrets.", provider: null },
  { key: "db",      label: "Provision database",    description: "Branch a Neon database or create a Prisma DB for the target environment.", provider: "neon" },
  { key: "migrate", label: "Run migrations",        description: "Apply Prisma migrations against the new branch with a transactional shadow DB.", provider: "prisma" },
  { key: "ci",      label: "Generate CI workflow",  description: "Write `.github/workflows/deployops.yml` that mirrors this plan in CI.", provider: "github" },
  { key: "deploy",  label: "Deploy build",          description: "Push env vars, link the project, and trigger the build on the host.", provider: "vercel" },
  { key: "domain",  label: "Wire domain & access",  description: "Attach the env subdomain and apply the access policy.", provider: "vercel" },
  { key: "smoke",   label: "Smoke test",            description: "Hit / and /api/health, verify 200 + JSON shape, capture response time.", provider: null },
] as const;

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {

  /* --------------------- provider connections (auth) -------------------- */
  registerConnectionRoutes(app);

  /* --------------------------- providers --------------------------------- */
  app.get("/api/providers", async (_req, res) => {
    const items = await storage.listProviders();
    res.json(items.map((p) => ({
      ...p,
      capabilities: parseJSON<string[]>(p.capabilities, []),
    })));
  });

  app.post("/api/providers/:key/mode", async (req, res) => {
    const { key } = req.params;
    const mode = req.body?.mode === "live" ? "live" : "dry-run";
    const updated = await storage.setProviderMode(key, mode);
    if (!updated) return res.status(404).json({ error: "provider not found" });
    res.json(updated);
  });

  /* ----------------------------- github --------------------------------- */
  /**
   * Live GitHub integration for the New Deploy wizard. All calls go through
   * the authenticated `gh` CLI server-side — credentials never leave the
   * server. Each handler maps GhError codes to a stable response shape so the
   * UI can render a useful empty/error state.
   */
  /**
   * Map GitHub backend errors to a stable HTTP response shape.
   *
   * Defensive: we sanitize the status here too, in case any code path
   * smuggles an invalid value (e.g. a CLI exit code) onto err.status.
   * Express's res.status() will throw RangeError on out-of-range values
   * and crash the request — we want a clean 503 instead.
   */
  function sendGhError(res: Response, err: unknown) {
    if (err instanceof GhError) {
      const status = Number.isInteger(err.status) && err.status >= 100 && err.status <= 599
        ? err.status
        : 503;
      return res.status(status).json({ error: err.message, code: err.code, detail: err.detail });
    }
    const msg = (err as any)?.message ?? String(err);
    return res.status(500).json({ error: msg, code: "unknown" });
  }

  /**
   * Diagnostic endpoint — never exposes tokens. Reports whether a stored
   * connection token, env var, or `gh` CLI fallback is available. Useful for
   * the wizard to render a precise inline-connect call-to-action when repo
   * loading fails.
   */
  app.get("/api/github/diag", async (_req, res) => {
    const auth = await resolveActiveToken("github").catch(() => null);
    const cliEnabled = (process.env.DEPLOYOPS_DISABLE_GH_CLI ?? "").trim() !== "1";
    const envTokenPresent = !!((process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN) ?? "").trim();
    let viewer: { login: string; name: string | null } | null = null;
    let viewerError: { code: string; message: string } | null = null;
    if (auth) {
      try {
        const v = await withGitHubToken(auth.token, () => ghViewer(), auth.source);
        viewer = { login: v.login, name: v.name };
      } catch (err) {
        if (err instanceof GhError) viewerError = { code: err.code, message: err.message };
        else viewerError = { code: "unknown", message: (err as Error).message ?? String(err) };
      }
    }
    res.json({
      ok: true,
      authSource: auth?.source ?? null,
      hasStoredConnection: auth?.source === "connection",
      hasEnvToken: envTokenPresent,
      ghCliFallbackEnabled: cliEnabled,
      viewer,
      viewerError,
    });
  });

  app.get("/api/github/viewer", async (_req, res) => {
    try {
      const auth = await resolveActiveToken("github");
      const viewer = await withGitHubToken(auth?.token ?? null, () => ghViewer(), auth?.source ?? "none");
      res.json({ ok: true, viewer, authSource: auth?.source ?? "cli" });
    }
    catch (err) { sendGhError(res, err); }
  });

  /* ---- repo cache helpers ---- */
  function rowToRepo(row: any): GhRepoSummary {
    return {
      id: row.id,
      name: row.name,
      fullName: row.fullName,
      owner: row.owner,
      description: row.description ?? null,
      url: row.url ?? `https://github.com/${row.fullName}`,
      cloneUrl: row.cloneUrl ?? `https://github.com/${row.fullName}.git`,
      defaultBranch: row.defaultBranch ?? "main",
      private: !!row.isPrivate,
      fork: !!row.fork,
      archived: !!row.archived,
      language: row.language ?? null,
      pushedAt: row.pushedAt ?? null,
      updatedAt: row.updatedAt ?? null,
      topics: parseJSON<string[]>(row.topics, []),
    };
  }
  async function persistRepoCache(repos: GhRepoSummary[]): Promise<void> {
    for (const r of repos) {
      try {
        await storage.upsertGithubRepo({
          fullName: r.fullName,
          owner: r.owner,
          name: r.name,
          description: r.description ?? null,
          url: r.url ?? null,
          cloneUrl: r.cloneUrl ?? null,
          defaultBranch: r.defaultBranch ?? "main",
          isPrivate: !!r.private,
          fork: !!r.fork,
          archived: !!r.archived,
          language: r.language ?? null,
          pushedAt: r.pushedAt ?? null,
          updatedAt: r.updatedAt ?? null,
          topics: JSON.stringify(r.topics ?? []),
        });
      } catch (e) {
        console.warn("[github-cache] failed to upsert", r.fullName, e);
      }
    }
  }
  async function loadCachedRepos(ownerFilter?: string): Promise<{ repos: GhRepoSummary[]; cachedAt: number | null; owners: string[] }> {
    const rows = await storage.listGithubRepos();
    const all = rows.map(rowToRepo);
    const owners = Array.from(new Set(all.map((r) => r.owner))).sort();
    const filtered = ownerFilter
      ? all.filter((r) => r.owner.toLowerCase() === ownerFilter.toLowerCase())
      : all;
    const cachedAt = rows.reduce<number | null>((acc, r) => {
      if (acc === null || (r.cachedAt ?? 0) > acc) return r.cachedAt ?? acc;
      return acc;
    }, null);
    return { repos: filtered, cachedAt, owners };
  }

  /**
   * Aggregated repo list. Tries live GitHub first; on success, caches the
   * result and returns it with `source: "live"`. On failure, falls back to
   * the SQLite cache (when populated) and returns `source: "cache"` with
   * `stale: true` and a warning. Only returns 503 when neither live nor
   * cache yields any repos.
   */
  app.get("/api/github/repos", async (req, res) => {
    const ownerParam = String(req.query.owner ?? "").trim();
    const extraOwners = ownerParam ? [ownerParam] : undefined;
    const q = String(req.query.q ?? "").toLowerCase();

    const applyFilters = (list: GhRepoSummary[]) => {
      let out = list;
      if (ownerParam) {
        out = out.filter((r) => r.owner.toLowerCase() === ownerParam.toLowerCase());
      }
      if (q) {
        out = out.filter((r) =>
          r.fullName.toLowerCase().includes(q) ||
          (r.description ?? "").toLowerCase().includes(q) ||
          (r.language ?? "").toLowerCase().includes(q),
        );
      }
      return out;
    };

    try {
      const auth = await resolveActiveToken("github");
      const authSource: "connection" | "env" | "cli" = auth?.source ?? "cli";
      const result = await withGitHubToken(
        auth?.token ?? null,
        () => ghListRepos({ extraOwners }),
        auth?.source ?? "none",
      );
      /* Capture the authenticated account when possible — useful diagnostic. */
      let connectedAccount: { login: string; name: string | null } | null = null;
      try {
        const v = await withGitHubToken(auth?.token ?? null, () => ghViewer(), auth?.source ?? "none");
        connectedAccount = { login: v.login, name: v.name };
      } catch { /* non-fatal */ }
      /* Persist for fallback. Don't block the response on cache errors. */
      void persistRepoCache(result.repos);
      const filtered = applyFilters(result.repos);
      const ownersTried = Array.from(new Set([
        ...result.owners,
        ...result.ownerErrors.map((e) => e.owner),
      ])).filter(Boolean);
      return res.json({
        ok: true,
        source: "live",
        authSource,
        connectedAccount,
        ownersTried,
        stale: false,
        repos: filtered,
        total: result.repos.length,
        owners: result.owners,
        ownerErrors: result.ownerErrors,
      });
    } catch (err) {
      /* Live failed — try the cache as backup. We always label cache results
       * stale so the UI never shows them as "fresh / live". */
      const code = err instanceof GhError ? err.code : "unknown";
      const message = err instanceof Error ? err.message : String(err);
      try {
        const cached = await loadCachedRepos(ownerParam || undefined);
        if (cached.repos.length > 0) {
          return res.json({
            ok: true,
            source: "cache",
            authSource: "cache",
            stale: true,
            cachedAt: cached.cachedAt,
            warning: code === "auth-missing"
              ? "No GitHub credential available; showing last cached repo list. Connect GitHub to refresh."
              : "Live GitHub refresh failed; showing last cached repo list.",
            liveError: { code, message },
            repos: cached.repos,
            total: cached.repos.length,
            owners: cached.owners,
            ownerErrors: [],
            ownersTried: cached.owners,
          });
        }
      } catch (cacheErr) {
        console.warn("[github-cache] read failed:", cacheErr);
      }
      /* No cache available — return a clean, actionable error. */
      return sendGhError(res, err);
    }
  });

  /**
   * Force a refresh of the GitHub repo cache. Safe to call manually while
   * fresh credentials are available; never exposes the underlying token.
   */
  app.post("/api/github/repos/refresh", async (req, res) => {
    const ownerParam = String((req.query.owner ?? req.body?.owner) ?? "").trim();
    const extraOwners = ownerParam ? [ownerParam] : undefined;
    try {
      const auth = await resolveActiveToken("github");
      const result = await withGitHubToken(
        auth?.token ?? null,
        () => ghListRepos({ extraOwners }),
        auth?.source ?? "none",
      );
      await persistRepoCache(result.repos);
      return res.json({
        ok: true,
        cached: result.repos.length,
        owners: result.owners,
        ownerErrors: result.ownerErrors,
        authSource: auth?.source ?? "cli",
        cachedAt: Date.now(),
      });
    } catch (err) {
      return sendGhError(res, err);
    }
  });

  app.get("/api/github/repos/:owner/:repo/branches", async (req, res) => {
    const repo = `${req.params.owner}/${req.params.repo}`;
    try {
      const auth = await resolveActiveToken("github");
      const branches = await withGitHubToken(
        auth?.token ?? null,
        () => ghListBranches(repo),
        auth?.source ?? "none",
      );
      return res.json({ ok: true, source: "live", authSource: auth?.source ?? "cli", repo, branches });
    } catch (err) {
      /* Fallback: surface at least the cached default branch so the wizard
       * can proceed with a sensible default. */
      try {
        const cached = await storage.listGithubRepos();
        const row = cached.find((r) => r.fullName.toLowerCase() === repo.toLowerCase());
        if (row) {
          return res.json({
            ok: true,
            source: "cache",
            stale: true,
            warning: "Live branch list unavailable; using cached default branch only.",
            liveError: err instanceof GhError ? { code: err.code, message: err.message } : { code: "unknown", message: String(err) },
            repo,
            branches: [{ name: row.defaultBranch, protected: false, sha: "" }],
          });
        }
      } catch (cacheErr) {
        console.warn("[github-cache] branch fallback failed:", cacheErr);
      }
      return sendGhError(res, err);
    }
  });

  app.get("/api/github/repos/:owner/:repo/detect", async (req, res) => {
    const repo = `${req.params.owner}/${req.params.repo}`;
    const branch = String(req.query.branch ?? "").trim();
    if (!branch) return res.status(400).json({ error: "branch query parameter required", code: "bad-request" });
    try {
      const auth = await resolveActiveToken("github");
      const detection = await withGitHubToken(
        auth?.token ?? null,
        () => ghDetectConfig(repo, branch),
        auth?.source ?? "none",
      );
      res.json({ ok: true, source: "live", authSource: auth?.source ?? "cli", repo, branch, detection });
    } catch (err) {
      /* Detection is best-effort — when GitHub auth is unavailable, return a
       * stub detection so the wizard can fall back to manual build fields and
       * blueprint selection rather than blocking. */
      const liveError = err instanceof GhError
        ? { code: err.code, message: err.message }
        : { code: "unknown", message: String(err) };
      const fallbackDetection = {
        framework: "unknown" as const,
        packageManager: "unknown" as const,
        buildCommand: null,
        devCommand: null,
        startCommand: null,
        outputDir: null,
        prisma: { present: false, schemaPath: null, migrationsPath: null },
        docker: { dockerfile: false, compose: false },
        vercel: { configFile: null },
        githubActions: { workflowPaths: [] },
        envExample: { path: null, keys: [] },
        envSuggestions: [],
        blueprintRecommendation: null,
        recommendedProviders: ["github"],
        language: null,
        notes: ["Live GitHub inspection failed; fill in build settings manually or pick a blueprint."],
      };
      return res.json({
        ok: true,
        source: "fallback",
        stale: true,
        warning: "Could not inspect repo contents; using manual fallback.",
        liveError,
        repo,
        branch,
        detection: fallbackDetection,
      });
    }
  });

  /* --------------------------- blueprints -------------------------------- */
  app.get("/api/blueprints", async (_req, res) => {
    const items = await storage.listBlueprints();
    res.json(items.map((b) => ({
      ...b,
      providers: parseJSON<string[]>(b.providers, []),
      defaults: parseJSON<Record<string, unknown>>(b.defaults, {}),
    })));
  });

  app.post("/api/blueprints", async (req, res) => {
    const parsed = insertBlueprintSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const bp = await storage.createBlueprint(parsed.data);
    res.json(bp);
  });

  /* ---------------------------- projects --------------------------------- */
  app.get("/api/projects", async (_req, res) => {
    const items = await storage.listProjects();
    res.json(items.map((p) => ({
      ...p,
      envExample: parseJSON<string[]>(p.envExample, []),
    })));
  });

  app.get("/api/projects/:id", async (req, res) => {
    const id = Number(req.params.id);
    const p = await storage.getProject(id);
    if (!p) return res.status(404).json({ error: "not found" });
    res.json({ ...p, envExample: parseJSON<string[]>(p.envExample, []) });
  });

  app.post("/api/projects", async (req, res) => {
    const parsed = insertProjectSchema.safeParse({
      ...req.body,
      envExample: typeof req.body.envExample === "string"
        ? req.body.envExample
        : JSON.stringify(req.body.envExample ?? []),
      detectedConfig: typeof req.body.detectedConfig === "string"
        ? req.body.detectedConfig
        : JSON.stringify(req.body.detectedConfig ?? {}),
    });
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const created = await storage.createProject(parsed.data);
    res.json(created);
  });

  app.patch("/api/projects/:id", async (req, res) => {
    const id = Number(req.params.id);
    const patch: any = { ...req.body };
    if (patch.envExample && typeof patch.envExample !== "string") {
      patch.envExample = JSON.stringify(patch.envExample);
    }
    const updated = await storage.updateProject(id, patch);
    if (!updated) return res.status(404).json({ error: "not found" });
    res.json(updated);
  });

  /* ----------------------- project dashboards -------------------------- */
  /**
   * Real link/status aggregator per project. Read-only by default. Pass
   * `?refresh=1` to perform live read-only polls (Vercel deployment poll +
   * provider resource confirmations) and update the persisted status.
   *
   * Response is honest: app URLs only appear when a real provider returned
   * them; otherwise the relevant environment shows blockers + "Connect provider"
   * remediation. Dry-run / seeded data resolves to `dry_run_validated` or
   * `not_configured`, never `live_ready`.
   */
  app.get("/api/projects/:id/dashboard", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "bad project id", code: "bad-request" });
    try {
      const refresh = req.query.refresh === "1" || req.query.refresh === "true";
      const dash = await buildProjectDashboard(id, { refresh });
      if (!dash) return res.status(404).json({ error: "project not found", code: "not-found" });
      res.json({ ok: true, dashboard: dash });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: String(err?.message ?? err) });
    }
  });

  app.get("/api/projects/:id/environments", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "bad project id", code: "bad-request" });
    const envs = await listEnvironments(id);
    if (!envs) return res.status(404).json({ error: "project not found", code: "not-found" });
    res.json({ ok: true, environments: envs, labels: ENVIRONMENT_LABELS });
  });

  app.get("/api/projects/:id/environments/:environment/status", async (req, res) => {
    const id = Number(req.params.id);
    const envParam = String(req.params.environment) as EnvironmentKey;
    if (!Number.isFinite(id)) return res.status(400).json({ error: "bad project id", code: "bad-request" });
    if (!["test", "demo", "deploy"].includes(envParam)) {
      return res.status(400).json({ error: "environment must be test|demo|deploy", code: "bad-request" });
    }
    try {
      const status = await getEnvironmentStatus(id, envParam, { refresh: false });
      if (!status) return res.status(404).json({ error: "project not found", code: "not-found" });
      res.json({ ok: true, status });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: String(err?.message ?? err) });
    }
  });

  /**
   * Read-only refresh of a single environment's status. Polls the provider's
   * read endpoints (Vercel deployment status, Neon project existence) and
   * persists any updates. NEVER triggers a deployment or other provider write.
   */
  app.post("/api/projects/:id/environments/:environment/refresh-status", async (req, res) => {
    const id = Number(req.params.id);
    const envParam = String(req.params.environment) as EnvironmentKey;
    if (!Number.isFinite(id)) return res.status(400).json({ error: "bad project id", code: "bad-request" });
    if (!["test", "demo", "deploy"].includes(envParam)) {
      return res.status(400).json({ error: "environment must be test|demo|deploy", code: "bad-request" });
    }
    try {
      const status = await getEnvironmentStatus(id, envParam, { refresh: true });
      if (!status) return res.status(404).json({ error: "project not found", code: "not-found" });
      res.json({ ok: true, status });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: String(err?.message ?? err) });
    }
  });

  /**
   * Project list with dashboard summary fields (state per environment, real
   * URLs only). Used by the Projects index page. No provider calls are made
   * by this endpoint — it is a pure DB aggregation.
   */
  app.get("/api/projects-dashboard", async (_req, res) => {
    try {
      const list = await listProjectsForDashboard();
      res.json({ ok: true, projects: list });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: String(err?.message ?? err) });
    }
  });

  /**
   * Snapshot of provider read-only status for the entire project workspace.
   * Used by the dashboard "Refresh providers" action. Read-only.
   */
  app.get("/api/projects/:id/providers-snapshot", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "bad project id", code: "bad-request" });
    try {
      const snap = await snapshotProvidersForProject(id);
      res.json({ ok: true, snapshot: snap });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: String(err?.message ?? err) });
    }
  });

  /* ----------------------------- runs ----------------------------------- */
  app.get("/api/runs", async (req, res) => {
    const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
    const items = projectId
      ? await storage.listRunsForProject(projectId)
      : await storage.listRuns();
    res.json(items.map((r) => ({
      ...r,
      providers: parseJSON<string[]>(r.providers, []),
      envVars: parseJSON<Array<{ key: string; value: string; source: string }>>(r.envVars, []),
      /* Surface live-vs-dry-run flag for list views so the UI never
       * presents a dry-run with the same language as a real deployment. */
      isLive: r.mode === "live",
      isTerminal: ["live_succeeded", "live_failed", "live_blocked", "validated_dry_run", "succeeded", "failed"].includes(r.status),
    })));
  });

  app.get("/api/runs/:id", async (req, res) => {
    const id = Number(req.params.id);
    const run = await storage.getRun(id);
    if (!run) return res.status(404).json({ error: "not found" });
    const stages = await storage.listStages(id);
    res.json({
      run: {
        ...run,
        providers: parseJSON<string[]>(run.providers, []),
        envVars: parseJSON<Array<{ key: string; value: string; source: string }>>(run.envVars, []),
        vercelEvents: parseJSON<Array<{ type: string; text: string; createdAt: number | null }>>(run.vercelEvents, []),
      },
      stages,
    });
  });

  /**
   * Create a new run.
   * Body: { projectId, environment, mode?, providers, envVars }
   * Side effect: stages are created for the standard pipeline plan.
   */
  app.post("/api/runs", async (req, res) => {
    const body = {
      ...req.body,
      providers: typeof req.body.providers === "string"
        ? req.body.providers
        : JSON.stringify(req.body.providers ?? []),
      envVars: typeof req.body.envVars === "string"
        ? req.body.envVars
        : JSON.stringify(req.body.envVars ?? []),
    };
    const parsed = insertRunSchema.safeParse(body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const run = await storage.createRun(parsed.data);
    let order = 0;
    for (const s of STAGE_PLAN) {
      await storage.createStage({
        runId: run.id,
        order: order++,
        key: s.key,
        label: s.label,
        description: s.description,
        provider: s.provider as any,
        status: "pending",
        log: "",
      } as InsertStage);
    }
    /* Dry-run runs start advancing through the stage plan.
     * Live runs stay `queued` and do nothing until POST /api/runs/:id/start-live.
     * This keeps a live run's terminal state honest — `succeeded` is never
     * written by the dry-run advancer for a live run. */
    if (parsed.data.mode === "live") {
      await storage.updateRun(run.id, { status: "queued" });
    } else {
      await storage.updateRun(run.id, { status: "running", startedAt: Date.now() });
    }
    res.json({ id: run.id });
  });

  /**
   * Advance the next pending stage of a run by one step. Each call simulates
   * a stage execution against the appropriate adapter (always in dry-run for
   * this build). Returns the stage that was advanced and the next pending,
   * if any.
   */
  app.post("/api/runs/:id/advance", async (req, res) => {
    const id = Number(req.params.id);
    const run = await storage.getRun(id);
    if (!run) return res.status(404).json({ error: "run not found" });
    /* Live runs are NOT advanced through the dry-run stage plan. They go
     * through /start-live which calls the real Vercel API. Refusing here
     * prevents a live run from accidentally being marked succeeded by the
     * synthetic advancer. */
    if (run.mode === "live") {
      return res.status(409).json({
        error: "live runs cannot be advanced as dry-run stages",
        code: "live-run",
        detail: "Use POST /api/runs/:id/start-live to trigger the real Vercel deployment, then poll /api/runs/:id/live-status.",
      });
    }
    const project = await storage.getProject(run.projectId);
    if (!project) return res.status(404).json({ error: "project not found" });
    const stages = await storage.listStages(id);
    const next = stages.find((s) => s.status === "pending");
    if (!next) return res.json({ done: true });

    await storage.updateStage(next.id, { status: "running", startedAt: Date.now() });
    const ctx = {
      mode: run.mode as "dry-run" | "live",
      projectName: project.name,
      repo: project.repo,
      environment: run.environment as "test" | "demo" | "deploy",
    };

    let result;
    try {
      switch (next.key) {
        case "scan":    result = await githubScan(ctx); break;
        case "env":     result = { ok: true, log: [
          "Required env vars detected from .env.example:",
          ...(parseJSON<string[]>(project.envExample, []).map((k) => `  · ${k}`)),
          "Suggested resolution: provider outputs + generated secrets.",
        ] }; break;
        case "db":      result = project.needsDatabase
          ? await neonProvision(ctx)
          : { ok: true, log: ["[skip] project does not require a database."] };
          break;
        case "migrate": result = project.ormDetected === "prisma"
          ? await prismaMigrate(ctx)
          : { ok: true, log: ["[skip] no Prisma schema detected; migrations not required."] };
          break;
        case "ci":      result = await githubGenerateCi(ctx, "auto"); break;
        case "deploy":
          if ((parseJSON<string[]>(run.providers, [])).includes("railway")) {
            result = await railwayManual(ctx);
          } else {
            result = await vercelDeploy(ctx);
          }
          break;
        case "domain":  result = await vercelDomain(ctx); break;
        case "smoke":   result = await smokeTest(ctx); break;
        default:        result = { ok: true, log: [`unknown stage: ${next.key}`] };
      }
    } catch (err: any) {
      result = { ok: false, log: [String(err?.message ?? err)] };
    }

    await storage.updateStage(next.id, {
      status: result.ok ? "succeeded" : "failed",
      finishedAt: Date.now(),
      log: result.log.join("\n"),
    });

    /* If this was the last stage, mark run completed. Dry-runs write
     * `validated_dry_run` so the UI never confuses a plan with a real
     * deployment. The `succeeded` state is reserved for legacy seed data
     * and live runs that successfully resolve via Vercel. */
    const remaining = (await storage.listStages(id)).filter((s) => s.status === "pending");
    if (remaining.length === 0) {
      await storage.updateRun(id, {
        status: result.ok ? "validated_dry_run" : "failed",
        finishedAt: Date.now(),
      });
    }

    const allStages = await storage.listStages(id);
    res.json({ stage: allStages.find((s) => s.id === next.id), stages: allStages });
  });

  /* ------------------------- live vercel deploy ------------------------- */
  /**
   * Start a real Vercel deployment for a live-mode run. Refuses if the run
   * is not live, returns a structured blocker list when readiness checks
   * fail. Never simulates success.
   *
   * Hard safety: requires the request to opt in with body { confirm: "I UNDERSTAND" }
   * unless DEPLOYOPS_CONFIRM_LIVE_DEPLOY=0. This protects against an
   * accidental click in the UI from triggering a real deployment during
   * implementation/testing.
   */
  app.post("/api/runs/:id/start-live", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "bad run id", code: "bad-request" });

    const confirm = typeof req.body?.confirm === "string" ? req.body.confirm.trim() : "";
    const confirmRequired = process.env.DEPLOYOPS_CONFIRM_LIVE_DEPLOY !== "0";
    if (confirmRequired && confirm.toUpperCase() !== "I UNDERSTAND") {
      return res.status(400).json({
        error: "live deploy confirmation phrase required",
        code: "confirmation-required",
        detail: 'Send body { confirm: "I UNDERSTAND" } to start a real Vercel deployment. ' +
                'This is a real external action and is not free.',
      });
    }

    try {
      const result = await startLiveVercelDeploy(id);
      const status = result.ok ? 200 : (result.status === "live_blocked" ? 409 : 502);
      return res.status(status).json(result);
    } catch (err: any) {
      return res.status(500).json({
        ok: false,
        status: "live_failed",
        message: String(err?.message ?? err),
      });
    }
  });

  /**
   * Poll the upstream Vercel deployment for a run. Idempotent. Returns
   * the latest persisted live status + any new events.
   */
  app.get("/api/runs/:id/live-status", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "bad run id", code: "bad-request" });
    try {
      const result = await pollLiveVercelDeploy(id);
      return res.json({ ok: true, ...result });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: String(err?.message ?? err) });
    }
  });

  /**
   * Return the persisted vercel events for a run (no fresh poll). Used by
   * the run detail UI to render the events log without forcing an upstream
   * call on every tab switch.
   */
  app.get("/api/runs/:id/vercel-events", async (req, res) => {
    const id = Number(req.params.id);
    const run = await storage.getRun(id);
    if (!run) return res.status(404).json({ error: "run not found" });
    res.json({
      ok: true,
      runId: id,
      mode: run.mode,
      status: run.status,
      vercel: {
        deploymentId: run.vercelDeploymentId,
        projectId: run.vercelProjectId,
        projectName: run.vercelProjectName,
        teamId: run.vercelTeamId,
        readyState: run.vercelStatus,
        url: run.vercelUrl,
        aliasUrl: run.vercelAliasUrl,
        inspectorUrl: run.vercelInspectorUrl,
        errorMessage: run.vercelErrorMessage,
        lastPolledAt: run.vercelLastPolledAt,
      },
      events: parseJSON<any[]>(run.vercelEvents, []),
    });
  });

  /**
   * Read-only readiness check for a live Vercel deploy of a project+branch.
   * Returns blockers without contacting Vercel beyond a token validation.
   * Used by the wizard to render the live deployment gate before the user
   * commits.
   */
  app.get("/api/live/vercel/readiness", async (req, res) => {
    const projectId = Number(req.query.projectId);
    const branch = String(req.query.branch ?? "").trim();
    if (!Number.isFinite(projectId)) {
      return res.status(400).json({ error: "projectId is required", code: "bad-request" });
    }
    const project = await storage.getProject(projectId);
    if (!project) return res.status(404).json({ error: "project not found", code: "not-found" });
    try {
      const readiness = await checkLiveVercelReadiness({
        project,
        branch: branch || project.sourceBranch || project.sourceDefaultBranch || "main",
      });
      return res.json({ ok: true, ...readiness });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: String(err?.message ?? err) });
    }
  });

  /**
   * Pre-flight live readiness for a repo + branch BEFORE a project row
   * exists (i.e. from inside the wizard). Synthesises a project-shaped
   * input without persisting anything.
   */
  app.get("/api/live/vercel/preflight", async (req, res) => {
    const repo = String(req.query.repo ?? "").trim();
    const branch = String(req.query.branch ?? "").trim() || "main";
    const name = String(req.query.name ?? "").trim() || (repo.split("/")[1] ?? "deploy");
    if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
      return res.status(400).json({ error: "repo must be owner/name", code: "bad-request" });
    }
    /* Build a stand-in project shape — never touched by storage. */
    const stub = {
      id: 0, name, repo, framework: "unknown", buildCommand: "", outputDir: "",
      rootDir: ".", needsDatabase: false, ormDetected: null,
      envExample: "[]", blueprintId: null, accessMode: "private",
      sourceProvider: "github", sourceBranch: branch, sourceUrl: null,
      sourceDefaultBranch: branch, sourceVisibility: null, sourceLanguage: null,
      sourceUpdatedAt: null, detectedConfig: "{}", createdAt: 0,
    } as any;
    try {
      const readiness = await checkLiveVercelReadiness({ project: stub, branch });
      return res.json({ ok: true, ...readiness });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: String(err?.message ?? err) });
    }
  });

  /* ----------------------- live provisioning ---------------------------- */
  /**
   * Per-provider read-only readiness for the database providers + Supabase.
   * Surfaces blockers + the discoverable resources (orgs, projects) so the
   * wizard can render account-aware cards.
   */
  app.get("/api/live/providers/readiness", async (_req, res) => {
    const liveEnabled = process.env.DEPLOYOPS_LIVE === "1";
    const [neonAuth, prismaAuth, railwayAuth, supabaseAuth] = await Promise.all([
      resolveActiveToken("neon"),
      resolveActiveToken("prisma"),
      resolveActiveToken("railway"),
      resolveActiveToken("supabase"),
    ]);
    const [neon, prisma, railway, supabase] = await Promise.all([
      neonReadiness(neonAuth?.token ?? null),
      prismaReadiness(prismaAuth?.token ?? null),
      railwayReadiness(railwayAuth?.token ?? null),
      supabaseReadiness(supabaseAuth?.token ?? null),
    ]);
    res.json({
      ok: true,
      liveEnabled,
      providers: {
        neon: { blockers: neon.blockers, projectCount: neon.projects.length, projects: neon.projects, source: neonAuth?.source ?? null },
        prisma: { blockers: prisma.blockers, apiAvailable: prisma.apiAvailable, projectCount: prisma.projects.length, projects: prisma.projects, source: prismaAuth?.source ?? null },
        railway: { blockers: railway.blockers, viewer: railway.viewer, projectCount: railway.projects.length, source: railwayAuth?.source ?? null },
        supabase: { blockers: supabase.blockers, organizations: supabase.organizations, projectCount: supabase.projects.length, projects: supabase.projects, source: supabaseAuth?.source ?? null },
      },
    });
  });

  /**
   * Combined preflight for a (repo, branch, environment, hosting, database).
   * No persistence, no external writes, no resource creation.
   */
  app.post("/api/live/preflight", async (req, res) => {
    try {
      const body = parsePlanBody(req.body);
      if (!body.ok) return res.status(400).json({ error: body.error, code: "bad-request" });
      const report = await preflightPlan(body.value);
      res.json({ ok: true, ...report });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: String(err?.message ?? err) });
    }
  });

  /**
   * Execute a provisioning run. `dryRun=true` (default) only persists steps
   * and never makes external writes. `dryRun=false` triggers real provider
   * calls and requires `confirm: "I UNDERSTAND"` plus DEPLOYOPS_LIVE=1.
   *
   * The route looks up an existing run row by `runId`. The wizard creates a
   * run via POST /api/runs first (which seeds the dry-run stage plan), then
   * calls this endpoint with the plan body to perform real provisioning.
   */
  app.post("/api/live/runs/:id/execute", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "bad run id", code: "bad-request" });
    const run = await storage.getRun(id);
    if (!run) return res.status(404).json({ error: "run not found", code: "not-found" });

    const body = parsePlanBody(req.body);
    if (!body.ok) return res.status(400).json({ error: body.error, code: "bad-request" });

    const dryRun = req.body?.dryRun !== false; /* default true */
    const confirm = typeof req.body?.confirm === "string" ? req.body.confirm.trim() : "";
    if (!dryRun) {
      const confirmRequired = process.env.DEPLOYOPS_CONFIRM_LIVE_DEPLOY !== "0";
      if (confirmRequired && confirm.toUpperCase() !== "I UNDERSTAND") {
        return res.status(400).json({
          error: "live execute confirmation phrase required",
          code: "confirmation-required",
          detail: 'Send body { confirm: "I UNDERSTAND", dryRun: false, ... } to perform real provider writes.',
        });
      }
    }
    try {
      const result = await executePlan({ ...body.value, runId: id, dryRun });
      const status = result.ok ? 200 : (result.status === "live_blocked" ? 409 : 502);
      res.status(status).json(result);
    } catch (err: any) {
      res.status(500).json({ ok: false, status: "live_failed", error: String(err?.message ?? err) });
    }
  });

  /**
   * List provisioning steps + provider resources for a run. Used by the run
   * detail page to render the live progress.
   */
  app.get("/api/live/runs/:id/steps", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "bad run id", code: "bad-request" });
    const [steps, resources] = await Promise.all([
      storage.listProvisioningSteps(id),
      storage.listProviderResources({ runId: id }),
    ]);
    res.json({
      ok: true, runId: id,
      steps: steps.map((s) => ({
        ...s,
        metadata: parseJSON<Record<string, unknown>>(s.metadata, {}),
      })),
      resources: resources.map((r) => ({
        ...r,
        metadata: parseJSON<Record<string, unknown>>(r.metadata, {}),
      })),
    });
  });

  /* ------------------------------- helpers ------------------------------- */
  /** Generate a YAML preview of the CI workflow we would write. */
  app.post("/api/preview/ci", async (req, res) => {
    const { framework = "nextjs", providers = [] } = req.body ?? {};
    const yaml = generateCiYaml(framework, providers);
    res.type("text/plain").send(yaml);
  });

  /** Suggest env vars for a (framework, providers) pair. */
  app.post("/api/preview/env", async (req, res) => {
    const { framework = "nextjs", providers = [] } = req.body ?? {};
    res.json(suggestEnv(framework, providers));
  });

  /* ------------------------- system / db info --------------------------- */
  app.get("/api/system", async (_req, res) => {
    const liveEnabled = process.env.DEPLOYOPS_LIVE === "1";
    const provs = await storage.listProviders();
    const providerLive: Record<string, boolean> = {};
    for (const p of provs) providerLive[p.key] = p.mode === "live";
    res.json({
      db: dbInfo,
      liveEnabled,
      providerModes: providerLive,
      runtime: {
        node: process.version,
        platform: process.platform,
        env: process.env.NODE_ENV ?? "development",
        host: process.env.VERCEL ? "vercel" : "node",
      },
      vercelReady: Boolean(process.env.VERCEL_ENV) || Boolean(process.env.VERCEL),
      databaseUrlPresent: Boolean(process.env.DATABASE_URL),
    });
  });

  /* ----------------------------- fix bot -------------------------------- */
  app.get("/api/fixbot/health", async (_req, res) => {
    const items = await storage.listHealthChecks();
    res.json(items);
  });

  app.post("/api/fixbot/health/:key/probe", async (req, res) => {
    const c = (await storage.listHealthChecks()).find((x) => x.key === req.params.key);
    if (!c) return res.status(404).json({ error: "check not found" });
    /* Dry-run probe: deterministic mock outcome based on existing status. */
    let detail = c.lastDetail;
    if (c.status === "down") detail = `[probe] still failing: ${c.lastDetail}`;
    else if (c.status === "warning") detail = `[probe] still degraded: ${c.lastDetail}`;
    else detail = `[probe] 200 OK · ${Math.floor(80 + Math.random() * 60)} ms`;
    const updated = await storage.updateHealthCheckStatus(c.key, c.status, detail);
    res.json(updated);
  });

  app.get("/api/fixbot/incidents", async (_req, res) => {
    const items = await storage.listIncidents();
    /* attach diagnoses + remediations counts for list view */
    const enriched = await Promise.all(items.map(async (i) => {
      const dx = await storage.listDiagnoses(i.id);
      const rx = await storage.listRemediations(i.id);
      return {
        ...i,
        signals: parseJSON<string[]>(i.signals, []),
        diagnosesCount: dx.length,
        remediationsCount: rx.length,
        topConfidence: dx[0]?.confidence ?? 0,
      };
    }));
    res.json(enriched);
  });

  app.get("/api/fixbot/incidents/:id", async (req, res) => {
    const id = Number(req.params.id);
    const inc = await storage.getIncident(id);
    if (!inc) return res.status(404).json({ error: "not found" });
    const dx = await storage.listDiagnoses(id);
    const rx = await storage.listRemediations(id);
    const audits = await storage.listAuditLogs("fixbot", id);
    res.json({
      incident: { ...inc, signals: parseJSON<string[]>(inc.signals, []) },
      diagnoses: dx.map((d) => ({ ...d, evidence: parseJSON<string[]>(d.evidence, []) })),
      remediations: rx.map((r) => ({ ...r, payload: parseJSON<Record<string, unknown>>(r.payload, {}) })),
      audits,
    });
  });

  app.post("/api/fixbot/incidents", async (req, res) => {
    const parsed = insertIncidentSchema.safeParse({
      ...req.body,
      signals: typeof req.body.signals === "string"
        ? req.body.signals
        : JSON.stringify(req.body.signals ?? []),
    });
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const inc = await storage.createIncident(parsed.data);
    await storage.createAuditLog({ scope: "fixbot", refId: inc.id, actor: "user", event: "create", detail: inc.title, mode: "dry-run" } as InsertAuditLog);
    res.json(inc);
  });

  app.post("/api/fixbot/incidents/:id/diagnose", async (req, res) => {
    const id = Number(req.params.id);
    const inc = await storage.getIncident(id);
    if (!inc) return res.status(404).json({ error: "not found" });
    const result = fixbotDiagnose(inc);
    const created = await storage.createDiagnosis({
      incidentId: id,
      rootCause: result.rootCause,
      evidence: JSON.stringify(result.evidence),
      confidence: result.confidence,
      recommendation: result.recommendation,
    });
    await storage.updateIncident(id, { status: inc.status === "open" ? "diagnosing" : inc.status });
    await storage.createAuditLog({ scope: "fixbot", refId: id, actor: "fixbot", event: "diagnose", detail: `confidence ${result.confidence}`, mode: "dry-run" } as InsertAuditLog);
    res.json({ ...created, evidence: result.evidence });
  });

  app.post("/api/fixbot/incidents/:id/autonomy", async (req, res) => {
    const id = Number(req.params.id);
    const allowed = ["diagnose-only", "prepare-fix", "approval-required", "safe-auto-fix"];
    const next = String(req.body?.autonomy);
    if (!allowed.includes(next)) return res.status(400).json({ error: "invalid autonomy" });
    const updated = await storage.updateIncident(id, { autonomy: next });
    await storage.createAuditLog({ scope: "fixbot", refId: id, actor: "user", event: "autonomy", detail: next, mode: "dry-run" } as InsertAuditLog);
    res.json(updated);
  });

  app.post("/api/fixbot/incidents/:id/status", async (req, res) => {
    const id = Number(req.params.id);
    const allowed = ["open", "diagnosing", "fix-ready", "approved", "resolved", "escalated"];
    const next = String(req.body?.status);
    if (!allowed.includes(next)) return res.status(400).json({ error: "invalid status" });
    const updated = await storage.updateIncident(id, {
      status: next,
      ...(next === "resolved" ? { resolvedAt: Date.now() } : {}),
    });
    await storage.createAuditLog({ scope: "fixbot", refId: id, actor: "user", event: "status", detail: next, mode: "dry-run" } as InsertAuditLog);
    res.json(updated);
  });

  app.post("/api/fixbot/remediations", async (req, res) => {
    const parsed = insertRemediationSchema.safeParse({
      ...req.body,
      payload: typeof req.body.payload === "string"
        ? req.body.payload
        : JSON.stringify(req.body.payload ?? {}),
    });
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const created = await storage.createRemediation(parsed.data);
    await storage.createAuditLog({ scope: "fixbot", refId: created.incidentId, actor: "user", event: "propose", detail: created.title, mode: "dry-run" } as InsertAuditLog);
    res.json(created);
  });

  app.post("/api/fixbot/remediations/:id/approve", async (req, res) => {
    const id = Number(req.params.id);
    const r = await storage.getRemediation(id);
    if (!r) return res.status(404).json({ error: "not found" });
    const updated = await storage.updateRemediation(id, { status: "approved", approvalRequired: false });
    await storage.createAuditLog({ scope: "fixbot", refId: r.incidentId, actor: "user", event: "approve", detail: r.title, mode: "dry-run" } as InsertAuditLog);
    res.json(updated);
  });

  app.post("/api/fixbot/remediations/:id/dismiss", async (req, res) => {
    const id = Number(req.params.id);
    const r = await storage.getRemediation(id);
    if (!r) return res.status(404).json({ error: "not found" });
    const updated = await storage.updateRemediation(id, { status: "dismissed" });
    await storage.createAuditLog({ scope: "fixbot", refId: r.incidentId, actor: "user", event: "dismiss", detail: r.title, mode: "dry-run" } as InsertAuditLog);
    res.json(updated);
  });

  /**
   * Apply a remediation. Defaults to dry-run unless DEPLOYOPS_LIVE=1, the
   * relevant provider is in live mode, the remediation is approved (or its
   * incident is at safe-auto-fix autonomy). Even in live mode, none of these
   * adapters perform real provider mutations in this build.
   */
  app.post("/api/fixbot/remediations/:id/apply", async (req, res) => {
    const id = Number(req.params.id);
    const r = await storage.getRemediation(id);
    if (!r) return res.status(404).json({ error: "not found" });
    const inc = await storage.getIncident(r.incidentId);
    if (!inc) return res.status(404).json({ error: "incident not found" });

    const provs = await storage.listProviders();
    const providerLive: Record<string, boolean> = {};
    for (const p of provs) providerLive[p.key] = p.mode === "live";

    const ctx: ApplyContext = {
      mode: "dry-run",
      autonomy: inc.autonomy as ApplyContext["autonomy"],
      liveEnabled: process.env.DEPLOYOPS_LIVE === "1",
      providerLive,
    };

    let result;
    try {
      switch (r.action) {
        case "open-pr":
        case "create-issue":
          result = await fixbotGitHubAction(inc, r, ctx); break;
        case "retry-deploy":
        case "update-env":
          result = await fixbotVercelAction(inc, r, ctx); break;
        case "rollback":
          result = await fixbotVercelAction(inc, r, ctx); break;
        case "run-migration":
          result = await fixbotPrismaAction(inc, r, ctx); break;
        case "escalate":
          result = await fixbotEscalate(inc, r, ctx); break;
        default:
          /* generic: smoke-test the affected target */
          result = await fixbotSmokeTest(inc, r, ctx);
      }
    } catch (err: any) {
      result = { ok: false, log: [String(err?.message ?? err)], effective: "blocked" as const };
    }

    await storage.updateRemediation(id, {
      status: result.ok ? (result.effective === "applied" ? "applied" : "running") : "failed",
      log: (r.log ? r.log + "\n\n" : "") + result.log.join("\n"),
      completedAt: Date.now(),
    });
    /* if everything else for this incident is applied/dismissed, mark fix-ready */
    const all = await storage.listRemediations(inc.id);
    const allDone = all.every((x) => x.status === "applied" || x.status === "dismissed");
    if (allDone) await storage.updateIncident(inc.id, { status: "fix-ready" });

    await storage.createAuditLog({
      scope: "fixbot", refId: inc.id, actor: "fixbot",
      event: "apply",
      detail: `${r.action} → ${result.effective}${result.reason ? ` (${result.reason})` : ""}`,
      mode: ctx.liveEnabled ? "live" : "dry-run",
    } as InsertAuditLog);

    res.json({
      ok: result.ok,
      effective: result.effective,
      reason: result.reason,
      log: result.log,
    });
  });

  /* ------------------------- migration plan ----------------------------- */
  /**
   * Migration plan checklist for moving from local SQLite to Vercel + Neon.
   * Static for now — UI displays it; a future version could persist progress.
   */
  app.get("/api/migration/plan", async (_req, res) => {
    const liveEnabled = process.env.DEPLOYOPS_LIVE === "1";
    res.json({
      backend: dbInfo,
      live: liveEnabled,
      steps: [
        { id: "neon-create",  title: "Provision Neon project", description: "Create a Neon project and a `main` branch. Note the pooled connection string.", commands: ["neonctl projects create --name deployops-console", "neonctl connection-string main --pooled --role-name app"] },
        { id: "branch-envs",  title: "Branch one Postgres database per env", description: "Create branches: production, demo, test. Each gets its own DATABASE_URL.", commands: ["neonctl branches create --name production --parent main", "neonctl branches create --name demo --parent main", "neonctl branches create --name test --parent main"] },
        { id: "schema-push",  title: "Apply schema to production", description: "Run drizzle-kit push (Postgres dialect) against the production branch's connection string.", commands: ["DATABASE_URL=postgres://... npm run db:push:pg"] },
        { id: "vercel-link",  title: "Link the repo to Vercel", description: "Import this repo on Vercel. Set the Output Directory to `dist/public` and the Build Command to `npm run build`.", commands: ["npx vercel link --yes", "npx vercel git connect"] },
        { id: "env-vars",     title: "Set env vars on Vercel", description: "Add DATABASE_URL (Neon pooled), DEPLOYOPS_LIVE (optional, '1' for live mode), VERCEL_TOKEN, NEON_API_KEY, GITHUB_TOKEN.", commands: ["npx vercel env add DATABASE_URL production", "npx vercel env add DEPLOYOPS_LIVE production", "npx vercel env add NEON_API_KEY production"] },
        { id: "install-pg",   title: "Install Postgres driver on the deploy", description: "The repo defaults to SQLite. Add the `postgres` package so the production server can use it.", commands: ["npm install postgres"] },
        { id: "deploy",       title: "First production deploy", description: "Trigger a production build on Vercel. Verify /api/system reports backend=postgres.", commands: ["npx vercel deploy --prod"] },
        { id: "validate",     title: "Cutover validation", description: "Hit /api/projects, /api/runs, /api/fixbot/incidents. Confirm seed data appears (or run a one-off migration script if importing existing SQLite data).", commands: ["curl https://your-app.vercel.app/api/system", "curl https://your-app.vercel.app/api/fixbot/incidents"] },
        { id: "rollback",     title: "Rollback guidance", description: "If the cutover fails: unset DATABASE_URL on the Vercel project, redeploy. The app falls back to SQLite (ephemeral on Vercel — only intended for local). Restore from a Neon branch snapshot if data was corrupted.", commands: ["npx vercel env rm DATABASE_URL production", "npx vercel deploy --prod"] },
      ],
    });
  });

  /* ------------------------- architecture map --------------------------- */
  /**
   * Architecture description rendered by the Production Architecture page.
   * Static description plus runtime fields from dbInfo / providers.
   */
  app.get("/api/architecture", async (_req, res) => {
    const provs = await storage.listProviders();
    res.json({
      db: dbInfo,
      live: process.env.DEPLOYOPS_LIVE === "1",
      vercelDetected: Boolean(process.env.VERCEL),
      layers: [
        { id: "edge",    label: "Vercel Edge / CDN",        detail: "Static assets and HTTP edge for the React UI. Free TLS, automatic preview URLs per branch." },
        { id: "app",     label: "Vercel Serverless / Node",  detail: "Express handler exported as a Vercel function. Runs the API + serves the SPA shell." },
        { id: "data",    label: "Neon Postgres",             detail: "Serverless Postgres with branchable databases. One branch per environment." },
        { id: "storage", label: "Object storage (optional)", detail: "Reserved for run logs / artifacts. Not in use today." },
        { id: "github",  label: "GitHub source",             detail: "Repo source of truth for projects under management. PRs and workflows authored by Fix Bot land here." },
        { id: "providers", label: "Provider adapters",       detail: provs.map((p) => `${p.name}: ${p.mode}`).join(" · ") },
      ],
      flows: [
        { from: "edge",     to: "app",      label: "HTTP request" },
        { from: "app",      to: "data",     label: "DATABASE_URL (pooled)" },
        { from: "app",      to: "github",   label: "gh CLI / Octokit" },
        { from: "app",      to: "providers",label: "dry-run by default" },
        { from: "providers", to: "data",    label: "Neon connector" },
        { from: "providers", to: "edge",    label: "Vercel deploy" },
      ],
      envVars: [
        { key: "DATABASE_URL",       required: true,  source: "neon", note: "Pooled connection string from the production branch." },
        { key: "DEPLOYOPS_LIVE",     required: false, source: "operator", note: "Set to '1' to enable live provider calls. Defaults to dry-run." },
        { key: "NEON_API_KEY",       required: false, source: "neon", note: "Used by Fix Bot to inspect/branch databases." },
        { key: "VERCEL_TOKEN",       required: false, source: "vercel", note: "Used by Fix Bot to redeploy / set env vars on managed projects." },
        { key: "GITHUB_TOKEN",       required: false, source: "github", note: "Used by Fix Bot to open issues / PRs." },
        { key: "PRISMA_API_KEY",     required: false, source: "prisma", note: "Used when Prisma Postgres is the chosen DB instead of Neon." },
        { key: "NODE_ENV",           required: false, source: "vercel", note: "Vercel sets this to 'production' automatically." },
      ],
    });
  });

  return httpServer;
}

function parsePlanBody(raw: any): { ok: true; value: import("./live-provisioning").ProvisioningPlanInput } | { ok: false; error: string } {
  const repo = String(raw?.repo ?? "").trim();
  const branch = String(raw?.branch ?? "").trim() || "main";
  const env = String(raw?.environment ?? "").trim() as "test" | "demo" | "deploy";
  const hosting = String(raw?.hosting ?? "vercel").trim() as HostingProvider;
  const database = String(raw?.database ?? "none").trim() as DatabaseProvider;
  const projectName = String(raw?.projectName ?? raw?.name ?? "").trim() || (repo.split("/")[1] ?? "deploy");
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return { ok: false, error: "repo must be owner/name" };
  if (!["test", "demo", "deploy"].includes(env)) return { ok: false, error: "environment must be test|demo|deploy" };
  if (!["vercel", "railway", "none"].includes(hosting)) return { ok: false, error: "hosting must be vercel|railway|none" };
  if (!["none", "neon", "prisma", "supabase", "railway"].includes(database)) {
    return { ok: false, error: "database must be none|neon|prisma|supabase|railway" };
  }
  let existingSupabase: any = null;
  if (raw?.existingSupabase && typeof raw.existingSupabase === "object") {
    const url = String(raw.existingSupabase.url ?? "").trim();
    const anonKey = String(raw.existingSupabase.anonKey ?? "").trim();
    if (url && anonKey) {
      existingSupabase = {
        url, anonKey,
        serviceRoleKey: typeof raw.existingSupabase.serviceRoleKey === "string" ? raw.existingSupabase.serviceRoleKey.trim() : null,
        projectRef: typeof raw.existingSupabase.projectRef === "string" ? raw.existingSupabase.projectRef.trim() : null,
      };
    }
  }
  return {
    ok: true,
    value: { repo, branch, environment: env, hosting, database, projectName, existingSupabase },
  };
}

function generateCiYaml(framework: string, providers: string[]): string {
  const usePrisma = providers.includes("prisma");
  const useNeon = providers.includes("neon");
  const useVercel = providers.includes("vercel");
  return `# .github/workflows/deployops.yml — generated by DeployOps Console
name: deployops
on:
  push:
    branches: [main, "deploy/**"]
  workflow_dispatch:
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
${useNeon ? `      - name: Branch Neon database
        run: npx neonctl branches create --name ci-\${{ github.run_id }}
        env: { NEON_API_KEY: \${{ secrets.NEON_API_KEY }} }
` : ""}${usePrisma ? `      - run: npx prisma migrate deploy
        env: { DATABASE_URL: \${{ secrets.DATABASE_URL }} }
` : ""}      - run: npm run build
${useVercel ? `      - name: Deploy to Vercel
        run: npx vercel deploy --prebuilt --token \${{ secrets.VERCEL_TOKEN }}
` : ""}      - run: curl -fsS https://\${{ vars.PREVIEW_URL }}/api/health || exit 1
`;
}

function suggestEnv(framework: string, providers: string[]) {
  const out: Array<{ key: string; source: string; required: boolean; hint: string }> = [];
  if (providers.includes("neon")) {
    out.push({ key: "DATABASE_URL", source: "neon", required: true, hint: "Pooled connection string from the env-specific Neon branch." });
    out.push({ key: "DIRECT_URL", source: "neon", required: false, hint: "Direct connection for migrations only." });
  }
  if (providers.includes("prisma")) {
    out.push({ key: "PRISMA_DB_URL", source: "prisma", required: false, hint: "If using Prisma Postgres instead of Neon." });
  }
  if (framework === "nextjs") {
    out.push({ key: "NEXTAUTH_SECRET", source: "generated", required: true, hint: "Generated server-side, 32-byte base64." });
  }
  if (framework === "node") {
    out.push({ key: "PORT", source: "static", required: true, hint: "Default 3000." });
    out.push({ key: "JWT_SECRET", source: "generated", required: true, hint: "Generated, rotated per environment." });
  }
  if (framework === "static") {
    out.push({ key: "VITE_API_BASE", source: "static", required: false, hint: "Override only when the API is on a different host." });
  }
  return out;
}
