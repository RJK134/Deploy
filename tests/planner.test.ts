import { describe, expect, it } from "vitest";

import { getBuiltinBlueprint } from "@/lib/blueprints/builtin";
import { isRunPlan, planRun } from "@/lib/runs/planner";

const project = {
  id: "p_test",
  slug: "rjk134/herm-platform",
  githubOwner: "RJK134",
  githubRepo: "herm-platform",
  defaultBranch: "main",
};

describe("planRun", () => {
  it("returns a plan validating as RunPlan", () => {
    const blueprint = getBuiltinBlueprint("nextjs-neon")!;
    const plan = planRun({ blueprint, project, environment: "test" });
    expect(isRunPlan(plan)).toBe(true);
  });

  it("predicts branch name and host from project + environment", () => {
    const blueprint = getBuiltinBlueprint("nextjs-neon")!;
    const plan = planRun({ blueprint, project, environment: "demo" });
    expect(plan.predicted.branchName).toBe("demo-herm-platform");
    expect(plan.predicted.deployHost).toBe("herm-platform-demo.vercel.app");
  });

  it("materialises one PlannedStage per blueprint stage", () => {
    const blueprint = getBuiltinBlueprint("nextjs-neon")!;
    const plan = planRun({ blueprint, project, environment: "test" });
    expect(plan.stages).toHaveLength(blueprint.stages.length);
    expect(plan.stages[0].sequence).toBe(1);
    expect(plan.stages[plan.stages.length - 1].sequence).toBe(
      blueprint.stages.length,
    );
  });

  it("propagates defaultSkip on stages", () => {
    const blueprint = getBuiltinBlueprint("nextjs-static")!;
    const plan = planRun({ blueprint, project, environment: "test" });
    const skippedKinds = plan.stages.filter((s) => s.skipped).map((s) => s.kind);
    expect(skippedKinds).toEqual(["db.provision", "db.migrate"]);
  });

  it("resolves neon_url env vars against the predicted branch", () => {
    const blueprint = getBuiltinBlueprint("nextjs-neon")!;
    const plan = planRun({ blueprint, project, environment: "deploy" });
    const dbUrl = plan.envVars.find((v) => v.key === "DATABASE_URL");
    expect(dbUrl?.source).toBe("neon_url");
    expect(dbUrl?.value).toContain("deploy-herm-platform");
  });

  it("resolves static env vars to their declared value", () => {
    const blueprint = getBuiltinBlueprint("nextjs-neon")!;
    const plan = planRun({ blueprint, project, environment: "test" });
    const nodeEnv = plan.envVars.find((v) => v.key === "NODE_ENV");
    expect(nodeEnv?.value).toBe("production");
  });

  it("derived env vars use the predicted deploy host", () => {
    const blueprint = getBuiltinBlueprint("nextjs-neon")!;
    const plan = planRun({ blueprint, project, environment: "test" });
    const url = plan.envVars.find((v) => v.key === "NEXTAUTH_URL");
    expect(url?.source).toBe("derived");
    expect(url?.value).toBe("https://herm-platform-test.vercel.app");
  });

  it("github_secret env vars are deferred (value=null)", () => {
    const blueprint = getBuiltinBlueprint("nextjs-neon")!;
    const plan = planRun({ blueprint, project, environment: "test" });
    const secret = plan.envVars.find((v) => v.key === "NEXTAUTH_SECRET");
    expect(secret?.source).toBe("github_secret");
    expect(secret?.value).toBeNull();
  });

  it("isRunPlan rejects garbage", () => {
    expect(isRunPlan(null)).toBe(false);
    expect(isRunPlan({})).toBe(false);
    expect(isRunPlan({ blueprintSlug: "x" })).toBe(false);
  });
});
