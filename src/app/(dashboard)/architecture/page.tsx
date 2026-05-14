import { ArrowRight, Database, GitBranch, KeyRound, Network } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { STAGE_KINDS, STAGE_SPECS } from "@/lib/pipeline/stages";

const REQUIRED_ENV: { key: string; purpose: string; rotateOn: string }[] = [
  {
    key: "DATABASE_URL",
    purpose: "Neon pooled connection. Holds users, credentials, projects, runs.",
    rotateOn: "Neon credential rotation; new region.",
  },
  {
    key: "NEXTAUTH_SECRET",
    purpose: "JWT signing secret for operator sessions.",
    rotateOn: "Suspected session compromise; quarterly.",
  },
  {
    key: "NEXTAUTH_URL",
    purpose: "Canonical app URL used for OAuth callback construction.",
    rotateOn: "When the production host changes.",
  },
  {
    key: "GITHUB_OAUTH_CLIENT_ID / _SECRET",
    purpose: "Operator-only GitHub sign-in OAuth App (not the repo-read PAT).",
    rotateOn: "OAuth App rotation; secret leak.",
  },
  {
    key: "ALLOWED_EMAIL",
    purpose: "Single-operator allowlist enforced in the NextAuth signIn callback.",
    rotateOn: "When the operator's email changes.",
  },
  {
    key: "ENCRYPTION_KEY",
    purpose: "AES-256-GCM key for the provider_credentials.ciphertext column.",
    rotateOn: "Stored credential leak. Rotating today is destructive — Session 6 will add a re-encrypt flow.",
  },
  {
    key: "DEPLOYOPS_LIVE",
    purpose: "Global kill switch. 0 = dry-run only. Session 6+ flips to 1.",
    rotateOn: "Never rotated; flipped intentionally per environment.",
  },
];

const TABLES: { name: string; purpose: string }[] = [
  { name: "users", purpose: "Operator profile; one row, upserted on sign-in." },
  {
    name: "provider_credentials",
    purpose: "Encrypted GitHub PAT, Vercel token, and Neon API key. Verified state tracked.",
  },
  {
    name: "projects",
    purpose:
      "GitHub repo metadata + blueprint binding + access mode + custom domain.",
  },
  { name: "blueprints", purpose: "Declarative deploy recipes. Built-ins seeded lazily." },
  { name: "runs", purpose: "One row per dry-run or (Session 6+) live deploy." },
  { name: "stages", purpose: "Per-stage status, log_text, output_json. Cascade-delete with runs." },
  {
    name: "webhook_events",
    purpose: "Inbound GitHub / Vercel webhook ledger (Session 6).",
  },
  {
    name: "audit_log",
    purpose: "Human-readable timeline of every privileged action.",
  },
];

export default function ArchitecturePage() {
  return (
    <PageShell
      eyebrow="Production"
      title="Architecture"
      description="How DeployOps Console fits together: Vercel hosts the Next.js app, Neon holds the durable state, the operator's PAT/Token/API-key talk to GitHub/Vercel/Neon at deploy time."
    >
      <Card>
        <CardHeader>
          <CardTitle>Control plane</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="text-foreground/90">
            The console itself is a Next.js 14 App Router app running on Vercel,
            backed by a Neon Postgres pooled connection. Every privileged write
            also produces an <code className="font-mono">audit_log</code> row
            for forensics.
          </p>
          <div className="grid gap-3 text-xs sm:grid-cols-[1fr_auto_1fr_auto_1fr]">
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="flex items-center gap-2 font-medium">
                <Network className="h-4 w-4 text-primary" aria-hidden />
                Operator
              </div>
              <p className="mt-1 text-muted-foreground">
                Signs in with GitHub OAuth.
                <br />
                Allowlist:{" "}
                <code className="font-mono">ALLOWED_EMAIL</code>.
              </p>
            </div>
            <ArrowRight
              className="mx-auto mt-6 h-4 w-4 text-muted-foreground"
              aria-hidden
            />
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="flex items-center gap-2 font-medium">
                <KeyRound className="h-4 w-4 text-primary" aria-hidden />
                DeployOps app
              </div>
              <p className="mt-1 text-muted-foreground">
                Next.js 14 on Vercel.
                <br />
                Middleware gates every route except{" "}
                <code className="font-mono">/api/health</code> and{" "}
                <code className="font-mono">/api/auth/*</code>.
              </p>
            </div>
            <ArrowRight
              className="mx-auto mt-6 h-4 w-4 text-muted-foreground"
              aria-hidden
            />
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="flex items-center gap-2 font-medium">
                <Database className="h-4 w-4 text-primary" aria-hidden />
                Neon Postgres
              </div>
              <p className="mt-1 text-muted-foreground">
                Eight tables, pooled.
                <br />
                Driver:{" "}
                <code className="font-mono">@neondatabase/serverless</code> (HTTP).
              </p>
            </div>
          </div>
          <Separator />
          <p className="text-xs text-muted-foreground">
            At deploy time the app reaches out to GitHub, Vercel, and Neon using
            credentials encrypted at rest with{" "}
            <code className="font-mono">ENCRYPTION_KEY</code> (AES-256-GCM). The
            global <code className="font-mono">DEPLOYOPS_LIVE</code> flag plus
            per-provider <code className="font-mono">connection_state</code>{" "}
            decides whether a run mutates the world (Session 6+) or runs
            entirely in dry-run.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Required env vars</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full border-separate border-spacing-y-1 text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="px-2 text-left">Key</th>
                <th className="px-2 text-left">Purpose</th>
                <th className="px-2 text-left">Rotate on</th>
              </tr>
            </thead>
            <tbody>
              {REQUIRED_ENV.map((e) => (
                <tr key={e.key} className="align-top">
                  <td className="px-2 py-1 font-mono text-xs">{e.key}</td>
                  <td className="px-2 py-1 text-xs">{e.purpose}</td>
                  <td className="px-2 py-1 text-xs text-muted-foreground">
                    {e.rotateOn}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Database</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 text-xs sm:grid-cols-2">
            {TABLES.map((t) => (
              <li
                key={t.name}
                className="rounded-md border border-border bg-card p-2"
              >
                <code className="font-mono text-sm text-foreground">
                  {t.name}
                </code>
                <p className="mt-1 text-muted-foreground">{t.purpose}</p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pipeline</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-1 text-xs">
            {STAGE_KINDS.map((kind, idx) => {
              const s = STAGE_SPECS[kind];
              return (
                <li key={kind} className="flex items-center gap-2">
                  <span className="font-mono text-muted-foreground">
                    {String(idx + 1).padStart(2, "0")}
                  </span>
                  <GitBranch
                    className="h-3 w-3 text-muted-foreground"
                    aria-hidden
                  />
                  <span className="font-medium">{s.label}</span>
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {s.kind}
                  </code>
                  <Badge variant="outline" className="ml-auto font-mono text-[10px]">
                    {s.provider}
                  </Badge>
                </li>
              );
            })}
          </ol>
        </CardContent>
      </Card>
    </PageShell>
  );
}
