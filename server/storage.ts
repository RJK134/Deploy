import {
  projects, runs, stages, blueprints, providers,
  type Project, type InsertProject,
  type Run, type InsertRun,
  type Stage, type InsertStage,
  type Blueprint, type InsertBlueprint,
  type Provider, type InsertProvider,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, asc, desc } from "drizzle-orm";

const sqlite = new Database("data.db");
sqlite.pragma("journal_mode = WAL");

/* Auto-create tables for SQLite (the template ships without migrations). */
sqlite.exec(`
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  repo TEXT NOT NULL,
  framework TEXT NOT NULL,
  build_command TEXT NOT NULL,
  output_dir TEXT NOT NULL,
  root_dir TEXT NOT NULL DEFAULT '.',
  needs_database INTEGER NOT NULL DEFAULT 0,
  orm_detected TEXT,
  env_example_json TEXT NOT NULL DEFAULT '[]',
  blueprint_id INTEGER,
  access_mode TEXT NOT NULL DEFAULT 'private',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  environment TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'dry-run',
  status TEXT NOT NULL DEFAULT 'queued',
  providers_json TEXT NOT NULL DEFAULT '[]',
  env_vars_json TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  started_at INTEGER,
  finished_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS stages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  order_idx INTEGER NOT NULL,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT NOT NULL,
  provider TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  started_at INTEGER,
  finished_at INTEGER,
  log TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS blueprints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  tagline TEXT NOT NULL,
  description TEXT NOT NULL,
  framework TEXT NOT NULL,
  providers_json TEXT NOT NULL DEFAULT '[]',
  defaults_json TEXT NOT NULL DEFAULT '{}',
  recommended INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'disconnected',
  mode TEXT NOT NULL DEFAULT 'dry-run',
  notes TEXT NOT NULL DEFAULT '',
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  last_checked INTEGER
);
`);

export const db = drizzle(sqlite);

export interface IStorage {
  /* projects */
  listProjects(): Promise<Project[]>;
  getProject(id: number): Promise<Project | undefined>;
  createProject(input: InsertProject): Promise<Project>;
  updateProject(id: number, patch: Partial<InsertProject>): Promise<Project | undefined>;
  deleteProject(id: number): Promise<void>;

  /* runs + stages */
  listRuns(): Promise<Run[]>;
  listRunsForProject(projectId: number): Promise<Run[]>;
  getRun(id: number): Promise<Run | undefined>;
  createRun(input: InsertRun): Promise<Run>;
  updateRun(id: number, patch: Partial<Run>): Promise<Run | undefined>;
  listStages(runId: number): Promise<Stage[]>;
  createStage(input: InsertStage): Promise<Stage>;
  updateStage(id: number, patch: Partial<Stage>): Promise<Stage | undefined>;

  /* blueprints */
  listBlueprints(): Promise<Blueprint[]>;
  getBlueprint(id: number): Promise<Blueprint | undefined>;
  createBlueprint(input: InsertBlueprint): Promise<Blueprint>;

  /* providers */
  listProviders(): Promise<Provider[]>;
  getProviderByKey(key: string): Promise<Provider | undefined>;
  upsertProvider(p: InsertProvider): Promise<Provider>;
  setProviderMode(key: string, mode: "dry-run" | "live"): Promise<Provider | undefined>;
}

export class DatabaseStorage implements IStorage {
  /* ----- projects ----- */
  async listProjects(): Promise<Project[]> {
    return db.select().from(projects).orderBy(desc(projects.createdAt)).all();
  }
  async getProject(id: number) {
    return db.select().from(projects).where(eq(projects.id, id)).get();
  }
  async createProject(input: InsertProject): Promise<Project> {
    return db.insert(projects).values({ ...input, createdAt: Date.now() }).returning().get();
  }
  async updateProject(id: number, patch: Partial<InsertProject>) {
    return db.update(projects).set(patch as any).where(eq(projects.id, id)).returning().get();
  }
  async deleteProject(id: number) {
    db.delete(projects).where(eq(projects.id, id)).run();
  }

