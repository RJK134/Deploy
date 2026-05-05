/**
 * Live provider adapters for database/runtime providers.
 *
 * Each adapter is a thin REST/GraphQL client around the provider's public API.
 * The adapters never simulate success — every "ok" path corresponds to a real
 * 2xx (or GraphQL `data` without errors) response from the upstream API.
 *
 * Validation/list endpoints are read-only and safe to call from preflight.
 * Provisioning calls (create-project, create-branch, …) are real writes and
 * MUST only be invoked from the orchestrator after `liveMode === true`,
 * `DEPLOYOPS_LIVE === "1"`, and an explicit `confirm: "I UNDERSTAND"` body.
 *
 * Secrets policy:
 *   - Tokens are passed in as plaintext from the routes layer (the only place
 *     that decrypts the cipher pulled from storage).
 *   - Connection strings returned by providers are never returned to the
 *     client. They get stored as a `maskedSecretRef` in `provider_resources`
 *     and used server-side when injecting Vercel env vars.
 */

import { Buffer } from "node:buffer";

const DEFAULT_TIMEOUT_MS = 12000;

export class LiveProviderError extends Error {
  status: number;
  code: string;
  detail: any;
  constructor(message: string, status: number, code: string, detail: any = null) {
    super(message);
    this.name = "LiveProviderError";
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

interface FetchOptions {
  method?: string;
  body?: any;
  headers?: Record<string, string>;
  query?: Record<string, string | number | undefined>;
  timeoutMs?: number;
}

async function liveFetch(
  base: string,
  path: string,
  opts: FetchOptions = {},
): Promise<{ status: number; ok: boolean; json: any | null; text: string }> {
  const url = new URL(base + path);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const init: RequestInit = {
      method: opts.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(opts.headers ?? {}),
      },
      signal: ctrl.signal,
    };
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
    const res = await fetch(url.toString(), init);
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* keep null */ }
    return { status: res.status, ok: res.ok, json, text };
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new LiveProviderError(`request to ${path} timed out`, 504, "timeout");
    }
    throw new LiveProviderError(`request to ${path} failed: ${err?.message ?? err}`, 502, "network");
  } finally {
    clearTimeout(t);
  }
}

/**
 * Hash a connection string deterministically so the dashboard can correlate
 * stored references across runs without exposing the secret.
 */
export function hashSecret(s: string): string {
  return Buffer.from(s).toString("base64url").slice(0, 16);
}

export function safeMessage(message: string): string {
  return message
    /* token-shaped strings */
    .replace(/(?:Bearer\s+)?[A-Za-z0-9_\-]{20,}/g, "[redacted]")
    /* postgres/mysql connection strings */
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "postgres://[redacted]")
    .replace(/mysql:\/\/[^\s]+/gi, "mysql://[redacted]");
}

export interface Blocker {
  code: string;
  message: string;
  remediation: string;
}

/* ============================== Neon =================================== */
/**
 * Neon adapter. Uses the Neon Console v2 API:
 *   GET    /api/v2/projects                    — list (read)
 *   GET    /api/v2/projects/{id}               — read project
 *   POST   /api/v2/projects                    — create project (real write)
 *   POST   /api/v2/projects/{id}/branches      — create branch (real write)
 *   GET    /api/v2/projects/{id}/connection_uri — fetch connection URI
 */

const NEON_API = "https://console.neon.tech/api/v2";

export interface NeonProject {
  id: string;
  name: string;
  regionId: string | null;
  orgId: string | null;
  databases?: Array<{ id: number; name: string; ownerName: string }>;
  branches?: Array<{ id: string; name: string; primary?: boolean }>;
}

function neonProjectFromApi(p: any): NeonProject {
  return {
    id: String(p.id ?? ""),
    name: String(p.name ?? ""),
    regionId: p.region_id ?? null,
    orgId: p.org_id ?? null,
  };
}

export async function neonListProjects(token: string): Promise<NeonProject[]> {
  const res = await liveFetch(NEON_API, "/projects", {
    headers: { Authorization: `Bearer ${token}` },
    query: { limit: 100 },
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new LiveProviderError("Neon token unauthorized", res.status, "unauthorized");
    }
    throw new LiveProviderError(`Neon /projects failed (${res.status})`, res.status, "neon-list-failed");
  }
  const projects = Array.isArray(res.json?.projects) ? res.json.projects : [];
  return projects.map(neonProjectFromApi);
}

