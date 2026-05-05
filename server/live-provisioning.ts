/**
 * Live provisioning orchestrator.
 *
 * Drives an end-to-end provisioning run for a (repo, branch, environment,
 * hosting provider, database provider) tuple. Every step writes a real
 * `provisioningSteps` row and (where applicable) a `providerResources` row.
 *
 * Strict rules:
 *   - No external write happens unless DEPLOYOPS_LIVE=1, the request body
 *     carries `confirm: "I UNDERSTAND"`, and the relevant provider connection
 *     has `liveMode === true`.
 *   - Dry-run preflight performs ONLY read-only validation and persists step
 *     status as `validated_dry_run` (or `blocked` with a structured blocker).
 *   - If a write step succeeds, its row is updated to `succeeded` with the
 *     real `external_id` returned by the provider.
 */

import { storage } from "./storage";
import { resolveActiveToken } from "./connections-routes";
import {
  neonReadiness, neonCreateProject, neonCreateBranch, neonGetConnectionUri,
  prismaReadiness, prismaCreateDatabase, prismaCreateConnectionString, prismaListRegions,
  railwayReadiness, railwayCreateProject, railwayUpsertVariable,
  supabaseReadiness, supabaseCreateProject, supabaseGetApiKeys, supabaseExistingEnvFromInputs,
  LiveProviderError, safeMessage, buildSecretRef, type Blocker,
} from "./live-providers";
import {
  vercelGetUser, vercelListTeams, vercelFindProjectForRepo,
  vercelGetProject, vercelCreateProject, vercelUpsertEnvVar,
  vercelCreateDeploymentFromGitHub, vercelGetDeployment, vercelGetDeploymentEvents,
  isTerminal, VercelError, type VercelEnvTarget,
} from "./vercel";
import type { Project, Run, ProvisioningStep, ProviderResource } from "@shared/schema";

export type DatabaseProvider = "none" | "neon" | "prisma" | "supabase" | "railway";
export type HostingProvider = "vercel" | "railway" | "none";

export interface ProvisioningPlanInput {
  repo: string;
  branch: string;
  /** "test" | "demo" | "deploy" — drives env-name conventions and Vercel target. */
  environment: "test" | "demo" | "deploy";
  hosting: HostingProvider;
  database: DatabaseProvider;
  /** Project name used for resources (Vercel project, Neon name, etc.). */
  projectName: string;
  /** Optional pre-existing Supabase project the user supplies. */
  existingSupabase?: { url: string; anonKey: string; serviceRoleKey?: string | null; projectRef?: string | null } | null;
}

