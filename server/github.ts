/**
 * GitHub API integration via the authenticated `gh` CLI.
 *
 * All calls go through `gh api …` which automatically uses whatever auth token
 * the environment provides (GITHUB_TOKEN, GH_ENTERPRISE_TOKEN with GH_HOST,
 * or `gh auth login`). Tokens are never read or echoed by this module —
 * only the CLI sees them.
 *
 * Each helper returns plain JSON or throws a `GhError` with a stable code so
 * the route layer can shape error responses (`auth-missing`, `rate-limit`,
 * `not-found`, `network`, `unknown`).
 */
import { spawn } from "node:child_process";
import { AsyncLocalStorage } from "node:async_hooks";

export class GhError extends Error {
  code: "auth-missing" | "rate-limit" | "not-found" | "network" | "unknown" | "forbidden-scope";
  status: number;
  detail?: string;
  /** Exit code from the underlying CLI process, when applicable. Never used as HTTP status. */
  exitCode?: number;
  /** Optional owner this error pertains to (when GhError comes from a per-owner call). */
  owner?: string;
  constructor(code: GhError["code"], message: string, status = 500, detail?: string) {
    super(message);
    this.code = code;
    this.status = sanitizeHttpStatus(status);
    this.detail = detail;
  }
}

/**
 * Coerce an arbitrary number into a valid HTTP status code (100-599).
 * Process exit codes (e.g. 0, 1) and other invalid values fall back to 500
 * so we never trip Express's `RangeError: Invalid status code` check.
 */
function sanitizeHttpStatus(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : 500;
  if (v >= 100 && v <= 599) return v;
  return 500;
}

interface RunResult { stdout: string; stderr: string; code: number }

function runGh(args: string[], opts: { input?: string; timeoutMs?: number } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("gh", args, { env: process.env });
    let stdout = "", stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new GhError("network", "gh CLI timed out", 504));
    }, opts.timeoutMs ?? 20000);
    child.stdout.on("data", (b) => { stdout += b.toString(); });
    child.stderr.on("data", (b) => { stderr += b.toString(); });
    child.on("error", (err) => {
      clearTimeout(timeout);
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new GhError("auth-missing", "gh CLI is not installed in the runtime", 503));
      } else {
        reject(new GhError("unknown", String(err), 500));
      }
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ stdout, stderr, code: code ?? 0 });
    });
    if (opts.input !== undefined) {
      child.stdin.write(opts.input);
      child.stdin.end();
    }
  });
}

/**
 * Build a GhError from gh CLI stderr.
 *
 * IMPORTANT: the second argument is the CLI **exit code**, never an HTTP
 * status. Process exit codes (typically 1–255) must not leak into Express
 * response status codes — that path crashes the response handler with
 * `RangeError: Invalid status code: 1`. We classify by stderr content and
 * always use a real HTTP status (4xx/5xx) on the GhError.
 */
function classifyGhError(stderr: string, exitCode: number): GhError {
  const lower = stderr.toLowerCase();
  let err: GhError;
  if (lower.includes("not authenticated") || lower.includes("authentication required") ||
      lower.includes("token is invalid") || lower.includes("bad credentials") ||
      lower.includes("requires authentication") || lower.includes("login required")) {
    err = new GhError("auth-missing", "GitHub authentication missing or invalid", 503, stderr.trim());
  } else if (lower.includes("rate limit") || lower.includes("api rate limit exceeded")) {
    err = new GhError("rate-limit", "GitHub API rate limit exceeded", 429, stderr.trim());
  } else if (lower.includes("404") || lower.includes("not found")) {
    err = new GhError("not-found", "Resource not found on GitHub", 404, stderr.trim());
  } else {
    /* Unknown gh CLI failure — surface as 503 (upstream unavailable) rather
     * than 500, so the route layer / cache fallback can treat it as a
     * transient upstream issue. */
    err = new GhError("unknown", "GitHub CLI call failed", 503, stderr.trim() || `gh exited with code ${exitCode}`);
  }
  err.exitCode = exitCode;
  return err;
}

