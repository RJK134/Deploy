import { describe, expect, it } from "vitest";

import {
  summariseReadiness,
  type CheckResult,
} from "@/lib/readiness/summary";

function check(
  id: string,
  status: "ok" | "warn" | "fail",
): CheckResult {
  return { id, label: id, status, detail: "" };
}

describe("summariseReadiness", () => {
  it("returns zero counts on empty input", () => {
    expect(summariseReadiness([])).toEqual({
      ok: 0,
      warn: 0,
      fail: 0,
      blocking: false,
    });
  });

  it("counts statuses correctly", () => {
    const result = summariseReadiness([
      check("a", "ok"),
      check("b", "warn"),
      check("c", "ok"),
      check("d", "fail"),
      check("e", "warn"),
    ]);
    expect(result).toEqual({ ok: 2, warn: 2, fail: 1, blocking: true });
  });

  it("is non-blocking when only OK + warn", () => {
    const result = summariseReadiness([
      check("a", "ok"),
      check("b", "warn"),
    ]);
    expect(result.blocking).toBe(false);
  });

  it("is blocking with even a single fail", () => {
    expect(summariseReadiness([check("a", "fail")]).blocking).toBe(true);
    expect(
      summariseReadiness([check("a", "ok"), check("b", "fail")]).blocking,
    ).toBe(true);
  });
});
