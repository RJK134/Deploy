import { describe, expect, it } from "vitest";

import {
  decryptWithKey,
  encryptWithKey,
  importKeyFromBase64,
} from "@/lib/crypto";

const KEY_A = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const KEY_B = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBA=";

describe("explicit-key crypto helpers (rotation building blocks)", () => {
  it("encrypts and decrypts with the same key", async () => {
    const key = await importKeyFromBase64(KEY_A);
    const plaintext = "fixture-payload-1";
    const ct = await encryptWithKey(plaintext, key);
    expect(await decryptWithKey(ct, key)).toBe(plaintext);
  });

  it("simulates rotation: encrypt with key A, decrypt with A, re-encrypt with B, decrypt with B", async () => {
    const oldKey = await importKeyFromBase64(KEY_A);
    const newKey = await importKeyFromBase64(KEY_B);
    const plaintext = "secret-pat-value-to-rotate";

    // Initial state
    const ctA = await encryptWithKey(plaintext, oldKey);
    expect(await decryptWithKey(ctA, oldKey)).toBe(plaintext);

    // Rotation step
    const decrypted = await decryptWithKey(ctA, oldKey);
    const ctB = await encryptWithKey(decrypted, newKey);

    // New state: decrypts with new key, fails with old
    expect(await decryptWithKey(ctB, newKey)).toBe(plaintext);
    await expect(decryptWithKey(ctB, oldKey)).rejects.toThrow();
  });

  it("rejects keys that don't decode to 32 bytes", async () => {
    await expect(importKeyFromBase64("AAAAAA==")).rejects.toThrow(/32 bytes/);
  });

  it("rejects non-base64 input", async () => {
    await expect(importKeyFromBase64("not base64 at all !!!")).rejects.toThrow();
  });
});
