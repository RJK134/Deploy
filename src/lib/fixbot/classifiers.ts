/**
 * Pure classification helpers for the build / workflow / env / domain
 * analyzers. Lifted out of the DB-coupled analyzers so they can be
 * unit-tested without mocking the Drizzle client.
 */

export type AnalyzerStatus = "healthy" | "warning" | "down";
export type EnvTarget = "production" | "preview" | "development";

export function classifyVercelState(
  state: string | undefined,
  failureStates: string[],
): { status: AnalyzerStatus; reason: string } {
  if (!state) {
    return { status: "warning", reason: "deployment has no state field" };
  }
  if (failureStates.includes(state)) {
    return { status: "down", reason: `latest deployment is ${state}` };
  }
  if (state === "READY") {
    return { status: "healthy", reason: `latest deployment is READY` };
  }
  return { status: "warning", reason: `latest deployment is ${state}` };
}

export interface ActionsRunLite {
  status?: string;
  conclusion?: string | null;
}

export function classifyActionsRun(
  run: ActionsRunLite | undefined,
  failureConclusions: string[],
): { status: AnalyzerStatus; reason: string } {
  if (!run) {
    return { status: "healthy", reason: "no recent workflow runs" };
  }
  if (run.status !== "completed") {
    return {
      status: "warning",
      reason: `latest run is ${run.status ?? "unknown"} (still in progress)`,
    };
  }
  if (run.conclusion && failureConclusions.includes(run.conclusion)) {
    return {
      status: "down",
      reason: `latest run concluded ${run.conclusion}`,
    };
  }
  return {
    status: "healthy",
    reason: `latest run concluded ${run.conclusion ?? "success"}`,
  };
}

/**
 * Compare required env-var keys against what Vercel returns. Missing keys
 * flip the monitor to 'down' regardless of how many; one missing key is a
 * deploy-blocker.
 */
export function classifyEnvKeys(
  required: readonly string[],
  present: ReadonlySet<string>,
): { status: AnalyzerStatus; missingKeys: string[]; reason: string } {
  const missingKeys = required.filter((k) => !present.has(k));
  if (missingKeys.length === 0) {
    return {
      status: "healthy",
      missingKeys: [],
      reason: `all ${required.length} required env var${required.length === 1 ? "" : "s"} present`,
    };
  }
  return {
    status: "down",
    missingKeys,
    reason: `missing ${missingKeys.length} env var${missingKeys.length === 1 ? "" : "s"}: ${missingKeys.join(", ")}`,
  };
}

export interface VercelDomainLite {
  name?: string;
  verified?: boolean;
}

/**
 * Decide a domain monitor's status given the desired custom domain and the
 * project's current attached domains list. Returns `healthy` when no custom
 * domain is configured (nothing to verify) — operators can run a domain
 * monitor against a project that doesn't yet have a custom domain.
 */
export function classifyDomain(
  desired: string | null,
  attached: readonly VercelDomainLite[],
): { status: AnalyzerStatus; reason: string; verified: boolean | null } {
  if (!desired) {
    return {
      status: "healthy",
      reason: "no custom domain configured for this project",
      verified: null,
    };
  }
  const match = attached.find(
    (d) => typeof d.name === "string" && d.name === desired,
  );
  if (!match) {
    return {
      status: "down",
      reason: `custom domain '${desired}' is not attached to the Vercel project`,
      verified: false,
    };
  }
  if (match.verified === false) {
    return {
      status: "down",
      reason: `custom domain '${desired}' is attached but DNS verification is pending`,
      verified: false,
    };
  }
  return {
    status: "healthy",
    reason: `custom domain '${desired}' is attached and verified`,
    verified: true,
  };
}
