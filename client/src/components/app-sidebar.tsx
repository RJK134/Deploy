import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Workflow, BookMarked, Activity, Globe2, Plug,
  GitBranch, Sparkles, ShieldAlert, Cloud, GitMerge, Zap, Box,
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader, SidebarFooter,
} from "@/components/ui/sidebar";
import { Wordmark } from "@/components/logo";
import { Badge } from "@/components/ui/badge";

const sections = [
  {
    label: "Workspace",
    items: [
      { title: "Overview",    url: "/",           icon: LayoutDashboard, testId: "nav-overview" },
      { title: "Projects",    url: "/projects",   icon: Box,             testId: "nav-projects" },
      { title: "New deploy",  url: "/wizard",     icon: Sparkles,        testId: "nav-wizard" },
      { title: "Runs",        url: "/runs",       icon: Activity,        testId: "nav-runs" },
    ],
  },
  {
    label: "Library",
    items: [
      { title: "Blueprints",  url: "/blueprints", icon: BookMarked,      testId: "nav-blueprints" },
      { title: "Pipelines",   url: "/pipelines",  icon: Workflow,        testId: "nav-pipelines" },
    ],
  },
  {
    label: "Operations",
    items: [
      { title: "Access & domains", url: "/access",    icon: Globe2,      testId: "nav-access" },
      { title: "Connection Center",url: "/providers", icon: Plug,        testId: "nav-providers" },
      { title: "Live Readiness",   url: "/readiness", icon: Zap,         testId: "nav-readiness" },
      { title: "Fix Bot",          url: "/fixbot",    icon: ShieldAlert, testId: "nav-fixbot" },
    ],
  },
  {
    label: "Production",
    items: [
      { title: "Architecture",   url: "/architecture", icon: Cloud,    testId: "nav-architecture" },
      { title: "Migration plan", url: "/migration",    icon: GitMerge, testId: "nav-migration" },
    ],
  },
];

export function AppSidebar() {
  const [location] = useLocation();
  return (
    <Sidebar collapsible="icon" data-testid="sidebar-main">
      <SidebarHeader className="border-b border-sidebar-border">
        <Link href="/" className="flex items-center gap-2 px-2 py-2 rounded-md hover-elevate" data-testid="link-home">
          <Wordmark />
        </Link>
      </SidebarHeader>

      <SidebarContent>
        {sections.map((section) => (
          <SidebarGroup key={section.label}>
            <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
              {section.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => {
                  const active = location === item.url;
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild isActive={active} data-testid={item.testId}>
                        <Link href={item.url} className="flex items-center gap-2">
                          <item.icon className="h-4 w-4" />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <div className="px-2 py-2 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-muted-foreground">
            <GitBranch className="h-3.5 w-3.5" />
            <span className="font-mono">main</span>
          </div>
          <Badge variant="outline" className="font-mono text-[10px]">
            DRY-RUN
          </Badge>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
