import { describe, expect, it } from "vitest";

import {
  classifyActionsRun,
  classifyDomain,
  classifyEnvKeys,
  classifyVercelState,
} from "@/lib/fixbot/classifiers";

const DEFAULT_BUILD_FAILS = ["ERROR", "CANCELED"];
const DEFAULT_WORKFLOW_FAILS = ["failure", "timed_out", "startup_failure"];

describe("classifyVercelState", () => {
  it("returns healthy for READY", () => {
    expect(classifyVercelState("READY", DEFAULT_BUILD_FAILS).status).toBe(
      "healthy",
    );
  });

  it("returns down for ERROR (default failure list)", () => {
    expect(classifyVercelState("ERROR", DEFAULT_BUILD_FAILS).status).toBe(
      "down",
    );
  });

  it("returns down for CANCELED (default failure list)", () => {
    expect(classifyVercelState("CANCELED", DEFAULT_BUILD_FAILS).status).toBe(
      "down",
    );
  });

  it("treats BUILDING/QUEUED as transient warning, not down", () => {
    expect(classifyVercelState("BUILDING", DEFAULT_BUILD_FAILS).status).toBe(
      "warning",
    );
    expect(classifyVercelState("QUEUED", DEFAULT_BUILD_FAILS).status).toBe(
      "warning",
    );
    expect(
      classifyVercelState("INITIALIZING", DEFAULT_BUILD_FAILS).status,
    ).toBe("warning");
  });

  it("treats undefined / empty state as warning", () => {
    expect(classifyVercelState(undefined, DEFAULT_BUILD_FAILS).status).toBe(
      "warning",
    );
    expect(classifyVercelState("", DEFAULT_BUILD_FAILS).status).toBe("warning");
  });

  it("respects a custom failureStates list", () => {
    // Operator decides to treat CANCELED as merely transitional.
    expect(classifyVercelState("CANCELED", ["ERROR"]).status).toBe("warning");
    expect(classifyVercelState("ERROR", ["ERROR"]).status).toBe("down");
  });

  it("reason text includes the state", () => {
    expect(classifyVercelState("ERROR", DEFAULT_BUILD_FAILS).reason).toContain(
      "ERROR",
    );
    expect(classifyVercelState("READY", DEFAULT_BUILD_FAILS).reason).toContain(
      "READY",
    );
  });
});

describe("classifyActionsRun", () => {
  it("returns healthy when no recent runs", () => {
    expect(classifyActionsRun(undefined, DEFAULT_WORKFLOW_FAILS).status).toBe(
      "healthy",
    );
  });

  it("returns down for conclusion=failure", () => {
    expect(
      classifyActionsRun(
        { status: "completed", conclusion: "failure" },
        DEFAULT_WORKFLOW_FAILS,
      ).status,
    ).toBe("down");
  });

  it("returns down for timed_out + startup_failure (default failure list)", () => {
    for (const c of ["timed_out", "startup_failure"]) {
      expect(
        classifyActionsRun(
          { status: "completed", conclusion: c },
          DEFAULT_WORKFLOW_FAILS,
        ).status,
      ).toBe("down");
    }
  });

  it("returns healthy for conclusion=success / cancelled / skipped", () => {
    for (const c of ["success", "cancelled", "skipped", "neutral"]) {
      expect(
        classifyActionsRun(
          { status: "completed", conclusion: c },
          DEFAULT_WORKFLOW_FAILS,
        ).status,
      ).toBe("healthy");
    }
  });

  it("returns warning for in_progress / queued (not yet completed)", () => {
    expect(
      classifyActionsRun(
        { status: "in_progress", conclusion: null },
        DEFAULT_WORKFLOW_FAILS,
      ).status,
    ).toBe("warning");
    expect(
      classifyActionsRun(
        { status: "queued", conclusion: null },
        DEFAULT_WORKFLOW_FAILS,
      ).status,
    ).toBe("warning");
  });

  it("respects a custom failureConclusions list", () => {
    // Operator decides cancelled is a real failure for their workflow.
    expect(
      classifyActionsRun(
        { status: "completed", conclusion: "cancelled" },
        ["cancelled"],
      ).status,
    ).toBe("down");
    expect(
      classifyActionsRun(
        { status: "completed", conclusion: "failure" },
        ["cancelled"],
      ).status,
    ).toBe("healthy");
  });

  it("reason text includes the conclusion or status", () => {
    expect(
      classifyActionsRun(
        { status: "completed", conclusion: "failure" },
        DEFAULT_WORKFLOW_FAILS,
      ).reason,
    ).toContain("failure");
    expect(
      classifyActionsRun(
        { status: "in_progress", conclusion: null },
        DEFAULT_WORKFLOW_FAILS,
      ).reason,
    ).toContain("in_progress");
  });
});

describe("classifyEnvKeys", () => {
  it("returns healthy when every required key is present", () => {
    const result = classifyEnvKeys(
      ["DATABASE_URL", "NEXTAUTH_SECRET"],
      new Set(["DATABASE_URL", "NEXTAUTH_SECRET", "EXTRA"]),
    );
    expect(result.status).toBe("healthy");
    expect(result.missingKeys).toEqual([]);
  });

  it("returns down with the missing keys listed", () => {
    const result = classifyEnvKeys(
      ["DATABASE_URL", "NEXTAUTH_SECRET", "EXTRA"],
      new Set(["DATABASE_URL"]),
    );
    expect(result.status).toBe("down");
    expect(result.missingKeys).toEqual(["NEXTAUTH_SECRET", "EXTRA"]);
    expect(result.reason).toContain("NEXTAUTH_SECRET");
  });

  it("returns healthy on empty required list (nothing to check)", () => {
    const result = classifyEnvKeys([], new Set());
    expect(result.status).toBe("healthy");
  });

  it("singular vs plural reason text", () => {
    expect(
      classifyEnvKeys(["A"], new Set()).reason,
    ).toContain("1 env var");
    expect(
      classifyEnvKeys(["A", "B"], new Set()).reason,
    ).toContain("2 env var");
  });
});

describe("classifyDomain", () => {
  it("returns healthy when no custom domain is configured", () => {
    expect(classifyDomain(null, []).status).toBe("healthy");
    expect(classifyDomain(null, [{ name: "x.com", verified: true }]).status).toBe(
      "healthy",
    );
  });

  it("returns down when the desired domain isn't attached", () => {
    const result = classifyDomain("app.example.com", [
      { name: "other.example.com", verified: true },
    ]);
    expect(result.status).toBe("down");
    expect(result.verified).toBe(false);
    expect(result.reason).toContain("not attached");
  });

  it("returns down when the domain is attached but unverified", () => {
    const result = classifyDomain("app.example.com", [
      { name: "app.example.com", verified: false },
    ]);
    expect(result.status).toBe("down");
    expect(result.verified).toBe(false);
    expect(result.reason).toContain("verification");
  });

  it("returns healthy when the domain is attached and verified", () => {
    const result = classifyDomain("app.example.com", [
      { name: "app.example.com", verified: true },
    ]);
    expect(result.status).toBe("healthy");
    expect(result.verified).toBe(true);
  });

  it("treats missing 'verified' property as verified (Vercel sometimes omits it)", () => {
    const result = classifyDomain("app.example.com", [
      { name: "app.example.com" },
    ]);
    expect(result.status).toBe("healthy");
    expect(result.verified).toBe(true);
  });
});
