/**
 * Provider connection / auth API.
 *
 * Routes:
 *   GET    /api/connections                              — list all connections (no secrets)
 *   GET    /api/connections/:provider                    — single connection (no secrets)
 *   POST   /api/connections/:provider/connect-token      — accept a token, validate, encrypt+store
 *   POST   /api/connections/:provider/validate           — re-validate stored token
 *   POST   /api/connections/:provider/disconnect         — remove encrypted token + mark disconnected
 *   POST   /api/connections/:provider/live               — toggle per-provider live mode
 *   GET    /api/auth/github/oauth/start                  — redirect to GitHub for OAuth web flow
 *   GET    /api/auth/github/oauth/callback               — exchange code → token (encrypts + stores)
 *   GET    /api/live/readiness                           — global live-readiness summary
 *   GET    /api/connections/:provider/events             — connection event log (no secrets)
 *
 * Tokens are encrypted with AES-256-GCM via server/crypto. They are NEVER
 * returned to the client after being saved. The UI gets `tokenLast4` only.
 *
 * Live actions (mutations) require ALL of:
 *   - DEPLOYOPS_LIVE=1 globally
 *   - The connection's `liveMode` is true
 *   - The connection is `connected` and recently validated
 *
 * Reads (e.g. listing repos) are allowed once the connection is `connected`.
 */
import type { Express, Request, Response } from "express";
import crypto from "node:crypto";
import { storage } from "./storage";
import { encrypt, decrypt, encryptionConfigured, encryptionKeyFingerprint, EncryptionUnavailable, tokenLast4 } from "./crypto";
import {
  PROVIDER_META, validateProvider, isProviderKey,
  type ProviderKey, type ValidationResult,
} from "./connections";

function parseJSON<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

interface ConnectionView {
  provider: string;
  status: string;
  authMethod: string;
  liveMode: boolean;
  account: Record<string, unknown>;
  scopes: string[];
  errors: string[];
  tokenLast4: string | null;
  expiresAt: number | null;
  lastValidatedAt: number | null;
  createdAt: number;
  updatedAt: number;
  meta: {
    label: string;
    credentialLabel: string;
    credentialDescription: string;
    requiredScopes: string[];
    recommendedScopes: string[];
    tokenCreateUrl: string;
    docsUrl: string;
    oauthAvailable: boolean;
  };
}

function viewFor(provider: ProviderKey, row: any | null): ConnectionView {
  const meta = PROVIDER_META[provider];
  if (!row) {
    return {
      provider,
      status: "disconnected",
      authMethod: "none",
      liveMode: false,
      account: {},
      scopes: [],
      errors: [],
      tokenLast4: null,
      expiresAt: null,
      lastValidatedAt: null,
      createdAt: 0,
      updatedAt: 0,
      meta,
    };
  }
  return {
    provider: row.provider,
    status: row.status,
    authMethod: row.authMethod,
    liveMode: !!row.liveMode,
    account: parseJSON<Record<string, unknown>>(row.accountJson, {}),
    scopes: parseJSON<string[]>(row.scopesJson, []),
    errors: parseJSON<string[]>(row.errorsJson, []),
    tokenLast4: row.tokenLast4 ?? null,
    expiresAt: row.expiresAt ?? null,
    lastValidatedAt: row.lastValidatedAt ?? null,
    createdAt: row.createdAt ?? 0,
    updatedAt: row.updatedAt ?? 0,
    meta,
  };
}

async function logEvent(
  provider: string, event: string, ok: boolean, detail: string,
  meta: Record<string, unknown> = {}, connectionId: number | null = null,
): Promise<void> {
  try {
    await storage.createConnectionEvent({
      connectionId: connectionId as any,
      provider,
      event,
      ok,
      detail,
      meta: JSON.stringify(meta),
    } as any);
  } catch (err) {
    console.warn("[connections] failed to write event log:", err);
  }
}

/**
 * Resolve the active token for a provider, in priority order:
 *   1. stored connected token (decrypted)
 *   2. process.env fallback (e.g. GITHUB_TOKEN, VERCEL_TOKEN, NEON_API_KEY, ...)
 *
 * Returns { token, source } or null when no auth is available.
 */
export async function resolveActiveToken(provider: ProviderKey): Promise<{ token: string; source: "connection" | "env" } | null> {
  const row = await storage.getProviderConnection(provider);
  if (row && row.status === "connected" && row.tokenCipher) {
    try {
      const tok = decrypt(row.tokenCipher);
      if (tok) return { token: tok, source: "connection" };
    } catch (err) {
      console.warn(`[connections] decrypt failed for ${provider}:`, (err as Error).message);
    }
  }
  const envName = ENV_TOKEN_NAME[provider];
  const envTok = (process.env[envName] ?? "").trim();
  if (envTok) return { token: envTok, source: "env" };
  return null;
}

