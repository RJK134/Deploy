# DeployOps Console — Build Handoff

## Live preview
- **URL**: deployed via `deploy_website` (asset_id `df649cd4-0290-496e-b404-237c2a9adea5`) — site is rendered as a component in this conversation.
- **Project path**: `/home/user/workspace/deployops-console`
- **Build output**: `dist/public` (static) + `dist/index.cjs` (Express backend, serves API on port 5000)

## What it is
A demo-grade DeployOps Console for orchestrating GitHub deployments to Test → Demo → Deploy environments using GitHub, Vercel, Neon, Prisma, and (manual) Railway. Every provider call is currently a **dry-run simulation** — the UI is fully wired to the live adapter pattern and ships a per-provider mode toggle that flips to real CLI invocations once `DEPLOYOPS_LIVE=1` is set and individual providers are switched out of dry-run.

## Pages (hash routing)
| Route | File | Purpose |
| --- | --- | --- |
| `#/` | `client/src/pages/overview.tsx` | KPI strip · provider health card · environment readiness matrix · recent runs |
| `#/wizard` | `client/src/pages/wizard.tsx` | 5-step wizard: Project → Environment → Blueprint → Providers → Review (env vars / CI / pre-flight tabs) |
| `#/runs` | `client/src/pages/runs.tsx` | All runs table |
| `#/runs/:id` | `client/src/pages/run-detail.tsx` | Pipeline stage list + dark log panel + Auto-advance loop |
| `#/blueprints` | `client/src/pages/blueprints.tsx` | Blueprint catalog cards |
| `#/pipelines` | `client/src/pages/pipelines.tsx` | 8-stage pipeline anatomy reference |
| `#/access` | `client/src/pages/access.tsx` | Per-project access mode (public/client/private) + URLs + auth checklist |
| `#/providers` | `client/src/pages/providers.tsx` | Provider connection state + per-provider live mode toggle + CLI invocation examples |

## Backend
- **Server entry**: `server/index.ts` (template default, unchanged).
- **Routes**: `server/routes.ts` — REST API for projects, runs, blueprints, providers, plus `/api/preview/ci` and `/api/preview/env`.
- **Storage**: `server/storage.ts` — auto-creates SQLite tables on boot, seeds 5 providers, 4 blueprints, 3 projects, and 2 sample runs.
- **Schema**: `shared/schema.ts` — 5 tables: `projects`, `runs`, `stages`, `blueprints`, `providers`.
- **DB file**: `data.db` (better-sqlite3, WAL mode) — survives redeploys per the publishing skill convention.
- **Provider adapter layer**: `server/providers.ts` — every operation is a dry-run today. Documented live invocation patterns inline:
  - `githubScan`, `githubGenerateCi` → `gh repo view`, `gh pr create`, `gh workflow run` via `bash api_credentials=["github"]`
  - `vercelDeploy`, `vercelDomain` → `npx vercel --token $VERCEL_TOKEN ...` via `api_credentials=["vercel"]`
  - `neonProvision` → `neon_postgres__pipedream` connector tools (`execute-custom-query`, `find-row`, `insert-row`)
  - `prismaMigrate` → `prisma_management_api__pipedream` connector (list_projects, create_database, get_postgres_regions, list_connection_strings)
  - `railwayManual` → emits CLI cheat sheet only — no Railway connector wired
  - All gated by `LIVE_MODE_ENABLED = process.env.DEPLOYOPS_LIVE === "1"` AND the per-provider `mode` column in the providers table

## Key API endpoints
- `GET/POST/PATCH /api/projects[/:id]`
- `GET/POST /api/runs[/:id]?projectId=`
- `POST /api/runs/:id/advance` — advances next pending stage through the adapter
- `GET/POST /api/blueprints`
- `GET /api/providers`, `POST /api/providers/:key/mode` — toggle dry-run ↔ live
- `POST /api/preview/ci` — returns proposed `.github/workflows/deployops.yml`
- `POST /api/preview/env` — returns env-var resolution plan with sources