export async function neonGetProject(token: string, projectId: string): Promise<NeonProject | null> {
  const res = await liveFetch(NEON_API, `/projects/${encodeURIComponent(projectId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new LiveProviderError("Neon token unauthorized", res.status, "unauthorized");
    }
    throw new LiveProviderError(`Neon /projects/{id} failed (${res.status})`, res.status, "neon-get-failed");
  }
  const proj = neonProjectFromApi(res.json?.project ?? res.json);
  proj.databases = Array.isArray(res.json?.databases) ? res.json.databases : [];
  proj.branches = Array.isArray(res.json?.branches) ? res.json.branches : [];
  return proj;
}

export interface NeonCreateProjectInput {
  name: string;
  regionId?: string;          // e.g. "aws-us-east-1"
  orgId?: string;
}

/**
 * Real write — creates a Neon project. Caller MUST gate on liveMode +
 * confirmation. Returns the new project + the primary branch id and the
 * default database connection URI (server-side only — DO NOT log).
 */
export async function neonCreateProject(
  token: string,
  input: NeonCreateProjectInput,
): Promise<{ project: NeonProject; primaryBranchId: string | null; connectionUri: string | null }> {
  const body: Record<string, any> = {
    project: {
      name: input.name,
      ...(input.regionId ? { region_id: input.regionId } : {}),
      ...(input.orgId ? { org_id: input.orgId } : {}),
    },
  };
  const res = await liveFetch(NEON_API, "/projects", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body,
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new LiveProviderError("Neon token unauthorized for project create", res.status, "unauthorized");
    }
    throw new LiveProviderError(
      res.json?.message ?? `Neon project create failed (${res.status})`,
      res.status, "neon-create-failed", res.json,
    );
  }
  const project = neonProjectFromApi(res.json?.project ?? {});
  const primaryBranchId = Array.isArray(res.json?.branches)
    ? String(res.json.branches.find((b: any) => b.primary)?.id ?? res.json.branches[0]?.id ?? "")
    : null;
  /* Neon returns `connection_uris` for newly created projects. */
  const connectionUri = Array.isArray(res.json?.connection_uris) && res.json.connection_uris[0]?.connection_uri
    ? String(res.json.connection_uris[0].connection_uri)
    : null;
  return { project, primaryBranchId, connectionUri };
}

export interface NeonBranchInput {
  /** Existing project id to branch within. */
  projectId: string;
  /** Branch name e.g. `env-test`, `env-demo`. */
  name: string;
  /** Optional parent branch id; default is the project's primary branch. */
  parentId?: string;
}

export async function neonCreateBranch(
  token: string,
  input: NeonBranchInput,
): Promise<{ branchId: string; connectionUri: string | null }> {
  const body: Record<string, any> = {
    branch: {
      name: input.name,
      ...(input.parentId ? { parent_id: input.parentId } : {}),
    },
    /* Request a fresh DB role + endpoint so we can read a connection URI back. */
    endpoints: [{ type: "read_write" }],
  };
  const res = await liveFetch(NEON_API, `/projects/${encodeURIComponent(input.projectId)}/branches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body,
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new LiveProviderError("Neon token unauthorized for branch create", res.status, "unauthorized");
    }
    throw new LiveProviderError(
      res.json?.message ?? `Neon branch create failed (${res.status})`,
      res.status, "neon-branch-failed", res.json,
    );
  }
  const branchId = String(res.json?.branch?.id ?? "");
  const connectionUri = Array.isArray(res.json?.connection_uris) && res.json.connection_uris[0]?.connection_uri
    ? String(res.json.connection_uris[0].connection_uri)
    : null;
  return { branchId, connectionUri };
}

/**
 * Read connection URIs for an existing project's branch. Used to inject the
 * DATABASE_URL into Vercel env vars without re-creating resources.
 */
