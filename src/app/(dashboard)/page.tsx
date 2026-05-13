import {
  Activity,
  Boxes,
  Layers,
  Plug,
  type LucideIcon,
} from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listCredentials } from "@/lib/db/credentials";
import { countProjects } from "@/lib/db/projects";
import { countRunsSince } from "@/lib/db/runs";

export const dynamic = "force-dynamic";

interface Kpi {
  label: string;
  icon: LucideIcon;
  value: string;
  hint: string;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export default async function OverviewPage() {
  const sevenDaysAgo = new Date(Date.now() - SEVEN_DAYS_MS);
  const [credentials, projectCount, runs7d] = await Promise.all([
    listCredentials(),
    countProjects(),
    countRunsSince(sevenDaysAgo),
  ]);
  const verifiedCount = credentials.filter(
    (c) => c.connectionState === "verified",
  ).length;

  const kpis: Kpi[] = [
    {
      label: "Projects",
      icon: Boxes,
      value: projectCount > 0 ? String(projectCount) : "—",
      hint:
        projectCount === 0
          ? "Connect a repo to start"
          : `${projectCount} repo${projectCount === 1 ? "" : "s"} tracked`,
    },
    {
      label: "Runs · 7d",
      icon: Activity,
      value: runs7d > 0 ? String(runs7d) : "—",
      hint: runs7d === 0 ? "No runs recorded yet" : `${runs7d} in the last week`,
    },
    {
      label: "Providers · live",
      icon: Plug,
      value: verifiedCount > 0 ? String(verifiedCount) : "—",
      hint:
        verifiedCount === 0
          ? "GitHub, Vercel, Neon — pending"
          : `${verifiedCount} of 3 verified`,
    },
    { label: "Active env", icon: Layers, value: "—", hint: "test · demo · deploy" },
  ];

  return (
    <PageShell
      eyebrow="Workspace"
      title="Overview"
      description="The DeployOps Console is wired up but waiting on provider integrations. Sessions 2–6 will progressively activate GitHub scanning, Vercel deploys, Neon provisioning, and Fix Bot."
    >
      <section
        aria-label="Key performance indicators"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <Card key={kpi.label}>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle>{kpi.label}</CardTitle>
                <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
              </CardHeader>
              <CardContent className="space-y-1">
                <p className="text-3xl font-semibold tracking-tight tabular-nums text-foreground">
                  {kpi.value}
                </p>
                <p className="text-xs text-muted-foreground">{kpi.hint}</p>
              </CardContent>
            </Card>
          );
        })}
      </section>

      <section
        aria-label="Coming soon"
        className="grid grid-cols-1 gap-4 lg:grid-cols-3"
      >
        <Card>
          <CardHeader>
            <CardTitle>Recent runs</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Coming soon — Session 4 wires up the run timeline and live log
              tail. For now, the runs table is empty.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Provider health</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {verifiedCount === 0
                ? "Connect a GitHub PAT, Vercel token, and Neon API key in the Connection Center to begin."
                : `${verifiedCount} of 3 providers verified. Visit the Connection Center to manage credentials.`}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Environment matrix</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Coming soon — Session 3 surfaces test / demo / deploy readiness
              per project.
            </p>
          </CardContent>
        </Card>
      </section>
    </PageShell>
  );
}
