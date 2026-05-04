# DeployOps Console — Vercel + Neon production deployment

This guide covers running DeployOps Console itself on Vercel with Neon Postgres
as the durable data layer. The app ships SQLite-by-default; you opt into
Postgres by setting `DATABASE_URL` and installing the `postgres` driver.

## TL;DR

```bash
# 1. Provision Neon
neonctl projects create --name deployops-console
neonctl branches create --name production --parent main
DATABASE_URL=$(neonctl connection-string production --pooled --role-name app)

# 2. Install the Postgres driver
npm install postgres

# 3. Apply schema
DEPLOYOPS_DIALECT=postgres DATABASE_URL=$DATABASE_URL npm run db:push:pg

# 4. Wire Vercel
npx vercel link --yes
npx vercel env add DATABASE_URL production
# (optional) npx vercel env add DEPLOYOPS_LIVE production  # set to "1" for live mode
npx vercel deploy --prod

# 5. Validate
curl https://your-deployops.vercel.app/api/system   # backend should be "postgres"
```

## Architecture overview

The runtime control plane:

```
                +-------------+     HTTP     +-----------------------+    SQL    +----------------+
  user / api -> | Vercel Edge | -----------> | Vercel Serverless     | --------> | Neon Postgres  |
                |  (CDN/TLS)  |              |  Express handler      |           |  branch / env  |
                +-------------+              +-----------------------+           +----------------+
                                                       |                                ^
                                                       | provider adapters              |
                                                       v                                |
                                              +-----------------+                       |
                                              | github / vercel | --- writes / probes --+
                                              | neon / prisma   |
                                              | railway         |
                                              +-----------------+
                                                       |
                                                       v
                                              +-----------------+
                                              |   Fix Bot       |   diagnoses + remediations
                                              +-----------------+
```

The same diagram is rendered live in the app under **Production → Architecture**.

## Required environment variables

| Var                | Required | Source     | Notes                                                                                  |
| ------------------ | -------- | ---------- | -------------------------------------------------------------------------------------- |
| `DATABASE_URL`     | yes      | Neon       | Pooled connection string from the `production` Neon branch. Without it the app uses SQLite (ephemeral on Vercel). |
| `DEPLOYOPS_LIVE`   | no       | operator   | Set to `1` to allow live provider calls. Defaults to dry-run.                          |
| `NEON_API_KEY`     | no       | Neon       | Used by Fix Bot to inspect/branch databases.                                           |
| `VERCEL_TOKEN`     | no       | Vercel     | Used by Fix Bot to redeploy / set env vars on managed projects.                        |
| `GITHUB_TOKEN`     | no       | GitHub App | Used by Fix Bot to open issues / PRs. Or rely on the `gh` connector.                   |
| `PRISMA_API_KEY`   | no       | Prisma     | Required only if Prisma Postgres is the chosen data layer instead of Neon.             |

## Step-by-step migration

### 1. Provision Neon

Create one Neon project and branch the production database from `main`:

```bash
neonctl projects create --name deployops-console
neonctl branches create --name production --parent main
neonctl branches create --name demo --parent main
neonctl branches create --name test --parent main
```

You can also do this via the Neon UI. Capture the **pooled** connection string
for the `production` branch — that's the one you put in `DATABASE_URL`. Reserve
the **direct** connection string for migrations.

### 2. Apply the schema

The repo ships two Drizzle schemas:

- `shared/schema.ts` — SQLite (default for local dev, dry-run-friendly).
- `shared/schema.pg.ts` — Postgres (`pg-core`, used by `db:push:pg`).

Apply the Postgres schema:

```bash
npm install postgres
DEPLOYOPS_DIALECT=postgres DATABASE_URL=$DATABASE_URL npm run db:push:pg
```

`drizzle-kit push` is idempotent. Re-run it whenever `schema.pg.ts` changes.

### 3. Connect Vercel

Import the GitHub repo into Vercel (or use `npx vercel link`). The default
build command (`npm run build`) and output directory (`dist/public`) work as-is.
The Express handler is bundled to `dist/index.cjs` and is served as a Vercel
function.

