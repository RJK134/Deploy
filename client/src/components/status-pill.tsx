import { cn } from "@/lib/utils";
import { CheckCircle2, CircleDashed, CircleDot, AlertTriangle, XCircle, Pause, Loader2 } from "lucide-react";

type Status =
  | "succeeded" | "running" | "pending" | "failed" | "queued" | "paused" | "skipped"
  | "connected" | "disconnected" | "partial"
  | "live" | "dry-run"
  /* Live Vercel deployment lifecycle. */
  | "live_pending" | "live_running" | "live_succeeded" | "live_failed" | "live_blocked"
  /* Validated dry-run plan (NOT a real deployment). */
  | "validated_dry_run";

const map: Record<string, { icon: any; tone: string; label?: string }> = {
  succeeded: { icon: CheckCircle2, tone: "text-emerald-500 bg-emerald-500/10 border-emerald-500/30" },
  running:   { icon: Loader2,     tone: "text-primary bg-primary/10 border-primary/30 [&_svg]:animate-spin" },
  pending:   { icon: CircleDashed, tone: "text-muted-foreground bg-muted/40 border-border" },
  failed:    { icon: XCircle,     tone: "text-destructive bg-destructive/10 border-destructive/30" },
  queued:    { icon: CircleDot,   tone: "text-muted-foreground bg-muted/40 border-border" },
  paused:    { icon: Pause,       tone: "text-amber-500 bg-amber-500/10 border-amber-500/30" },
  skipped:   { icon: CircleDashed, tone: "text-muted-foreground bg-muted/30 border-border", label: "skipped" },
  connected: { icon: CheckCircle2, tone: "text-emerald-500 bg-emerald-500/10 border-emerald-500/30" },
  disconnected: { icon: AlertTriangle, tone: "text-amber-500 bg-amber-500/10 border-amber-500/30" },
  partial:   { icon: AlertTriangle, tone: "text-amber-500 bg-amber-500/10 border-amber-500/30" },
  live:      { icon: CircleDot, tone: "text-primary bg-primary/10 border-primary/30" },
  "dry-run": { icon: CircleDashed, tone: "text-muted-foreground bg-muted/40 border-border" },
  live_pending: { icon: CircleDot, tone: "text-primary bg-primary/10 border-primary/30", label: "live · pending" },
  live_running: { icon: Loader2,  tone: "text-primary bg-primary/10 border-primary/30 [&_svg]:animate-spin", label: "live · building" },
  live_succeeded: { icon: CheckCircle2, tone: "text-emerald-500 bg-emerald-500/10 border-emerald-500/30", label: "live · ready" },
  live_failed: { icon: XCircle, tone: "text-destructive bg-destructive/10 border-destructive/30", label: "live · failed" },
  live_blocked: { icon: AlertTriangle, tone: "text-amber-500 bg-amber-500/10 border-amber-500/30", label: "live · blocked" },
  validated_dry_run: { icon: CheckCircle2, tone: "text-muted-foreground bg-muted/40 border-border", label: "dry-run · validated" },
};

export function StatusPill({ status, className }: { status: Status; className?: string }) {
  const m = map[status] ?? map.pending;
  const Icon = m.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-mono uppercase tracking-wide",
        m.tone,
        className,
      )}
      data-testid={`status-${status}`}
    >
      <Icon className="h-3 w-3" />
      {m.label ?? status}
    </span>
  );
}
