import {
  CheckCircle2,
  CircleAlert,
  ShieldCheck,
  ShieldX,
  type LucideIcon,
} from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  runReadinessChecks,
  summariseReadiness,
  type CheckStatus,
} from "@/lib/readiness/checks";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const STATUS_META: Record<
  CheckStatus,
  { label: string; icon: LucideIcon; className: string }
> = {
  ok: {
    label: "OK",
    icon: CheckCircle2,
    className: "text-primary border-primary/40",
  },
  warn: {
    label: "WARN",
    icon: CircleAlert,
    className: "text-amber-600 border-amber-500/40 dark:text-amber-400",
  },
  fail: {
    label: "FAIL",
    icon: ShieldX,
    className: "text-destructive border-destructive/40",
  },
};

export default async function ReadinessPage() {
  const results = await runReadinessChecks();
  const summary = summariseReadiness(results);

  return (
    <PageShell
      eyebrow="Operations"
      title="Live readiness"
      description="Pre-flight checks for the operator. Run before flipping DEPLOYOPS_LIVE to 1; fail-state items block live deploys, warn-state items just nudge."
      actions={
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={cn(
              "gap-1 font-mono text-[10px] uppercase",
              summary.blocking
                ? "text-destructive border-destructive/40"
                : summary.warn > 0
                  ? "text-amber-600 border-amber-500/40 dark:text-amber-400"
                  : "text-primary border-primary/40",
            )}
          >
            {summary.blocking ? (
              <ShieldX className="h-3 w-3" aria-hidden />
            ) : (
              <ShieldCheck className="h-3 w-3" aria-hidden />
            )}
            {summary.blocking
              ? "Not ready"
              : summary.warn > 0
                ? "Mostly ready"
                : "Ready"}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {summary.ok} OK · {summary.warn} warn · {summary.fail} fail
          </span>
        </div>
      }
    >
      <Card>
        <CardHeader>
          <CardTitle>Checks</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {results.map((r, idx) => {
            const meta = STATUS_META[r.status];
            const Icon = meta.icon;
            return (
              <div key={r.id}>
                <div className="flex flex-wrap items-start gap-3">
                  <div
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-md border",
                      meta.className,
                    )}
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{r.label}</span>
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {r.id}
                      </code>
                      <Badge
                        variant="outline"
                        className={cn(
                          "ml-auto font-mono text-[10px] uppercase",
                          meta.className,
                        )}
                      >
                        {meta.label}
                      </Badge>
                    </div>
                    <p className="text-sm text-foreground/90">{r.detail}</p>
                    {r.hint ? (
                      <p className="text-xs text-muted-foreground">
                        Hint: {r.hint}
                      </p>
                    ) : null}
                  </div>
                </div>
                {idx < results.length - 1 ? <Separator className="my-3" /> : null}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </PageShell>
  );
}
