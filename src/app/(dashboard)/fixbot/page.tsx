import {
  Activity,
  Boxes,
  CircleDashed,
  Sparkles,
} from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { RunStatusPill } from "@/components/run-status-pill";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  countIncidents,
  listIncidents,
  listMonitors,
} from "@/lib/db/fixbot";
import { AUTONOMY_BLURB } from "@/lib/fixbot/autonomy";
import { relativeTime } from "@/lib/format/relative-time";

export const dynamic = "force-dynamic";

export default async function FixBotPage() {
  const [monitors, incidents, total] = await Promise.all([
    listMonitors(),
    listIncidents(50),
    countIncidents(),
  ]);

  return (
    <PageShell
      eyebrow="Operations"
      title="Fix Bot"
      description="Health monitors, incidents, diagnoses, and gated remediations. Schema and operations layer are wired this session; live analyzers + webhook-triggered detection ship in a later session."
      actions={
        <Badge variant="outline" className="font-mono text-[10px]">
          {total} incidents · {monitors.length} monitors
        </Badge>
      }
    >
      <Card>
        <CardHeader>
          <CardTitle>Autonomy levels</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs text-muted-foreground">
          {(
            [
              "diagnose-only",
              "prepare-fix",
              "approval-required",
              "safe-auto-fix",
            ] as const
          ).map((level) => (
            <div key={level} className="flex items-start gap-2">
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">
                {level}
              </code>
              <span>{AUTONOMY_BLURB[level]}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle>Monitors</CardTitle>
          <Badge variant="outline" className="font-mono text-[10px]">
            {monitors.length}
          </Badge>
        </CardHeader>
        <CardContent>
          {monitors.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <CircleDashed className="h-4 w-4" aria-hidden />
              No monitors configured yet. A later session adds HTTP, build,
              migration, env, domain, and workflow analyzers that write rows
              here automatically.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {monitors.map((m) => (
                <li
                  key={m.id}
                  className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2"
                >
                  <Activity
                    className="h-3.5 w-3.5 text-muted-foreground"
                    aria-hidden
                  />
                  <span className="font-medium">{m.label}</span>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {m.kind}
                  </Badge>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {m.status}
                  </Badge>
                  {m.projectSlug ? (
                    <span className="font-mono text-xs text-muted-foreground">
                      {m.projectSlug}
                    </span>
                  ) : null}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {m.lastCheckedAt
                      ? `last ${relativeTime(m.lastCheckedAt)}`
                      : "never"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle>Incidents</CardTitle>
          <Badge variant="outline" className="font-mono text-[10px]">
            {incidents.length}
          </Badge>
        </CardHeader>
        <CardContent>
          {incidents.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Sparkles className="h-4 w-4" aria-hidden />
              No incidents yet. When analyzers ship, monitors flipping to
              warning/down will open rows here, then attach diagnoses and
              autonomy-gated remediations.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-separate border-spacing-y-1 text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-2 text-left">Opened</th>
                    <th className="px-2 text-left">Title</th>
                    <th className="px-2 text-left">Project</th>
                    <th className="px-2 text-left">Status</th>
                    <th className="px-2 text-left">Autonomy</th>
                  </tr>
                </thead>
                <tbody>
                  {incidents.map((i) => (
                    <tr key={i.id} className="align-top">
                      <td className="px-2 py-1 text-xs text-muted-foreground">
                        {relativeTime(i.openedAt)}
                      </td>
                      <td className="px-2 py-1">{i.title}</td>
                      <td className="px-2 py-1 font-mono text-xs">
                        <span className="inline-flex items-center gap-1">
                          <Boxes
                            className="h-3 w-3 text-muted-foreground"
                            aria-hidden
                          />
                          {i.projectSlug ?? "—"}
                        </span>
                      </td>
                      <td className="px-2 py-1">
                        <RunStatusPill
                          status={
                            i.status === "open" || i.status === "diagnosed"
                              ? "running"
                              : i.status === "remediating"
                                ? "running"
                                : i.status === "resolved"
                                  ? "succeeded"
                                  : "skipped"
                          }
                        />
                      </td>
                      <td className="px-2 py-1">
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {i.autonomy}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Separator className="my-3" />
          <p className="text-xs text-muted-foreground">
            Fix Bot is intentionally inert until the operator wires it up. The
            schema is in place so analyzers can land in a follow-up without
            another migration.
          </p>
        </CardContent>
      </Card>
    </PageShell>
  );
}
