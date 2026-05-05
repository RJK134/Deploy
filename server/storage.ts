import {
  projects, runs, stages, blueprints, providers,
  healthChecks, incidents, diagnoses, remediations, auditLogs,
  githubRepos, providerConnections, connectionEvents,
  type Project, type InsertProject,
  type Run, type InsertRun,
  type Stage, type InsertStage,
  type Blueprint, type InsertBlueprint,
  type Provider, type InsertProvider,
  type HealthCheck, type InsertHealthCheck,
  type Incident, type InsertIncident,
  type Diagnosis, type InsertDiagnosis,
  type Remediation, type InsertRemediation,
  type AuditLog, type InsertAuditLog,
  type InsertGithubRepo, type GithubRepoRow,
  type ProviderConnection, type InsertProviderConnection,
  type ConnectionEvent, type InsertConnectionEvent,
} from "@shared/schema";
import { eq, asc, desc } from "drizzle-orm";
import { db, dbInfo } from "./db";

export { db, dbInfo };

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

  /* fix bot — health checks */
  listHealthChecks(): Promise<HealthCheck[]>;
  upsertHealthCheck(c: InsertHealthCheck): Promise<HealthCheck>;
  updateHealthCheckStatus(key: string, status: string, detail: string): Promise<HealthCheck | undefined>;

  /* fix bot — incidents */
  listIncidents(): Promise<Incident[]>;
  getIncident(id: number): Promise<Incident | undefined>;
  createIncident(i: InsertIncident): Promise<Incident>;
  updateIncident(id: number, patch: Partial<Incident>): Promise<Incident | undefined>;

  /* fix bot — diagnoses */
  listDiagnoses(incidentId: number): Promise<Diagnosis[]>;
  createDiagnosis(d: InsertDiagnosis): Promise<Diagnosis>;

  /* fix bot — remediations */
  listRemediations(incidentId: number): Promise<Remediation[]>;
  getRemediation(id: number): Promise<Remediation | undefined>;
  createRemediation(r: InsertRemediation): Promise<Remediation>;
  updateRemediation(id: number, patch: Partial<Remediation>): Promise<Remediation | undefined>;

  /* audit logs */
  listAuditLogs(scope?: string, refId?: number): Promise<AuditLog[]>;
  createAuditLog(a: InsertAuditLog): Promise<AuditLog>;

  /* github repo cache */
  listGithubRepos(): Promise<GithubRepoRow[]>;
  upsertGithubRepo(r: InsertGithubRepo): Promise<GithubRepoRow>;
  pruneGithubRepos(keepFullNames: string[]): Promise<number>;

  /* provider connections */
  listProviderConnections(): Promise<ProviderConnection[]>;
  getProviderConnection(provider: string): Promise<ProviderConnection | undefined>;
  upsertProviderConnection(c: InsertProviderConnection): Promise<ProviderConnection>;
  deleteProviderConnection(provider: string): Promise<void>;

  /* connection events */
  listConnectionEvents(provider?: string, limit?: number): Promise<ConnectionEvent[]>;
  createConnectionEvent(e: InsertConnectionEvent): Promise<ConnectionEvent>;
}

export class DatabaseStorage implements IStorage {
  /* ----- projects ----- */
  async listProjects(): Promise<Project[]> {
    return db.select().from(projects).orderBy(desc(projects.createdAt)).all();
  }
  async getProject(id: number): Promise<Project | undefined> {
    return db.select().from(projects).where(eq(projects.id, id)).get();
  }
  async createProject(input: InsertProject): Promise<Project> {
    return db.insert(projects).values({ ...input, createdAt: Date.now() }).returning().get();
  }
  async updateProject(id: number, patch: Partial<InsertProject>): Promise<Project | undefined> {
    return db.update(projects).set(patch as any).where(eq(projects.id, id)).returning().get();
  }
  async deleteProject(id: number) {
    db.delete(projects).where(eq(projects.id, id)).run();
  }