/**
 * Token source for GitHub API calls. When set (via withGitHubToken), the HTTP
 * path is used directly with the token. Otherwise we fall back to env vars and
 * lastly the `gh` CLI which uses `gh auth login` creds.
 *
 * Backed by AsyncLocalStorage so concurrent requests with different tokens do
 * not stomp on each other. The token string is never logged or echoed.
 */
interface GhCallContext {
  token: string | null;
  source: AuthSource;
}
const ghCtx = new AsyncLocalStorage<GhCallContext>();

export type AuthSource = "connection" | "env" | "cli" | "none";

export function withGitHubToken<T>(
  token: string | null,
  fn: () => Promise<T>,
  source: AuthSource = token ? "connection" : "none",
): Promise<T> {
  return ghCtx.run({ token: token && token.trim() ? token.trim() : null, source }, fn);
}

/**
 * Returns the active token (if any) and the source label.
 * Order: explicit connection (via withGitHubToken) → env GITHUB_TOKEN/GH_TOKEN →
 * none (caller will fall through to `gh` CLI).
 */
function activeAuth(): { token: string | null; source: AuthSource } {
  const ctx = ghCtx.getStore();
  if (ctx?.token) return { token: ctx.token, source: ctx.source === "none" ? "connection" : ctx.source };
  /* Env vars (GITHUB_TOKEN preferred, GH_TOKEN as fallback for parity with gh CLI). */
  const envTok = ((process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN) ?? "").trim();
  if (envTok) return { token: envTok, source: "env" };
  return { token: null, source: "cli" };
}

/** Public — lets the route layer surface which auth source served the request. */
export function currentAuthSource(): AuthSource {
  return activeAuth().source;
}

