import "server-only";

import { eq, sql } from "drizzle-orm";

import { decrypt, encrypt } from "@/lib/crypto";
import { db } from "@/lib/db/client";
import { recordAudit } from "@/lib/db/audit";
import {
  PROVIDER_KINDS,
  providerCredentials,
  type ConnectionState,
  type ProviderKind,
} from "@/lib/db/schema";

export interface CredentialView {
  kind: ProviderKind;
  lastFour: string;
  connectionState: ConnectionState;
  lastVerifiedAt: Date | null;
}

function lastFour(plaintext: string): string {
  return plaintext.slice(-4).padStart(4, "•");
}

export async function setCredential(
  kind: ProviderKind,
  plaintext: string,
  actor: string,
): Promise<void> {
  const trimmed = plaintext.trim();
  if (!trimmed) throw new Error("credential value must not be empty");

  const ciphertext = await encrypt(trimmed);
  await db
    .insert(providerCredentials)
    .values({
      kind,
      ciphertext,
      lastFour: lastFour(trimmed),
      connectionState: "pending",
      lastVerifiedAt: null,
    })
    .onConflictDoUpdate({
      target: providerCredentials.kind,
      set: {
        ciphertext: sql`excluded.ciphertext`,
        lastFour: sql`excluded.last_four`,
        connectionState: sql`'pending'`,
        lastVerifiedAt: sql`null`,
      },
    });

  await recordAudit({ actor, action: "credential.set", target: kind });
}

export async function getCredentialPlaintext(
  kind: ProviderKind,
): Promise<string | null> {
  const rows = await db
    .select({ ciphertext: providerCredentials.ciphertext })
    .from(providerCredentials)
    .where(eq(providerCredentials.kind, kind))
    .limit(1);
  if (rows.length === 0) return null;
  return decrypt(rows[0].ciphertext);
}

export async function listCredentials(): Promise<CredentialView[]> {
  const rows = await db
    .select({
      kind: providerCredentials.kind,
      lastFour: providerCredentials.lastFour,
      connectionState: providerCredentials.connectionState,
      lastVerifiedAt: providerCredentials.lastVerifiedAt,
    })
    .from(providerCredentials);
  // Validate kind belongs to enum (defensive against drifted DB rows).
  return rows.filter((r): r is CredentialView =>
    (PROVIDER_KINDS as readonly string[]).includes(r.kind),
  );
}

export async function markVerified(
  kind: ProviderKind,
  ok: boolean,
  actor: string,
): Promise<void> {
  await db
    .update(providerCredentials)
    .set({
      connectionState: ok ? "verified" : "failed",
      lastVerifiedAt: new Date(),
    })
    .where(eq(providerCredentials.kind, kind));

  await recordAudit({
    actor,
    action: ok ? "credential.verified" : "credential.failed",
    target: kind,
  });
}

export async function deleteCredential(
  kind: ProviderKind,
  actor: string,
): Promise<void> {
  await db
    .delete(providerCredentials)
    .where(eq(providerCredentials.kind, kind));

  await recordAudit({
    actor,
    action: "credential.deleted",
    target: kind,
  });
}
