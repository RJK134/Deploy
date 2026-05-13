"use client";

import { useFormStatus } from "react-dom";
import { Loader2, PlayCircle } from "lucide-react";

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
      {pending ? "Planning…" : "Create dry-run"}
    </Button>
  );
}

const inputClass = cn(
  "block w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
);

export function NewRunForm({ action, projects, blueprints }: NewRunFormProps) {
  const disabled = projects.length === 0 || blueprints.length === 0;

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

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Creates a dry-run row with one stage per blueprint step. Nothing
          calls GitHub, Vercel, or Neon — Session 5 wires the real adapters.
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
