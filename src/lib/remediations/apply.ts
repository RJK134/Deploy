import "server-only";

import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { recordAudit } from "@/lib/db/audit";
import { listCredentials, getCredentialPlaintext } from "@/lib/db/credentials";
import { getProjectById } from "@/lib/db/projects";
import {
  fixbotIncidents,
  fixbotRemediations,
} from "@/lib/db/schema";
import { isLiveMode } from "@/lib/env";
import { probeJson } from "@/lib/providers/probe";

import {
  checkApplyGate,
  isKnownAction,
  type RemediationAction,
} from "./apply-gate";

export interface ApplyOutcome {
  ok: boolean;
  status: "applied" | "failed";
  message: string;
  output?: Record<string, unknown>;
}

export interface ApplyResult {
  remediationId: string;
  outcome: ApplyOutcome;
}

async function loadRemediationContext(remediationId: string): Promise<{
  remediationId: string;
  incidentId: string;
  projectId: string | null;
  action: string;
  status: string;
  payload: Record<string, unknown> | null;
  autonomy: import("@/lib/db/schema").AutonomyLevel;
}> {
  const rows = await db
    .select({
      remediationId: fixbotRemediations.id,
      incidentId: fixbotRemediations.incidentId,
      projectId: fixbotIncidents.projectId,
      action: fixbotRemediations.action,
      status: fixbotRemediations.status,
      payload: fixbotRemediations.payloadJson,
      autonomy: fixbotIncidents.autonomy,
    })
    .from(fixbotRemediations)
    .innerJoin(
      fixbotIncidents,
      eq(fixbotIncidents.id, fixbotRemediations.incidentId),
    )
    .where(eq(fixbotRemediations.id, remediationId))
    .limit(1);
  if (rows.length === 0) throw new Error("remediation not found");
  const row = rows[0];
  return {
    remediationId: row.remediationId,
    incidentId: row.incidentId,
    projectId: row.projectId ?? null,
    action: row.action,
    status: row.status,
    payload:
      typeof row.payload === "object" && row.payload !== null
        ? (row.payload as Record<string, unknown>)
        : null,
    autonomy: row.autonomy,
  };
}

async function setRemediationStatus(
  remediationId: string,
  status: "queued" | "applied" | "failed",
): Promise<void> {
  const setApplied = status === "applied";
  await db
    .update(fixbotRemediations)
    .set({
      status,
      appliedAt: setApplied ? sql`now()` : undefined,
    })
    .where(eq(fixbotRemediations.id, remediationId));
}

async function ensureVerifiedCredential(
  kind: "github_pat" | "vercel" | "neon",
): Promise<string> {
  const list = await listCredentials();
  const row = list.find((c) => c.kind === kind);
  if (!row || row.connectionState !== "verified") {
    throw new Error(`${kind} is not verified; cannot apply this remediation`);
  }
  const pt = await getCredentialPlaintext(kind);
  if (!pt) throw new Error(`${kind} credential is missing plaintext`);
  return pt;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// --- per-action handlers ---

async function applyProbeRetry(
  payload: Record<string, unknown> | null,
): Promise<ApplyOutcome> {
  const url = asString(payload?.url);
  if (!url)
    return { ok: false, status: "failed", message: "payload.url missing" };
  const res = await probeJson(url, { headers: {} });
  if (res.ok) {
    return {
      ok: true,
      status: "applied",
      message: `Re-probe of ${url} returned ${res.status}.`,
      output: { url, status: res.status },
    };
  }
  return {
    ok: false,
    status: "failed",
    message: `Re-probe of ${url} still failing: ${res.message}.`,
    output: { url, status: res.status, message: res.message },
  };
}

async function applyDeployRetry(
  payload: Record<string, unknown> | null,
  projectId: string | null,
): Promise<ApplyOutcome> {
  if (!projectId)
    return {
      ok: false,
      status: "failed",
      message: "incident has no projectId",
    };
  const project = await getProjectById(projectId);
  if (!project)
    return { ok: false, status: "failed", message: "project not found" };
  if (!project.vercelProjectId)
    return {
      ok: false,
      status: "failed",
      message:
        "project.vercelProjectId is not set; live deploy needs an existing Vercel project",
    };
  const vercelTeamId = project.vercelTeamId;
  const token = await ensureVerifiedCredential("vercel");

  // Look up the project on Vercel to grab the git link metadata.
  const projUrl = new URL(
    `https://api.vercel.com/v9/projects/${encodeURIComponent(project.vercelProjectId)}`,
  );
  if (vercelTeamId) projUrl.searchParams.set("teamId", vercelTeamId);
  const projRes = await probeJson(projUrl.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  if (!projRes.ok)
    return {
      ok: false,
      status: "failed",
      message: `GET /v9/projects/${project.vercelProjectId} failed: ${projRes.message}`,
    };
  const detail = projRes.detail ?? {};
  const link =
    typeof detail.link === "object" && detail.link !== null
      ? (detail.link as Record<string, unknown>)
      : null;
  if (!link) {
    return {
      ok: false,
      status: "failed",
      message: "Vercel project is not linked to a Git repo; cannot retrigger",
    };
  }

  const deployUrl = new URL("https://api.vercel.com/v13/deployments");
  if (vercelTeamId) deployUrl.searchParams.set("teamId", vercelTeamId);
  const deployRes = await probeJson(deployUrl.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name:
        typeof detail.name === "string"
          ? detail.name
          : project.githubRepo,
      project: project.vercelProjectId,
      target: "production",
      gitSource:
        link.type === "github"
          ? {
              type: "github",
              repo: link.repo,
              org: link.org,
              ref: project.defaultBranch ?? "main",
              repoId: link.repoId,
            }
          : undefined,
    }),
  });
  if (!deployRes.ok) {
    return {
      ok: false,
      status: "failed",
      message: `POST /v13/deployments failed: ${deployRes.message}`,
      output: { status: deployRes.status },
    };
  }
  const dep = deployRes.detail ?? {};
  return {
    ok: true,
    status: "applied",
    message: `Retriggered deployment for ${project.slug}.`,
    output: {
      deploymentId: dep.id ?? null,
      url: typeof dep.url === "string" ? `https://${dep.url}` : null,
    },
  };
}

