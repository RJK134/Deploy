"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface AccessFormProps {
  action: (formData: FormData) => void;
  projectId: string;
  currentAccessMode: "public" | "client" | "private";
  currentCustomDomain: string | null;
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
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      ) : null}
      {pending ? "Saving…" : "Save"}
    </Button>
  );
}

const inputClass = cn(
  "block w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
);

export function AccessForm({
  action,
  projectId,
  currentAccessMode,
  currentCustomDomain,
}: AccessFormProps) {
  return (
    <form
      action={action}
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
    >
      <input type="hidden" name="projectId" value={projectId} />
      <div className="space-y-1">
        <label
          htmlFor={`access-mode-${projectId}`}
          className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
        >
          Access mode
        </label>
        <select
          id={`access-mode-${projectId}`}
          name="accessMode"
          defaultValue={currentAccessMode}
          className={cn(inputClass, "min-w-[8rem]")}
        >
          <option value="private">private</option>
          <option value="client">client</option>
          <option value="public">public</option>
        </select>
      </div>
      <div className="flex-1 space-y-1">
        <label
          htmlFor={`custom-domain-${projectId}`}
          className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
        >
          Custom domain (optional)
        </label>
        <input
          id={`custom-domain-${projectId}`}
          name="customDomain"
          defaultValue={currentCustomDomain ?? ""}
          placeholder="app.example.com"
          autoComplete="off"
          spellCheck={false}
          className={inputClass}
        />
      </div>
      <Submit />
    </form>
  );
}
