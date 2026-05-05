# Project environment dashboards

Each project has a per-environment dashboard at `/projects/:id` that
aggregates the real state of its **Test**, **Demo / Run**, and **Production**
environments across the connected providers.

## Honesty contract

The dashboard is built on a strict honesty contract:

1. **No invented URLs.** "Open app" and "Share link" buttons appear only when
   the URL came from a real provider response (Vercel deployment metadata
   persisted from a successful live run, a stored Railway deployment URL, etc).
   Without a real URL, the card shows an honest empty state — never a
   fabricated `*.vercel.app` link.
2. **No demo/simulated success states.** Seeded projects without a real
   provider deployment resolve to `dry_run_validated` or `not_configured`.
   They never claim `live_ready`. Legacy seed runs whose status was
   `succeeded` are migrated to `validated_dry_run` on boot so the UI cannot
   confuse a plan with a real deployment.
3. **Refresh is read-only.** `POST /api/projects/:id/environments/:env/refresh-status`
   only calls provider read endpoints (Vercel `GET /v13/deployments/:id`,
   Neon `GET /projects/:id`, Supabase `GET /v1/projects`, Railway GraphQL
   `me`/`projects`). It NEVER triggers a deployment, env-var write, or any
   other provider mutation. Existing live-run gates (DEPLOYOPS_LIVE,
   confirmation phrase) still apply for any real deployment trigger, which
   continues to live behind the wizard / live execute endpoints.
4. **Blockers are explicit.** When a provider is missing or the GitHub
   integration isn't installed, the card surfaces the structured blocker
   `{ code, message, remediation }` from the existing readiness layer
   (`server/live-deploy.ts`, `server/live-providers.ts`) and links to the
   Connection Center.

## API endpoints

| Method | Path | Purpose |
| ------ | ---- | ------- |
| GET    | `/api/projects/:id/dashboard` | Full dashboard payload — project header, readiness, environment cards. Pass `?refresh=1` to trigger a read-only provider refresh. |
| GET    | `/api/projects/:id/environments` | Returns the same `EnvironmentCard[]` without the project header. |
| GET    | `/api/projects/:id/environments/:env/status` | Single environment summary (state, blockers, app URL, resources). |
| POST   | `/api/projects/:id/environments/:env/refresh-status` | Read-only provider refresh; persists Vercel readyState/url updates. |
| GET    | `/api/projects-dashboard` | Project list with state per env + real URLs (used by the Projects index page). |
| GET    | `/api/projects/:id/providers-snapshot` | Read-only viewer/account info per provider. |

## Environment states

| State | Meaning |
| ----- | ------- |
| `not_configured`     | No run targets this environment yet. |
| `blocked`            | Last live run failed readiness gates; remediation required. |
| `configuring`        | A live run is queued / pending / paused. |
| `deploying`          | A live run is in flight (`live_running`). |
| `live_ready`         | Last live run reached `live_succeeded` AND Vercel returned a public URL. |
| `live_failed`        | Last live run failed (real upstream error). |
| `dry_run_validated`  | Last run was a dry-run plan; no real deployment exists. |
| `unknown`            | Could not determine state (bad data). |

## URL provenance

| Provider  | App URL exposed when | Dashboard URL exposed when |
| --------- | ------------------- | -------------------------- |
| Vercel    | `runs.vercelUrl` / `runs.vercelAliasUrl` populated from a successful real `POST /v13/deployments` + `GET /v13/deployments/:id` | `runs.vercelInspectorUrl` populated by Vercel; or stored `provider_resources.url` |
| Railway   | `provider_resources.url` populated by the Railway adapter on a real deploy | `https://railway.app/project/:id` when we have a real `external_id` |
| Supabase  | n/a (database — no app URL) | `https://supabase.com/dashboard/project/:ref` only when we have a real project ref |
| Neon      | n/a (database) | `https://console.neon.tech/app/projects/:id` only when we have a real project id |
| Prisma    | n/a (database) | only the URL Prisma itself returned (no synthesis) |

## Required credentials for live status refresh

| Action | Credential | How to provide |
| ------ | ---------- | -------------- |
| Vercel deployment poll | Vercel token | Connection Center → Vercel; or `VERCEL_TOKEN` env var |
| Neon project read | Neon API key | Connection Center → Neon; or `NEON_API_KEY` |
| Supabase project read | Supabase access token | Connection Center → Supabase; or `SUPABASE_ACCESS_TOKEN` |
| Railway viewer / projects | Railway token | Connection Center → Railway; or `RAILWAY_TOKEN` |
| Prisma project list | Prisma management token | Connection Center → Prisma; or `PRISMA_API_KEY` |

When a token is missing, the relevant card surfaces the structured blocker
(`no-vercel-token`, `no-neon-token`, …) with a remediation pointing to
Connection Center.

## Implementation

- `server/dashboard.ts` is the aggregator. It only reads from the database
  (projects / runs / provider_resources / provisioning_steps) and, when
  `refresh: true`, performs read-only `vercelGetDeployment` /
  `neonGetProject` / `supabaseListProjects` / `railwayListProjects` /
  `prismaListProjects` calls.
- `client/src/pages/projects.tsx` is the index page (cards per project,
  three-column env summary).
- `client/src/pages/project-dashboard.tsx` is the per-project detail page.
  It renders three environment cards, a project-level header with provider
  readiness chips, blocker rows, and a Share panel that only lists URLs
  with `share.shareable === true`.
- `client/src/pages/access.tsx` was updated to pull URLs from the same
  aggregator (no more synthesised `<name>-test.vercel.app`).
- `client/src/pages/overview.tsx` links the per-project rows into the
  Projects dashboard.

## What is intentionally NOT in scope

- Triggering deployments. Use the New Deploy wizard + the existing live
  execute endpoints. The dashboard refresh is read-only.
- Editing access mode lives on the Access & domains page.
- Provisioning live database resources still goes through
  `/api/live/preflight` and `/api/live/runs/:id/execute` with the existing
  `DEPLOYOPS_LIVE=1` + confirmation-phrase gates.
