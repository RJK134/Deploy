import { ReactNode } from "react";

export function PageShell({
  title,
  eyebrow,
  description,
  actions,
  children,
}: {
  title: string;
  eyebrow?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="h-full overflow-y-auto" data-testid="page-shell">
      <div className="mx-auto max-w-[1320px] px-6 lg:px-10 py-8">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            {eyebrow && (
              <div className="mb-2 text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
                {eyebrow}
              </div>
            )}
            <h1 className="text-xl font-semibold tracking-tight" data-testid="text-page-title">
              {title}
            </h1>
            {description && (
              <p className="mt-2 text-sm text-muted-foreground max-w-2xl">{description}</p>
            )}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
        {children}
      </div>
    </div>
  );
}
