/**
 * Vercel REST API adapter — real, no simulation.
 *
 * This module is the single boundary for live Vercel deployments. It:
 *
 *   - validates a token (round-trip /v2/user)
 *   - finds or returns a clear actionable error for a Vercel project
 *     linked to a given GitHub repo
 *   - triggers a deployment via POST /v13/deployments using the GitHub
 *     repo source. This requires the Vercel-GitHub integration to be
 *     installed on the GitHub org/user — when it isn't, we surface that
 *     as a structured `vercel-github-integration-required` error rather
 *     than pretending success.
 *   - polls GET /v13/deployments/{id} until the deployment is READY,
 *     ERROR, CANCELED, or the timeout fires.
 *   - fetches deployment events (build/runtime logs) via /v3/deployments/{id}/events
 *     and returns them verbatim — no synthetic log lines.
 *
 * Secrets policy:
 *   - The Vercel token is accepted as an argument. It is never logged,
 *     never stored on this module, and never returned to the client.
 *   - Token-bearing headers go to api.vercel.com only.
 *
 * Errors:
 *   - All upstream failures are wrapped in `VercelError` with a stable
 *     `code` so the route layer can map to a UI message without leaking
 *     token material.
 */

import { Buffer } from "node:buffer";

const VERCEL_API = "https://api.vercel.com";
const DEFAULT_TIMEOUT_MS = 12000;

export class VercelError extends Error {
  status: number;
  code: string;
  detail: any;
  constructor(message: string, status: number, code: string, detail: any = null) {
    super(message);
    this.name = "VercelError";
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

interface FetchOptions {
  method?: string;
  body?: any;
  query?: Record<string, string | number | undefined>;
  timeoutMs?: number;
}

async function vercelFetch(
  token: string,
  path: string,
  opts: FetchOptions = {},
): Promise<{ status: number; ok: boolean; json: any | null; text: string }> {
  const url = new URL(VERCEL_API + path);
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
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
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
      throw new VercelError("Vercel API request timed out", 504, "timeout");
    }
    throw new VercelError(`Vercel API request failed: ${err?.message ?? err}`, 502, "network");
  } finally {
    clearTimeout(t);
  }
}

/* --------------------------- top-level checks --------------------------- */

export interface VercelUser {
  uid: string;
  username: string;
  email?: string | null;
  name?: string | null;
}

export async function vercelGetUser(token: string): Promise<VercelUser> {
  const res = await vercelFetch(token, "/v2/user");
  if (!res.ok || !res.json?.user) {
    if (res.status === 401 || res.status === 403) {
      throw new VercelError("Vercel token is unauthorized", 401, "unauthorized");
    }
    throw new VercelError(`Vercel /v2/user failed (${res.status})`, res.status, "auth-check");
  }
  const u = res.json.user;
  return {
    uid: String(u.uid ?? u.id ?? u.username ?? ""),
    username: u.username ?? u.name ?? "",
    email: u.email ?? null,
    name: u.name ?? null,
  };
}

export interface VercelTeam {
  id: string;
  slug: string;
  name: string;
}

export async function vercelListTeams(token: string): Promise<VercelTeam[]> {
  const res = await vercelFetch(token, "/v2/teams");
  if (!res.ok) return [];
  const teams = Array.isArray(res.json?.teams) ? res.json.teams : [];
  return teams.map((t: any) => ({ id: String(t.id), slug: String(t.slug), name: String(t.name ?? t.slug) }));
}

/* ------------------------------- projects ------------------------------- */

export interface VercelProject {
  id: string;
  name: string;
  framework: string | null;
  /** When the project is linked to GitHub, this carries the link metadata. */
  link: {
    type: "github";
    org: string;
    repo: string;
    repoId?: string | number | null;
    productionBranch?: string | null;
  } | null;
  rootDirectory: string | null;
  buildCommand: string | null;
  outputDirectory: string | null;
}

