import type { StageKind } from "@/lib/pipeline/stages";

export const ENV_SOURCES = [
  "static",
  "github_secret",
  "neon_url",
  "derived",
] as const;
export type EnvSource = (typeof ENV_SOURCES)[number];

export interface BlueprintEnvVar {
  key: string;
  source: EnvSource;
  value?: string;
  description?: string;
}

export interface BlueprintStage {
  kind: StageKind;
  /** Skip this stage at plan time (rarely used; usually set at run time). */
  defaultSkip?: boolean;
  config?: Record<string, unknown>;
}

export interface BlueprintCommands {
  install?: string;
  build?: string;
  start?: string;
  migrate?: string;
}

export interface BlueprintDefinition {
  slug: string;
  name: string;
  description: string;
  framework: string;
  stages: BlueprintStage[];
  envVars: BlueprintEnvVar[];
  commands: BlueprintCommands;
  /** Vercel-side framework preset, e.g. 'nextjs', 'other'. */
  vercelPreset: string;
}

export function isBlueprintDefinition(
  value: unknown,
): value is BlueprintDefinition {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.slug === "string" &&
    typeof v.name === "string" &&
    typeof v.framework === "string" &&
    Array.isArray(v.stages) &&
    Array.isArray(v.envVars) &&
    typeof v.commands === "object" &&
    v.commands !== null
  );
}
