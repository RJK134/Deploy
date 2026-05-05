/**
 * Live deployment orchestration.
 *
 * `startLiveVercelDeploy(runId)` is the entry point. It:
 *
 *   1. Computes a blocker list. If anything is missing (token, repo, env mode)
 *      it persists `live_blocked` on the run and returns the blockers WITHOUT
 *      contacting Vercel.
 *   2. Creates a real Vercel deployment via the v13 REST API.
 *   3. Persists the deployment id immediately and returns a poll URL.
 *
 * `pollLiveVercelDeploy(runId)` advances the persisted state by one Vercel
 * fetch. It mutates the run row (status, vercelStatus, vercelUrl, events) and
 * returns the latest snapshot. The frontend calls this on an interval until
 * the run reaches a terminal state.
 *
 * No simulated outcomes. Every status change reflects a real Vercel response.
 */

import type { Run, Project } from "@shared/schema";
import { storage } from "./storage";
import { resolveActiveToken } from "./connections-routes";
import {
  vercelCreateDeploymentFromGitHub,
  vercelGetDeployment,
  vercelGetDeploymentEvents,
  vercelFindProjectForRepo,
  vercelGetUser,
  vercelListTeams,
  buildInspectorUrl,
  isTerminal,
  safeMessage,
  VercelError,
  type VercelDeployment,
  type VercelDeploymentEvent,
} from "./vercel";

/* -------------------------------- types -------------------------------- */

export type LiveRunStatus =
  | "queued"
  | "live_blocked"
  | "live_pending"
  | "live_running"
  | "live_succeeded"
  | "live_failed"
  | "validated_dry_run"
  /* legacy values still observed in older seed/data: */
  | "succeeded" | "failed" | "running" | "paused";

export interface LiveBlocker {
  code: string;
  message: string;
  /** What the operator must do to clear this blocker. */
  remediation: string;
}

export interface LiveReadinessResult {
  ready: boolean;
  blockers: LiveBlocker[];
  /** Resolved Vercel token source, when we could load one for read-only checks. */
  tokenSource: "connection" | "env" | null;
  account: { username: string; email: string | null } | null;
  /** First Vercel project we could match for the repo, if any. */
  matchedProject: { id: string; name: string; teamId: string | null } | null;
  /** Ambient flags surfaced for the UI. */
  liveEnabled: boolean;
}

/* -------------------------- readiness gates --------------------------- */

/**
 * Compute the static + dynamic readiness gates for a live Vercel deploy of
 * a project + branch. Read-only — never triggers a deployment.
 */
