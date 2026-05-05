import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

/**
 * DeployOps Console — schema
 *
 * `projects`     a GitHub repo wired up for managed deployment
 * `runs`         one orchestrated deployment attempt for a project
 * `stages`       individual pipeline steps within a run (ordered)
 * `blueprints`   reusable environment templates (stack + provider matrix)
 * `providers`    GitHub / Vercel / Neon / Prisma / Railway connection state
 *
 * SQLite has no array type — JSON is stored as text and parsed in app code.
 */

/* -------------------------------- projects -------------------------------- */
export const projects = sqliteTable("projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  repo: text("repo").notNull(),                    // org/repo
  framework: text("framework").notNull(),          // nextjs|node|static|astro|...
  buildCommand: text("build_command").notNull(),
  outputDir: text("output_dir").notNull(),
  rootDir: text("root_dir").notNull().default("."),
  needsDatabase: integer("needs_database", { mode: "boolean" }).notNull().default(false),
  ormDetected: text("orm_detected"),               // prisma|drizzle|null
  envExample: text("env_example_json").notNull().default("[]"), // JSON: string[]
  blueprintId: integer("blueprint_id"),
  accessMode: text("access_mode").notNull().default("private"), // public|client|private
  /* live GitHub source metadata (populated by the live repo picker) */
  sourceProvider: text("source_provider").notNull().default("manual"), // github|manual
  sourceBranch: text("source_branch"),                                  // selected ref
  sourceUrl: text("source_url"),                                        // html_url
  sourceDefaultBranch: text("source_default_branch"),
  sourceVisibility: text("source_visibility"),                          // public|private
  sourceLanguage: text("source_language"),
  sourceUpdatedAt: integer("source_updated_at"),
  detectedConfig: text("detected_config_json").notNull().default("{}"),// JSON object
  createdAt: integer("created_at").notNull(),
});

export const insertProjectSchema = createInsertSchema(projects).omit({
  id: true,
  createdAt: true,
});
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projects.$inferSelect;

/* ---------------------------------- runs ---------------------------------- */
/**
 * A run represents one orchestrated deployment attempt.
 *
 * `mode` distinguishes:
 *   - `dry-run`  — plan only; no provider mutations.
 *   - `live`     — real provider calls. Live runs go through gates and only
 *                  reach `live_succeeded` when the upstream provider returns
 *                  a ready/completed deployment with a public URL.
 *
 * `status` values:
 *   - dry-run lifecycle: queued | running | validated_dry_run | failed | paused
 *   - live   lifecycle:  queued | live_blocked | live_pending | live_running |
 *                        live_succeeded | live_failed
 *
 * Legacy values (`succeeded`) are kept for backward-compat with seed data
 * but new dry-run completions write `validated_dry_run` instead so the UI
 * never confuses a plan with a real deployment.
 */
export const runs = sqliteTable("runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").notNull(),
  environment: text("environment").notNull(),      // test|demo|deploy
  mode: text("mode").notNull().default("dry-run"), // dry-run|live
  status: text("status").notNull().default("queued"),
  providers: text("providers_json").notNull().default("[]"), // JSON string[]
  envVars: text("env_vars_json").notNull().default("[]"),    // JSON {key,value,source}[]
  notes: text("notes"),
  /* Vercel-specific live deployment metadata (populated for live runs). */
  vercelDeploymentId: text("vercel_deployment_id"),
  vercelProjectId: text("vercel_project_id"),
  vercelProjectName: text("vercel_project_name"),
  vercelTeamId: text("vercel_team_id"),
  vercelStatus: text("vercel_status"),                       // upstream READY|BUILDING|ERROR|...
  vercelUrl: text("vercel_url"),                             // public deployment URL (https)
  vercelAliasUrl: text("vercel_alias_url"),                  // primary alias URL if any
  vercelInspectorUrl: text("vercel_inspector_url"),
  vercelErrorMessage: text("vercel_error_message"),
  vercelEvents: text("vercel_events_json").notNull().default("[]"), // JSON: provider events / log messages (real, not synthetic)
  vercelLastPolledAt: integer("vercel_last_polled_at"),
  startedAt: integer("started_at"),
  finishedAt: integer("finished_at"),
  createdAt: integer("created_at").notNull(),
});
export const insertRunSchema = createInsertSchema(runs).omit({
  id: true,
  startedAt: true,
  finishedAt: true,
  createdAt: true,
});
export type InsertRun = z.infer<typeof insertRunSchema>;
export type Run = typeof runs.$inferSelect;

/* --------------------------------- stages --------------------------------- */
export const stages = sqliteTable("stages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: integer("run_id").notNull(),
  order: integer("order_idx").notNull(),
  key: text("key").notNull(),
  label: text("label").notNull(),
  description: text("description").notNull(),
  provider: text("provider"),                      // github|vercel|neon|prisma|railway|null
  status: text("status").notNull().default("pending"), // pending|running|succeeded|failed|skipped
  startedAt: integer("started_at"),
  finishedAt: integer("finished_at"),
  log: text("log").notNull().default(""),
});
export const insertStageSchema = createInsertSchema(stages).omit({
  id: true,
  startedAt: true,
  finishedAt: true,
});
export type InsertStage = z.infer<typeof insertStageSchema>;
export type Stage = typeof stages.$inferSelect;

