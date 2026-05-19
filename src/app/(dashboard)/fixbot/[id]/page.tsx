import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Boxes, Clock, ShieldAlert } from "lucide-react";

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
import { getIncident } from "@/lib/db/fixbot";
import { isLiveMode } from "@/lib/env";
import { canRunRemediationAction } from "@/lib/fixbot/autonomy";
import { relativeTime } from "@/lib/format/relative-time";
import {
  isKnownAction,
  mutatesProviders,
  type RemediationAction,
} from "@/lib/remediations/apply-gate";

import {
  applyRemediationAction,
  dismissIncidentAction,
  resolveIncidentAction,
} from "../actions";
import { ApplyRemediationButton } from "./_components/apply-remediation-button";
import { IncidentActions } from "./_components/incident-actions";

export const dynamic = "force-dynamic";

interface PageProps {
  params: { id: string };
}

function formatMetadata(value: Record<string, unknown> | null): string {
  if (!value) return "";
  return Object.entries(value)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join("  ·  ");
}

export default async function IncidentDetailPage({ params }: PageProps) {
  const incident = await getIncident(params.id);
  if (!incident) notFound();

  const isTerminal =
    incident.status === "resolved" || incident.status === "dismissed";

  return (
    <PageShell
      eyebrow={
        <Link
          href="/fixbot"
          className="inline-flex items-center gap-1 hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden />
          Fix Bot
        </Link>
      }
      title={incident.title}
      description={incident.summary ?? "No summary recorded."}
      actions={
        <div className="flex items-center gap-2">
          <RunStatusPill
            status={
              incident.status === "resolved"
                ? "succeeded"
                : incident.status === "dismissed"
                  ? "skipped"
                  : "running"
            }
          />
          <Badge variant="outline" className="font-mono text-[10px] uppercase">
            {incident.autonomy}
          </Badge>
        </div>
      }
    >
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Identity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p className="flex items-center gap-1.5">
              <Boxes
                className="h-3.5 w-3.5 text-muted-foreground"
                aria-hidden
              />
              <span className="font-mono">{incident.projectSlug ?? "—"}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              Opened {relativeTime(incident.openedAt)}
            </p>
            {incident.resolvedAt ? (
              <p className="text-xs text-muted-foreground">
                {incident.status === "resolved" ? "Resolved" : "Dismissed"}{" "}
                {relativeTime(incident.resolvedAt)}
              </p>
            ) : null}
            <p className="text-[10px] font-mono text-muted-foreground">
              id: {incident.id.slice(0, 12)}…
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Diagnoses</CardTitle>
          </CardHeader>
          <CardContent>
            {incident.diagnoses.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No diagnosis written yet. Active analyzers don&rsquo;t auto-write
                diagnoses in this session — the schema is ready when they do.
              </p>
            ) : (
              <ul className="space-y-2 text-xs">
                {incident.diagnoses.map((d) => (
                  <li
                    key={d.id}
                    className="space-y-1 rounded-md border border-border p-2"
                  >
                    <div className="flex items-center gap-1.5">
                      <Badge
                        variant="outline"
                        className="font-mono text-[10px]"
                      >
                        {d.confidence}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">
                        {relativeTime(d.createdAt)}
                      </span>
                    </div>
                    <p className="text-foreground">{d.rootCause}</p>
                    {d.evidence ? (
                      <pre className="overflow-x-auto rounded bg-muted/40 p-1.5 font-mono text-[10px]">
                        {JSON.stringify(d.evidence, null, 2)}
                      </pre>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Remediations</CardTitle>
          </CardHeader>
          <CardContent>
            {incident.remediations.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No remediations queued. Once analyzers can propose fixes, the
                autonomy gate decides whether to draft / queue / apply them.
              </p>
            ) : (
              <ul className="space-y-2 text-xs">
                {incident.remediations.map((r) => {
                  const knownAction = isKnownAction(r.action)
                    ? (r.action as RemediationAction)
                    : null;
                  const autonomyGate = canRunRemediationAction(
                    incident.autonomy,
                    "apply",
                  );
                  const willMutate = knownAction
                    ? mutatesProviders(knownAction)
                    : false;
                  const applyDisabled =
                    r.status !== "draft" ||
                    !knownAction ||
                    !autonomyGate.allowed ||
                    (willMutate && !isLiveMode);
                  const applyDisabledReason =
                    r.status !== "draft"
                      ? `status is '${r.status}'`
                      : !knownAction
                        ? `no handler for '${r.action}' yet`
                        : !autonomyGate.allowed
                          ? autonomyGate.reason
                          : willMutate && !isLiveMode
                            ? "DEPLOYOPS_LIVE=0 — apply would mutate a provider"
                            : undefined;
                  return (
                    <li
                      key={r.id}
                      className="space-y-1 rounded-md border border-border p-2"
                    >
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge
                          variant="outline"
                          className="font-mono text-[10px]"
                        >
                          {r.action}
                        </Badge>
                        <Badge
                          variant="outline"
                          className="font-mono text-[10px]"
                        >
                          {r.status}
                        </Badge>
                        {r.approvalRequired ? (
                          <Badge
                            variant="outline"
                            className="font-mono text-[10px]"
                          >
                            approval required
                          </Badge>
                        ) : null}
                        <div className="ml-auto">
                          {knownAction ? (
                            <ApplyRemediationButton
                              action={applyRemediationAction}
                              remediationId={r.id}
                              incidentId={incident.id}
                              verb={r.action}
                              mutates={willMutate}
                              disabled={applyDisabled}
                              disabledReason={applyDisabledReason}
                            />
                          ) : null}
                        </div>
                      </div>
                      <p>{r.description}</p>
                      {r.payload ? (
                        <p className="text-[10px] text-muted-foreground">
                          {formatMetadata(r.payload)}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Operator actions</CardTitle>
        </CardHeader>
        <CardContent>
          {isTerminal ? (
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              Incident is {incident.status}. Nothing else to do here.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="flex items-start gap-2 text-sm text-foreground/90">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                Resolving marks the incident as fixed (the operator did
                something). Dismissing marks it as a false positive (the
                analyzer can ignore the next probe in the same window).
              </p>
              <Separator />
              <IncidentActions
                dismissAction={dismissIncidentAction}
                resolveAction={resolveIncidentAction}
                id={incident.id}
                isTerminal={isTerminal}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
