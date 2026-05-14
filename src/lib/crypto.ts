import { env } from "@/lib/env";

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();
const IV_BYTES = 12;
const KEY_BYTES = 32;

let cachedKey: Promise<CryptoKey> | null = null;

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function getKey(): Promise<CryptoKey> {
  if (!cachedKey) {
    cachedKey = (async () => {
      const raw = base64ToBytes(env.ENCRYPTION_KEY);
      if (raw.length !== KEY_BYTES) {
        throw new Error(
          `ENCRYPTION_KEY must decode to exactly ${KEY_BYTES} bytes (got ${raw.length})`,
        );
      }
      return crypto.subtle.importKey(
        "raw",
        raw,
        { name: "AES-GCM" },
        false,
        ["encrypt", "decrypt"],
      );
    })();
  }
  return cachedKey;
}

export async function encrypt(plaintext: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ctBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    TEXT_ENCODER.encode(plaintext),
  );
  const ct = new Uint8Array(ctBuf);
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return bytesToBase64(out);
}

export async function decrypt(ciphertext: string): Promise<string> {
  const key = await getKey();
  const all = base64ToBytes(ciphertext);
  if (all.length <= IV_BYTES) {
    throw new Error("ciphertext too short");
  }
  const iv = all.slice(0, IV_BYTES);
  const ct = all.slice(IV_BYTES);
  const ptBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ct,
  );
  return TEXT_DECODER.decode(ptBuf);
}

/**
 * Import a base64-encoded 32-byte key for explicit-key crypto operations
 * (currently only used by the rotation helper).
 */
export async function importKeyFromBase64(base64: string): Promise<CryptoKey> {
  const raw = base64ToBytes(base64);
  if (raw.length !== KEY_BYTES) {
    throw new Error(
      `key must decode to exactly ${KEY_BYTES} bytes (got ${raw.length})`,
    );
  }
  return crypto.subtle.importKey(
    "raw",
    raw,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptWithKey(
  plaintext: string,
  key: CryptoKey,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ctBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    TEXT_ENCODER.encode(plaintext),
  );
  const ct = new Uint8Array(ctBuf);
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return bytesToBase64(out);
}

export async function decryptWithKey(
  ciphertext: string,
  key: CryptoKey,
): Promise<string> {
  const all = base64ToBytes(ciphertext);
  if (all.length <= IV_BYTES) {
    throw new Error("ciphertext too short");
  }
  const iv = all.slice(0, IV_BYTES);
  const ct = all.slice(IV_BYTES);
  const ptBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ct,
  );
  return TEXT_DECODER.decode(ptBuf);
}
