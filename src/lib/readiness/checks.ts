import "server-only";

import { isLiveMode } from "@/lib/env";
import { listBlueprints } from "@/lib/db/blueprints";
import { pingDatabase } from "@/lib/db/client";
import { listCredentials } from "@/lib/db/credentials";
import { countProjects } from "@/lib/db/projects";
import type { ProviderKind } from "@/lib/db/schema";

import type { CheckResult } from "./summary";

export type { CheckResult, CheckStatus } from "./summary";
export { summariseReadiness } from "./summary";

interface CheckContext {
  dbUp: boolean;
}

interface CheckDef {
  id: string;
  label: string;
  run: (ctx: CheckContext) => Promise<CheckResult> | CheckResult;
}

const PROVIDER_LABEL: Record<ProviderKind, string> = {
  github_pat: "GitHub",
  vercel: "Vercel",
  neon: "Neon",
};

const CHECKS: CheckDef[] = [
  {
    id: "db.ping",
    label: "Database reachable",
    run: ({ dbUp }) => ({
      id: "db.ping",
      label: "Database reachable",
      status: dbUp ? "ok" : "fail",
      detail: dbUp
        ? "select 1 returned in < 1 RTT"
        : "select 1 failed; check DATABASE_URL and Neon project status",
      hint: dbUp ? undefined : "Verify DATABASE_URL in your env file.",
    }),
  },
  {
    id: "providers.verified",
    label: "Provider credentials verified",
    run: async ({ dbUp }) => {
      if (!dbUp) {
        return {
          id: "providers.verified",
          label: "Provider credentials verified",
          status: "warn",
          detail: "skipped — DB is down",
        };
      }
      const credentials = await listCredentials();
      const byKind = new Map(credentials.map((c) => [c.kind, c]));
      const missing: string[] = [];
      const failed: string[] = [];
      const pending: string[] = [];
      for (const kind of ["github_pat", "vercel", "neon"] as ProviderKind[]) {
        const row = byKind.get(kind);
        if (!row) {
          missing.push(PROVIDER_LABEL[kind]);
          continue;
        }
        if (row.connectionState === "failed") failed.push(PROVIDER_LABEL[kind]);
        if (row.connectionState === "pending") pending.push(PROVIDER_LABEL[kind]);
      }
      if (failed.length > 0) {
        return {
          id: "providers.verified",
          label: "Provider credentials verified",
          status: "fail",
          detail: `Verification failed: ${failed.join(", ")}.`,
          hint: "Re-paste the credential on /providers and click Verify.",
        };
      }
      if (missing.length > 0 || pending.length > 0) {
        const parts: string[] = [];
        if (missing.length > 0) parts.push(`missing: ${missing.join(", ")}`);
        if (pending.length > 0) parts.push(`pending: ${pending.join(", ")}`);
        return {
          id: "providers.verified",
          label: "Provider credentials verified",
          status: "warn",
          detail: parts.join("; "),
          hint: "Connection Center → paste and verify each provider.",
        };
      }
      return {
        id: "providers.verified",
        label: "Provider credentials verified",
        status: "ok",
        detail: "GitHub, Vercel, and Neon credentials all verified.",
      };
    },
  },
  {
    id: "projects.exist",
    label: "At least one project connected",
    run: async ({ dbUp }) => {
      if (!dbUp) {
        return {
          id: "projects.exist",
          label: "At least one project connected",
          status: "warn",
          detail: "skipped — DB is down",
        };
      }
      const count = await countProjects();
      if (count === 0) {
        return {
          id: "projects.exist",
          label: "At least one project connected",
          status: "warn",
          detail: "No projects yet.",
          hint: "Add a repo on /projects.",
        };
      }
      return {
        id: "projects.exist",
        label: "At least one project connected",
        status: "ok",
        detail: `${count} project${count === 1 ? "" : "s"} connected.`,
      };
    },
  },
  {
    id: "blueprints.seeded",
    label: "Built-in blueprints seeded",
    run: async ({ dbUp }) => {
      if (!dbUp) {
        return {
          id: "blueprints.seeded",
          label: "Built-in blueprints seeded",
          status: "warn",
          detail: "skipped — DB is down",
        };
      }
      const blueprints = await listBlueprints();
      if (blueprints.length < 3) {
        return {
          id: "blueprints.seeded",
          label: "Built-in blueprints seeded",
          status: "warn",
          detail: `Only ${blueprints.length} blueprint${blueprints.length === 1 ? "" : "s"} present.`,
          hint: "Visit /blueprints to trigger the lazy seeder.",
        };
      }
      return {
        id: "blueprints.seeded",
        label: "Built-in blueprints seeded",
        status: "ok",
        detail: `${blueprints.length} blueprints available.`,
      };
    },
  },
  {
    id: "kill.switch",
    label: "Live-mode kill switch",
    run: () => ({
      id: "kill.switch",
      label: "Live-mode kill switch",
      status: isLiveMode ? "warn" : "ok",
      detail: isLiveMode
        ? "DEPLOYOPS_LIVE=1 — runs can mutate providers. Confirm intentional."
        : "DEPLOYOPS_LIVE=0 — dry-run only, no provider mutations possible.",
      hint: isLiveMode
        ? "Set DEPLOYOPS_LIVE=0 in env if you didn't mean to flip the switch."
        : undefined,
    }),
  },
];

export async function runReadinessChecks(): Promise<CheckResult[]> {
  const dbUp = await pingDatabase();
  const ctx: CheckContext = { dbUp };
  const out: CheckResult[] = [];
  for (const def of CHECKS) {
    try {
      const res = await def.run(ctx);
      out.push(res);
    } catch (err) {
      out.push({
        id: def.id,
        label: def.label,
        status: "fail",
        detail:
          err instanceof Error ? `check threw: ${err.message}` : "check threw",
      });
    }
  }
  return out;
}

