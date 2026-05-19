import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  getCredentialPlaintext,
  listCredentials,
} from "@/lib/db/credentials";
import { projects } from "@/lib/db/schema";
import type { ProviderKind } from "@/lib/db/schema";

import type { ProjectRow } from "./types";

/**
 * Confirms a single provider credential exists and is in 'verified' state.
 * Returns the plaintext token, or null when not usable. Analyzers should
 * skip silently when the operator hasn't connected a provider — surfacing
 * "no token" via incident rows would be noisy and not actionable.
 */
export async function getVerifiedCredential(
  kind: ProviderKind,
): Promise<string | null> {
  const credentials = await listCredentials();
  const row = credentials.find((c) => c.kind === kind);
  if (!row || row.connectionState !== "verified") return null;
  return getCredentialPlaintext(kind);
}

export async function getProjectRow(id: string): Promise<ProjectRow | null> {
  const rows = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  return (rows[0] ?? null) as ProjectRow | null;
}