## Design system
- **Concept**: developer console aesthetic. Cool slate surfaces, a single electric-mint accent reserved for "ship/deploy" actions. Default DARK mode; light mode uses near-white surfaces with the dark sidebar preserved (Vercel/Linear pattern) for navigation continuity.
- **Palette** (HSL):
  - Light primary `168 70% 38%` · dark primary `168 76% 56%`
  - Surfaces: `220 24% 97%` light / `222 36% 7%` dark
  - Sidebar always dark (`222 28% 14%` / `222 36% 5%`)
- **Fonts**: Geist (display + body) and Geist Mono (data, env vars, CLI snippets) loaded via Google Fonts in `client/index.html`
- **Logo**: Custom SVG monogram — pipeline arrow stitching nodes — in `client/src/components/logo.tsx` and `client/public/favicon.svg`
- **Layout**: shadcn `<Sidebar collapsible="icon">` with three section groups (Workspace · Library · Operations), top header with sidebar trigger + "console / workspace" breadcrumb + theme toggle

## Custom shared components
- `client/src/components/app-sidebar.tsx` — sectioned nav, active state, footer with branch + DRY-RUN badge
- `client/src/components/page-shell.tsx` — eyebrow / title / description / actions
- `client/src/components/status-pill.tsx` — pending/running/succeeded/failed/skipped badges with icons
- `client/src/components/provider-icon.tsx` — per-provider lucide icon mapping
- `client/src/components/theme-toggle.tsx` — sun/moon button on header
- `client/src/lib/theme.tsx` — `ThemeProvider` (defaults dark, `prefers-color-scheme` aware, no localStorage)

## Files modified or created vs template
- `client/index.html` — fonts, favicon, meta
- `client/public/favicon.svg`
- `client/src/index.css` — full token system replacing the template's `red` placeholders, plus `.grid-bg`, `.dot-bg`, `.glow-mint` utilities
- `client/src/App.tsx` — wouter hash router + sidebar layout
- All eight `client/src/pages/*.tsx` listed above
- `client/src/components/{app-sidebar,logo,page-shell,provider-icon,status-pill,theme-toggle}.tsx`
- `client/src/lib/theme.tsx`
- `shared/schema.ts`, `server/storage.ts`, `server/providers.ts`, `server/routes.ts`

## Test conventions
- Every interactive element has `data-testid`. Patterns:
  - `nav-{page}`, `button-{action}`, `option-{kind}-{id}`, `link-{purpose}`, `row-{type}-{key}`, `card-{purpose}`
- Browser QA (Playwright) screenshots are saved under `/home/user/workspace/qa-*.png` (overview, wizard step 2, wizard review, run detail mid-advance, all pages desktop, three pages mobile, light-mode overview).

## Follow-up: turning live mode on
1. Set `DEPLOYOPS_LIVE=1` in the server env.
2. In the Providers page, flip individual provider modes from `dry-run` → `live` (the API `POST /api/providers/:key/mode` already exists; the UI switch already wires it).
3. Implement the marked TODO blocks in `server/providers.ts` — each has the exact CLI invocation noted.
4. Add `VERCEL_TOKEN` to the server environment for Vercel.
5. For Neon and Prisma, swap the dry-run log lines for `external-tool call ...` invocations using the `api_credentials=["external-tools"]` pattern from `programmatic-tool-calling`.
6. Railway is not connected — leave `railwayManual` as a CLI cheat sheet emitter or wire a connector if one becomes available.

## Test credentials
None required. The seeded SQLite database makes everything navigable on first load. No real provider resources are touched.

## QA notes (known minor issues, none blocking)
- On mobile (375 px) the run-detail action row (`Back` · `Advance one stage` · `Auto-advance`) overflows horizontally; the buttons remain reachable. Could be improved by stacking on `sm:` breakpoint.
- The provider health card on Overview previously truncated names — fixed in the redeploy by stacking name+status on a single row with full width for the name and removing the noisy second line of notes.

