"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ProviderIdsFormProps {
  action: (formData: FormData) => void;
  projectId: string;
  currentVercelProjectId: string | null;
  currentVercelTeamId: string | null;
  currentNeonProjectId: string | null;
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
      {pending ? "Saving…" : "Save provider IDs"}
    </Button>
  );
}

const inputClass = cn(
  "block w-full rounded-md border border-input bg-background px-2 py-1 font-mono text-xs",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
);

export function ProviderIdsForm({
  action,
  projectId,
  currentVercelProjectId,
  currentVercelTeamId,
  currentNeonProjectId,
}: ProviderIdsFormProps) {
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="projectId" value={projectId} />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="space-y-1">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Vercel project ID
          </span>
          <input
            name="vercelProjectId"
            defaultValue={currentVercelProjectId ?? ""}
            placeholder="prj_xxxx"
            autoComplete="off"
            spellCheck={false}
            className={inputClass}
          />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Vercel team ID
          </span>
          <input
            name="vercelTeamId"
            defaultValue={currentVercelTeamId ?? ""}
            placeholder="team_xxxx (optional)"
            autoComplete="off"
            spellCheck={false}
            className={inputClass}
          />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Neon project ID
          </span>
          <input
            name="neonProjectId"
            defaultValue={currentNeonProjectId ?? ""}
            placeholder="xxxx-xxxx-12345678"
            autoComplete="off"
            spellCheck={false}
            className={inputClass}
          />
        </label>
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Required for live mode to mutate real Vercel deployments and Neon
          branches. Empty fields mean &ldquo;not yet wired&rdquo;.
        </p>
        <Submit />
      </div>
    </form>
  );
}