/* ------------------------------- blueprints ------------------------------- */
export const blueprints = sqliteTable("blueprints", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  tagline: text("tagline").notNull(),
  description: text("description").notNull(),
  framework: text("framework").notNull(),
  providers: text("providers_json").notNull().default("[]"), // JSON string[]
  defaults: text("defaults_json").notNull().default("{}"),   // JSON object
  recommended: integer("recommended", { mode: "boolean" }).notNull().default(false),
});
export const insertBlueprintSchema = createInsertSchema(blueprints).omit({ id: true });
export type InsertBlueprint = z.infer<typeof insertBlueprintSchema>;
export type Blueprint = typeof blueprints.$inferSelect;

/* -------------------------------- providers ------------------------------- */
export const providers = sqliteTable("providers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(),             // github|vercel|neon|prisma|railway
  name: text("name").notNull(),
  status: text("status").notNull().default("disconnected"), // connected|disconnected|partial
  mode: text("mode").notNull().default("dry-run"),          // dry-run|live
  notes: text("notes").notNull().default(""),
  capabilities: text("capabilities_json").notNull().default("[]"), // JSON string[]
  lastChecked: integer("last_checked"),
});
export const insertProviderSchema = createInsertSchema(providers).omit({ id: true, lastChecked: true });
export type InsertProvider = z.infer<typeof insertProviderSchema>;
export type Provider = typeof providers.$inferSelect;

/* ------------------------- provider connections -------------------------- */
/**
 * Provider connections — production-grade, per-provider auth state.
 *
 * One row per provider key (github|vercel|neon|prisma|railway). The encrypted
 * access token (if any) is stored as `tokenCipher` (AES-256-GCM, base64).
 * Plain tokens never touch disk and are never returned over the API.
 *
 * `authMethod`:
 *   - `oauth`  — GitHub OAuth web flow exchange completed (authoritative)
 *   - `pat`    — admin pasted a Personal Access Token / API key
 *   - `env`    — derived from process.env (read-only marker, no token stored)
 *   - `demo`   — mock connection for local/dev/demo, no secret material
 *   - `none`   — placeholder (disconnected)
 *
 * `status`: connected | disconnected | invalid | expired | needs-setup
 */
export const providerConnections = sqliteTable("provider_connections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  provider: text("provider").notNull().unique(),
  status: text("status").notNull().default("disconnected"),
  authMethod: text("auth_method").notNull().default("none"),
  tokenCipher: text("token_cipher"),
  tokenLast4: text("token_last4"),
  refreshCipher: text("refresh_cipher"),
  accountJson: text("account_json").notNull().default("{}"),
  scopesJson: text("scopes_json").notNull().default("[]"),
  errorsJson: text("errors_json").notNull().default("[]"),
  liveMode: integer("live_mode", { mode: "boolean" }).notNull().default(false),
  expiresAt: integer("expires_at"),
  lastValidatedAt: integer("last_validated_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
export const insertProviderConnectionSchema = createInsertSchema(providerConnections).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertProviderConnection = z.infer<typeof insertProviderConnectionSchema>;
export type ProviderConnection = typeof providerConnections.$inferSelect;

/**
 * Connection events — per-connection audit trail.
 * Records connect/disconnect/validate/rotate events without secret material.
 */
export const connectionEvents = sqliteTable("connection_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  connectionId: integer("connection_id"),
  provider: text("provider").notNull(),
  event: text("event").notNull(),
  ok: integer("ok", { mode: "boolean" }).notNull().default(true),
  detail: text("detail").notNull().default(""),
  meta: text("meta_json").notNull().default("{}"),
  createdAt: integer("created_at").notNull(),
});
export const insertConnectionEventSchema = createInsertSchema(connectionEvents).omit({
  id: true, createdAt: true,
});
export type InsertConnectionEvent = z.infer<typeof insertConnectionEventSchema>;
export type ConnectionEvent = typeof connectionEvents.$inferSelect;

/* -------------------- Fix Bot: incidents / checks / etc -------------------- */
/**
 * Fix Bot reliability domain.
 *
 * `healthChecks`     a recurring probe (HTTP, build, migration, env) that emits a status
 * `incidents`        a detected problem with one or more diagnoses + remediations
 * `diagnoses`        an analyzed root cause card with confidence + evidence
 * `remediations`     a proposed or executed fix step (PR, redeploy, env update, escalate)
 * `auditLogs`        every Fix Bot action recorded immutably (dry-run by default)
 */
export const healthChecks = sqliteTable("health_checks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),                    // http|build|migration|env|domain|workflow
  target: text("target").notNull(),                // URL, build name, migration tag, etc.
  status: text("status").notNull().default("ok"),  // ok|warning|down|unknown
  intervalSec: integer("interval_sec").notNull().default(60),
  lastObservedAt: integer("last_observed_at"),
  lastDetail: text("last_detail").notNull().default(""),
});
export const insertHealthCheckSchema = createInsertSchema(healthChecks).omit({ id: true, lastObservedAt: true });
export type InsertHealthCheck = z.infer<typeof insertHealthCheckSchema>;
export type HealthCheck = typeof healthChecks.$inferSelect;

