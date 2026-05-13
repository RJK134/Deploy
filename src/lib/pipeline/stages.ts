export const STAGE_KINDS = [
  "repo.scan",
  "env.resolve",
  "db.provision",
  "db.migrate",
  "ci.generate",
  "deploy",
  "domain.attach",
  "smoke.test",
] as const;

export type StageKind = (typeof STAGE_KINDS)[number];

export const STAGE_STATUSES = [
  "pending",
  "running",
  "succeeded",
  "failed",
  "skipped",
] as const;

export type StageStatus = (typeof STAGE_STATUSES)[number];

export const RUN_STATUSES = [
  "pending",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

export const ENVIRONMENTS = ["test", "demo", "deploy"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export const RUN_MODES = ["dry_run", "live"] as const;
export type RunMode = (typeof RUN_MODES)[number];

export interface StageSpec {
  kind: StageKind;
  label: string;
  description: string;
  produces: string;
  /** Provider this stage talks to in live mode. */
  provider: "github" | "vercel" | "neon" | "internal";
  /** Stages that can be skipped when their precondition is missing. */
  skippableWhen?: string;
}

export const STAGE_SPECS: Record<StageKind, StageSpec> = {
  "repo.scan": {
    kind: "repo.scan",
    label: "Repo scan",
    description:
      "Read the GitHub repo's default branch, framework, and package.json. Detects Next.js, Node API, or static-site shape.",
    produces: "repo metadata, framework, build commands",
    provider: "github",
  },
  "env.resolve": {
    kind: "env.resolve",
    label: "Env resolve",
    description:
      "Walk the blueprint's env-var manifest and resolve each entry to a concrete value (static, GitHub secret, derived from Neon URL, etc.).",
    produces: "ordered env-var plan with sources",
    provider: "internal",
  },
  "db.provision": {
    kind: "db.provision",
    label: "DB provision",
    description:
      "Create or find the Neon branch/database for this environment. Reuses an existing branch when the run is a retry.",
    produces: "DATABASE_URL, branch id, role credentials",
    provider: "neon",
    skippableWhen: "blueprint has no database dependency",
  },
  "db.migrate": {
    kind: "db.migrate",
    label: "DB migrate",
    description:
      "Run the blueprint's migration command (e.g. `prisma migrate deploy` or `drizzle-kit push`) against the just-provisioned database.",
    produces: "migration log, applied versions",
    provider: "internal",
    skippableWhen: "blueprint has no migration step",
  },
  "ci.generate": {
    kind: "ci.generate",
    label: "CI generate",
    description:
      "Emit `.github/workflows/deployops.yml` so subsequent pushes on the watched branch can trigger automated runs.",
    produces: "proposed workflow YAML",
    provider: "github",
  },
  deploy: {
    kind: "deploy",
    label: "Deploy",
    description:
      "Trigger a Vercel deployment of the resolved commit. Uses the blueprint's framework preset and the resolved env plan.",
    produces: "deployment id, preview URL",
    provider: "vercel",
  },
  "domain.attach": {
    kind: "domain.attach",
    label: "Domain attach",
    description:
      "Attach the configured custom domain (if any) to the new deployment. Surfaces DNS records when verification is pending.",
    produces: "attached domain status, DNS hints",
    provider: "vercel",
    skippableWhen: "no custom domain configured for this environment",
  },
  "smoke.test": {
    kind: "smoke.test",
    label: "Smoke test",
    description:
      "Hit the deployed app's health endpoint (default `/api/health`) and fail the run if the probe is non-2xx.",
    produces: "status code, response excerpt, latency",
    provider: "internal",
  },
};

export const STAGE_ORDER: readonly StageKind[] = STAGE_KINDS;

export function stageSpec(kind: StageKind): StageSpec {
  return STAGE_SPECS[kind];
}