async function ghHttpApi<T>(path: string, token: string): Promise<T> {
  const url = path.startsWith("http") ? path : `https://api.github.com${path.startsWith("/") ? path : `/${path}`}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "DeployOps-Console/1.0",
      },
      signal: ctrl.signal,
    });
  } catch (err: any) {
    clearTimeout(t);
    if (err?.name === "AbortError") throw new GhError("network", "GitHub HTTP request timed out", 504);
    throw new GhError("network", `GitHub HTTP request failed: ${err?.message ?? err}`, 502);
  }
  clearTimeout(t);
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 401) throw new GhError("auth-missing", "GitHub authentication invalid or expired", 401, text.slice(0, 200));
    if (res.status === 403 && /rate limit/i.test(text)) throw new GhError("rate-limit", "GitHub API rate limit exceeded", 429, text.slice(0, 200));
    if (res.status === 403) {
      throw new GhError("forbidden-scope", "GitHub token forbidden — likely missing scopes (repo / read:org)", 403, text.slice(0, 200));
    }
    if (res.status === 404) throw new GhError("not-found", "Resource not found on GitHub", 404, text.slice(0, 200));
    throw new GhError("unknown", `GitHub HTTP ${res.status}`, 502, text.slice(0, 200));
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new GhError("unknown", "GitHub returned non-JSON response", 502, text.slice(0, 200));
  }
}

/**
 * Whether the `gh` CLI fallback should be attempted. Controlled by
 * DEPLOYOPS_DISABLE_GH_CLI=1 (set in deployed previews where the CLI's auth
 * is unstable / expiring). Default: enabled in dev, disabled when explicitly
 * turned off.
 */
function ghCliEnabled(): boolean {
  const v = (process.env.DEPLOYOPS_DISABLE_GH_CLI ?? "").trim();
  return v !== "1" && v.toLowerCase() !== "true";
}

async function ghApi<T = unknown>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const { token } = activeAuth();
  if (token) {
    /* HTTP path — preferred whenever we have any token, no CLI dependency. */
    let url = path;
    const entries = Object.entries(params).filter(([, v]) => v !== undefined);
    if (entries.length > 0) {
      const sep = path.includes("?") ? "&" : "?";
      url = path + sep + entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&");
    }
    return ghHttpApi<T>(url, token);
  }
  /* No HTTP token — fall back to gh CLI if allowed. The deployed preview
   * server cannot rely on `gh auth login` because its token expires; in that
   * environment the operator should connect a stored PAT via the UI. */
  if (!ghCliEnabled()) {
    throw new GhError(
      "auth-missing",
      "No GitHub credential available — connect GitHub in the wizard or set GITHUB_TOKEN",
      401,
      "stored connection token + GITHUB_TOKEN env both unset; gh CLI fallback disabled",
    );
  }
  const args = ["api", path, "-H", "Accept: application/vnd.github+json"];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    args.push("-f", `${k}=${String(v)}`);
  }
  const { stdout, stderr, code } = await runGh(args);
  if (code !== 0) throw classifyGhError(stderr, code);
  try {
    return JSON.parse(stdout) as T;
  } catch {
    throw new GhError("unknown", "GitHub returned non-JSON response", 502, stdout.slice(0, 200));
  }
}

/* ------------------------------ public types ------------------------------ */

export interface GhRepoSummary {
  id: number;
  name: string;
  fullName: string;             // owner/repo
  owner: string;
  description: string | null;
  url: string;                  // html_url
  cloneUrl: string;
  defaultBranch: string;
  private: boolean;
  fork: boolean;
  archived: boolean;
  language: string | null;
  pushedAt: string | null;
  updatedAt: string | null;
  topics: string[];
}

export interface GhBranch {
  name: string;
  protected: boolean;
  sha: string;
}

export interface DetectionResult {
  framework: "nextjs" | "vite-react" | "react" | "node" | "express" | "static" | "fastapi" | "python" | "astro" | "svelte" | "unknown";
  packageManager: "npm" | "yarn" | "pnpm" | "bun" | "pip" | "poetry" | "unknown";
  buildCommand: string | null;
  devCommand: string | null;
  startCommand: string | null;
  outputDir: string | null;
  prisma: { present: boolean; schemaPath: string | null; migrationsPath: string | null };
  docker: { dockerfile: boolean; compose: boolean };
  vercel: { configFile: string | null };
  githubActions: { workflowPaths: string[] };
  envExample: { path: string | null; keys: string[] };
  envSuggestions: string[];
  blueprintRecommendation: string | null;
  recommendedProviders: string[];
  language: string | null;
  notes: string[];
}

/* --------------------------------- helpers -------------------------------- */

function decodeContentBase64(b64: string | undefined): string | null {
  if (!b64) return null;
  try { return Buffer.from(b64.replace(/\n/g, ""), "base64").toString("utf-8"); }
  catch { return null; }
}

interface ContentItem {
  name: string;
  path: string;
  type: "file" | "dir" | "symlink" | "submodule";
  download_url?: string | null;
  content?: string;
  encoding?: string;
}

async function getDirContents(repo: string, ref: string, path = ""): Promise<ContentItem[]> {
  try {
    const data = await ghApi<ContentItem[] | ContentItem>(
      `/repos/${repo}/contents/${path}${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`,
    );
    return Array.isArray(data) ? data : [data];
  } catch (err) {
    if (err instanceof GhError && err.code === "not-found") return [];
    throw err;
  }
}

async function getFile(repo: string, ref: string, path: string): Promise<string | null> {
  try {
    const data = await ghApi<ContentItem>(
      `/repos/${repo}/contents/${path}${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`,
    );
    if (Array.isArray(data) || data.type !== "file") return null;
    return decodeContentBase64(data.content);
  } catch (err) {
    if (err instanceof GhError && err.code === "not-found") return null;
    throw err;
  }
}

/* --------------------------------- API ------------------------------------ */

/** Verify auth by fetching `/user`. Returns { login, name } or throws GhError. */
export async function ghViewer(): Promise<{ login: string; name: string | null; avatarUrl: string | null }> {
  const data = await ghApi<{ login: string; name: string | null; avatar_url: string | null }>("/user");
  return { login: data.login, name: data.name ?? null, avatarUrl: data.avatar_url ?? null };
}

function mapRepo(r: any): GhRepoSummary {
  return {
    id: r.id,
    name: r.name,
    fullName: r.full_name,
    owner: r.owner?.login ?? r.full_name?.split("/")[0] ?? "",
    description: r.description ?? null,
    url: r.html_url,
    cloneUrl: r.clone_url,
    defaultBranch: r.default_branch ?? "main",
    private: !!r.private,
    fork: !!r.fork,
    archived: !!r.archived,
    language: r.language ?? null,
    pushedAt: r.pushed_at ?? null,
    updatedAt: r.updated_at ?? null,
    topics: Array.isArray(r.topics) ? r.topics : [],
  };
}

/** Repos owned + accessible by the authenticated user via /user/repos. */
async function ghListAuthenticatedUserRepos(): Promise<GhRepoSummary[]> {
  const out: GhRepoSummary[] = [];
  for (const page of [1, 2]) {
    let batch: any[] = [];
    try {
      batch = await ghApi<any[]>(
        `/user/repos?per_page=100&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`,
      );
    } catch (err) {
      if (page === 1) throw err;
      break;
    }
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const r of batch) out.push(mapRepo(r));
    if (batch.length < 100) break;
  }
  return out;
}

/** Repos for a specific user via /users/{login}/repos (covers viewer's owned repos even if /user/repos is partial). */
async function ghListUserRepos(login: string): Promise<GhRepoSummary[]> {
  const out: GhRepoSummary[] = [];
  for (const page of [1, 2]) {
    const batch = await ghApi<any[]>(
      `/users/${encodeURIComponent(login)}/repos?per_page=100&page=${page}&sort=pushed&type=owner`,
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const r of batch) out.push(mapRepo(r));
    if (batch.length < 100) break;
  }
  return out;
}

/** Repos for an org via /orgs/{org}/repos. */
async function ghListOrgRepos(org: string): Promise<GhRepoSummary[]> {
  const out: GhRepoSummary[] = [];
  for (const page of [1, 2]) {
    const batch = await ghApi<any[]>(
      `/orgs/${encodeURIComponent(org)}/repos?per_page=100&page=${page}&sort=pushed`,
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const r of batch) out.push(mapRepo(r));
    if (batch.length < 100) break;
  }
  return out;
}

/**
 * List repos for an arbitrary owner (user or org) — tries org first, falls back to user.
 * Returns empty array on not-found; rethrows other errors (with owner annotated).
 */
export async function ghListOwnerRepos(owner: string): Promise<GhRepoSummary[]> {
  let orgErr: GhError | null = null;
  try {
    return await ghListOrgRepos(owner);
  } catch (err) {
    if (!(err instanceof GhError)) throw err;
    if (err.code !== "not-found" && err.code !== "forbidden-scope") {
      err.owner = owner;
      throw err;
    }
    orgErr = err;
  }
  try {
    return await ghListUserRepos(owner);
  } catch (err) {
    if (err instanceof GhError) {
      err.owner = owner;
      if (err.code === "not-found") {
        /* If org probe was forbidden but user probe says not-found, the owner
         * exists as an org we can't see — surface as forbidden-scope so the UI
         * can tell the user to grant read:org. */
        if (orgErr && orgErr.code === "forbidden-scope") throw orgErr;
        return [];
      }
    }
    throw err;
  }
}

export interface ListReposOptions {
  /** Additional owners (user or org logins) to aggregate, beyond the authenticated viewer. */
  extraOwners?: string[];
}

export interface ListReposResult {
  repos: GhRepoSummary[];
  /** Owners actually queried that returned at least one repo. */
  owners: string[];
  /** Owners that were attempted but failed (e.g. not accessible). */
  ownerErrors: Array<{ owner: string; code: string; message: string }>;
  /** True if the authenticated /user/repos call succeeded. */
  authedListOk: boolean;
}

/**
 * Aggregate repositories from:
 *   1. /user/repos (owner, collaborator, organization_member)
 *   2. /users/{viewer}/repos as a fallback for viewer's owned repos
 *   3. /orgs/{owner}/repos or /users/{owner}/repos for each configured extra owner
 *
 * Deduplicated by full_name. Failures for individual extra owners are recorded
 * in ownerErrors and do not abort the aggregate.
 *
 * Extra owners come from `opts.extraOwners` plus the env var
 * `DEPLOYOPS_GITHUB_OWNERS` (comma-separated). `Future-Horizons-Education` is
 * always probed as a default best-effort and silently dropped if inaccessible.
 */
export async function ghListRepos(opts: ListReposOptions = {}): Promise<ListReposResult> {
  const result: ListReposResult = {
    repos: [],
    owners: [],
    ownerErrors: [],
    authedListOk: false,
  };
  const seen = new Map<string, GhRepoSummary>();

  /* 1. Authenticated user repos. If this fails, abort — auth is broken. */
  try {
    const authed = await ghListAuthenticatedUserRepos();
    result.authedListOk = true;
    for (const r of authed) seen.set(r.fullName, r);
  } catch (err) {
    /* Auth-related failure: rethrow so route layer maps to a structured error. */
    throw err;
  }

  /* 2. Viewer's owned namespace as a fallback for any missed repos. */
  let viewerLogin: string | null = null;
  try {
    const viewer = await ghViewer();
    viewerLogin = viewer.login;
    const viewerOwned = await ghListUserRepos(viewer.login);
    for (const r of viewerOwned) if (!seen.has(r.fullName)) seen.set(r.fullName, r);
  } catch (err) {
    /* Non-fatal: just record. */
    if (err instanceof GhError) {
      result.ownerErrors.push({ owner: "(viewer)", code: err.code, message: err.message });
    }
  }

  /* 3. Configured extra owners, deduped + filtered. */
  const envOwners = (process.env.DEPLOYOPS_GITHUB_OWNERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const defaultOwners = ["Future-Horizons-Education"];
  const requested = [...envOwners, ...defaultOwners, ...(opts.extraOwners ?? [])];
  const dedup = Array.from(new Set(requested.filter((o) => o && o !== viewerLogin)));

  for (const owner of dedup) {
    try {
      const repos = await ghListOwnerRepos(owner);
      let added = 0;
      for (const r of repos) {
        if (!seen.has(r.fullName)) { seen.set(r.fullName, r); added++; }
      }
      if (added > 0 || repos.length > 0) result.owners.push(owner);
      else result.ownerErrors.push({ owner, code: "empty", message: `no repositories visible for ${owner} (may be empty or token lacks access)` });
    } catch (err) {
      if (err instanceof GhError) {
        const message = err.code === "forbidden-scope"
          ? `GitHub token connected but cannot list repos for owner ${owner}; required scopes: repo for private repos, read:org for org/private org repos.`
          : err.message;
        result.ownerErrors.push({ owner, code: err.code, message });
      } else {
        result.ownerErrors.push({ owner, code: "unknown", message: String(err) });
      }
    }
  }

  /* Sort by pushedAt desc for consistent UX. */
  const repos = Array.from(seen.values()).sort((a, b) => {
    const A = a.pushedAt ? Date.parse(a.pushedAt) : 0;
    const B = b.pushedAt ? Date.parse(b.pushedAt) : 0;
    return B - A;
  });
  result.repos = repos;
  /* Surface viewer in owners list if any of their repos came through. */
  if (viewerLogin && repos.some((r) => r.owner === viewerLogin)) {
    if (!result.owners.includes(viewerLogin)) result.owners.unshift(viewerLogin);
  }
  return result;
}

/** List branches for a repository. */
export async function ghListBranches(repo: string): Promise<GhBranch[]> {
  const data = await ghApi<any[]>(`/repos/${repo}/branches?per_page=100`);
  return (Array.isArray(data) ? data : []).map((b) => ({
    name: b.name,
    protected: !!b.protected,
    sha: b.commit?.sha ?? "",
  }));
}

/**
 * Inspect a repo at a given branch and infer framework, build commands,
 * Prisma / Docker / Vercel / GitHub Actions presence, and env-example keys.
 *
 * All inferences are best-effort and read-only. Failure to fetch any one
 * file is treated as that file being absent.
 */
export async function ghDetectConfig(repo: string, branch: string): Promise<DetectionResult> {
  const result: DetectionResult = {
    framework: "unknown",
    packageManager: "unknown",
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
    notes: [],
  };

  /* root listing — required */
  const root = await getDirContents(repo, branch);
  if (root.length === 0) {
    result.notes.push("Could not read repository root (empty repo or unreadable branch).");
    return result;
  }
  const rootMap = new Map(root.map((e) => [e.name.toLowerCase(), e]));

  /* package manager */
  if (rootMap.has("pnpm-lock.yaml")) result.packageManager = "pnpm";
  else if (rootMap.has("yarn.lock")) result.packageManager = "yarn";
  else if (rootMap.has("bun.lockb") || rootMap.has("bun.lock")) result.packageManager = "bun";
  else if (rootMap.has("package-lock.json")) result.packageManager = "npm";
  else if (rootMap.has("poetry.lock") || rootMap.has("pyproject.toml")) result.packageManager = "poetry";
  else if (rootMap.has("requirements.txt")) result.packageManager = "pip";

  /* docker */
  result.docker.dockerfile = rootMap.has("dockerfile");
  result.docker.compose = rootMap.has("docker-compose.yml") || rootMap.has("docker-compose.yaml")
    || rootMap.has("compose.yml") || rootMap.has("compose.yaml");

  /* vercel */
  if (rootMap.has("vercel.json")) result.vercel.configFile = "vercel.json";
  else if (rootMap.has(".vercel")) result.vercel.configFile = ".vercel/";

  /* package.json scan */
  if (rootMap.has("package.json")) {
    const text = await getFile(repo, branch, "package.json");
    if (text) {
      try {
        const pkg = JSON.parse(text);
        const scripts: Record<string, string> = pkg.scripts ?? {};
        const deps: Record<string, string> = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };

        result.buildCommand = scripts.build ?? null;
        result.devCommand = scripts.dev ?? scripts.develop ?? null;
        result.startCommand = scripts.start ?? null;

        if (deps.next) {
          result.framework = "nextjs";
          result.outputDir = ".next";
          result.blueprintRecommendation = deps.prisma || deps["@prisma/client"]
            ? "next-prisma-neon-vercel" : "next-prisma-neon-vercel";
          result.recommendedProviders = deps.prisma || deps["@prisma/client"]
            ? ["github", "vercel", "neon", "prisma"]
            : ["github", "vercel"];
        } else if (deps.astro) {
          result.framework = "astro";
          result.outputDir = "dist";
          result.blueprintRecommendation = "astro-prisma-neon";
          result.recommendedProviders = ["github", "vercel"];
        } else if (deps.vite && (deps.react || deps["react-dom"])) {
          result.framework = "vite-react";
          result.outputDir = "dist";
          result.blueprintRecommendation = "static-vercel";
          result.recommendedProviders = ["github", "vercel"];
        } else if (deps.vite) {
          result.framework = "static";
          result.outputDir = "dist";
          result.blueprintRecommendation = "static-vercel";
          result.recommendedProviders = ["github", "vercel"];
        } else if (deps.express || deps.fastify || deps.koa || deps["@hono/node-server"]) {
          result.framework = deps.express ? "express" : "node";
          result.outputDir = "dist";
          result.blueprintRecommendation = "node-api-neon-railway";
          result.recommendedProviders = deps.prisma || deps["@prisma/client"]
            ? ["github", "neon", "prisma", "railway"]
            : ["github", "neon", "railway"];
        } else if (deps["@sveltejs/kit"]) {
          result.framework = "svelte";
          result.outputDir = ".svelte-kit";
          result.blueprintRecommendation = "static-vercel";
          result.recommendedProviders = ["github", "vercel"];
        } else if (deps.react) {
          result.framework = "react";
          result.outputDir = "build";
          result.blueprintRecommendation = "static-vercel";
          result.recommendedProviders = ["github", "vercel"];
        } else {
          result.framework = "node";
          result.outputDir = "dist";
        }

        if (deps.prisma || deps["@prisma/client"]) {
          result.prisma.present = true;
          if (!result.recommendedProviders.includes("prisma")) result.recommendedProviders.push("prisma");
          if (!result.recommendedProviders.includes("neon")) result.recommendedProviders.push("neon");
        }
      } catch (e) {
        result.notes.push("package.json present but failed to parse.");
      }
    }
  } else if (rootMap.has("requirements.txt") || rootMap.has("pyproject.toml")) {
    /* python project — sniff for fastapi */
    const reqText = await getFile(repo, branch, rootMap.has("requirements.txt") ? "requirements.txt" : "pyproject.toml");
    if (reqText && /fastapi/i.test(reqText)) {
      result.framework = "fastapi";
    } else {
      result.framework = "python";
    }
    result.startCommand = "uvicorn main:app --host 0.0.0.0 --port 8000";
    result.recommendedProviders = ["github", "neon"];
  } else if (rootMap.has("index.html")) {
    result.framework = "static";
    result.outputDir = ".";
    result.blueprintRecommendation = "static-vercel";
    result.recommendedProviders = ["github", "vercel"];
  }

  /* prisma */
  const prismaDir = rootMap.get("prisma");
  if (prismaDir && prismaDir.type === "dir") {
    const prismaContents = await getDirContents(repo, branch, "prisma");
    const schema = prismaContents.find((f) => f.name === "schema.prisma");
    const migrations = prismaContents.find((f) => f.name === "migrations" && f.type === "dir");
    result.prisma.present = result.prisma.present || !!schema;
    result.prisma.schemaPath = schema ? schema.path : (result.prisma.present ? "prisma/schema.prisma" : null);
    result.prisma.migrationsPath = migrations ? migrations.path : null;
  }

  /* github actions */
  const ghDir = rootMap.get(".github");
  if (ghDir && ghDir.type === "dir") {
    const ghContents = await getDirContents(repo, branch, ".github");
    const wf = ghContents.find((f) => f.name === "workflows" && f.type === "dir");
    if (wf) {
      const workflows = await getDirContents(repo, branch, ".github/workflows");
      result.githubActions.workflowPaths = workflows
        .filter((f) => f.type === "file" && /\.ya?ml$/i.test(f.name))
        .map((f) => f.path);
    }
  }

  /* env example */
  const envCandidates = [".env.example", ".env.sample", ".env.template", "env.example"];
  for (const cand of envCandidates) {
    if (rootMap.has(cand)) {
      const text = await getFile(repo, branch, cand);
      if (text) {
        result.envExample.path = cand;
        result.envExample.keys = text
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith("#"))
          .map((l) => l.split("=")[0]?.trim())
          .filter((k): k is string => Boolean(k));
      }
      break;
    }
  }

  /* env suggestions: union of detected keys + provider-derived */
  const sugg = new Set<string>(result.envExample.keys);
  if (result.recommendedProviders.includes("neon") || result.prisma.present) sugg.add("DATABASE_URL");
  if (result.framework === "nextjs") sugg.add("NEXTAUTH_SECRET");
  if (result.framework === "node" || result.framework === "express") { sugg.add("PORT"); }
  result.envSuggestions = Array.from(sugg);

  return result;
}