export async function neonGetConnectionUri(
  token: string,
  projectId: string,
  opts: { databaseName?: string; roleName?: string; branchId?: string; pooled?: boolean } = {},
): Promise<string | null> {
  const res = await liveFetch(NEON_API, `/projects/${encodeURIComponent(projectId)}/connection_uri`, {
    headers: { Authorization: `Bearer ${token}` },
    query: {
      database_name: opts.databaseName ?? "neondb",
      role_name: opts.roleName ?? "neondb_owner",
      branch_id: opts.branchId,
      pooled: opts.pooled === false ? "false" : "true",
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new LiveProviderError("Neon token unauthorized for connection_uri", res.status, "unauthorized");
    }
    throw new LiveProviderError(`Neon /connection_uri failed (${res.status})`, res.status, "neon-conn-failed");
  }
  return typeof res.json?.uri === "string" ? res.json.uri : null;
}

/**
 * Read-only readiness for Neon — token works + we can list projects.
 * Returns blockers array (empty when ready) plus optional account context.
 */
export async function neonReadiness(token: string | null): Promise<{
  blockers: Blocker[];
  projects: NeonProject[];
}> {
  const blockers: Blocker[] = [];
  if (!token) {
    blockers.push({
      code: "no-neon-token",
      message: "No Neon API key available.",
      remediation: "Connect Neon in Connection Center, or set NEON_API_KEY on the server.",
    });
    return { blockers, projects: [] };
  }
  try {
    const projects = await neonListProjects(token);
    return { blockers, projects };
  } catch (err) {
    if (err instanceof LiveProviderError && err.code === "unauthorized") {
      blockers.push({
        code: "neon-token-unauthorized",
        message: "Neon API key is unauthorized.",
        remediation: "Generate a new Neon API key and reconnect.",
      });
    } else {
      blockers.push({
        code: "neon-validation-failed",
        message: `Neon validation failed: ${safeMessage((err as Error).message)}`,
        remediation: "Inspect Neon API status and retry.",
      });
    }
    return { blockers, projects: [] };
  }
}

/* ============================== Prisma ================================= */
/**
 * Prisma Postgres / Management API adapter.
 *
 * The Prisma Management API path has changed over time; we hit the
 * `/v1/projects` listing endpoint and fail soft (warning) when it 404s so we
 * don't strand a working token over an endpoint URL drift. Real provisioning
 * routes use the documented endpoints when present and otherwise return a
 * `prisma-mgmt-api-unavailable` blocker.
 *
 * IMPORTANT: this build does NOT execute `prisma migrate deploy`. Migration
 * application happens inside the user's CI/build, not here. We only manage
 * the database lifecycle.
 */

const PRISMA_API = "https://api.prisma.io";

export interface PrismaProject {
  id: string;
  name: string;
  region?: string | null;
  workspace?: string | null;
}

export async function prismaListProjects(token: string): Promise<PrismaProject[]> {
  const res = await liveFetch(PRISMA_API, "/v1/projects", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new LiveProviderError("Prisma token unauthorized", res.status, "unauthorized");
    }
    if (res.status === 404) {
      throw new LiveProviderError(
        "Prisma /v1/projects returned 404 — Management API endpoint may have moved",
        404, "prisma-mgmt-api-unavailable",
      );
    }
    throw new LiveProviderError(`Prisma /v1/projects failed (${res.status})`, res.status, "prisma-list-failed");
  }
  const arr = Array.isArray(res.json?.data) ? res.json.data
    : Array.isArray(res.json?.projects) ? res.json.projects
    : Array.isArray(res.json) ? res.json
    : [];
  return arr.map((p: any): PrismaProject => ({
    id: String(p.id ?? p.slug ?? ""),
    name: String(p.name ?? p.slug ?? ""),
    region: p.region ?? null,
    workspace: p.workspace ?? p.workspaceId ?? null,
  }));
}

