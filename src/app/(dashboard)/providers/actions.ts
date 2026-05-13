"use server";

import { revalidatePath } from "next/cache";

import {
  deleteCredential,
  getCredentialPlaintext,
  markVerified,
  setCredential,
} from "@/lib/db/credentials";
import { PROVIDER_KINDS, type ProviderKind } from "@/lib/db/schema";
import { probeGitHub } from "@/lib/providers/github";
import { probeNeon } from "@/lib/providers/neon";
import type { ProbeResult } from "@/lib/providers/probe";
import { probeVercel } from "@/lib/providers/vercel";
import { requireActorEmail } from "@/lib/server-actor";

function assertKind(value: FormDataEntryValue | null): ProviderKind {
  if (typeof value !== "string") throw new Error("missing provider kind");
  if (!(PROVIDER_KINDS as readonly string[]).includes(value)) {
    throw new Error(`unknown provider kind: ${value}`);
  }
  return value as ProviderKind;
}

async function probeForKind(
  kind: ProviderKind,
  plaintext: string,
): Promise<ProbeResult> {
  switch (kind) {
    case "github_pat":
      return probeGitHub(plaintext);
    case "vercel":
      return probeVercel(plaintext);
    case "neon":
      return probeNeon(plaintext);
  }
}

export async function saveCredentialAction(formData: FormData): Promise<void> {
  const kind = assertKind(formData.get("kind"));
  const plaintext = formData.get("plaintext");
  if (typeof plaintext !== "string" || !plaintext.trim()) {
    throw new Error("credential value is required");
  }
  await setCredential(kind, plaintext, await requireActorEmail());
  revalidatePath("/providers");
  revalidatePath("/");
}

export async function verifyCredentialAction(
  formData: FormData,
): Promise<void> {
  const kind = assertKind(formData.get("kind"));
  const plaintext = await getCredentialPlaintext(kind);
  if (!plaintext) throw new Error("no credential to verify");
  const result = await probeForKind(kind, plaintext);
  await markVerified(kind, result.ok, await requireActorEmail());
  revalidatePath("/providers");
  revalidatePath("/");
}

export async function disconnectCredentialAction(
  formData: FormData,
): Promise<void> {
  const kind = assertKind(formData.get("kind"));
  await deleteCredential(kind, await requireActorEmail());
  revalidatePath("/providers");
  revalidatePath("/projects");
  revalidatePath("/");
}
