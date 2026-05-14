import { probeJson } from "@/lib/providers/probe";

import type { LiveStageContext, StageOutcome } from "./types";

const GH_HEADERS = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "deployops-console",
});

export async function liveRepoScan(
  ctx: LiveStageContext,
): Promise<StageOutcome> {
  const { plan } = ctx;
  const res = await probeJson(
    `https://api.github.com/repos/${encodeURIComponent(plan.project.githubOwner)}/${encodeURIComponent(plan.project.githubRepo)}`,
    { headers: GH_HEADERS(ctx.credentials.github) },
  );
  if (!res.ok) {
    return {
      status: "failed",
      logLines: [
        `GET /repos/${plan.project.githubOwner}/${plan.project.githubRepo} failed: ${res.message}`,
      ],
      output: { status: res.status },
      error: { provider: "github", message: res.message },
    };
  }
  const detail = res.detail ?? {};
  return {
    status: "succeeded",
    logLines: [
      `Authenticated to GitHub as the stored PAT.`,
      `Repo ${plan.project.slug} is reachable.`,
      `Default branch: ${detail.default_branch ?? "(unknown)"}.`,
      `Visibility: ${detail.private ? "private" : "public"}.`,
    ],
    output: {
      owner: plan.project.githubOwner,
      repo: plan.project.githubRepo,
      defaultBranch: detail.default_branch ?? null,
      isPrivate: Boolean(detail.private),
      htmlUrl:
        typeof detail.html_url === "string" ? detail.html_url : null,
    },
  };
}

/**
 * Build the CI workflow YAML that ci.generate would commit. We emit the YAML
 * in stage output and document the next operator step; we do NOT push to the
 * repo here. Pushing requires a GitHub App (Session 7) or a wider PAT scope
 * than we want to assume.
 */
export async function liveCiGenerate(
  ctx: LiveStageContext,
): Promise<StageOutcome> {
  const { plan } = ctx;
  const branch = plan.project.defaultBranch ?? "main";
  const yaml = [
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
    "      matrix:",
    `        env: [${plan.environment}]`,
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - uses: pnpm/action-setup@v4",
    "      - uses: actions/setup-node@v4",
    "        with:",
    "          node-version: '20'",
    "          cache: 'pnpm'",
    `      - run: ${plan.commands.install ?? "pnpm install --frozen-lockfile"}`,
    `      - run: ${plan.commands.build ?? "pnpm build"}`,
    plan.commands.migrate
      ? `      - run: ${plan.commands.migrate}`
      : "      # no migration step for this blueprint",
    "      - run: npx vercel deploy --prod --token $VERCEL_TOKEN",
  ].join("\n");
  // Confirm the operator's PAT can read the .github/workflows directory.
  const probe = await probeJson(
    `https://api.github.com/repos/${encodeURIComponent(plan.project.githubOwner)}/${encodeURIComponent(plan.project.githubRepo)}/contents/.github/workflows`,
    { headers: GH_HEADERS(ctx.credentials.github) },
  );
  const workflowsDirExists = probe.ok;
  return {
    status: "succeeded",
    logLines: [
      "Generated .github/workflows/deployops.yml.",
      workflowsDirExists
        ? "Repo already has a .github/workflows directory."
        : "Repo has no .github/workflows directory yet; the operator will need to commit this file.",
      "(live: emitted YAML; commit deferred until GitHub App ships in a later session)",
    ],
    output: {
      path: ".github/workflows/deployops.yml",
      yaml,
      workflowsDirExists,
      commitRequired: true,
    },
  };
}