function projectFromApi(p: any): VercelProject {
  const link = p?.link && p.link.type === "github"
    ? {
        type: "github" as const,
        org: String(p.link.org ?? ""),
        repo: String(p.link.repo ?? ""),
        repoId: p.link.repoId ?? null,
        productionBranch: p.link.productionBranch ?? null,
      }
    : null;
  return {
    id: String(p.id ?? ""),
    name: String(p.name ?? ""),
    framework: p.framework ?? null,
    link,
    rootDirectory: p.rootDirectory ?? null,
    buildCommand: p.buildCommand ?? null,
    outputDirectory: p.outputDirectory ?? null,
  };
}

/**
 * List all Vercel projects scoped by team or user. Pages through the v9 API.
 */
export async function vercelListProjects(
  token: string,
  teamId?: string,
): Promise<VercelProject[]> {
  const collected: VercelProject[] = [];
  let until: string | undefined;
  for (let page = 0; page < 10; page++) {
    const res = await vercelFetch(token, "/v9/projects", {
      query: { teamId, limit: 100, until },
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new VercelError("Vercel token is unauthorized", 401, "unauthorized");
      }
      throw new VercelError(`Vercel /v9/projects failed (${res.status})`, res.status, "list-projects");
    }
    const projects = Array.isArray(res.json?.projects) ? res.json.projects : [];
    for (const p of projects) collected.push(projectFromApi(p));
    const next = res.json?.pagination?.next;
    if (!next) break;
    until = String(next);
  }
  return collected;
}

/**
 * Find a Vercel project that is linked to the given GitHub repo. Returns
 * the first match — Vercel allows multiple projects per repo (e.g. monorepo
 * sub-paths) but the typical case is one.
 */
export async function vercelFindProjectForRepo(
  token: string,
  fullName: string,
  teamId?: string,
): Promise<VercelProject | null> {
  const [owner, repoName] = fullName.split("/");
  if (!owner || !repoName) return null;
  const all = await vercelListProjects(token, teamId);
  const lcOwner = owner.toLowerCase();
  const lcRepo = repoName.toLowerCase();
  return all.find((p) =>
    p.link &&
    p.link.org.toLowerCase() === lcOwner &&
    p.link.repo.toLowerCase() === lcRepo,
  ) ?? null;
}

/* ----------------------------- deployments ----------------------------- */

export type VercelDeploymentReadyState =
  | "QUEUED" | "INITIALIZING" | "BUILDING"
  | "READY" | "ERROR" | "CANCELED";

export interface VercelDeployment {
  id: string;
  url: string;                     // raw deployment URL (e.g. <project>-<hash>.vercel.app)
  inspectorUrl: string | null;     // build inspector URL
  status: VercelDeploymentReadyState | string;
  readyState: VercelDeploymentReadyState | string;
  /** Production alias (set when the deployment becomes the prod alias). */
  aliasUrl: string | null;
  /** Sets of available aliases. Empty for previews until they're attached. */
  aliases: string[];
  errorMessage: string | null;
  errorCode: string | null;
  /** Raw response for debugging. Excluded from API responses to clients. */
  raw?: any;
}

function deploymentFromApi(d: any): VercelDeployment {
  const aliases: string[] = Array.isArray(d?.alias) ? d.alias.map((a: any) => String(a)) : [];
  const aliasUrl = aliases.length > 0 ? `https://${aliases[0]}` : null;
  const url = d?.url ? `https://${d.url}` : "";
  const inspectorUrl = d?.inspectorUrl ?? d?.inspector ?? null;
  const readyState = String(d?.readyState ?? d?.status ?? "QUEUED");
  return {
    id: String(d?.id ?? d?.uid ?? ""),
    url,
    inspectorUrl,
    status: readyState,
    readyState,
    aliasUrl,
    aliases,
    errorMessage: d?.errorMessage ?? d?.error?.message ?? null,
    errorCode: d?.errorCode ?? d?.error?.code ?? null,
    raw: d,
  };
}

