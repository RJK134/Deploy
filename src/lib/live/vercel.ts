import { probeJson } from "@/lib/providers/probe";

import {
  notImplementedLiveOutcome,
  type LiveStageContext,
  type StageOutcome,
} from "./types";

const VERCEL_HEADERS = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/json",
  "Content-Type": "application/json",
});

function vercelUrl(path: string, teamId: string | null): string {
  const url = new URL(`https://api.vercel.com${path}`);
  if (teamId) url.searchParams.set("teamId", teamId);
  return url.toString();
}

/**
 * Trigger a Vercel deployment for the project. Requires the Vercel project to
 * already be linked to a Git repository (Vercel's UI does this in one click).
 * Without that link, Vercel can't infer what to build from a POST.
 */
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

  // Confirm project access + read its link metadata.
  const projectRes = await probeJson(
    vercelUrl(
      `/v9/projects/${encodeURIComponent(projectId)}`,
      ctx.providerIds.vercelTeamId,
    ),
    { headers: VERCEL_HEADERS(ctx.credentials.vercel) },
  );
  if (!projectRes.ok) {
    return {
      status: "failed",
      logLines: [
        `GET /v9/projects/${projectId} failed: ${projectRes.message}`,
      ],
      output: { status: projectRes.status },
      error: {
        provider: "vercel",
        projectId,
        teamId: ctx.providerIds.vercelTeamId,
        message: projectRes.message,
      },
    };
  }
  const projectDetail = projectRes.detail ?? {};
  const linked =
    typeof projectDetail.link === "object" && projectDetail.link !== null
      ? (projectDetail.link as Record<string, unknown>)
      : null;

  if (!linked) {
    return {
      status: "failed",
      logLines: [
        `Vercel project ${projectId} has no linked Git repo.`,
        "Connect the GitHub repo in the Vercel project settings, then retry the run.",
      ],
      output: { projectId, linked: false },
      error: {
        provider: "vercel",
        reason: "project not linked to a git repository",
      },
    };
  }

  const branch = ctx.plan.project.defaultBranch ?? "main";
  const projectName =
    typeof projectDetail.name === "string"
      ? projectDetail.name
      : ctx.plan.project.githubRepo;

  // POST /v13/deployments. Body provides project + git source so Vercel
  // looks up the latest commit on the named branch.
  const deployRes = await probeJson(
    vercelUrl(`/v13/deployments`, ctx.providerIds.vercelTeamId),
    {
      method: "POST",
      headers: VERCEL_HEADERS(ctx.credentials.vercel),
      body: JSON.stringify({
        name: projectName,
        project: projectId,
        target: ctx.plan.environment === "deploy" ? "production" : "preview",
        gitSource:
          linked.type === "github"
            ? {
                type: "github",
                repo: linked.repo,
                org: linked.org,
                ref: branch,
                repoId: linked.repoId,
              }
            : undefined,
      }),
    },
  );

  if (!deployRes.ok) {
    return {
      status: "failed",
      logLines: [
        `POST /v13/deployments failed: ${deployRes.message}`,
      ],
      output: { status: deployRes.status, projectId },
      error: {
        provider: "vercel",
        projectId,
        message: deployRes.message,
      },
    };
  }

  const dep = deployRes.detail ?? {};
  const deploymentUrl =
    typeof dep.url === "string"
      ? `https://${dep.url}`
      : `https://${ctx.plan.predicted.deployHost}`;
  return {
    status: "succeeded",
    logLines: [
      `Triggered Vercel deployment for ${projectName}@${branch}.`,
      `Deployment id: ${dep.id ?? "(unknown)"}.`,
      `URL: ${deploymentUrl}`,
      `Target: ${ctx.plan.environment === "deploy" ? "production" : "preview"}.`,
    ],
    output: {
      projectId,
      deploymentId: dep.id ?? null,
      url: deploymentUrl,
      target: ctx.plan.environment === "deploy" ? "production" : "preview",
    },
  };
}

/**
 * If the project has a custom_domain configured and the project on Vercel
 * does not already have it attached, POST it. Idempotent.
 */
export async function liveDomainAttach(
  ctx: LiveStageContext,
): Promise<StageOutcome> {
  const projectId = ctx.providerIds.vercelProjectId;
  const projectCustomDomain = ctx.plan.project.customDomain ?? null;

  if (!projectId) {
    return notImplementedLiveOutcome(
      "project.vercelProjectId is not set; cannot attach a domain without a target project.",
      { plan: ctx.plan.project.slug },
    );
  }

  // Read existing domains.
  const listRes = await probeJson(
    vercelUrl(
      `/v9/projects/${encodeURIComponent(projectId)}/domains`,
      ctx.providerIds.vercelTeamId,
    ),
    { headers: VERCEL_HEADERS(ctx.credentials.vercel) },
  );
  if (!listRes.ok) {
    return {
      status: "failed",
      logLines: [
        `GET /v9/projects/${projectId}/domains failed: ${listRes.message}`,
      ],
      output: { status: listRes.status },
      error: {
        provider: "vercel",
        projectId,
        message: listRes.message,
      },
    };
  }
  const detail = listRes.detail ?? {};
  const domainsArr = Array.isArray(detail.domains) ? detail.domains : [];

  if (!projectCustomDomain) {
    return {
      status: "succeeded",
      logLines: [
        `No custom_domain configured for project ${ctx.plan.project.slug}.`,
        `Project has ${domainsArr.length} domain${domainsArr.length === 1 ? "" : "s"} attached on Vercel; skipping the attach step.`,
      ],
      output: {
        projectId,
        attachedDomainCount: domainsArr.length,
        attachedDomains: domainsArr,
        configuredDomain: null,
      },
    };
  }

  const already = domainsArr.find(
    (d: unknown) =>
      typeof d === "object" &&
      d !== null &&
      "name" in d &&
      (d as { name: unknown }).name === projectCustomDomain,
  );
  if (already) {
    return {
      status: "succeeded",
      logLines: [
        `Domain '${projectCustomDomain}' is already attached to ${projectId}.`,
        "Idempotent reuse path; no POST sent.",
      ],
      output: {
        projectId,
        domain: projectCustomDomain,
        attached: true,
        created: false,
      },
    };
  }

  // Attach the domain.
  const attachRes = await probeJson(
    vercelUrl(
      `/v10/projects/${encodeURIComponent(projectId)}/domains`,
      ctx.providerIds.vercelTeamId,
    ),
    {
      method: "POST",
      headers: VERCEL_HEADERS(ctx.credentials.vercel),
      body: JSON.stringify({ name: projectCustomDomain }),
    },
  );

  if (!attachRes.ok) {
    return {
      status: "failed",
      logLines: [
        `POST /v10/projects/${projectId}/domains failed: ${attachRes.message}`,
        "DNS may not be configured yet; check the Vercel dashboard for the verification record.",
      ],
      output: { status: attachRes.status, domain: projectCustomDomain },
      error: {
        provider: "vercel",
        projectId,
        domain: projectCustomDomain,
        message: attachRes.message,
      },
    };
  }

  return {
    status: "succeeded",
    logLines: [
      `Attached '${projectCustomDomain}' to Vercel project ${projectId}.`,
      "Verification may still be pending — see the Vercel dashboard for DNS records.",
    ],
    output: {
      projectId,
      domain: projectCustomDomain,
      attached: true,
      created: true,
    },
  };
}
