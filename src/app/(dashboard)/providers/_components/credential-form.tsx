"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Save, ShieldCheck, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ActionButtonProps {
  variant?: "default" | "outline" | "destructive";
  children: React.ReactNode;
  icon?: React.ReactNode;
  pendingLabel?: string;
}

function ActionButton({
  variant = "default",
  children,
  icon,
  pendingLabel,
}: ActionButtonProps) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={variant}
      size="sm"
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}

interface CredentialFormProps {
  kind: "github_pat" | "vercel" | "neon";
  hasCredential: boolean;
  placeholder: string;
  saveAction: (formData: FormData) => void;
  verifyAction: (formData: FormData) => void;
  disconnectAction: (formData: FormData) => void;
}

export function CredentialForm({
  kind,
  hasCredential,
  placeholder,
  saveAction,
  verifyAction,
  disconnectAction,
}: CredentialFormProps) {
  // The Save and Verify/Disconnect rows are separate forms so each posts
  // exactly one action with the right field set.
  const [value, setValue] = React.useState("");

  function confirmDisconnect(event: React.FormEvent<HTMLFormElement>) {
    if (
      !window.confirm(
        "Disconnect this provider and delete the encrypted credential?",
      )
    ) {
      event.preventDefault();
    }
  }

  return (
    <div className="space-y-3">
      <form action={saveAction} className="space-y-2">
        <input type="hidden" name="kind" value={kind} />
        <label
          htmlFor={`credential-${kind}`}
          className="sr-only"
        >
          {kind} token
        </label>
        <textarea
          id={`credential-${kind}`}
          name="plaintext"
          required
          rows={3}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          className={cn(
            "block w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            "placeholder:text-muted-foreground/60",
          )}
          autoComplete="off"
          spellCheck={false}
        />
        <div className="flex flex-wrap items-center gap-2">
          <ActionButton
            icon={<Save className="h-4 w-4" aria-hidden />}
            pendingLabel="Saving…"
          >
            Save
          </ActionButton>
          {hasCredential ? (
            <span className="text-xs text-muted-foreground">
              Saving replaces the current credential and resets state to pending.
            </span>
          ) : null}
        </div>
      </form>

      {hasCredential ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <form action={verifyAction}>
            <input type="hidden" name="kind" value={kind} />
            <ActionButton
              variant="outline"
              icon={<ShieldCheck className="h-4 w-4" aria-hidden />}
              pendingLabel="Verifying…"
            >
              Verify
            </ActionButton>
          </form>
          <form
            action={disconnectAction}
            onSubmit={confirmDisconnect}
            className="ml-auto"
          >
            <input type="hidden" name="kind" value={kind} />
            <ActionButton
              variant="destructive"
              icon={<Trash2 className="h-4 w-4" aria-hidden />}
              pendingLabel="Removing…"
            >
              Disconnect
            </ActionButton>
          </form>
        </div>
      ) : null}
    </div>
  );
}
