import { cn } from "@/lib/utils";
import { CheckCircle2, CircleDashed, CircleDot, AlertTriangle, XCircle, Pause, Loader2 } from "lucide-react";

type Status =
  | "succeeded" | "running" | "pending" | "failed" | "queued" | "paused" | "skipped"
  | "connected" | "disconnected" | "partial" | "demo" | "live_ready"
  | "live" | "dry-run"
  /* Live Vercel deployment lifecycle. */
  | "live_pending" | "live_running" | "live_succeeded" | "live_failed" | "live_blocked"
  /* Validated dry-run plan (NOT a real deployment). */
  | "validated_dry_run" | "planned";

/* Honest labels:
 *   - DEMO         → seeded mock state, never made a real call
 *   - LIVE READY   → credentials present and validated, ready for live ops
 *   - LIVE CONNECTED → currently running a live op against the provider
 *   - DRY-RUN ...  → plan only, never a real deployment
 *   - LIVE ...     → real deployment lifecycle from Vercel/etc.
 * Dry-run runs MUST NOT use the generic "succeeded" label — they get
 * "dry-run · validated" or "dry-run · planned" so the UI never implies
 * a real deploy happened.
 */
const map: Record<string, { icon: any; tone: string; label?: string }> = {
  /* generic stage statuses (used for individual steps inside a run) */
  succeeded: { icon: CheckCircle2, tone: "text-emerald-500 bg-emerald-500/10 border-emerald-500/30" },
  running:   { icon: Loader2,     tone: "text-primary bg-primary/10 border-primary/30 [&_svg]:animate-spin" },
  pending:   { icon: CircleDashed, tone: "text-muted-foreground bg-muted/40 border-border" },
  failed:    { icon: XCircle,     tone: "text-destructive bg-destructive/10 border-destructive/30" },
  queued:    { icon: CircleDot,   tone: "text-muted-foreground bg-muted/40 border-border" },
  paused:    { icon: Pause,       tone: "text-amber-500 bg-amber-500/10 border-amber-500/30" },
  skipped:   { icon: CircleDashed, tone: "text-muted-foreground bg-muted/30 border-border", label: "skipped" },
  /* provider connection state */
  connected: { icon: CheckCircle2, tone: "text-emerald-500 bg-emerald-500/10 border-emerald-500/30", label: "live connected" },
  live_ready: { icon: CheckCircle2, tone: "text-emerald-500 bg-emerald-500/10 border-emerald-500/30", label: "live ready" },
  demo:      { icon: CircleDashed, tone: "text-muted-foreground bg-muted/40 border-dashed border-border", label: "demo" },
  disconnected: { icon: AlertTriangle, tone: "text-amber-500 bg-amber-500/10 border-amber-500/30", label: "not connected" },
  partial:   { icon: AlertTriangle, tone: "text-amber-500 bg-amber-500/10 border-amber-500/30" },
  /* mode badges */
  live:      { icon: CircleDot, tone: "text-primary bg-primary/10 border-primary/30" },
  "dry-run": { icon: CircleDashed, tone: "text-muted-foreground bg-muted/40 border-border" },
  /* live deployment lifecycle */
  live_pending: { icon: CircleDot, tone: "text-primary bg-primary/10 border-primary/30", label: "live · pending" },
  live_running: { icon: Loader2,  tone: "text-primary bg-primary/10 border-primary/30 [&_svg]:animate-spin", label: "live · building" },
  live_succeeded: { icon: CheckCircle2, tone: "text-emerald-500 bg-emerald-500/10 border-emerald-500/30", label: "live · ready" },
  live_failed: { icon: XCircle, tone: "text-destructive bg-destructive/10 border-destructive/30", label: "live · failed" },
  live_blocked: { icon: AlertTriangle, tone: "text-amber-500 bg-amber-500/10 border-amber-500/30", label: "live · blocked" },
  /* dry-run lifecycle (NEVER green "succeeded"; muted to make non-deploy obvious) */
  validated_dry_run: { icon: CheckCircle2, tone: "text-muted-foreground bg-muted/40 border-border", label: "dry-run · validated" },
  planned: { icon: CircleDashed, tone: "text-muted-foreground bg-muted/40 border-border", label: "dry-run · planned" },
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
