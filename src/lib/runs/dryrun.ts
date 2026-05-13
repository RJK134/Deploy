import type { StageKind } from "@/lib/pipeline/stages";

import type { RunPlan } from "./planner";

export interface StageSimulation {
  logLines: string[];
  output: Record<string, unknown>;
}

function ciWorkflowYaml(plan: RunPlan): string {
  const branch =
    plan.project.defaultBranch ?? "main";
  return [
    "name: DeployOps · ${{ matrix.env }}",
    "",
    "on:",
    "  push:",
    `    branches: [${branch}]`,
    "",
    "jobs:",
    "  deploy:",
    "    runs-on: ubuntu-latest",
    "    strategy:",
    `      matrix:`,
    `        env: [${plan.environment}]`,
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - uses: pnpm/action-setup@v4",
    "      - uses: actions/setup-node@v4",
    `        with: { node-version: '20', cache: 'pnpm' }`,
    `      - run: ${plan.commands.install ?? "pnpm install --frozen-lockfile"}`,
    `      - run: ${plan.commands.build ?? "pnpm build"}`,
    plan.commands.migrate
      ? `      - run: ${plan.commands.migrate}`
      : "      # no migration step for this blueprint",
    "      - run: npx vercel deploy --prod --token $VERCEL_TOKEN",
  ].join("\n");
}

export function simulateStage(
  kind: StageKind,
  plan: RunPlan,
): StageSimulation {
  switch (kind) {
    case "repo.scan":
      return {
        logLines: [
          `Cloning shallow ${plan.project.githubOwner}/${plan.project.githubRepo}…`,
          `Detected framework: ${plan.framework}.`,
          `Default branch: ${plan.project.defaultBranch ?? "main"}.`,
          "Read package.json scripts. OK.",
        ],
        output: {
          owner: plan.project.githubOwner,
          repo: plan.project.githubRepo,
          framework: plan.framework,
          branch: plan.project.defaultBranch ?? "main",
        },
      };
    case "env.resolve": {
      const counts = plan.envVars.reduce<Record<string, number>>(
        (acc, v) => {
          acc[v.source] = (acc[v.source] ?? 0) + 1;
          return acc;
        },
        {},
      );
      return {
        logLines: [
          `Resolving ${plan.envVars.length} env var${plan.envVars.length === 1 ? "" : "s"}…`,
          ...plan.envVars.map(
            (v) =>
              `  ${v.key} = <${v.source}>${v.value ? " ✓ resolved" : " · deferred"}`,
          ),
          `Sources: ${Object.entries(counts)
            .map(([k, n]) => `${k}=${n}`)
            .join(", ")}`,
        ],
        output: { envVars: plan.envVars, counts },
      };
    }
    case "db.provision":
      return {
        logLines: [
          `Would call Neon API: create branch '${plan.predicted.branchName}'.`,
          "Would assign role 'deployops_app' with read/write on the branch's default DB.",
          `Pooled URL would be returned to subsequent stages.`,
          "(dry-run: no Neon API call made)",
        ],
        output: {
          branchName: plan.predicted.branchName,
          pooledUrlPlaceholder: `postgres://…@ep-deployops-pooler.neon.tech/${plan.predicted.branchName}`,
        },
      };
    case "db.migrate":
      return {
        logLines: [
          `$ ${plan.commands.migrate ?? "pnpm db:push"}`,
          "Would apply pending migrations against the freshly provisioned branch.",
          "(dry-run: no migrations actually run)",
        ],
        output: { migrateCommand: plan.commands.migrate ?? "pnpm db:push" },
      };
    case "ci.generate":
      return {
        logLines: [
          "Generating .github/workflows/deployops.yml…",
          "Workflow body included in stage output.",
        ],
        output: {
          path: ".github/workflows/deployops.yml",
          yaml: ciWorkflowYaml(plan),
        },
      };
    case "deploy":
      return {
        logLines: [
          `Would call Vercel API: deploy ${plan.project.slug}@${plan.project.defaultBranch ?? "main"} with preset '${plan.framework}'.`,
          `Predicted deployment URL: https://${plan.predicted.deployHost}`,
          "(dry-run: no deployment created)",
        ],
        output: {
          deployHost: plan.predicted.deployHost,
          url: `https://${plan.predicted.deployHost}`,
          preset: plan.framework,
        },
      };
    case "domain.attach":
      return {
        logLines: [
          "No custom domain configured for this environment.",
          "Would skip in live mode too.",
        ],
        output: { attached: false, reason: "no custom domain configured" },
      };
    case "smoke.test":
      return {
        logLines: [
          `Would GET https://${plan.predicted.deployHost}/api/health`,
          "Expected 200 with {\"ok\":true,…} payload.",
          "(dry-run: no HTTP request made)",
        ],
        output: {
          probeUrl: `https://${plan.predicted.deployHost}/api/health`,
          expected: 200,
        },
      };
  }
}
