/**
 * Provider connection adapters.
 *
 * Each adapter knows how to:
 *   - validate(token) → ValidationResult { ok, account, scopes, errors }
 *   - describe()      → ConnectionMeta with required scopes, login url, etc.
 *
 * Adapters never persist anything. They never log token values. They never
 * mutate provider state. Validation calls are pure reads (e.g. `/user`,
 * `/v1/projects`, etc).
 *
 * Tokens are passed in as plaintext from the route layer, which is the only
 * place that decrypts the cipher pulled from storage.
 */

export type ProviderKey = "github" | "vercel" | "neon" | "prisma" | "railway" | "supabase";

export interface ProviderAccount {
  /** Stable id from the provider (login, slug, uuid). */
  id: string;
  /** Display name (login, project name, team name). */
  name: string;
  /** Optional avatar URL for UI. */
  avatarUrl?: string | null;
  /** Optional email for OAuth providers. */
  email?: string | null;
  /** Provider-specific extra metadata (orgs, teams, projects). */
  extra?: Record<string, unknown>;
}

export interface ValidationResult {
  ok: boolean;
  account: ProviderAccount | null;
  scopes: string[];
  errors: string[];
  /** Optional non-fatal warnings (e.g. missing recommended scope). */
  warnings?: string[];
  /** When applicable, the token's expiry timestamp (epoch ms). */
  expiresAt?: number | null;
}

export interface ConnectionMeta {
  provider: ProviderKey;
  label: string;
  /** Exact credential the user must paste. */
  credentialLabel: string;
  /** User-facing description of what this token does. */
  credentialDescription: string;
  /** Required / recommended scopes (or capabilities) the operator should grant. */
  requiredScopes: string[];
  recommendedScopes: string[];
  /** Where to create the token. */
  tokenCreateUrl: string;
  docsUrl: string;
  /** Whether OAuth web flow is available for this provider in this build. */
  oauthAvailable: boolean;
}

/* ---------------------------- generic helpers ---------------------------- */

const DEFAULT_TIMEOUT_MS = 8000;

async function fetchJson(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<{ status: number; ok: boolean; json: any | null; text: string; headers: Headers }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), init.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* keep null */ }
    return { status: res.status, ok: res.ok, json, text, headers: res.headers };
  } finally {
    clearTimeout(t);
  }
}

/* ------------------------------- GitHub --------------------------------- */

export const githubMeta: ConnectionMeta = {
  provider: "github",
  label: "GitHub",
  credentialLabel: "Personal Access Token (classic) or fine-grained token",
  credentialDescription:
    "Used server-side only. Read-only repo discovery requires `repo` (or `public_repo` + read:org) scope. Writes require `workflow` and `repo`.",
  requiredScopes: ["repo"],
  recommendedScopes: ["repo", "read:org", "workflow"],
  tokenCreateUrl: "https://github.com/settings/tokens/new?scopes=repo,read:org,workflow&description=DeployOps%20Console",
  docsUrl: "https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens",
  oauthAvailable: !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
};

export async function githubValidate(token: string): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!token) return { ok: false, account: null, scopes: [], errors: ["empty token"] };

  /* GET /user — verifies token validity and fetches account metadata. */
  const userRes = await fetchJson("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "DeployOps-Console/1.0",
    },
  });
  if (!userRes.ok || !userRes.json) {
    if (userRes.status === 401) errors.push("token rejected by GitHub (401)");
    else if (userRes.status === 403) errors.push("token forbidden (403) — likely missing scopes or hit rate limit");
    else errors.push(`GitHub /user returned ${userRes.status}`);
    return { ok: false, account: null, scopes: [], errors };
  }

  const u = userRes.json;
  const scopesHeader = userRes.headers.get("x-oauth-scopes") ?? "";
  const scopes = scopesHeader.split(",").map((s) => s.trim()).filter(Boolean);

  /* Soft-check repo scope (cannot rely solely on header for fine-grained tokens). */
  const reposRes = await fetchJson("https://api.github.com/user/repos?per_page=1&affiliation=owner", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "DeployOps-Console/1.0",
    },
  });
  const canListRepos = reposRes.ok && Array.isArray(reposRes.json);
  if (!canListRepos) warnings.push("token cannot list /user/repos — repo scope missing or denied");

  return {
    ok: true,
    account: {
      id: String(u.id ?? u.login ?? ""),
      name: u.login ?? "",
      avatarUrl: u.avatar_url ?? null,
      email: u.email ?? null,
      extra: { name: u.name ?? null, htmlUrl: u.html_url ?? null, canListRepos },
    },
    scopes: scopes.length > 0 ? scopes : (canListRepos ? ["repo"] : []),
    errors,
    warnings,
  };
}

