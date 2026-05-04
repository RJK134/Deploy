import { SiGithub, SiVercel, SiPrisma, SiRailway } from "react-icons/si";
import { Database } from "lucide-react";

const map: Record<string, any> = {
  github: SiGithub,
  vercel: SiVercel,
  prisma: SiPrisma,
  railway: SiRailway,
};

export function ProviderIcon({ provider, className = "h-4 w-4" }: { provider: string; className?: string }) {
  if (provider === "neon") {
    /* Neon doesn't have an SI icon — use Database. */
    return <Database className={className} aria-label="Neon" />;
  }
  const Icon = map[provider];
  if (!Icon) return null;
  return <Icon className={className} aria-label={provider} />;
}

export function providerLabel(p: string) {
  switch (p) {
    case "github": return "GitHub";
    case "vercel": return "Vercel";
    case "neon": return "Neon Postgres";
    case "prisma": return "Prisma Postgres";
    case "railway": return "Railway";
    default: return p;
  }
}
