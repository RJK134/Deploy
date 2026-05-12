"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import {
  deleteCredential,
  getCredentialPlaintext,
  markVerified,
  setCredential,
} from "@/lib/db/credentials";
import { PROVIDER_KINDS, type ProviderKind } from "@/lib/db/schema";

function assertKind(value: FormDataEntryValue | null): ProviderKind {
  if (typeof value !== "string") throw new Error("missing provider kind");
  if (!(PROVIDER_KINDS as readonly string[]).includes(value)) {
    throw new Error(`unknown provider kind: ${value}`);
  }
  return value as ProviderKind;
}

async function actor(): Promise<string> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) throw new Error("not authenticated");
  return email.toLowerCase();
}

export async function saveCredentialAction(formData: FormData): Promise<void> {
  const kind = assertKind(formData.get("kind"));
  const plaintext = formData.get("plaintext");
  if (typeof plaintext !== "string" || !plaintext.trim()) {
    throw new Error("credential value is required");
  }
  await setCredential(kind, plaintext, await actor());
  revalidatePath("/providers");
  revalidatePath("/");
}

export async function verifyCredentialAction(
  formData: FormData,
): Promise<void> {
  const kind = assertKind(formData.get("kind"));
  // Session 2 stub: prove the encrypt/decrypt path works without calling a
  // provider API. Session 3 will replace the body with a real probe.
  const plaintext = await getCredentialPlaintext(kind);
  if (!plaintext) throw new Error("no credential to verify");
  await markVerified(kind, true, await actor());
  revalidatePath("/providers");
  revalidatePath("/");
}

export async function disconnectCredentialAction(
  formData: FormData,
): Promise<void> {
  const kind = assertKind(formData.get("kind"));
  await deleteCredential(kind, await actor());
  revalidatePath("/providers");
  revalidatePath("/");
}