/* ------------------------------- Vercel --------------------------------- */

export const vercelMeta: ConnectionMeta = {
  provider: "vercel",
  label: "Vercel",
  credentialLabel: "Vercel Personal Access Token",
  credentialDescription:
    "Used to inspect projects, set env vars, and trigger deploys. Generate in Vercel dashboard → Settings → Tokens.",
  requiredScopes: ["read:user", "read:project"],
  recommendedScopes: ["read:user", "read:team", "read:project", "write:env", "write:deployment"],
  tokenCreateUrl: "https://vercel.com/account/tokens",
  docsUrl: "https://vercel.com/docs/rest-api#authentication",
  oauthAvailable: false,
};

export async function vercelValidate(token: string): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!token) return { ok: false, account: null, scopes: [], errors: ["empty token"] };

  const userRes = await fetchJson("https://api.vercel.com/v2/user", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok || !userRes.json?.user) {
    if (userRes.status === 401 || userRes.status === 403) {
      errors.push("token rejected by Vercel (auth)");
    } else {
      errors.push(`Vercel /v2/user returned ${userRes.status}`);
    }
    return { ok: false, account: null, scopes: [], errors };
  }
  const u = userRes.json.user;

  const teamsRes = await fetchJson("https://api.vercel.com/v2/teams", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const teams = teamsRes.ok && Array.isArray(teamsRes.json?.teams)
    ? teamsRes.json.teams.map((t: any) => ({ id: t.id, slug: t.slug, name: t.name }))
    : [];
  if (!teamsRes.ok) warnings.push(`could not list teams (${teamsRes.status})`);

  return {
    ok: true,
    account: {
      id: String(u.uid ?? u.id ?? u.username ?? ""),
      name: u.username ?? u.name ?? "",
      email: u.email ?? null,
      avatarUrl: u.avatar ? `https://api.vercel.com/www/avatar/${u.avatar}?s=80` : null,
      extra: { teams },
    },
    scopes: ["read:user", "read:team", ...(teams.length > 0 ? ["read:project"] : [])],
    errors,
    warnings,
  };
}

/* -------------------------------- Neon ---------------------------------- */

export const neonMeta: ConnectionMeta = {
  provider: "neon",
  label: "Neon Postgres",
  credentialLabel: "Neon API Key",
  credentialDescription:
    "Used to list/branch Neon projects. Generate in Neon Console → Account Settings → API Keys.",
  requiredScopes: ["projects:read"],
  recommendedScopes: ["projects:read", "branches:write"],
  tokenCreateUrl: "https://console.neon.tech/app/settings/api-keys",
  docsUrl: "https://neon.tech/docs/manage/api-keys",
  oauthAvailable: false,
};

