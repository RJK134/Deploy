import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  GitBranch, Search, Lock, Globe, Star, AlertTriangle, RefreshCw,
  Check, Github, Sparkles, Database, FileCode, Container, FlaskConical,
  Loader2, ExternalLink, KeyRound,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";

export interface GhRepoSummary {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  description: string | null;
  url: string;
  cloneUrl: string;
  defaultBranch: string;
  private: boolean;
  fork: boolean;
  archived: boolean;
  language: string | null;
  pushedAt: string | null;
  updatedAt: string | null;
  topics: string[];
}
export interface GhBranch {
  name: string;
  protected: boolean;
  sha: string;
}
export interface DetectionResult {
  framework: string;
  packageManager: string;
  buildCommand: string | null;
  devCommand: string | null;
  startCommand: string | null;
  outputDir: string | null;
  prisma: { present: boolean; schemaPath: string | null; migrationsPath: string | null };
  docker: { dockerfile: boolean; compose: boolean };
  vercel: { configFile: string | null };
  githubActions: { workflowPaths: string[] };
  envExample: { path: string | null; keys: string[] };
  envSuggestions: string[];
  blueprintRecommendation: string | null;
  recommendedProviders: string[];
  language: string | null;
  notes: string[];
}

type Visibility = "all" | "public" | "private";
type SortKey = "recent" | "name";

interface RepoPayload {
  ok: boolean;
  repos: GhRepoSummary[];
  total: number;
  owners?: string[];
  ownersTried?: string[];
  ownerErrors?: Array<{ owner: string; code: string; message: string }>;
  source?: "live" | "cache";
  /** auth path used when source=live: "connection" | "env" | "cli" | "cache". */
  authSource?: "connection" | "env" | "cli" | "cache";
  connectedAccount?: { login: string; name: string | null } | null;
  stale?: boolean;
  cachedAt?: number | null;
  warning?: string;
  liveError?: { code: string; message: string };
}
interface DiagPayload {
  ok: boolean;
  authSource: "connection" | "env" | "cli" | null;
  hasStoredConnection: boolean;
  hasEnvToken: boolean;
  ghCliFallbackEnabled: boolean;
  viewer: { login: string; name: string | null } | null;
  viewerError: { code: string; message: string } | null;
}
interface BranchPayload {
  ok: boolean;
  repo: string;
  branches: GhBranch[];
  source?: "live" | "cache";
  stale?: boolean;
  warning?: string;
  liveError?: { code: string; message: string };
}
interface DetectPayload {
  ok: boolean;
  repo: string;
  branch: string;
  detection: DetectionResult;
  source?: "live" | "fallback";
  stale?: boolean;
  warning?: string;
  liveError?: { code: string; message: string };
}

interface ApiError { error: string; code?: string; detail?: string }

async function fetchOrThrow<T>(url: string): Promise<T> {
  const res = await apiRequest("GET", url).catch(async (err) => {
    /* apiRequest throws on non-OK with `${status}: ${text}` — re-shape for the UI. */
    const message = String(err?.message ?? err);
    const m = message.match(/^(\d+):\s*([\s\S]*)$/);
    if (m) {
      const status = Number(m[1]);
      let parsed: ApiError = {} as ApiError;
      try { parsed = JSON.parse(m[2]); } catch { /* keep raw */ }
      throw Object.assign(new Error(parsed.error || message), {
        code: parsed.code, detail: parsed.detail, status,
      });
    }
    throw err;
  });
  return (await res.json()) as T;
}

