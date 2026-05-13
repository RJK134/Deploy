import {
  CircleCheck,
  CloudCog,
  Cog,
  Database,
  FileCode,
  Github,
  Globe,
  PackageSearch,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  STAGE_KINDS,
  STAGE_SPECS,
  type StageKind,
} from "@/lib/pipeline/stages";
import { cn } from "@/lib/utils";

const STAGE_ICONS: Record<StageKind, LucideIcon> = {
  "repo.scan": PackageSearch,
  "env.resolve": Cog,
  "db.provision": Database,
  "db.migrate": Database,
  "ci.generate": FileCode,
  deploy: CloudCog,
  "domain.attach": Globe,
  "smoke.test": ShieldCheck,
};

const PROVIDER_STYLE: Record<string, string> = {
  github: "text-foreground border-border",
  vercel: "text-foreground border-border",
  neon: "text-primary border-primary/40",
  internal: "text-muted-foreground border-border",
};

export default function PipelinesPage() {
  return (
    <PageShell
      eyebrow="Library"
      title="Pipeline anatomy"
      description="Every run walks through the same eight stages. In Session 4 each stage's dry-run output is simulated; Session 5 wires them to live providers."
    >
      <ol className="grid gap-4">
        {STAGE_KINDS.map((kind, index) => {
          const spec = STAGE_SPECS[kind];
          const Icon = STAGE_ICONS[kind];
          return (
            <li key={kind}>
              <Card>
                <CardHeader className="flex flex-row items-start gap-4 space-y-0">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/30">
                    <Icon
                      className="h-5 w-5 text-muted-foreground"
                      aria-hidden
                    />
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <CardTitle className="text-xs">{spec.label}</CardTitle>
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {spec.kind}
                      </code>
                      <Badge
                        variant="outline"
                        className={cn(
                          "ml-auto font-mono text-[10px] uppercase",
                          PROVIDER_STYLE[spec.provider] ?? "",
                        )}
                      >
                        {spec.provider}
                      </Badge>
                    </div>
                    <p className="text-sm text-foreground/90">
                      {spec.description}
                    </p>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 pt-0 text-xs text-muted-foreground">
                  <Separator />
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-1 pt-2">
                    <span className="inline-flex items-center gap-1.5">
                      <CircleCheck className="h-3.5 w-3.5" aria-hidden />
                      Produces&nbsp;
                      <span className="font-mono text-foreground">
                        {spec.produces}
                      </span>
                    </span>
                    {spec.skippableWhen ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Github className="h-3.5 w-3.5" aria-hidden />
                        Skippable when&nbsp;
                        <span className="text-foreground">
                          {spec.skippableWhen}
                        </span>
                      </span>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ol>
    </PageShell>
  );
}