async function applyWorkflowRerun(
  payload: Record<string, unknown> | null,
): Promise<ApplyOutcome> {
  const owner = asString(payload?.owner);
  const repo = asString(payload?.repo);
  const runId = asNumber(payload?.runId);
  if (!owner || !repo || !runId) {
    return {
      ok: false,
      status: "failed",
      message:
        "payload must include owner, repo, and runId for workflow.rerun",
    };
  }
  const token = await ensureVerifiedCredential("github_pat");
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs/${runId}/rerun`;
  const res = await probeJson(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "deployops-console",
    },
  });
  if (!res.ok) {
    return {
      ok: false,
      status: "failed",
      message: `POST /actions/runs/${runId}/rerun failed: ${res.message}`,
    };
  }
  return {
    ok: true,
    status: "applied",
    message: `Requested re-run of GitHub Actions run ${runId} on ${owner}/${repo}.`,
    output: { owner, repo, runId },
  };
}

async function applyEnvAdd(
  payload: Record<string, unknown> | null,
): Promise<ApplyOutcome> {
  const target = asString(payload?.target) ?? "production";
  const missing = Array.isArray(payload?.missingKeys)
    ? (payload.missingKeys as unknown[]).filter(
        (k): k is string => typeof k === "string",
      )
    : [];
  const vercelProjectId = asString(payload?.vercelProjectId);
  if (missing.length === 0) {
    return {
      ok: true,
      status: "applied",
      message: "No missing keys to add. Marking applied.",
      output: { missingKeys: [] },
    };
  }
  return {
    ok: true,
    status: "applied",
    message:
      `Manual step recorded: add ${missing.length} env var${missing.length === 1 ? "" : "s"} to Vercel project ` +
      `${vercelProjectId ?? "(unknown)"} for target=${target}: ${missing.join(", ")}. ` +
      `Values must be sourced from the operator's secret manager — this remediation does not POST values.`,
    output: { missingKeys: missing, vercelProjectId, target, manual: true },
  };
}

async function applyDomainAttach(
  payload: Record<string, unknown> | null,
  projectId: string | null,
): Promise<ApplyOutcome> {
  const domain = asString(payload?.domain);
  if (!domain)
    return {
      ok: false,
      status: "failed",
      message: "payload.domain missing",
    };
  if (!projectId)
    return {
      ok: false,
      status: "failed",
      message: "incident has no projectId",
    };
  const project = await getProjectById(projectId);
  if (!project || !project.vercelProjectId)
    return {
      ok: false,
      status: "failed",
      message: "project missing vercelProjectId",
    };
  const token = await ensureVerifiedCredential("vercel");
  const url = new URL(
    `https://api.vercel.com/v10/projects/${encodeURIComponent(project.vercelProjectId)}/domains`,
  );
  if (project.vercelTeamId) url.searchParams.set("teamId", project.vercelTeamId);
  const res = await probeJson(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: domain }),
  });
  if (!res.ok) {
    return {
      ok: false,
      status: "failed",
      message: `POST /v10/projects/${project.vercelProjectId}/domains failed: ${res.message}`,
      output: { status: res.status, domain },
    };
  }
  return {
    ok: true,
    status: "applied",
    message: `Attached '${domain}' to ${project.vercelProjectId}.`,
    output: { domain },
  };
}

