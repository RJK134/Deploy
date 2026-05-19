"use server";

import { revalidatePath } from "next/cache";

import {
  createMonitor,
  deleteMonitor,
  dismissIncident,
  resolveIncident,
} from "@/lib/db/fixbot";
import { MONITOR_KINDS, type MonitorKind } from "@/lib/db/schema";
import { buildMonitorConfig } from "@/lib/fixbot/monitor-config";
import { applyRemediation } from "@/lib/remediations/apply";
import { requireActorEmail } from "@/lib/server-actor";

function assertKind(value: FormDataEntryValue | null): MonitorKind {
  if (typeof value !== "string") throw new Error("monitor kind is required");
  if (!(MONITOR_KINDS as readonly string[]).includes(value)) {
    throw new Error(`unknown monitor kind: ${value}`);
  }
  return value as MonitorKind;
}

function nonEmptyString(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function buildConfig(kind: MonitorKind, formData: FormData): Record<string, unknown> {
  switch (kind) {
    case "http": {
      const url = nonEmptyString(formData.get("httpUrl"));
      const rawStatus = formData.get("httpExpectedStatus");
      const expectedStatus =
        typeof rawStatus === "string" && rawStatus.length > 0
          ? Number.parseInt(rawStatus, 10)
          : 200;
      const expectedBodyContains = nonEmptyString(
        formData.get("httpExpectedBody"),
      );
      return buildMonitorConfig("http", {
        url: url ?? "",
        expectedStatus,
        expectedBodyContains,
      });
    }
    case "build": {
      const inspectCountRaw = formData.get("buildInspectCount");
      const inspectCount =
        typeof inspectCountRaw === "string" && inspectCountRaw.length > 0
          ? Number.parseInt(inspectCountRaw, 10)
          : 1;
      return buildMonitorConfig("build", { inspectCount });
    }
    case "workflow": {
      const workflowId = nonEmptyString(formData.get("workflowId"));
      const branch = nonEmptyString(formData.get("workflowBranch"));
      return buildMonitorConfig("workflow", { workflowId, branch });
    }
    case "env": {
      const targetRaw = formData.get("envTarget");
      const target =
        typeof targetRaw === "string" &&
        (targetRaw === "production" ||
          targetRaw === "preview" ||
          targetRaw === "development")
          ? targetRaw
          : "production";
      const requiredKeys = nonEmptyString(formData.get("envRequiredKeys"));
      return buildMonitorConfig("env", { target, requiredKeys });
    }
    case "domain": {
      const domain = nonEmptyString(formData.get("domainOverride"));
      return buildMonitorConfig("domain", { domain });
    }
    case "migration":
      return buildMonitorConfig(kind, {});
  }
}

export async function createMonitorAction(formData: FormData): Promise<void> {
  const kind = assertKind(formData.get("kind"));
  const label = nonEmptyString(formData.get("label"));
  if (!label) throw new Error("label is required");
  if (label.length > 80) throw new Error("label must be 80 characters or fewer");
  const rawProjectId = formData.get("projectId");
  const projectId =
    typeof rawProjectId === "string" && rawProjectId.length > 0
      ? rawProjectId
      : null;
  const config = buildConfig(kind, formData);
  await createMonitor({
    projectId,
    kind,
    label,
    config,
    actor: await requireActorEmail(),
  });
  revalidatePath("/fixbot");
}

export async function deleteMonitorAction(formData: FormData): Promise<void> {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) throw new Error("monitor id is required");
  await deleteMonitor(id, await requireActorEmail());
  revalidatePath("/fixbot");
}

export async function dismissIncidentAction(
  formData: FormData,
): Promise<void> {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) throw new Error("incident id is required");
  await dismissIncident(id, await requireActorEmail());
  revalidatePath("/fixbot");
  revalidatePath(`/fixbot/${id}`);
}

export async function resolveIncidentAction(
  formData: FormData,
): Promise<void> {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) throw new Error("incident id is required");
  const note = nonEmptyString(formData.get("note"));
  await resolveIncident(id, await requireActorEmail(), note);
  revalidatePath("/fixbot");
  revalidatePath(`/fixbot/${id}`);
}

export async function applyRemediationAction(
  formData: FormData,
): Promise<void> {
  const remediationId = formData.get("remediationId");
  const incidentId = formData.get("incidentId");
  if (typeof remediationId !== "string" || !remediationId) {
    throw new Error("remediationId is required");
  }
  await applyRemediation({
    remediationId,
    actor: await requireActorEmail(),
  });
  revalidatePath("/fixbot");
  if (typeof incidentId === "string" && incidentId) {
    revalidatePath(`/fixbot/${incidentId}`);
  }
}
