"use server";

import { revalidatePath } from "next/cache";

import { setProjectAccess } from "@/lib/db/projects";
import { ACCESS_MODES, type AccessMode } from "@/lib/db/schema";
import { requireActorEmail } from "@/lib/server-actor";

function assertAccessMode(value: FormDataEntryValue | null): AccessMode {
  if (typeof value !== "string") throw new Error("access mode is required");
  if (!(ACCESS_MODES as readonly string[]).includes(value)) {
    throw new Error(`unknown access mode: ${value}`);
  }
  return value as AccessMode;
}

export async function updateProjectAccessAction(
  formData: FormData,
): Promise<void> {
  const projectId = formData.get("projectId");
  const accessMode = assertAccessMode(formData.get("accessMode"));
  const rawDomain = formData.get("customDomain");
  const customDomain = typeof rawDomain === "string" ? rawDomain : "";

  if (typeof projectId !== "string" || !projectId) {
    throw new Error("projectId is required");
  }

  await setProjectAccess({
    projectId,
    accessMode,
    customDomain: customDomain || null,
    actor: await requireActorEmail(),
  });
  revalidatePath("/access");
  revalidatePath("/projects");
}