function timeAgoMs(ms: number): string {
  const diff = Date.now() - ms;
  if (!Number.isFinite(diff) || diff < 0) return "—";
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return "—";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

export interface RepoPickerSelection {
  repo: GhRepoSummary;
  branch: string;
  detection: DetectionResult | null;
}

interface Props {
  selectedRepoFullName: string | null;
  selectedBranch: string | null;
  onSelectRepo: (repo: GhRepoSummary) => void;
  onSelectBranch: (branch: string) => void;
  onDetected: (detection: DetectionResult | null) => void;
}

export function GithubRepoPicker({
  selectedRepoFullName, selectedBranch, onSelectRepo, onSelectBranch, onDetected,
}: Props) {
  const [search, setSearch] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("all");
  const [language, setLanguage] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("recent");
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  const [manualOwner, setManualOwner] = useState<string>("");
  /* extraOwner is the owner currently being aggregated from the manual search box. */
  const [extraOwner, setExtraOwner] = useState<string>("");

  const queryClient = useQueryClient();

  const reposQ = useQuery<RepoPayload, Error>({
    queryKey: ["/api/github/repos", extraOwner || "default"],
    queryFn: () => {
      const url = extraOwner
        ? `/api/github/repos?owner=${encodeURIComponent(extraOwner)}`
        : "/api/github/repos";
      return fetchOrThrow<RepoPayload>(url);
    },
  });

  /* Diagnostic — surfaces whether a stored connection / env / CLI token is
   * available before the user opens the connect form. Refetches on demand
   * after a successful connect. */
  const diagQ = useQuery<DiagPayload, Error>({
    queryKey: ["/api/github/diag"],
    queryFn: () => fetchOrThrow<DiagPayload>("/api/github/diag"),
    /* light staleTime so refresh after connect is fast */
    staleTime: 5_000,
  });

  const repos = reposQ.data?.repos ?? [];
  const selectedRepo = useMemo(
    () => repos.find((r) => r.fullName === selectedRepoFullName) ?? null,
    [repos, selectedRepoFullName],
  );

  /* derive language facet from data */
  const languages = useMemo(() => {
    const set = new Set<string>();
    repos.forEach((r) => { if (r.language) set.add(r.language); });
    return Array.from(set).sort();
  }, [repos]);

  /* derive owner facet from data */
  const owners = useMemo(() => {
    const set = new Set<string>();
    repos.forEach((r) => { if (r.owner) set.add(r.owner); });
    return Array.from(set).sort();
  }, [repos]);

  /* If the active ownerFilter no longer appears in the data, fall back to "all". */
  const effectiveOwnerFilter = useMemo(
    () => (ownerFilter === "all" || owners.includes(ownerFilter) ? ownerFilter : "all"),
    [ownerFilter, owners],
  );

  /* search + filters */
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = repos.filter((r) => {
      if (effectiveOwnerFilter !== "all" && r.owner !== effectiveOwnerFilter) return false;
      if (visibility === "public" && r.private) return false;
      if (visibility === "private" && !r.private) return false;
      if (language !== "all" && r.language !== language) return false;
      if (!q) return true;
      return (
        r.fullName.toLowerCase().includes(q) ||
        (r.description ?? "").toLowerCase().includes(q) ||
        (r.language ?? "").toLowerCase().includes(q) ||
        r.topics.some((t) => t.toLowerCase().includes(q))
      );
    });
    if (sort === "name") {
      list = [...list].sort((a, b) => a.fullName.localeCompare(b.fullName));
    } else {
      list = [...list].sort((a, b) => {
        const A = a.pushedAt ? new Date(a.pushedAt).getTime() : 0;
        const B = b.pushedAt ? new Date(b.pushedAt).getTime() : 0;
        return B - A;
      });
    }
    return list;
  }, [repos, search, visibility, language, sort, effectiveOwnerFilter]);

  const ownerErrors = reposQ.data?.ownerErrors ?? [];

  const branchesQ = useQuery<BranchPayload, Error>({
    queryKey: ["/api/github/branches", selectedRepoFullName],
    enabled: !!selectedRepoFullName,
    queryFn: () => fetchOrThrow<BranchPayload>(`/api/github/repos/${selectedRepoFullName}/branches`),
  });

  const detectQ = useQuery<DetectPayload, Error>({
    queryKey: ["/api/github/detect", selectedRepoFullName, selectedBranch],
    enabled: !!selectedRepoFullName && !!selectedBranch,
    queryFn: async () => {
      const data = await fetchOrThrow<DetectPayload>(
        `/api/github/repos/${selectedRepoFullName}/detect?branch=${encodeURIComponent(selectedBranch!)}`,
      );
      onDetected(data.detection);
      return data;
    },
  });

  const reposError = reposQ.error as (Error & { code?: string; status?: number }) | null;

  /** When live load returned a cache fallback, treat as needing connect if no auth at all. */
  const cacheFromAuthMissing = reposQ.data?.source === "cache" && reposQ.data?.liveError?.code === "auth-missing";
  const needsConnect = !!reposError && (reposError.code === "auth-missing" || reposError.code === "forbidden-scope")
    || cacheFromAuthMissing
    || (diagQ.data && diagQ.data.authSource === null && (reposQ.data?.repos.length ?? 0) === 0);

  const onConnected = async () => {
    /* Refresh both diag and repo list on successful connect. */
    await Promise.all([diagQ.refetch(), reposQ.refetch()]);
    queryClient.invalidateQueries({ queryKey: ["/api/connections"] });
  };

  return (
    <div className="space-y-5" data-testid="github-repo-picker">
      {needsConnect && (
        <GithubConnectCard
          diag={diagQ.data ?? null}
          reposError={reposError}
          cacheFromAuthMissing={cacheFromAuthMissing}
          onConnected={onConnected}
        />
      )}

      <div>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Github className="h-4 w-4 text-foreground/80" />
            <div className="text-sm font-medium">Pick a GitHub repository</div>
            {reposQ.data && (
              <Badge variant="outline" className="text-[10px] font-mono" data-testid="badge-repo-count">
                {filtered.length}/{reposQ.data.total}
              </Badge>
            )}
            {reposQ.data?.source === "live" && (
              <Badge variant="outline" className="text-[10px] font-mono border-emerald-500/40 text-emerald-600 dark:text-emerald-400" data-testid="badge-source-live">
                live{reposQ.data.authSource ? ` · ${reposQ.data.authSource}` : ""}
              </Badge>
            )}
            {reposQ.data?.source === "cache" && (
              <Badge variant="outline" className="text-[10px] font-mono border-amber-500/40 text-amber-600 dark:text-amber-400" data-testid="badge-source-cache">
                cached{reposQ.data.cachedAt ? ` · ${timeAgoMs(reposQ.data.cachedAt)}` : ""}
              </Badge>
            )}
            {reposQ.data?.connectedAccount?.login && (
              <Badge variant="outline" className="text-[10px] font-mono" data-testid="badge-connected-account">
                @{reposQ.data.connectedAccount.login}
              </Badge>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => reposQ.refetch()}
            disabled={reposQ.isFetching}
            data-testid="button-refresh-repos"
            className="h-7 gap-1"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", reposQ.isFetching && "animate-spin")} />
            Refresh
          </Button>
        </div>

        {reposQ.data?.source === "cache" && reposQ.data?.warning && (
          <div className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-600 dark:text-amber-400 flex items-start gap-2" data-testid="cache-warning">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <div className="flex-1">
              <div>{reposQ.data.warning}</div>
              {reposQ.data.liveError && (
                <div className="font-mono mt-0.5 text-[10px] opacity-80">
                  {reposQ.data.liveError.code}: {reposQ.data.liveError.message}
                </div>
              )}
            </div>
          </div>
        )}

        {/* filters */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-2 mb-3">
          <div className="md:col-span-4 relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter repositories…"
              className="pl-8"
              data-testid="input-repo-search"
            />
          </div>
          <div className="md:col-span-2">
            <Select
              value={effectiveOwnerFilter}
              onValueChange={(v) => {
                setOwnerFilter(v);
                /* Quick-jump to known owners that aren't yet aggregated. */
                if (v !== "all" && !owners.includes(v)) {
                  setManualOwner(v);
                  setExtraOwner(v);
                }
              }}
            >
              <SelectTrigger data-testid="select-owner"><SelectValue placeholder="Owner" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" data-testid="option-owner-all">All owners</SelectItem>
                {Array.from(new Set([...owners, "RJK134", "Future-Horizons-Education"])).sort().map((o) => (
                  <SelectItem key={o} value={o} data-testid={`option-owner-${o}`}>{o}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2">
            <Select value={visibility} onValueChange={(v) => setVisibility(v as Visibility)}>
              <SelectTrigger data-testid="select-visibility"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" data-testid="option-vis-all">All</SelectItem>
                <SelectItem value="public" data-testid="option-vis-public">Public</SelectItem>
                <SelectItem value="private" data-testid="option-vis-private">Private</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2">
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger data-testid="select-language"><SelectValue placeholder="Language" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" data-testid="option-lang-all">All languages</SelectItem>
                {languages.map((l) => (
                  <SelectItem key={l} value={l} data-testid={`option-lang-${l}`}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2">
            <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
              <SelectTrigger data-testid="select-sort"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="recent" data-testid="option-sort-recent">Recently pushed</SelectItem>
                <SelectItem value="name" data-testid="option-sort-name">Name (A→Z)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* manual owner / org search — for orgs that aren't surfaced by user/orgs */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-2 mb-3">
          <div className="md:col-span-9">
            <Input
              value={manualOwner}
              onChange={(e) => setManualOwner(e.target.value)}
              placeholder="Load repos from an additional owner or org (e.g. Future-Horizons-Education)"
              data-testid="input-owner-search"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setExtraOwner(manualOwner.trim());
                }
              }}
            />
          </div>
          <div className="md:col-span-3 flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => setExtraOwner(manualOwner.trim())}
              disabled={!manualOwner.trim() || manualOwner.trim() === extraOwner}
              data-testid="button-load-owner"
            >
              Load owner
            </Button>
            {extraOwner && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setExtraOwner(""); setManualOwner(""); }}
                data-testid="button-clear-owner"
              >
                Clear
              </Button>
            )}
          </div>
        </div>

        {/* owner-error banner: when a configured owner couldn't be loaded */}
        {ownerErrors.length > 0 && (
          <div className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-600 dark:text-amber-400" data-testid="owner-errors">
            {ownerErrors.map((e) => (
              <div key={e.owner}>
                <span className="font-mono">{e.owner}</span>: {e.code} — {e.message}
              </div>
            ))}
          </div>
        )}

        {/* loading / error / empty states */}
        {reposQ.isLoading ? (
          <div className="space-y-2" data-testid="repos-loading">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        ) : reposError ? (
          <RepoErrorState error={reposError} onRetry={() => reposQ.refetch()} />
        ) : filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground" data-testid="repos-empty">
            {repos.length === 0
              ? "GitHub auth worked, but no repositories were returned. Try the manual owner/org loader above to pull repos for a specific account."
              : effectiveOwnerFilter !== "all"
              ? `No repositories under ${effectiveOwnerFilter} match the current filters.`
              : "No repositories match the current filters."}
          </div>
        ) : (
          <ScrollArea className="h-[360px] rounded-md border border-border" data-testid="repos-list">
            <ul className="divide-y divide-border">
              {filtered.map((r) => (
                <li key={r.id}>
                  <button
                    onClick={() => onSelectRepo(r)}
                    className={cn(
                      "w-full text-left px-3 py-2.5 transition-colors flex items-start gap-3",
                      selectedRepoFullName === r.fullName ? "bg-primary/5" : "hover-elevate",
                    )}
                    data-testid={`option-repo-${r.fullName}`}
                  >
                    <div className="mt-0.5">
                      {r.private
                        ? <Lock className="h-4 w-4 text-amber-500" />
                        : <Globe className="h-4 w-4 text-emerald-500" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 font-mono text-sm">
                          <span className="truncate">{r.fullName}</span>
                          {r.fork && <Badge variant="outline" className="text-[9px]">fork</Badge>}
                          {r.archived && <Badge variant="outline" className="text-[9px]">archived</Badge>}
                        </div>
                        {selectedRepoFullName === r.fullName && <Check className="h-4 w-4 text-primary shrink-0" />}
                      </div>
                      {r.description && (
                        <div className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{r.description}</div>
                      )}
                      <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground font-mono">
                        {r.language && <span>{r.language}</span>}
                        <span>{timeAgo(r.pushedAt)}</span>
                        <span className="inline-flex items-center gap-1">
                          <GitBranch className="h-3 w-3" /> {r.defaultBranch}
                        </span>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </div>

      {/* selected repo details + branch selector + detection */}
      {selectedRepo && (
        <Card data-testid="card-selected-repo">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              {selectedRepo.fullName}
              <a href={selectedRepo.url} target="_blank" rel="noreferrer" className="text-[11px] font-mono text-muted-foreground underline ml-auto" data-testid="link-repo-external">
                open on GitHub →
              </a>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
              <div className="md:col-span-2">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Branch</div>
                {branchesQ.isLoading ? (
                  <Skeleton className="h-9 w-full" data-testid="branches-loading" />
                ) : branchesQ.error ? (
                  <div className="text-xs text-amber-500" data-testid="branches-error">
                    Could not load branches: {(branchesQ.error as Error).message}. Continuing with default branch{" "}
                    <span className="font-mono">{selectedRepo.defaultBranch}</span>.
                  </div>
                ) : (
                  <>
                    <Select
                      value={selectedBranch ?? selectedRepo.defaultBranch}
                      onValueChange={onSelectBranch}
                    >
                      <SelectTrigger data-testid="select-branch"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(branchesQ.data?.branches ?? []).map((b) => (
                          <SelectItem key={b.name} value={b.name} data-testid={`option-branch-${b.name}`}>
                            <span className="font-mono">{b.name}</span>
                            {b.name === selectedRepo.defaultBranch && (
                              <Badge variant="outline" className="text-[9px] ml-2">default</Badge>
                            )}
                            {b.protected && (
                              <Badge variant="outline" className="text-[9px] ml-2">protected</Badge>
                            )}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {branchesQ.data?.source === "cache" && branchesQ.data?.warning && (
                      <div className="text-[11px] text-amber-500 mt-1" data-testid="branches-cache-warning">
                        {branchesQ.data.warning}
                      </div>
                    )}
                  </>
                )}
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Visibility</div>
                <Badge variant="outline" className="text-[10px] font-mono" data-testid="badge-repo-visibility">
                  {selectedRepo.private ? "private" : "public"}
                </Badge>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Language</div>
                <span className="text-xs font-mono" data-testid="text-repo-language">{selectedRepo.language ?? "—"}</span>
              </div>
            </div>

            <DetectionPanel
              loading={detectQ.isLoading}
              error={detectQ.error as (Error & { code?: string }) | null}
              data={detectQ.data?.detection ?? null}
              warning={detectQ.data?.source === "fallback" ? (detectQ.data?.warning ?? "Manual fallback in use.") : null}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function RepoErrorState({
  error, onRetry,
}: { error: Error & { code?: string; status?: number }; onRetry: () => void }) {
  const code = error.code ?? "unknown";
  const title =
    code === "auth-missing"    ? "Connect GitHub to load repositories" :
    code === "forbidden-scope" ? "GitHub token missing required scopes" :
    code === "rate-limit"      ? "GitHub API rate limit reached" :
    code === "not-found"       ? "GitHub user / repos not found" :
    code === "network"         ? "Could not reach GitHub" :
    "Could not load repositories";
  const hint =
    code === "auth-missing"    ? "Use the connect form above to paste a Personal Access Token, then retry. The wizard will use your stored token automatically once connected." :
    code === "forbidden-scope" ? "Re-issue your token with these scopes: repo (private repos), read:org (org/private org repos), workflow (CI writes). Then re-connect." :
    code === "rate-limit"      ? "Wait a few minutes and retry, or authenticate with a higher-limit token." :
    code === "not-found"       ? "Check the owner / repo name. The authenticated account may not have access." :
    code === "network"         ? "The server could not reach GitHub. Check connectivity and retry." :
    "Try refreshing. If it persists, check the server logs for the request id.";
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4" data-testid="repos-error">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5" />
        <div className="flex-1">
          <div className="text-sm font-medium flex items-center gap-2">
            {title}
            <Badge variant="outline" className="text-[10px] font-mono" data-testid="repos-error-code">{code}</Badge>
            {error.status ? <Badge variant="outline" className="text-[10px] font-mono">HTTP {error.status}</Badge> : null}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>
          <div className="mt-2 text-[11px] font-mono text-muted-foreground" data-testid="repos-error-detail">
            {error.message}
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={onRetry} data-testid="button-retry-repos" className="h-7 gap-1">
          <RefreshCw className="h-3.5 w-3.5" /> Retry
        </Button>
      </div>
    </div>
  );
}

function DetectionPanel({
  loading, error, data, warning,
}: {
  loading: boolean;
  error: (Error & { code?: string }) | null;
  data: DetectionResult | null;
  warning?: string | null;
}) {
  if (loading) {
    return (
      <div className="rounded-md border border-border p-3" data-testid="detection-loading">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Detecting framework, build, providers…</div>
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3" data-testid="detection-error">
        <div className="text-xs text-amber-500">Could not inspect repo contents: {error.message}</div>
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="rounded-md border border-border bg-card/40 p-4 space-y-3" data-testid="detection-panel">
      <div className="flex items-center gap-2">
        <FileCode className="h-4 w-4 text-primary" />
        <div className="text-sm font-medium">Auto-detected configuration</div>
        {warning && (
          <Badge variant="outline" className="text-[10px] font-mono border-amber-500/40 text-amber-600 dark:text-amber-400 ml-auto" data-testid="badge-detection-fallback">
            manual fallback
          </Badge>
        )}
      </div>
      {warning && (
        <div className="text-[11px] text-amber-600 dark:text-amber-400" data-testid="detection-warning">
          {warning}
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
        <DKV k="Framework"        v={data.framework} testid="detect-framework" />
        <DKV k="Package manager"  v={data.packageManager} testid="detect-pm" />
        <DKV k="Build command"    v={data.buildCommand ?? "—"} mono testid="detect-build" />
        <DKV k="Dev command"      v={data.devCommand ?? "—"} mono testid="detect-dev" />
        <DKV k="Start command"    v={data.startCommand ?? "—"} mono testid="detect-start" />
        <DKV k="Output dir"       v={data.outputDir ?? "—"} mono testid="detect-output" />
      </div>

      <div className="flex flex-wrap gap-1.5 text-[11px]" data-testid="detect-flags">
        {data.prisma.present && (
          <Badge variant="outline" className="font-mono inline-flex items-center gap-1" data-testid="flag-prisma">
            <Database className="h-3 w-3" /> Prisma{data.prisma.migrationsPath ? " + migrations" : ""}
          </Badge>
        )}
        {data.docker.dockerfile && (
          <Badge variant="outline" className="font-mono inline-flex items-center gap-1" data-testid="flag-dockerfile">
            <Container className="h-3 w-3" /> Dockerfile
          </Badge>
        )}
        {data.docker.compose && (
          <Badge variant="outline" className="font-mono" data-testid="flag-compose">docker-compose</Badge>
        )}
        {data.vercel.configFile && (
          <Badge variant="outline" className="font-mono" data-testid="flag-vercel">vercel.json</Badge>
        )}
        {data.githubActions.workflowPaths.length > 0 && (
          <Badge variant="outline" className="font-mono" data-testid="flag-actions">
            GitHub Actions × {data.githubActions.workflowPaths.length}
          </Badge>
        )}
        {data.envExample.path && (
          <Badge variant="outline" className="font-mono" data-testid="flag-envexample">
            {data.envExample.path} ({data.envExample.keys.length} keys)
          </Badge>
        )}
        {data.blueprintRecommendation && (
          <Badge className="font-mono inline-flex items-center gap-1" data-testid="flag-blueprint">
            <Sparkles className="h-3 w-3" /> {data.blueprintRecommendation}
          </Badge>
        )}
      </div>

      {data.envSuggestions.length > 0 && (
        <div className="text-[11px]" data-testid="detect-env-suggestions">
          <div className="uppercase tracking-wide text-muted-foreground mb-1">Suggested env vars</div>
          <div className="flex flex-wrap gap-1">
            {data.envSuggestions.map((k) => (
              <Badge key={k} variant="outline" className="font-mono text-[10px]">{k}</Badge>
            ))}
          </div>
        </div>
      )}

      {data.notes.length > 0 && (
        <div className="text-[11px] text-muted-foreground inline-flex items-start gap-1" data-testid="detect-notes">
          <FlaskConical className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <ul className="list-disc list-inside space-y-0.5">
            {data.notes.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function DKV({ k, v, mono, testid }: { k: string; v: string; mono?: boolean; testid?: string }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border px-2.5 py-1.5 bg-card/40" data-testid={testid}>
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{k}</span>
      <span className={cn("text-[11px]", mono && "font-mono")}>{v}</span>
    </div>
  );
}

function GithubConnectCard({
  diag, reposError, cacheFromAuthMissing, onConnected,
}: {
  diag: DiagPayload | null;
  reposError: (Error & { code?: string }) | null;
  cacheFromAuthMissing: boolean;
  onConnected: () => Promise<void> | void;
}) {
  const [token, setToken] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);

  const code = reposError?.code ?? (cacheFromAuthMissing ? "auth-missing" : null);
  const headline =
    code === "forbidden-scope"
      ? "Connected GitHub token cannot list repos"
      : "Connect GitHub to load repositories";
  const subtext =
    code === "forbidden-scope"
      ? "Re-issue a token that includes repo (for private repos) and read:org (for org/private-org repos), then paste it below."
      : "Paste a GitHub Personal Access Token (PAT) — it's encrypted server-side and never sent back to the browser.";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setWarn(null); setBusy(true);
    try {
      const res = await fetch("/api/connections/github/connect-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim(), confirm: confirm.trim() }),
      });
      const text = await res.text();
      let body: any = null;
      try { body = JSON.parse(text); } catch { /* keep text */ }
      if (!res.ok) {
        const msg = body?.error || text || `HTTP ${res.status}`;
        const detail = body?.detail ? ` — ${body.detail}` : "";
        if (body?.code === "confirmation-required") {
          setErr(`Confirmation required. Type I UNDERSTAND in the confirmation box, then re-submit.`);
        } else if (body?.code === "setup-required") {
          setErr(`${msg}${detail}`);
        } else if (body?.validation && Array.isArray(body.validation.errors)) {
          setErr(`Token rejected by GitHub: ${body.validation.errors.join("; ")}`);
        } else {
          setErr(`${msg}${detail}`);
        }
        return;
      }
      const v = body?.validation;
      if (v && Array.isArray(v.warnings) && v.warnings.length > 0) {
        setWarn(`Connected, but: ${v.warnings.join("; ")}`);
      }
      setToken(""); setConfirm("");
      await onConnected();
    } catch (e: any) {
      setErr(`Network error: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  }

  const tokenUrl = "https://github.com/settings/tokens/new?scopes=repo,read:org,workflow&description=DeployOps%20Console";

  return (
    <Card className="border-amber-500/40" data-testid="github-connect-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-amber-500" />
          {headline}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">{subtext}</p>
        {diag && diag.viewer && (
          <div className="text-[11px] text-muted-foreground" data-testid="connect-current-account">
            Current connection: <span className="font-mono">@{diag.viewer.login}</span>
            {diag.authSource && <> ({diag.authSource})</>}
          </div>
        )}
        {diag?.viewerError && (
          <div className="text-[11px] text-amber-600 dark:text-amber-400" data-testid="connect-current-error">
            Stored token is rejected by GitHub: {diag.viewerError.code}: {diag.viewerError.message}
          </div>
        )}
        <form onSubmit={submit} className="space-y-2" data-testid="connect-form">
          <div>
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground block mb-1">
              GitHub Personal Access Token
            </label>
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="ghp_… or github_pat_…"
              disabled={busy}
              data-testid="input-github-token"
            />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground block mb-1">
              Confirm save (type <span className="font-mono">I UNDERSTAND</span>)
            </label>
            <Input
              type="text"
              autoComplete="off"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="I UNDERSTAND"
              disabled={busy}
              data-testid="input-github-confirm"
            />
          </div>
          {err && (
            <div className="text-[11px] text-red-500 dark:text-red-400" data-testid="connect-error">{err}</div>
          )}
          {warn && (
            <div className="text-[11px] text-amber-600 dark:text-amber-400" data-testid="connect-warning">{warn}</div>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <Button type="submit" size="sm" disabled={busy || !token.trim()} data-testid="button-connect-github">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <KeyRound className="h-3.5 w-3.5 mr-1" />}
              {busy ? "Connecting…" : "Connect & validate"}
            </Button>
            <a
              href={tokenUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] text-muted-foreground underline inline-flex items-center gap-1"
              data-testid="link-create-token"
            >
              Create a PAT on GitHub <ExternalLink className="h-3 w-3" />
            </a>
            <span className="text-[11px] text-muted-foreground">
              Required scopes: <code className="font-mono">repo</code>, <code className="font-mono">read:org</code>, <code className="font-mono">workflow</code>
            </span>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/* re-exported for caller convenience */
export { fetchOrThrow };
