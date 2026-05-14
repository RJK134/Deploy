import "server-only";

import { db } from "@/lib/db/client";
import { recordAudit } from "@/lib/db/audit";
import {
  decryptWithKey,
  encryptWithKey,
  importKeyFromBase64,
} from "@/lib/crypto";
import { providerCredentials } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export interface RotateOptions {
  oldKeyBase64: string;
  newKeyBase64: string;
  /** When true, decrypt with old + re-encrypt with new + write back. When false, just verify the old key decrypts every row. */
  apply: boolean;
  /** Email of the operator initiating the rotation; written to audit_log. */
  actor: string;
}

export interface RotateResult {
  scanned: number;
  succeeded: number;
  failed: number;
  applied: boolean;
  failedKinds: string[];
}

/**
 * Re-encrypt every provider_credentials row from the old key to the new key.
 * With `apply: false`, the function still decrypts every ciphertext to confirm
 * the old key is correct, but never writes — surfaces problems before mutating.
 *
 * The function does NOT touch env state. The operator is responsible for:
 *   1. Setting ENCRYPTION_KEY_NEXT to the new key.
 *   2. Calling rotateEncryptionKey({apply:false}) to dry-run.
 *   3. Calling rotateEncryptionKey({apply:true}) to commit.
 *   4. Promoting ENCRYPTION_KEY_NEXT to ENCRYPTION_KEY and redeploying.
 *   5. Removing ENCRYPTION_KEY_NEXT.
 */
export async function rotateEncryptionKey(
  opts: RotateOptions,
): Promise<RotateResult> {
  if (opts.oldKeyBase64 === opts.newKeyBase64) {
    throw new Error("old and new key are identical; refusing to rotate");
  }
  const [oldKey, newKey] = await Promise.all([
    importKeyFromBase64(opts.oldKeyBase64),
    importKeyFromBase64(opts.newKeyBase64),
  ]);

  const rows = await db
    .select({
      id: providerCredentials.id,
      kind: providerCredentials.kind,
      ciphertext: providerCredentials.ciphertext,
    })
    .from(providerCredentials);

  let succeeded = 0;
  let failed = 0;
  const failedKinds: string[] = [];

  for (const row of rows) {
    try {
      const plaintext = await decryptWithKey(row.ciphertext, oldKey);
      if (opts.apply) {
        const reencrypted = await encryptWithKey(plaintext, newKey);
        await db
          .update(providerCredentials)
          .set({ ciphertext: reencrypted })
          .where(eq(providerCredentials.id, row.id));
      }
      succeeded++;
    } catch {
      failed++;
      failedKinds.push(row.kind);
    }
  }

  await recordAudit({
    actor: opts.actor,
    action: opts.apply ? "encryption.rotated" : "encryption.rotation.dryrun",
    target: null,
    metadata: {
      scanned: rows.length,
      succeeded,
      failed,
      applied: opts.apply,
      failedKinds: failedKinds.length > 0 ? failedKinds : undefined,
    },
  });

  return {
    scanned: rows.length,
    succeeded,
    failed,
    applied: opts.apply,
    failedKinds,
  };
}
