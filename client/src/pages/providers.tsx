import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { ProviderIcon, providerLabel } from "@/components/provider-icon";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  ShieldAlert, RefreshCw, Plug, PlugZap, ExternalLink, KeyRound, Github, AlertTriangle, CheckCircle2, Lock,
} from "lucide-react";

interface ConnectionMeta {
  label: string;
  credentialLabel: string;
  credentialDescription: string;
  requiredScopes: string[];
  recommendedScopes: string[];
  tokenCreateUrl: string;
  docsUrl: string;
  oauthAvailable: boolean;
}
interface Connection {
  provider: string;
  status: string;
  authMethod: string;
  liveMode: boolean;
  account: Record<string, unknown>;
  scopes: string[];
  errors: string[];
  tokenLast4: string | null;
  expiresAt: number | null;
  lastValidatedAt: number | null;
  createdAt: number;
  updatedAt: number;
  meta: ConnectionMeta;
}
interface ConnectionsPayload {
  ok: true;
  encryptionConfigured: boolean;
  keyFingerprint: string | null;
  githubOauthEnabled: boolean;
  liveEnabled: boolean;
  connections: Connection[];
}

function timeAgoMs(ms: number | null): string {
  if (!ms) return "never";
  const diff = Date.now() - ms;
  if (!Number.isFinite(diff) || diff < 0) return "—";
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "connected":    return "border-emerald-500/40 text-emerald-600 dark:text-emerald-400";
    case "invalid":      return "border-red-500/40 text-red-600 dark:text-red-400";
    case "expired":      return "border-amber-500/40 text-amber-600 dark:text-amber-400";
    case "needs-setup":  return "border-amber-500/40 text-amber-600 dark:text-amber-400";
    default:             return "border-muted-foreground/40 text-muted-foreground";
  }
}

export default function Providers() {
  const conns = useQuery<ConnectionsPayload>({ queryKey: ["/api/connections"] });
  const { toast } = useToast();
  const validate = useMutation({
    mutationFn: async (provider: string) => {
      const res = await apiRequest("POST", `/api/connections/${provider}/validate`, {});
      return res.json();
    },
    onSuccess: (data: any, provider: string) => {
      queryClient.invalidateQueries({ queryKey: ["/api/connections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/live/readiness"] });
      toast({
        title: data.ok ? `${providerLabel(provider)}: validated` : `${providerLabel(provider)}: validation failed`,
        description: data.ok
          ? `Account ${(data.connection?.account as any)?.name ?? ""} · scopes: ${data.connection?.scopes?.join(", ") || "(none)"}`
          : (data.validation?.errors ?? []).join("; ") || "see details",
      });
    },
    onError: (err: Error, provider: string) => {
      toast({ title: `${providerLabel(provider)}: validation error`, description: err.message });
    },
  });
  const disconnect = useMutation({
    mutationFn: async (provider: string) => {
      const res = await apiRequest("POST", `/api/connections/${provider}/disconnect`, {});
      return res.json();
    },
    onSuccess: (_d, provider) => {
      queryClient.invalidateQueries({ queryKey: ["/api/connections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/live/readiness"] });
      toast({ title: `${providerLabel(provider)} disconnected`, description: "Encrypted token removed." });
    },
  });
  const setLive = useMutation({
    mutationFn: async ({ provider, live }: { provider: string; live: boolean }) => {
      const res = await apiRequest("POST", `/api/connections/${provider}/live`, { live });
      return res.json();
    },
    onSuccess: (data: any, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/connections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/live/readiness"] });
      if (data.ok) {
        toast({
          title: `${providerLabel(vars.provider)} → ${vars.live ? "live" : "dry-run"}`,
          description: vars.live
            ? "Live writes permitted (still gated by DEPLOYOPS_LIVE and per-action approvals)."
            : "Live mode disabled. All actions are dry-run.",
        });
      } else {
        toast({ title: "Live toggle blocked", description: data.error ?? "see details" });
      }
    },
  });

  const data = conns.data;

  return (
    <PageShell
      eyebrow="Operations"
      title="Connection Center"
      description="Securely connect DeployOps to your provider accounts. Tokens are encrypted at rest with AES-256-GCM and never returned to the client. Validation calls are read-only."
      actions={
        <Button
          size="sm"
          variant="outline"
          onClick={() => conns.refetch()}
          disabled={conns.isFetching}
          data-testid="button-refresh-connections"
          className="h-8 gap-1"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${conns.isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      }
    >
      {/* Setup banner */}
      {data && !data.encryptionConfigured && (
        <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2" data-testid="banner-encryption-missing">
          <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
          <div className="flex-1">
            <div className="font-medium">Encryption key not configured</div>
            <div className="text-[11px] mt-0.5">
              Set <code className="font-mono">DEPLOYOPS_SECRET_KEY</code> (or <code className="font-mono">TOKEN_ENCRYPTION_KEY</code>) on the server to a long random string before saving any real tokens.
              Demo connections (token = <code className="font-mono">demo</code>) work without it.
            </div>
          </div>
        </div>
      )}
      {data && data.encryptionConfigured && (
        <div className="mb-4 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-2" data-testid="banner-encryption-ok">
          <Lock className="h-3.5 w-3.5" />
          Token encryption active · key fingerprint <code className="font-mono">{data.keyFingerprint}</code>
        </div>
      )}

      {conns.isLoading || !data ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-64 w-full" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {data.connections.map((c) => (
            <ConnectionCard
              key={c.provider}
              c={c}
              encryptionConfigured={data.encryptionConfigured}
              githubOauthEnabled={data.githubOauthEnabled}
              onValidate={() => validate.mutate(c.provider)}
              onDisconnect={() => disconnect.mutate(c.provider)}
              onLive={(live) => setLive.mutate({ provider: c.provider, live })}
              busy={validate.isPending || disconnect.isPending || setLive.isPending}
            />
          ))}
        </div>
      )}
    </PageShell>
  );
}

