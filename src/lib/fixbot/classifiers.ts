/**
 * Pure classification helpers for the build + workflow analyzers. Lifted out
 * of the DB-coupled analyzers so they can be unit-tested without mocking the
 * Drizzle client.
 */

export type AnalyzerStatus = "healthy" | "warning" | "down";

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
