"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ProjectOption {
  id: string;
  slug: string;
}

interface MonitorFormProps {
  action: (formData: FormData) => void;
  projects: ProjectOption[];
}

const inputClass = cn(
  "block w-full rounded-md border border-input bg-background px-2 py-1 text-xs",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
);

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending} aria-busy={pending}>
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <Plus className="h-4 w-4" aria-hidden />
      )}
      {pending ? "Saving…" : "Add monitor"}
    </Button>
  );
}

export function MonitorForm({ action, projects }: MonitorFormProps) {
  const [kind, setKind] = React.useState<
    "http" | "build" | "workflow" | "env" | "domain" | "migration"
  >("http");

  return (
    <form action={action} className="space-y-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="space-y-1">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Project
          </span>
          <select name="projectId" className={inputClass} defaultValue="">
            <option value="">— global —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.slug}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Kind
          </span>
          <select
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
            className={inputClass}
          >
            <option value="http">http</option>
            <option value="build">build</option>
            <option value="workflow">workflow</option>
            <option value="env">env (no analyzer yet)</option>
            <option value="domain">domain (no analyzer yet)</option>
            <option value="migration">migration (no analyzer yet)</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Label
          </span>
          <input
            name="label"
            required
            maxLength={80}
            placeholder="e.g. herm-platform /api/health"
            className={inputClass}
          />
        </label>
      </div>

      {kind === "http" ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <label className="space-y-1 sm:col-span-2">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              URL
            </span>
            <input
              name="httpUrl"
              type="url"
              required
              placeholder="https://herm-platform.vercel.app/api/health"
              className={inputClass}
            />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Expected status
            </span>
            <input
              name="httpExpectedStatus"
              type="number"
              min={100}
              max={599}
              defaultValue={200}
              className={inputClass}
            />
          </label>
          <label className="space-y-1 sm:col-span-3">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Body must contain (optional)
            </span>
            <input
              name="httpExpectedBody"
              placeholder='e.g. "ok":true'
              className={inputClass}
            />
          </label>
        </div>
      ) : null}

      {kind === "build" ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <label className="space-y-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Inspect count (1–5)
            </span>
            <input
              name="buildInspectCount"
              type="number"
              min={1}
              max={5}
              defaultValue={1}
              className={inputClass}
            />
          </label>
          <p className="self-end text-xs text-muted-foreground sm:col-span-2">
            Requires the project to have a Vercel project ID set and the
            Vercel credential verified.
          </p>
        </div>
      ) : null}

      {kind === "workflow" ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <label className="space-y-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Workflow file (optional)
            </span>
            <input
              name="workflowId"
              placeholder="deployops.yml"
              className={inputClass}
            />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Branch (optional)
            </span>
            <input
              name="workflowBranch"
              placeholder="main"
              className={inputClass}
            />
          </label>
          <p className="self-end text-xs text-muted-foreground">
            Requires the GitHub PAT verified.
          </p>
        </div>
      ) : null}

      <div className="flex items-center justify-end">
        <Submit />
      </div>
    </form>
  );
}
