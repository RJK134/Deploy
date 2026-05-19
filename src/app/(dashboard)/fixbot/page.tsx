import Link from "next/link";
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
import { listProjects } from "@/lib/db/projects";
import { AUTONOMY_BLURB } from "@/lib/fixbot/autonomy";
import { relativeTime } from "@/lib/format/relative-time";

import { createMonitorAction, deleteMonitorAction } from "./actions";
import { MonitorForm } from "./_components/monitor-form";
import { DeleteMonitorButton } from "./_components/monitor-row-actions";

export const dynamic = "force-dynamic";

export default async function FixBotPage() {
  const [monitors, incidents, total, projects] = await Promise.all([
    listMonitors(),
    listIncidents(50),
    countIncidents(),
    listProjects(),
  ]);

  return (
    <PageShell
      eyebrow="Operations"
      title="Fix Bot"
      description="Health monitors, incidents, diagnoses, and gated remediations. HTTP / build / workflow analyzers run on Vercel cron every 5 minutes."
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
        <CardHeader>
          <CardTitle>Add a monitor</CardTitle>
        </CardHeader>
        <CardContent>
          <MonitorForm
            action={createMonitorAction}
            projects={projects.map((p) => ({ id: p.id, slug: p.slug }))}
          />
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
              No monitors configured yet. Add one above to start tracking.
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
                  <DeleteMonitorButton
                    action={deleteMonitorAction}
                    id={m.id}
                    label={m.label}
                  />
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
              No incidents yet. When an analyzer flips a monitor to{" "}
              <code className="font-mono">down</code> for the first time, a row
              lands here.
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
                      <td className="px-2 py-1">
                        <Link
                          href={`/fixbot/${i.id}`}
                          className="hover:underline"
                        >
                          {i.title}
                        </Link>
                      </td>
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
                            i.status === "resolved"
                              ? "succeeded"
                              : i.status === "dismissed"
                                ? "skipped"
                                : "running"
                          }
                        />
                      </td>
                      <td className="px-2 py-1">
                        <Badge
                          variant="outline"
                          className="font-mono text-[10px]"
                        >
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
            Click an incident title to open its detail page with diagnoses,
            remediation chain, and dismiss/resolve actions.
          </p>
        </CardContent>
      </Card>
    </PageShell>
  );
}