  /* ----- runs + stages ----- */
  async listRuns(): Promise<Run[]> {
    return db.select().from(runs).orderBy(desc(runs.createdAt)).all();
  }
  async listRunsForProject(projectId: number): Promise<Run[]> {
    return db.select().from(runs).where(eq(runs.projectId, projectId)).orderBy(desc(runs.createdAt)).all();
  }
  async getRun(id: number): Promise<Run | undefined> {
    return db.select().from(runs).where(eq(runs.id, id)).get();
  }
  async createRun(input: InsertRun): Promise<Run> {
    return db.insert(runs).values({ ...input, createdAt: Date.now() }).returning().get();
  }
  async updateRun(id: number, patch: Partial<Run>): Promise<Run | undefined> {
    return db.update(runs).set(patch as any).where(eq(runs.id, id)).returning().get();
  }
  async listStages(runId: number): Promise<Stage[]> {
    return db.select().from(stages).where(eq(stages.runId, runId)).orderBy(asc(stages.order)).all();
  }
  async createStage(input: InsertStage): Promise<Stage> {
    return db.insert(stages).values(input).returning().get();
  }
  async updateStage(id: number, patch: Partial<Stage>): Promise<Stage | undefined> {
    return db.update(stages).set(patch as any).where(eq(stages.id, id)).returning().get();
  }

  /* ----- blueprints ----- */
  async listBlueprints(): Promise<Blueprint[]> {
    return db.select().from(blueprints).orderBy(desc(blueprints.recommended)).all();
  }
  async getBlueprint(id: number): Promise<Blueprint | undefined> {
    return db.select().from(blueprints).where(eq(blueprints.id, id)).get();
  }
  async createBlueprint(input: InsertBlueprint): Promise<Blueprint> {
    return db.insert(blueprints).values(input).returning().get();
  }

  /* ----- providers ----- */
  async listProviders(): Promise<Provider[]> {
    return db.select().from(providers).orderBy(asc(providers.id)).all();
  }
  async getProviderByKey(key: string): Promise<Provider | undefined> {
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
  async setProviderMode(key: string, mode: "dry-run" | "live"): Promise<Provider | undefined> {
    const existing = await this.getProviderByKey(key);
    if (!existing) return undefined;
    return db.update(providers).set({ mode }).where(eq(providers.id, existing.id)).returning().get();
  }

  /* ----- fix bot: health checks ----- */
  async listHealthChecks(): Promise<HealthCheck[]> {
    return db.select().from(healthChecks).orderBy(asc(healthChecks.id)).all();
  }
  async upsertHealthCheck(c: InsertHealthCheck): Promise<HealthCheck> {
    const existing = db.select().from(healthChecks).where(eq(healthChecks.key, c.key)).get();
    if (existing) {
      return db.update(healthChecks).set(c as any).where(eq(healthChecks.id, existing.id)).returning().get();
    }
    return db.insert(healthChecks).values({ ...c, lastObservedAt: Date.now() }).returning().get();
  }
  async updateHealthCheckStatus(key: string, status: string, detail: string): Promise<HealthCheck | undefined> {
    const existing = db.select().from(healthChecks).where(eq(healthChecks.key, key)).get();
    if (!existing) return undefined;
    return db.update(healthChecks)
      .set({ status, lastDetail: detail, lastObservedAt: Date.now() } as any)
      .where(eq(healthChecks.id, existing.id))
      .returning().get();
  }

  /* ----- fix bot: incidents ----- */
  async listIncidents(): Promise<Incident[]> {
    return db.select().from(incidents).orderBy(desc(incidents.detectedAt)).all();
  }
  async getIncident(id: number): Promise<Incident | undefined> {
    return db.select().from(incidents).where(eq(incidents.id, id)).get();
  }
  async createIncident(i: InsertIncident): Promise<Incident> {
    return db.insert(incidents).values({ ...i, detectedAt: Date.now() }).returning().get();
  }
  async updateIncident(id: number, patch: Partial<Incident>): Promise<Incident | undefined> {
    return db.update(incidents).set(patch as any).where(eq(incidents.id, id)).returning().get();
  }

  /* ----- fix bot: diagnoses ----- */
  async listDiagnoses(incidentId: number): Promise<Diagnosis[]> {
    return db.select().from(diagnoses).where(eq(diagnoses.incidentId, incidentId)).orderBy(desc(diagnoses.createdAt)).all();
  }
  async createDiagnosis(d: InsertDiagnosis): Promise<Diagnosis> {
    return db.insert(diagnoses).values({ ...d, createdAt: Date.now() }).returning().get();
  }

  /* ----- fix bot: remediations ----- */
  async listRemediations(incidentId: number): Promise<Remediation[]> {
    return db.select().from(remediations).where(eq(remediations.incidentId, incidentId)).orderBy(asc(remediations.id)).all();
  }
  async getRemediation(id: number): Promise<Remediation | undefined> {
    return db.select().from(remediations).where(eq(remediations.id, id)).get();
  }
  async createRemediation(r: InsertRemediation): Promise<Remediation> {
    return db.insert(remediations).values({ ...r, createdAt: Date.now() }).returning().get();
  }
  async updateRemediation(id: number, patch: Partial<Remediation>): Promise<Remediation | undefined> {
    return db.update(remediations).set(patch as any).where(eq(remediations.id, id)).returning().get();
  }

  /* ----- audit logs ----- */
  async listAuditLogs(scope?: string, refId?: number): Promise<AuditLog[]> {
    const all = db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).all() as AuditLog[];
    return all.filter((a) =>
      (scope === undefined || a.scope === scope) &&
      (refId === undefined || a.refId === refId)
    );
  }
  async createAuditLog(a: InsertAuditLog): Promise<AuditLog> {
    return db.insert(auditLogs).values({ ...a, createdAt: Date.now() }).returning().get();
  }

