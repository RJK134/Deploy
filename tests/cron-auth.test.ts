import { describe, expect, it } from "vitest";

/**
 * Standalone reimplementation of the constant-time auth check in
 * src/app/api/cron/monitors/route.ts. Keep them in sync. The route handler
 * itself can't be imported here because it pulls in DB + env modules.
 */
function checkAuth(
  authHeader: string | null | undefined,
  secret: string | undefined,
): { ok: boolean; reason?: string } {
  if (!secret) return { ok: false, reason: "CRON_SECRET not configured" };
  const auth = authHeader ?? "";
  const expected = `Bearer ${secret}`;
  if (auth.length !== expected.length) return { ok: false, reason: "auth-mismatch" };
  let diff = 0;
  for (let i = 0; i < auth.length; i++) {
    diff |= auth.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  if (diff !== 0) return { ok: false, reason: "auth-mismatch" };
  return { ok: true };
}

const SECRET = "test-cron-secret-32-bytes-base64";

describe("cron route auth check", () => {
  it("accepts the exact expected Authorization header", () => {
    expect(checkAuth(`Bearer ${SECRET}`, SECRET).ok).toBe(true);
  });

  it("rejects a missing header", () => {
    expect(checkAuth(null, SECRET).ok).toBe(false);
    expect(checkAuth(undefined, SECRET).ok).toBe(false);
    expect(checkAuth("", SECRET).ok).toBe(false);
  });

  it("rejects a header with the wrong secret", () => {
    expect(checkAuth(`Bearer ${SECRET}-X`, SECRET).ok).toBe(false);
    expect(checkAuth(`Bearer ${SECRET.slice(0, -1)}`, SECRET).ok).toBe(false);
  });

  it("rejects a header missing the Bearer prefix", () => {
    expect(checkAuth(SECRET, SECRET).ok).toBe(false);
  });

  it("rejects when the env secret is unset", () => {
    expect(checkAuth(`Bearer ${SECRET}`, undefined).ok).toBe(false);
    expect(checkAuth(`Bearer ${SECRET}`, "").ok).toBe(false);
  });

  it("rejects a header with a different scheme", () => {
    expect(checkAuth(`Basic ${SECRET}`, SECRET).ok).toBe(false);
    expect(checkAuth(`Token ${SECRET}`, SECRET).ok).toBe(false);
  });
});