const ENV_TOKEN_NAME: Record<ProviderKey, string> = {
  github: "GITHUB_TOKEN",
  vercel: "VERCEL_TOKEN",
  neon: "NEON_API_KEY",
  prisma: "PRISMA_API_KEY",
  railway: "RAILWAY_TOKEN",
};

export function envTokenName(provider: ProviderKey): string {
  return ENV_TOKEN_NAME[provider];
}

/* ---------------------------- OAuth (GitHub) ----------------------------- */

const OAUTH_STATES = new Map<string, { createdAt: number; redirectTo?: string }>();
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function pruneOauthStates(): void {
  const cutoff = Date.now() - OAUTH_STATE_TTL_MS;
  Array.from(OAUTH_STATES.entries()).forEach(([k, v]) => {
    if (v.createdAt < cutoff) OAUTH_STATES.delete(k);
  });
}

function githubOauthEnabled(): boolean {
  return !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
}

function callbackUrl(req: Request): string {
  const explicit = (process.env.GITHUB_OAUTH_CALLBACK_URL ?? "").trim();
  if (explicit) return explicit;
  const proto = (req.headers["x-forwarded-proto"] as string) || (req.protocol);
  const host = (req.headers["x-forwarded-host"] as string) || req.get("host") || "localhost";
  return `${proto}://${host}/api/auth/github/oauth/callback`;
}

/* ----------------------------- registration ----------------------------- */

