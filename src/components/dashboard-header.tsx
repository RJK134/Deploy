import Link from "next/link";

import { ThemeToggle } from "@/components/theme-toggle";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface DashboardHeaderProps {
  user: { email?: string | null; image?: string | null; name?: string | null };
}

function initials(input?: string | null): string {
  if (!input) return "??";
  const trimmed = input.trim();
  if (!trimmed) return "??";
  const parts = trimmed.split(/[\s@.]+/).filter(Boolean);
  if (parts.length === 0) return trimmed.slice(0, 2).toUpperCase();
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

export function DashboardHeader({ user }: DashboardHeaderProps) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border bg-background/85 px-6 backdrop-blur">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-mono uppercase tracking-[0.18em]">console</span>
        <span aria-hidden>/</span>
        <span className="font-medium text-foreground">workspace</span>
      </div>
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <Link
          href="/settings"
          aria-label="Account settings"
          className="rounded-full ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Avatar>
            {user.image ? (
              <AvatarImage src={user.image} alt={user.name ?? user.email ?? "User"} />
            ) : null}
            <AvatarFallback>{initials(user.name ?? user.email)}</AvatarFallback>
          </Avatar>
        </Link>
      </div>
    </header>
  );
}
