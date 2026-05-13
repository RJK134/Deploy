import "server-only";

import { auth } from "@/lib/auth";

/**
 * Resolves the signed-in operator's email for use as the `actor` field on
 * audit_log entries. Throws if no session is present so server actions
 * never silently attribute writes to an empty actor.
 */
export async function requireActorEmail(): Promise<string> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) throw new Error("not authenticated");
  return email.toLowerCase();
}