export async function checkLiveVercelReadiness(input: {
  project: Project;
  branch: string;
}): Promise<LiveReadinessResult> {
  const { project, branch } = input;
  const blockers: LiveBlocker[] = [];

  const liveEnabled = process.env.DEPLOYOPS_LIVE === "1";
  if (!liveEnabled) {
    blockers.push({
      code: "deployops-live-disabled",
      message: "DEPLOYOPS_LIVE is not set to 1.",
      remediation: "Set the DEPLOYOPS_LIVE=1 environment variable on the DeployOps server, then restart.",
    });
  }

  if (project.sourceProvider !== "github") {
    blockers.push({
      code: "non-github-source",
      message: "Project source is not a real GitHub repo.",
      remediation: "Re-run the New Deploy wizard and pick a repo from the live GitHub picker.",
    });
  }
  if (!project.repo || !/^[\w.-]+\/[\w.-]+$/.test(project.repo)) {
    blockers.push({
      code: "invalid-repo",
      message: `Project repo "${project.repo}" is not in owner/name form.`,
      remediation: "Recreate the project from the GitHub picker.",
    });
  }
  if (!branch || branch.trim() === "") {
    blockers.push({
      code: "missing-branch",
      message: "No branch selected for the deployment.",
      remediation: "Pick a branch in the New Deploy wizard before running live.",
    });
  }

  /* Vercel token resolution — connection token preferred, env fallback. */
  const auth = await resolveActiveToken("vercel");
  if (!auth?.token) {
    blockers.push({
      code: "no-vercel-token",
      message: "No Vercel token available. Connect Vercel in Connection Center or set VERCEL_TOKEN.",
      remediation: "Open /providers and connect Vercel, or set VERCEL_TOKEN on the server.",
    });
    return {
      ready: false, blockers, tokenSource: null, account: null,
      matchedProject: null, liveEnabled,
    };
  }

  /* Validate the token and try to find a Vercel project linked to the repo. */
  let account: { username: string; email: string | null } | null = null;
  try {
    const user = await vercelGetUser(auth.token);
    account = { username: user.username, email: user.email ?? null };
  } catch (err) {
    if (err instanceof VercelError && err.code === "unauthorized") {
      blockers.push({
        code: "vercel-token-unauthorized",
        message: "Vercel token is unauthorized.",
        remediation: "Generate a new Vercel token at https://vercel.com/account/tokens and reconnect.",
      });
    } else {
      blockers.push({
        code: "vercel-validation-failed",
        message: `Vercel validation failed: ${safeMessage((err as Error).message)}`,
        remediation: "Inspect the Vercel API status and retry. Re-validate the connection in Connection Center.",
      });
    }
    return { ready: false, blockers, tokenSource: auth.source, account, matchedProject: null, liveEnabled };
  }

  /* Try team scope by attempting both personal and each team. We pick the
   * first project that matches the repo, regardless of scope. */
  let matchedProject: LiveReadinessResult["matchedProject"] = null;
  try {
    /* Personal scope first. */
    const personal = await vercelFindProjectForRepo(auth.token, project.repo);
    if (personal) {
      matchedProject = { id: personal.id, name: personal.name, teamId: null };
    } else {
      const teams = await vercelListTeams(auth.token);
      for (const t of teams) {
        const found = await vercelFindProjectForRepo(auth.token, project.repo, t.id);
        if (found) {
          matchedProject = { id: found.id, name: found.name, teamId: t.id };
          break;
        }
      }
    }
  } catch (err) {
    blockers.push({
      code: "vercel-project-lookup-failed",
      message: `Failed to look up Vercel projects: ${safeMessage((err as Error).message)}`,
      remediation: "Confirm the Vercel token has read access to your projects/teams.",
    });
  }

  if (!matchedProject) {
    blockers.push({
      code: "no-linked-project",
      message: `No Vercel project is linked to ${project.repo}. Vercel-GitHub integration may not be installed for this repo.`,
      remediation: "Open https://vercel.com/new and import the repo. Vercel will install the GitHub app on the org if needed. Then retry.",
    });
  }

  return {
    ready: blockers.length === 0,
    blockers,
    tokenSource: auth.source,
    account,
    matchedProject,
    liveEnabled,
  };
}

/* ---------------------------- start a live run ------------------------- */

export interface StartLiveResult {
  ok: boolean;
  status: LiveRunStatus;
  blockers?: LiveBlocker[];
  deploymentId?: string;
  vercelUrl?: string | null;
  inspectorUrl?: string | null;
  message?: string;
}

/**
 * Start a real Vercel deployment for the run. Persists deployment metadata
 * on success. On any blocker, persists `live_blocked` and returns blockers
 * WITHOUT contacting Vercel.
 */
