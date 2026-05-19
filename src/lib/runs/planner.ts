import type { BlueprintDefinition } from "@/lib/blueprints/types";
import type { Environment, StageKind } from "@/lib/pipeline/stages";

export interface PlannedStage {
  sequence: number;
  kind: StageKind;
  skipped: boolean;
}

export interface ResolvedEnvVar {
  key: string;
  source: string;
  value: string | null;
  note: string;
}

export interface RunPlan {
  blueprintSlug: string;
  blueprintName: string;
  framework: string;
  environment: Environment;
  project: {
    id: string;
    slug: string;
    githubOwner: string;
    githubRepo: string;
    defaultBranch: string | null;
    customDomain: string | null;
  };
  commands: BlueprintDefinition["commands"];
  envVars: ResolvedEnvVar[];
  stages: PlannedStage[];
  predicted: {
    branchName: string;
    deployHost: string;
  };
}

export function planRun(args: {
  blueprint: BlueprintDefinition;
  project: {
    id: string;
    slug: string;
    githubOwner: string;
    githubRepo: string;
    defaultBranch: string | null;
    customDomain?: string | null;
  };
  environment: Environment;
}): RunPlan {
  const { blueprint, project, environment } = args;

  const branchName = `${environment}-${project.githubRepo.toLowerCase()}`;
  const deployHost = `${project.githubRepo.toLowerCase()}-${environment}.vercel.app`;

  const stages: PlannedStage[] = blueprint.stages.map((s, idx) => ({
    sequence: idx + 1,
    kind: s.kind,
    skipped: Boolean(s.defaultSkip),
  }));

  const envVars: ResolvedEnvVar[] = blueprint.envVars.map((env) => {
    switch (env.source) {
      case "static":
        return {
          key: env.key,
          source: "static",
          value: env.value ?? null,
          note: env.description ?? "from blueprint",
        };
      case "neon_url":
        return {
          key: env.key,
          source: "neon_url",
          value: `postgres://USER:PASS@ep-deployops-pooler.neon.tech/${branchName}?sslmode=require`,
          note: `Resolved against Neon branch '${branchName}' (dry-run placeholder).`,
        };
      case "github_secret":
        return {
          key: env.key,
          source: "github_secret",
          value: null,
          note: `Reads GitHub Actions secret '${env.key}' at deploy time.`,
        };
      case "derived":
        return {
          key: env.key,
          source: "derived",
          value: `https://${deployHost}`,
          note: "Derived from the predicted Vercel deployment URL.",
        };
      default:
        return {
          key: env.key,
          source: env.source,
          value: env.value ?? null,
          note: env.description ?? "",
        };
    }
  });

  return {
    blueprintSlug: blueprint.slug,
    blueprintName: blueprint.name,
    framework: blueprint.framework,
    environment,
    project: {
      id: project.id,
      slug: project.slug,
      githubOwner: project.githubOwner,
      githubRepo: project.githubRepo,
      defaultBranch: project.defaultBranch,
      customDomain: project.customDomain ?? null,
    },
    commands: blueprint.commands,
    envVars,
    stages,
    predicted: { branchName, deployHost },
  };
}

export function isRunPlan(value: unknown): value is RunPlan {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.blueprintSlug === "string" &&
    typeof v.environment === "string" &&
    Array.isArray(v.stages) &&
    Array.isArray(v.envVars) &&
    typeof v.project === "object" &&
    v.project !== null &&
    typeof v.predicted === "object" &&
    v.predicted !== null
  );
}