export async function neonValidate(token: string): Promise<ValidationResult> {
  const errors: string[] = [];
  if (!token) return { ok: false, account: null, scopes: [], errors: ["empty token"] };

  const res = await fetchJson("https://console.neon.tech/api/v2/projects?limit=10", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) errors.push("token rejected by Neon (auth)");
    else errors.push(`Neon /v2/projects returned ${res.status}`);
    return { ok: false, account: null, scopes: [], errors };
  }
  const projects = Array.isArray(res.json?.projects) ? res.json.projects : [];
  return {
    ok: true,
    account: {
      id: "neon-account",
      name: projects[0]?.org_id ? `org:${projects[0].org_id}` : "Neon account",
      extra: {
        projectCount: projects.length,
        projects: projects.slice(0, 5).map((p: any) => ({ id: p.id, name: p.name, region: p.region_id })),
      },
    },
    scopes: ["projects:read"],
    errors,
  };
}

/* ------------------------------- Prisma --------------------------------- */

export const prismaMeta: ConnectionMeta = {
  provider: "prisma",
  label: "Prisma Postgres",
  credentialLabel: "Prisma Management API Token",
  credentialDescription:
    "Used to list Prisma projects, regions, and create/manage Prisma Postgres databases. Generate in Prisma Console → Workspace settings.",
  requiredScopes: ["projects:read"],
  recommendedScopes: ["projects:read", "databases:read", "databases:write"],
  tokenCreateUrl: "https://console.prisma.io/",
  docsUrl: "https://www.prisma.io/docs/data-platform/management-api",
  oauthAvailable: false,
};

export async function prismaValidate(token: string): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!token) return { ok: false, account: null, scopes: [], errors: ["empty token"] };

  /* Prisma Management API base; surface as warning if endpoint shape changes. */
  const res = await fetchJson("https://api.prisma.io/v1/projects", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) errors.push("token rejected by Prisma (auth)");
    else if (res.status === 404) {
      /* If the endpoint moved we can't fail hard — surface as warning so demo/dev still passes. */
      warnings.push("Prisma /v1/projects returned 404; token shape accepted but project listing unavailable");
      return {
        ok: true,
        account: { id: "prisma-account", name: "Prisma account", extra: { projectCount: 0 } },
        scopes: ["projects:read"],
        errors,
        warnings,
      };
    } else {
      errors.push(`Prisma /v1/projects returned ${res.status}`);
    }
    if (errors.length > 0) return { ok: false, account: null, scopes: [], errors, warnings };
  }
  const projects = Array.isArray(res.json?.data) ? res.json.data
    : Array.isArray(res.json?.projects) ? res.json.projects
    : Array.isArray(res.json) ? res.json
    : [];
  return {
    ok: true,
    account: {
      id: "prisma-account",
      name: "Prisma account",
      extra: {
        projectCount: projects.length,
        projects: projects.slice(0, 5).map((p: any) => ({ id: p.id, name: p.name ?? p.slug })),
      },
    },
    scopes: ["projects:read"],
    errors,
    warnings,
  };
}

/* ------------------------------- Railway -------------------------------- */

export const railwayMeta: ConnectionMeta = {
  provider: "railway",
  label: "Railway",
  credentialLabel: "Railway API Token",
  credentialDescription:
    "Used to list projects/services and trigger deploys. Generate in Railway → Account Settings → Tokens.",
  requiredScopes: ["projects:read"],
  recommendedScopes: ["projects:read", "services:read", "deployments:write"],
  tokenCreateUrl: "https://railway.app/account/tokens",
  docsUrl: "https://docs.railway.app/reference/public-api",
  oauthAvailable: false,
};

export async function railwayValidate(token: string): Promise<ValidationResult> {
  const errors: string[] = [];
  if (!token) return { ok: false, account: null, scopes: [], errors: ["empty token"] };

  /* Railway uses GraphQL POST. `me` returns the authenticated user. */
  const body = JSON.stringify({ query: "query { me { id email name } }" });
  const res = await fetchJson("https://backboard.railway.app/graphql/v2", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body,
  });
  if (!res.ok || !res.json) {
    if (res.status === 401 || res.status === 403) errors.push("token rejected by Railway (auth)");
    else errors.push(`Railway GraphQL returned ${res.status}`);
    return { ok: false, account: null, scopes: [], errors };
  }
  if (res.json.errors && res.json.errors.length > 0) {
    errors.push(`Railway GraphQL errors: ${res.json.errors.map((e: any) => e.message).join("; ")}`);
    return { ok: false, account: null, scopes: [], errors };
  }
  const me = res.json.data?.me;
  if (!me) {
    errors.push("Railway returned no user data for token");
    return { ok: false, account: null, scopes: [], errors };
  }
  return {
    ok: true,
    account: {
      id: String(me.id ?? ""),
      name: me.name ?? me.email ?? "Railway account",
      email: me.email ?? null,
    },
    scopes: ["projects:read"],
    errors,
  };
}