async function applyDomainVerify(
  payload: Record<string, unknown> | null,
  projectId: string | null,
): Promise<ApplyOutcome> {
  const domain = asString(payload?.domain);
  if (!domain)
    return {
      ok: false,
      status: "failed",
      message: "payload.domain missing",
    };
  if (!projectId)
    return {
      ok: false,
      status: "failed",
      message: "incident has no projectId",
    };
  const project = await getProjectById(projectId);
  if (!project || !project.vercelProjectId)
    return {
      ok: false,
      status: "failed",
      message: "project missing vercelProjectId",
    };
  const token = await ensureVerifiedCredential("vercel");
  const url = new URL(
    `https://api.vercel.com/v9/projects/${encodeURIComponent(project.vercelProjectId)}/domains`,
  );
  if (project.vercelTeamId) url.searchParams.set("teamId", project.vercelTeamId);
  const res = await probeJson(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    return {
      ok: false,
      status: "failed",
      message: `GET /domains failed: ${res.message}`,
    };
  }
  const detail = res.detail ?? {};
  const list = Array.isArray(detail.domains) ? detail.domains : [];
  const entry = list.find(
    (d: unknown) =>
      typeof d === "object" &&
      d !== null &&
      "name" in d &&
      (d as { name: unknown }).name === domain,
  ) as { name?: string; verified?: boolean } | undefined;
  if (!entry) {
    return {
      ok: false,
      status: "failed",
      message: `Domain '${domain}' is not attached yet. Apply 'domain.attach' first.`,
    };
  }
  const verified = entry.verified !== false;
  return {
    ok: true,
    status: "applied",
    message: verified
      ? `Domain '${domain}' is now verified.`
      : `Domain '${domain}' is attached but not yet verified — DNS may still be propagating.`,
    output: { domain, verified },
  };
}

const HANDLERS: Record<
  RemediationAction,
  (
    payload: Record<string, unknown> | null,
    projectId: string | null,
  ) => Promise<ApplyOutcome>
> = {
  "probe.retry": (payload) => applyProbeRetry(payload),
  "deploy.retry": (payload, projectId) => applyDeployRetry(payload, projectId),
  "workflow.rerun": (payload) => applyWorkflowRerun(payload),
  "env.add": (payload) => applyEnvAdd(payload),
  "domain.attach": (payload, projectId) =>
    applyDomainAttach(payload, projectId),
  "domain.verify": (payload, projectId) =>
    applyDomainVerify(payload, projectId),
};

/**
 * Apply a remediation. Walks the gate, dispatches to the action handler,
 * writes status + audit. The remediation row is updated to 'queued' before
 * the call to the provider so a hung call leaves an honest in-flight state;
 * status flips to 'applied' or 'failed' after.
 */
export async function applyRemediation(args: {
  remediationId: string;
  actor: string;
}): Promise<ApplyResult> {
  const ctx = await loadRemediationContext(args.remediationId);
  if (!isKnownAction(ctx.action)) {
    throw new Error(`unknown remediation action: ${ctx.action}`);
  }
  const gate = checkApplyGate({
    action: ctx.action,
    autonomy: ctx.autonomy,
    liveModeOn: isLiveMode,
    currentStatus: ctx.status,
  });
  if (!gate.allowed) {
    await recordAudit({
      actor: args.actor,
      action: "remediation.apply.refused",
      target: args.remediationId,
      metadata: { reason: gate.reason, action: ctx.action },
    });
    throw new Error(`apply refused: ${gate.reason}`);
  }

  await setRemediationStatus(args.remediationId, "queued");
  await recordAudit({
    actor: args.actor,
    action: "remediation.queued",
    target: args.remediationId,
    metadata: { action: ctx.action },
  });

  let outcome: ApplyOutcome;
  try {
    outcome = await HANDLERS[ctx.action](ctx.payload, ctx.projectId);
  } catch (err) {
    outcome = {
      ok: false,
      status: "failed",
      message: err instanceof Error ? err.message : "handler threw",
    };
  }

  await setRemediationStatus(args.remediationId, outcome.status);
  await recordAudit({
    actor: args.actor,
    action: outcome.ok
      ? "remediation.applied"
      : "remediation.failed",
    target: args.remediationId,
    metadata: {
      action: ctx.action,
      message: outcome.message,
      output: outcome.output ?? null,
    },
  });

  return { remediationId: args.remediationId, outcome };
}
