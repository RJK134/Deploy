"use client";

import { useFormStatus } from "react-dom";
import { Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface AddProjectFormProps {
  action: (formData: FormData) => void;
  disabled?: boolean;
  disabledReason?: string;
}

function SubmitButton({ disabled }: { disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="sm"
      disabled={pending || disabled}
      aria-busy={pending}
    >
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <Plus className="h-4 w-4" aria-hidden />
      )}
      {pending ? "Adding…" : "Add project"}
    </Button>
  );
}

export function AddProjectForm({
  action,
  disabled,
  disabledReason,
}: AddProjectFormProps) {
  return (
    <form action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex-1 space-y-1">
        <label
          htmlFor="add-project-repo"
          className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
        >
          GitHub repo
        </label>
        <input
          id="add-project-repo"
          name="repo"
          required
          placeholder="RJK134/herm-platform or full GitHub URL"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          className={cn(
            "block w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            "placeholder:text-muted-foreground/60",
            "disabled:cursor-not-allowed disabled:opacity-60",
          )}
        />
        {disabled && disabledReason ? (
          <p className="text-xs text-muted-foreground">{disabledReason}</p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Accepts <code className="font-mono">owner/repo</code> or a full
            GitHub URL. If a verified GitHub PAT is connected, the default
            branch is fetched automatically.
          </p>
        )}
      </div>
      <SubmitButton disabled={disabled} />
    </form>
  );
}