  /* ----- github repo cache ----- */
  async listGithubRepos(): Promise<GithubRepoRow[]> {
    /* Sort by pushedAt desc; nulls last. */
    const rows = db.select().from(githubRepos).all() as GithubRepoRow[];
    return rows.sort((a, b) => {
      const A = a.pushedAt ? Date.parse(a.pushedAt) : 0;
      const B = b.pushedAt ? Date.parse(b.pushedAt) : 0;
      return B - A;
    });
  }
  async upsertGithubRepo(r: InsertGithubRepo): Promise<GithubRepoRow> {
    const existing = db.select().from(githubRepos).where(eq(githubRepos.fullName, r.fullName)).get() as GithubRepoRow | undefined;
    if (existing) {
      return db.update(githubRepos)
        .set({ ...r, cachedAt: Date.now() } as any)
        .where(eq(githubRepos.id, existing.id))
        .returning().get();
    }
    return db.insert(githubRepos).values({ ...r, cachedAt: Date.now() }).returning().get();
  }
  async pruneGithubRepos(keepFullNames: string[]): Promise<number> {
    const all = await this.listGithubRepos();
    const keep = new Set(keepFullNames);
    let removed = 0;
    for (const row of all) {
      if (!keep.has(row.fullName)) {
        db.delete(githubRepos).where(eq(githubRepos.id, row.id)).run();
        removed++;
      }
    }
    return removed;
  }

  /* ----- provider connections ----- */
  async listProviderConnections(): Promise<ProviderConnection[]> {
    return db.select().from(providerConnections).orderBy(asc(providerConnections.id)).all();
  }
  async getProviderConnection(provider: string): Promise<ProviderConnection | undefined> {
    return db.select().from(providerConnections).where(eq(providerConnections.provider, provider)).get();
  }
  async upsertProviderConnection(c: InsertProviderConnection): Promise<ProviderConnection> {
    const now = Date.now();
    const existing = await this.getProviderConnection(c.provider);
    if (existing) {
      return db.update(providerConnections)
        .set({ ...c, updatedAt: now } as any)
        .where(eq(providerConnections.id, existing.id))
        .returning().get();
    }
    return db.insert(providerConnections)
      .values({ ...c, createdAt: now, updatedAt: now } as any)
      .returning().get();
  }
  async deleteProviderConnection(provider: string): Promise<void> {
    db.delete(providerConnections).where(eq(providerConnections.provider, provider)).run();
  }

