import Link from "next/link";
import { Boxes, FilterX, PlayCircle } from "lucide-react";

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
import { listProjects } from "@/lib/db/projects";
import { listRuns, type RunListFilters } from "@/lib/db/runs";
import { relativeTime } from "@/lib/format/relative-time";
import {
  ENVIRONMENTS,
  RUN_MODES,
  RUN_STATUSES,
  type Environment,
  type RunMode,
  type RunStatus,
} from "@/lib/pipeline/stages";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: {
    project?: string;
    environment?: string;
    status?: string;
    mode?: string;
  };
}

function pickEnum<T extends readonly string[]>(
  options: T,
  value: string | undefined,
): T[number] | undefined {
  if (!value) return undefined;
  return (options as readonly string[]).includes(value)
    ? (value as T[number])
    : undefined;
}

function buildHref(
  patch: Partial<Record<"project" | "environment" | "status" | "mode", string>>,
  current: PageProps["searchParams"],
): string {
  const params = new URLSearchParams();
  const merged = { ...current, ...patch };
  for (const [k, v] of Object.entries(merged)) {
    if (typeof v === "string" && v.length > 0) params.set(k, v);
  }
  const qs = params.toString();
  return qs ? `/runs?${qs}` : "/runs";
}

export default async function RunsPage({ searchParams }: PageProps) {
  const filters: RunListFilters = {
    projectId: searchParams.project,
    environment: pickEnum(ENVIRONMENTS, searchParams.environment) as
      | Environment
      | undefined,
    status: pickEnum(RUN_STATUSES, searchParams.status) as RunStatus | undefined,
    mode: pickEnum(RUN_MODES, searchParams.mode) as RunMode | undefined,
  };
  const [rows, projects] = await Promise.all([
    listRuns(100, filters),
    listProjects(),
  ]);

  const projectMap = new Map(projects.map((p) => [p.id, p.slug]));
  const hasActiveFilter = Boolean(
    filters.projectId || filters.environment || filters.status || filters.mode,
  );

  return (
    <PageShell
      eyebrow="Workspace"
      title="Runs"
      description="Every dry-run and live deploy. Filter by project, environment, status, and mode."
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
        <CardHeader className="space-y-3">
          <div className="flex flex-row items-center justify-between gap-2">
            <CardTitle>Filters</CardTitle>
            {hasActiveFilter ? (
              <Button asChild variant="ghost" size="sm">
                <Link href="/runs">
                  <FilterX className="h-3.5 w-3.5" aria-hidden />
                  Clear
                </Link>
              </Button>
            ) : null}
          </div>
          <form
            method="get"
            action="/runs"
            className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-4"
          >
            <select
              name="project"
              defaultValue={filters.projectId ?? ""}
              className={cn(
                "rounded-md border border-input bg-background px-2 py-1",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              )}
            >
              <option value="">All projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.slug}
                </option>
              ))}
            </select>
            <select
              name="environment"
              defaultValue={filters.environment ?? ""}
              className="rounded-md border border-input bg-background px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <option value="">All envs</option>
              {ENVIRONMENTS.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
            <select
              name="status"
              defaultValue={filters.status ?? ""}
              className="rounded-md border border-input bg-background px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <option value="">All statuses</option>
              {RUN_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              name="mode"
              defaultValue={filters.mode ?? ""}
              className="rounded-md border border-input bg-background px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <option value="">All modes</option>
              {RUN_MODES.map((m) => (
                <option key={m} value={m}>
                  {m === "dry_run" ? "dry-run" : m}
                </option>
              ))}
            </select>
            <Button type="submit" variant="outline" size="sm" className="sm:col-span-4 sm:w-fit">
              Apply
            </Button>
          </form>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-2 pb-2">
            <Badge variant="outline" className="font-mono text-[10px]">
              {rows.length} {rows.length === 1 ? "row" : "rows"}
              {hasActiveFilter ? " · filtered" : ""}
            </Badge>
            {rows.length === 100 ? (
              <span className="text-[10px] text-muted-foreground">
                Showing first 100; tighten filters for older rows.
              </span>
            ) : null}
          </div>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No runs match. Create one from{" "}
              <code className="font-mono">/runs/new</code> or relax the filter.
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
                        {r.projectSlug ?? projectMap.get(r.projectId ?? "") ?? "—"}
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