export interface CreateDeploymentInput {
  /** Vercel project name as registered in Vercel. */
  projectName: string;
  /** Repo `owner/name` — used by Vercel-GitHub integration to identify source. */
  repo: string;
  /** Numeric repo id from GitHub if known (improves Vercel disambiguation). */
  repoId?: string | number | null;
  /** Branch ref. Vercel resolves the latest commit on that branch. */
  branch: string;
  /** "production" deploys are aliased to the prod domain; previews are not. */
  target: "production" | "preview";
  /** Optional team scope. */
  teamId?: string;
}

/**
 * Create a deployment from a GitHub source on Vercel. Requires the
 * Vercel-GitHub integration to be installed on the org/user.
 *
 * Vercel API documentation reference (v13):
 *   POST /v13/deployments
 *   {
 *     "name": "<project>",
 *     "gitSource": { "type": "github", "ref": "main", "org": "...", "repo": "..." },
 *     "target": "production" | undefined for preview
 *   }
 */
export async function vercelCreateDeploymentFromGitHub(
  token: string,
  input: CreateDeploymentInput,
): Promise<VercelDeployment> {
  const [org, repoName] = input.repo.split("/");
  if (!org || !repoName) {
    throw new VercelError(`invalid repo "${input.repo}" — expected owner/name`, 400, "bad-repo");
  }

  const body: Record<string, any> = {
    name: input.projectName,
    gitSource: {
      type: "github",
      ref: input.branch,
      org,
      repo: repoName,
      ...(input.repoId ? { repoId: input.repoId } : {}),
    },
  };
  if (input.target === "production") body.target = "production";

  const res = await vercelFetch(token, "/v13/deployments", {
    method: "POST",
    body,
    query: { teamId: input.teamId },
  });

  if (!res.ok) {
    const code = String(res.json?.error?.code ?? "");
    const msg = res.json?.error?.message ?? `Vercel deploy create failed (${res.status})`;
    /* Map common upstream errors to actionable codes. */
    if (res.status === 401 || res.status === 403) {
      throw new VercelError("Vercel token unauthorized for deployment create", res.status, "unauthorized", res.json?.error);
    }
    if (
      code === "missing_github_integration" ||
      code === "github_app_not_installed" ||
      code === "not_found_repo" ||
      /github.*integration/i.test(msg) ||
      /repo.*not.*linked/i.test(msg) ||
      /not authorized to access this repository/i.test(msg)
    ) {
      throw new VercelError(
        "Vercel-GitHub integration is required for this repo. Install the Vercel app on the GitHub org/user, " +
        "import the project once via the Vercel dashboard, then retry.",
        409, "vercel-github-integration-required", res.json?.error,
      );
    }
    if (code === "project_not_found") {
      throw new VercelError(
        "Vercel project not found. Import the repo on Vercel first to create a project.",
        404, "project-not-found", res.json?.error,
      );
    }
    throw new VercelError(msg, res.status, code || "deploy-create-failed", res.json?.error);
  }

  return deploymentFromApi(res.json);
}

/**
 * Fetch the current state of a deployment.
 */
export async function vercelGetDeployment(
  token: string,
  deploymentId: string,
  teamId?: string,
): Promise<VercelDeployment> {
  const res = await vercelFetch(token, `/v13/deployments/${encodeURIComponent(deploymentId)}`, {
    query: { teamId },
  });
  if (!res.ok) {
    if (res.status === 404) throw new VercelError("Deployment not found", 404, "deployment-not-found");
    if (res.status === 401 || res.status === 403) {
      throw new VercelError("Vercel token unauthorized for deployment read", res.status, "unauthorized");
    }
    throw new VercelError(`Vercel deployment fetch failed (${res.status})`, res.status, "deployment-fetch-failed");
  }
  return deploymentFromApi(res.json);
}

/**
 * Fetch real deployment events (build + runtime). Vercel's API returns these
 * in chronological order. We do not invent any events — if the API returns
 * an empty list we surface that.
 */
export interface VercelDeploymentEvent {
  type: string;
  text: string;
  createdAt: number | null;
  payload?: any;
}