  /* ----- connection events ----- */
  async listConnectionEvents(provider?: string, limit = 100): Promise<ConnectionEvent[]> {
    const all = db.select().from(connectionEvents).orderBy(desc(connectionEvents.createdAt)).all() as ConnectionEvent[];
    const filtered = provider ? all.filter((e) => e.provider === provider) : all;
    return filtered.slice(0, limit);
  }
  async createConnectionEvent(e: InsertConnectionEvent): Promise<ConnectionEvent> {
    return db.insert(connectionEvents).values({ ...e, createdAt: Date.now() } as any).returning().get();
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

  /* ---------------- fix bot seed: health checks + incidents -------------- */
  const checks = await storage.listHealthChecks();
  if (checks.length === 0) {
    const seedChecks: InsertHealthCheck[] = [
      { key: "marketing-site-prod",   name: "marketing-site / prod",      kind: "http",      target: "https://marketing-site.app/api/health",        status: "ok",      intervalSec: 60,  lastDetail: "200 OK · 142 ms" },
      { key: "marketing-site-demo",   name: "marketing-site / demo",      kind: "http",      target: "https://marketing-site-demo.vercel.app",       status: "warning", intervalSec: 60,  lastDetail: "200 OK but DATABASE_URL missing in env preview build" },
      { key: "api-gateway-test",      name: "api-gateway / test",         kind: "http",      target: "https://api-gateway-test.up.railway.app/health",status: "down",    intervalSec: 60,  lastDetail: "ECONNREFUSED · last good 14m ago" },
      { key: "lesson-portal-prod",    name: "lesson-portal / prod",       kind: "domain",    target: "lesson-portal.app",                            status: "warning", intervalSec: 300, lastDetail: "DNS resolves but TLS cert missing on apex" },
      { key: "marketing-prisma-prod", name: "Prisma migration · prod",    kind: "migration", target: "prisma migrate deploy",                        status: "down",    intervalSec: 300, lastDetail: "20240501_add_lessons.sql failed: column 'title' is of type integer" },
      { key: "ci-deployops",          name: "GitHub Actions · deployops", kind: "workflow",  target: ".github/workflows/deployops.yml",              status: "warning", intervalSec: 300, lastDetail: "build step failed on Node 18 — workflow pins outdated runner" },
      { key: "vercel-marketing-build",name: "Vercel build · marketing",   kind: "build",     target: "marketing-site / preview",                     status: "down",    intervalSec: 300, lastDetail: "Build failed: cannot find module 'next' (missing dependency in lockfile)" },
    ];
    for (const c of seedChecks) await storage.upsertHealthCheck(c);
  }

  const inc = await storage.listIncidents();
  if (inc.length === 0) {
    const i1 = await storage.createIncident({
      projectId: null as any, runId: null as any,
      title: "Vercel build failure: missing 'next' dependency",
      category: "build", severity: "critical", status: "fix-ready",
      autonomy: "approval-required", source: "fixbot",
      summary: "Latest preview build for marketing-site failed during install. Lockfile out of sync with package.json — `next` missing from node_modules at build time.",
      signals: JSON.stringify([
        "[vercel] Cloning github.com/acme-school/marketing-site (Branch: deploy/preview)",
        "[vercel] Installing dependencies via npm ci",
        "[vercel] npm ERR! cannot find module 'next'",
        "[vercel] Build exit code: 1",
      ]),
    } as InsertIncident);
    await storage.createDiagnosis({
      incidentId: i1.id,
      rootCause: "package-lock.json out of sync after a manual edit to package.json — `next` declared but never installed locally before commit.",
      evidence: JSON.stringify([
        "package.json declares next@14.2.5",
        "package-lock.json has no entry for `next`",
        "vercel install log: `npm ci` failure points at lockfile mismatch",
      ]),
      confidence: 92,
      recommendation: "Open a PR that runs `npm install` locally and commits the regenerated lockfile, then trigger a redeploy.",
    } as InsertDiagnosis);
    await storage.createRemediation({
      incidentId: i1.id, action: "open-pr", title: "Regenerate package-lock.json and add next@14.2.5",
      description: "Branch fixbot/relock-marketing-site, commit npm install output, open PR with diagnosis + suggested CI gate.",
      status: "proposed", approvalRequired: true,
      payload: JSON.stringify({ branch: "fixbot/relock-marketing-site", base: "main", title: "fix: regenerate lockfile after next dependency add", checklist: ["npm install","commit package-lock.json","ensure preview deploy succeeds"] }),
    } as InsertRemediation);
    await storage.createRemediation({
      incidentId: i1.id, action: "retry-deploy", title: "Retry Vercel preview after PR merges",
      description: "Trigger a fresh preview deploy once the lockfile PR lands.",
      status: "proposed", approvalRequired: true,
      payload: JSON.stringify({ provider: "vercel", project: "marketing-site", env: "preview" }),
    } as InsertRemediation);

    const i2 = await storage.createIncident({
      projectId: null as any, runId: null as any,
      title: "Missing DATABASE_URL on demo env",
      category: "env", severity: "warning", status: "diagnosing",
      autonomy: "prepare-fix", source: "fixbot",
      summary: "marketing-site/demo started returning 500 on /api/lessons. Probe shows DATABASE_URL not present in Vercel demo env vars.",
      signals: JSON.stringify([
        "[vercel] env ls preview → DATABASE_URL not present",
        "[smoke] GET /api/lessons → 500 'cannot connect to database'",
      ]),
    } as InsertIncident);
    await storage.createDiagnosis({
      incidentId: i2.id,
      rootCause: "Demo env was provisioned before Neon branch was attached. DATABASE_URL never propagated to Vercel preview env.",
      evidence: JSON.stringify([
        "Neon: branch `br-marketing-demo` exists and is healthy",
        "Vercel: demo env has 7 vars; DATABASE_URL absent",
      ]),
      confidence: 88,
      recommendation: "Use the Neon adapter to fetch the pooled connection string and write it to the Vercel demo env via `vercel env add` (dry-run by default).",
    } as InsertDiagnosis);
    await storage.createRemediation({
      incidentId: i2.id, action: "update-env", title: "Set DATABASE_URL in Vercel · demo",
      description: "Pull pooled connection string from Neon branch `br-marketing-demo`, write to Vercel preview env.",
      status: "proposed", approvalRequired: true,
      payload: JSON.stringify({ provider: "vercel", env: "preview", key: "DATABASE_URL", source: "neon:br-marketing-demo" }),
    } as InsertRemediation);

    const i3 = await storage.createIncident({
      projectId: null as any, runId: null as any,
      title: "Prisma migration failed in prod",
      category: "migration", severity: "critical", status: "diagnosing",
      autonomy: "approval-required", source: "fixbot",
      summary: "20240501_add_lessons failed at column conversion. Prod is running last good schema, but new feature flag is gated behind this migration.",
      signals: JSON.stringify([
        "[prisma] Applying migration 20240501_add_lessons",
        "[postgres] ERROR: column 'title' is of type integer but expression is of type text",
        "[prisma] migrate deploy exited 1 — applied=4, failed=1",
      ]),
    } as InsertIncident);
    await storage.createDiagnosis({
      incidentId: i3.id,
      rootCause: "An earlier migration created `lessons.title` as integer; the new migration assumes text. Type mismatch fails on ALTER.",
      evidence: JSON.stringify([
        "Prior migration 20240412_init: title INTEGER",
        "New migration 20240501_add_lessons: ALTER COLUMN title TYPE TEXT — uses USING title::text but encounters NOT NULL constraint",
      ]),
      confidence: 71,
      recommendation: "Author a corrective migration: drop the NOT NULL temporarily, run the type change, repopulate, restore the NOT NULL. Run on a Neon branch first.",
    } as InsertDiagnosis);
    await storage.createRemediation({
      incidentId: i3.id, action: "run-migration", title: "Generate corrective migration",
      description: "Create 20240502_fix_lessons_title.sql that handles the existing data and runs cleanly.",
      status: "proposed", approvalRequired: true,
      payload: JSON.stringify({ provider: "prisma", action: "create-migration", sketchedSql: "ALTER TABLE lessons ALTER COLUMN title DROP NOT NULL; UPDATE lessons SET title=title::text WHERE title IS NOT NULL; ALTER TABLE lessons ALTER COLUMN title SET NOT NULL;" }),
    } as InsertRemediation);
    await storage.createRemediation({
      incidentId: i3.id, action: "escalate", title: "Page on-call DBA",
      description: "Schema rewrite touches a load-bearing column. Confirm with on-call before applying to prod.",
      status: "proposed", approvalRequired: true,
      payload: JSON.stringify({ channel: "#oncall-data" }),
    } as InsertRemediation);

    const i4 = await storage.createIncident({
      projectId: null as any, runId: null as any,
      title: "lesson-portal apex domain missing TLS certificate",
      category: "domain", severity: "warning", status: "fix-ready",
      autonomy: "safe-auto-fix", source: "fixbot",
      summary: "lesson-portal.app DNS resolves but the apex domain has no Vercel certificate provisioned. www subdomain is fine.",
      signals: JSON.stringify([
        "[probe] GET https://lesson-portal.app → SSL_ERROR_NO_CYPHER_OVERLAP",
        "[vercel] domains inspect lesson-portal.app → certNotFound",
      ]),
    } as InsertIncident);
    await storage.createDiagnosis({
      incidentId: i4.id,
      rootCause: "Apex never had `vercel domains add` invoked. Cert auto-renewal only triggers after the domain is attached to a project.",
      evidence: JSON.stringify([
        "Vercel: project lesson-portal has 1 domain (www.lesson-portal.app)",
        "Cert: missing for apex",
      ]),
      confidence: 96,
      recommendation: "Run `vercel domains add lesson-portal.app` against the lesson-portal project. This is idempotent and safe to auto-apply at the safe-auto-fix autonomy level.",
    } as InsertDiagnosis);
    await storage.createRemediation({
      incidentId: i4.id, action: "update-env", title: "Attach apex domain to project",
      description: "Run vercel domains add lesson-portal.app on lesson-portal project.",
      status: "proposed", approvalRequired: false,
      payload: JSON.stringify({ provider: "vercel", action: "domains-add", domain: "lesson-portal.app" }),
    } as InsertRemediation);

    const i5 = await storage.createIncident({
      projectId: null as any, runId: null as any,
      title: "GitHub Actions: deployops workflow failing on Node 18",
      category: "ci", severity: "warning", status: "open",
      autonomy: "diagnose-only", source: "fixbot",
      summary: "deployops.yml pins actions/setup-node to 18. Repo dependencies now require Node 20 for `node:test`. Last 4 runs failed at install.",
      signals: JSON.stringify([
        "[gh] workflow run 1.4k failed on `npm ci` step",
        "[gh] error: `node:test` requires Node 20",
        "[gh] runner: ubuntu-latest, node: 18.20.4",
      ]),
    } as InsertIncident);
    await storage.createDiagnosis({
      incidentId: i5.id,
      rootCause: "Workflow runner pinned to Node 18 while package.json engines field requires >=20.",
      evidence: JSON.stringify([
        ".github/workflows/deployops.yml: with: { node-version: 20 } missing",
        "package.json engines.node: '>=20'",
      ]),
      confidence: 84,
      recommendation: "Open a PR bumping setup-node to v20 (and remove pin entirely once tested). Ship behind diagnose-only autonomy until reviewer approves.",
    } as InsertDiagnosis);
    await storage.createRemediation({
      incidentId: i5.id, action: "create-issue", title: "File issue: bump CI to Node 20",
      description: "Open a tracked issue describing the failure pattern and proposed fix.",
      status: "proposed", approvalRequired: true,
      payload: JSON.stringify({ repo: "acme-school/marketing-site", labels: ["ci","reliability"] }),
    } as InsertRemediation);

    /* audit log seed */
    for (const e of [
      { scope: "fixbot", refId: i1.id, actor: "fixbot", event: "diagnose", detail: "Confidence 92 — lockfile drift", mode: "dry-run" as const },
      { scope: "fixbot", refId: i1.id, actor: "fixbot", event: "propose", detail: "open-pr fixbot/relock-marketing-site", mode: "dry-run" as const },
      { scope: "fixbot", refId: i2.id, actor: "fixbot", event: "diagnose", detail: "DATABASE_URL absent in vercel preview env", mode: "dry-run" as const },
      { scope: "fixbot", refId: i3.id, actor: "fixbot", event: "diagnose", detail: "Prisma migration type mismatch", mode: "dry-run" as const },
      { scope: "fixbot", refId: i4.id, actor: "fixbot", event: "propose", detail: "Auto-attach apex domain (safe-auto-fix)", mode: "dry-run" as const },
      { scope: "fixbot", refId: i5.id, actor: "fixbot", event: "diagnose", detail: "Workflow runner node version mismatch", mode: "dry-run" as const },
    ]) {
      await storage.createAuditLog(e as InsertAuditLog);
    }
  }
}

seed().catch((err) => {
  console.error("seed failed", err);
});
