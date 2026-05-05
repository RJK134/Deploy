# Live Provisioning

This document describes the real provisioning paths added on the
`feature/live-provider-provisioning` branch. Every adapter described below is
a thin client around the provider's public API. There are no simulated
success states — every "ok" in this codebase corresponds to a real 2xx (or
GraphQL `data` without errors) response from the upstream provider.

## Read-only status / link aggregation

The project environment dashboard at `/projects/:id` aggregates the real
state of a project's Test / Demo / Production environments without
performing any provider write. See [PROJECT_DASHBOARDS.md](PROJECT_DASHBOARDS.md)
for the full design. The dashboard uses the provider read endpoints listed
below (Vercel `GET /v13/deployments/:id`, Neon `GET /projects/:id`, Supabase
`GET /v1/projects`, Railway GraphQL `me`/`projects`, Prisma `GET /v1/projects`)
and surfaces the same `{code, message, remediation}` blockers when
credentials or integrations are missing.

## What is wired up

| Provider  | Token env var               | Real validate | Real list      | Real provision (write)                   |
|-----------|------------------------------|---------------|----------------|------------------------------------------|
| GitHub    | `GITHUB_TOKEN`               | yes           | repos/branches | repo write via gh CLI (existing)         |
| Vercel    | `VERCEL_TOKEN`               | yes           | projects/teams | project create, env-var upsert, deploy   |
| Neon      | `NEON_API_KEY`               | yes           | projects       | project create, branch create, conn URI  |
| Prisma    | `PRISMA_API_KEY`             | yes           | projects       | database create (when Mgmt API present)  |
| Railway   | `RAILWAY_TOKEN`              | yes (GraphQL) | projects       | project create, variable upsert          |
| Supabase  | `SUPABASE_ACCESS_TOKEN`      | yes           | orgs/projects  | project create (token+org+region+pass)   |

Tokens come from two sources, in order:

1. **Connection Center** — encrypted at rest with AES-256-GCM via
   `DEPLOYOPS_SECRET_KEY`, stored in `provider_connections.token_cipher`.
2. **Process env** — server-side fallback for self-hosted ops.

Tokens are **never** returned to the client. UI sees `tokenLast4` only.
Provider connection strings (DB URIs, anon keys when freshly minted) are
stored as a `masked_secret_ref` and used server-side when injecting Vercel
env vars; the raw secret never travels back to the browser.

## Required scopes / permissions

| Provider  | Scope / capability                              | Notes |
|-----------|--------------------------------------------------|-------|
| GitHub    | `repo`, `read:org`, `workflow`                   | classic or fine-grained PAT |
| Vercel    | `read:user`, `read:team`, `read:project`, `write:env`, `write:deployment` | personal access token |
| Neon      | `projects:read` (read), `projects:write`+`branches:write` (create) | Neon Console API key |
| Prisma    | `projects:read` (always), `databases:write` (create) | Prisma Management API token; DB create requires an existing Prisma project id |
| Railway   | viewer + project read; project:write to create  | Railway account or team token |
| Supabase  | Management API: organizations:read, projects:read; projects:write to create | Supabase access token |

## Endpoints

```
GET  /api/connections                     list connection state (no secrets)
POST /api/connections/:provider/connect-token   { token, confirm: "I UNDERSTAND" }
POST /api/connections/:provider/validate       re-validate stored token
POST /api/connections/:provider/disconnect     wipe token cipher
POST /api/connections/:provider/live           toggle per-provider live mode

GET  /api/live/readiness                  global per-provider readiness summary
GET  /api/live/providers/readiness        DB providers + Supabase + Railway readiness with project lists
POST /api/live/preflight                  dry-run preflight for a {repo, branch, env, hosting, database}
POST /api/live/runs/:id/execute           execute a plan (dryRun=true default)
GET  /api/live/runs/:id/steps             list provisioning steps + provider resources

GET  /api/live/vercel/readiness           legacy Vercel-only readiness (per project row)
GET  /api/live/vercel/preflight           legacy Vercel-only preflight (no project row)
POST /api/runs/:id/start-live             legacy Vercel-only deploy starter (deprecated in favor of /api/live/runs/:id/execute)
```

## Approval gates

Real external writes require **all** of:

