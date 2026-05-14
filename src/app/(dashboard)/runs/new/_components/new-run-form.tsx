"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { Loader2, PlayCircle, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ProjectOption {
  id: string;
  slug: string;
  defaultBlueprintId: string | null;
}

interface BlueprintOption {
  id: string;
  slug: string;
  name: string;
}

interface NewRunFormProps {
  action: (formData: FormData) => void;
  projects: ProjectOption[];
  blueprints: BlueprintOption[];
  liveModeAllowed: boolean;
  liveModeBlockedReason?: string;
}

function Submit({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled} aria-busy={pending}>
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <PlayCircle className="h-4 w-4" aria-hidden />
      )}
      {pending ? "Planning…" : "Create run"}
    </Button>
  );
}

const inputClass = cn(
  "block w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
);

export function NewRunForm({
  action,
  projects,
  blueprints,
  liveModeAllowed,
  liveModeBlockedReason,
}: NewRunFormProps) {
  const disabled = projects.length === 0 || blueprints.length === 0;
  const [liveChecked, setLiveChecked] = React.useState(false);

  return (
    <form action={action} className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <label
            htmlFor="new-run-project"
            className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
          >
            Project
          </label>
          <select
            id="new-run-project"
            name="projectId"
            required
            className={inputClass}
            defaultValue=""
          >
            <option value="" disabled>
              Pick a project…
            </option>
            {projects.map((p) => (
              <option
                key={p.id}
                value={p.id}
                data-default-blueprint={p.defaultBlueprintId ?? ""}
              >
                {p.slug}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label
            htmlFor="new-run-blueprint"
            className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
          >
            Blueprint
          </label>
          <select
            id="new-run-blueprint"
            name="blueprintId"
            required
            className={inputClass}
            defaultValue=""
          >
            <option value="" disabled>
              Pick a blueprint…
            </option>
            {blueprints.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label
            htmlFor="new-run-environment"
            className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
          >
            Environment
          </label>
          <select
            id="new-run-environment"
            name="environment"
            required
            className={inputClass}
            defaultValue="test"
          >
            <option value="test">test</option>
            <option value="demo">demo</option>
            <option value="deploy">deploy</option>
          </select>
        </div>
      </div>

      <div
        className={cn(
          "flex flex-col gap-2 rounded-md border p-3 text-xs",
          liveChecked
            ? "border-destructive/40 bg-destructive/5"
            : "border-border",
        )}
      >
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            name="liveMode"
            value="1"
            checked={liveModeAllowed ? liveChecked : false}
            onChange={(e) => setLiveChecked(e.target.checked)}
            disabled={!liveModeAllowed}
            className="h-3.5 w-3.5"
          />
          <span className="text-sm font-medium">Live mode</span>
          <span className="text-muted-foreground">
            (mutates real GitHub / Vercel / Neon resources for verified
            providers)
          </span>
        </label>
        {!liveModeAllowed ? (
          <p className="flex items-start gap-1.5 text-muted-foreground">
            <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
            {liveModeBlockedReason ??
              "Live mode is unavailable. DEPLOYOPS_LIVE must be 1 and all three providers must be verified."}
          </p>
        ) : liveChecked ? (
          <p className="flex items-start gap-1.5 text-destructive">
            <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
            Live mode will call provider APIs with the stored credentials.
            Destructive operations (deployment trigger, branch creation) are
            still deferred to Session 7 — but read-only probes WILL be made.
          </p>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Without &ldquo;Live mode&rdquo;, the run uses the dry-run simulator —
          every stage produces realistic output without calling any external
          API.
        </p>
        <Submit disabled={disabled} />
      </div>

      {disabled ? (
        <p className="text-xs text-muted-foreground">
          {projects.length === 0
            ? "Add a project first."
            : "No blueprints found."}
        </p>
      ) : null}
    </form>
  );
}
