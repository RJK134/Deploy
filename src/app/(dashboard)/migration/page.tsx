import { CheckCircle2, Circle, Database, GitMerge, KeyRound, Rocket } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { pingDatabase } from "@/lib/db/client";
import { listCredentials } from "@/lib/db/credentials";
import { countProjects } from "@/lib/db/projects";
import { isLiveMode } from "@/lib/env";

export const dynamic = "force-dynamic";

interface Step {
  id: string;
  title: string;
  body: string;
  command?: string;
  check: (ctx: {
    dbUp: boolean;
    projectCount: number;
    verifiedCount: number;
    liveMode: boolean;
  }) => boolean;
}

const STEPS: Step[] = [
  {
    id: "neon-project",
    title: "Provision a Neon project",
    body: "Sign in at neon.tech, create a project in a region near you, and copy the pooled connection string. The console uses the @neondatabase/serverless HTTP driver so the pooler URL is the right one.",
    check: ({ dbUp }) => dbUp,
  },
  {
    id: "set-env-vars",
    title: "Set the eight required Vercel env vars",
    body: "DATABASE_URL, NEXTAUTH_SECRET, NEXTAUTH_URL, GITHUB_OAUTH_CLIENT_ID/_SECRET, ALLOWED_EMAIL, ENCRYPTION_KEY, DEPLOYOPS_LIVE. See /architecture for the full inventory.",
    check: ({ dbUp }) => dbUp,
  },
  {
    id: "db-push",
    title: "Apply the schema with `pnpm db:push`",
    body: "Drizzle picks up every table including the Session 6 fixbot_* tables. Re-runs are no-ops once the tables exist.",
    command: "pnpm db:push",
    check: ({ dbUp }) => dbUp,
  },
  {
    id: "github-oauth-app",
    title: "Configure the operator-sign-in GitHub OAuth App",
    body: "Authorization callback URL must be <NEXTAUTH_URL>/api/auth/callback/github. This is the operator-login OAuth App, not the per-repo PAT or the GitHub App.",
    check: () => true,
  },
  {
    id: "connect-providers",
    title: "Paste & verify three provider credentials",
    body: "Connection Center → GitHub PAT, Vercel token, Neon API key. Each one's connection_state must flip to 'verified' before live mode unlocks.",
    check: ({ verifiedCount }) => verifiedCount === 3,
  },
  {
    id: "add-projects",
    title: "Add the repos this console will manage",
    body: "On /projects, paste owner/repo (or a full GitHub URL). The default branch is auto-fetched from GitHub when a verified PAT is connected.",
    check: ({ projectCount }) => projectCount >= 1,
  },
  {
    id: "wire-provider-ids",
    title: "Wire Vercel + Neon project IDs per repo",
    body: "Live mode needs project.vercel_project_id and project.neon_project_id to know which resources to mutate. Add these via the project settings (placeholder: future Session 7 form; for now, set via SQL or a follow-up patch).",
    check: () => false,
  },
  {
    id: "configure-webhooks",
    title: "(Optional) Set GITHUB_WEBHOOK_SECRET + VERCEL_WEBHOOK_SECRET",
    body: "Point both providers at <NEXTAUTH_URL>/api/webhooks/github and /api/webhooks/vercel. Routes return 503 until both secrets are present and reject any request with a bad HMAC.",
    check: () => false,
  },
  {
    id: "flip-live",
    title: "Flip DEPLOYOPS_LIVE=1 when ready for live runs",
    body: "Until then, every run is dry-run and stays safe. With this flipped AND all three providers verified, the New deploy form unlocks the Live mode checkbox.",
    check: ({ liveMode }) => liveMode,
  },
];

function StepIcon({ done }: { done: boolean }) {
  return done ? (
    <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden />
  ) : (
    <Circle className="h-4 w-4 text-muted-foreground" aria-hidden />
  );
}

export default async function MigrationPage() {
  const [dbUp, credentials, projectCount] = await Promise.all([
    pingDatabase(),
    listCredentials().catch(() => []),
    countProjects().catch(() => 0),
  ]);
  const verifiedCount = credentials.filter(
    (c) => c.connectionState === "verified",
  ).length;
  const ctx = {
    dbUp,
    projectCount,
    verifiedCount,
    liveMode: isLiveMode,
  };
  const doneCount = STEPS.filter((s) => s.check(ctx)).length;

  return (
    <PageShell
      eyebrow="Production"
      title="Migration plan"
      description="Step-by-step checklist for taking DeployOps from a clean Neon project to a live operator console. Steps are auto-checked against the running app where possible."
      actions={
        <Badge variant="outline" className="font-mono text-[10px]">
          {doneCount} / {STEPS.length} done
        </Badge>
      }
    >
      <Card>
        <CardHeader>
          <CardTitle>Order of operations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ol className="space-y-3">
            {STEPS.map((step, idx) => {
              const done = step.check(ctx);
              return (
                <li
                  key={step.id}
                  className="flex items-start gap-3 rounded-md border border-border p-3"
                >
                  <StepIcon done={done} />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">
                        {String(idx + 1).padStart(2, "0")}
                      </span>
                      <span className="font-medium">{step.title}</span>
                      <Badge
                        variant="outline"
                        className="ml-auto font-mono text-[10px] uppercase"
                      >
                        {done ? "done" : "todo"}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {step.body}
                    </p>
                    {step.command ? (
                      <pre className="overflow-x-auto rounded bg-muted/40 p-2 font-mono text-[11px]">
                        $ {step.command}
                      </pre>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
          <Separator />
          <div className="grid gap-3 text-xs text-muted-foreground sm:grid-cols-3">
            <p className="inline-flex items-center gap-1.5">
              <Database className="h-3 w-3" aria-hidden />
              DB: {dbUp ? "reachable" : "down"}
            </p>
            <p className="inline-flex items-center gap-1.5">
              <KeyRound className="h-3 w-3" aria-hidden />
              {verifiedCount} of 3 providers verified
            </p>
            <p className="inline-flex items-center gap-1.5">
              <Rocket className="h-3 w-3" aria-hidden />
              Live mode {isLiveMode ? "ON" : "OFF"} (DEPLOYOPS_LIVE)
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What this checklist intentionally skips</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-muted-foreground">
          <p className="flex items-start gap-2">
            <GitMerge className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            GitHub App webhook flow — the operator-PAT model works for two
            repos; the App becomes necessary at scale.
          </p>
          <p className="flex items-start gap-2">
            <GitMerge className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            Multi-user / RBAC / teams — single-operator by design.
          </p>
          <p className="flex items-start gap-2">
            <GitMerge className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            Email / Slack notifications — not in scope for this product.
          </p>
        </CardContent>
      </Card>
    </PageShell>
  );
}
