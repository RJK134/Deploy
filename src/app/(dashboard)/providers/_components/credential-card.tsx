import {
  CheckCircle2,
  CircleDashed,
  ExternalLink,
  ShieldX,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  disconnectCredentialAction,
  saveCredentialAction,
  verifyCredentialAction,
} from "@/app/(dashboard)/providers/actions";
import { CredentialForm } from "./credential-form";
import { cn } from "@/lib/utils";
import type {
  ConnectionState,
  ProviderKind,
} from "@/lib/db/schema";

type CardState = ConnectionState | "absent";

interface ProviderMeta {
  kind: ProviderKind;
  title: string;
  description: string;
  docs: { href: string; label: string };
  placeholder: string;
}

const STATE_STYLES: Record<
  CardState,
  { label: string; icon: LucideIcon; className: string }
> = {
  absent: {
    label: "Not connected",
    icon: CircleDashed,
    className: "text-muted-foreground border-border",
  },
  pending: {
    label: "Pending",
    icon: CircleDashed,
    className: "text-amber-600 border-amber-500/40 dark:text-amber-400",
  },
  verified: {
    label: "Verified",
    icon: CheckCircle2,
    className: "text-primary border-primary/40",
  },
  failed: {
    label: "Failed",
    icon: ShieldX,
    className: "text-destructive border-destructive/40",
  },
};

interface CredentialCardProps {
  meta: ProviderMeta;
  view: {
    lastFour: string;
    connectionState: ConnectionState;
    lastVerifiedAt: Date | null;
  } | null;
}

function formatRelative(date: Date | null): string | null {
  if (!date) return null;
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return date.toISOString().slice(0, 10);
}

export function CredentialCard({ meta, view }: CredentialCardProps) {
  const state: CardState = view?.connectionState ?? "absent";
  const style = STATE_STYLES[state];
  const StateIcon = style.icon;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="text-xs">{meta.title}</CardTitle>
          <p className="text-sm text-foreground/90">{meta.description}</p>
          <a
            href={meta.docs.href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {meta.docs.label}
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        </div>
        <Badge
          variant="outline"
          className={cn("gap-1 font-mono text-[10px] uppercase", style.className)}
        >
          <StateIcon className="h-3 w-3" aria-hidden />
          {style.label}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {view ? (
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="font-mono text-sm text-foreground">
              {view.lastFour}
            </span>
            {view.lastVerifiedAt ? (
              <span>
                Last verified{" "}
                <time dateTime={view.lastVerifiedAt.toISOString()}>
                  {formatRelative(view.lastVerifiedAt)}
                </time>
              </span>
            ) : (
              <span>Not yet verified</span>
            )}
          </div>
        ) : null}
        <Separator />
        <CredentialForm
          kind={meta.kind}
          hasCredential={view !== null}
          placeholder={meta.placeholder}
          saveAction={saveCredentialAction}
          verifyAction={verifyCredentialAction}
          disconnectAction={disconnectCredentialAction}
        />
      </CardContent>
    </Card>
  );
}

export const PROVIDER_META: ProviderMeta[] = [
  {
    kind: "github_pat",
    title: "GitHub",
    description:
      "Fine-grained personal access token with Contents (read & write), Pull requests, Workflows, and Metadata permissions for the repos you'll deploy.",
    docs: {
      href: "https://github.com/settings/personal-access-tokens/new",
      label: "Generate a token",
    },
    placeholder: "Paste your fine-grained personal access token here",
  },
  {
    kind: "vercel",
    title: "Vercel",
    description:
      "Personal or team access token. Scope it to the team that owns the projects you'll deploy.",
    docs: {
      href: "https://vercel.com/account/tokens",
      label: "Create a token",
    },
    placeholder: "Paste your Vercel access token here",
  },
  {
    kind: "neon",
    title: "Neon",
    description:
      "Neon API key from your account settings. Sessions 3+ will use this to provision per-deploy branches.",
    docs: {
      href: "https://console.neon.tech/app/settings/api-keys",
      label: "Issue an API key",
    },
    placeholder: "Paste your Neon API key here",
  },
];
