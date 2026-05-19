import { describe, expect, it } from "vitest";

import {
  checkApplyGate,
  isKnownAction,
  KNOWN_ACTIONS,
  mutatesProviders,
} from "@/lib/remediations/apply-gate";

describe("isKnownAction", () => {
  it("accepts every known action verb", () => {
    for (const a of KNOWN_ACTIONS) {
      expect(isKnownAction(a)).toBe(true);
    }
  });

  it("rejects unknown verbs", () => {
    expect(isKnownAction("foo.bar")).toBe(false);
    expect(isKnownAction("")).toBe(false);
    expect(isKnownAction("PROBE.RETRY")).toBe(false);
  });
});

describe("mutatesProviders", () => {
  it("classifies probe.retry and env.add as non-mutating", () => {
    expect(mutatesProviders("probe.retry")).toBe(false);
    expect(mutatesProviders("env.add")).toBe(false);
  });

  it("classifies deploy / workflow / domain as mutating", () => {
    expect(mutatesProviders("deploy.retry")).toBe(true);
    expect(mutatesProviders("workflow.rerun")).toBe(true);
    expect(mutatesProviders("domain.attach")).toBe(true);
    expect(mutatesProviders("domain.verify")).toBe(true);
  });
});

describe("checkApplyGate", () => {
  it("refuses when remediation status is not 'draft'", () => {
    for (const status of ["queued", "applied", "failed", "dismissed"]) {
      const g = checkApplyGate({
        action: "probe.retry",
        autonomy: "approval-required",
        liveModeOn: true,
        currentStatus: status,
      });
      expect(g.allowed).toBe(false);
      expect(g.reason).toContain(status);
    }
  });

  it("refuses on diagnose-only autonomy", () => {
    const g = checkApplyGate({
      action: "probe.retry",
      autonomy: "diagnose-only",
      liveModeOn: true,
      currentStatus: "draft",
    });
    expect(g.allowed).toBe(false);
    expect(g.reason).toContain("diagnose-only");
  });

  it("refuses 'apply' on approval-required (it's reserved for safe-auto-fix)", () => {
    const g = checkApplyGate({
      action: "probe.retry",
      autonomy: "approval-required",
      liveModeOn: true,
      currentStatus: "draft",
    });
    // approval-required allows queue but not apply
    expect(g.allowed).toBe(false);
    expect(g.reason).toContain("approval");
  });

  it("allows on safe-auto-fix when status is 'draft' and live is on", () => {
    const g = checkApplyGate({
      action: "deploy.retry",
      autonomy: "safe-auto-fix",
      liveModeOn: true,
      currentStatus: "draft",
    });
    expect(g.allowed).toBe(true);
  });

  it("allows non-mutating actions on safe-auto-fix even when live is off", () => {
    expect(
      checkApplyGate({
        action: "probe.retry",
        autonomy: "safe-auto-fix",
        liveModeOn: false,
        currentStatus: "draft",
      }).allowed,
    ).toBe(true);
    expect(
      checkApplyGate({
        action: "env.add",
        autonomy: "safe-auto-fix",
        liveModeOn: false,
        currentStatus: "draft",
      }).allowed,
    ).toBe(true);
  });

  it("refuses mutating actions when DEPLOYOPS_LIVE=0", () => {
    for (const action of [
      "deploy.retry",
      "workflow.rerun",
      "domain.attach",
      "domain.verify",
    ] as const) {
      const g = checkApplyGate({
        action,
        autonomy: "safe-auto-fix",
        liveModeOn: false,
        currentStatus: "draft",
      });
      expect(g.allowed).toBe(false);
      expect(g.reason).toContain("DEPLOYOPS_LIVE");
    }
  });
});
