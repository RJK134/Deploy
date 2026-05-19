"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { CircleSlash, Loader2, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface IncidentActionsProps {
  dismissAction: (formData: FormData) => void;
  resolveAction: (formData: FormData) => void;
  id: string;
  isTerminal: boolean;
}

function DismissBtn() {
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
        <CircleSlash className="h-4 w-4" aria-hidden />
      )}
      {pending ? "Dismissing…" : "Dismiss"}
    </Button>
  );
}

function ResolveBtn() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending} aria-busy={pending}>
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <ShieldCheck className="h-4 w-4" aria-hidden />
      )}
      {pending ? "Resolving…" : "Resolve"}
    </Button>
  );
}

export function IncidentActions({
  dismissAction,
  resolveAction,
  id,
  isTerminal,
}: IncidentActionsProps) {
  const [note, setNote] = React.useState("");
  if (isTerminal) {
    return (
      <p className="text-xs text-muted-foreground">
        Incident is terminal. Open a fresh incident from a new monitor probe to
        replace it.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <form action={resolveAction} className="space-y-2">
        <input type="hidden" name="id" value={id} />
        <label className="space-y-1">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Resolution note (optional, audited)
          </span>
          <input
            name="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. rolled back to previous deployment"
            className={cn(
              "block w-full rounded-md border border-input bg-background px-2 py-1 text-xs",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            )}
          />
        </label>
        <div className="flex items-center gap-2">
          <ResolveBtn />
        </div>
      </form>
      <form action={dismissAction}>
        <input type="hidden" name="id" value={id} />
        <DismissBtn />
      </form>
    </div>
  );
}
