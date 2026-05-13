import { describe, expect, it } from "vitest";

import {
  BUILTIN_BLUEPRINTS,
  getBuiltinBlueprint,
} from "@/lib/blueprints/builtin";
import { isBlueprintDefinition } from "@/lib/blueprints/types";
import { STAGE_KINDS } from "@/lib/pipeline/stages";

describe("built-in blueprints", () => {
  it("exposes three built-ins with unique slugs", () => {
    expect(BUILTIN_BLUEPRINTS).toHaveLength(3);
    const slugs = BUILTIN_BLUEPRINTS.map((b) => b.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs).toEqual(
      expect.arrayContaining(["nextjs-neon", "nextjs-static", "node-api"]),
    );
  });

  it("each blueprint declares every pipeline stage in order", () => {
    for (const bp of BUILTIN_BLUEPRINTS) {
      expect(bp.stages.map((s) => s.kind)).toEqual([...STAGE_KINDS]);
    }
  });

  it("each blueprint validates as a BlueprintDefinition", () => {
    for (const bp of BUILTIN_BLUEPRINTS) {
      expect(isBlueprintDefinition(bp)).toBe(true);
    }
  });

  it("nextjs-static skips db stages", () => {
    const bp = getBuiltinBlueprint("nextjs-static");
    expect(bp).toBeDefined();
    const skipped = bp!.stages
      .filter((s) => s.defaultSkip)
      .map((s) => s.kind);
    expect(skipped).toEqual(["db.provision", "db.migrate"]);
  });

  it("node-api skips domain.attach by default", () => {
    const bp = getBuiltinBlueprint("node-api");
    expect(bp).toBeDefined();
    expect(
      bp!.stages.find((s) => s.kind === "domain.attach")?.defaultSkip,
    ).toBe(true);
  });

  it("getBuiltinBlueprint returns undefined for unknown slug", () => {
    expect(getBuiltinBlueprint("does-not-exist")).toBeUndefined();
  });

  it("isBlueprintDefinition rejects junk", () => {
    expect(isBlueprintDefinition(null)).toBe(false);
    expect(isBlueprintDefinition({})).toBe(false);
    expect(isBlueprintDefinition({ slug: "x" })).toBe(false);
  });
});
