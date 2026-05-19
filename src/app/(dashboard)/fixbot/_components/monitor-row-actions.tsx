"use client";

import { useFormStatus } from "react-dom";
import { Loader2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";

interface DeleteMonitorButtonProps {
  action: (formData: FormData) => void;
  id: string;
  label: string;
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="ghost"
      size="sm"
      disabled={pending}
      aria-busy={pending}
      aria-label={`Delete ${label}`}
    >
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      ) : (
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
      )}
    </Button>
  );
}

export function DeleteMonitorButton({
  action,
  id,
  label,
}: DeleteMonitorButtonProps) {
  function confirmDelete(event: React.FormEvent<HTMLFormElement>) {
    if (
      !window.confirm(
        `Delete monitor '${label}'? Open incidents for this monitor are preserved.`,
      )
    ) {
      event.preventDefault();
    }
  }

  return (
    <form action={action} onSubmit={confirmDelete}>
      <input type="hidden" name="id" value={id} />
      <Submit label={label} />
    </form>
  );
}
