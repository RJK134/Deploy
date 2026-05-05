/**
 * Encryption-at-rest for provider tokens.
 *
 * Algorithm: AES-256-GCM with a 12-byte random IV per ciphertext.
 * Output format: base64( version(1) || iv(12) || authTag(16) || cipher(N) )
 *
 * The encryption key is derived (SHA-256) from one of:
 *   - DEPLOYOPS_SECRET_KEY (preferred)
 *   - TOKEN_ENCRYPTION_KEY (alias)
 *
 * If neither is set, `encryptionConfigured()` returns false and `encrypt()`
 * throws. The route layer surfaces this as a `setup-required` error so the
 * UI can prompt the operator to configure the key before saving real
 * secrets. Demo/mock connections do not call `encrypt()` and so work without
 * a key.
 */
import crypto from "node:crypto";

const VERSION = 0x01;
const KEY_ENV_PRIMARY = "DEPLOYOPS_SECRET_KEY";
const KEY_ENV_ALIAS = "TOKEN_ENCRYPTION_KEY";

function rawKeyFromEnv(): Buffer | null {
  const raw = (process.env[KEY_ENV_PRIMARY] ?? process.env[KEY_ENV_ALIAS] ?? "").trim();
  if (!raw) return null;
  /* Derive a 32-byte key. Allow any length input string; SHA-256 collapses it. */
  return crypto.createHash("sha256").update(raw).digest();
}

export function encryptionConfigured(): boolean {
  return rawKeyFromEnv() !== null;
}

export function encryptionKeyFingerprint(): string | null {
  const k = rawKeyFromEnv();
  if (!k) return null;
  /* Fingerprint = first 8 hex chars of SHA-256(key). Safe to log; not a secret. */
  return crypto.createHash("sha256").update(k).digest("hex").slice(0, 8);
}

export class EncryptionUnavailable extends Error {
  code = "setup-required" as const;
  constructor() {
    super(
      `Token encryption key not configured. Set ${KEY_ENV_PRIMARY} (or ${KEY_ENV_ALIAS}) to a long random string before saving real secrets.`,
    );
  }
}

export function encrypt(plaintext: string): string {
  const key = rawKeyFromEnv();
  if (!key) throw new EncryptionUnavailable();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphered = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([VERSION]), iv, tag, ciphered]).toString("base64");
}

export function decrypt(blob: string): string {
  const key = rawKeyFromEnv();
  if (!key) throw new EncryptionUnavailable();
  const buf = Buffer.from(blob, "base64");
  if (buf.length < 1 + 12 + 16) throw new Error("ciphertext too short");
  const version = buf.readUInt8(0);
  if (version !== VERSION) throw new Error(`unsupported cipher version ${version}`);
  const iv = buf.subarray(1, 13);
  const tag = buf.subarray(13, 29);
  const data = buf.subarray(29);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

/** Last 4 chars of a token, for UI display only. Returns "" for short inputs. */
export function tokenLast4(token: string): string {
  const s = (token ?? "").trim();
  if (s.length < 4) return "";
  return s.slice(-4);
}
