import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "@/lib/theme";
import { ThemeToggle } from "@/components/theme-toggle";
import NotFound from "@/pages/not-found";
import Overview from "@/pages/overview";
import Wizard from "@/pages/wizard";
import Blueprints from "@/pages/blueprints";
import Pipelines from "@/pages/pipelines";
import Runs from "@/pages/runs";
import RunDetail from "@/pages/run-detail";
import Access from "@/pages/access";
import Providers from "@/pages/providers";
import Architecture from "@/pages/architecture";
import Migration from "@/pages/migration";
import FixBot from "@/pages/fixbot";
import Readiness from "@/pages/readiness";

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Overview} />
      <Route path="/wizard" component={Wizard} />
      <Route path="/blueprints" component={Blueprints} />
      <Route path="/pipelines" component={Pipelines} />
      <Route path="/runs" component={Runs} />
      <Route path="/runs/:id" component={RunDetail} />
      <Route path="/access" component={Access} />
      <Route path="/providers" component={Providers} />
      <Route path="/readiness" component={Readiness} />
      <Route path="/architecture" component={Architecture} />
      <Route path="/migration" component={Migration} />
      <Route path="/fixbot" component={FixBot} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  const style = {
    "--sidebar-width": "16.5rem",
    "--sidebar-width-icon": "3.25rem",
  };
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <SidebarProvider style={style as React.CSSProperties}>
            <div className="flex h-screen w-full bg-background">
              <AppSidebar />
              <div className="flex flex-col flex-1 min-w-0">
                <header className="flex items-center justify-between gap-2 px-4 h-12 border-b border-border bg-background/95 backdrop-blur">
                  <div className="flex items-center gap-2">
                    <SidebarTrigger data-testid="button-sidebar-toggle" />
                    <div className="hidden md:block text-xs text-muted-foreground font-mono">
                      console / <span className="text-foreground">workspace</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <a
                      href="https://docs.github.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hidden md:inline text-xs text-muted-foreground hover:text-foreground"
                    >
                      Docs
                    </a>
                    <ThemeToggle />
                  </div>
                </header>
                <main className="flex-1 overflow-hidden">
                  <Router hook={useHashLocation}>
                    <AppRouter />
                  </Router>
                </main>
              </div>
            </div>
          </SidebarProvider>
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
