import { describe, expect, it } from "vitest";

import { decrypt, encrypt } from "@/lib/crypto";

describe("crypto AES-256-GCM", () => {
  it("is non-deterministic — fresh IV per encrypt call", async () => {
    const a = await encrypt("token-abc");
    const b = await encrypt("token-abc");
    expect(a).not.toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it("round-trips ASCII", async () => {
    const plain = "ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
    expect(await decrypt(await encrypt(plain))).toEqual(plain);
  });

  it("round-trips Unicode", async () => {
    const plain = "secret-é-中文-🔑-${var}-\"quote\"";
    expect(await decrypt(await encrypt(plain))).toEqual(plain);
  });

  it("round-trips a 4 KB random string", async () => {
    const bytes = crypto.getRandomValues(new Uint8Array(4096));
    const plain = Array.from(bytes, (b) =>
      String.fromCharCode(33 + (b % 90)),
    ).join("");
    expect(plain.length).toBe(4096);
    expect(await decrypt(await encrypt(plain))).toEqual(plain);
  });

  it("rejects ciphertext with a flipped byte in the tag region", async () => {
    const ct = await encrypt("payload");
    const bytes = Uint8Array.from(atob(ct), (c) => c.charCodeAt(0));
    // Flip a bit in the last byte (auth tag region).
    bytes[bytes.length - 1] ^= 0x01;
    let binary = "";
    for (let i = 0; i < bytes.length; i++)
      binary += String.fromCharCode(bytes[i]);
    const mutated = btoa(binary);
    await expect(decrypt(mutated)).rejects.toThrow();
  });

  it("rejects ciphertext truncated to just the IV", async () => {
    const ct = await encrypt("payload");
    const bytes = Uint8Array.from(atob(ct), (c) => c.charCodeAt(0));
    const truncated = bytes.slice(0, 12); // IV only, no ciphertext+tag
    let binary = "";
    for (let i = 0; i < truncated.length; i++)
      binary += String.fromCharCode(truncated[i]);
    const value = btoa(binary);
    await expect(decrypt(value)).rejects.toThrow();
  });
});