  /* ----- runs + stages ----- */
  async listRuns() {
    return db.select().from(runs).orderBy(desc(runs.createdAt)).all();
  }
  async listRunsForProject(projectId: number) {
    return db.select().from(runs).where(eq(runs.projectId, projectId)).orderBy(desc(runs.createdAt)).all();
  }
  async getRun(id: number) {
    return db.select().from(runs).where(eq(runs.id, id)).get();
  }
  async createRun(input: InsertRun): Promise<Run> {
    return db.insert(runs).values({ ...input, createdAt: Date.now() }).returning().get();
  }
  async updateRun(id: number, patch: Partial<Run>) {
    return db.update(runs).set(patch as any).where(eq(runs.id, id)).returning().get();
  }
  async listStages(runId: number) {
    return db.select().from(stages).where(eq(stages.runId, runId)).orderBy(asc(stages.order)).all();
  }
  async createStage(input: InsertStage): Promise<Stage> {
    return db.insert(stages).values(input).returning().get();
  }
  async updateStage(id: number, patch: Partial<Stage>) {
    return db.update(stages).set(patch as any).where(eq(stages.id, id)).returning().get();
  }

  /* ----- blueprints ----- */
  async listBlueprints() {
    return db.select().from(blueprints).orderBy(desc(blueprints.recommended)).all();
  }
  async getBlueprint(id: number) {
    return db.select().from(blueprints).where(eq(blueprints.id, id)).get();
  }
  async createBlueprint(input: InsertBlueprint): Promise<Blueprint> {
    return db.insert(blueprints).values(input).returning().get();
  }

  /* ----- providers ----- */
  async listProviders() {
    return db.select().from(providers).orderBy(asc(providers.id)).all();
  }
  async getProviderByKey(key: string) {
    return db.select().from(providers).where(eq(providers.key, key)).get();
  }
  async upsertProvider(p: InsertProvider): Promise<Provider> {
    const existing = await this.getProviderByKey(p.key);
    if (existing) {
      return db.update(providers)
        .set({ ...p, lastChecked: Date.now() } as any)
        .where(eq(providers.id, existing.id))
        .returning().get();
    }
    return db.insert(providers).values({ ...p, lastChecked: Date.now() }).returning().get();
  }
  async setProviderMode(key: string, mode: "dry-run" | "live") {
    const existing = await this.getProviderByKey(key);
    if (!existing) return undefined;
    return db.update(providers).set({ mode }).where(eq(providers.id, existing.id)).returning().get();
  }
}

export const storage = new DatabaseStorage();

