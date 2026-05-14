import { probeJson } from "@/lib/providers/probe";

import {
  notImplementedLiveOutcome,
  type LiveStageContext,
  type StageOutcome,
} from "./types";

const VERCEL_HEADERS = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/json",
});

function vercelUrl(path: string, teamId: string | null): string {
  const url = new URL(`https://api.vercel.com${path}`);
  if (teamId) url.searchParams.set("teamId", teamId);
  return url.toString();
}

export async function liveDeploy(
  ctx: LiveStageContext,
): Promise<StageOutcome> {
  const projectId = ctx.providerIds.vercelProjectId;
  if (!projectId) {
    return notImplementedLiveOutcome(
      "project.vercelProjectId is not set; live deploys need an existing Vercel project to attach to.",
      { plan: ctx.plan.project.slug },
    );
  }
  // Read-only call to confirm the project exists and the token can access it.
  const probe = await probeJson(
    vercelUrl(
      `/v9/projects/${encodeURIComponent(projectId)}`,
      ctx.providerIds.vercelTeamId,
    ),
    { headers: VERCEL_HEADERS(ctx.credentials.vercel) },
  );
  if (!probe.ok) {
    return {
      status: "failed",
      logLines: [
        `GET /v9/projects/${projectId} failed: ${probe.message}`,
      ],
      output: { status: probe.status },
      error: {
        provider: "vercel",
        projectId,
        teamId: ctx.providerIds.vercelTeamId,
        message: probe.message,
      },
    };
  }
  const detail = probe.detail ?? {};
  const framework =
    typeof detail.framework === "string"
      ? detail.framework
      : ctx.plan.framework;
  const linked =
    typeof detail.link === "object" && detail.link !== null
      ? (detail.link as Record<string, unknown>)
      : null;
  return {
    status: "succeeded",
    logLines: [
      `Authenticated to Vercel project ${projectId}.`,
      `Project framework preset: ${framework}.`,
      linked
        ? `Linked to GitHub repo ${linked.repo ?? "(unknown)"}.`
        : "Project has no linked Git repo on the Vercel side.",
      "(live: validated project access; deploy creation deferred until Session 7 wires the deployment trigger)",
    ],
    output: {
      projectId,
      teamId: ctx.providerIds.vercelTeamId,
      framework,
      linkedRepo: linked?.repo ?? null,
      predictedUrl: `https://${ctx.plan.predicted.deployHost}`,
    },
  };
}

export async function liveDomainAttach(
  ctx: LiveStageContext,
): Promise<StageOutcome> {
  const projectId = ctx.providerIds.vercelProjectId;
  if (!projectId) {
    return notImplementedLiveOutcome(
      "project.vercelProjectId is not set; cannot attach a domain without a target project.",
      { plan: ctx.plan.project.slug },
    );
  }
  // Read the existing domains so the operator sees what's already attached.
  const probe = await probeJson(
    vercelUrl(
      `/v9/projects/${encodeURIComponent(projectId)}/domains`,
      ctx.providerIds.vercelTeamId,
    ),
    { headers: VERCEL_HEADERS(ctx.credentials.vercel) },
  );
  if (!probe.ok) {
    return {
      status: "failed",
      logLines: [
        `GET /v9/projects/${projectId}/domains failed: ${probe.message}`,
      ],
      output: { status: probe.status },
      error: {
        provider: "vercel",
        projectId,
        message: probe.message,
      },
    };
  }
  const detail = probe.detail ?? {};
  const domainsArr = Array.isArray(detail.domains) ? detail.domains : [];
  return {
    status: "succeeded",
    logLines: [
      `Project has ${domainsArr.length} domain${domainsArr.length === 1 ? "" : "s"} attached.`,
      "Custom domain attachment in live mode is deferred to Session 7 (the operator can attach via the Vercel dashboard for now).",
    ],
    output: {
      projectId,
      attachedDomainCount: domainsArr.length,
      attachedDomains: domainsArr,
    },
  };
}
