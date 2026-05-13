import * as React from "react";

import { cn } from "@/lib/utils";

interface PageShellProps {
  eyebrow?: React.ReactNode;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

export function PageShell({
  eyebrow,
  title,
  description,
  actions,
  className,
  children,
}: PageShellProps) {
  return (
    <div className={cn("flex flex-col gap-6 p-6 md:p-8", className)}>
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1.5">
          {eyebrow ? (
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
            {title}
          </h1>
          {description ? (
            <p className="max-w-2xl text-sm text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </header>
      <div className="flex flex-col gap-6">{children}</div>
    </div>
  );
}
