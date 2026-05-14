/**
 * Constant-time HMAC verification using Web Crypto so the same module works
 * in the Edge runtime if a webhook route is ever moved off Node.
 *
 * Supports SHA-1 (for legacy providers like Vercel's default webhook signing)
 * and SHA-256 (for GitHub and modern integrations). Algorithm is explicit at
 * the call site so the route author has to acknowledge what the provider
 * sends.
 *
 * The signature header is expected to look like 'sha256=<hex>' / 'sha1=<hex>'
 * or just '<hex>'. Whitespace, prefix, and case are normalised before the
 * constant-time compare.
 */

export type HmacAlgorithm = "sha-1" | "sha-256";

const ALG_HEADER_PREFIXES: Record<HmacAlgorithm, RegExp> = {
  "sha-1": /^sha1=/i,
  "sha-256": /^sha256=/i,
};

const ENCODER = new TextEncoder();

function hexToBytes(hex: string): Uint8Array | null {
  let cleaned = hex.trim();
  for (const re of Object.values(ALG_HEADER_PREFIXES)) {
    cleaned = cleaned.replace(re, "");
  }
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

async function importHmacKey(
  algorithm: HmacAlgorithm,
  secret: string,
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    ENCODER.encode(secret),
    { name: "HMAC", hash: algorithm === "sha-1" ? "SHA-1" : "SHA-256" },
    false,
    ["sign"],
  );
}

export async function verifyHmac(args: {
  algorithm: HmacAlgorithm;
  body: string;
  signatureHeader: string | null | undefined;
  secret: string;
}): Promise<boolean> {
  if (!args.signatureHeader || !args.secret) return false;
  const claimed = hexToBytes(args.signatureHeader);
  if (!claimed) return false;
  const expectedHexLength = args.algorithm === "sha-1" ? 40 : 64;
  if (claimed.length * 2 !== expectedHexLength) return false;
  const key = await importHmacKey(args.algorithm, args.secret);
  const expected = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, ENCODER.encode(args.body)),
  );
  return constantTimeEqual(expected, claimed);
}

/** Compute the hex-encoded HMAC signature of body with the given secret. */
export async function computeHmacHex(args: {
  algorithm: HmacAlgorithm;
  body: string;
  secret: string;
}): Promise<string> {
  const key = await importHmacKey(args.algorithm, args.secret);
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, ENCODER.encode(args.body)),
  );
  return Array.from(sig)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Backwards-compat aliases used by tests and the GitHub route.
export const verifyHmacSha256 = (args: {
  body: string;
  signatureHeader: string | null | undefined;
  secret: string;
}) => verifyHmac({ ...args, algorithm: "sha-256" });

export const computeHmacSha256Hex = (args: {
  body: string;
  secret: string;
}) => computeHmacHex({ ...args, algorithm: "sha-256" });