---

## v2 additions: Production architecture, Migration plan, Fix Bot

### File map (new + changed)

| Concern                          | File                                  | New? |
| -------------------------------- | ------------------------------------- | ---- |
| DB selector (sqlite ↔ postgres)  | `server/db.ts`                        | ✱ new |
| Storage layer                    | `server/storage.ts`                   | ↻ refactored to use `server/db.ts`; adds Fix Bot CRUD |
| Postgres schema mirror           | `shared/schema.pg.ts`                 | ✱ new |
| SQLite schema (existing tables)  | `shared/schema.ts`                    | ↻ adds health_checks, incidents, diagnoses, remediations, audit_logs |
| Drizzle config                   | `drizzle.config.ts`                   | ↻ supports DEPLOYOPS_DIALECT=postgres |
| Fix Bot adapters                 | `server/fixbot.ts`                    | ✱ new |
| API: `/api/system`               | `server/routes.ts`                    | ↻ added |
| API: `/api/architecture`         | `server/routes.ts`                    | ↻ added |
| API: `/api/migration/plan`       | `server/routes.ts`                    | ↻ added |
| API: `/api/fixbot/*`             | `server/routes.ts`                    | ↻ added (incidents, health, remediations) |
| Architecture page                | `client/src/pages/architecture.tsx`   | ✱ new |
| Migration plan page              | `client/src/pages/migration.tsx`      | ✱ new |
| Fix Bot page                     | `client/src/pages/fixbot.tsx`         | ✱ new |
| Sidebar nav (added 3 items)      | `client/src/components/app-sidebar.tsx` | ↻ |
| App routes                       | `client/src/App.tsx`                  | ↻ |
| Deployment guide                 | `docs/DEPLOYMENT.md`                  | ✱ new |
| README                           | `README.md`                           | ↻ rewritten |

### Vercel + Neon migration plan

The full plan ships as both a docs file and a live page in the app. Headline:

1. **Provision Neon** — `neonctl projects create` + branch per environment.
2. **Capture DATABASE_URL** — pooled connection string for `production` branch.
3. **Apply schema** — `npm install postgres && DEPLOYOPS_DIALECT=postgres npm run db:push:pg`.
4. **Connect Vercel** — `npx vercel link` + import.
5. **Set env vars** — DATABASE_URL (req), DEPLOYOPS_LIVE / NEON_API_KEY / VERCEL_TOKEN / GITHUB_TOKEN (optional).
6. **Deploy** — `npx vercel deploy --prod`.
7. **Validate** — `/api/system` returns `backend: "postgres"`.
8. **Rollback path** — unset DATABASE_URL → falls back to SQLite. Restore from a Neon branch snapshot for point-in-time recovery.

Every step is rendered in the app on `/migration` with copyable commands and per-step done toggles persisted to `localStorage`.

### Backend / DB abstraction

`server/db.ts` chooses the backend based on `DATABASE_URL`:

- unset / `file:` prefix / non-postgres → SQLite via better-sqlite3 (default).
- `postgres://` or `postgresql://` → Postgres via `postgres` + `drizzle-orm/postgres-js`.

The `postgres` package is intentionally NOT in dependencies — it's a runtime opt-in. Without it, the app loudly fails at boot with the install command. SQLite remains the default for local + dry-run.

`shared/schema.pg.ts` mirrors `shared/schema.ts` using `pg-core` types so `drizzle-kit push` can apply the schema to Neon. The application code uses generic Drizzle ops that work on both dialects. JSON-as-text columns round-trip because the application parses JSON itself.

### Fix Bot operating model

Tables: `health_checks`, `incidents`, `diagnoses`, `remediations`, `audit_logs`.

Domain:

