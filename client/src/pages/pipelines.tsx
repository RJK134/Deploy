import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProviderIcon } from "@/components/provider-icon";
import {
  ScanSearch, KeyRound, Database, Wrench, Workflow, Cloud, Globe2, Stethoscope,
} from "lucide-react";

const STAGE_PLAN = [
  { key: "scan",    label: "Scan repository",     description: "Read package.json, detect framework + ORM, parse .env.example.", provider: "github", icon: ScanSearch },
  { key: "env",     label: "Resolve env vars",    description: "Cross-reference required vars with provider outputs and existing secrets.", provider: null, icon: KeyRound },
  { key: "db",      label: "Provision database",  description: "Branch a Neon database or create a Prisma DB for the target environment.", provider: "neon", icon: Database },
  { key: "migrate", label: "Run migrations",      description: "Apply Prisma migrations against the new branch with a transactional shadow DB.", provider: "prisma", icon: Wrench },
  { key: "ci",      label: "Generate CI workflow", description: "Write `.github/workflows/deployops.yml` mirroring this plan in CI.", provider: "github", icon: Workflow },
  { key: "deploy",  label: "Deploy build",        description: "Push env vars, link the project, and trigger the build on the host.", provider: "vercel", icon: Cloud },
  { key: "domain",  label: "Wire domain & access", description: "Attach the env subdomain and apply the access policy.", provider: "vercel", icon: Globe2 },
  { key: "smoke",   label: "Smoke test",          description: "Hit / and /api/health, verify 200 + JSON, capture response time.", provider: null, icon: Stethoscope },
];

export default function Pipelines() {
  return (
    <PageShell
      eyebrow="Library"
      title="Pipeline anatomy"
      description="Every DeployOps run executes the same eight-stage plan. Stages skip cleanly when not applicable — for example, no database means no migrations."
    >
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Standard plan</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3">
            {STAGE_PLAN.map((s, idx) => (
              <li key={s.key} className="grid grid-cols-[2.25rem_1fr_auto] gap-3 items-start" data-testid={`pipeline-stage-${s.key}`}>
                <div className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card text-muted-foreground">
                  <s.icon className="h-4 w-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-muted-foreground tabular-nums">{String(idx + 1).padStart(2, "0")}</span>
                    <div className="text-sm font-medium">{s.label}</div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{s.description}</p>
                </div>
                <div className="self-center">
                  {s.provider ? (
                    <Badge variant="outline" className="font-mono text-[10px] inline-flex items-center gap-1">
                      <ProviderIcon provider={s.provider} className="h-3 w-3" /> {s.provider}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="font-mono text-[10px]">internal</Badge>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Skip rules</CardTitle></CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-2">
            <p>· No database flagged in the project → <code className="font-mono text-foreground">db</code> and <code className="font-mono text-foreground">migrate</code> are skipped.</p>
            <p>· No Prisma schema detected → <code className="font-mono text-foreground">migrate</code> is skipped even if Neon is provisioned.</p>
            <p>· Railway selected → <code className="font-mono text-foreground">deploy</code> falls back to manual CLI guidance instead of Vercel.</p>
            <p>· Static site without API routes → <code className="font-mono text-foreground">smoke</code> only hits <code className="font-mono text-foreground">/</code>.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Failure semantics</CardTitle></CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-2">
            <p>· A failed stage halts the run. Subsequent stages stay <code className="font-mono text-foreground">pending</code> so you can fix and resume.</p>
            <p>· Provisioned resources from earlier stages are kept — DeployOps never deletes infrastructure on failure.</p>
            <p>· In dry-run, no provider mutations occur. The simulated logs preview exactly what live mode would call.</p>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