export async function startLiveVercelDeploy(runId: number): Promise<StartLiveResult> {
  const run = await storage.getRun(runId);
  if (!run) return { ok: false, status: "live_failed", message: `run ${runId} not found` };
  if (run.mode !== "live") {
    return {
      ok: false, status: run.status as LiveRunStatus,
      message: "run is not in live mode — start a live run from the wizard with mode=live",
    };
  }
  const project = await storage.getProject(run.projectId);
  if (!project) {
    await storage.updateRun(runId, {
      status: "live_failed",
      vercelErrorMessage: "associated project not found",
      finishedAt: Date.now(),
    });
    return { ok: false, status: "live_failed", message: "project not found" };
  }

  const branch = project.sourceBranch ?? project.sourceDefaultBranch ?? "main";
  const readiness = await checkLiveVercelReadiness({ project, branch });
  if (!readiness.ready) {
    await storage.updateRun(runId, {
      status: "live_blocked",
      vercelErrorMessage: readiness.blockers.map((b) => `${b.code}: ${b.message}`).join("\n"),
      vercelEvents: JSON.stringify(blockerEvents(readiness.blockers)),
      finishedAt: null as any,
    });
    return { ok: false, status: "live_blocked", blockers: readiness.blockers };
  }

  const auth = await resolveActiveToken("vercel");
  if (!auth) {
    /* Should be caught by readiness, but defensive. */
    await storage.updateRun(runId, {
      status: "live_blocked",
      vercelErrorMessage: "no Vercel token resolved",
    });
    return {
      ok: false, status: "live_blocked",
      blockers: [{ code: "no-vercel-token", message: "No Vercel token", remediation: "Connect Vercel" }],
    };
  }

  const target: "production" | "preview" = run.environment === "deploy" ? "production" : "preview";
  const projectName = readiness.matchedProject?.name ?? project.name;
  const teamId = readiness.matchedProject?.teamId ?? undefined;

  await storage.updateRun(runId, {
    status: "live_pending",
    vercelProjectId: readiness.matchedProject?.id ?? null,
    vercelProjectName: projectName,
    vercelTeamId: teamId ?? null,
    vercelEvents: JSON.stringify([
      makeEvent("info", `Starting live Vercel deploy for ${project.repo}@${branch} (target=${target})`),
      makeEvent("info", `Vercel token source: ${auth.source}`),
      readiness.matchedProject
        ? makeEvent("info", `Matched Vercel project: ${readiness.matchedProject.name} (${readiness.matchedProject.id})`)
        : makeEvent("warn", "No pre-existing Vercel project matched; relying on Vercel-GitHub integration"),
    ]),
    startedAt: Date.now(),
  });

  let deployment: VercelDeployment;
  try {
    deployment = await vercelCreateDeploymentFromGitHub(auth.token, {
      projectName,
      repo: project.repo,
      branch,
      target,
      teamId,
    });
  } catch (err) {
    const msg = err instanceof VercelError ? err.message : String(err);
    const code = err instanceof VercelError ? err.code : "unknown";
    const blockers: LiveBlocker[] = code === "vercel-github-integration-required"
      ? [{
          code,
          message: msg,
          remediation: "Install the Vercel app for the GitHub org/user, import the project once, and retry.",
        }]
      : code === "project-not-found"
        ? [{ code, message: msg, remediation: "Import the repo on https://vercel.com/new first." }]
        : [{ code, message: msg, remediation: "Inspect Vercel status; re-validate the token." }];

    await storage.updateRun(runId, {
      status: code === "vercel-github-integration-required" || code === "project-not-found"
        ? "live_blocked" : "live_failed",
      vercelErrorMessage: safeMessage(msg),
      vercelEvents: JSON.stringify(blockerEvents(blockers)),
      finishedAt: Date.now(),
    });
    return {
      ok: false,
      status: code === "vercel-github-integration-required" || code === "project-not-found"
        ? "live_blocked" : "live_failed",
      blockers,
      message: msg,
    };
  }

  const inspectorUrl = deployment.inspectorUrl
    ?? buildInspectorUrl(readiness.account?.username ?? null, projectName, deployment.id);

  const events = readEventsFromRun(run);
  events.push(makeEvent("info", `Vercel deployment created: ${deployment.id}`));
  if (deployment.url) events.push(makeEvent("info", `Deployment URL: ${deployment.url}`));
  if (inspectorUrl) events.push(makeEvent("info", `Inspector: ${inspectorUrl}`));

  await storage.updateRun(runId, {
    status: "live_running",
    vercelDeploymentId: deployment.id,
    vercelStatus: deployment.readyState,
    vercelUrl: deployment.url || null,
    vercelAliasUrl: deployment.aliasUrl,
    vercelInspectorUrl: inspectorUrl,
    vercelEvents: JSON.stringify(events),
    vercelLastPolledAt: Date.now(),
  });

  return {
    ok: true,
    status: "live_running",
    deploymentId: deployment.id,
    vercelUrl: deployment.url || null,
    inspectorUrl,
    message: `Vercel deployment ${deployment.id} created`,
  };
}

/* --------------------------- poll a live run --------------------------- */

export interface PollLiveResult {
  status: LiveRunStatus;
  vercelStatus: string | null;
  vercelUrl: string | null;
  vercelAliasUrl: string | null;
  inspectorUrl: string | null;
  errorMessage: string | null;
  events: VercelDeploymentEvent[];
  /** True when status is terminal (no further polls required). */
  done: boolean;
}

/**
 * Poll the upstream Vercel deployment once. Persists any state changes.
 * Safe to call repeatedly. Idempotent on terminal states (no further mutation).
 */
