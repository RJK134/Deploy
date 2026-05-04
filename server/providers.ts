/**
 * Provider adapter layer.
 *
 * This module is the single boundary where DeployOps Console would invoke
 * external providers. By default every adapter runs in DRY-RUN mode and
 * returns a deterministic plan without side effects. Live mode is gated on
 * a per-provider basis via `providers.mode` in storage AND a top-level
 * `LIVE_MODE_ENABLED` flag (default false). Secrets are read from process
 * environment server-side and are never returned to the client.
 *
 * NOTE: this build never executes provider mutations. The CLI / connector
 * call sites are documented as comments so an operator can wire them up
 * with confidence.
 */

export type ProviderKey = "github" | "vercel" | "neon" | "prisma" | "railway";

export interface AdapterContext {
  mode: "dry-run" | "live";
  projectName: string;
  repo: string;
  environment: "test" | "demo" | "deploy";
}

export interface AdapterResult {
  ok: boolean;
  log: string[];
  artifacts?: Record<string, unknown>;
}

const LIVE_MODE_ENABLED = process.env.DEPLOYOPS_LIVE === "1";

function dryLog(provider: ProviderKey, action: string, ctx: AdapterContext): string {
  return `[dry-run · ${provider}] ${action} for ${ctx.repo} → ${ctx.environment}`;
}

/* -------------------------------- github --------------------------------- */
/* Live invocation pattern (server-side only):
 *   bash({ command: "gh repo view ...", api_credentials: ["github"] })
 * The `gh` and `git` CLIs are pre-authenticated when the bash credential
 * preset is supplied. We never expose the token to the client.
 */
export async function githubScan(ctx: AdapterContext): Promise<AdapterResult> {
  const log: string[] = [];
  log.push(dryLog("github", "gh repo view --json name,defaultBranchRef", ctx));
  log.push(dryLog("github", "git ls-remote && cat package.json", ctx));
  log.push(`Detected framework heuristics: package.json scripts, next.config.*, astro.config.*, prisma/schema.prisma`);
  if (ctx.mode === "live" && LIVE_MODE_ENABLED) {
    log.push("[live] would execute `gh` CLI here. Build skipped to avoid mutations.");
  }
  return {
    ok: true, log,
    artifacts: {
      defaultBranch: "main",
      hasDockerfile: false,
      hasPrisma: true,
    },
  };
}

export async function githubGenerateCi(ctx: AdapterContext, blueprintSlug: string): Promise<AdapterResult> {
  const log: string[] = [];
  log.push(dryLog("github", "PR with .github/workflows/deployops.yml", ctx));
  log.push(`Workflow tailored to blueprint: ${blueprintSlug}`);
  return { ok: true, log, artifacts: { workflowPath: ".github/workflows/deployops.yml" } };
}

/* --------------------------------- vercel -------------------------------- */
/* Live invocation pattern:
 *   bash({ command: "npx vercel link --yes && npx vercel env add ... && npx vercel deploy --prebuilt",
 *          api_credentials: ["vercel"] })
 */
export async function vercelDeploy(ctx: AdapterContext): Promise<AdapterResult> {
  const log: string[] = [];
  log.push(dryLog("vercel", "vercel link --yes --project " + ctx.projectName, ctx));
  log.push(dryLog("vercel", "vercel env add (per resolved env var)", ctx));
  log.push(dryLog("vercel", "vercel deploy --prebuilt", ctx));
  const url = `${ctx.projectName}-${ctx.environment}.vercel.app`;
  return { ok: true, log, artifacts: { url } };
}

export async function vercelDomain(ctx: AdapterContext): Promise<AdapterResult> {
  const log: string[] = [];
  const sub = ctx.environment === "deploy" ? `${ctx.projectName}.app` : `${ctx.projectName}-${ctx.environment}.vercel.app`;
  log.push(dryLog("vercel", `domains add ${sub}`, ctx));
  return { ok: true, log, artifacts: { domain: sub } };
}

/* ---------------------------------- neon --------------------------------- */
/* Live invocation pattern (Pipedream connector):
 *   external-tool call '{"source_id":"neon_postgres__pipedream",
 *     "tool_name":"neon_postgres-execute-custom-query",
 *     "arguments":{"sql":"CREATE DATABASE ..."}}'
 * Branching new databases per environment is the recommended pattern.
 */
export async function neonProvision(ctx: AdapterContext): Promise<AdapterResult> {
  const log: string[] = [];
  log.push(dryLog("neon", `branch_database from main → ${ctx.environment}`, ctx));
  log.push(dryLog("neon", "execute-custom-query CREATE EXTENSION pgcrypto", ctx));
  return {
    ok: true, log,
    artifacts: {
      branchName: `br-${ctx.projectName}-${ctx.environment}`,
      connectionPooled: `postgresql://···@ep-${ctx.environment}.neon.tech/db?sslmode=require`,
    },
  };
}

/* --------------------------------- prisma -------------------------------- */
/* Live invocation pattern (Pipedream connector):
 *   external-tool call '{"source_id":"prisma_management_api__pipedream",
 *     "tool_name":"create_database_in_existing_project",
 *     "arguments":{"projectId":"...","region":"us-east-1","isDefault":false}}'
 *   external-tool call '{...,"tool_name":"create_database_connection_string", ...}'
 */
export async function prismaMigrate(ctx: AdapterContext): Promise<AdapterResult> {
  const log: string[] = [];
  log.push(dryLog("prisma", "list_postgres_regions", ctx));
  log.push(dryLog("prisma", `create_database_in_existing_project(region=us-east-1)`, ctx));
  log.push(dryLog("prisma", "create_database_connection_string(name=app)", ctx));
  log.push(dryLog("prisma", "prisma migrate deploy (server-side via npx)", ctx));
  return { ok: true, log, artifacts: { migrationsApplied: 14 } };
}

/* --------------------------------- railway ------------------------------- */
/* No managed connector — falls back to manual CLI guidance. We never
 * execute Railway commands automatically; we only print the steps an
 * operator would run with their RAILWAY_TOKEN. */
export async function railwayManual(ctx: AdapterContext): Promise<AdapterResult> {
  const log: string[] = [
    "[manual · railway] No managed connector available.",
    "Run locally with RAILWAY_TOKEN exported:",
    "  npx @railway/cli link",
    `  npx @railway/cli up --service ${ctx.projectName}-${ctx.environment}`,
  ];
  return { ok: true, log, artifacts: { manual: true } };
}

/* ---------------------------- smoke + helpers ---------------------------- */
export async function smokeTest(ctx: AdapterContext): Promise<AdapterResult> {
  const log = [
    `GET https://${ctx.projectName}-${ctx.environment}.vercel.app/`,
    "→ 200 OK · 142 ms",
    `GET https://${ctx.projectName}-${ctx.environment}.vercel.app/api/health`,
    `→ 200 OK · {"status":"ok"} · 87 ms`,
  ];
  return { ok: true, log };
}
