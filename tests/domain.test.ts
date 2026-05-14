import { describe, expect, it } from "vitest";

import { normaliseCustomDomain } from "@/lib/format/domain";

describe("normaliseCustomDomain", () => {
  it("returns null for null/undefined", () => {
    expect(normaliseCustomDomain(null)).toBeNull();
    expect(normaliseCustomDomain(undefined)).toBeNull();
  });

  it("returns null for empty / whitespace-only strings", () => {
    expect(normaliseCustomDomain("")).toBeNull();
    expect(normaliseCustomDomain("   ")).toBeNull();
    expect(normaliseCustomDomain("\t\n")).toBeNull();
  });

  it("lowercases and trims valid hostnames", () => {
    expect(normaliseCustomDomain("APP.Example.com")).toBe("app.example.com");
    expect(normaliseCustomDomain("  studio.deploy.dev  ")).toBe(
      "studio.deploy.dev",
    );
  });

  it("rejects hostnames missing a TLD", () => {
    expect(() => normaliseCustomDomain("localhost")).toThrow(/bare hostname/);
    expect(() => normaliseCustomDomain("app")).toThrow();
  });

  it("rejects URLs with protocol or path", () => {
    expect(() => normaliseCustomDomain("https://app.example.com")).toThrow();
    expect(() => normaliseCustomDomain("app.example.com/path")).toThrow();
    expect(() => normaliseCustomDomain("app.example.com:443")).toThrow();
  });

  it("rejects hostnames with whitespace or shell metacharacters", () => {
    expect(() => normaliseCustomDomain("foo bar.com")).toThrow();
    expect(() => normaliseCustomDomain("$(whoami).com")).toThrow();
    expect(() => normaliseCustomDomain("app;rm -rf /.com")).toThrow();
  });

  it("rejects hostnames longer than 253 chars", () => {
    const long = "a".repeat(254) + ".com";
    expect(() => normaliseCustomDomain(long)).toThrow(/253/);
  });

  it("accepts multi-level subdomains", () => {
    expect(normaliseCustomDomain("preview-pr-12.deploy.example.org")).toBe(
      "preview-pr-12.deploy.example.org",
    );
  });
});