/* ---------------------------- seed default data --------------------------- */
async function seed() {
  const provs = await storage.listProviders();
  if (provs.length === 0) {
    const defaults: InsertProvider[] = [
      {
        key: "github", name: "GitHub", status: "connected", mode: "dry-run",
        notes: "Available via gh + git CLIs server-side. Read-only repo discovery is safe; write actions require explicit live mode.",
        capabilities: JSON.stringify(["list-repos", "scan-framework", "read-env-example", "open-pr", "trigger-workflow"]),
      },
      {
        key: "vercel", name: "Vercel", status: "connected", mode: "dry-run",
        notes: "Available via `npx vercel --token` server-side. Live deploys disabled until you flip the mode switch.",
        capabilities: JSON.stringify(["link-project", "set-env", "deploy", "promote", "domains"]),
      },
      {
        key: "neon", name: "Neon Postgres", status: "connected", mode: "dry-run",
        notes: "Connected via Pipedream. Default mode runs query plans against a planning sandbox; no schema mutations until live.",
        capabilities: JSON.stringify(["execute-query", "find-row", "insert-row", "branch-database"]),
      },
      {
        key: "prisma", name: "Prisma Postgres", status: "connected", mode: "dry-run",
        notes: "Prisma Management API connected. Can create databases, regions, connection strings — guarded behind live mode.",
        capabilities: JSON.stringify(["list-projects", "create-database", "create-conn-string", "list-regions"]),
      },
      {
        key: "railway", name: "Railway", status: "disconnected", mode: "dry-run",
        notes: "No managed connector. Provide a Railway API token in Settings to enable. Manual CLI guidance is offered as a fallback.",
        capabilities: JSON.stringify(["template-link", "manual-cli-guide"]),
      },
    ];
    for (const p of defaults) await storage.upsertProvider(p);
  }

  const bps = await storage.listBlueprints();
  if (bps.length === 0) {
    const defaults: InsertBlueprint[] = [
      {
        slug: "next-prisma-neon-vercel",
        name: "Next.js + Prisma + Neon on Vercel",
        tagline: "Full-stack app with Postgres branch per environment.",
        description: "Wires GitHub → Vercel for the app, Neon (branched per env) for Postgres, and Prisma for migrations. Env vars resolve automatically.",
        framework: "nextjs",
        providers: JSON.stringify(["github", "vercel", "neon", "prisma"]),
        defaults: JSON.stringify({
          buildCommand: "next build",
          outputDir: ".next",
          install: "npm ci",
          envSuggestions: ["DATABASE_URL", "DIRECT_URL", "NEXTAUTH_SECRET"],
        }),
        recommended: true,
      },
      {
        slug: "node-api-neon-railway",
        name: "Node API + Neon on Railway",
        tagline: "Backend service with managed Postgres.",
        description: "Containerizes a Node API on Railway (manual fallback CLI), with Neon as the database. CI workflow and health checks generated for you.",
        framework: "node",
        providers: JSON.stringify(["github", "neon", "railway"]),
        defaults: JSON.stringify({
          buildCommand: "npm run build",
          outputDir: "dist",
          install: "npm ci",
          envSuggestions: ["DATABASE_URL", "PORT", "LOG_LEVEL"],
        }),
        recommended: true,
      },
      {
        slug: "static-vercel",
        name: "Static UI on Vercel",
        tagline: "Pure frontend or static site, minimum config.",
        description: "Detects Vite/Astro/SvelteKit/CRA. No database. Deploys to Vercel with preview URLs per branch, optional custom domain on Deploy.",
        framework: "static",
        providers: JSON.stringify(["github", "vercel"]),
        defaults: JSON.stringify({
          buildCommand: "npm run build",
          outputDir: "dist",
          install: "npm ci",
          envSuggestions: ["VITE_API_BASE"],
        }),
        recommended: true,
      },
      {
        slug: "astro-prisma-neon",
        name: "Astro + Prisma + Neon",
        tagline: "Content site with a content DB.",
        description: "Astro on Vercel with Prisma + Neon. Useful for marketing sites that need light backend storage.",
        framework: "astro",
        providers: JSON.stringify(["github", "vercel", "neon", "prisma"]),
        defaults: JSON.stringify({
          buildCommand: "astro build",
          outputDir: "dist",
          install: "npm ci",
          envSuggestions: ["DATABASE_URL", "PUBLIC_SITE_URL"],
        }),
        recommended: false,
      },
    ];
    for (const b of defaults) await storage.createBlueprint(b);
  }

  const projs = await storage.listProjects();
  if (projs.length === 0) {
    const sample1 = await storage.createProject({
      name: "marketing-site",
      repo: "acme-school/marketing-site",
      framework: "nextjs",
      buildCommand: "next build",
      outputDir: ".next",
      rootDir: ".",
      needsDatabase: true,
      ormDetected: "prisma",
      envExample: JSON.stringify(["DATABASE_URL", "DIRECT_URL", "NEXTAUTH_SECRET"]),
      blueprintId: null as any,
      accessMode: "client",
    } as InsertProject);

    const sample2 = await storage.createProject({
      name: "api-gateway",
      repo: "acme-school/api-gateway",
      framework: "node",
      buildCommand: "npm run build",
      outputDir: "dist",
      rootDir: "services/api",
      needsDatabase: true,
      ormDetected: "drizzle",
      envExample: JSON.stringify(["DATABASE_URL", "PORT", "JWT_SECRET"]),
      blueprintId: null as any,
      accessMode: "private",
    } as InsertProject);

    const sample3 = await storage.createProject({
      name: "lesson-portal",
      repo: "acme-school/lesson-portal",
      framework: "static",
      buildCommand: "npm run build",
      outputDir: "dist",
      rootDir: ".",
      needsDatabase: false,
      ormDetected: null as any,
      envExample: JSON.stringify(["VITE_API_BASE"]),
      blueprintId: null as any,
      accessMode: "public",
    } as InsertProject);

    /* one demo run with stages already advanced */
    const run = await storage.createRun({
      projectId: sample1.id,
      environment: "demo",
      mode: "dry-run",
      status: "succeeded",
      providers: JSON.stringify(["github", "vercel", "neon", "prisma"]),
      envVars: JSON.stringify([
        { key: "DATABASE_URL", value: "postgresql://···@ep-demo-1234.neon.tech/db", source: "neon" },
        { key: "NEXTAUTH_SECRET", value: "dop_•••••••••••••••", source: "generated" },
      ]),
      notes: "Initial demo deploy seeded for the dashboard.",
    } as InsertRun);

    const stagePlan = [
      { key: "scan", label: "Scan repository", description: "Read package.json, detect framework + ORM, parse .env.example.", provider: "github" },
      { key: "env", label: "Resolve env vars", description: "Cross-reference required vars with provider outputs and existing secrets.", provider: null },
      { key: "db",  label: "Provision database", description: "Branch a Neon database (or create a Prisma DB) for the target environment.", provider: "neon" },
      { key: "migrate", label: "Run migrations", description: "Apply Prisma migrations against the new branch using a transactional shadow DB.", provider: "prisma" },
      { key: "ci",  label: "Generate CI workflow", description: "Write a `.github/workflows/deployops.yml` that mirrors this plan in CI.", provider: "github" },
      { key: "deploy", label: "Deploy to Vercel", description: "Link the project, push env vars, and trigger a Vercel preview build.", provider: "vercel" },
      { key: "domain", label: "Wire domain & access", description: "Attach the preview/demo subdomain and apply the access policy.", provider: "vercel" },
      { key: "smoke", label: "Smoke test", description: "Hit / and /api/health, verify 200 + JSON shape, capture response time.", provider: null },
    ] as const;

    let ord = 0;
    for (const s of stagePlan) {
      await storage.createStage({
        runId: run.id,
        order: ord++,
        key: s.key,
        label: s.label,
        description: s.description,
        provider: s.provider as any,
        status: "succeeded",
        log: `[dry-run] ${s.label} simulated successfully.`,
      } as InsertStage);
    }
    await storage.updateRun(run.id, { startedAt: Date.now() - 1000 * 60 * 7, finishedAt: Date.now() - 1000 * 60 * 2 });

    /* a second run, in progress */
    const run2 = await storage.createRun({
      projectId: sample2.id,
      environment: "test",
      mode: "dry-run",
      status: "running",
      providers: JSON.stringify(["github", "neon"]),
      envVars: JSON.stringify([{ key: "DATABASE_URL", value: "postgresql://···@ep-test-9911.neon.tech/db", source: "neon" }]),
      notes: "Validating new auth middleware against test env.",
    } as InsertRun);
    const plan2 = [
      { key: "scan", label: "Scan repository", description: "Read package.json + service manifest.", provider: "github", status: "succeeded" },
      { key: "env", label: "Resolve env vars", description: "Required vars detected: DATABASE_URL, JWT_SECRET, PORT.", provider: null, status: "succeeded" },
      { key: "db",  label: "Provision database", description: "Branch Neon test database.", provider: "neon", status: "running" },
      { key: "migrate", label: "Run migrations", description: "drizzle-kit push.", provider: null, status: "pending" },
      { key: "ci",  label: "Generate CI workflow", description: "Write ci.yml.", provider: "github", status: "pending" },
      { key: "deploy", label: "Deploy build", description: "Build container, register with Railway via manual fallback.", provider: "railway", status: "pending" },
      { key: "smoke", label: "Smoke test", description: "Health check.", provider: null, status: "pending" },
    ] as const;
    let ord2 = 0;
    for (const s of plan2) {
      await storage.createStage({
        runId: run2.id, order: ord2++, key: s.key, label: s.label,
        description: s.description, provider: s.provider as any, status: s.status as any,
        log: s.status === "succeeded" ? `[dry-run] ${s.label} simulated successfully.` : "",
      } as InsertStage);
    }
    await storage.updateRun(run2.id, { startedAt: Date.now() - 1000 * 60 * 3 });
  }
}

seed().catch((err) => {
  console.error("seed failed", err);
});
