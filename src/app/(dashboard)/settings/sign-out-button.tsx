import { LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth";

export function SignOutButton() {
  async function action() {
    "use server";
    await signOut({ redirectTo: "/signin" });
  }

  return (
    <form action={action}>
      <Button type="submit" variant="outline">
        <LogOut className="h-4 w-4" aria-hidden />
        Sign out
      </Button>
    </form>
  );
}
