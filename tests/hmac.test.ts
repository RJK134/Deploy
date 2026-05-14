import { describe, expect, it } from "vitest";

import {
  computeHmacSha256Hex,
  verifyHmacSha256,
} from "@/lib/webhooks/hmac";

const SECRET = "test-secret-min-8-chars";

describe("verifyHmacSha256", () => {
  it("accepts a freshly computed signature", async () => {
    const body = '{"action":"opened","number":1}';
    const sig = await computeHmacSha256Hex({ body, secret: SECRET });
    expect(
      await verifyHmacSha256({
        body,
        signatureHeader: `sha256=${sig}`,
        secret: SECRET,
      }),
    ).toBe(true);
  });

  it("accepts a bare hex signature without the sha256= prefix", async () => {
    const body = "hello world";
    const sig = await computeHmacSha256Hex({ body, secret: SECRET });
    expect(
      await verifyHmacSha256({
        body,
        signatureHeader: sig,
        secret: SECRET,
      }),
    ).toBe(true);
  });

  it("is case-insensitive on the prefix", async () => {
    const body = "x";
    const sig = await computeHmacSha256Hex({ body, secret: SECRET });
    expect(
      await verifyHmacSha256({
        body,
        signatureHeader: `SHA256=${sig.toUpperCase()}`,
        secret: SECRET,
      }),
    ).toBe(true);
  });

  it("rejects a flipped byte in the signature", async () => {
    const body = "payload";
    const sig = await computeHmacSha256Hex({ body, secret: SECRET });
    const flipped = sig.slice(0, -1) + (sig.endsWith("0") ? "1" : "0");
    expect(
      await verifyHmacSha256({
        body,
        signatureHeader: `sha256=${flipped}`,
        secret: SECRET,
      }),
    ).toBe(false);
  });

  it("rejects a signature computed with the wrong secret", async () => {
    const body = "payload";
    const sig = await computeHmacSha256Hex({ body, secret: "other-secret" });
    expect(
      await verifyHmacSha256({
        body,
        signatureHeader: `sha256=${sig}`,
        secret: SECRET,
      }),
    ).toBe(false);
  });

  it("rejects when the body is tampered with", async () => {
    const body = "original";
    const sig = await computeHmacSha256Hex({ body, secret: SECRET });
    expect(
      await verifyHmacSha256({
        body: "original-tampered",
        signatureHeader: `sha256=${sig}`,
        secret: SECRET,
      }),
    ).toBe(false);
  });

  it("rejects null / empty / malformed signatures", async () => {
    const body = "x";
    expect(
      await verifyHmacSha256({
        body,
        signatureHeader: null,
        secret: SECRET,
      }),
    ).toBe(false);
    expect(
      await verifyHmacSha256({
        body,
        signatureHeader: "",
        secret: SECRET,
      }),
    ).toBe(false);
    expect(
      await verifyHmacSha256({
        body,
        signatureHeader: "sha256=notvalidhex",
        secret: SECRET,
      }),
    ).toBe(false);
    expect(
      await verifyHmacSha256({
        body,
        signatureHeader: "sha256=abc",
        secret: SECRET,
      }),
    ).toBe(false);
  });

  it("rejects when secret is empty", async () => {
    const body = "x";
    const sig = await computeHmacSha256Hex({ body, secret: SECRET });
    expect(
      await verifyHmacSha256({
        body,
        signatureHeader: `sha256=${sig}`,
        secret: "",
      }),
    ).toBe(false);
  });
});
