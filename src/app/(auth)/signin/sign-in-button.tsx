import { Github } from "lucide-react";

import { Button } from "@/components/ui/button";
import { signIn } from "@/lib/auth";

export function SignInButton({ callbackUrl }: { callbackUrl?: string }) {
  async function action() {
    "use server";
    await signIn("github", { redirectTo: callbackUrl ?? "/" });
  }

  return (
    <form action={action}>
      <Button type="submit" size="lg" className="w-full">
        <Github className="h-4 w-4" aria-hidden />
        Sign in with GitHub
      </Button>
    </form>
  );
}