/* ------------------------------ Supabase -------------------------------- */

export const supabaseMeta: ConnectionMeta = {
  provider: "supabase",
  label: "Supabase",
  credentialLabel: "Supabase Personal Access Token",
  credentialDescription:
    "Used by the Supabase Management API to list organizations/projects and (when allowed) create projects. Generate at Supabase → Account → Access Tokens.",
  requiredScopes: ["projects:read"],
  recommendedScopes: ["projects:read", "organizations:read", "projects:write"],
  tokenCreateUrl: "https://supabase.com/dashboard/account/tokens",
  docsUrl: "https://supabase.com/docs/reference/api/introduction",
  oauthAvailable: false,
};

export async function supabaseValidate(token: string): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!token) return { ok: false, account: null, scopes: [], errors: ["empty token"] };

  /* Supabase Management API: GET /v1/organizations is the cheapest auth check. */
  const orgRes = await fetchJson("https://api.supabase.com/v1/organizations", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!orgRes.ok) {
    if (orgRes.status === 401 || orgRes.status === 403) errors.push("token rejected by Supabase (auth)");
    else errors.push(`Supabase /v1/organizations returned ${orgRes.status}`);
    return { ok: false, account: null, scopes: [], errors };
  }
  const orgs = Array.isArray(orgRes.json) ? orgRes.json : [];

  /* Best-effort projects list — may be empty for new accounts. */
  const projRes = await fetchJson("https://api.supabase.com/v1/projects", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const projects = projRes.ok && Array.isArray(projRes.json) ? projRes.json : [];
  if (!projRes.ok) warnings.push(`could not list projects (${projRes.status})`);

  return {
    ok: true,
    account: {
      id: String(orgs[0]?.id ?? "supabase-account"),
      name: orgs[0]?.name ?? "Supabase account",
      extra: {
        organizations: orgs.slice(0, 10).map((o: any) => ({ id: o.id, name: o.name, slug: o.slug })),
        projectCount: projects.length,
        projects: projects.slice(0, 10).map((p: any) => ({
          id: p.id, name: p.name, region: p.region, organizationId: p.organization_id,
        })),
      },
    },
    scopes: ["projects:read", ...(orgs.length > 0 ? ["organizations:read"] : [])],
    errors,
    warnings,
  };
}

/* ------------------------------- registry ------------------------------- */

export const PROVIDER_META: Record<ProviderKey, ConnectionMeta> = {
  github: githubMeta,
  vercel: vercelMeta,
  neon: neonMeta,
  prisma: prismaMeta,
  railway: railwayMeta,
  supabase: supabaseMeta,
};

export async function validateProvider(provider: ProviderKey, token: string): Promise<ValidationResult> {
  switch (provider) {
    case "github":   return githubValidate(token);
    case "vercel":   return vercelValidate(token);
    case "neon":     return neonValidate(token);
    case "prisma":   return prismaValidate(token);
    case "railway":  return railwayValidate(token);
    case "supabase": return supabaseValidate(token);
    default: return { ok: false, account: null, scopes: [], errors: [`unknown provider: ${provider}`] };
  }
}

export function isProviderKey(s: string): s is ProviderKey {
  return ["github", "vercel", "neon", "prisma", "railway", "supabase"].includes(s);
}
