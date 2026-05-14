/**
 * Constant-time HMAC-SHA256 verification using Web Crypto so the same module
 * works in the Edge runtime if a webhook route is ever moved off Node.
 *
 * The signature header is expected to look like 'sha256=<hex>' (GitHub) or
 * just '<hex>' (Vercel). Whitespace, prefix, and case are normalised.
 */

const ENCODER = new TextEncoder();

function hexToBytes(hex: string): Uint8Array | null {
  const cleaned = hex.replace(/^sha256=/i, "").trim();
  if (cleaned.length === 0 || cleaned.length % 2 !== 0) return null;
  if (!/^[0-9a-f]+$/i.test(cleaned)) return null;
  const out = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < cleaned.length; i += 2) {
    out[i / 2] = parseInt(cleaned.slice(i, i + 2), 16);
  }
  return out;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

export async function verifyHmacSha256(args: {
  body: string;
  signatureHeader: string | null | undefined;
  secret: string;
}): Promise<boolean> {
  if (!args.signatureHeader || !args.secret) return false;
  const claimed = hexToBytes(args.signatureHeader);
  if (!claimed) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    ENCODER.encode(args.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, ENCODER.encode(args.body)),
  );
  return constantTimeEqual(expected, claimed);
}

/** Compute the hex-encoded HMAC-SHA256 signature of body with the given secret. */
export async function computeHmacSha256Hex(args: {
  body: string;
  secret: string;
}): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    ENCODER.encode(args.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, ENCODER.encode(args.body)),
  );
  return Array.from(sig)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