function ConnectionCard({
  c, encryptionConfigured, githubOauthEnabled, onValidate, onDisconnect, onLive, busy,
}: {
  c: Connection;
  encryptionConfigured: boolean;
  githubOauthEnabled: boolean;
  onValidate: () => void;
  onDisconnect: () => void;
  onLive: (live: boolean) => void;
  busy: boolean;
}) {
  const account = c.account as { name?: string; email?: string; extra?: any };
  const accountLabel = account?.name ?? "—";
  const isConnected = c.status === "connected";
  const missingScopes = c.meta.requiredScopes.filter((s) => !c.scopes.includes(s));

  return (
    <Card data-testid={`connection-${c.provider}`}>
      <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
        <div>
          <CardTitle className="text-sm flex items-center gap-2">
            <ProviderIcon provider={c.provider} className="h-4 w-4" /> {c.meta.label}
          </CardTitle>
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className={`text-[10px] font-mono ${statusBadgeClass(c.status)}`} data-testid={`status-${c.provider}`}>
              {c.status}
            </Badge>
            <Badge variant="outline" className="font-mono text-[10px]" data-testid={`auth-method-${c.provider}`}>
              {c.authMethod}
            </Badge>
            <Badge variant="outline" className="font-mono text-[10px]" data-testid={`live-mode-${c.provider}`}>
              {c.liveMode ? "live" : "dry-run"}
            </Badge>
            {c.tokenLast4 && (
              <Badge variant="outline" className="font-mono text-[10px]" data-testid={`token-last4-${c.provider}`}>
                ••••{c.tokenLast4}
              </Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Live</span>
          <Switch
            checked={c.liveMode}
            disabled={!isConnected || busy}
            onCheckedChange={(v) => onLive(v)}
            data-testid={`switch-live-${c.provider}`}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground" data-testid={`description-${c.provider}`}>
          {c.meta.credentialDescription}
        </p>

        {isConnected && (
          <div className="rounded-md border border-border bg-card/40 p-3 text-xs space-y-1.5" data-testid={`account-${c.provider}`}>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              <span className="font-medium">{accountLabel}</span>
              {account?.email && <span className="text-muted-foreground">· {account.email}</span>}
            </div>
            <div className="text-[11px] text-muted-foreground font-mono">
              last validated: {timeAgoMs(c.lastValidatedAt)}
            </div>
            {c.scopes.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {c.scopes.map((s) => (
                  <Badge key={s} variant="outline" className="text-[9px] font-mono">{s}</Badge>
                ))}
              </div>
            )}
            {missingScopes.length > 0 && (
              <div className="text-[11px] text-amber-600 dark:text-amber-400 inline-flex items-center gap-1" data-testid={`missing-scopes-${c.provider}`}>
                <AlertTriangle className="h-3 w-3" /> missing: {missingScopes.join(", ")}
              </div>
            )}
          </div>
        )}

        {c.errors.length > 0 && (
          <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-[11px] text-red-700 dark:text-red-400" data-testid={`errors-${c.provider}`}>
            <div className="font-medium flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" /> Validation errors
            </div>
            <ul className="list-disc list-inside mt-1">
              {c.errors.map((e, i) => <li key={i} className="font-mono text-[10px]">{e}</li>)}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {!isConnected && (
            <ConnectTokenDialog
              provider={c.provider}
              meta={c.meta}
              encryptionConfigured={encryptionConfigured}
            />
          )}
          {isConnected && (
            <ConnectTokenDialog
              provider={c.provider}
              meta={c.meta}
              encryptionConfigured={encryptionConfigured}
              reconnect
            />
          )}
          {c.provider === "github" && githubOauthEnabled && (
            <Button
              variant="outline" size="sm" className="h-8 gap-1"
              onClick={() => { window.location.href = `/api/auth/github/oauth/start?redirect=/#/providers`; }}
              data-testid="button-github-oauth"
            >
              <Github className="h-3.5 w-3.5" /> Connect with GitHub OAuth
            </Button>
          )}
          {isConnected && (
            <Button
              variant="outline" size="sm" className="h-8 gap-1"
              disabled={busy}
              onClick={onValidate}
              data-testid={`button-validate-${c.provider}`}
            >
              <RefreshCw className="h-3.5 w-3.5" /> Validate
            </Button>
          )}
          {isConnected && (
            <Button
              variant="outline" size="sm" className="h-8 gap-1 text-red-600 dark:text-red-400 hover:text-red-700"
              disabled={busy}
              onClick={onDisconnect}
              data-testid={`button-disconnect-${c.provider}`}
            >
              <Plug className="h-3.5 w-3.5" /> Disconnect
            </Button>
          )}
          <a
            href={c.meta.tokenCreateUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground self-center ml-auto"
            data-testid={`link-create-token-${c.provider}`}
          >
            <ExternalLink className="h-3 w-3" /> create token
          </a>
        </div>

        {c.meta.requiredScopes.length > 0 && !isConnected && (
          <div className="text-[11px] text-muted-foreground" data-testid={`required-scopes-${c.provider}`}>
            <span className="font-mono">required:</span> {c.meta.requiredScopes.join(", ")}
            {c.meta.recommendedScopes.length > 0 && (
              <>{" · "}<span className="font-mono">recommended:</span> {c.meta.recommendedScopes.join(", ")}</>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ConnectTokenDialog({
  provider, meta, encryptionConfigured, reconnect = false,
}: {
  provider: string;
  meta: ConnectionMeta;
  encryptionConfigured: boolean;
  reconnect?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const { toast } = useToast();

  const connect = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/connections/${provider}/connect-token`, {
        token: token.trim(),
        confirm: confirmText.trim(),
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      if (data.ok) {
        toast({
          title: `${meta.label} connected`,
          description: `Account ${(data.connection?.account as any)?.name ?? ""} · scopes: ${(data.connection?.scopes ?? []).join(", ") || "(none)"}`,
        });
        queryClient.invalidateQueries({ queryKey: ["/api/connections"] });
        queryClient.invalidateQueries({ queryKey: ["/api/live/readiness"] });
        queryClient.invalidateQueries({ queryKey: ["/api/github/repos"] });
        setOpen(false);
        setToken("");
        setConfirmText("");
      } else {
        toast({ title: `${meta.label} connection failed`, description: data.error ?? "see details" });
      }
    },
    onError: (err: Error) => {
      toast({ title: `${meta.label} connection error`, description: err.message });
    },
  });

  const isDemo = token.trim().toLowerCase() === "demo" || token.trim().toLowerCase().startsWith("demo-");
  const confirmOk = isDemo || confirmText.trim().toUpperCase() === "I UNDERSTAND";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={reconnect ? "outline" : "default"} size="sm" className="h-8 gap-1" data-testid={`button-${reconnect ? "reconnect" : "connect"}-${provider}`}>
          {reconnect ? <RefreshCw className="h-3.5 w-3.5" /> : <PlugZap className="h-3.5 w-3.5" />}
          {reconnect ? "Reconnect" : "Connect"}
        </Button>
      </DialogTrigger>
      <DialogContent data-testid={`dialog-connect-${provider}`}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" /> Connect {meta.label}
          </DialogTitle>
          <DialogDescription>{meta.credentialDescription}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="text-xs space-y-1">
            <div><span className="font-mono">required scopes:</span> {meta.requiredScopes.join(", ") || "—"}</div>
            <div><span className="font-mono">recommended:</span> {meta.recommendedScopes.join(", ") || "—"}</div>
            <a href={meta.tokenCreateUrl} target="_blank" rel="noopener noreferrer" className="text-primary inline-flex items-center gap-1" data-testid={`dialog-link-create-${provider}`}>
              <ExternalLink className="h-3 w-3" /> Create a token
            </a>
          </div>

          {!encryptionConfigured && !isDemo && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-[11px] text-amber-700 dark:text-amber-400" data-testid={`dialog-encryption-warning-${provider}`}>
              Server has no <code className="font-mono">DEPLOYOPS_SECRET_KEY</code> — only demo tokens (<code className="font-mono">demo</code>) can be saved.
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor={`token-${provider}`} className="text-xs">{meta.credentialLabel}</Label>
            <Input
              id={`token-${provider}`}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="ghp_..., demo, ..."
              data-testid={`input-token-${provider}`}
            />
            <div className="text-[10px] text-muted-foreground">
              Token is sent over HTTPS to the server, validated, encrypted, then stored. The server never returns it again.
              Type <code className="font-mono">demo</code> for a no-secret mock connection.
            </div>
          </div>

          {!isDemo && (
            <div className="space-y-1.5">
              <Label htmlFor={`confirm-${provider}`} className="text-xs">Confirmation phrase</Label>
              <Input
                id={`confirm-${provider}`}
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder='Type: I UNDERSTAND'
                data-testid={`input-confirm-${provider}`}
              />
              <div className="text-[10px] text-muted-foreground">
                Required to prevent accidental token paste. Type <code className="font-mono">I UNDERSTAND</code> to enable Save.
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)} data-testid={`button-cancel-connect-${provider}`}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!token.trim() || !confirmOk || connect.isPending}
            onClick={() => connect.mutate()}
            data-testid={`button-save-token-${provider}`}
          >
            {connect.isPending ? "Validating…" : isDemo ? "Save demo connection" : "Validate & save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