1. `DEPLOYOPS_LIVE=1` is set on the server.
2. The relevant `provider_connections.live_mode` is true.
3. The request body includes `confirm: "I UNDERSTAND"` (or the server is started
   with `DEPLOYOPS_CONFIRM_LIVE_DEPLOY=0` to relax that, only do this for CI).
4. `dryRun: false` in the body.

Without all four, `/api/live/runs/:id/execute` returns one of:

- `400 confirmation-required`
- `409 live_blocked` with structured `blockers[]` containing `{ code, message, remediation }`

A blocked run never produces external state. The `provisioning_steps` table
will show a `blocked` row with the exact blocker code.

## Status vocabulary

Provisioning steps and provider resources never use ambiguous "succeeded" for
dry-run paths. The vocabulary is:

```
pending              (not yet evaluated)
planned              (resource defined, not yet preflighted)
validated_dry_run    (preflight passed; no external write performed)
running              (live action in flight)
blocked              (gate not satisfied; structured blocker attached)
succeeded            (external provider returned a confirmed resource id)
failed               (external provider returned an error)
```

## Data model

Two new tables are added (mirrored in `shared/schema.ts` SQLite and
`shared/schema.pg.ts` Postgres, with idempotent boot migrations in
`server/db.ts`):

- **`provider_resources`** — one row per real external resource we've
  reasoned about: provider, resource type (project|branch|database|env-var|
  deployment|...), external id (when confirmed), masked secret ref,
  status, run + project ids, metadata JSON.
- **`provisioning_steps`** — per-step audit of a live run: provider, action
  (validate|preflight|provision|inject-env|deploy|poll), label, status,
  blocker code/message/remediation, metadata JSON.

## Security model

- Tokens are encrypted at rest. Plaintext only crosses the route layer when
  decrypted for a single API call.
- `safeMessage()` strips token-shaped strings, postgres URLs, and mysql URLs
  from any message before it touches a log line or response.
- Connection strings minted by Neon/Prisma/Supabase are stored as masked
  references (`provider://project=...&branch=...`). The actual secret value
  is fetched live from the provider when injecting Vercel env vars.
- Vercel env-var writes go through `vercelUpsertEnvVar`, which prefers PATCH
  on an existing key+target so re-running a plan is idempotent.

## What is still blocked

These items cannot be fully automated from this code path; they surface as
structured blockers with codes:

- `vercel-github-integration-required` — the user must install the Vercel
  GitHub app on the org/user. We detect this from Vercel's error response
  and return the exact remediation rather than guessing.
- `prisma-mgmt-api-unavailable` — Prisma's Management API is gated per
  workspace; without access the orchestrator returns this blocker rather
  than fabricating a database row.
- `prisma-project-required` — Prisma DB creation requires an existing
  Prisma project id. The wizard should let users pick one once Connection
  Center grows a project picker for Prisma.
- `supabase-no-organizations` — token has no orgs; user must create one in
  Supabase or supply an existing project's URL+anon key via the wizard's
  "use existing Supabase project" toggle.
- `supabase-quota` — plan/payment quota refused project creation upstream.
- `railway-projects-unavailable` — token can't list projects; usually means
  scope is too narrow.

## Manual verification

```bash
# Confirm server has registered all six providers, including Supabase.
curl -s localhost:5000/api/connections | jq '.connections[].provider'

# Per-provider readiness — all should return clean blockers when no tokens.
curl -s localhost:5000/api/live/providers/readiness | jq

# Preflight a plan — must NEVER call providers when blockers list is non-empty.
curl -s -X POST localhost:5000/api/live/preflight \
  -H 'Content-Type: application/json' \
  -d '{"repo":"acme/example","branch":"main","environment":"test",
       "hosting":"vercel","database":"neon","projectName":"example"}' | jq '.blockers'
```

To validate the live execute gates without making external writes:

```bash
# Without confirm — must 400.
curl -s -X POST localhost:5000/api/live/runs/1/execute \
  -d '{"repo":"acme/example","branch":"main","environment":"test","hosting":"vercel","database":"none","projectName":"example","dryRun":false}' \
  -H 'Content-Type: application/json'

# With confirm but no tokens — must 409 live_blocked, no external calls.
curl -s -X POST localhost:5000/api/live/runs/1/execute \
  -d '{"repo":"acme/example","branch":"main","environment":"test","hosting":"vercel","database":"none","projectName":"example","dryRun":false,"confirm":"I UNDERSTAND"}' \
  -H 'Content-Type: application/json'
```
