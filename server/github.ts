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

export class GhError extends Error {
  code: "auth-missing" | "rate-limit" | "not-found" | "network" | "unknown";
  status: number;
  detail?: string;
  constructor(code: GhError["code"], message: string, status = 500, detail?: string) {
    super(message);
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
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

function classifyGhError(stderr: string, status: number): GhError {
  const lower = stderr.toLowerCase();
  if (lower.includes("not authenticated") || lower.includes("authentication required") ||
      lower.includes("token is invalid") || lower.includes("bad credentials")) {
    return new GhError("auth-missing", "GitHub authentication missing or invalid", 401, stderr.trim());
  }
  if (lower.includes("rate limit") || lower.includes("api rate limit exceeded")) {
    return new GhError("rate-limit", "GitHub API rate limit exceeded", 429, stderr.trim());
  }
  if (lower.includes("404") || lower.includes("not found")) {
    return new GhError("not-found", "Resource not found on GitHub", 404, stderr.trim());
  }
  return new GhError("unknown", "GitHub CLI call failed", status || 500, stderr.trim());
}

async function ghApi<T = unknown>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
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
    throw new GhError("unknown", "GitHub returned non-JSON response", 500, stdout.slice(0, 200));
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

/** List the authenticated user's repositories (first up to ~200, sorted by recent push). */
export async function ghListRepos(): Promise<GhRepoSummary[]> {
  /* Two pages of 100 covers most users; cap the call cost. */
  const out: GhRepoSummary[] = [];
  for (const page of [1, 2]) {
    const batch = await ghApi<any[]>(
      `/user/repos?per_page=100&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`,
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const r of batch) {
      out.push({
        id: r.id,
        name: r.name,
        fullName: r.full_name,
        owner: r.owner?.login ?? r.full_name?.split("/")[0] ?? "",
        description: r.description,
        url: r.html_url,
        cloneUrl: r.clone_url,
        defaultBranch: r.default_branch ?? "main",
        private: !!r.private,
        fork: !!r.fork,
        archived: !!r.archived,
        language: r.language,
        pushedAt: r.pushed_at,
        updatedAt: r.updated_at,
        topics: Array.isArray(r.topics) ? r.topics : [],
      });
    }
    if (batch.length < 100) break;
  }
  return out;
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
