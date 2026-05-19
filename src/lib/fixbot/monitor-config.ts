/**
 * Pure config builders for the monitor-create form. The server action wraps
 * these and stores the result in `fixbot_monitors.config`. Splitting them
 * out so they're unit-testable without a FormData stub.
 */

import type { MonitorKind } from "@/lib/db/schema";

export interface HttpConfigInput {
  url: string;
  expectedStatus?: number;
  expectedBodyContains?: string | null;
}

export interface BuildConfigInput {
  inspectCount?: number;
}

export interface WorkflowConfigInput {
  workflowId?: string | null;
  branch?: string | null;
}

export function buildHttpMonitorConfig(
  input: HttpConfigInput,
): Record<string, unknown> {
  const url = input.url?.trim() ?? "";
  if (!url) throw new Error("URL is required for HTTP monitors");
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("URL must start with http:// or https://");
  }
  const expectedStatus = input.expectedStatus ?? 200;
  if (
    !Number.isFinite(expectedStatus) ||
    expectedStatus < 100 ||
    expectedStatus > 599
  ) {
    throw new Error("expectedStatus must be a number between 100 and 599");
  }
  const expectedBody = input.expectedBodyContains?.trim();
  return {
    url,
    expectedStatus,
    ...(expectedBody ? { expectedBodyContains: expectedBody } : {}),
  };
}

export function buildBuildMonitorConfig(
  input: BuildConfigInput,
): Record<string, unknown> {
  const inspectCount = input.inspectCount ?? 1;
  if (!Number.isFinite(inspectCount) || inspectCount < 1 || inspectCount > 5) {
    throw new Error("inspectCount must be 1–5");
  }
  return { inspectCount };
}

export function buildWorkflowMonitorConfig(
  input: WorkflowConfigInput,
): Record<string, unknown> {
  const workflowId = input.workflowId?.trim();
  const branch = input.branch?.trim();
  return {
    ...(workflowId ? { workflowId } : {}),
    ...(branch ? { branch } : {}),
  };
}

export function buildMonitorConfig(
  kind: MonitorKind,
  input:
    | HttpConfigInput
    | BuildConfigInput
    | WorkflowConfigInput
    | Record<string, unknown>,
): Record<string, unknown> {
  switch (kind) {
    case "http":
      return buildHttpMonitorConfig(input as HttpConfigInput);
    case "build":
      return buildBuildMonitorConfig(input as BuildConfigInput);
    case "workflow":
      return buildWorkflowMonitorConfig(input as WorkflowConfigInput);
    case "env":
    case "domain":
    case "migration":
      return {};
  }
}
