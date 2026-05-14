import { describe, expect, it } from "vitest";

import { canRunRemediationAction } from "@/lib/fixbot/autonomy";

describe("canRunRemediationAction", () => {
  it("diagnose-only allows diagnose, blocks everything else", () => {
    expect(canRunRemediationAction("diagnose-only", "diagnose").allowed).toBe(true);
    expect(canRunRemediationAction("diagnose-only", "prepare").allowed).toBe(false);
    expect(canRunRemediationAction("diagnose-only", "queue").allowed).toBe(false);
    expect(canRunRemediationAction("diagnose-only", "apply").allowed).toBe(false);
  });

  it("prepare-fix allows diagnose + prepare", () => {
    expect(canRunRemediationAction("prepare-fix", "diagnose").allowed).toBe(true);
    expect(canRunRemediationAction("prepare-fix", "prepare").allowed).toBe(true);
    expect(canRunRemediationAction("prepare-fix", "queue").allowed).toBe(false);
    expect(canRunRemediationAction("prepare-fix", "apply").allowed).toBe(false);
  });

  it("approval-required allows queue but blocks apply", () => {
    expect(canRunRemediationAction("approval-required", "diagnose").allowed).toBe(true);
    expect(canRunRemediationAction("approval-required", "prepare").allowed).toBe(true);
    expect(canRunRemediationAction("approval-required", "queue").allowed).toBe(true);
    expect(canRunRemediationAction("approval-required", "apply").allowed).toBe(false);
  });

  it("safe-auto-fix allows all four", () => {
    expect(canRunRemediationAction("safe-auto-fix", "diagnose").allowed).toBe(true);
    expect(canRunRemediationAction("safe-auto-fix", "prepare").allowed).toBe(true);
    expect(canRunRemediationAction("safe-auto-fix", "queue").allowed).toBe(true);
    expect(canRunRemediationAction("safe-auto-fix", "apply").allowed).toBe(true);
  });

  it("non-allowed decisions always include a human-readable reason", () => {
    expect(
      canRunRemediationAction("diagnose-only", "apply").reason,
    ).toContain("diagnose-only");
    expect(
      canRunRemediationAction("prepare-fix", "apply").reason,
    ).toContain("prepare-fix");
    expect(
      canRunRemediationAction("approval-required", "apply").reason,
    ).toContain("approval");
  });
});