export const incidents = sqliteTable("incidents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id"),
  runId: integer("run_id"),
  title: text("title").notNull(),
  category: text("category").notNull(),            // env|build|migration|domain|ci|runtime
  severity: text("severity").notNull().default("warning"), // info|warning|critical
  status: text("status").notNull().default("open"),        // open|diagnosing|fix-ready|approved|resolved|escalated
  autonomy: text("autonomy").notNull().default("approval-required"), // diagnose-only|prepare-fix|approval-required|safe-auto-fix
  source: text("source").notNull().default("fixbot"),      // fixbot|manual|webhook
  summary: text("summary").notNull().default(""),
  signals: text("signals_json").notNull().default("[]"),   // JSON: log lines / probe results
  detectedAt: integer("detected_at").notNull(),
  resolvedAt: integer("resolved_at"),
});
export const insertIncidentSchema = createInsertSchema(incidents).omit({ id: true, detectedAt: true, resolvedAt: true });
export type InsertIncident = z.infer<typeof insertIncidentSchema>;
export type Incident = typeof incidents.$inferSelect;

export const diagnoses = sqliteTable("diagnoses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  incidentId: integer("incident_id").notNull(),
  rootCause: text("root_cause").notNull(),
  evidence: text("evidence_json").notNull().default("[]"), // JSON string[]
  confidence: integer("confidence").notNull().default(0),  // 0-100
  recommendation: text("recommendation").notNull().default(""),
  createdAt: integer("created_at").notNull(),
});
export const insertDiagnosisSchema = createInsertSchema(diagnoses).omit({ id: true, createdAt: true });
export type InsertDiagnosis = z.infer<typeof insertDiagnosisSchema>;
export type Diagnosis = typeof diagnoses.$inferSelect;

export const remediations = sqliteTable("remediations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  incidentId: integer("incident_id").notNull(),
  action: text("action").notNull(),                // open-pr|retry-deploy|update-env|run-migration|escalate|rollback|create-issue
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("proposed"), // proposed|approved|running|applied|failed|dismissed
  approvalRequired: integer("approval_required", { mode: "boolean" }).notNull().default(true),
  payload: text("payload_json").notNull().default("{}"), // JSON object: PR body, env diff, etc.
  log: text("log").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  completedAt: integer("completed_at"),
});
export const insertRemediationSchema = createInsertSchema(remediations).omit({ id: true, createdAt: true, completedAt: true });
export type InsertRemediation = z.infer<typeof insertRemediationSchema>;
export type Remediation = typeof remediations.$inferSelect;

/* ----------------------------- github repo cache ------------------------- */
/**
 * Cached GitHub repo metadata, populated whenever /api/github/repos succeeds
 * with live credentials. Used as a fallback when the gh CLI loses auth so the
 * picker keeps showing repos instead of returning 503.
 *
 * No tokens or secret material live here — only public-ish repo metadata that
 * the user already has access to. Rows are unique by full_name.
 */
export const githubRepos = sqliteTable("github_repos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fullName: text("full_name").notNull().unique(),       // owner/repo
  owner: text("owner").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  url: text("url"),
  cloneUrl: text("clone_url"),
  defaultBranch: text("default_branch").notNull().default("main"),
  isPrivate: integer("is_private", { mode: "boolean" }).notNull().default(false),
  fork: integer("fork", { mode: "boolean" }).notNull().default(false),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  language: text("language"),
  pushedAt: text("pushed_at"),
  updatedAt: text("updated_at"),
  topics: text("topics_json").notNull().default("[]"),  // JSON: string[]
  cachedAt: integer("cached_at").notNull(),
});
export const insertGithubRepoSchema = createInsertSchema(githubRepos).omit({ id: true, cachedAt: true });
export type InsertGithubRepo = z.infer<typeof insertGithubRepoSchema>;
export type GithubRepoRow = typeof githubRepos.$inferSelect;

export const auditLogs = sqliteTable("audit_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  scope: text("scope").notNull(),                  // fixbot|run|provider|migration
  refId: integer("ref_id"),
  actor: text("actor").notNull().default("fixbot"),// fixbot|user|system
  event: text("event").notNull(),                  // diagnose|propose|approve|apply|dismiss|escalate
  detail: text("detail").notNull().default(""),
  mode: text("mode").notNull().default("dry-run"), // dry-run|live
  createdAt: integer("created_at").notNull(),
});
export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({ id: true, createdAt: true });
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;