- **Health checks** — recurring probes (http, build, migration, env, domain, workflow). 7 seeded.
- **Incidents** — open / diagnosing / fix-ready / approved / resolved / escalated. 5 seeded covering missing env, prisma migration failure, vercel build failure, broken domain, gh actions failure.
- **Diagnoses** — root cause + evidence + confidence (0–100) + recommendation.
- **Remediations** — actions: `open-pr`, `create-issue`, `retry-deploy`, `update-env`, `run-migration`, `rollback`, `escalate`. Status: proposed → approved → applied / dismissed.
- **Autonomy levels** — `diagnose-only`, `prepare-fix`, `approval-required` (default), `safe-auto-fix`. Surfaced in the UI as a Select; persisted on the incident.
- **Audit log** — every action writes a row, scoped to `fixbot` + incident id.

API:

- `GET /api/fixbot/health` — list monitors.
- `POST /api/fixbot/health/:key/probe` — re-probe (dry-run).
- `GET /api/fixbot/incidents` — list with diagnoses/remediations counts + top confidence.
- `GET /api/fixbot/incidents/:id` — detail with diagnoses, remediations, audit.
- `POST /api/fixbot/incidents` — create.
- `POST /api/fixbot/incidents/:id/diagnose` — run analyzer; appends a diagnosis.
- `POST /api/fixbot/incidents/:id/autonomy` — change autonomy.
- `POST /api/fixbot/incidents/:id/status` — change status.
- `POST /api/fixbot/remediations` — create.
- `POST /api/fixbot/remediations/:id/approve|dismiss|apply` — gating + apply.

The `apply` endpoint routes through `server/fixbot.ts` adapters. Each adapter returns `{ effective: "simulated" | "applied" | "blocked" }`. Live writes are gated by THREE conditions, all of which must hold:

1. `process.env.DEPLOYOPS_LIVE === "1"`
2. The relevant provider is in `live` mode (Providers page)
3. Either the remediation is `approved` OR the incident's autonomy is `safe-auto-fix`

In this build, even when all three conditions hold, the adapters log `[live] would execute …` and return without performing real mutations — the operator wires the actual `gh` / `vercel` / `prisma` calls when ready.

### Live mode caveats

- `DEPLOYOPS_LIVE` is the master switch. Without it, every provider call is simulated regardless of per-provider mode.
- Per-provider mode is independently switched on the Providers page.
- Fix Bot apply respects both — it's safe to flip live for diagnostics while keeping dangerous remediations gated behind approval.

### Test conventions

Every new interactive element has `data-testid`. Patterns added:

- Architecture: `card-runtime`, `card-architecture-diagram`, `card-layer-{id}`, `card-env-vars`, `node-{id}`, `row-envvar-{key}`, `link-migration-plan`, `badge-backend-{x}`, `badge-live-mode`, `badge-host`, `badge-database-url`.
- Migration: `card-migration-summary`, `card-step-{id}`, `button-toggle-{id}`, `commands-{id}`, `badge-progress`, `badge-done-{id}`, `button-migration-reset`, `card-migration-docs`.
- Fix Bot: `tabs-fixbot`, `tab-{incidents|monitors|audit}`, `card-incident-list`, `row-incident-{id}`, `card-incident-{id}`, `card-diagnoses`, `row-diagnosis-{id}`, `badge-confidence-{id}`, `card-remediations`, `row-remediation-{id}`, `badge-rem-status-{id}`, `button-approve-{id}`, `button-apply-{id}`, `button-dismiss-{id}`, `log-rem-{id}`, `select-autonomy`, `option-autonomy-{level}`, `button-diagnose`, `card-incident-audit`, `audit-{id}`, `card-check-{key}`, `button-probe-{key}`, `badge-health-{key}`, `kpi-{open|critical|down|live}`, `nav-fixbot`, `nav-architecture`, `nav-migration`.

### Sidebar additions

- **Operations** group gains `Fix Bot` (`/fixbot`).
- New **Production** group: `Architecture` (`/architecture`), `Migration plan` (`/migration`).