export async function vercelGetDeploymentEvents(
  token: string,
  deploymentId: string,
  teamId?: string,
): Promise<VercelDeploymentEvent[]> {
  const res = await vercelFetch(token, `/v3/deployments/${encodeURIComponent(deploymentId)}/events`, {
    query: { teamId, follow: 0, limit: 1000 },
    timeoutMs: 20000,
  });
  if (!res.ok) {
    if (res.status === 404) return [];
    if (res.status === 401 || res.status === 403) {
      throw new VercelError("Vercel token unauthorized for deployment events", res.status, "unauthorized");
    }
    throw new VercelError(`Vercel deployment events fetch failed (${res.status})`, res.status, "events-fetch-failed");
  }
  /* The API returns either an array or NDJSON depending on `follow`. With
   * follow=0 it's an array of event objects. */
  const raw = Array.isArray(res.json) ? res.json : [];
  return raw.map((ev: any): VercelDeploymentEvent => ({
    type: String(ev.type ?? "log"),
    text: typeof ev.text === "string"
      ? ev.text
      : typeof ev.payload?.text === "string"
        ? ev.payload.text
        : JSON.stringify(ev.payload ?? ev),
    createdAt: typeof ev.created === "number"
      ? ev.created
      : typeof ev.createdAt === "number"
        ? ev.createdAt
        : null,
    payload: ev.payload ?? null,
  }));
}

/* --------------------------- polling helpers --------------------------- */

export function isTerminal(state: string): boolean {
  return state === "READY" || state === "ERROR" || state === "CANCELED";
}

/**
 * Poll a deployment until it reaches a terminal state or the timeout fires.
 * Calls `onTick` after each poll so callers can persist progress + log
 * intermediate states. The poll interval grows from 2s to 10s.
 */
export async function pollDeploymentUntilDone(
  token: string,
  deploymentId: string,
  opts: {
    teamId?: string;
    timeoutMs?: number;
    onTick?: (d: VercelDeployment) => Promise<void> | void;
  } = {},
): Promise<VercelDeployment> {
  const deadline = Date.now() + (opts.timeoutMs ?? 5 * 60 * 1000);
  let interval = 2000;
  let last: VercelDeployment | null = null;
  while (Date.now() < deadline) {
    const d = await vercelGetDeployment(token, deploymentId, opts.teamId);
    last = d;
    if (opts.onTick) await opts.onTick(d);
    if (isTerminal(String(d.readyState))) return d;
    await sleep(interval);
    interval = Math.min(10000, Math.floor(interval * 1.5));
  }
  if (last) return last;
  throw new VercelError("polling timeout (no response)", 504, "poll-timeout");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/* ------------------------ inspector URL helper ------------------------- */

/**
 * Build a deterministic inspector URL when the API doesn't return one.
 * Vercel inspector URLs follow the shape:
 *   https://vercel.com/<owner>/<project>/<deploymentId-without-prefix>
 * Best-effort — when the project name or owner is unknown we return null.
 */
export function buildInspectorUrl(
  ownerOrTeamSlug: string | null,
  projectName: string | null,
  deploymentId: string | null,
): string | null {
  if (!ownerOrTeamSlug || !projectName || !deploymentId) return null;
  const id = deploymentId.replace(/^dpl_/, "");
  return `https://vercel.com/${encodeURIComponent(ownerOrTeamSlug)}/${encodeURIComponent(projectName)}/${encodeURIComponent(id)}`;
}

/* -------------------------- safe error rendering ----------------------- */

/**
 * Sanitize an error for client/log output. Strips token-shaped strings.
 */
export function safeMessage(message: string): string {
  return message.replace(/(?:Bearer\s+)?[A-Za-z0-9_\-]{20,}/g, "[redacted]");
}

/** Quick base64 helper for stable cache keys (no secret material). */
export function shortHash(s: string): string {
  return Buffer.from(s).toString("base64url").slice(0, 12);
}
