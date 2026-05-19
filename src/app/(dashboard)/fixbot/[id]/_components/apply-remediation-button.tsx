"use client";

import { useFormStatus } from "react-dom";
import { Loader2, Wand2 } from "lucide-react";

import { Button } from "@/components/ui/button";

interface ApplyRemediationButtonProps {
  action: (formData: FormData) => void;
  remediationId: string;
  incidentId: string;
  verb: string;
  mutates: boolean;
  disabled?: boolean;
  disabledReason?: string;
}

function Submit({
  verb,
  mutates,
}: {
  verb: string;
  mutates: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="sm"
      variant={mutates ? "default" : "outline"}
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      ) : (
        <Wand2 className="h-3.5 w-3.5" aria-hidden />
      )}
      {pending ? "Applying…" : `Apply ${verb}`}
    </Button>
  );
}

export function ApplyRemediationButton({
  action,
  remediationId,
  incidentId,
  verb,
  mutates,
  disabled,
  disabledReason,
}: ApplyRemediationButtonProps) {
  function confirmApply(event: React.FormEvent<HTMLFormElement>) {
    if (!mutates) return;
    if (
      !window.confirm(
        `Apply '${verb}'? This will call a provider API and mutate real infrastructure.`,
      )
    ) {
      event.preventDefault();
    }
  }

  if (disabled) {
    return (
      <p className="text-[10px] text-muted-foreground">
        {disabledReason ?? "Apply is not available for this remediation."}
      </p>
    );
  }

  return (
    <form action={action} onSubmit={confirmApply}>
      <input type="hidden" name="remediationId" value={remediationId} />
      <input type="hidden" name="incidentId" value={incidentId} />
      <Submit verb={verb} mutates={mutates} />
    </form>
  );
}
