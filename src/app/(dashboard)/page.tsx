import {
  Activity,
  Boxes,
  Layers,
  Plug,
  type LucideIcon,
} from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Kpi {
  label: string;
  icon: LucideIcon;
  hint: string;
}

const kpis: Kpi[] = [
  { label: "Projects", icon: Boxes, hint: "Connect a repo to start" },
  { label: "Runs · 7d", icon: Activity, hint: "No runs recorded yet" },
  { label: "Providers · live", icon: Plug, hint: "GitHub, Vercel, Neon — pending" },
  { label: "Active env", icon: Layers, hint: "test · demo · deploy" },
];

export default function OverviewPage() {
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
                  —
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
              Coming soon — Session 2 introduces the Connection Center for
              GitHub App, Vercel, and Neon credentials.
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