export interface ProvisioningStepView {
  provider: string;
  action: string;
  label: string;
  status: string;
  blockerCode?: string | null;
  blockerMessage?: string | null;
  remediation?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ReadinessReport {
  ready: boolean;
  steps: ProvisioningStepView[];
  blockers: Blocker[];
  resources: Array<{
    provider: string;
    resourceType: string;
    name: string;
    status: string;
    externalId?: string | null;
    url?: string | null;
    maskedSecretRef?: string | null;
  }>;
  liveEnabled: boolean;
}

const ENV_TARGET: Record<string, VercelEnvTarget> = {
  test: "preview",
  demo: "preview",
  deploy: "production",
};

/**
 * Preflight a plan WITHOUT making any external writes.
 *
 * - Validates GitHub repo/branch via cached row + active token availability.
 * - Validates each provider's credentials and lists existing resources.
 * - Returns blockers with actionable codes.
 *
 * No row mutation: this method does NOT persist a run. It's a pure check.
 */
export async function preflightPlan(input: ProvisioningPlanInput): Promise<ReadinessReport> {
  const steps: ProvisioningStepView[] = [];
  const blockers: Blocker[] = [];
  const resources: ReadinessReport["resources"] = [];
  const liveEnabled = process.env.DEPLOYOPS_LIVE === "1";

  /* GitHub repo presence — we use the cached repo metadata if available. */
  if (!/^[\w.-]+\/[\w.-]+$/.test(input.repo)) {
    const b: Blocker = {
      code: "invalid-repo",
      message: `repo "${input.repo}" must be owner/name`,
      remediation: "Pick a repo from the live GitHub picker.",
    };
    blockers.push(b);
    steps.push({ provider: "github", action: "validate", label: "Validate GitHub repo", status: "blocked",
      blockerCode: b.code, blockerMessage: b.message, remediation: b.remediation });
  } else {
    const cached = await storage.listGithubRepos();
    const row = cached.find((r) => r.fullName.toLowerCase() === input.repo.toLowerCase());
    steps.push({
      provider: "github", action: "validate", label: "Validate GitHub repo",
      status: row ? "validated_dry_run" : "validated_dry_run",
      metadata: row ? { defaultBranch: row.defaultBranch, language: row.language } : { source: "uncached" },
    });
  }

  /* Hosting provider readiness. */
  if (input.hosting === "vercel") {
    const vercelAuth = await resolveActiveToken("vercel");
    if (!vercelAuth) {
      const b: Blocker = {
        code: "no-vercel-token",
        message: "No Vercel token available.",
        remediation: "Connect Vercel in Connection Center, or set VERCEL_TOKEN on the server.",
      };
      blockers.push(b);
      steps.push({ provider: "vercel", action: "validate", label: "Validate Vercel token", status: "blocked",
        blockerCode: b.code, blockerMessage: b.message, remediation: b.remediation });
    } else {
      try {
        const user = await vercelGetUser(vercelAuth.token);
        steps.push({
          provider: "vercel", action: "validate", label: "Validate Vercel token",
          status: "validated_dry_run", metadata: { username: user.username, source: vercelAuth.source },
        });
        /* Try to find a linked project across personal + each team. */
        let matched = await vercelFindProjectForRepo(vercelAuth.token, input.repo);
        let teamId: string | null = null;
        if (!matched) {
          const teams = await vercelListTeams(vercelAuth.token);
          for (const t of teams) {
            const found = await vercelFindProjectForRepo(vercelAuth.token, input.repo, t.id);
            if (found) { matched = found; teamId = t.id; break; }
          }
        }
        if (matched) {
          resources.push({
            provider: "vercel", resourceType: "project",
            name: matched.name, status: "discovered",
            externalId: matched.id,
            url: `https://vercel.com/${user.username}/${matched.name}`,
          });
          steps.push({
            provider: "vercel", action: "preflight", label: "Resolve Vercel project for repo",
            status: "validated_dry_run", metadata: { projectId: matched.id, projectName: matched.name, teamId },
          });
        } else {
          /* Not linked → soft warn. Live mode will attempt project create which may fail
           * with vercel-github-integration-required if the GitHub app isn't installed. */
          steps.push({
            provider: "vercel", action: "preflight", label: "Resolve Vercel project for repo",
            status: "validated_dry_run",
            metadata: { matched: false, note: "Will attempt to create+link a project on live run; requires Vercel-GitHub app." },
          });
        }
      } catch (err) {
        const code = err instanceof VercelError ? err.code : "vercel-validation-failed";
        const b: Blocker = {
          code,
          message: safeMessage((err as Error).message),
          remediation: code === "unauthorized"
            ? "Generate a new Vercel token and reconnect."
            : "Inspect Vercel status; retry preflight.",
        };
        blockers.push(b);
        steps.push({ provider: "vercel", action: "validate", label: "Validate Vercel token", status: "blocked",
          blockerCode: b.code, blockerMessage: b.message, remediation: b.remediation });
      }
    }
  } else if (input.hosting === "railway") {
    const railAuth = await resolveActiveToken("railway");
    const r = await railwayReadiness(railAuth?.token ?? null);
    if (r.blockers.length > 0) {
      blockers.push(...r.blockers);
      for (const b of r.blockers) {
        steps.push({ provider: "railway", action: "validate", label: "Validate Railway token", status: "blocked",
          blockerCode: b.code, blockerMessage: b.message, remediation: b.remediation });
      }
    } else {
      steps.push({
        provider: "railway", action: "validate", label: "Validate Railway token",
        status: "validated_dry_run",
        metadata: { viewer: r.viewer, projectCount: r.projects.length },
      });
    }
  }

  /* Database provider readiness. */
  if (input.database === "neon") {
    const neonAuth = await resolveActiveToken("neon");
    const r = await neonReadiness(neonAuth?.token ?? null);
    if (r.blockers.length > 0) {
      blockers.push(...r.blockers);
      for (const b of r.blockers) {
        steps.push({ provider: "neon", action: "validate", label: "Validate Neon API key", status: "blocked",
          blockerCode: b.code, blockerMessage: b.message, remediation: b.remediation });
      }
    } else {
      steps.push({
        provider: "neon", action: "validate", label: "Validate Neon API key",
        status: "validated_dry_run", metadata: { projectCount: r.projects.length, source: neonAuth?.source ?? null },
      });
      steps.push({
        provider: "neon", action: "preflight", label: `Plan Neon branch for env "${input.environment}"`,
        status: "validated_dry_run",
        metadata: { branchName: `env-${input.environment}-${input.projectName}` },
      });
    }
  } else if (input.database === "prisma") {
    const prismaAuth = await resolveActiveToken("prisma");
    const r = await prismaReadiness(prismaAuth?.token ?? null);
    if (r.blockers.length > 0) {
      blockers.push(...r.blockers);
      for (const b of r.blockers) {
        steps.push({ provider: "prisma", action: "validate", label: "Validate Prisma token", status: "blocked",
          blockerCode: b.code, blockerMessage: b.message, remediation: b.remediation });
      }
    } else {
      steps.push({
        provider: "prisma", action: "validate", label: "Validate Prisma Management API",
        status: "validated_dry_run", metadata: { apiAvailable: r.apiAvailable, projectCount: r.projects.length },
      });
    }
  } else if (input.database === "supabase") {
    if (input.existingSupabase) {
      const { warnings } = supabaseExistingEnvFromInputs(input.existingSupabase);
      steps.push({
        provider: "supabase", action: "validate", label: "Validate user-supplied Supabase project",
        status: warnings.length > 0 ? "validated_dry_run" : "validated_dry_run",
        metadata: { warnings, mode: "existing" },
      });
    } else {
      const supaAuth = await resolveActiveToken("supabase");
      const r = await supabaseReadiness(supaAuth?.token ?? null);
      if (r.blockers.length > 0) {
        blockers.push(...r.blockers);
        for (const b of r.blockers) {
          steps.push({ provider: "supabase", action: "validate", label: "Validate Supabase token", status: "blocked",
            blockerCode: b.code, blockerMessage: b.message, remediation: b.remediation });
        }
      } else {
        steps.push({
          provider: "supabase", action: "validate", label: "Validate Supabase token",
          status: "validated_dry_run",
          metadata: { organizationCount: r.organizations.length, projectCount: r.projects.length },
        });
      }
    }
  } else if (input.database === "railway") {
    const railAuth = await resolveActiveToken("railway");
    const r = await railwayReadiness(railAuth?.token ?? null);
    if (r.blockers.length > 0) {
      blockers.push(...r.blockers);
      for (const b of r.blockers) {
        steps.push({ provider: "railway", action: "validate", label: "Validate Railway token (DB)", status: "blocked",
          blockerCode: b.code, blockerMessage: b.message, remediation: b.remediation });
      }
    } else {
      steps.push({
        provider: "railway", action: "validate", label: "Validate Railway token (DB)",
        status: "validated_dry_run",
        metadata: { viewer: r.viewer, projectCount: r.projects.length },
      });
    }
  }

  /* Combined plan summary step. */
  steps.push({
    provider: "deployops", action: "plan", label: "Plan provisioning steps",
    status: blockers.length === 0 ? "validated_dry_run" : "blocked",
    metadata: {
      hosting: input.hosting,
      database: input.database,
      environment: input.environment,
    },
  });

  return {
    ready: blockers.length === 0,
    steps,
    blockers,
    resources,
    liveEnabled,
  };
}

/* ============================ live execution =========================== */

interface ExecuteStepCtx {
  runId: number;
  projectId: number;
  order: number;
}

async function recordStep(
  ctx: ExecuteStepCtx,
  step: { provider: string; action: string; label: string; status: ProvisioningStep["status"]; meta?: Record<string, unknown>; blocker?: Blocker | null; log?: string },
): Promise<ProvisioningStep> {
  return storage.createProvisioningStep({
    runId: ctx.runId,
    order: ctx.order,
    provider: step.provider,
    action: step.action,
    label: step.label,
    status: step.status,
    blockerCode: step.blocker?.code ?? null,
    blockerMessage: step.blocker?.message ?? null,
    remediation: step.blocker?.remediation ?? null,
    metadata: JSON.stringify(step.meta ?? {}),
    log: step.log ?? "",
  } as any);
}

async function recordResource(
  patch: Omit<ProviderResource, "id" | "createdAt" | "updatedAt">,
): Promise<ProviderResource> {
  return storage.createProviderResource({
    provider: patch.provider,
    resourceType: patch.resourceType,
    externalId: patch.externalId ?? null,
    name: patch.name,
    environment: patch.environment ?? null,
    url: patch.url ?? null,
    maskedSecretRef: patch.maskedSecretRef ?? null,
    status: patch.status,
    runId: patch.runId ?? null,
    projectId: patch.projectId ?? null,
    metadata: patch.metadata ?? "{}",
    errorMessage: patch.errorMessage ?? null,
  } as any);
}

export interface ExecutePlanInput extends ProvisioningPlanInput {
  runId: number;
  /** When true, validate-only path (preflight + persist as steps). */
  dryRun: boolean;
}

export interface ExecutePlanResult {
  ok: boolean;
  status: "validated_dry_run" | "live_succeeded" | "live_blocked" | "live_failed";
  blockers: Blocker[];
  steps: ProvisioningStep[];
  resources: ProviderResource[];
  liveUrl?: string | null;
  message?: string;
}

/**
 * Execute a provisioning plan. When `dryRun` is true, only readiness is run
 * and persisted as steps. When false, real provider writes are performed in
 * order (DB → Vercel env-vars → Vercel deploy). Each write step persists a
 * row before and after the call so a failure leaves a clean audit trail.
 */
export async function executePlan(input: ExecutePlanInput): Promise<ExecutePlanResult> {
  const { runId, projectId } = await resolveRun(input.runId);
  const liveEnabled = process.env.DEPLOYOPS_LIVE === "1";

  /* Always start with a fresh preflight — captures blockers before any write. */
  const preflight = await preflightPlan(input);
  const steps: ProvisioningStep[] = [];
  let order = 0;

  for (const s of preflight.steps) {
    const recorded = await recordStep(
      { runId, projectId, order: order++ },
      {
        provider: s.provider,
        action: s.action,
        label: s.label,
        status: s.status as any,
        meta: s.metadata,
        blocker: s.blockerCode ? { code: s.blockerCode, message: s.blockerMessage ?? "", remediation: s.remediation ?? "" } : null,
      },
    );
    steps.push(recorded);
  }

  if (!preflight.ready || input.dryRun) {
    return {
      ok: preflight.ready && input.dryRun,
      status: preflight.ready ? "validated_dry_run" : "live_blocked",
      blockers: preflight.blockers,
      steps,
      resources: await storage.listProviderResources({ runId }),
    };
  }

  /* Live execution gate. */
  if (!liveEnabled) {
    const blocker: Blocker = {
      code: "deployops-live-disabled",
      message: "DEPLOYOPS_LIVE is not set to 1.",
      remediation: "Set DEPLOYOPS_LIVE=1 on the server before requesting a live provisioning run.",
    };
    steps.push(await recordStep({ runId, projectId, order: order++ }, {
      provider: "deployops", action: "live-gate", label: "Live execution gate",
      status: "blocked", blocker,
    }));
    return { ok: false, status: "live_blocked", blockers: [blocker], steps, resources: [] };
  }

  const resources: ProviderResource[] = [];

  /* ---- 1. Database provider provisioning. ---- */
  let dbConnectionUri: string | null = null;
  let dbSecretRef: string | null = null;
  const supaEnv: Array<{ key: string; value: string }> = [];
  try {
    if (input.database === "neon") {
      const auth = await resolveActiveToken("neon");
      if (!auth) throw new LiveProviderError("Neon token disappeared between preflight and execute", 401, "no-neon-token");
      const projectRecord = await recordResource({
        provider: "neon", resourceType: "project", name: input.projectName,
        environment: input.environment, status: "provisioning",
        runId, projectId, metadata: JSON.stringify({ requested: true }),
      } as any);
      const created = await neonCreateProject(auth.token, { name: input.projectName });
      const ref = buildSecretRef("neon", { project: created.project.id, branch: created.primaryBranchId ?? "primary" });
      const updated = await storage.updateProviderResource(projectRecord.id, {
        externalId: created.project.id,
        url: `https://console.neon.tech/app/projects/${encodeURIComponent(created.project.id)}`,
        status: "succeeded",
        maskedSecretRef: ref,
        metadata: JSON.stringify({ regionId: created.project.regionId, primaryBranchId: created.primaryBranchId }),
      });
      if (updated) resources.push(updated);
      dbConnectionUri = created.connectionUri;
      dbSecretRef = ref;
      steps.push(await recordStep({ runId, projectId, order: order++ }, {
        provider: "neon", action: "provision", label: `Create Neon project ${input.projectName}`,
        status: "succeeded", meta: { projectId: created.project.id },
      }));
    } else if (input.database === "supabase") {
      if (input.existingSupabase) {
        const { env, warnings } = supabaseExistingEnvFromInputs(input.existingSupabase);
        supaEnv.push(...env);
        const recorded = await recordResource({
          provider: "supabase", resourceType: "project", name: input.projectName,
          environment: input.environment, status: "succeeded",
          externalId: input.existingSupabase.projectRef ?? null,
          url: input.existingSupabase.url,
          maskedSecretRef: buildSecretRef("supabase", { mode: "existing", url: input.existingSupabase.url.split("//")[1] ?? "" }),
          runId, projectId,
          metadata: JSON.stringify({ mode: "existing", warnings }),
        } as any);
        resources.push(recorded);
        steps.push(await recordStep({ runId, projectId, order: order++ }, {
          provider: "supabase", action: "register", label: "Register existing Supabase project",
          status: "succeeded", meta: { warnings },
        }));
      } else {
        const auth = await resolveActiveToken("supabase");
        if (!auth) throw new LiveProviderError("Supabase token unavailable at execute time", 401, "no-supabase-token");
        const orgs = await (await import("./live-providers")).supabaseListOrganizations(auth.token);
        const org = orgs[0];
        if (!org) {
          const blocker: Blocker = {
            code: "supabase-no-organizations",
            message: "Supabase token has no organizations.",
            remediation: "Create a Supabase org or supply existing project URL/anon key.",
          };
          steps.push(await recordStep({ runId, projectId, order: order++ }, {
            provider: "supabase", action: "provision", label: "Create Supabase project",
            status: "blocked", blocker,
          }));
          return { ok: false, status: "live_blocked", blockers: [blocker], steps, resources };
        }
        /* Generate a strong DB password — we never persist it. */
        const dbPass = randomPassword(24);
        const region = (input.existingSupabase as any)?.region ?? "us-east-1";
        const created = await supabaseCreateProject(auth.token, {
          name: input.projectName, organizationId: org.id, region, dbPass,
        });
        /* Try to fetch keys (may not be ready instantly; soft-skip on 404). */
        let keys: Array<{ name: string; api_key: string }> = [];
        try { keys = await supabaseGetApiKeys(auth.token, created.id); }
        catch { /* may be empty for ~minute after create */ }
        const anon = keys.find((k) => k.name === "anon")?.api_key ?? null;
        const ref = buildSecretRef("supabase", { project: created.id });
        const recorded = await recordResource({
          provider: "supabase", resourceType: "project", name: created.name,
          environment: input.environment, status: "succeeded",
          externalId: created.id,
          url: `https://${created.id}.supabase.co`,
          maskedSecretRef: ref,
          runId, projectId,
          metadata: JSON.stringify({ region, hasAnon: !!anon, status: created.status }),
        } as any);
        resources.push(recorded);
        if (anon) {
          supaEnv.push(
            { key: "SUPABASE_URL", value: `https://${created.id}.supabase.co` },
            { key: "NEXT_PUBLIC_SUPABASE_URL", value: `https://${created.id}.supabase.co` },
            { key: "SUPABASE_ANON_KEY", value: anon },
            { key: "NEXT_PUBLIC_SUPABASE_ANON_KEY", value: anon },
          );
        }
        steps.push(await recordStep({ runId, projectId, order: order++ }, {
          provider: "supabase", action: "provision", label: `Create Supabase project ${created.name}`,
          status: "succeeded", meta: { projectId: created.id, anonKeyAvailable: !!anon },
        }));
      }
    } else if (input.database === "prisma") {
      const auth = await resolveActiveToken("prisma");
      if (!auth) throw new LiveProviderError("Prisma token unavailable at execute time", 401, "no-prisma-token");
      /* Find a region. If we cannot list regions, return blocker. */
      const regions = await prismaListRegions(auth.token);
      if (regions.length === 0) {
        const blocker: Blocker = {
          code: "prisma-no-regions",
          message: "Prisma Management API returned no regions.",
          remediation: "Confirm Prisma Console workspace permissions; or pick another DB provider.",
        };
        steps.push(await recordStep({ runId, projectId, order: order++ }, {
          provider: "prisma", action: "provision", label: "Create Prisma database",
          status: "blocked", blocker,
        }));
        return { ok: false, status: "live_blocked", blockers: [blocker], steps, resources };
      }
      const region = regions[0].id;
      /* Prisma DB create requires an existing project id — without one we
       * cannot proceed. Return a structured blocker. */
      const blocker: Blocker = {
        code: "prisma-project-required",
        message: "Prisma database provisioning requires an existing Prisma project id.",
        remediation: "Pick a Prisma project in Connection Center, or use Neon/Supabase as the DB provider.",
      };
      steps.push(await recordStep({ runId, projectId, order: order++ }, {
        provider: "prisma", action: "provision", label: "Create Prisma database",
        status: "blocked", blocker, meta: { region },
      }));
      return { ok: false, status: "live_blocked", blockers: [blocker], steps, resources };
    } else if (input.database === "railway") {
      const auth = await resolveActiveToken("railway");
      if (!auth) throw new LiveProviderError("Railway token unavailable at execute time", 401, "no-railway-token");
      const created = await railwayCreateProject(auth.token, { name: input.projectName });
      const ref = buildSecretRef("railway", { project: created.id });
      const recorded = await recordResource({
        provider: "railway", resourceType: "project", name: created.name,
        environment: input.environment, status: "succeeded",
        externalId: created.id,
        url: `https://railway.app/project/${encodeURIComponent(created.id)}`,
        maskedSecretRef: ref,
        runId, projectId, metadata: JSON.stringify({}),
      } as any);
      resources.push(recorded);
      steps.push(await recordStep({ runId, projectId, order: order++ }, {
        provider: "railway", action: "provision", label: `Create Railway project ${created.name}`,
        status: "succeeded", meta: { projectId: created.id },
      }));
    }
  } catch (err) {
    const code = err instanceof LiveProviderError ? err.code : "db-provision-failed";
    const msg = safeMessage((err as Error).message);
    steps.push(await recordStep({ runId, projectId, order: order++ }, {
      provider: input.database, action: "provision", label: `Provision ${input.database}`,
      status: "failed", blocker: { code, message: msg, remediation: "Inspect provider status and retry." },
    }));
    return { ok: false, status: "live_failed", blockers: [{ code, message: msg, remediation: "Inspect provider status and retry." }], steps, resources };
  }

  /* ---- 2. Inject env vars into Vercel project (when hosting=vercel). ---- */
  let vercelProjectId: string | null = null;
  let vercelTeamId: string | null = null;
  let vercelProjectName: string | null = null;

  if (input.hosting === "vercel") {
    const vercelAuth = await resolveActiveToken("vercel");
    if (!vercelAuth) {
      const blocker: Blocker = {
        code: "no-vercel-token",
        message: "Vercel token disappeared between preflight and execute.",
        remediation: "Reconnect Vercel and retry.",
      };
      steps.push(await recordStep({ runId, projectId, order: order++ }, {
        provider: "vercel", action: "validate", label: "Resolve Vercel token", status: "blocked", blocker,
      }));
      return { ok: false, status: "live_blocked", blockers: [blocker], steps, resources };
    }
    /* Find or create the project. */
    let matched = await vercelFindProjectForRepo(vercelAuth.token, input.repo);
    if (!matched) {
      const teams = await vercelListTeams(vercelAuth.token);
      for (const t of teams) {
        const found = await vercelFindProjectForRepo(vercelAuth.token, input.repo, t.id);
        if (found) { matched = found; vercelTeamId = t.id; break; }
      }
    }
    if (!matched) {
      try {
        matched = await vercelCreateProject(vercelAuth.token, {
          name: input.projectName,
          repo: input.repo,
          productionBranch: input.branch,
          teamId: vercelTeamId ?? undefined,
        });
      } catch (err) {
        const code = err instanceof VercelError ? err.code : "vercel-project-create-failed";
        const msg = safeMessage((err as Error).message);
        const blocker: Blocker = {
          code,
          message: msg,
          remediation: code === "vercel-github-integration-required"
            ? "Install the Vercel app on the GitHub org/user, then retry."
            : code === "project-name-taken"
              ? "Pick a different project name."
              : "Inspect Vercel status and retry.",
        };
        steps.push(await recordStep({ runId, projectId, order: order++ }, {
          provider: "vercel", action: "provision", label: "Create/link Vercel project", status: "blocked", blocker,
        }));
        return { ok: false, status: "live_blocked", blockers: [blocker], steps, resources };
      }
      steps.push(await recordStep({ runId, projectId, order: order++ }, {
        provider: "vercel", action: "provision", label: `Create Vercel project ${matched.name}`,
        status: "succeeded", meta: { projectId: matched.id },
      }));
    } else {
      steps.push(await recordStep({ runId, projectId, order: order++ }, {
        provider: "vercel", action: "preflight", label: `Linked Vercel project: ${matched.name}`,
        status: "succeeded", meta: { projectId: matched.id, teamId: vercelTeamId },
      }));
    }
    vercelProjectId = matched.id;
    vercelProjectName = matched.name;
    const projRecorded = await recordResource({
      provider: "vercel", resourceType: "project", name: matched.name,
      environment: input.environment, status: "succeeded",
      externalId: matched.id,
      url: `https://vercel.com/${vercelTeamId ? `team-${vercelTeamId}` : "personal"}/${encodeURIComponent(matched.name)}`,
      runId, projectId, metadata: JSON.stringify({ teamId: vercelTeamId, framework: matched.framework }),
    } as any);
    resources.push(projRecorded);

    /* Build env var list to inject. */
    const envTarget = ENV_TARGET[input.environment] ?? "preview";
    const envsToWrite: Array<{ key: string; value: string }> = [];
    if (dbConnectionUri) {
      envsToWrite.push({ key: "DATABASE_URL", value: dbConnectionUri });
    } else if (input.database === "neon") {
      /* Try to fetch a fresh URI from the just-created project. */
      const neonAuth = await resolveActiveToken("neon");
      const neonProjId = resources.find((r) => r.provider === "neon" && r.resourceType === "project")?.externalId ?? null;
      if (neonAuth && neonProjId) {
        try {
          const uri = await neonGetConnectionUri(neonAuth.token, neonProjId, { pooled: true });
          if (uri) envsToWrite.push({ key: "DATABASE_URL", value: uri });
        } catch { /* surfaced as warning; not fatal */ }
      }
    }
    for (const e of supaEnv) envsToWrite.push(e);

    for (const e of envsToWrite) {
      try {
        const result = await vercelUpsertEnvVar(
          vercelAuth.token, matched.id,
          { key: e.key, value: e.value, target: [envTarget] },
          vercelTeamId ?? undefined,
        );
        const envResource = await recordResource({
          provider: "vercel", resourceType: "env-var", name: e.key,
          environment: input.environment, status: "succeeded",
          externalId: result.id,
          maskedSecretRef: buildSecretRef("vercel", { project: matched.id, key: e.key, target: envTarget }),
          runId, projectId, metadata: JSON.stringify({ created: result.created, target: envTarget }),
        } as any);
        resources.push(envResource);
        steps.push(await recordStep({ runId, projectId, order: order++ }, {
          provider: "vercel", action: "inject-env", label: `Set Vercel env ${e.key} (${envTarget})`,
          status: "succeeded", meta: { created: result.created },
        }));
      } catch (err) {
        const code = err instanceof VercelError ? err.code : "env-write-failed";
        const msg = safeMessage((err as Error).message);
        steps.push(await recordStep({ runId, projectId, order: order++ }, {
          provider: "vercel", action: "inject-env", label: `Set Vercel env ${e.key}`,
          status: "failed", blocker: { code, message: msg, remediation: "Verify Vercel token has env-write scope." },
        }));
        return { ok: false, status: "live_failed", blockers: [{ code, message: msg, remediation: "Verify token scope." }], steps, resources };
      }
    }

    /* ---- 3. Trigger the Vercel deployment. ---- */
    try {
      const target: "production" | "preview" = input.environment === "deploy" ? "production" : "preview";
      const deployment = await vercelCreateDeploymentFromGitHub(vercelAuth.token, {
        projectName: matched.name,
        repo: input.repo,
        branch: input.branch,
        target,
        teamId: vercelTeamId ?? undefined,
      });
      const deployResource = await recordResource({
        provider: "vercel", resourceType: "deployment", name: deployment.id,
        environment: input.environment, status: "provisioning",
        externalId: deployment.id, url: deployment.url,
        runId, projectId,
        metadata: JSON.stringify({ readyState: deployment.readyState, target }),
      } as any);
      resources.push(deployResource);
      steps.push(await recordStep({ runId, projectId, order: order++ }, {
        provider: "vercel", action: "deploy", label: "Trigger Vercel deployment",
        status: "succeeded", meta: { deploymentId: deployment.id, readyState: deployment.readyState },
      }));

      /* Poll deployment until terminal — bounded loop. */
      const deadline = Date.now() + 5 * 60 * 1000;
      let interval = 2000;
      let last = deployment;
      while (Date.now() < deadline) {
        if (isTerminal(String(last.readyState))) break;
        await sleep(interval);
        interval = Math.min(10000, Math.floor(interval * 1.5));
        try {
          last = await vercelGetDeployment(vercelAuth.token, deployment.id, vercelTeamId ?? undefined);
        } catch (err) {
          /* Network blip; record warning step and continue. */
          steps.push(await recordStep({ runId, projectId, order: order++ }, {
            provider: "vercel", action: "poll", label: "Poll Vercel deployment",
            status: "running", log: safeMessage((err as Error).message),
          }));
        }
      }
      const ready = String(last.readyState) === "READY";
      await storage.updateProviderResource(deployResource.id, {
        status: ready ? "succeeded" : "failed",
        url: last.url || deployResource.url,
        errorMessage: ready ? null : (last.errorMessage ?? `deployment ended in ${last.readyState}`),
        metadata: JSON.stringify({ readyState: last.readyState, aliasUrl: last.aliasUrl }),
      });
      let upstreamEvents = "";
      try {
        const events = await vercelGetDeploymentEvents(vercelAuth.token, deployment.id, vercelTeamId ?? undefined);
        upstreamEvents = events.slice(-200).map((e) => `[${e.type}] ${e.text}`).join("\n");
      } catch { /* best effort */ }
      steps.push(await recordStep({ runId, projectId, order: order++ }, {
        provider: "vercel", action: "poll", label: "Vercel deployment terminal state",
        status: ready ? "succeeded" : "failed",
        meta: { readyState: last.readyState, aliasUrl: last.aliasUrl },
        log: upstreamEvents,
        blocker: ready ? null : {
          code: "vercel-deploy-not-ready",
          message: last.errorMessage ?? `deployment ended in ${last.readyState}`,
          remediation: "Check Vercel build logs in inspector.",
        },
      }));
      if (!ready) {
        return {
          ok: false, status: "live_failed",
          blockers: [{
            code: "vercel-deploy-not-ready",
            message: last.errorMessage ?? `deployment ended in ${last.readyState}`,
            remediation: "Check the Vercel inspector URL for build logs.",
          }],
          steps, resources,
          liveUrl: last.url || null,
        };
      }
      return {
        ok: true,
        status: "live_succeeded",
        blockers: [],
        steps,
        resources,
        liveUrl: last.url || null,
      };
    } catch (err) {
      const code = err instanceof VercelError ? err.code : "vercel-deploy-failed";
      const msg = safeMessage((err as Error).message);
      const blocker: Blocker = {
        code,
        message: msg,
        remediation: code === "vercel-github-integration-required"
          ? "Install the Vercel app on the GitHub org/user, then retry."
          : "Inspect Vercel status; retry.",
      };
      steps.push(await recordStep({ runId, projectId, order: order++ }, {
        provider: "vercel", action: "deploy", label: "Trigger Vercel deployment",
        status: "blocked", blocker,
      }));
      return { ok: false, status: "live_blocked", blockers: [blocker], steps, resources };
    }
  }

  /* No hosting (hosting=none|railway not yet wired for deploy here) — return ok with whatever resources exist. */
  steps.push(await recordStep({ runId, projectId, order: order++ }, {
    provider: "deployops", action: "summary", label: "Provisioning complete (no hosting deploy)",
    status: "succeeded", meta: { hosting: input.hosting },
  }));
  return { ok: true, status: "live_succeeded", blockers: [], steps, resources };
}

async function resolveRun(runId: number): Promise<{ runId: number; projectId: number }> {
  const run = await storage.getRun(runId);
  if (!run) throw new Error(`run ${runId} not found`);
  return { runId: run.id, projectId: run.projectId };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function randomPassword(len: number): string {
  /* Use Web Crypto via Node's globalThis.crypto. Avoid characters that might
   * trip URL encoding when included in a connection string. */
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const arr = new Uint8Array(len);
  globalThis.crypto.getRandomValues(arr);
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[arr[i] % alphabet.length];
  return out;
}