export function registerConnectionRoutes(app: Express): void {
  /** Generic provider key validation. */
  function checkProvider(req: Request, res: Response): ProviderKey | null {
    const key = String(req.params.provider ?? "").trim();
    if (!isProviderKey(key)) {
      res.status(400).json({ error: `unknown provider: ${key}`, code: "bad-request" });
      return null;
    }
    return key;
  }

  app.get("/api/connections", async (_req, res) => {
    const rows = await storage.listProviderConnections();
    const byProvider = new Map(rows.map((r) => [r.provider, r]));
    const keys: ProviderKey[] = ["github", "vercel", "neon", "prisma", "railway"];
    const items = keys.map((k) => viewFor(k, byProvider.get(k) ?? null));
    res.json({
      ok: true,
      encryptionConfigured: encryptionConfigured(),
      keyFingerprint: encryptionKeyFingerprint(),
      githubOauthEnabled: githubOauthEnabled(),
      liveEnabled: process.env.DEPLOYOPS_LIVE === "1",
      connections: items,
    });
  });

  app.get("/api/connections/:provider", async (req, res) => {
    const key = checkProvider(req, res); if (!key) return;
    const row = await storage.getProviderConnection(key);
    res.json({ ok: true, connection: viewFor(key, row ?? null) });
  });

  /** Connect via direct token paste — admin/self-hosted fallback for any provider. */
  app.post("/api/connections/:provider/connect-token", async (req, res) => {
    const key = checkProvider(req, res); if (!key) return;
    const tokenRaw = typeof req.body?.token === "string" ? req.body.token.trim() : "";
    const confirm = typeof req.body?.confirm === "string" ? req.body.confirm.trim() : "";
    if (!tokenRaw) return res.status(400).json({ error: "token is required", code: "bad-request" });

    /* Demo / mock mode — doesn't touch encryption or external APIs. Demo
     * tokens skip the confirmation gate because they carry no secret. */
    const isDemo = tokenRaw.toLowerCase() === "demo" || tokenRaw.toLowerCase().startsWith("demo-");

    /* Confirmation gate for real tokens only. */
    const confirmRequired = process.env.DEPLOYOPS_CONFIRM_TOKEN_SAVE !== "0";
    if (!isDemo && confirmRequired && confirm.toUpperCase() !== "I UNDERSTAND") {
      return res.status(400).json({
        error: "confirmation phrase required",
        code: "confirmation-required",
        detail: 'Send body { token, confirm: "I UNDERSTAND" } to save a real token. This protects against accidental paste.',
      });
    }

    if (isDemo) {
      const row = await storage.upsertProviderConnection({
        provider: key,
        status: "connected",
        authMethod: "demo",
        tokenCipher: null,
        tokenLast4: "demo",
        refreshCipher: null,
        accountJson: JSON.stringify({ id: "demo", name: `${PROVIDER_META[key].label} (demo)`, demo: true }),
        scopesJson: JSON.stringify(PROVIDER_META[key].requiredScopes),
        errorsJson: JSON.stringify([]),
        liveMode: false,
        expiresAt: null,
        lastValidatedAt: Date.now(),
      } as any);
      await logEvent(key, "connect", true, "demo connection saved", { authMethod: "demo" }, row.id);
      return res.json({ ok: true, connection: viewFor(key, row), validation: { ok: true, demo: true, errors: [], warnings: ["demo connection — no live calls will be made"] } });
    }

    /* Real token path — requires encryption key. */
    if (!encryptionConfigured()) {
      return res.status(409).json({
        error: "encryption key not configured",
        code: "setup-required",
        detail: "Set DEPLOYOPS_SECRET_KEY (or TOKEN_ENCRYPTION_KEY) to a long random string before saving real tokens. Demo connections (token='demo') still work.",
      });
    }

    /* Validate before saving — no point storing a token that doesn't work. */
    let v: ValidationResult;
    try {
      v = await validateProvider(key, tokenRaw);
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      await logEvent(key, "validate", false, `validation threw: ${msg}`);
      return res.status(502).json({ error: `provider validation failed: ${msg}`, code: "validation-error" });
    }
    if (!v.ok) {
      await logEvent(key, "validate", false, "token rejected", { errors: v.errors });
      return res.status(400).json({
        error: "token rejected by provider",
        code: "invalid-token",
        validation: { ok: false, errors: v.errors, warnings: v.warnings ?? [] },
      });
    }

    let cipher: string;
    try { cipher = encrypt(tokenRaw); }
    catch (err) {
      if (err instanceof EncryptionUnavailable) {
        return res.status(409).json({ error: err.message, code: err.code });
      }
      throw err;
    }

    const row = await storage.upsertProviderConnection({
      provider: key,
      status: "connected",
      authMethod: "pat",
      tokenCipher: cipher,
      tokenLast4: tokenLast4(tokenRaw),
      refreshCipher: null,
      accountJson: JSON.stringify(v.account ?? {}),
      scopesJson: JSON.stringify(v.scopes),
      errorsJson: JSON.stringify(v.errors),
      liveMode: false,
      expiresAt: v.expiresAt ?? null,
      lastValidatedAt: Date.now(),
    } as any);
    await logEvent(key, "connect", true, "token saved", {
      authMethod: "pat",
      account: v.account?.name ?? null,
      scopes: v.scopes,
    }, row.id);

    res.json({ ok: true, connection: viewFor(key, row), validation: { ok: true, errors: [], warnings: v.warnings ?? [] } });
  });

  /** Re-validate the stored token (or env fallback) for a provider. */
  app.post("/api/connections/:provider/validate", async (req, res) => {
    const key = checkProvider(req, res); if (!key) return;
    const row = await storage.getProviderConnection(key);
    /* Demo connection — validate is a no-op success. */
    if (row && row.authMethod === "demo") {
      const updated = await storage.upsertProviderConnection({
        ...row,
        lastValidatedAt: Date.now(),
      } as any);
      await logEvent(key, "validate", true, "demo connection — skipping live validate", {}, row.id);
      return res.json({ ok: true, connection: viewFor(key, updated), validation: { ok: true, demo: true, errors: [], warnings: [] } });
    }

    const resolved = await resolveActiveToken(key);
    if (!resolved) {
      await logEvent(key, "validate", false, "no token available");
      return res.status(404).json({ error: "no token available for provider", code: "no-token" });
    }

    let v: ValidationResult;
    try { v = await validateProvider(key, resolved.token); }
    catch (err) {
      const msg = (err as Error).message ?? String(err);
      await logEvent(key, "validate", false, `validation threw: ${msg}`);
      return res.status(502).json({ error: msg, code: "validation-error" });
    }

    /* Update connection row in place (no token mutation). */
    const updated = await storage.upsertProviderConnection({
      provider: key,
      status: v.ok ? "connected" : "invalid",
      authMethod: row?.authMethod ?? (resolved.source === "env" ? "env" : "pat"),
      tokenCipher: row?.tokenCipher ?? null,
      tokenLast4: row?.tokenLast4 ?? (resolved.source === "env" ? "env" : null),
      refreshCipher: row?.refreshCipher ?? null,
      accountJson: JSON.stringify(v.account ?? parseJSON<Record<string, unknown>>(row?.accountJson, {})),
      scopesJson: JSON.stringify(v.scopes),
      errorsJson: JSON.stringify(v.errors),
      liveMode: row?.liveMode ?? false,
      expiresAt: v.expiresAt ?? row?.expiresAt ?? null,
      lastValidatedAt: Date.now(),
    } as any);
    await logEvent(key, "validate", v.ok, v.ok ? "ok" : v.errors.join("; "), { source: resolved.source, scopes: v.scopes }, updated.id);

    res.json({
      ok: v.ok,
      connection: viewFor(key, updated),
      validation: { ok: v.ok, errors: v.errors, warnings: v.warnings ?? [], source: resolved.source },
    });
  });

  app.post("/api/connections/:provider/disconnect", async (req, res) => {
    const key = checkProvider(req, res); if (!key) return;
    const row = await storage.getProviderConnection(key);
    /* Mark disconnected and wipe token cipher so the row remains for audit, but no secret is recoverable. */
    const updated = await storage.upsertProviderConnection({
      provider: key,
      status: "disconnected",
      authMethod: "none",
      tokenCipher: null,
      tokenLast4: null,
      refreshCipher: null,
      accountJson: "{}",
      scopesJson: "[]",
      errorsJson: "[]",
      liveMode: false,
      expiresAt: null,
      lastValidatedAt: null,
    } as any);
    await logEvent(key, "disconnect", true, "token removed", { hadToken: !!row?.tokenCipher }, updated.id);
    res.json({ ok: true, connection: viewFor(key, updated) });
  });

  app.post("/api/connections/:provider/live", async (req, res) => {
    const key = checkProvider(req, res); if (!key) return;
    const want = req.body?.live === true || req.body?.live === "true";
    const row = await storage.getProviderConnection(key);
    if (!row || row.status !== "connected") {
      return res.status(409).json({ error: "provider not connected", code: "not-connected" });
    }
    if (want && row.errorsJson && parseJSON<string[]>(row.errorsJson, []).length > 0) {
      return res.status(409).json({ error: "validation errors must be cleared before enabling live mode", code: "blocked" });
    }
    const updated = await storage.upsertProviderConnection({ ...row, liveMode: want } as any);
    await logEvent(key, "live-toggle", true, want ? "live mode enabled" : "live mode disabled", {}, updated.id);
    /* Mirror into the legacy providers table so the rest of the app reflects the change. */
    try { await storage.setProviderMode(key, want ? "live" : "dry-run"); } catch { /* legacy table may not have row */ }
    res.json({ ok: true, connection: viewFor(key, updated) });
  });

  app.get("/api/connections/:provider/events", async (req, res) => {
    const key = checkProvider(req, res); if (!key) return;
    const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
    const events = await storage.listConnectionEvents(key, limit);
    res.json({ ok: true, events });
  });

  /* ------------------------- GitHub OAuth ------------------------------- */

  app.get("/api/auth/github/oauth/start", (req, res) => {
    if (!githubOauthEnabled()) {
      return res.status(503).json({
        error: "GitHub OAuth not configured",
        code: "oauth-disabled",
        detail: "Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET to enable OAuth web flow.",
      });
    }
    pruneOauthStates();
    const state = crypto.randomBytes(16).toString("hex");
    const redirectTo = typeof req.query.redirect === "string" ? req.query.redirect : undefined;
    OAUTH_STATES.set(state, { createdAt: Date.now(), redirectTo });
    const cb = callbackUrl(req);
    const params = new URLSearchParams({
      client_id: process.env.GITHUB_CLIENT_ID!,
      redirect_uri: cb,
      scope: "repo read:org workflow",
      state,
      allow_signup: "false",
    });
    const url = `https://github.com/login/oauth/authorize?${params.toString()}`;
    /* If client expects JSON (?json=1), return URL; else redirect. */
    if (req.query.json) return res.json({ ok: true, url });
    res.redirect(url);
  });

  app.get("/api/auth/github/oauth/callback", async (req, res) => {
    if (!githubOauthEnabled()) return res.status(503).send("GitHub OAuth not configured");
    const code = String(req.query.code ?? "");
    const state = String(req.query.state ?? "");
    if (!code || !state) return res.status(400).send("missing code/state");
    const stored = OAUTH_STATES.get(state);
    if (!stored) return res.status(400).send("invalid or expired state");
    OAUTH_STATES.delete(state);
    if (!encryptionConfigured()) {
      return res.status(409).send("Encryption key not configured. Set DEPLOYOPS_SECRET_KEY to enable saving OAuth tokens.");
    }

    /* Exchange code for token. */
    let tokenJson: any = null;
    try {
      const exchange = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: process.env.GITHUB_CLIENT_ID,
          client_secret: process.env.GITHUB_CLIENT_SECRET,
          code,
          redirect_uri: callbackUrl(req),
          state,
        }),
      });
      tokenJson = await exchange.json();
    } catch (err) {
      await logEvent("github", "connect", false, `oauth exchange failed: ${(err as Error).message}`);
      return res.status(502).send("OAuth exchange failed");
    }
    const accessToken = tokenJson?.access_token;
    if (!accessToken) {
      await logEvent("github", "connect", false, "oauth exchange returned no token", { error: tokenJson?.error });
      return res.status(400).send(`OAuth exchange returned no token: ${tokenJson?.error_description ?? tokenJson?.error ?? "unknown"}`);
    }

    /* Validate to fetch account/scopes. */
    let v: ValidationResult;
    try { v = await validateProvider("github", accessToken); }
    catch (err) {
      await logEvent("github", "validate", false, `oauth validate threw: ${(err as Error).message}`);
      return res.status(502).send("OAuth token validation failed");
    }
    if (!v.ok) {
      await logEvent("github", "validate", false, `oauth token rejected: ${v.errors.join("; ")}`);
      return res.status(400).send(`OAuth token rejected: ${v.errors.join("; ")}`);
    }

    const cipher = encrypt(accessToken);
    const row = await storage.upsertProviderConnection({
      provider: "github",
      status: "connected",
      authMethod: "oauth",
      tokenCipher: cipher,
      tokenLast4: tokenLast4(accessToken),
      refreshCipher: null,
      accountJson: JSON.stringify(v.account ?? {}),
      scopesJson: JSON.stringify(v.scopes),
      errorsJson: JSON.stringify([]),
      liveMode: false,
      expiresAt: null,
      lastValidatedAt: Date.now(),
    } as any);
    await logEvent("github", "connect", true, "oauth web flow completed", { account: v.account?.name }, row.id);

    /* Redirect back to the UI; default to /#/providers. */
    const target = stored.redirectTo && stored.redirectTo.startsWith("/")
      ? stored.redirectTo
      : "/#/providers";
    res.redirect(target);
  });

  /* ------------------------- Live readiness ----------------------------- */

  app.get("/api/live/readiness", async (_req, res) => {
    const rows = await storage.listProviderConnections();
    const byProvider = new Map(rows.map((r) => [r.provider, r]));
    const keys: ProviderKey[] = ["github", "vercel", "neon", "prisma", "railway"];
    const liveEnabled = process.env.DEPLOYOPS_LIVE === "1";
    const encConfigured = encryptionConfigured();
    const items = keys.map((k) => {
      const row = byProvider.get(k);
      const meta = PROVIDER_META[k];
      const view = viewFor(k, row ?? null);
      const blockers: string[] = [];
      if (view.status !== "connected") blockers.push("connection not established");
      const missingScopes = meta.requiredScopes.filter((s) => !view.scopes.includes(s));
      if (missingScopes.length > 0) blockers.push(`missing scopes: ${missingScopes.join(", ")}`);
      if (view.errors.length > 0) blockers.push(`validation errors: ${view.errors.join("; ")}`);
      if (!view.liveMode) blockers.push("live mode disabled for this provider");
      if (!liveEnabled) blockers.push("DEPLOYOPS_LIVE not set to 1");
      if (view.authMethod === "pat" && !encConfigured) blockers.push("encryption key missing");
      return {
        provider: k,
        label: meta.label,
        status: view.status,
        authMethod: view.authMethod,
        liveMode: view.liveMode,
        scopes: view.scopes,
        missingScopes,
        errors: view.errors,
        blockers,
        liveReady: blockers.length === 0,
      };
    });
    const readyCount = items.filter((i) => i.liveReady).length;
    res.json({
      ok: true,
      summary: {
        liveEnabled,
        encryptionConfigured: encConfigured,
        keyFingerprint: encryptionKeyFingerprint(),
        githubOauthEnabled: githubOauthEnabled(),
        readyProviders: readyCount,
        totalProviders: keys.length,
        liveDeployBlocked: !liveEnabled || readyCount === 0,
      },
      providers: items,
      globalBlockers: [
        ...(liveEnabled ? [] : ["DEPLOYOPS_LIVE is not 1 — system-wide dry-run"]),
        ...(encConfigured ? [] : ["DEPLOYOPS_SECRET_KEY (or TOKEN_ENCRYPTION_KEY) not set — cannot store real tokens"]),
      ],
    });
  });
}
