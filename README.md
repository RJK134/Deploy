# DeployOps Console

DeployOps Console is a fullstack deployment-orchestration dashboard for taking GitHub products through Test, Demo, and Deploy environments with provider paths for GitHub, Vercel, Neon Postgres, Prisma Postgres, and optional Railway.

The current version runs in safe dry-run mode by default. It demonstrates the full deployment workflow, stores demo projects and runs locally in SQLite, and includes a provider adapter layer for wiring live GitHub CLI, Vercel CLI, Neon, and Prisma actions when credentials and live mode are enabled.

## Features

- Guided deployment wizard for repo, environment, blueprint, providers, and review.
- Environment blueprints for common app stacks such as Next.js, Prisma, Neon, Vercel, Node APIs, Railway, and static Vercel sites.
- Pipeline monitor with staged logs for repo scan, env vars, database provisioning, Prisma migration, CI generation, deploy, domains, and smoke tests.
- Provider settings for GitHub, Vercel, Neon, Prisma, and Railway.
- Access and domain manager for public, client, and private sharing modes.
- Dark-first developer console UI with light mode.

## Local development

```bash
npm install
npm run dev
```

The app uses an Express backend, Vite React frontend, Tailwind CSS, shadcn/ui, Drizzle, and SQLite.

## Build

```bash
npm run build
npm start
```

## Live mode notes

Live provider operations are intentionally disabled by default. To enable live orchestration, set `DEPLOYOPS_LIVE=1`, configure provider credentials server-side, switch individual providers from dry-run to live in the Providers page, and implement the marked adapter TODOs in `server/providers.ts`.

See `HANDOFF.md` for the full implementation map and follow-up notes.
