import {
  CheckCircle2,
  CircleDashed,
  CircleSlash,
  Loader2,
  ShieldX,
  SkipForward,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { RunStatus, StageStatus } from "@/lib/pipeline/stages";

type Status = RunStatus | StageStatus;

const STATUS_STYLES: Record<Status, { icon: LucideIcon; className: string }> = {
  pending: {
    icon: CircleDashed,
    className: "text-muted-foreground border-border",
  },
  running: {
    icon: Loader2,
    className: "text-amber-600 border-amber-500/40 dark:text-amber-400",
  },
  succeeded: {
    icon: CheckCircle2,
    className: "text-primary border-primary/40",
  },
  failed: {
    icon: ShieldX,
    className: "text-destructive border-destructive/40",
  },
  cancelled: {
    icon: CircleSlash,
    className: "text-muted-foreground border-border",
  },
  skipped: {
    icon: SkipForward,
    className: "text-muted-foreground border-border line-through",
  },
};

interface RunStatusPillProps {
  status: Status;
  className?: string;
}

export function RunStatusPill({ status, className }: RunStatusPillProps) {
  const style = STATUS_STYLES[status];
  const Icon = style.icon;
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 font-mono text-[10px] uppercase",
        style.className,
        className,
      )}
    >
      <Icon
        className={cn(
          "h-3 w-3",
          status === "running" ? "animate-spin" : "",
        )}
        aria-hidden
      />
      {status}
    </Badge>
  );
}
