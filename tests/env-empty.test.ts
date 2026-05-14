import { describe, expect, it } from "vitest";
import { z } from "zod";

/**
 * The env validator (src/lib/env.ts) parses process.env at module-load time
 * and throws on bad input. We can't easily re-import it with different env
 * values in vitest, but we CAN test the small helper used internally —
 * `emptyAsUndefined` — by reconstructing it here. Keep the implementation in
 * sync with env.ts.
 */
function emptyAsUndefined<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    schema.optional(),
  );
}

describe("emptyAsUndefined preprocessor", () => {
  it("treats empty string as undefined for an optional string", () => {
    const schema = emptyAsUndefined(z.string().min(8));
    expect(schema.parse("")).toBeUndefined();
    expect(schema.parse("   ")).toBeUndefined();
    expect(schema.parse(undefined)).toBeUndefined();
  });

  it("passes non-empty strings through for normal validation", () => {
    const schema = emptyAsUndefined(z.string().min(8));
    expect(schema.parse("a-real-secret")).toBe("a-real-secret");
  });

  it("still surfaces validation errors on short non-empty input", () => {
    const schema = emptyAsUndefined(z.string().min(8));
    expect(() => schema.parse("short")).toThrow();
  });

  it("works with refined / base64 schemas (mirror ENCRYPTION_KEY_NEXT)", () => {
    const base64Thirty = z
      .string()
      .min(1)
      .refine((v) => {
        try {
          return atob(v).length === 32;
        } catch {
          return false;
        }
      });
    const schema = emptyAsUndefined(base64Thirty);
    expect(schema.parse("")).toBeUndefined();
    const valid = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    expect(schema.parse(valid)).toBe(valid);
    expect(() => schema.parse("not-base64")).toThrow();
  });
});
