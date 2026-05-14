import Link from "next/link";
import { Boxes, PlayCircle } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { RunStatusPill } from "@/components/run-status-pill";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listRuns } from "@/lib/db/runs";
import { relativeTime } from "@/lib/format/relative-time";

export const dynamic = "force-dynamic";

export default async function RunsPage() {
  const rows = await listRuns(50);

  return (
    <PageShell
      eyebrow="Workspace"
      title="Runs"
      description="Every dry-run and (in Session 5+) live deploy. Click a row to open the timeline."
      actions={
        <Button asChild>
          <Link href="/runs/new">
            <PlayCircle className="h-4 w-4" aria-hidden />
            New deploy
          </Link>
        </Button>
      }
    >
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle>Recent runs</CardTitle>
          <Badge variant="outline" className="font-mono text-[10px]">
            {rows.length} {rows.length === 1 ? "row" : "rows"}
          </Badge>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No runs yet. Create one from <code className="font-mono">/runs/new</code>.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((r) => (
                <li key={r.id} className="py-3 first:pt-0 last:pb-0">
                  <Link
                    href={`/runs/${r.id}`}
                    className="flex flex-wrap items-center gap-3 hover:opacity-80"
                  >
                    <RunStatusPill status={r.status} />
                    <Badge
                      variant="outline"
                      className="font-mono text-[10px] uppercase"
                    >
                      {r.environment}
                    </Badge>
                    <Badge
                      variant="outline"
                      className="font-mono text-[10px] uppercase"
                    >
                      {r.mode === "dry_run" ? "dry-run" : "live"}
                    </Badge>
                    <div className="flex min-w-0 items-center gap-1.5 text-sm">
                      <Boxes
                        className="h-3.5 w-3.5 text-muted-foreground"
                        aria-hidden
                      />
                      <span className="truncate font-mono">
                        {r.projectSlug ?? "—"}
                      </span>
                    </div>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {relativeTime(r.createdAt)}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {r.id.slice(0, 8)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
