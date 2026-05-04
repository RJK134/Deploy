import type { Express, Request, Response } from "express";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { storage } from "./storage";
import {
  insertProjectSchema, insertRunSchema, insertBlueprintSchema,
  type InsertStage,
} from "@shared/schema";
import {
  githubScan, githubGenerateCi, vercelDeploy, vercelDomain,
  neonProvision, prismaMigrate, railwayManual, smokeTest,
} from "./providers";

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
    await storage.updateRun(run.id, { status: "running", startedAt: Date.now() });
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

    /* If this was the last stage, mark run completed. */
    const remaining = (await storage.listStages(id)).filter((s) => s.status === "pending");
    if (remaining.length === 0) {
      await storage.updateRun(id, {
        status: result.ok ? "succeeded" : "failed",
        finishedAt: Date.now(),
      });
    }

    const allStages = await storage.listStages(id);
    res.json({ stage: allStages.find((s) => s.id === next.id), stages: allStages });
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

  return httpServer;
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
