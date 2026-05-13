"use client";

import { useFormStatus } from "react-dom";
import { Loader2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";

interface RemoveProjectButtonProps {
  action: (formData: FormData) => void;
  id: string;
  slug: string;
}

function Submit({ slug }: { slug: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="ghost"
      size="sm"
      disabled={pending}
      aria-busy={pending}
      aria-label={`Remove ${slug}`}
    >
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <Trash2 className="h-4 w-4" aria-hidden />
      )}
    </Button>
  );
}

export function RemoveProjectButton({
  action,
  id,
  slug,
}: RemoveProjectButtonProps) {
  function confirmRemove(event: React.FormEvent<HTMLFormElement>) {
    if (
      !window.confirm(
        `Remove ${slug} from DeployOps? Existing deploys aren't affected; the project just stops appearing here.`,
      )
    ) {
      event.preventDefault();
    }
  }

  return (
    <form action={action} onSubmit={confirmRemove}>
      <input type="hidden" name="id" value={id} />
      <Submit slug={slug} />
    </form>
  );
}
