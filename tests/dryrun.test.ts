import { describe, expect, it } from "vitest";

import { getBuiltinBlueprint } from "@/lib/blueprints/builtin";
import { STAGE_KINDS } from "@/lib/pipeline/stages";
import { simulateStage } from "@/lib/runs/dryrun";
import { planRun } from "@/lib/runs/planner";

const project = {
  id: "p_test",
  slug: "rjk134/equismile",
  githubOwner: "RJK134",
  githubRepo: "EquiSmile",
  defaultBranch: "main",
};

describe("simulateStage", () => {
  it("produces non-empty log + output for every stage kind", () => {
    const blueprint = getBuiltinBlueprint("nextjs-neon")!;
    const plan = planRun({ blueprint, project, environment: "test" });
    for (const kind of STAGE_KINDS) {
      const sim = simulateStage(kind, plan);
      expect(sim.logLines.length).toBeGreaterThan(0);
      expect(sim.output).toBeTypeOf("object");
    }
  });

  it("repo.scan output echoes project metadata", () => {
    const blueprint = getBuiltinBlueprint("nextjs-neon")!;
    const plan = planRun({ blueprint, project, environment: "test" });
    const sim = simulateStage("repo.scan", plan);
    expect(sim.output).toMatchObject({
      owner: "RJK134",
      repo: "EquiSmile",
      framework: "nextjs",
      branch: "main",
    });
  });

  it("env.resolve output includes counts by source", () => {
    const blueprint = getBuiltinBlueprint("nextjs-neon")!;
    const plan = planRun({ blueprint, project, environment: "test" });
    const sim = simulateStage("env.resolve", plan);
    const counts = (sim.output as { counts: Record<string, number> }).counts;
    expect(counts.neon_url).toBe(1);
    expect(counts.static).toBe(1);
    expect(counts.github_secret).toBe(1);
    expect(counts.derived).toBe(1);
  });

  it("ci.generate produces a YAML payload with the build command", () => {
    const blueprint = getBuiltinBlueprint("nextjs-neon")!;
    const plan = planRun({ blueprint, project, environment: "test" });
    const sim = simulateStage("ci.generate", plan);
    const out = sim.output as { yaml: string; path: string };
    expect(out.path).toBe(".github/workflows/deployops.yml");
    expect(out.yaml).toContain("pnpm build");
    expect(out.yaml).toContain(plan.project.defaultBranch ?? "main");
  });

  it("deploy output exposes predicted URL", () => {
    const blueprint = getBuiltinBlueprint("nextjs-neon")!;
    const plan = planRun({ blueprint, project, environment: "demo" });
    const sim = simulateStage("deploy", plan);
    const out = sim.output as { url: string; deployHost: string };
    expect(out.url).toMatch(/^https:\/\//);
    expect(out.url).toContain("equismile-demo");
  });

  it("smoke.test references the deploy host's /api/health", () => {
    const blueprint = getBuiltinBlueprint("nextjs-neon")!;
    const plan = planRun({ blueprint, project, environment: "test" });
    const sim = simulateStage("smoke.test", plan);
    const out = sim.output as { probeUrl: string };
    expect(out.probeUrl).toMatch(/\/api\/health$/);
  });

  it("db.migrate echoes the blueprint migrate command", () => {
    const blueprint = getBuiltinBlueprint("nextjs-neon")!;
    const plan = planRun({ blueprint, project, environment: "test" });
    const sim = simulateStage("db.migrate", plan);
    const out = sim.output as { migrateCommand: string };
    expect(out.migrateCommand).toBe("pnpm db:push");
  });

  it("simulator never throws for a static blueprint with no migrate cmd", () => {
    const blueprint = getBuiltinBlueprint("nextjs-static")!;
    const plan = planRun({ blueprint, project, environment: "test" });
    for (const kind of STAGE_KINDS) {
      expect(() => simulateStage(kind, plan)).not.toThrow();
    }
  });
});