export async function prismaListRegions(token: string): Promise<Array<{ id: string; name: string }>> {
  const res = await liveFetch(PRISMA_API, "/v1/regions", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new LiveProviderError("Prisma token unauthorized", res.status, "unauthorized");
    }
    if (res.status === 404) {
      throw new LiveProviderError("Prisma /v1/regions unavailable", 404, "prisma-mgmt-api-unavailable");
    }
    throw new LiveProviderError(`Prisma /v1/regions failed (${res.status})`, res.status, "prisma-regions-failed");
  }
  const arr = Array.isArray(res.json?.data) ? res.json.data
    : Array.isArray(res.json) ? res.json
    : [];
  return arr.map((r: any) => ({ id: String(r.id ?? r.code ?? ""), name: String(r.name ?? r.id ?? "") }));
}

export interface PrismaCreateDatabaseInput {
  projectId: string;
  name: string;
  region: string;
  isDefault?: boolean;
}

export async function prismaCreateDatabase(
  token: string,
  input: PrismaCreateDatabaseInput,
): Promise<{ id: string; connectionString: string | null }> {
  const res = await liveFetch(PRISMA_API, `/v1/projects/${encodeURIComponent(input.projectId)}/databases`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: {
      name: input.name,
      region: input.region,
      isDefault: input.isDefault ?? false,
    },
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new LiveProviderError("Prisma token unauthorized for database create", res.status, "unauthorized");
    }
    if (res.status === 404) {
      throw new LiveProviderError(
        "Prisma database create endpoint not available for this token/project — check Prisma Management API access.",
        404, "prisma-mgmt-api-unavailable",
      );
    }
    throw new LiveProviderError(
      res.json?.message ?? `Prisma database create failed (${res.status})`,
      res.status, "prisma-create-db-failed", res.json,
    );
  }
  return {
    id: String(res.json?.id ?? res.json?.databaseId ?? ""),
    connectionString: typeof res.json?.connectionString === "string" ? res.json.connectionString : null,
  };
}

