import { ScrollText } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { countAudit, listAudit, type AuditRow } from "@/lib/db/audit";
import { relativeTime } from "@/lib/format/relative-time";

export const dynamic = "force-dynamic";

interface SearchParams {
  before?: string;
  limit?: string;
}

interface PageProps {
  searchParams: SearchParams;
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function formatMetadata(metadata: Record<string, unknown> | null): string {
  if (!metadata) return "";
  return Object.entries(metadata)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join("  ·  ");
}

function actionPalette(action: string): string {
  if (action.startsWith("credential.")) return "border-primary/40 text-primary";
  if (action.startsWith("run.failed")) return "border-destructive/40 text-destructive";
  if (action.startsWith("run.")) return "border-amber-500/40 text-amber-600 dark:text-amber-400";
  if (action.startsWith("project.")) return "border-border text-foreground";
  if (action.startsWith("stage.")) return "border-border text-muted-foreground";
  return "border-border text-muted-foreground";
}

export default async function AuditPage({ searchParams }: PageProps) {
  const before = parseDate(searchParams.before);
  const limit = Number.parseInt(searchParams.limit ?? "100", 10) || 100;
  const [rows, total] = await Promise.all([
    listAudit({ before, limit: Math.min(limit, 200) }),
    countAudit(),
  ]);

  const oldest: AuditRow | undefined = rows[rows.length - 1];
  const nextHref = oldest
    ? `/audit?before=${encodeURIComponent(oldest.createdAt.toISOString())}`
    : null;

  return (
    <PageShell
      eyebrow="Operations"
      title="Audit log"
      description="Every privileged action — credential changes, project edits, run advances — is recorded here with the operator's email, an action verb, and structured metadata."
      actions={
        <Badge variant="outline" className="font-mono text-[10px]">
          {total} total
        </Badge>
      }
    >
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle>Latest events</CardTitle>
          {before ? (
            <Badge variant="outline" className="font-mono text-[10px]">
              before {before.toISOString()}
            </Badge>
          ) : null}
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <ScrollText className="h-4 w-4" aria-hidden />
              No audit rows match this filter.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-separate border-spacing-y-1 text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-2 text-left">When</th>
                    <th className="px-2 text-left">Actor</th>
                    <th className="px-2 text-left">Action</th>
                    <th className="px-2 text-left">Target</th>
                    <th className="px-2 text-left">Metadata</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="align-top">
                      <td className="px-2 py-1">
                        <time
                          dateTime={row.createdAt.toISOString()}
                          title={row.createdAt.toISOString()}
                          className="text-xs text-muted-foreground"
                        >
                          {relativeTime(row.createdAt)}
                        </time>
                      </td>
                      <td className="px-2 py-1 font-mono text-xs">
                        {row.actor}
                      </td>
                      <td className="px-2 py-1">
                        <Badge
                          variant="outline"
                          className={`font-mono text-[10px] ${actionPalette(row.action)}`}
                        >
                          {row.action}
                        </Badge>
                      </td>
                      <td className="px-2 py-1 font-mono text-xs text-muted-foreground">
                        {row.target ?? "—"}
                      </td>
                      <td className="px-2 py-1 font-mono text-[11px] text-muted-foreground">
                        {formatMetadata(row.metadata) || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {nextHref && rows.length === limit ? (
        <p className="text-xs text-muted-foreground">
          Showing {rows.length} rows. {" "}
          <a className="font-mono text-foreground hover:underline" href={nextHref}>
            Older →
          </a>
        </p>
      ) : null}
    </PageShell>
  );
}
