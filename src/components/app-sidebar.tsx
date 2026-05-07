"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Boxes,
  GitBranch,
  Globe,
  KeyRound,
  LayoutGrid,
  LayoutTemplate,
  Map,
  Network,
  PlayCircle,
  Plug,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Logo } from "@/components/logo";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  disabled?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const groups: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      { label: "Overview", href: "/", icon: LayoutGrid },
      { label: "Projects", href: "/projects", icon: Boxes },
      { label: "New deploy", href: "/runs/new", icon: PlayCircle, disabled: true },
      { label: "Runs", href: "/runs", icon: Activity },
    ],
  },
  {
    label: "Library",
    items: [
      { label: "Blueprints", href: "/blueprints", icon: LayoutTemplate },
      { label: "Pipelines", href: "/pipelines", icon: Workflow },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Access & domains", href: "/access", icon: KeyRound },
      { label: "Connection Center", href: "/providers", icon: Plug },
      { label: "Live Readiness", href: "/readiness", icon: ShieldCheck, disabled: true },
      { label: "Fix Bot", href: "/fixbot", icon: Sparkles, disabled: true },
    ],
  },
  {
    label: "Production",
    items: [
      { label: "Architecture", href: "/architecture", icon: Network, disabled: true },
      { label: "Migration plan", href: "/migration", icon: Map, disabled: true },
    ],
  },
];

interface AppSidebarProps {
  branch: string;
  liveMode: boolean;
}

export function AppSidebar({ branch, liveMode }: AppSidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      className="dark fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex"
      aria-label="Primary navigation"
    >
      <div className="flex h-14 items-center gap-2 px-4">
        <Logo size={24} />
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold tracking-tight">DeployOps</span>
          <span className="text-[10px] uppercase tracking-[0.18em] text-sidebar-muted">
            Console
          </span>
        </div>
      </div>

      <nav
        className="flex-1 space-y-6 overflow-y-auto px-3 py-4"
        aria-label="Sections"
      >
        {groups.map((group) => (
          <div key={group.label}>
            <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-sidebar-muted">
              {group.label}
            </div>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active =
                  pathname === item.href ||
                  (item.href !== "/" && pathname.startsWith(`${item.href}/`));
                const className = cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  item.disabled && "cursor-not-allowed opacity-50 hover:bg-transparent hover:text-sidebar-foreground/80",
                );
                return (
                  <li key={item.href}>
                    {item.disabled ? (
                      <span
                        className={className}
                        aria-disabled
                        aria-label={`${item.label} (coming soon)`}
                        title="Coming in a later session"
                      >
                        <Icon className="h-4 w-4" aria-hidden />
                        <span className="flex-1">{item.label}</span>
                        <span className="text-[10px] uppercase tracking-wider text-sidebar-muted">
                          soon
                        </span>
                      </span>
                    ) : (
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        aria-label={item.label}
                        className={className}
                      >
                        <Icon className="h-4 w-4" aria-hidden />
                        <span>{item.label}</span>
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-sidebar-border p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs text-sidebar-muted">
            <GitBranch className="h-3.5 w-3.5" aria-hidden />
            <span className="font-mono" title={`Current branch: ${branch}`}>
              {branch}
            </span>
          </div>
          <Badge
            variant="outline"
            className={cn(
              "border-sidebar-border text-[10px] uppercase tracking-wider",
              liveMode
                ? "border-primary/40 text-primary"
                : "text-sidebar-muted",
            )}
          >
            <Globe className="mr-1 h-3 w-3" aria-hidden />
            {liveMode ? "live" : "dry-run"}
          </Badge>
        </div>
      </div>
    </aside>
  );
}