Set environment variables on Vercel:

```bash
npx vercel env add DATABASE_URL production
# optional, gate live provider calls
npx vercel env add DEPLOYOPS_LIVE production
# optional, only if Fix Bot will manage external resources
npx vercel env add NEON_API_KEY production
npx vercel env add VERCEL_TOKEN production
npx vercel env add GITHUB_TOKEN production
```

### 4. First production deploy

```bash
npx vercel deploy --prod
```

Visit `/api/system` on the deployed URL. It should return:

```json
{ "db": { "backend": "postgres", "url": "postgres://app:•••@…/db" }, ... }
```

The **Production → Architecture** page in the app surfaces the same fields.

### 5. Validation

- `curl /api/system` — backend should be `postgres`, `databaseUrlPresent: true`.
- `curl /api/projects` — should return at least one row (seed data is created on
  first boot if the database is empty).
- `curl /api/fixbot/incidents` — should return the 5 seeded sample incidents.
- Open the **Fix Bot** page in the UI; verify monitors render.

### 6. Cutover validation checklist (UI)

The **Production → Migration plan** page in the app exposes the same checklist
with a per-step "done" toggle stored in your browser. Use that to drive a real
cutover.

## Operational caveats

- **Vercel filesystem is ephemeral.** Running with SQLite on Vercel will lose
  data between cold starts. Neon (or Vercel Postgres / Prisma Postgres) is
  required for production state.
- **Cold starts.** The default Express bundle starts in <1s. If you hit slow
  cold starts on Neon, check that you're using the **pooled** connection string
  (`?pgbouncer=true&sslmode=require`).
- **Drizzle dialect portability.** The application's queries are simple selects
  / inserts that work on both SQLite and Postgres. JSON-as-text columns
  round-trip cleanly because the application parses JSON itself.
- **Live mode is gated twice.** Even with `DEPLOYOPS_LIVE=1`, individual
  providers default to `dry-run`. Toggle a provider on the Providers page to
  permit live writes for that provider only.
- **Fix Bot autonomy.** Each incident has an autonomy level
  (`diagnose-only` → `prepare-fix` → `approval-required` → `safe-auto-fix`).
  Only `safe-auto-fix` permits a remediation to be applied without explicit
  human approval, and even then only when DEPLOYOPS_LIVE is on and the relevant
  provider is in live mode.

## Rollback

The fastest rollback is to revert the connection string:

```bash
npx vercel env rm DATABASE_URL production
npx vercel deploy --prod
```

The app will fall back to SQLite. On Vercel that's lossy (filesystem reset on
deploy), but the app will start. Use this to recover from a corrupted Postgres
schema while you restore from a Neon branch snapshot:

```bash
neonctl branches create --name production-restore --parent <snapshot-id>
neonctl connection-string production-restore --pooled
# update DATABASE_URL on Vercel, redeploy
```

## Where things live

| Concern                        | File                                |
| ------------------------------ | ----------------------------------- |
| DB selection (sqlite/postgres) | `server/db.ts`                      |
| Drizzle config                 | `drizzle.config.ts`                 |
| SQLite schema                  | `shared/schema.ts`                  |
| Postgres schema                | `shared/schema.pg.ts`               |
| Storage layer (CRUD)           | `server/storage.ts`                 |
| Provider adapters              | `server/providers.ts`               |
| Fix Bot adapters               | `server/fixbot.ts`                  |
| Fix Bot API routes             | `server/routes.ts` (`/api/fixbot/*`)|
| Architecture API               | `server/routes.ts` (`/api/architecture`) |
| Migration API                  | `server/routes.ts` (`/api/migration/plan`) |
| System info API                | `server/routes.ts` (`/api/system`)  |
| Architecture page              | `client/src/pages/architecture.tsx` |
| Migration page                 | `client/src/pages/migration.tsx`    |
| Fix Bot page                   | `client/src/pages/fixbot.tsx`       |
