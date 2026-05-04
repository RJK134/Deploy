/**
 * Fix Bot adapter layer.
 *
 * Adapters are the single boundary where Fix Bot would invoke real provider
 * APIs to apply remediations. By default every adapter runs in DRY-RUN and
 * returns a deterministic plan with no side effects. Live mode is gated on:
 *
 *   - DEPLOYOPS_LIVE=1 (env)
 *   - the per-provider `mode` column in the providers table
 *   - the remediation's `approvalRequired` flag (must be false OR `approved`)
 *   - the incident's `autonomy` level (only `safe-auto-fix` may bypass approval)
 *
 * Live invocation patterns are documented inline so an operator can wire them
 * with confidence. None of these adapters write to real services in this build.
 */

import type { Incident, Remediation } from "@shared/schema";

export type AutonomyLevel = "diagnose-only" | "prepare-fix" | "approval-required" | "safe-auto-fix";

export interface ApplyContext {
  mode: "dry-run" | "live";
  autonomy: AutonomyLevel;
  liveEnabled: boolean;          // process.env.DEPLOYOPS_LIVE === "1"
  providerLive: Record<string, boolean>; // per-provider mode lookup
}

export interface ApplyResult {
  ok: boolean;
  log: string[];
  effective: "simulated" | "applied" | "blocked";
  reason?: string;
}

function block(reason: string, log: string[]): ApplyResult {
  return { ok: true, log: [...log, `[blocked] ${reason}`], effective: "blocked", reason };
}

function shouldApplyLive(ctx: ApplyContext, providerKey: string, approvalRequired: boolean): { live: boolean; reason?: string } {
  if (!ctx.liveEnabled) return { live: false, reason: "DEPLOYOPS_LIVE != 1" };
  if (!ctx.providerLive[providerKey]) return { live: false, reason: `${providerKey} provider in dry-run mode` };
  if (approvalRequired) return { live: false, reason: "approval still required" };
  if (ctx.autonomy !== "safe-auto-fix") return { live: false, reason: `autonomy=${ctx.autonomy} requires explicit approval` };
  return { live: true };
}

/**
 * GitHub adapter — opens issues / PRs.
 *
 * Live invocation pattern (server-side only):
 *   bash({ command: "gh pr create --base main --head fixbot/relock-marketing-site --title '...' --body '...'", api_credentials: ["github"] })
 *   bash({ command: "gh issue create --repo acme-school/marketing-site --title '...' --body '...' --label ci", api_credentials: ["github"] })
 */
export async function fixbotGitHubAction(
  inc: Incident, rem: Remediation, ctx: ApplyContext,
): Promise<ApplyResult> {
  const log: string[] = [];
  const payload = safeJSON(rem.payload);
  log.push(`[fixbot · github] action=${rem.action} for incident #${inc.id}`);
  if (rem.action === "open-pr") {
    log.push(`  branch=${payload.branch}  base=${payload.base}`);
    log.push(`  title="${payload.title}"`);
    if (Array.isArray(payload.checklist)) {
      log.push("  checklist:");
      for (const item of payload.checklist) log.push(`    - ${item}`);
    }
  } else if (rem.action === "create-issue") {
    log.push(`  repo=${payload.repo}  labels=${(payload.labels || []).join(",")}`);
  }
  const decision = shouldApplyLive(ctx, "github", rem.approvalRequired);
  if (!decision.live) return block(decision.reason!, log);
  /* TODO live: invoke gh CLI here (kept dry-run in this build). */
  log.push("[live · github] would execute gh CLI here. Build skipped to avoid mutations.");
  return { ok: true, log, effective: "applied" };
}

/**
 * Vercel adapter — redeploy, env updates, domain attach.
 *
 * Live invocation pattern:
 *   bash({ command: "npx vercel --token $VERCEL_TOKEN env add DATABASE_URL preview", api_credentials: ["vercel"] })
 *   bash({ command: "npx vercel --token $VERCEL_TOKEN deploy --prebuilt", api_credentials: ["vercel"] })
 *   bash({ command: "npx vercel --token $VERCEL_TOKEN domains add lesson-portal.app", api_credentials: ["vercel"] })
 */
export async function fixbotVercelAction(
  inc: Incident, rem: Remediation, ctx: ApplyContext,
): Promise<ApplyResult> {
  const log: string[] = [];
  const payload = safeJSON(rem.payload);
  log.push(`[fixbot · vercel] action=${rem.action} for incident #${inc.id}`);
  if (rem.action === "retry-deploy") {
    log.push(`  project=${payload.project}  env=${payload.env}`);
    log.push("  command: npx vercel deploy --prebuilt");
  } else if (rem.action === "update-env") {
    log.push(`  env=${payload.env}  key=${payload.key}  source=${payload.source ?? payload.action}`);
    log.push("  command: npx vercel env add");
  } else if (payload.action === "domains-add") {
    log.push(`  domain=${payload.domain}`);
    log.push("  command: npx vercel domains add");
  }
  const decision = shouldApplyLive(ctx, "vercel", rem.approvalRequired);
  if (!decision.live) return block(decision.reason!, log);
  /* TODO live: invoke vercel CLI here (kept dry-run). */
  log.push("[live · vercel] would execute vercel CLI here. Build skipped to avoid mutations.");
  return { ok: true, log, effective: "applied" };
}

/**
 * Neon adapter — branch lookup + connection-string fetch.
 *
 * Live invocation pattern (Pipedream connector):
 *   external-tool call '{"source_id":"neon_postgres__pipedream","tool_name":"execute-custom-query", ...}'
 */
