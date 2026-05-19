import { describe, expect, it } from "vitest";

import {
  buildBuildMonitorConfig,
  buildHttpMonitorConfig,
  buildMonitorConfig,
  buildWorkflowMonitorConfig,
} from "@/lib/fixbot/monitor-config";

describe("buildHttpMonitorConfig", () => {
  it("accepts a minimal valid input and defaults expectedStatus to 200", () => {
    const cfg = buildHttpMonitorConfig({
      url: "https://example.com/api/health",
    });
    expect(cfg).toEqual({
      url: "https://example.com/api/health",
      expectedStatus: 200,
    });
  });

  it("trims surrounding whitespace from the URL", () => {
    const cfg = buildHttpMonitorConfig({
      url: "   https://example.com/api  ",
    });
    expect(cfg.url).toBe("https://example.com/api");
  });

  it("includes expectedBodyContains only when set + non-empty", () => {
    expect(
      buildHttpMonitorConfig({
        url: "https://example.com/api",
        expectedBodyContains: "ok",
      }).expectedBodyContains,
    ).toBe("ok");
    expect(
      buildHttpMonitorConfig({
        url: "https://example.com/api",
        expectedBodyContains: null,
      }).expectedBodyContains,
    ).toBeUndefined();
    expect(
      buildHttpMonitorConfig({
        url: "https://example.com/api",
        expectedBodyContains: "   ",
      }).expectedBodyContains,
    ).toBeUndefined();
  });

  it("rejects URLs that don't start with http(s)://", () => {
    expect(() =>
      buildHttpMonitorConfig({ url: "example.com" }),
    ).toThrow(/http/);
    expect(() =>
      buildHttpMonitorConfig({ url: "ftp://example.com/" }),
    ).toThrow(/http/);
  });

  it("rejects empty URL", () => {
    expect(() => buildHttpMonitorConfig({ url: "" })).toThrow(/required/);
    expect(() => buildHttpMonitorConfig({ url: "   " })).toThrow(/required/);
  });

  it("rejects expectedStatus outside [100, 599]", () => {
    for (const bad of [99, 600, 1000, -1, Number.NaN, Infinity]) {
      expect(() =>
        buildHttpMonitorConfig({
          url: "https://x",
          expectedStatus: bad,
        }),
      ).toThrow(/100/);
    }
  });
});

describe("buildBuildMonitorConfig", () => {
  it("defaults inspectCount to 1", () => {
    expect(buildBuildMonitorConfig({})).toEqual({ inspectCount: 1 });
  });

  it("respects a valid override", () => {
    expect(buildBuildMonitorConfig({ inspectCount: 3 })).toEqual({
      inspectCount: 3,
    });
  });

  it("rejects inspectCount outside [1, 5]", () => {
    for (const bad of [0, -1, 6, 100, Number.NaN]) {
      expect(() =>
        buildBuildMonitorConfig({ inspectCount: bad }),
      ).toThrow(/1/);
    }
  });
});

describe("buildWorkflowMonitorConfig", () => {
  it("returns {} when both inputs are missing", () => {
    expect(buildWorkflowMonitorConfig({})).toEqual({});
  });

  it("includes only the fields that are set", () => {
    expect(
      buildWorkflowMonitorConfig({ workflowId: "deployops.yml" }),
    ).toEqual({ workflowId: "deployops.yml" });
    expect(
      buildWorkflowMonitorConfig({ branch: "main" }),
    ).toEqual({ branch: "main" });
    expect(
      buildWorkflowMonitorConfig({
        workflowId: "deployops.yml",
        branch: "main",
      }),
    ).toEqual({ workflowId: "deployops.yml", branch: "main" });
  });

  it("treats empty / whitespace strings the same as unset", () => {
    expect(buildWorkflowMonitorConfig({ workflowId: "", branch: "" })).toEqual(
      {},
    );
    expect(
      buildWorkflowMonitorConfig({ workflowId: "  ", branch: "   " }),
    ).toEqual({});
  });
});

describe("buildMonitorConfig (kind dispatch)", () => {
  it("dispatches by kind", () => {
    expect(
      buildMonitorConfig("http", { url: "https://x" }),
    ).toMatchObject({ expectedStatus: 200 });
    expect(buildMonitorConfig("build", {})).toEqual({ inspectCount: 1 });
    expect(buildMonitorConfig("workflow", {})).toEqual({});
  });

  it("returns {} for the analyzer-less kinds", () => {
    expect(buildMonitorConfig("env", {})).toEqual({});
    expect(buildMonitorConfig("domain", {})).toEqual({});
    expect(buildMonitorConfig("migration", {})).toEqual({});
  });
});
