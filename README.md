# DeployOps Console

Single-operator dashboard for managing GitHub-to-Vercel deployments backed by
Neon Postgres. This is **Session 1** of a multi-session build: the app boots,
authenticates the operator against an email allowlist, talks to Neon, and
renders an empty styled dashboard. Provider integrations (GitHub App, Vercel
SDK, Neon API) ship in Sessions 2-6.

The first two products this console will manage are:

- `RJK134/herm-platform`
- `RJK134/EquiSmile`

## Stack

- Next.js 14 (App Router) + TypeScript strict
- Tailwind CSS + shadcn/ui (slate base, custom mint accent)
- NextAuth v5 (Auth.js) with the GitHub OAuth provider, JWT sessions
- Drizzle ORM + drizzle-kit, `@neondatabase/serverless` HTTP driver
- Geist Sans + Geist Mono via `next/font/google`
- Lucide icons
- pnpm

## Prerequisites

1. **Node 20+** and **pnpm 9+**.
2. **A Neon project** with a pooled connection string. Sign up at
   <https://neon.tech>, create a project, and copy the *pooled* connection
   string from the Neon dashboard (the one ending in `-pooler.<region>...`).
3. **A GitHub OAuth App** for operator sign-in only (this is *not* the GitHub
   App that will read repos in Session 2). Create at
   <https://github.com/settings/developers> -> OAuth Apps -> New OAuth App.
   - Homepage URL: your dev or prod URL
   - Authorization callback URL: `<NEXTAUTH_URL>/api/auth/callback/github`
     (e.g. `http://localhost:3000/api/auth/callback/github`)
4. **Two 32-byte base64 secrets**, one for `NEXTAUTH_SECRET` and one for
   `ENCRYPTION_KEY`. Generate each with `openssl rand -base64 32`.

## Local development

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment
cp .env.example .env.local
# Open .env.local and fill in every variable. The app fails fast on startup
# if anything is missing or malformed.

# 3. Apply the schema to your Neon database
pnpm db:push
# (Use `pnpm db:generate` first if you prefer migration files.)

# 4. Start the dev server
pnpm dev
# -> http://localhost:3000
```

Visiting `/` while signed out redirects to `/signin`. Sign in with the GitHub
account whose verified email matches `ALLOWED_EMAIL` and you land on the
Overview page. Any other email is rejected with a clear error.

`pnpm typecheck` and `pnpm build` should both succeed with zero errors.

## Database

The Drizzle schema in `src/lib/db/schema.ts` defines all eight tables that the
project will eventually use. Session 1 only writes through the `users` flow
(via NextAuth JWT, no DB write yet), but the full schema is applied so that
later sessions can add data without another migration:

- `users` - operator profile (one row, post-Session 2)
- `provider_credentials` - encrypted GitHub App, Vercel, Neon credentials
- `projects` - one row per managed repo
- `blueprints` - declarative deploy recipes
- `runs` - one trip through the deploy pipeline
- `stages` - per-step status, logs, output, errors
- `webhook_events` - inbound GitHub/Vercel webhook log
- `audit_log` - human-readable timeline of every privileged action

`drizzle.config.ts` is preconfigured for Postgres. `pnpm db:push` will apply
the schema to whatever `DATABASE_URL` points at.

## Deploying to Vercel

> Stop here in Session 1 and review the env var checklist below before
> connecting the repo to Vercel. The user runs the deploy themselves.

### 1. Vercel project settings

| Setting          | Value                              |
| ---------------- | ---------------------------------- |
| Framework Preset | Next.js                            |
| Build Command    | `pnpm build` (default)             |
| Install Command  | `pnpm install --frozen-lockfile`   |
| Output Directory | `.next` (default)                  |
| Node.js Version  | 20.x                               |

### 2. Environment variables to set in Vercel

Set every one of these in **Project Settings -> Environment Variables**, for
all environments (Production, Preview, Development):

1. `DATABASE_URL` - Neon **pooled** connection string
2. `NEXTAUTH_SECRET` - `openssl rand -base64 32`
3. `NEXTAUTH_URL` - the production URL (e.g. `https://deployops.example.com`)
4. `GITHUB_OAUTH_CLIENT_ID` - from the operator-sign-in OAuth App
5. `GITHUB_OAUTH_CLIENT_SECRET` - from the operator-sign-in OAuth App
6. `ALLOWED_EMAIL` - the operator's GitHub-verified email
7. `ENCRYPTION_KEY` - `openssl rand -base64 32` (unused this session, validated)
8. `DEPLOYOPS_LIVE` - `0` for Session 1; never set to `1` until Session 5+

### 3. GitHub OAuth App callback URL

Add the production callback URL to the OAuth App as a second callback (or
create a separate OAuth App for prod). Format:

```
<NEXTAUTH_URL>/api/auth/callback/github
```

For example, `https://deployops.example.com/api/auth/callback/github`.

## Routes

| Path              | Description                                          |
| ----------------- | ---------------------------------------------------- |
| `/`               | Overview (KPI cards + coming-soon panels)            |
| `/projects`       | Placeholder (Session 2)                              |
| `/runs`           | Placeholder (Session 4)                              |
| `/blueprints`     | Placeholder (Session 3)                              |
| `/pipelines`      | Placeholder (Session 3)                              |
| `/access`         | Placeholder (Session 5)                              |
| `/providers`      | Connection Center placeholder (Session 2)            |
| `/settings`       | Operator email + sign-out + build info               |
| `/signin`         | GitHub sign-in (public)                              |
| `/api/health`     | DB ping; `{ ok, db, commit }`; 200/503; public       |
| `/api/auth/*`     | NextAuth handlers (public)                           |

Every route except `/signin`, `/api/health`, and `/api/auth/*` is auth-gated
by `src/middleware.ts`.

## What ships in later sessions

- **Session 2**: Encryption helper, GitHub App + Vercel + Neon connection
  forms, projects table populated.
- **Session 3**: Blueprint catalog and editor, the eight-stage pipeline spec.
- **Session 4**: Run orchestrator, stage timeline, log streaming, dry-run plans.
- **Session 5**: Live mode, access modes, custom domains, audit log surface.
- **Session 6**: Fix Bot, webhooks, readiness checks, architecture page.
