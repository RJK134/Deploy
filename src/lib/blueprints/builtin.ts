import { STAGE_KINDS } from "@/lib/pipeline/stages";

import type { BlueprintDefinition } from "./types";

const ALL_STAGES = STAGE_KINDS.map((kind) => ({ kind }));

export const BUILTIN_BLUEPRINTS: BlueprintDefinition[] = [
  {
    slug: "nextjs-neon",
    name: "Next.js + Neon",
    description:
      "Next.js 14 App Router app with a Neon Postgres branch per environment. Migrations run via Drizzle or Prisma; smoke test hits /api/health.",
    framework: "nextjs",
    vercelPreset: "nextjs",
    stages: ALL_STAGES,
    commands: {
      install: "pnpm install --frozen-lockfile",
      build: "pnpm build",
      start: "pnpm start",
      migrate: "pnpm db:push",
    },
    envVars: [
      {
        key: "DATABASE_URL",
        source: "neon_url",
        description: "Pooled Neon URL for the env-specific branch.",
      },
      {
        key: "NEXTAUTH_SECRET",
        source: "github_secret",
        description: "Per-env signing secret pulled from a GitHub Actions secret.",
      },
      {
        key: "NEXTAUTH_URL",
        source: "derived",
        description: "Filled in after the Vercel deployment URL is known.",
      },
      {
        key: "NODE_ENV",
        source: "static",
        value: "production",
      },
    ],
  },
  {
    slug: "nextjs-static",
    name: "Next.js (static)",
    description:
      "Static-export Next.js site with no database. Skips db.provision, db.migrate, and ci.generate's migration job.",
    framework: "nextjs",
    vercelPreset: "nextjs",
    stages: STAGE_KINDS.map((kind) => ({
      kind,
      defaultSkip: kind === "db.provision" || kind === "db.migrate",
    })),
    commands: {
      install: "pnpm install --frozen-lockfile",
      build: "pnpm build",
      start: "pnpm start",
    },
    envVars: [
      {
        key: "NODE_ENV",
        source: "static",
        value: "production",
      },
    ],
  },
  {
    slug: "node-api",
    name: "Node API",
    description:
      "Headless Node/Express style API on Vercel functions, paired with a Neon branch. No custom domain by default.",
    framework: "node",
    vercelPreset: "other",
    stages: STAGE_KINDS.map((kind) => ({
      kind,
      defaultSkip: kind === "domain.attach",
    })),
    commands: {
      install: "pnpm install --frozen-lockfile",
      build: "pnpm build",
      start: "node dist/index.js",
      migrate: "pnpm db:push",
    },
    envVars: [
      {
        key: "DATABASE_URL",
        source: "neon_url",
      },
      {
        key: "NODE_ENV",
        source: "static",
        value: "production",
      },
    ],
  },
];

export function getBuiltinBlueprint(
  slug: string,
): BlueprintDefinition | undefined {
  return BUILTIN_BLUEPRINTS.find((b) => b.slug === slug);
}
