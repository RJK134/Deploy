import { describe, expect, it } from "vitest";

import {
  classifyActionsRun,
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
