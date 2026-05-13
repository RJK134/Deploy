"use client";

import { useFormStatus } from "react-dom";
import { FastForward, Loader2, StepForward } from "lucide-react";

import { Button } from "@/components/ui/button";

interface AdvanceButtonsProps {
  runId: string;
  advanceAction: (formData: FormData) => void;
  autoAdvanceAction: (formData: FormData) => void;
  disabled: boolean;
  disabledReason?: string;
}

function StepBtn() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="outline"
      size="sm"
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <StepForward className="h-4 w-4" aria-hidden />
      )}
      {pending ? "Advancing…" : "Advance one"}
    </Button>
  );
}

function AutoBtn() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending} aria-busy={pending}>
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <FastForward className="h-4 w-4" aria-hidden />
      )}
      {pending ? "Auto-advancing…" : "Auto-advance"}
    </Button>
  );
}

export function AdvanceButtons({
  runId,
  advanceAction,
  autoAdvanceAction,
  disabled,
  disabledReason,
}: AdvanceButtonsProps) {
  if (disabled) {
    return (
      <p className="text-xs text-muted-foreground">
        {disabledReason ?? "Run is terminal."}
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action={advanceAction}>
        <input type="hidden" name="runId" value={runId} />
        <StepBtn />
      </form>
      <form action={autoAdvanceAction}>
        <input type="hidden" name="runId" value={runId} />
        <AutoBtn />
      </form>
    </div>
  );
}
