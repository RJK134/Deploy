import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ProviderIcon, providerLabel } from "@/components/provider-icon";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, ArrowRight } from "lucide-react";

export default function Blueprints() {
  const blueprints = useQuery<any[]>({ queryKey: ["/api/blueprints"] });

  return (
    <PageShell
      eyebrow="Library"
      title="Environment blueprints"
      description="Reusable templates that bundle a stack with the providers we know how to wire up. Pick one in the wizard or extend the library with your own."
      actions={
        <Link href="/wizard">
          <Button data-testid="button-deploy-from-blueprint" className="gap-2">
            <Sparkles className="h-4 w-4" /> New deployment
          </Button>
        </Link>
      }
    >
      {blueprints.isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-44 w-full" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {blueprints.data?.map((b) => (
            <Card key={b.slug} className="flex flex-col" data-testid={`card-blueprint-${b.slug}`}>
              <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
                <div>
                  <CardTitle className="text-sm">{b.name}</CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">{b.tagline}</p>
                </div>
                {b.recommended && <Badge variant="outline" className="text-[10px] shrink-0">recommended</Badge>}
              </CardHeader>
              <CardContent className="flex-1 flex flex-col">
                <p className="text-sm text-muted-foreground/90">{b.description}</p>

                <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                  <KV k="Framework" v={b.framework} />
                  <KV k="Build" v={b.defaults?.buildCommand ?? "—"} mono />
                  <KV k="Output" v={b.defaults?.outputDir ?? "—"} mono />
                  <KV k="Install" v={b.defaults?.install ?? "—"} mono />
                </div>

                <div className="mt-4">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Providers</div>
                  <div className="flex flex-wrap gap-2">
                    {b.providers.map((p: string) => (
                      <Badge key={p} variant="outline" className="text-[10px] font-mono inline-flex items-center gap-1">
                        <ProviderIcon provider={p} className="h-3 w-3" /> {providerLabel(p)}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div className="mt-4">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Suggested env vars</div>
                  <div className="flex flex-wrap gap-1.5">
                    {(b.defaults?.envSuggestions ?? []).map((k: string) => (
                      <code key={k} className="rounded border border-border bg-card/60 px-1.5 py-0.5 text-[11px] font-mono">
                        {k}
                      </code>
                    ))}
                  </div>
                </div>

                <div className="mt-auto pt-4 flex items-center justify-end">
                  <Link href={`/wizard`} className="text-xs inline-flex items-center gap-1 text-primary hover:text-primary/80" data-testid={`link-use-${b.slug}`}>
                    Use blueprint <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PageShell>
  );
}

function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-card/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</div>
      <div className={`text-xs ${mono ? "font-mono" : ""}`}>{v}</div>
    </div>
  );
}
