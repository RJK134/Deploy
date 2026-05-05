# DeployOps Console

DeployOps Console is a fullstack deployment-orchestration dashboard for taking
GitHub products through Test, Demo, and Deploy environments with provider paths
for GitHub, Vercel, Neon Postgres, Prisma Postgres, and optional Railway.

The console runs in safe **dry-run mode by default**. It demonstrates the full
deployment workflow, ships realistic seed data, and includes a provider-adapter
layer for wiring live GitHub CLI, Vercel CLI, Neon, and Prisma actions when
credentials and live mode are enabled.

## What's new

- **Connection Center** (`/providers`) — production-grade auth layer for all
  five providers. GitHub OAuth web flow + PAT fallback, token entry forms for
  Vercel / Neon / Prisma / Railway, validation against each provider's API,
  AES-256-GCM encryption at rest, per-provider live-mode toggles. Tokens are
  never returned to the client. Demo connections (`token: demo`) work without
  an encryption key for local development.
- **Live Readiness page** (`/readiness`) — single page summarizing what is
  blocking live deploys: encryption configured, `DEPLOYOPS_LIVE=1`, per-provider
  scopes/errors/live-mode. Each blocker is actionable.
- **Production architecture page** (`/architecture`) — visualises the Vercel +
  Neon control plane, lists required env vars, and reports the live backend.
- **Migration plan page** (`/migration`) — interactive checklist for moving
  off SQLite onto Vercel + Neon, with copy-pasteable CLI commands and per-step
  completion toggles.
- **Fix Bot** (`/fixbot`) — health monitors, detected incidents, automated
  diagnoses with confidence levels, suggested remediations, and approval gates.
  Five realistic seeded incidents (missing env var, failed Prisma migration,
  Vercel build failure, broken domain, GitHub Actions failure).
- **Database abstraction** — `server/db.ts` selects SQLite (default) or
  Postgres-via-`DATABASE_URL` automatically, so the same code path runs locally
  and on Vercel + Neon.
- **Postgres schema mirror** — `shared/schema.pg.ts` for `drizzle-kit push`
  against Neon.

## Features

- Guided deployment wizard for repo, environment, blueprint, providers, and
  review.
- Environment blueprints for Next.js, Prisma, Neon, Vercel, Node APIs,
  Railway, and static Vercel sites.
- Pipeline monitor with staged logs for repo scan, env vars, database
  provisioning, Prisma migration, CI generation, deploy, domains, and smoke
  tests.
- Provider settings for GitHub, Vercel, Neon, Prisma, and Railway.
- Access and domain manager for public, client, and private sharing modes.
- **Fix Bot** reliability module: health monitors, incidents, diagnoses,
  approval-gated remediations, audit log, and staged autonomy levels
  (`diagnose-only` → `prepare-fix` → `approval-required` → `safe-auto-fix`).
- Dark-first developer console UI with light mode.

## Local development

```bash
npm install
npm run dev
```

The app uses an Express backend, Vite React frontend, Tailwind CSS, shadcn/ui,
Drizzle, and SQLite. The local SQLite database is created on first boot and
seeded with example projects, runs, monitors, and incidents.

## Build

```bash
npm run build
npm start
```

## Production: Vercel + Neon

DeployOps Console is built to run on Vercel with Neon Postgres as the durable
data layer. See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for a complete
walkthrough. The short version:

```bash
# 1. Provision Neon, capture DATABASE_URL
# 2. Install the Postgres driver
npm install postgres
# 3. Apply schema
DEPLOYOPS_DIALECT=postgres DATABASE_URL=$DATABASE_URL npm run db:push:pg
# 4. Wire Vercel
npx vercel env add DATABASE_URL production
npx vercel deploy --prod
```

Required env vars on Vercel: `DATABASE_URL`. Optional: `DEPLOYOPS_LIVE` (set to
`1` to permit live provider mutations), `NEON_API_KEY`, `VERCEL_TOKEN`,
`GITHUB_TOKEN`.

The **Production → Architecture** and **Migration plan** pages in the app
surface the same information with the active runtime backend reported live.

## Live mode notes

Live provider operations are intentionally disabled by default. To enable live
orchestration:

1. Set `DEPLOYOPS_SECRET_KEY` (or `TOKEN_ENCRYPTION_KEY`) on the server. This
   is the master key used to encrypt provider tokens at rest. See
   [`docs/CONNECTIONS.md`](docs/CONNECTIONS.md).
2. Set `DEPLOYOPS_LIVE=1` in the server env (global gate).
3. Open **Connection Center** and connect each provider you need
   (GitHub OAuth or PAT, Vercel / Neon / Prisma / Railway tokens).
4. Flip each provider's **Live** switch on its connection card.
5. Implement the marked adapter TODOs in `server/providers.ts` and
   `server/fixbot.ts`.

The **Live Readiness** page reflects each gate in real time.

Even with all of the above, Fix Bot remediations require explicit approval
unless the incident is at `safe-auto-fix` autonomy.

## Fix Bot operating model

Fix Bot watches a configurable set of **health monitors** (HTTP, build,
migration, env, domain, workflow). When a monitor flips to `warning` or `down`,
Fix Bot creates an **incident**, runs an analyzer to produce a **diagnosis**
(root cause + evidence + confidence), and queues one or more **remediations**
(open PR, retry deploy, update env var, run migration, escalate, …).

Each incident has an **autonomy level**:

| Level                | What Fix Bot does                                             |
| -------------------- | ------------------------------------------------------------- |
| `diagnose-only`      | Reports root cause. No remediations queued.                   |
| `prepare-fix`        | Drafts remediations (PR body, env diff) but never opens them. |
| `approval-required`  | Drafts and queues. A human must approve before applying.      |
| `safe-auto-fix`      | Reserved for low-risk idempotent fixes (e.g. domain attach).  |

All remediations also default to `approvalRequired: true` and only run live
when `DEPLOYOPS_LIVE=1` AND the relevant provider is in live mode AND the
incident's autonomy is `safe-auto-fix` OR the remediation has been approved.

The full design is in [`HANDOFF.md`](HANDOFF.md) and [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).
