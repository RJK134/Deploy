"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface BlueprintOption {
  id: string;
  slug: string;
  name: string;
}

interface BlueprintSelectProps {
  action: (formData: FormData) => void;
  projectId: string;
  current: string | null;
  options: BlueprintOption[];
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="outline"
      size="sm"
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
      {pending ? "Saving…" : "Save"}
    </Button>
  );
}

export function BlueprintSelect({
  action,
  projectId,
  current,
  options,
}: BlueprintSelectProps) {
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <label
        htmlFor={`blueprint-${projectId}`}
        className="text-[10px] uppercase tracking-wide text-muted-foreground"
      >
        Blueprint
      </label>
      <select
        id={`blueprint-${projectId}`}
        name="blueprintId"
        defaultValue={current ?? ""}
        className={cn(
          "rounded-md border border-input bg-background px-2 py-1 font-mono text-xs",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        )}
      >
        <option value="">— none —</option>
        {options.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.name}
          </option>
        ))}
      </select>
      <Submit />
    </form>
  );
}