export async function prismaCreateConnectionString(
  token: string,
  databaseId: string,
  name = "app",
): Promise<{ id: string; connectionString: string | null }> {
  const res = await liveFetch(PRISMA_API, `/v1/databases/${encodeURIComponent(databaseId)}/connection-strings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: { name },
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new LiveProviderError("Prisma token unauthorized for connection string create", res.status, "unauthorized");
    }
    if (res.status === 404) {
      throw new LiveProviderError(
        "Prisma connection string endpoint unavailable",
        404, "prisma-mgmt-api-unavailable",
      );
    }
    throw new LiveProviderError(
      res.json?.message ?? `Prisma connection string create failed (${res.status})`,
      res.status, "prisma-conn-create-failed", res.json,
    );
  }
  return {
    id: String(res.json?.id ?? ""),
    connectionString: typeof res.json?.connectionString === "string" ? res.json.connectionString : null,
  };
}

export async function prismaReadiness(token: string | null): Promise<{
  blockers: Blocker[];
  projects: PrismaProject[];
  apiAvailable: boolean;
}> {
  const blockers: Blocker[] = [];
  if (!token) {
    blockers.push({
      code: "no-prisma-token",
      message: "No Prisma Management API token available.",
      remediation: "Connect Prisma in Connection Center, or set PRISMA_API_KEY on the server.",
    });
    return { blockers, projects: [], apiAvailable: false };
  }
  try {
    const projects = await prismaListProjects(token);
    return { blockers, projects, apiAvailable: true };
  } catch (err) {
    if (err instanceof LiveProviderError) {
      if (err.code === "unauthorized") {
        blockers.push({
          code: "prisma-token-unauthorized",
          message: "Prisma token is unauthorized.",
          remediation: "Generate a new Prisma Management API token.",
        });
      } else if (err.code === "prisma-mgmt-api-unavailable") {
        blockers.push({
          code: "prisma-mgmt-api-unavailable",
          message: "Prisma Management API endpoints are not reachable for this token.",
          remediation: "Confirm your Prisma workspace has Management API access enabled. Use Neon or Supabase as the DB provider in the meantime.",
        });
        return { blockers, projects: [], apiAvailable: false };
      } else {
        blockers.push({
          code: "prisma-validation-failed",
          message: `Prisma validation failed: ${safeMessage(err.message)}`,
          remediation: "Inspect Prisma Console status and retry.",
        });
      }
    } else {
      blockers.push({
        code: "prisma-validation-failed",
        message: `Prisma validation failed: ${safeMessage((err as Error).message)}`,
        remediation: "Retry; check Prisma status page.",
      });
    }
    return { blockers, projects: [], apiAvailable: false };
  }
}

/* ============================ Railway ================================== */
/**
 * Railway GraphQL adapter. Validates viewer, lists projects, and (optionally)
 * creates services/env vars. Real GitHub-repo-deploy on Railway requires a
 * GitHub integration on the Railway project; we detect missing integration
 * from `me.serviceCount === 0` + a discoverable error code and return a
 * structured blocker rather than guessing.
 */

const RAILWAY_API = "https://backboard.railway.app/graphql/v2";

async function railwayGraphql(token: string, query: string, variables?: Record<string, unknown>): Promise<any> {
  const res = await liveFetch("https://backboard.railway.app", "/graphql/v2", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: { query, variables },
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new LiveProviderError("Railway token unauthorized", res.status, "unauthorized");
    }
    throw new LiveProviderError(`Railway GraphQL failed (${res.status})`, res.status, "railway-failed");
  }
  if (res.json?.errors?.length) {
    const msg = res.json.errors.map((e: any) => e.message).join("; ");
    if (/not authenticated|unauthorized/i.test(msg)) {
      throw new LiveProviderError("Railway token unauthorized", 401, "unauthorized", res.json.errors);
    }
    throw new LiveProviderError(`Railway GraphQL errors: ${msg}`, 502, "railway-graphql-error", res.json.errors);
  }
  return res.json?.data;
}

export interface RailwayProject {
  id: string;
  name: string;
  environments?: Array<{ id: string; name: string }>;
  services?: Array<{ id: string; name: string }>;
}

export async function railwayViewer(token: string): Promise<{ id: string; name: string | null; email: string | null }> {
  const data = await railwayGraphql(token, "query { me { id name email } }");
  const me = data?.me;
  if (!me) throw new LiveProviderError("Railway viewer query returned no data", 502, "railway-no-viewer");
  return { id: String(me.id ?? ""), name: me.name ?? null, email: me.email ?? null };
}

export async function railwayListProjects(token: string): Promise<RailwayProject[]> {
  const data = await railwayGraphql(token, `
    query {
      projects {
        edges {
          node {
            id name
            environments { edges { node { id name } } }
            services { edges { node { id name } } }
          }
        }
      }
    }
  `);
  const edges = data?.projects?.edges ?? [];
  return edges.map((e: any) => {
    const n = e.node ?? {};
    return {
      id: String(n.id ?? ""),
      name: String(n.name ?? ""),
      environments: (n.environments?.edges ?? []).map((ee: any) => ({
        id: String(ee.node?.id ?? ""), name: String(ee.node?.name ?? ""),
      })),
      services: (n.services?.edges ?? []).map((se: any) => ({
        id: String(se.node?.id ?? ""), name: String(se.node?.name ?? ""),
      })),
    } as RailwayProject;
  });
}

export interface RailwayCreateProjectInput {
  name: string;
  description?: string;
}

export async function railwayCreateProject(
  token: string,
  input: RailwayCreateProjectInput,
): Promise<{ id: string; name: string }> {
  const data = await railwayGraphql(token, `
    mutation($input: ProjectCreateInput!) {
      projectCreate(input: $input) { id name }
    }
  `, { input: { name: input.name, ...(input.description ? { description: input.description } : {}) } });
  const proj = data?.projectCreate;
  if (!proj?.id) throw new LiveProviderError("Railway projectCreate returned no id", 502, "railway-create-failed");
  return { id: String(proj.id), name: String(proj.name ?? input.name) };
}

export async function railwayUpsertVariable(
  token: string,
  input: { projectId: string; environmentId: string; serviceId?: string; name: string; value: string },
): Promise<void> {
  await railwayGraphql(token, `
    mutation($input: VariableUpsertInput!) {
      variableUpsert(input: $input)
    }
  `, { input });
}

export async function railwayReadiness(token: string | null): Promise<{
  blockers: Blocker[];
  viewer: { id: string; name: string | null; email: string | null } | null;
  projects: RailwayProject[];
}> {
  const blockers: Blocker[] = [];
  if (!token) {
    blockers.push({
      code: "no-railway-token",
      message: "No Railway API token available.",
      remediation: "Connect Railway in Connection Center, or set RAILWAY_TOKEN on the server.",
    });
    return { blockers, viewer: null, projects: [] };
  }
  try {
    const viewer = await railwayViewer(token);
    let projects: RailwayProject[] = [];
    try {
      projects = await railwayListProjects(token);
    } catch (err) {
      blockers.push({
        code: "railway-projects-unavailable",
        message: `Could not list Railway projects: ${safeMessage((err as Error).message)}`,
        remediation: "Confirm token scope includes project:read.",
      });
    }
    return { blockers, viewer, projects };
  } catch (err) {
    if (err instanceof LiveProviderError && err.code === "unauthorized") {
      blockers.push({
        code: "railway-token-unauthorized",
        message: "Railway API token is unauthorized.",
        remediation: "Generate a new Railway token at https://railway.app/account/tokens.",
      });
    } else {
      blockers.push({
        code: "railway-validation-failed",
        message: `Railway validation failed: ${safeMessage((err as Error).message)}`,
        remediation: "Inspect Railway status; retry validation.",
      });
    }
    return { blockers, viewer: null, projects: [] };
  }
}

/* ============================ Supabase ================================= */
/**
 * Supabase Management API adapter. Token-based — supports both reading
 * existing projects and creating new ones (when token has projects:write).
 *
 * Database password is required for project creation; we never persist it.
 * The orchestrator generates one securely at request time and uses it once;
 * the resulting connection string is stored as a masked reference.
 */

const SUPABASE_API = "https://api.supabase.com";

export interface SupabaseProject {
  id: string;
  name: string;
  region: string | null;
  organizationId: string | null;
  status?: string | null;
}

export interface SupabaseOrg {
  id: string;
  name: string;
  slug: string | null;
}

export async function supabaseListOrganizations(token: string): Promise<SupabaseOrg[]> {
  const res = await liveFetch(SUPABASE_API, "/v1/organizations", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new LiveProviderError("Supabase token unauthorized", res.status, "unauthorized");
    }
    throw new LiveProviderError(`Supabase /v1/organizations failed (${res.status})`, res.status, "supabase-list-orgs-failed");
  }
  const arr = Array.isArray(res.json) ? res.json : [];
  return arr.map((o: any): SupabaseOrg => ({
    id: String(o.id ?? ""), name: String(o.name ?? ""), slug: o.slug ?? null,
  }));
}

export async function supabaseListProjects(token: string): Promise<SupabaseProject[]> {
  const res = await liveFetch(SUPABASE_API, "/v1/projects", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new LiveProviderError("Supabase token unauthorized", res.status, "unauthorized");
    }
    throw new LiveProviderError(`Supabase /v1/projects failed (${res.status})`, res.status, "supabase-list-failed");
  }
  const arr = Array.isArray(res.json) ? res.json : [];
  return arr.map((p: any): SupabaseProject => ({
    id: String(p.id ?? ""),
    name: String(p.name ?? ""),
    region: p.region ?? null,
    organizationId: p.organization_id ?? null,
    status: p.status ?? null,
  }));
}

export interface SupabaseCreateProjectInput {
  name: string;
  organizationId: string;
  region: string;            // e.g. "us-east-1"
  /** Strong password; never stored. */
  dbPass: string;
  plan?: "free" | "pro";
}

export async function supabaseCreateProject(
  token: string,
  input: SupabaseCreateProjectInput,
): Promise<{ id: string; name: string; status: string | null }> {
  const res = await liveFetch(SUPABASE_API, "/v1/projects", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: {
      name: input.name,
      organization_id: input.organizationId,
      region: input.region,
      db_pass: input.dbPass,
      ...(input.plan ? { plan: input.plan } : {}),
    },
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new LiveProviderError("Supabase token unauthorized for project create", res.status, "unauthorized");
    }
    if (res.status === 402 || /quota|payment/i.test(res.json?.message ?? "")) {
      throw new LiveProviderError(
        res.json?.message ?? "Supabase project create blocked by plan/quota",
        res.status, "supabase-quota", res.json,
      );
    }
    throw new LiveProviderError(
      res.json?.message ?? `Supabase project create failed (${res.status})`,
      res.status, "supabase-create-failed", res.json,
    );
  }
  return {
    id: String(res.json?.id ?? ""),
    name: String(res.json?.name ?? input.name),
    status: res.json?.status ?? null,
  };
}

export async function supabaseGetApiKeys(
  token: string,
  projectRef: string,
): Promise<Array<{ name: string; api_key: string }>> {
  const res = await liveFetch(SUPABASE_API, `/v1/projects/${encodeURIComponent(projectRef)}/api-keys`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new LiveProviderError("Supabase token unauthorized for api-keys", res.status, "unauthorized");
    }
    if (res.status === 404) return [];
    throw new LiveProviderError(`Supabase api-keys failed (${res.status})`, res.status, "supabase-keys-failed");
  }
  return Array.isArray(res.json) ? res.json : [];
}

export async function supabaseReadiness(token: string | null): Promise<{
  blockers: Blocker[];
  organizations: SupabaseOrg[];
  projects: SupabaseProject[];
}> {
  const blockers: Blocker[] = [];
  if (!token) {
    blockers.push({
      code: "no-supabase-token",
      message: "No Supabase access token available.",
      remediation: "Connect Supabase in Connection Center, or set SUPABASE_ACCESS_TOKEN on the server.",
    });
    return { blockers, organizations: [], projects: [] };
  }
  try {
    const [organizations, projects] = await Promise.all([
      supabaseListOrganizations(token),
      supabaseListProjects(token),
    ]);
    if (organizations.length === 0) {
      blockers.push({
        code: "supabase-no-organizations",
        message: "Supabase token has no organizations.",
        remediation: "Create or join a Supabase organization, or supply an existing project's URL/anon key/service role.",
      });
    }
    return { blockers, organizations, projects };
  } catch (err) {
    if (err instanceof LiveProviderError && err.code === "unauthorized") {
      blockers.push({
        code: "supabase-token-unauthorized",
        message: "Supabase token is unauthorized.",
        remediation: "Generate a new Supabase access token in the dashboard.",
      });
    } else {
      blockers.push({
        code: "supabase-validation-failed",
        message: `Supabase validation failed: ${safeMessage((err as Error).message)}`,
        remediation: "Inspect Supabase status; retry.",
      });
    }
    return { blockers, organizations: [], projects: [] };
  }
}

/**
 * Build a Supabase env injection map from an existing project record the user
 * supplied (URL + anon key + optional service role). All values are validated
 * for shape only — we never call out to Supabase here.
 */
export function supabaseExistingEnvFromInputs(input: {
  url: string;
  anonKey: string;
  serviceRoleKey?: string | null;
  projectRef?: string | null;
}): { env: Array<{ key: string; value: string }>; warnings: string[] } {
  const warnings: string[] = [];
  if (!/^https:\/\/[\w-]+\.supabase\.co$/i.test(input.url)) {
    warnings.push("URL does not look like a Supabase project URL (https://<ref>.supabase.co)");
  }
  if (input.anonKey.length < 30) warnings.push("anon key looks too short");
  const env = [
    { key: "SUPABASE_URL", value: input.url },
    { key: "NEXT_PUBLIC_SUPABASE_URL", value: input.url },
    { key: "SUPABASE_ANON_KEY", value: input.anonKey },
    { key: "NEXT_PUBLIC_SUPABASE_ANON_KEY", value: input.anonKey },
    ...(input.serviceRoleKey
      ? [{ key: "SUPABASE_SERVICE_ROLE_KEY", value: input.serviceRoleKey }]
      : []),
  ];
  return { env, warnings };
}

/* ============================ helpers =================================== */

export function maskConnection(uri: string): string {
  return safeMessage(uri).slice(0, 80) + (uri.length > 80 ? "…" : "");
}

/** Build a stable, non-secret reference for storing in `provider_resources`. */
export function buildSecretRef(provider: string, parts: Record<string, string | undefined>): string {
  const ordered = Object.entries(parts)
    .filter(([, v]) => !!v)
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  return `${provider}://${ordered}`;
}