export async function pollLiveVercelDeploy(runId: number): Promise<PollLiveResult> {
  const run = await storage.getRun(runId);
  if (!run) {
    throw new Error(`run ${runId} not found`);
  }
  if (run.mode !== "live" || !run.vercelDeploymentId) {
    return liveResultFromRun(run);
  }
  if (run.status === "live_succeeded" || run.status === "live_failed" || run.status === "live_blocked") {
    return liveResultFromRun(run);
  }

  const auth = await resolveActiveToken("vercel");
  if (!auth) {
    await storage.updateRun(runId, {
      status: "live_failed",
      vercelErrorMessage: "Vercel token disappeared during deployment polling",
      finishedAt: Date.now(),
    });
    const updated = await storage.getRun(runId);
    return liveResultFromRun(updated!);
  }

  let deployment: VercelDeployment;
  try {
    deployment = await vercelGetDeployment(auth.token, run.vercelDeploymentId, run.vercelTeamId ?? undefined);
  } catch (err) {
    const msg = err instanceof VercelError ? err.message : String(err);
    /* Network blip — record it as an event but don't move to terminal. */
    const events = readEventsFromRun(run);
    events.push(makeEvent("warn", `Vercel poll failed: ${safeMessage(msg)}`));
    await storage.updateRun(runId, {
      vercelEvents: JSON.stringify(events),
      vercelLastPolledAt: Date.now(),
    });
    const updated = await storage.getRun(runId);
    return liveResultFromRun(updated!);
  }

  const events = readEventsFromRun(run);
  events.push(makeEvent("status", `Vercel readyState=${deployment.readyState}`));
  let nextStatus: LiveRunStatus = run.status as LiveRunStatus;
  let finishedAt = run.finishedAt;
  let errorMessage = run.vercelErrorMessage;

  if (isTerminal(String(deployment.readyState))) {
    if (deployment.readyState === "READY") {
      nextStatus = "live_succeeded";
      finishedAt = Date.now();
      events.push(makeEvent("info", `Deployment ready: ${deployment.url}`));
      if (deployment.aliasUrl) events.push(makeEvent("info", `Alias: ${deployment.aliasUrl}`));
    } else {
      nextStatus = "live_failed";
      finishedAt = Date.now();
      errorMessage = deployment.errorMessage ?? `deployment ended in ${deployment.readyState}`;
      events.push(makeEvent("error", `Deployment ${deployment.readyState}: ${errorMessage}`));
    }

    /* Fetch real upstream events on terminal — do not invent log lines. */
    try {
      const upstreamEvents = await vercelGetDeploymentEvents(
        auth.token, run.vercelDeploymentId, run.vercelTeamId ?? undefined,
      );
      for (const ev of upstreamEvents) {
        events.push({
          type: ev.type,
          text: ev.text,
          createdAt: ev.createdAt,
        });
      }
    } catch (err) {
      events.push(makeEvent("warn", `Could not fetch upstream events: ${safeMessage((err as Error).message)}`));
    }
  } else {
    nextStatus = "live_running";
  }

  await storage.updateRun(runId, {
    status: nextStatus,
    vercelStatus: deployment.readyState,
    vercelUrl: deployment.url || run.vercelUrl,
    vercelAliasUrl: deployment.aliasUrl ?? run.vercelAliasUrl,
    vercelInspectorUrl: deployment.inspectorUrl ?? run.vercelInspectorUrl,
    vercelErrorMessage: errorMessage,
    vercelEvents: JSON.stringify(events),
    vercelLastPolledAt: Date.now(),
    finishedAt,
  });

  const updated = await storage.getRun(runId);
  return liveResultFromRun(updated!);
}

/* ----------------------------- helpers -------------------------------- */

function readEventsFromRun(run: Run): VercelDeploymentEvent[] {
  if (!run.vercelEvents) return [];
  try {
    const arr = JSON.parse(run.vercelEvents);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function makeEvent(type: string, text: string): VercelDeploymentEvent {
  return { type, text, createdAt: Date.now() };
}

function blockerEvents(blockers: LiveBlocker[]): VercelDeploymentEvent[] {
  return blockers.map((b) => ({
    type: "blocker",
    text: `${b.code}: ${b.message} → ${b.remediation}`,
    createdAt: Date.now(),
  }));
}

function liveResultFromRun(run: Run): PollLiveResult {
  return {
    status: run.status as LiveRunStatus,
    vercelStatus: run.vercelStatus ?? null,
    vercelUrl: run.vercelUrl ?? null,
    vercelAliasUrl: run.vercelAliasUrl ?? null,
    inspectorUrl: run.vercelInspectorUrl ?? null,
    errorMessage: run.vercelErrorMessage ?? null,
    events: readEventsFromRun(run),
    done: ["live_succeeded", "live_failed", "live_blocked"].includes(run.status),
  };
}