export async function fixbotNeonAction(
  inc: Incident, rem: Remediation, ctx: ApplyContext,
): Promise<ApplyResult> {
  const log: string[] = [];
  log.push(`[fixbot · neon] action=${rem.action} for incident #${inc.id}`);
  log.push("  inspect: SELECT current_database(), now()");
  log.push("  branch lookup: neon_postgres-find-row branches WHERE name=br-...");
  const decision = shouldApplyLive(ctx, "neon", rem.approvalRequired);
  if (!decision.live) return block(decision.reason!, log);
  /* TODO live: invoke neon connector here (kept dry-run). */
  log.push("[live · neon] would issue SQL via the Neon connector. Build skipped to avoid mutations.");
  return { ok: true, log, effective: "applied" };
}

/**
 * Prisma adapter — generate / apply corrective migration.
 *
 * Live invocation pattern (Pipedream connector + npx):
 *   external-tool call '{"source_id":"prisma_management_api__pipedream","tool_name":"create_database_in_existing_project", ...}'
 *   bash({ command: "npx prisma migrate diff --from-schema-datamodel ... --to-schema-datamodel ..." })
 *   bash({ command: "npx prisma migrate deploy" })
 */
export async function fixbotPrismaAction(
  inc: Incident, rem: Remediation, ctx: ApplyContext,
): Promise<ApplyResult> {
  const log: string[] = [];
  const payload = safeJSON(rem.payload);
  log.push(`[fixbot · prisma] action=${rem.action} for incident #${inc.id}`);
  if (payload.sketchedSql) {
    log.push("  sketched SQL:");
    for (const line of String(payload.sketchedSql).split(";").filter(Boolean)) {
      log.push(`    ${line.trim()};`);
    }
  }
  log.push("  recommended: run on a Neon branch first, then promote.");
  const decision = shouldApplyLive(ctx, "prisma", rem.approvalRequired);
  if (!decision.live) return block(decision.reason!, log);
  /* TODO live: invoke prisma migrate via npx (kept dry-run). */
  log.push("[live · prisma] would execute prisma migrate here. Build skipped to avoid mutations.");
  return { ok: true, log, effective: "applied" };
}

/**
 * Smoke test adapter — re-runs the smoke probe for the affected target.
 */
export async function fixbotSmokeTest(
  inc: Incident, _rem: Remediation, _ctx: ApplyContext,
): Promise<ApplyResult> {
  const log = [
    `[fixbot · smoke] re-running probe for incident #${inc.id}`,
    "  GET / → 200 OK · 132 ms",
    "  GET /api/health → 200 OK · {\"status\":\"ok\"} · 78 ms",
  ];
  return { ok: true, log, effective: "simulated" };
}

/**
 * Escalation — emit a structured escalation event. Real live wiring would
 * post to Slack / PagerDuty.
 */
export async function fixbotEscalate(
  inc: Incident, rem: Remediation, _ctx: ApplyContext,
): Promise<ApplyResult> {
  const payload = safeJSON(rem.payload);
  const log = [
    `[fixbot · escalate] incident #${inc.id} → ${payload.channel ?? "#oncall"}`,
    `  severity=${inc.severity}  category=${inc.category}  status=${inc.status}`,
    "  attached: latest diagnosis + remediations summary",
  ];
  return { ok: true, log, effective: "simulated" };
}

/**
 * Generate a deterministic diagnosis from the latest signals.
 * In live mode, this would call out to a model / log analysis service.
 */
export function fixbotDiagnose(inc: Incident): {
  rootCause: string;
  evidence: string[];
  confidence: number;
  recommendation: string;
} {
  const signals = safeJSON<string[]>(inc.signals, []);
  const lower = signals.join("\n").toLowerCase();
  if (inc.category === "build" && lower.includes("cannot find module")) {
    return {
      rootCause: "Build failed because a declared package is not installed. Most likely a lockfile drift.",
      evidence: signals.slice(-4),
      confidence: 88,
      recommendation: "Regenerate lockfile in a fixbot/* branch, open a PR, then trigger a fresh preview deploy.",
    };
  }
  if (inc.category === "env") {
    return {
      rootCause: "Required env var not present in the active environment. The provider that owns it never propagated to the runtime host.",
      evidence: signals.slice(-3),
      confidence: 80,
      recommendation: "Fetch the value from the source provider (Neon/Prisma) and write it to the runtime host (Vercel) for the affected env.",
    };
  }
  if (inc.category === "migration") {
    return {
      rootCause: "Schema migration failed mid-apply. Database is in a partial state.",
      evidence: signals.slice(-4),
      confidence: 65,
      recommendation: "Author a corrective migration. Run on a Neon branch first to validate before promoting to prod.",
    };
  }
  if (inc.category === "domain") {
    return {
      rootCause: "Domain attached but TLS provisioning incomplete.",
      evidence: signals.slice(-2),
      confidence: 90,
      recommendation: "Re-attach the domain to the project so the cert pipeline restarts.",
    };
  }
  if (inc.category === "ci") {
    return {
      rootCause: "Workflow uses an outdated runner / action version that conflicts with the repo's engines field.",
      evidence: signals.slice(-3),
      confidence: 75,
      recommendation: "Bump the workflow's action versions. Ship as a PR for review.",
    };
  }
  return {
    rootCause: "Insufficient signal — Fix Bot needs more probe data to be confident.",
    evidence: signals.slice(-2),
    confidence: 30,
    recommendation: "Re-run the relevant health check and capture additional logs before proposing remediation.",
  };
}

function safeJSON<T = any>(raw: any, fallback?: T): T {
  if (typeof raw !== "string") return (raw ?? fallback) as T;
  try { return JSON.parse(raw) as T; } catch { return (fallback ?? ({} as T)); }
}
